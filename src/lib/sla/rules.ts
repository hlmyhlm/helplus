export interface RuleLike {
  id: string;
  projectId: string | null;
  priority: string;
  category: string;
  source: string;
  firstResponseMins: number;
  isActive: boolean;
}

export interface TicketMatch {
  projectId: string;
  priority: string;
  category: string;
  source: string;
}

// most specific rule wins: project, then priority, category, source
export function pickRule<R extends RuleLike>(rules: R[], t: TicketMatch): R | null {
  let best: R | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (!r.isActive) continue;
    if (r.projectId && r.projectId !== t.projectId) continue;
    if (r.priority !== "all" && r.priority !== t.priority) continue;
    if (r.category !== "all" && r.category.toLowerCase() !== t.category.toLowerCase()) continue;
    if (r.source !== "all" && r.source !== t.source) continue;
    const score =
      (r.projectId ? 8 : 0) + (r.priority !== "all" ? 4 : 0) + (r.category !== "all" ? 2 : 0) + (r.source !== "all" ? 1 : 0);
    if (score > bestScore || (score === bestScore && best && r.firstResponseMins < best.firstResponseMins)) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}
