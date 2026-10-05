import { AsyncLocalStorage } from "node:async_hooks";

interface TenantStore {
  companyId: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

export class MissingCompanyError extends Error {
  constructor() {
    super("no company in context, wrap the call in runWithCompany()");
    this.name = "MissingCompanyError";
  }
}

export function runWithCompany<T>(companyId: string, fn: () => T): T {
  if (!companyId) throw new MissingCompanyError();
  return storage.run({ companyId }, fn);
}

export function currentCompanyId(): string {
  const id = storage.getStore()?.companyId;
  if (!id) throw new MissingCompanyError();
  return id;
}

export function maybeCompanyId(): string | undefined {
  return storage.getStore()?.companyId;
}
