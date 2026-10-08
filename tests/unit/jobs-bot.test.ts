import { describe, it, expect, vi } from "vitest";
import { runBotIntake, cleanBotInbound } from "@/lib/bot/intake";
import { logger } from "@/lib/logger";
import { runBot } from "@/lib/jobs/bot";

vi.mock("@/lib/bot/intake", () => ({ runBotIntake: vi.fn(), cleanBotInbound: vi.fn() }));

describe("runBot", () => {
  it("still cleans up when intake fails, and logs each failure", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.mocked(runBotIntake).mockRejectedValueOnce(new Error("intake down"));
    vi.mocked(cleanBotInbound).mockRejectedValueOnce(new Error("clean down"));
    await expect(runBot(new Date())).resolves.toBeUndefined();
    expect(cleanBotInbound).toHaveBeenCalled();
    expect(error.mock.calls.map((c) => (c[1] as Error).message)).toEqual(["intake down", "clean down"]);
  });
});
