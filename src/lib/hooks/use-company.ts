"use client";

import { useEffect, useState } from "react";

interface CompanyInfo {
  name: string;
  slug: string;
  projectLabel: string;
}

const EMPTY: CompanyInfo = { name: "", slug: "", projectLabel: "Clients" };
let cached: CompanyInfo | null = null;

export function useCompany(): CompanyInfo {
  const [info, setInfo] = useState<CompanyInfo>(cached ?? EMPTY);
  useEffect(() => {
    if (cached) return;
    fetch("/api/company")
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((d: CompanyInfo) => {
        cached = d;
        setInfo(d);
      })
      .catch(() => setInfo(EMPTY));
  }, []);
  return info;
}
