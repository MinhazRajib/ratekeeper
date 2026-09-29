import { describe, expect, it } from "vitest";
import { KeyedMutex } from "../src/index.js";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("KeyedMutex", () => {
  it("runs tasks for the same key strictly in order", async () => {
    const m = new KeyedMutex();
    const order: number[] = [];
    const tasks = [3, 1, 2].map((delay, i) =>
      m.run("k", async () => {
        await new Promise((r) => setTimeout(r, delay));
        order.push(i);
      }),
    );
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2]);
  });

  it("does not serialize different keys", async () => {
    const m = new KeyedMutex();
    let aStarted = false;
    let bStartedWhileABlocked = false;
    const a = m.run("a", async () => {
      aStarted = true;
      await tick();
      await tick();
    });
    const b = m.run("b", () => {
      bStartedWhileABlocked = aStarted;
    });
    await Promise.all([a, b]);
    expect(bStartedWhileABlocked).toBe(true);
  });

  it("keeps the chain alive after a failed task and propagates the error", async () => {
    const m = new KeyedMutex();
    const failing = m.run("k", () => {
      throw new Error("boom");
    });
    const next = m.run("k", () => "ok");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });

  it("forgets idle keys", async () => {
    const m = new KeyedMutex();
    await m.run("k", () => 1);
    await tick();
    expect(m.size).toBe(0);
  });
});
