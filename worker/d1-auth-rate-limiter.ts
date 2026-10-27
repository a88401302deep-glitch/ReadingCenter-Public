import type { LoginRateLimiter } from '../src/server/auth'
import type { D1Database } from './cloudflare-types'

interface RateLimitRow {
  window_started_at: number
  failed_attempts: number
  blocked_until: number | null
}

const defaultMaximumAttempts = 5
const defaultWindowMilliseconds = 15 * 60 * 1000
const defaultBlockMilliseconds = 15 * 60 * 1000

export class D1AuthRateLimiter implements LoginRateLimiter {
  constructor(
    private readonly database: D1Database,
    private readonly maximumAttempts = defaultMaximumAttempts,
    private readonly windowMilliseconds = defaultWindowMilliseconds,
    private readonly blockMilliseconds = defaultBlockMilliseconds
  ) {}

  async check(clientKey: string, now: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const row = await this.database.prepare(
      'SELECT window_started_at, failed_attempts, blocked_until FROM auth_rate_limits WHERE client_key = ?'
    ).bind(clientKey).first<RateLimitRow>()

    if (!row || now - row.window_started_at >= this.windowMilliseconds) {
      return { allowed: true, retryAfterSeconds: 0 }
    }

    const retryAt = row.blocked_until ?? row.window_started_at + this.windowMilliseconds
    if (row.failed_attempts < this.maximumAttempts || retryAt <= now) {
      return { allowed: true, retryAfterSeconds: 0 }
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000))
    }
  }

  async recordFailure(clientKey: string, now: number): Promise<void> {
    await this.database.prepare(`
      INSERT INTO auth_rate_limits (client_key, window_started_at, failed_attempts, blocked_until)
      VALUES (?, ?, 1, NULL)
      ON CONFLICT(client_key) DO UPDATE SET
        window_started_at = CASE
          WHEN excluded.window_started_at - auth_rate_limits.window_started_at >= ?
            THEN excluded.window_started_at
          ELSE auth_rate_limits.window_started_at
        END,
        failed_attempts = CASE
          WHEN excluded.window_started_at - auth_rate_limits.window_started_at >= ? THEN 1
          ELSE auth_rate_limits.failed_attempts + 1
        END,
        blocked_until = CASE
          WHEN excluded.window_started_at - auth_rate_limits.window_started_at >= ? THEN NULL
          WHEN auth_rate_limits.failed_attempts + 1 >= ?
            THEN excluded.window_started_at + ?
          ELSE auth_rate_limits.blocked_until
        END
    `).bind(
      clientKey,
      now,
      this.windowMilliseconds,
      this.windowMilliseconds,
      this.windowMilliseconds,
      this.maximumAttempts,
      this.blockMilliseconds
    ).run()
  }

  async reset(clientKey: string): Promise<void> {
    await this.database.prepare('DELETE FROM auth_rate_limits WHERE client_key = ?').bind(clientKey).run()
  }
}
