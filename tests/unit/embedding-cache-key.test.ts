import { describe, it, expect } from "vitest";
import { embeddingCacheKey } from "@/lib/ai/semantic-search";

describe("embeddingCacheKey", () => {
  const base = embeddingCacheKey("co-a", "openai", "text-embedding-3-small", "refund policy");

  it("gives the same key for the same inputs", () => {
    expect(embeddingCacheKey("co-a", "openai", "text-embedding-3-small", "refund policy")).toBe(base);
    expect(base).toMatch(/^embedding:co-a:openai:text-embedding-3-small:[0-9a-f]{64}$/);
  });

  it("changes with the company, provider, model or query", () => {
    expect(embeddingCacheKey("co-b", "openai", "text-embedding-3-small", "refund policy")).not.toBe(base);
    expect(embeddingCacheKey("co-a", "ollama", "text-embedding-3-small", "refund policy")).not.toBe(base);
    expect(embeddingCacheKey("co-a", "openai", "text-embedding-3-large", "refund policy")).not.toBe(base);
    expect(embeddingCacheKey("co-a", "openai", "text-embedding-3-small", "refund policy!")).not.toBe(base);
  });

  it("doesn't collide on long queries with the same start", () => {
    const long = "x".repeat(100);
    expect(embeddingCacheKey("co-a", "openai", "m", long + "a")).not.toBe(embeddingCacheKey("co-a", "openai", "m", long + "b"));
  });
});
