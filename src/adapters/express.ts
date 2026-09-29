import { type RateLimiter } from "../rate-limiter.js";
import { type RateLimitResult } from "../types.js";
import { TOO_MANY_REQUESTS_BODY, clientIp, rateLimitHeaders } from "./shared.js";

/** The parts of an Express/Node request this adapter reads. */
export interface ExpressLikeRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

/** The parts of an Express/Node response this adapter writes. */
export interface ExpressLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string | number): unknown;
  end(body?: string): unknown;
}

export type NextFunction = (error?: unknown) => void;

export interface ExpressRateLimitOptions<
  Req extends ExpressLikeRequest,
  Res extends ExpressLikeResponse,
> {
  /** Derives the limiter key. Defaults to the client IP (`x-forwarded-for` first hop, then `req.ip`). */
  readonly keyFn?: (req: Req) => string | Promise<string>;
  /** Cost per request; a function can weight expensive routes. Defaults to `1`. */
  readonly cost?: number | ((req: Req) => number);
  /** Custom 429 handler. Headers are already set when it runs. */
  readonly onLimited?: (req: Req, res: Res, result: RateLimitResult) => unknown;
  /** Attach `RateLimit-*` headers to allowed responses too. Defaults to `true`. */
  readonly headers?: boolean;
  /** If the store throws, let the request through (`true`, default) or forward the error to `next`. */
  readonly failOpen?: boolean;
}

/**
 * Express-style middleware. Works with plain `http` handlers too, since it only
 * touches `statusCode`, `setHeader` and `end`.
 */
export function expressRateLimit<
  Req extends ExpressLikeRequest = ExpressLikeRequest,
  Res extends ExpressLikeResponse = ExpressLikeResponse,
>(
  limiter: RateLimiter,
  options: ExpressRateLimitOptions<Req, Res> = {},
): (req: Req, res: Res, next: NextFunction) => void {
  const keyFn = options.keyFn ?? defaultExpressKey;
  const sendHeaders = options.headers ?? true;
  const failOpen = options.failOpen ?? true;

  return (req, res, next) => {
    void (async () => {
      let result: RateLimitResult;
      try {
        const key = await keyFn(req);
        const cost = typeof options.cost === "function" ? options.cost(req) : (options.cost ?? 1);
        result = await limiter.check(key, cost);
      } catch (error) {
        if (failOpen) next();
        else next(error);
        return;
      }

      if (sendHeaders || !result.allowed) {
        for (const [name, value] of Object.entries(rateLimitHeaders(result))) {
          res.setHeader(name, value);
        }
      }

      if (result.allowed) {
        next();
        return;
      }

      if (options.onLimited !== undefined) {
        options.onLimited(req, res, result);
        return;
      }
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json");
      res.end(TOO_MANY_REQUESTS_BODY);
    })();
  };
}

function defaultExpressKey(req: ExpressLikeRequest): string {
  return clientIp((name) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }, req.ip ?? req.socket?.remoteAddress);
}
