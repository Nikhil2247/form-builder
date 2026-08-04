import { format, transports } from 'winston';
import 'winston-daily-rotate-file';

// ─────────────────────────────────────────────────────────────────────────────
//  ANSI color codes for development console output
// ─────────────────────────────────────────────────────────────────────────────
const LEVEL_COLORS: Record<string, string> = {
  error:   '\x1b[31m', // red
  warn:    '\x1b[33m', // yellow
  info:    '\x1b[36m', // cyan
  http:    '\x1b[35m', // magenta
  verbose: '\x1b[34m', // blue
  debug:   '\x1b[90m', // gray
};

const STATUS_COLORS: Record<number, string> = {
  2: '\x1b[32m', // green  — 2xx
  3: '\x1b[36m', // cyan   — 3xx
  4: '\x1b[33m', // yellow — 4xx
  5: '\x1b[31m', // red    — 5xx
};

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

// ─────────────────────────────────────────────────────────────────────────────
//  HTTP method color badges
// ─────────────────────────────────────────────────────────────────────────────
const METHOD_COLORS: Record<string, string> = {
  GET:     '\x1b[32m', // green
  POST:    '\x1b[34m', // blue
  PUT:     '\x1b[33m', // yellow
  PATCH:   '\x1b[35m', // magenta
  DELETE:  '\x1b[31m', // red
  OPTIONS: '\x1b[90m', // gray
  HEAD:    '\x1b[90m', // gray
};

// ─────────────────────────────────────────────────────────────────────────────
//  Dev console format — human-readable, colorized, aligned
//  Example output:
//   2026-07-27 11:30:01 [INFO ]  [FormsService]  Created form abc-123
//   2026-07-27 11:30:01 [HTTP ] → POST /v1/forms  from 127.0.0.1 (Chrome/Win)
//   2026-07-27 11:30:01 [HTTP ] ← 201  POST /v1/forms  [FormBuilder]  12ms
// ─────────────────────────────────────────────────────────────────────────────
export const devConsoleFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.printf((info) => {
    const { timestamp, level, message, context, stack, ...meta } = info as any;

    const levelPad  = level.toUpperCase().padEnd(7);
    const levelColor = LEVEL_COLORS[level] ?? RESET;
    const levelStr   = `${levelColor}${BOLD}[${levelPad}]${RESET}`;
    const tsStr      = `${DIM}${timestamp}${RESET}`;
    const ctxStr     = context ? ` ${DIM}[${context}]${RESET}` : '';

    // ── HTTP request log (special formatting)
    if (meta.direction === 'IN') {
      const m      = meta.method ?? '';
      const mColor = METHOD_COLORS[m] ?? RESET;
      const url    = `${BOLD}${meta.url}${RESET}`;
      const ip     = meta.ip ? ` ${DIM}from ${meta.ip}${RESET}` : '';
      const ua     = meta.userAgent ? ` ${DIM}(${meta.userAgent.slice(0, 40)})${RESET}` : '';
      return `${tsStr} ${levelStr}${ctxStr}  ${mColor}→ ${m}${RESET} ${url}${ip}${ua}`;
    }

    if (meta.direction === 'OUT') {
      const statusCode = meta.statusCode ?? 0;
      const sColor = STATUS_COLORS[Math.floor(statusCode / 100)] ?? RESET;
      const m       = meta.method ?? '';
      const mColor  = METHOD_COLORS[m] ?? RESET;
      const url     = `${BOLD}${meta.url}${RESET}`;
      const ms      = meta.durationMs;
      const msColor = ms < 100 ? '\x1b[32m' : ms < 500 ? '\x1b[33m' : '\x1b[31m';
      const sizePart = meta.contentLength ? ` ${DIM}${meta.contentLength}B${RESET}` : '';
      return `${tsStr} ${levelStr}${ctxStr}  ${sColor}← ${statusCode}${RESET}  ${mColor}${m}${RESET} ${url}${sizePart}  ${msColor}${ms}ms${RESET}`;
    }

    // ── Regular application log
    const msgStr  = level === 'error' ? `${LEVEL_COLORS.error}${message}${RESET}` : message;
    const stackStr = stack ? `\n${DIM}${stack}${RESET}` : '';
    const metaStr  = Object.keys(meta).length
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

  // ── Combined log (all levels) — daily rotation ────────────────────────────
  list.push(
    new DailyRotateFileTransport({
      level: 'debug',
      dirname: LOG_DIR,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,      // Gzip old logs
      maxSize: '50m',            // Rotate at 50 MB
      maxFiles: '14d',           // Keep 14 days
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
      maxSize: '100m',           // HTTP logs can be large
      maxFiles: '7d',
      format: format.combine(
        format.timestamp(),
        format.json(),
      ),
    }),
  );

  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Winston module options for nest-winston (used in AppModule)
// ─────────────────────────────────────────────────────────────────────────────
export const winstonModuleOptions = {
  levels: {
    error:   0,
    warn:    1,
    info:    2,
    http:    3,
    verbose: 4,
    debug:   5,
  },
  transports: createWinstonTransports(),
  // Catch Winston's own internal errors
  exceptionHandlers: [
    new transports.File({ filename: `${process.env.LOG_DIR ?? 'logs'}/exceptions.log` }),
  ],
  rejectionHandlers: [
    new transports.File({ filename: `${process.env.LOG_DIR ?? 'logs'}/rejections.log` }),
  ],
};
