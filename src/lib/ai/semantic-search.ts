// knowledge base search: embeddings when a provider is set up, keyword match otherwise.
// vectors live in KnowledgeEntry.metadata for now.

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { logger } from "@/lib/logger";
import { cacheGet, cacheSet } from "@/lib/cache";
import { embed } from "./provider";
import { embedConfig, isConfigured } from "./config";

interface SearchResult {
  id: string;
  title: string;
  content: string;
  category: string;
  score: number;
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const cfg = embedConfig(await getSettings());
    if (!isConfigured(cfg)) return null;
    const [vector] = await embed(cfg, [text]);
    return vector ?? null;
  } catch (error) {
    logger.error("Failed to generate embedding:", error);
    return null;
  }
}

/**
 * Calculate cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Keyword-based search fallback.
 */
function keywordScore(query: string, text: string): number {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const textLower = text.toLowerCase();
  let matches = 0;

  for (const word of queryWords) {
    if (textLower.includes(word)) matches++;
  }

  return queryWords.length > 0 ? matches / queryWords.length : 0;
}

/**
 * Search the knowledge base semantically.
 * Uses embeddings when available, falls back to keyword matching.
 */
export async function searchKnowledgeBase(
  query: string,
  limit = 5
): Promise<SearchResult[]> {
  const entries = await prisma.knowledgeEntry.findMany({
    where: { isActive: true },
    include: { category: { select: { name: true } } },
  });

  if (entries.length === 0) return [];

  const cfg = embedConfig(await getSettings());

  let results: SearchResult[];

  if (isConfigured(cfg)) {
    // Try semantic search with embeddings
    const cacheKey = `embedding:${Buffer.from(query).toString("base64").substring(0, 50)}`;
    let queryEmbedding: number[] | null = null;

    const cached = await cacheGet(cacheKey);
    if (cached) {
      queryEmbedding = JSON.parse(cached);
    } else {
      queryEmbedding = await generateEmbedding(query);
      if (queryEmbedding) {
        await cacheSet(cacheKey, JSON.stringify(queryEmbedding), 3600);
      }
    }

    if (queryEmbedding) {
      // Score entries using embeddings (stored in metadata) + keyword fallback
      results = entries.map((entry) => {
        const metadata = entry.metadata as Record<string, unknown> | null;
        const entryEmbedding = metadata?.embedding as number[] | null;

        let score: number;
        if (entryEmbedding) {
          score = cosineSimilarity(queryEmbedding!, entryEmbedding);
        } else {
          // Fallback to keyword matching for entries without embeddings
          score = keywordScore(query, `${entry.title} ${entry.content}`);
        }

        return {
          id: entry.id,
          title: entry.title,
          content: entry.content,
          category: entry.category.name,
          score,
        };
      });
    } else {
      // Embedding generation failed, use keyword search
      results = keywordSearch(entries, query);
    }
  } else {
    // No API key, use keyword search
    results = keywordSearch(entries, query);
  }

  return results
    .filter((r) => r.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function keywordSearch(
  entries: Array<{
    id: string;
    title: string;
    content: string;
    category: { name: string };
  }>,
  query: string
): SearchResult[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    category: entry.category.name,
    score: keywordScore(query, `${entry.title} ${entry.content}`),
  }));
}

export async function indexKnowledgeEntry(entryId: string): Promise<boolean> {
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) return false;

  const text = `${entry.title}\n${entry.content}`;
  const embedding = await generateEmbedding(text);

  if (!embedding) return false;

  const currentMetadata = (entry.metadata as Record<string, unknown>) || {};

  await prisma.knowledgeEntry.update({
    where: { id: entryId },
    data: {
      metadata: { ...currentMetadata, embedding },
    },
  });

  return true;
}
