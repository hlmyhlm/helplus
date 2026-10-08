import { describe, it, expect } from "vitest";
import { pickRule } from "@/lib/sla/rules";

const rule = (over: Partial<Parameters<typeof pickRule>[0][number]>) => ({
  id: "r",
  projectId: null as string | null,
  priority: "all",
  category: "all",
  source: "all",
  firstResponseMins: 60,
  resolutionMins: 480,
  isActive: true,
  ...over,
});
const ticket = { projectId: "p1", priority: "high", category: "Login", source: "whatsapp" };

describe("pickRule", () => {
  it("uses the company default when nothing else matches", () => {
    expect(pickRule([rule({ id: "default" })], ticket)?.id).toBe("default");
  });

  it("prefers the most specific match", () => {
    const rules = [
      rule({ id: "default" }),
      rule({ id: "high", priority: "high" }),
      rule({ id: "project", projectId: "p1" }),
      rule({ id: "project-high", projectId: "p1", priority: "high" }),
    ];
    expect(pickRule(rules, ticket)?.id).toBe("project-high");
  });

  it("project beats priority, category and source together", () => {
    const rules = [rule({ id: "detail", priority: "high", category: "login", source: "whatsapp" }), rule({ id: "project", projectId: "p1" })];
    expect(pickRule(rules, ticket)?.id).toBe("project");
  });

  it("skips rules for other values and inactive rules", () => {
    const rules = [rule({ id: "other", projectId: "p2" }), rule({ id: "low", priority: "low" }), rule({ id: "off", isActive: false })];
    expect(pickRule(rules, ticket)).toBeNull();
  });

  it("matches category without caring about case", () => {
    expect(pickRule([rule({ id: "c", category: "login" })], ticket)?.id).toBe("c");
  });

  it("on a tie, takes the shorter first reply", () => {
    const rules = [rule({ id: "slow", priority: "high", firstResponseMins: 120 }), rule({ id: "fast", priority: "high", firstResponseMins: 30 })];
    expect(pickRule(rules, ticket)?.id).toBe("fast");
  });
});
