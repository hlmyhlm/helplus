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
};

// shared by every caller, cleared on login and logout
export const companyCache = { value: null as CompanyInfo | null };

export function clearCompanyCache() {
  companyCache.value = null;
}

const listeners = new Set<() => void>();
let fetching = false;

function load() {
  if (companyCache.value || fetching) return;
  fetching = true;
  fetch("/api/company")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: Omit<CompanyInfo, "loaded"> | null) => {
      if (d) companyCache.value = { ...d, loaded: true };
    })
    .catch(() => {})
    .finally(() => {
      fetching = false;
      listeners.forEach((l) => l());
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
  };
}

// the server and the first client render both see EMPTY, so hydration matches
export function useCompany(): CompanyInfo {
  return useSyncExternalStore(subscribe, () => companyCache.value ?? EMPTY, () => EMPTY);
}
