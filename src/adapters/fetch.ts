import { type RateLimiter } from "../rate-limiter.js";
import { type RateLimitResult } from "../types.js";
import { TOO_MANY_REQUESTS_BODY, clientIp, rateLimitHeaders } from "./shared.js";

export type FetchHandler<Args extends unknown[] = unknown[]> = (
  request: Request,
  ...args: Args
) => Response | Promise<Response>;

export interface FetchRateLimitOptions {
  /** Derives the limiter key. Defaults to the client IP from proxy headers. */
  readonly keyFn?: (request: Request) => string | Promise<string>;
  /** Cost per request. Defaults to `1`. */
  readonly cost?: number | ((request: Request) => number);
  /** Custom 429 response. Standard headers are merged in afterwards. */
  readonly onLimited?: (request: Request, result: RateLimitResult) => Response | Promise<Response>;
  /** Attach `RateLimit-*` headers to allowed responses too. Defaults to `true`. */
  readonly headers?: boolean;
  /** If the store throws, run the handler anyway (`true`, default) or rethrow. */
  readonly failOpen?: boolean;
}

/**
 * Wraps a Fetch-API handler (Cloudflare Workers, Bun, Deno, Next.js route
 * handlers). Extra arguments such as `env` and `ctx` are passed through.
 *
 * ```ts
 * export default { fetch: fetchRateLimit(limiter)(async (req, env, ctx) => new Response("ok")) };
 * ```
 */
export function fetchRateLimit(
  limiter: RateLimiter,
  options: FetchRateLimitOptions = {},
): <Args extends unknown[]>(handler: FetchHandler<Args>) => FetchHandler<Args> {
  const keyFn = options.keyFn ?? defaultFetchKey;
  const sendHeaders = options.headers ?? true;
  const failOpen = options.failOpen ?? true;

  return (handler) =>
    async (request, ...args) => {
      let result: RateLimitResult;
      try {
        const key = await keyFn(request);
        const cost =
          typeof options.cost === "function" ? options.cost(request) : (options.cost ?? 1);
        result = await limiter.check(key, cost);
      } catch (error) {
        if (failOpen) return handler(request, ...args);
        throw error;
      }

      if (!result.allowed) {
        const denied =
          options.onLimited !== undefined
            ? await options.onLimited(request, result)
            : new Response(TOO_MANY_REQUESTS_BODY, {
                status: 429,
                headers: { "Content-Type": "application/json" },
              });
        return withHeaders(denied, result);
      }

      const response = await handler(request, ...args);
      return sendHeaders ? withHeaders(response, result) : response;
    };
}

/** Returns a copy of `response` with rate-limit headers applied (originals may be immutable). */
function withHeaders(response: Response, result: RateLimitResult): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(rateLimitHeaders(result))) {
    copy.headers.set(name, value);
  }
  return copy;
}

function defaultFetchKey(request: Request): string {
  return clientIp((name) => request.headers.get(name) ?? undefined);
}
