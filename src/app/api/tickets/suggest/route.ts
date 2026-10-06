import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { getSettings } from "@/lib/settings";
import { chatConfig, isConfigured } from "@/lib/ai/config";
import { chatCompletion } from "@/lib/ai/provider";
import { titleFrom } from "@/lib/tickets/service";
import { logger } from "@/lib/logger";

// no AI or an error: use the first line
export const POST = withAuth("tickets:create", async (request: NextRequest) => {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.slice(0, 4000) : "";
  const fallback = { title: titleFrom(text), category: "" };
  if (!text.trim()) return NextResponse.json(fallback);

  try {
    const ai = chatConfig(await getSettings());
    if (!isConfigured(ai)) return NextResponse.json(fallback);
    const res = await chatCompletion(ai, {
      messages: [
        {
          role: "system",
          content:
            'You file support issues. Reply with JSON only: {"title": "<short title, max 70 chars, same language as the issue>", "category": "<one or two words>"}',
        },
        { role: "user", content: text },
      ],
      maxTokens: 120,
      temperature: 0,
    });
    const raw = res.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { title?: unknown; category?: unknown };
    return NextResponse.json({
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 120) : fallback.title,
      category: typeof parsed.category === "string" ? parsed.category.trim().slice(0, 60) : "",
    });
  } catch (error) {
    logger.warn("ticket suggestion failed, using the first line", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(fallback);
  }
});
