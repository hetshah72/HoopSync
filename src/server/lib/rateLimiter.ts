import "server-only";
import { RateLimitError } from "@/server/errors";

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory fixed-window limiter (implementation-plan.md §6: "a
 * simple per-user limiter (in-memory for dev)"). Coach chat calls a metered
 * LLM API per message, so an MVP cap on cost exposure is needed from day
 * one - a durable/shared limiter (Upstash Redis) is a Phase-2 infra swap,
 * not a change to call sites, since this resets on every server restart and
 * doesn't share state across instances.
 */
const windows = new Map<string, Window>();

export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
    throw new RateLimitError(
      `You're sending messages too quickly - try again in ${retryAfterSeconds}s.`,
    );
  }

  existing.count += 1;
}
