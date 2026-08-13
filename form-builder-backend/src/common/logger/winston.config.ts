import { format, transports } from 'winston';
import 'winston-daily-rotate-file';

// ─────────────────────────────────────────────────────────────────────────────
//  ANSI color codes for development console output
// ─────────────────────────────────────────────────────────────────────────────
const LEVEL_COLORS: Record<string, string> = {
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  info: '\x1b[36m', // cyan
  http: '\x1b[35m', // magenta
  verbose: '\x1b[34m', // blue
  debug: '\x1b[90m', // gray
};

const STATUS_COLORS: Record<number, string> = {
  2: '\x1b[32m', // green  — 2xx
  3: '\x1b[36m', // cyan   — 3xx
  4: '\x1b[33m', // yellow — 4xx
  5: '\x1b[31m', // red    — 5xx
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ─────────────────────────────────────────────────────────────────────────────
//  HTTP method color badges
// ─────────────────────────────────────────────────────────────────────────────
const METHOD_COLORS: Record<string, string> = {
  GET: '\x1b[32m', // green
  POST: '\x1b[34m', // blue
  PUT: '\x1b[33m', // yellow
  PATCH: '\x1b[35m', // magenta
  DELETE: '\x1b[31m', // red
  OPTIONS: '\x1b[90m', // gray
  HEAD: '\x1b[90m', // gray
};

// ─────────────────────────────────────────────────────────────────────────────
//  Dev console format — human-readable, colorized, aligned
//  Example output:
//   2026-07-27 11:30:01 [INFO ]  [FormsService]  Created form abc-123
//   2026-07-27 11:30:01 [HTTP ]  ← 201  POST /v1/forms  312B  12ms  from 127.0.0.1 (Chrome/Win)
//   2026-07-27 11:30:01 [WARN ]  ← 404  GET  /v1/forms/bad-id  3ms  from 127.0.0.1
// ─────────────────────────────────────────────────────────────────────────────
export const devConsoleFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.printf((info) => {
    const { timestamp, level, message, context, stack, ...meta } = info as any;

    const levelPad = level.toUpperCase().padEnd(7);
    const levelColor = LEVEL_COLORS[level] ?? RESET;
    const levelStr = `${levelColor}${BOLD}[${levelPad}]${RESET}`;
    const tsStr = `${DIM}${timestamp}${RESET}`;
    const ctxStr = context ? ` ${DIM}[${context}]${RESET}` : '';

    // ── HTTP access log (special formatting)
    //
    // HttpLoggingInterceptor used to emit an arriving (`direction: 'IN'`) and a
    // completing (`direction: 'OUT'`) record per request, rendered as two
    // different lines. It now emits ONE record on completion, so there is one
    // shape to render and `direction` is gone — the discriminator is a record
    // from the HTTP context that carries a status code. Everything the arrival
    // line used to show (client IP, user agent) is folded into the tail of this
    // one, which is what makes the collapse invisible in dev.
    if (context === 'HTTP' && typeof meta.statusCode === 'number') {
      const statusCode = meta.statusCode;
      const sColor = STATUS_COLORS[Math.floor(statusCode / 100)] ?? RESET;
      const m = (meta.method ?? '').padEnd(6);
      const mColor = METHOD_COLORS[meta.method] ?? RESET;
      const url = `${BOLD}${meta.url}${RESET}`;
      const ms = meta.durationMs;
      const msColor =
        ms < 100 ? '\x1b[32m' : ms < 500 ? '\x1b[33m' : '\x1b[31m';
      const sizePart = meta.contentLength
        ? ` ${DIM}${meta.contentLength}B${RESET}`
        : '';
      const ipPart = meta.ip ? ` ${DIM}from ${meta.ip}${RESET}` : '';
      const uaPart = meta.userAgent
        ? ` ${DIM}(${meta.userAgent.slice(0, 40)})${RESET}`
        : '';
      const errPart = meta.errorMessage
        ? ` ${LEVEL_COLORS.error}${meta.errorMessage}${RESET}`
        : '';

      return `${tsStr} ${levelStr}${ctxStr}  ${sColor}← ${statusCode}${RESET}  ${mColor}${m}${RESET} ${url}${sizePart}  ${msColor}${ms}ms${RESET}${ipPart}${uaPart}${errPart}`;
    }

    // ── Regular application log
    const msgStr =
      level === 'error' ? `${LEVEL_COLORS.error}${message}${RESET}` : message;
    const stackStr = stack ? `\n${DIM}${stack}${RESET}` : '';
    const metaStr = Object.keys(meta).length
      ? `\n${DIM}  ${JSON.stringify(meta, null, 2)}${RESET}`
      : '';

    return `${tsStr} ${levelStr}${ctxStr}  ${msgStr}${stackStr}${metaStr}`;
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
//  JSON format for production — machine-readable for ELK / Grafana / Loki
//  Every field is a top-level key for easy parsing and filtering.
// ─────────────────────────────────────────────────────────────────────────────
export const jsonFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json(),
);

// ─────────────────────────────────────────────────────────────────────────────
//  Transport factory
// ─────────────────────────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
const LOG_DIR = process.env.LOG_DIR ?? 'logs';

const DailyRotateFileTransport = (transports as any).DailyRotateFile;

/**
 * Transports.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PRODUCTION: stdout only, JSON, no files.
 *
 * There used to be three daily-rotate file transports here — combined, error,
 * and http — plus file-based exception and rejection handlers, active in every
 * environment. In a container that is wrong three times over. It is two extra
 * disk writes on the hot path of every single request, for bytes nothing will
 * ever read. The logs are written inside the container's writable layer, so
 * they die with the pod — which is exactly when you want them, and they are
 * also invisible to `kubectl logs`, which reads stdout. And an unbounded (well,
 * 14-day, 50MB-per-file) write into that layer competes with the application
 * for ephemeral storage, with pod eviction as the failure mode.
 *
 * This is the twelve-factor rule and it is right: a process should not manage
 * its own log routing. It writes an event stream to stdout, and the platform —
 * the container runtime, then Loki/ELK/CloudWatch — decides where that goes,
 * how long it is kept, and how it is indexed. Rotation, compression and
 * retention are operational policy, and they do not belong in the app.
 *
 * DEVELOPMENT: the file transports stay. There is no platform collector on a
 * laptop, scrollback is finite, and being able to grep this morning's
 * `combined-*.log` after the terminal has been cleared is genuinely useful.
 */
export function createWinstonTransports() {
  const list: any[] = [];

  // ── Console transport ──────────────────────────────────────────────────────
  list.push(
    new transports.Console({
      level: isProd ? 'info' : 'debug',
      format: isProd ? jsonFormat : devConsoleFormat,
      // Silence in test environment
      silent: process.env.NODE_ENV === 'test',
    }),
  );

  // In production stdout IS the log. Everything below is a development
  // convenience and must not run in a container.
  if (isProd) return list;

  // ── Combined log (all levels) — daily rotation ────────────────────────────
  list.push(
    new DailyRotateFileTransport({
      level: 'debug',
      dirname: LOG_DIR,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true, // Gzip old logs
      maxSize: '50m', // Rotate at 50 MB
      maxFiles: '14d', // Keep 14 days
      format: jsonFormat,
    }),
  );

  // ── Error-only log — longer retention ─────────────────────────────────────
  list.push(
    new DailyRotateFileTransport({
      level: 'error',
      dirname: LOG_DIR,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      format: jsonFormat,
    }),
  );

  // ── HTTP-only access log ───────────────────────────────────────────────────
  list.push(
    new DailyRotateFileTransport({
      level: 'http',
      dirname: LOG_DIR,
      filename: 'http-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '100m', // HTTP logs can be large
      maxFiles: '7d',
      format: format.combine(format.timestamp(), format.json()),
    }),
  );

  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Winston module options for nest-winston (used in AppModule)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Uncaught exceptions and unhandled rejections.
 *
 * These followed the same reasoning as the request logs and get the same
 * treatment: in production they go to stdout as JSON, where the platform will
 * actually collect them. Writing a process's dying words to a file inside the
 * container it is dying in is the one case where losing the log is guaranteed.
 */
function createCrashHandlers(devFilename: string) {
  if (isProd) return [new transports.Console({ format: jsonFormat })];
  return [new transports.File({ filename: `${LOG_DIR}/${devFilename}` })];
}

export const winstonModuleOptions = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
  },
  transports: createWinstonTransports(),
  exceptionHandlers: createCrashHandlers('exceptions.log'),
  rejectionHandlers: createCrashHandlers('rejections.log'),
};
