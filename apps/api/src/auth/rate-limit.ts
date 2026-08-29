export interface LoginRateLimitConfig {
  windowMs: number;
  perIp: number;
  perAccount: number;
  global: number;
  maxEntries: number;
}

export const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimitConfig = {
  windowMs: 60_000,
  perIp: 20,
  perAccount: 10,
  global: 100,
  maxEntries: 10_000,
};

type Clock = () => number;

// Rate-limit windows and Retry-After are relative durations. A monotonic clock
// keeps them correct across wall-clock steps (NTP corrections), which would
// otherwise extend windows backward or silently drop limiting forward.
function monotonicClockMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}
type Bucket = { count: number; resetAt: number; lastSeen: number };

export type LoginRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  limitedBy?: "ip" | "account" | "global";
};

export function normalizeLoginAccount(value: string): string {
  return value.trim();
}

export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly config: LoginRateLimitConfig;
  private readonly clock: Clock;

  constructor(config: Partial<LoginRateLimitConfig> = {}, clock: Clock = monotonicClockMs) {
    this.config = { ...DEFAULT_LOGIN_RATE_LIMIT, ...config };
    if (this.config.windowMs <= 0 || this.config.perIp <= 0 || this.config.perAccount <= 0 || this.config.global <= 0 || this.config.maxEntries < 3) {
      throw new Error("Login rate-limit configuration is invalid.");
    }
    this.clock = clock;
  }

  consume(ipAddress: string | null, account: string): LoginRateLimitResult {
    const now = this.clock();
    this.prune(now);
    const keys: Array<[string, number, "ip" | "account" | "global"]> = [
      [`ip:${ipAddress ?? "unknown"}`, this.config.perIp, "ip"],
      [`account:${normalizeLoginAccount(account)}`, this.config.perAccount, "account"],
      ["global", this.config.global, "global"],
    ];
    let limitedBy: LoginRateLimitResult["limitedBy"];
    let retryAt = now + this.config.windowMs;
    for (const [key, threshold, dimension] of keys) {
      const bucket = this.bucket(key, now);
      if (bucket.count >= threshold) {
        limitedBy ??= dimension;
        retryAt = Math.max(retryAt, bucket.resetAt);
      }
    }
    if (limitedBy) return { allowed: false, limitedBy, retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
    for (const [key] of keys) this.bucket(key, now).count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  resetAccount(account: string): void {
    this.buckets.delete(`account:${normalizeLoginAccount(account)}`);
  }

  get size(): number {
    return this.buckets.size;
  }

  private bucket(key: string, now: number): Bucket {
    let value = this.buckets.get(key);
    if (!value || value.resetAt <= now) {
      if (value) this.buckets.delete(key);
      this.evictIfNeeded();
      value = { count: 0, resetAt: now + this.config.windowMs, lastSeen: now };
      this.buckets.set(key, value);
    }
    value.lastSeen = now;
    return value;
  }

  private prune(now: number): void {
    for (const [key, value] of this.buckets) if (value.resetAt <= now) this.buckets.delete(key);
  }

  private evictIfNeeded(): void {
    while (this.buckets.size >= this.config.maxEntries) {
      const oldest = [...this.buckets.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen).find(([key]) => key !== "global");
      if (!oldest) return;
      this.buckets.delete(oldest[0]);
    }
  }
}
