import { describe, it, expect } from "vitest";
import { companyCache, clearCompanyCache } from "@/lib/hooks/use-company";

describe("company cache", () => {
  it("clears so the next useCompany call fetches again", () => {
    companyCache.value = { name: "Acme", slug: "acme", projectLabel: "Clients", canManageProjects: true };
    expect(companyCache.value).not.toBeNull();
    clearCompanyCache();
    expect(companyCache.value).toBeNull();
  });
});
