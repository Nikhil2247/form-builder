import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotImplementedException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
// Type-only — never assigned a runtime value obtained from the dynamic
// `import()` below, so this does not hit the resolution-mode conflict that
// AnthropicClient (below) has to work around.
import type Anthropic from '@anthropic-ai/sdk';
// The SDK's zodOutputFormat() types against zod's v4 API specifically — zod
// 3.25+ ships that API at this subpath for compatibility with packages still
// on the classic `zod` import. Schemas built from plain `zod` are a different
// (incompatible) shape, so every schema passed through this service must be
// built with `import { z } from 'zod/v4'`, not `from 'zod'`.
import type { z } from 'zod/v4';

/**
 * Model tiers. Keep to two: Haiku for routing/simple tasks, Sonnet for
 * anything that needs real synthesis or generation. See
 * AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.2 — the outer agent loop stays on Haiku
 * unconditionally; Sonnet appears only inside generation tools
 * (propose_rule/propose_form/propose_form_app/review_form).
 */
export const MODEL_HAIKU = 'claude-haiku-4-5';
export const MODEL_SONNET = 'claude-sonnet-5';

export type ClaudeModel = typeof MODEL_HAIKU | typeof MODEL_SONNET;

/**
 * Derived from the dynamic `import()` itself rather than a static
 * `import type Anthropic from '@anthropic-ai/sdk'` — mixing the two makes
 * TypeScript resolve the same class under two different module-resolution
 * modes (require vs. import) and reject them as incompatible types.
 */
type AnthropicClient = InstanceType<
  (typeof import('@anthropic-ai/sdk', {
    with: { 'resolution-mode': 'import' },
  }))['default']
>;

/** Populated alongside the client itself — see getClient(). */
interface AnthropicErrorClasses {
  APIError: typeof import('@anthropic-ai/sdk').APIError;
  RateLimitError: typeof import('@anthropic-ai/sdk').RateLimitError;
  APIConnectionError: typeof import('@anthropic-ai/sdk').APIConnectionError;
  InternalServerError: typeof import('@anthropic-ai/sdk').InternalServerError;
  BadRequestError: typeof import('@anthropic-ai/sdk').BadRequestError;
  AuthenticationError: typeof import('@anthropic-ai/sdk').AuthenticationError;
  PermissionDeniedError: typeof import('@anthropic-ai/sdk').PermissionDeniedError;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * Per-1M-token USD prices. Sonnet 5 carries an intro price through
 * 2026-08-31 — see AI_ASSISTANT_IMPROVEMENT_PLAN.md §2.1 (C5) and §3.8. This
 * table is the one place that assumption lives; it stops applying itself the
 * day after, no code change needed, but the *numbers* it falls back to should
 * be re-checked against the current Anthropic price list when that happens.
 */
const SONNET_INTRO_PRICE = { input: 2, output: 10 };
const SONNET_STANDARD_PRICE = { input: 3, output: 15 };
const SONNET_INTRO_ENDS_UTC = Date.UTC(2026, 7, 31, 23, 59, 59, 999); // 2026-08-31 23:59:59 UTC

const PRICE_PER_MTOK: Record<ClaudeModel, { input: number; output: number }> = {
  [MODEL_HAIKU]: { input: 1, output: 5 },
  [MODEL_SONNET]: SONNET_STANDARD_PRICE,
};

function priceFor(model: ClaudeModel): { input: number; output: number } {
  if (model === MODEL_SONNET && Date.now() <= SONNET_INTRO_ENDS_UTC) {
    return SONNET_INTRO_PRICE;
  }
  return PRICE_PER_MTOK[model];
}

/**
 * Cost of one turn in USD, from the four separately-billed usage buckets the
 * API reports. Cache writes cost 1.25x the base input price; cache reads cost
 * 0.1x — see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.8.
 */
export function computeCostUsd(model: ClaudeModel, usage: UsageInfo): number {
  const price = priceFor(model);
  const inputCost =
    (usage.inputTokens * price.input +
      usage.cacheCreationTokens * price.input * 1.25 +
      usage.cacheReadTokens * price.input * 0.1) /
    1_000_000;
  const outputCost = (usage.outputTokens * price.output) / 1_000_000;
  return inputCost + outputCost;
}

export interface StructuredCompletionParams<T extends z.ZodTypeAny> {
  model: ClaudeModel;
  /**
   * Static instructions — schema descriptions, tool-use guidance, output
   * format rules. Cached via a single breakpoint so this cost is paid once per
   * TTL window, not once per request. Never put per-request data (today's
   * date, a form id, the user's question) in here.
   */
  system: string;
  /** The one thing that varies per call. Placed after the cache breakpoint. */
  userMessage: string;
  schema: T;
  maxTokens?: number;
}

export interface StructuredCompletionResult<T> {
  data: T;
  usage: UsageInfo;
}

export interface ChatTurnParams {
  model: ClaudeModel;
  /** Same caching contract as StructuredCompletionParams.system above. */
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
}

export interface ChatTurnResult {
  content: Anthropic.ContentBlock[];
  stopReason: Anthropic.Message['stop_reason'];
  usage: UsageInfo;
}

/**
 * Thin wrapper around the Anthropic SDK.
 *
 * Dynamic import + a boot-time-safe missing-key check, mirroring the defensive
 * pattern the old Gemini integration used (forms.service.ts): a server without
 * ANTHROPIC_API_KEY configured boots fine and fails a clear 400 only when an
 * AI feature is actually invoked, rather than crashing on startup.
 */
@Injectable()
export class ClaudeClientService {
  private readonly logger = new Logger(ClaudeClientService.name);
  private client: AnthropicClient | null = null;
  private errors: AnthropicErrorClasses | null = null;

  private async getClient(): Promise<AnthropicClient> {
    if (this.client) return this.client;

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException(
        'AI features are not configured on this server (missing ANTHROPIC_API_KEY).',
      );
    }

    const sdk = await import('@anthropic-ai/sdk');
    this.client = new sdk.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Cast through unknown: the dynamic import() above and the explicit
    // resolution-mode:'import' import type elsewhere resolve the SDK's
    // classes as nominally distinct types (see AnthropicClient above), even
    // though they're the same runtime module — TS type-checking artifact
    // only, `instanceof` below works against the real runtime classes.
    this.errors = sdk as unknown as AnthropicErrorClasses;
    return this.client;
  }

  /**
   * Maps a raw Anthropic SDK error to the right HTTP outcome instead of
   * collapsing everything to one 400 — see
   * AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.7 (R5). The raw error always goes to
   * the logger; user-facing copy stays plain and never repeats SDK/compiler
   * text.
   */
  private mapError(error: unknown): never {
    const errors = this.errors;
    this.logger.error('Claude request failed', error as Error);

    if (errors && error instanceof errors.RateLimitError) {
      throw new HttpException(
        'The AI assistant is getting a lot of requests right now — please try again in a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      errors &&
      (error instanceof errors.APIConnectionError ||
        error instanceof errors.InternalServerError)
    ) {
      throw new ServiceUnavailableException(
        'The AI assistant is temporarily unavailable — please try again shortly.',
      );
    }
    if (
      errors &&
      (error instanceof errors.AuthenticationError ||
        error instanceof errors.PermissionDeniedError)
    ) {
      throw new NotImplementedException(
        'AI features are not configured correctly on this server. An administrator needs to check the Anthropic API credentials.',
      );
    }
    if (errors && error instanceof errors.BadRequestError) {
      throw new UnprocessableEntityException(
        'The AI assistant could not process that request. Please try rephrasing it.',
      );
    }
    throw new BadRequestException(
      'Failed to complete the AI request. Please try again.',
    );
  }

  /**
   * One-shot structured completion: a static cached system prompt, one
   * user message, and a Zod-validated JSON result. This is the shape every
   * generative call in the assistant module should use.
   *
   * A `BadRequestError` here almost always means the model's output didn't
   * match the schema — worth one silent retry before surfacing it, since a
   * repair on the very next sample is common and cheap relative to failing
   * the user's request outright.
   */
  async structuredCompletion<T extends z.ZodTypeAny>(
    params: StructuredCompletionParams<T>,
  ): Promise<StructuredCompletionResult<z.infer<T>>> {
    try {
      return await this.runStructuredCompletion(params);
    } catch (error) {
      if (this.errors && error instanceof this.errors.BadRequestError) {
        this.logger.warn(
          'Structured completion schema mismatch — retrying once',
        );
        try {
          return await this.runStructuredCompletion(params);
        } catch (retryError) {
          this.mapError(retryError);
        }
      }
      this.mapError(error);
    }
  }

  private async runStructuredCompletion<T extends z.ZodTypeAny>(
    params: StructuredCompletionParams<T>,
  ): Promise<StructuredCompletionResult<z.infer<T>>> {
    const client = await this.getClient();
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');

    const response = await client.messages.parse({
      model: params.model,
      max_tokens: params.maxTokens ?? 8000,
      system: [
        {
          type: 'text',
          text: params.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: params.userMessage }],
      output_config: {
        format: zodOutputFormat(params.schema),
      },
    });

    if (response.parsed_output === null) {
      throw new BadRequestException(
        'The AI response did not match the expected format. Please try again.',
      );
    }

    return {
      data: response.parsed_output,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }

  /**
   * One turn of a tool-use conversation — the manual-loop shape: callers own
   * the `while (stop_reason === 'tool_use')` loop and their own tool
   * handlers, because those handlers need org-scoped Prisma access this
   * service shouldn't hold. Used by AgentLoopService.
   */
  async chatTurn(params: ChatTurnParams): Promise<ChatTurnResult> {
    try {
      const client = await this.getClient();
      const response = await client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        system: [
          {
            type: 'text',
            text: params.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: params.messages,
        tools: params.tools,
      });

      return {
        content: response.content,
        stopReason: response.stop_reason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        },
      };
    } catch (error) {
      this.mapError(error);
    }
  }
}
