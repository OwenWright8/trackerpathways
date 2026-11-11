import { NextResponse } from "next/server";
import rawData from "@/data/trackers.json";
import { DataStructure } from "@/types";
import { createRouteSearcher } from "@/lib/routeSearch";

const data = rawData as unknown as DataStructure;
const MAX_API_JUMPS = 8;
const MAX_API_DAYS = 3650;
const MAX_QUERY_LENGTH = 256;
const MAX_SOURCE_ITEMS = 16;
const MAX_SOURCE_ITEM_LENGTH = 64;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_BUCKETS = 5000;

// Self-hosted default: no rate limit. The web UI searches in the browser and
// never calls this endpoint; set RATE_LIMIT_PER_MINUTE to cap scripted callers.
const parsedRateLimit = Number.parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? "0", 10);
const RATE_LIMIT_MAX_REQUESTS = Number.isFinite(parsedRateLimit) && parsedRateLimit > 0 ? parsedRateLimit : 0;
const rateLimitEnabled = RATE_LIMIT_MAX_REQUESTS > 0;

const searchRoutes = createRouteSearcher(data);

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

const parseAndValidatePositiveInt = (
  rawValue: string | null,
  fallback: number,
  min: number,
  max: number
): number | null => {
  if (!rawValue) {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue)) {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
};

const getClientIdentifier = (request: Request): string => {
  if (process.env.TRUSTED_PROXY_HEADERS === "true") {
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) {
      const firstIp = forwardedFor.split(",")[0]?.trim();
      if (firstIp && firstIp.length <= 64) {
        return firstIp;
      }
    }

    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp && realIp.length <= 64) {
      return realIp;
    }

    const connectingIp = request.headers.get("cf-connecting-ip")?.trim();
    if (connectingIp && connectingIp.length <= 64) {
      return connectingIp;
    }
  }

  return "direct-client";
};

const pruneExpiredRateLimitBuckets = (now: number) => {
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
};

const consumeRateLimit = (clientKey: string, now: number): RateLimitResult => {
  pruneExpiredRateLimitBuckets(now);

  const existingBucket = rateLimitBuckets.get(clientKey);
  if (!existingBucket || existingBucket.resetAt <= now) {
    if (rateLimitBuckets.size >= RATE_LIMIT_MAX_BUCKETS) {
      const oldestKey = rateLimitBuckets.keys().next().value;
      if (oldestKey) {
        rateLimitBuckets.delete(oldestKey);
      }
    }

    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitBuckets.set(clientKey, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetAt,
    };
  }

  if (existingBucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existingBucket.resetAt,
    };
  }

  existingBucket.count += 1;
  rateLimitBuckets.set(clientKey, existingBucket);
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - existingBucket.count,
    resetAt: existingBucket.resetAt,
  };
};

const buildRateLimitHeaders = (rateLimit: RateLimitResult): Record<string, string> => rateLimitEnabled
  ? {
    "X-RateLimit-Limit": RATE_LIMIT_MAX_REQUESTS.toString(),
    "X-RateLimit-Remaining": rateLimit.remaining.toString(),
    "X-RateLimit-Reset": Math.ceil(rateLimit.resetAt / 1000).toString(),
  }
  : {};

const buildRateLimitExceededHeaders = (rateLimit: RateLimitResult, now: number) => ({
  ...buildRateLimitHeaders(rateLimit),
  "Retry-After": Math.max(1, Math.ceil((rateLimit.resetAt - now) / 1000)).toString(),
});

export async function GET(request: Request) {
  const now = Date.now();
  const rateLimit: RateLimitResult = rateLimitEnabled
    ? consumeRateLimit(getClientIdentifier(request), now)
    : { allowed: true, remaining: 0, resetAt: now };
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: buildRateLimitExceededHeaders(rateLimit, now) }
    );
  }

  const { searchParams } = new URL(request.url);
  const sourceRaw = searchParams.get("source") || "";
  const targetRaw = searchParams.get("target") || "";
  const maxJumpsRaw = searchParams.get("jumps");
  const maxJumps = parseAndValidatePositiveInt(maxJumpsRaw, 1, 1, MAX_API_JUMPS);
  const maxDaysStr = searchParams.get("days");
  const maxDays = maxDaysStr
    ? parseAndValidatePositiveInt(maxDaysStr, 1, 1, MAX_API_DAYS)
    : null;

  if (sourceRaw.length > MAX_QUERY_LENGTH || targetRaw.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `source and target must be at most ${MAX_QUERY_LENGTH} characters.` },
      { status: 400, headers: buildRateLimitHeaders(rateLimit) }
    );
  }

  if (maxJumps === null) {
    return NextResponse.json(
      { error: `Invalid jumps value. Use an integer between 1 and ${MAX_API_JUMPS}.` },
      { status: 400, headers: buildRateLimitHeaders(rateLimit) }
    );
  }

  if (maxDaysStr && maxDays === null) {
    return NextResponse.json(
      { error: `Invalid days value. Use an integer between 1 and ${MAX_API_DAYS}.` },
      { status: 400, headers: buildRateLimitHeaders(rateLimit) }
    );
  }

  const sQueryRaw = sourceRaw.toLowerCase().trim();
  const sourceInputs = sQueryRaw
    ? Array.from(new Set(sQueryRaw.split(",").map((source) => source.trim()).filter(Boolean)))
    : [];
  const tQuery = targetRaw.toLowerCase().trim();

  if (
    sourceInputs.length > MAX_SOURCE_ITEMS ||
    sourceInputs.some((source) => source.length > MAX_SOURCE_ITEM_LENGTH) ||
    tQuery.length > MAX_SOURCE_ITEM_LENGTH
  ) {
    return NextResponse.json(
      { error: `Search terms must contain at most ${MAX_SOURCE_ITEMS} sources and ${MAX_SOURCE_ITEM_LENGTH} characters per term.` },
      { status: 400, headers: buildRateLimitHeaders(rateLimit) }
    );
  }

  if (!sQueryRaw && !tQuery) {
    return NextResponse.json([], { headers: buildRateLimitHeaders(rateLimit) });
  }

  const results = searchRoutes({
    source: sourceRaw,
    target: targetRaw,
    maxJumps,
    maxDays,
  });

  return NextResponse.json(results, {
    headers: {
      "Cache-Control": "private, no-store",
      ...buildRateLimitHeaders(rateLimit),
    },
  });
}
