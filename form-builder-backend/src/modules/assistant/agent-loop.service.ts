import { Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { AssistantMode, AssistantMessageRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  ASK_CLARIFYING_QUESTION_TOOL,
  parseClarifyingQuestion,
  type ClarifyingQuestion,
} from './tools/ask-clarifying-question.tool';
import {
  ClaudeClientService,
  MODEL_HAIKU,
  computeCostUsd,
  type ClaudeModel,
  type UsageInfo,
} from './claude-client.service';
import { SessionService } from './session.service';
import { FaqCacheService } from './faq-cache.service';

const MAX_TOOL_ITERATIONS = 4;
/**
 * Per AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.2 — the outer loop is a router and
 * relay, not where synthesis happens (that's inside generation tools, which
 * make their own Sonnet calls with their own token budgets). 1024 keeps a
 * chatty reply from ballooning the common case.
 */
const LOOP_MAX_TOKENS = 1024;

/**
 * Replayed history window, in DB rows (each `ask()` call appends exactly one
 * USER row and one ASSISTANT row, regardless of how many tool iterations it
 * took internally — see SessionService#appendMessage) — so 12 rows is 6
 * user/assistant turns. Bounds C7's "unbounded, forever" replay cost; it does
 * not yet make the replay faithful to the original content blocks (still
 * flattened to plain text per row) — see the note on `history` below for what
 * that would take and why it's deferred.
 */
const HISTORY_WINDOW_MESSAGES = 12;

export interface AgentLoopParams {
  /** null only for the platform (cross-org) mode, which has no organization. */
  orgId: string | null;
  userId: string;
  sessionId?: string;
  mode: AssistantMode;
  message: string;
  system: string;
  tools: Anthropic.Tool[];
  runTool: (name: string, input: unknown) => Promise<string>;
  /** Observes every tool call/result this turn — e.g. to pull chart data out for the frontend. */
  onToolResult?: (name: string, input: unknown, output: string) => void;
  /** Appended to the first user message only, e.g. "the user has form X open". Never put per-request data in `system`. */
  contextHint?: string;
  auditAction: string;
  /**
   * Set only by org-chat.ts, only when the turn carries no per-request hint
   * (no currentFormId) — see FaqCacheService's doc comment for why that's the
   * eligibility bar. A hit skips the Claude call entirely; a clean, tool-free
   * answer gets stored under this key for next time.
   */
  faqCacheKey?: string;
}

export interface AgentLoopResult {
  sessionId: string;
  reply: string;
  /** Present when the model called ask_clarifying_question instead of answering — see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.3(b). */
  clarify?: ClarifyingQuestion;
  /** This turn's cost in USD, from the same computation persisted alongside the message — lets the frontend show a running total to Admins without a separate usage endpoint. */
  costUsd: number;
}

/**
 * The one tool-use loop shared by every assistant mode (help, insights,
 * build/idea, and platform) — replaces the four near-identical `ask()`
 * methods that used to live on HelpGuideService/OrgInsightsService/
 * IdeaChatService/PlatformInsightsService. See
 * AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.1/§3.2/§5.
 *
 * Always runs on Haiku 4.5 — Sonnet only ever appears inside a generation
 * tool's own call (propose_rule, plan_form, plan_form_app, review_form),
 * never in this outer loop. This keeps the common "route a question, relay a
 * number" turn cheap without a separate router pass.
 *
 * Callers supply `tools` + `runTool` rather than this service importing tool
 * modules directly, so the org registry and the separate platform (cross-org)
 * registry stay physically apart — platform-insights.spec.ts asserts on that
 * separation. The one exception is
 * ask_clarifying_question (§3.3(b)): every registry includes it, and this
 * service intercepts it directly — see the loop below — because calling it
 * ends the turn immediately rather than producing a tool_result to relay.
 */
@Injectable()
export class AgentLoopService {
  private readonly logger = new Logger(AgentLoopService.name);

  constructor(
    private readonly claude: ClaudeClientService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly faqCache: FaqCacheService,
  ) {}

  async run(params: AgentLoopParams): Promise<AgentLoopResult> {
    const priorMessages = params.sessionId
      ? (
          await this.sessions.getSession(
            params.orgId,
            params.userId,
            params.sessionId,
          )
        ).messages
      : [];
    const sessionId =
      params.sessionId ??
      (
        await this.sessions.createSession(
          params.orgId,
          params.userId,
          params.mode,
          params.message,
        )
      ).id;

    await this.sessions.appendMessage(sessionId, AssistantMessageRole.USER, {
      text: params.message,
    });

    if (params.faqCacheKey) {
      const cached = await this.faqCache.get(params.faqCacheKey);
      if (cached) {
        await this.sessions.appendMessage(
          sessionId,
          AssistantMessageRole.ASSISTANT,
          { text: cached },
          {
            modelUsed: 'faq-cache',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUsd: 0,
          },
        );
        this.audit.log({
          organizationId: params.orgId,
          userId: params.userId,
          action: params.auditAction,
          resource: 'assistant_session',
          resourceId: sessionId,
          metadata: {
            question: params.message,
            toolsCalled: [],
            faqCacheHit: true,
          },
        });
        return { sessionId, reply: cached, costUsd: 0 };
      }
    }

    // Windowed to the last HISTORY_WINDOW_MESSAGES rows (C7) — bounds replay
    // cost for long sessions. Still flattened to plain text per row rather
    // than the original tool_use/tool_result blocks: making that faithful
    // would mean storing multiple content-block rows per turn instead of one
    // collapsed text row, a schema change beyond this pass — tracked as a
    // follow-up in AI_ASSISTANT_IMPROVEMENT_PLAN.md's Phase B status note.
    const windowed = priorMessages.slice(-HISTORY_WINDOW_MESSAGES);
    const history: Anthropic.MessageParam[] = windowed.map((m) => ({
      role: m.role === AssistantMessageRole.USER ? 'user' : 'assistant',
      content: (m.content as { text?: string } | null)?.text ?? '',
    }));

    const userContent = params.contextHint
      ? `${params.message}\n\n(Context: ${params.contextHint})`
      : params.message;

    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: userContent },
    ];

    const total: UsageInfo = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    const toolCallLog: Array<{ name: string; input: unknown }> = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      markCacheBreakpoint(messages);

      const turn = await this.claude.chatTurn({
        model: MODEL_HAIKU,
        system: params.system,
        messages,
        tools: params.tools,
        maxTokens: LOOP_MAX_TOKENS,
      });

      addUsage(total, turn.usage);
      messages.push({ role: 'assistant', content: turn.content });

      if (turn.stopReason !== 'tool_use') {
        const reply = replyForStop(turn.stopReason, turn.content);
        const costUsd = await this.finish(
          params,
          sessionId,
          reply,
          MODEL_HAIKU,
          total,
          toolCallLog,
          isCleanStop(turn.stopReason),
        );
        return { sessionId, reply, costUsd };
      }

      const clarifyBlock = turn.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === 'tool_use' &&
          block.name === ASK_CLARIFYING_QUESTION_TOOL.name,
      );
      if (clarifyBlock) {
        const clarify = parseClarifyingQuestion(clarifyBlock.input);
        toolCallLog.push({
          name: ASK_CLARIFYING_QUESTION_TOOL.name,
          input: clarifyBlock.input,
        });
        const reply = clarify.options?.length
          ? `${clarify.question}\n\nOptions: ${clarify.options.join(', ')}`
          : clarify.question;
        const costUsd = await this.finish(
          params,
          sessionId,
          reply,
          MODEL_HAIKU,
          total,
          toolCallLog,
          false,
        );
        return { sessionId, reply, clarify, costUsd };
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of turn.content) {
        if (block.type !== 'tool_use') continue;
        toolCallLog.push({ name: block.name, input: block.input });
        const output = await params.runTool(block.name, block.input);
        params.onToolResult?.(block.name, block.input, output);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: output,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // Graceful exhaustion (R4): one final call with tools disabled, so the
    // model must synthesize a text answer from whatever it already gathered
    // instead of us discarding it for a canned apology.
    markCacheBreakpoint(messages);
    const finalTurn = await this.claude.chatTurn({
      model: MODEL_HAIKU,
      system: params.system,
      messages,
      maxTokens: LOOP_MAX_TOKENS,
    });
    addUsage(total, finalTurn.usage);
    const reply =
      extractText(finalTurn.content) ||
      "I wasn't able to finish that in one go — could you ask again with more specifics, or a narrower question?";
    const costUsd = await this.finish(
      params,
      sessionId,
      reply,
      MODEL_HAIKU,
      total,
      toolCallLog,
      false,
    );
    return { sessionId, reply, costUsd };
  }

  private async finish(
    params: AgentLoopParams,
    sessionId: string,
    reply: string,
    model: ClaudeModel,
    usage: UsageInfo,
    toolCallLog: Array<{ name: string; input: unknown }>,
    cacheableStop: boolean,
  ): Promise<number> {
    const costUsd = computeCostUsd(model, usage);
    logCacheHealth(this.logger, sessionId, usage);
    await this.sessions.appendMessage(
      sessionId,
      AssistantMessageRole.ASSISTANT,
      { text: reply },
      {
        modelUsed: model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        costUsd,
        toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
      },
    );

    this.audit.log({
      organizationId: params.orgId,
      userId: params.userId,
      action: params.auditAction,
      resource: 'assistant_session',
      resourceId: sessionId,
      metadata: {
        question: params.message,
        toolsCalled: toolCallLog.map((t) => t.name),
      },
    });

    // FAQ cache (§3.8, §6 decision 4): only ever written for a turn that
    // called no tool at all and ended cleanly — see faq-cache.service.ts's
    // doc comment for why that's what keeps a platform-wide cache safe.
    if (params.faqCacheKey && cacheableStop && toolCallLog.length === 0) {
      await this.faqCache.set(params.faqCacheKey, reply);
    }

    return costUsd;
  }
}

/** A reply worth caching or replaying verbatim — excludes a truncated (`max_tokens`) or refused answer. */
function isCleanStop(stopReason: Anthropic.Message['stop_reason']): boolean {
  return stopReason === 'end_turn' || stopReason === 'stop_sequence';
}

/**
 * Cache-health signal (§3.8): logs this turn's
 * `cache_read / (cache_read + input)` ratio, warning under 50%. Per-turn, not
 * the "day's ratio" the plan describes — this repo has no rollup job or
 * alerting sink yet, so a log line grep-able by whatever the ops log
 * platform is stands in; the aggregate view lives in the usage dashboard
 * (usage.service.ts's `cacheHitRate`, §3.8 "cost surfaces"). A brand-new
 * session's first turn always reads as 0% (nothing to have cached yet) —
 * expected, not a signal of anything wrong.
 */
function logCacheHealth(
  logger: Logger,
  sessionId: string,
  usage: UsageInfo,
): void {
  const denominator = usage.inputTokens + usage.cacheReadTokens;
  if (denominator === 0) return;
  const ratio = usage.cacheReadTokens / denominator;
  if (ratio < 0.5) {
    logger.warn(
      `Low prompt-cache hit ratio (${Math.round(ratio * 100)}%) — session ${sessionId}`,
    );
  }
}

function addUsage(total: UsageInfo, turn: UsageInfo): void {
  total.inputTokens += turn.inputTokens;
  total.outputTokens += turn.outputTokens;
  total.cacheReadTokens += turn.cacheReadTokens;
  total.cacheCreationTokens += turn.cacheCreationTokens;
}

/**
 * Marks the last content block of the last message as a cache breakpoint
 * before every call, so the next call in this loop (or the next turn in this
 * session) can read everything up to here at ~0.1x instead of paying full
 * price again — see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.1 (C3). Combined with
 * the system-prompt breakpoint in ClaudeClientService, this uses 2 of the 4
 * breakpoints the API allows.
 *
 * Mutates in place: `messages` is this call's private array, rebuilt fresh
 * per `run()` invocation, so there's no shared-reference hazard.
 */
function markCacheBreakpoint(messages: Anthropic.MessageParam[]): void {
  if (messages.length === 0) return;
  const last = messages[messages.length - 1];
  const blocks = toBlocks(last.content);
  if (blocks.length === 0) return;
  const lastBlock = blocks[blocks.length - 1] as { cache_control?: unknown };
  lastBlock.cache_control = { type: 'ephemeral' };
  last.content = blocks as unknown as Anthropic.MessageParam['content'];
}

function toBlocks(
  content: Anthropic.MessageParam['content'],
): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content as unknown as Array<Record<string, unknown>>;
}

/**
 * Handles stop reasons beyond `tool_use` instead of assuming every non-tool
 * stop is a clean completion — see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.7
 * (R6).
 */
function replyForStop(
  stopReason: Anthropic.Message['stop_reason'],
  content: Anthropic.ContentBlock[],
): string {
  const text = extractText(content);
  if (stopReason === 'max_tokens') {
    return text
      ? `${text}\n\n(That answer got cut short — ask me to continue if you need the rest.)`
      : 'That answer got cut short before it really started — could you ask again, maybe more narrowly?';
  }
  if (stopReason === 'refusal') {
    return "I can't help with that request. Try rephrasing it, or ask something else.";
  }
  return text;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
