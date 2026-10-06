"use client";

import { useEffect, useState } from "react";

interface CompanyInfo {
  name: string;
  slug: string;
  projectLabel: string;
  canManageProjects: boolean;
}

const EMPTY: CompanyInfo = { name: "", slug: "", projectLabel: "Clients", canManageProjects: false };

// shared across every component using the hook, so it survives route changes -
// but a different user can log in in the same tab, so it must be cleared on login/logout
export const companyCache = { value: null as CompanyInfo | null };

export function clearCompanyCache() {
  companyCache.value = null;
}

export function useCompany(): CompanyInfo {
  const [info, setInfo] = useState<CompanyInfo>(companyCache.value ?? EMPTY);
  useEffect(() => {
    if (companyCache.value) return;
    fetch("/api/company")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CompanyInfo | null) => {
        if (d) {
          companyCache.value = d;
          setInfo(d);
        } else {
          setInfo(EMPTY);
        }
      })
      .catch(() => setInfo(EMPTY));
  }, []);
  return info;
}
