import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../../common/infra/redis/redis.service';
import { ORG_SYSTEM_PROMPT } from './system-prompts';

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
/** Changes whenever the inlined help corpus (or anything else in the system prompt) changes, so every cached entry invalidates itself without a manual version bump. */
const CORPUS_VERSION = createHash('sha256')
  .update(ORG_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 12);

/**
 * Help-corpus answer cache — AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.8 and §6
 * decision 4 (platform-wide, not per-org). Safe to share across every org
 * only because agent-loop.service.ts only ever writes to this cache for a
 * turn that called no tool at all — by construction, an answer built purely
 * from the static corpus in ORG_SYSTEM_PROMPT, containing no org data.
 * org-chat.ts is the one place that decides a turn is eligible (no
 * currentFormId hint) and computes the key; this service knows nothing about
 * that decision, only normalization and storage.
 */
@Injectable()
export class FaqCacheService {
  constructor(private readonly redis: RedisService) {}

  buildKey(question: string, modeHint: string | undefined): string {
    const normalized = question.trim().toLowerCase().replace(/\s+/g, ' ');
    const hash = createHash('sha256')
      .update(`${normalized}|${modeHint ?? ''}`)
      .digest('hex');
    return `assistant:faq:${CORPUS_VERSION}:${hash}`;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, reply: string): Promise<void> {
    await this.redis.set(key, reply, TTL_SECONDS);
  }
}
