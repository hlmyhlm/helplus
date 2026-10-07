import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { chatCompletion } from "@/lib/ai/provider";
import { chatConfig, isConfigured } from "@/lib/ai/config";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";

export const POST = withAuth(
  "knowledge:read",
  async (request: NextRequest, _auth) => {
    try {
      const body = await request.json();
      const { question } = body;

      if (!question || typeof question !== "string" || question.trim().length === 0) {
        return NextResponse.json(
          { error: "Question is required" },
          { status: 400 }
        );
      }

      // Load settings for AI configuration
      const settings = await getSettings();

      const ai = chatConfig(settings);
      if (!isConfigured(ai)) {
        return NextResponse.json(
          { error: "AI API key is not configured. Please configure it in Settings." },
          { status: 400 }
        );
      }

      // Load all active knowledge entries
      const entries = await prisma.knowledgeEntry.findMany({
        where: { isActive: true, status: "approved" },
        include: {
          category: {
            select: { id: true, name: true, color: true },
          },
        },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      });

      if (entries.length === 0) {
        return NextResponse.json(
          { error: "No active knowledge base entries found. Add entries first." },
          { status: 400 }
        );
      }

      // Build knowledge context
      const knowledgeContext = entries
        .map(
          (entry, index) =>
            `[Entry ${index + 1}] Category: ${entry.category.name} | Title: ${entry.title}\n${entry.content}`
        )
        .join("\n\n---\n\n");

      const systemPrompt = `You are a knowledge base testing assistant. You have access to the following knowledge base entries. Answer the user's question using ONLY the information provided below. If the answer is not in the knowledge base, say so clearly.

  After your answer, list which knowledge base entries were most relevant to your answer by referencing their entry numbers and titles.

  ## Knowledge Base

  ${knowledgeContext}

  ## Response Format
  Provide your answer first, then on a new line write "---SOURCES---" followed by a JSON array of the entry numbers (1-based) that were most relevant. Example:
  Your answer here...
  ---SOURCES---
  [1, 3, 5]`;

      const completion = await chatCompletion(
        { ...ai, model: ai.model || "gpt-4o-mini" },
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question.trim() },
          ],
          maxTokens: settings.maxTokens || 2048,
          temperature: settings.temperature ?? 0.7,
        }
      );

      const responseText = completion.choices[0]?.message?.content || "";

      // Parse sources from response
      let answer = responseText;
      let sourceIndices: number[] = [];

      const sourcesSplit = responseText.split("---SOURCES---");
      if (sourcesSplit.length > 1) {
        answer = sourcesSplit[0].trim();
        try {
          const parsed = JSON.parse(sourcesSplit[1].trim());
          if (Array.isArray(parsed)) {
            sourceIndices = parsed.filter(
              (n: unknown) => typeof n === "number" && n >= 1 && n <= entries.length
            );
          }
        } catch {
          // If parsing fails, no sources to show
        }
      }

      // Map source indices to actual entries
      const sources = sourceIndices.map((idx) => {
        const entry = entries[idx - 1];
        return {
          id: entry.id,
          title: entry.title,
          category: entry.category.name,
          categoryColor: entry.category.color,
          contentPreview: entry.content.slice(0, 200),
        };
      });

      return NextResponse.json({
        answer,
        sources,
        model: settings.aiModel || "gpt-4o-mini",
        totalEntries: entries.length,
      });
    } catch (error) {
      // provider errors can echo keys or internal urls, so keep them in the log
      logger.error("Failed to test knowledge base:", error);
      return NextResponse.json(
        { error: "Couldn't get an answer. Check the AI settings and try again." },
        { status: 500 }
      );
    }
  }
);
