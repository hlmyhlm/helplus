import { describe, it, expect, vi, beforeEach } from "vitest";
import { chatCompletion } from "@/lib/ai/provider";
import { getSettings } from "@/lib/settings";
import { tidyIssues, sameProblem } from "@/lib/imports/ai-tidy";

vi.mock("@/lib/settings", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  chatCompletion: vi.fn(),
}));

const configured = { aiProvider: "openai", aiModel: "m", aiApiKey: "k", aiBaseUrl: "" };
const reply = (content: string) => ({ choices: [{ message: { content } }] }) as never;

beforeEach(() => {
  vi.mocked(getSettings).mockReset().mockResolvedValue(configured as never);
  vi.mocked(chatCompletion).mockReset();
});

const issues = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, text: `problem ${i}` }));

describe("tidyIssues", () => {
  it("returns nothing when AI isn't set up", async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...configured, aiApiKey: "" } as never);
    const res = await tidyIssues(issues(3));
    expect(res.size).toBe(0);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("sends batches of 10", async () => {
    vi.mocked(chatCompletion).mockImplementation(async (_cfg, opts) => {
      const keys = [...String(opts.messages.at(-1)!.content).matchAll(/"key":"(k\d+)"/g)].map((m) => m[1]);
      return reply(JSON.stringify(keys.map((key) => ({ key, title: `T ${key}`, category: "Login" }))));
    });
    const res = await tidyIssues(issues(23));
    expect(chatCompletion).toHaveBeenCalledTimes(3);
    expect(res.size).toBe(23);
    expect(res.get("k22")).toEqual({ title: "T k22", category: "Login" });
  });

  it("masks ICs before sending", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(reply("[]"));
    await tidyIssues([{ key: "a", text: "IC 900101-14-5678" }]);
    const sent = JSON.stringify(vi.mocked(chatCompletion).mock.calls[0][1].messages);
    expect(sent).not.toContain("900101");
  });

  it("skips a batch with bad JSON and keeps the rest", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce(reply("sorry, I can't"))
      .mockResolvedValueOnce(reply('```json\n[{"key":"k10","title":"Ok","category":"Billing"}]\n```'));
    const res = await tidyIssues(issues(11));
    expect([...res.keys()]).toEqual(["k10"]);
  });

  it("keeps what it has when a call throws", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce(reply('[{"key":"k0","title":"First","category":"A"}]'))
      .mockRejectedValueOnce(new Error("down"));
    const res = await tidyIssues(issues(15));
    expect([...res.keys()]).toEqual(["k0"]);
  });

  it("cuts long titles to 70 characters", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(reply(JSON.stringify([{ key: "k0", title: "x".repeat(100), category: "A" }])));
    const res = await tidyIssues(issues(1));
    expect(res.get("k0")!.title).toHaveLength(70);
  });
});

describe("sameProblem", () => {
  it("is false when AI isn't set up", async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...configured, aiApiKey: "" } as never);
    expect(await sameProblem("a", "b")).toBe(false);
  });

  it("follows the answer", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(reply("yes"));
    expect(await sameProblem("a", "b")).toBe(true);
    vi.mocked(chatCompletion).mockResolvedValue(reply("no"));
    expect(await sameProblem("a", "b")).toBe(false);
  });

  it("is false on an error", async () => {
    vi.mocked(chatCompletion).mockRejectedValue(new Error("down"));
    expect(await sameProblem("a", "b")).toBe(false);
  });
});
