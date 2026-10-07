import { getSettings } from "@/lib/settings";
import { chatConfig, isConfigured } from "@/lib/ai/config";
import { chatCompletion, type ProviderConfig } from "@/lib/ai/provider";
import { maskIC } from "@/lib/privacy/ic-mask";
import { logger } from "@/lib/logger";

const BATCH = 10;
const MAX_TEXT = 1000;

async function aiConfig(): Promise<ProviderConfig | null> {
  const cfg = chatConfig(await getSettings());
  return isConfigured(cfg) ? cfg : null;
}

export async function aiReady(): Promise<boolean> {
  return (await aiConfig()) !== null;
}

const clean = (s: string) => maskIC(s).text.slice(0, MAX_TEXT);

// models often wrap json in a code fence, take the array out of whatever came back
function parseList(content: string): unknown[] | null {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function tidyIssues(
  issues: { key: string; text: string }[]
): Promise<Map<string, { title: string; category: string }>> {
  const out = new Map<string, { title: string; category: string }>();
  try {
    const cfg = await aiConfig();
    if (!cfg) return out;
    const wanted = new Set(issues.map((i) => i.key));
    for (let i = 0; i < issues.length; i += BATCH) {
      const batch = issues.slice(i, i + BATCH).map((x) => ({ key: x.key, text: clean(x.text) }));
      const res = await chatCompletion(cfg, {
        messages: [
          {
            role: "system",
            content:
              'You label helpdesk issues. Reply with only a JSON array [{"key","title","category"}]. ' +
              "The title is 70 characters or fewer, in the same language as the issue. The category is one or two words.",
          },
          { role: "user", content: JSON.stringify(batch) },
        ],
        maxTokens: 1500,
        temperature: 0,
      });
      const list = parseList(res.choices[0]?.message?.content ?? "");
      for (const item of list ?? []) {
        const { key, title, category } = (item ?? {}) as Record<string, unknown>;
        if (typeof key !== "string" || !wanted.has(key) || typeof title !== "string" || !title.trim()) continue;
        out.set(key, {
          title: maskIC(title.trim()).text.slice(0, 70),
          category: typeof category === "string" ? maskIC(category.trim()).text.slice(0, 40) : "",
        });
      }
    }
  } catch (error) {
    logger.warn("ai tidy stopped early", { error: error instanceof Error ? error.message : String(error) });
  }
  return out;
}

export async function sameProblem(a: string, b: string): Promise<boolean> {
  try {
    const cfg = await aiConfig();
    if (!cfg) return false;
    const res = await chatCompletion(cfg, {
      messages: [
        { role: "system", content: "Two messages from the same customer. Answer only yes or no: are they about the same problem?" },
        { role: "user", content: `First:\n${clean(a)}\n\nSecond:\n${clean(b)}` },
      ],
      maxTokens: 5,
      temperature: 0,
    });
    return /^\s*yes/i.test(res.choices[0]?.message?.content ?? "");
  } catch {
    return false;
  }
}
