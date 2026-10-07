"use client";

import { useSyncExternalStore } from "react";

interface CompanyInfo {
  name: string;
  slug: string;
  projectLabel: string;
  canManageProjects: boolean;
  canCheckScreens: boolean;
  canUpdateTickets: boolean;
  canImport: boolean;
  autoCloseDays: number;
  loaded: boolean;
  failed: boolean;
}

const EMPTY: CompanyInfo = {
  name: "",
  slug: "",
  projectLabel: "Clients",
  canManageProjects: false,
  canCheckScreens: false,
  canUpdateTickets: false,
  canImport: false,
  autoCloseDays: 0,
  loaded: false,
  failed: false,
};

const FAILED: CompanyInfo = { ...EMPTY, failed: true };

// shared by every caller, cleared on login and logout
export const companyCache = { value: null as CompanyInfo | null };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
let fetching = false;
let failed = false;
// bumped on clear so a reply from before logout is dropped
let generation = 0;

export function clearCompanyCache() {
  companyCache.value = null;
  failed = false;
  fetching = false;
  generation++;
  notify();
}

function load() {
  if (companyCache.value || fetching) return;
  fetching = true;
  const mine = generation;
  fetch("/api/company")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: Omit<CompanyInfo, "loaded" | "failed"> | null) => {
      if (mine !== generation) return;
      if (d) companyCache.value = { ...d, loaded: true, failed: false };
      failed = !d;
    })
    .catch(() => {
      if (mine === generation) failed = true;
    })
    .finally(() => {
      if (mine !== generation) return;
      fetching = false;
      notify();
    });
}

export function companySnapshot(): CompanyInfo {
  return companyCache.value ?? (failed ? FAILED : EMPTY);
}

export function subscribeCompany(listener: () => void) {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
  };
}

// the server and the first client render both see EMPTY, so hydration matches
export function useCompany(): CompanyInfo {
  return useSyncExternalStore(subscribeCompany, companySnapshot, () => EMPTY);
}
