import { describe, expect, it, vi } from "vitest";
import {
  type ExpressLikeRequest,
  type ExpressLikeResponse,
  FixedWindow,
  MemoryStore,
  RateLimiter,
  type Store,
  expressRateLimit,
} from "../src/index.js";
import { fakeClock } from "./helpers.js";

interface FakeRes extends ExpressLikeResponse {
  headers: Record<string, string | number>;
  body: string | undefined;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      res.headers[name] = value;
    },
    end(body) {
      res.body = body;
    },
  };
  return res;
}

function run<Req extends ExpressLikeRequest>(
  middleware: (req: Req, res: FakeRes, next: (e?: unknown) => void) => void,
  req: Req,
): Promise<{ res: FakeRes; nextCalls: unknown[][] }> {
  return new Promise((resolve) => {
    const res = fakeRes();
    const nextCalls: unknown[][] = [];
    const origEnd = res.end.bind(res);
    res.end = (body) => {
      origEnd(body);
      resolve({ res, nextCalls });
    };
    middleware(req, res, (...args) => {
      nextCalls.push(args);
      resolve({ res, nextCalls });
    });
  });
}

const limiterOf = (limit: number) => {
  const clock = fakeClock(250);
  return new RateLimiter({
    algorithm: new FixedWindow({ limit, windowMs: 1000 }),
    store: new MemoryStore({ clock }),
    clock,
  });
};

describe("expressRateLimit", () => {
  it("sets RateLimit-* headers and calls next when allowed", async () => {
    const mw = expressRateLimit(limiterOf(2));
    const { res, nextCalls } = await run(mw, { headers: {}, ip: "1.2.3.4" });
    expect(nextCalls).toEqual([[]]);
    expect(res.headers).toEqual({
      "RateLimit-Limit": "2",
      "RateLimit-Remaining": "1",
      "RateLimit-Reset": "1",
    });
    expect(res.statusCode).toBe(200);
  });

  it("responds 429 with Retry-After once the limit is hit", async () => {
    const mw = expressRateLimit(limiterOf(1));
    const req = { headers: {}, ip: "1.2.3.4" };
    await run(mw, req);
    const { res, nextCalls } = await run(mw, req);
    expect(nextCalls).toEqual([]);
    expect(res.statusCode).toBe(429);
    expect(res.headers).toMatchObject({
      "RateLimit-Remaining": "0",
      "Retry-After": "1",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(res.body ?? "")).toEqual({ error: "Too Many Requests" });
  });

  it("keys by x-forwarded-for, then req.ip, then socket address", async () => {
    const limiter = limiterOf(1);
    const mw = expressRateLimit(limiter);
    await run(mw, { headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" }, ip: "9.9.9.9" });
    await run(mw, { headers: { "x-forwarded-for": ["10.0.0.3"] } });
    await run(mw, { headers: {}, socket: { remoteAddress: "10.0.0.4" } });
    await expect(limiter.peek("10.0.0.1")).resolves.toMatchObject({ remaining: 0 });
    await expect(limiter.peek("10.0.0.3")).resolves.toMatchObject({ remaining: 0 });
    await expect(limiter.peek("10.0.0.4")).resolves.toMatchObject({ remaining: 0 });
    await expect(limiter.peek("9.9.9.9")).resolves.toMatchObject({ remaining: 1 });
  });

  it("supports a custom key function, weighted cost and a custom 429 handler", async () => {
    interface Req extends ExpressLikeRequest {
      user: string;
    }
    const limiter = limiterOf(3);
    const onLimited = vi.fn((_req: Req, res: FakeRes) => {
      res.statusCode = 503;
      res.end("slow down");
    });
    const mw = expressRateLimit<Req, FakeRes>(limiter, {
      keyFn: (req) => Promise.resolve(`user:${req.user}`),
      cost: (req) => (req.user === "heavy" ? 3 : 1),
      onLimited,
    });
    await run(mw, { headers: {}, user: "heavy" });
    const { res } = await run(mw, { headers: {}, user: "heavy" });
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe("slow down");
    expect(res.headers["Retry-After"]).toBe("1");
    expect(onLimited).toHaveBeenCalledOnce();
    await expect(limiter.peek("user:heavy")).resolves.toMatchObject({ remaining: 0 });
  });

  it("accepts a numeric cost and can suppress headers on allowed responses", async () => {
    const mw = expressRateLimit(limiterOf(5), { cost: 2, headers: false });
    const { res } = await run(mw, { headers: {}, ip: "1.1.1.1" });
    expect(res.headers).toEqual({});
    const { res: second } = await run(mw, { headers: {}, ip: "1.1.1.1" });
    expect(second.headers).toEqual({});
    const { res: third } = await run(mw, { headers: {}, ip: "1.1.1.1" });
    expect(third.statusCode).toBe(429);
    expect(third.headers["Retry-After"]).toBe("1");
  });

  it("fails open by default when the store throws, or forwards the error", async () => {
    const broken: Store = {
      get: () => Promise.reject(new Error("down")),
      update: () => Promise.reject(new Error("down")),
      delete: () => Promise.resolve(),
    };
    const limiter = new RateLimiter({
      algorithm: new FixedWindow({ limit: 1, windowMs: 1000 }),
      store: broken,
    });
    const open = await run(expressRateLimit(limiter), { headers: {} });
    expect(open.nextCalls).toEqual([[]]);
    const closed = await run(expressRateLimit(limiter, { failOpen: false }), { headers: {} });
    expect(closed.nextCalls).toHaveLength(1);
    expect(closed.nextCalls[0]?.[0]).toBeInstanceOf(Error);
  });
});
