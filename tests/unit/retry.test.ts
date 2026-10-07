import { describe, expect, it, vi } from "vitest";

import { withTransactionRetry } from "@/server/db/retry";

const deadlock = new Error("query failed", { cause: { code: "40P01" } });
const exclusion = new Error("query failed", { cause: { code: "23P01" } });

describe("withTransactionRetry", () => {
  it("retries deadlocks until the operation succeeds", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(deadlock)
      .mockRejectedValueOnce(deadlock)
      .mockResolvedValue("ok");

    await expect(withTransactionRetry(fn, { baseDelayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry business errors such as an overlapping booking", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(exclusion);

    await expect(withTransactionRetry(fn, { baseDelayMs: 0 })).rejects.toBe(exclusion);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured number of attempts", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(deadlock);

    await expect(withTransactionRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toBe(deadlock);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
