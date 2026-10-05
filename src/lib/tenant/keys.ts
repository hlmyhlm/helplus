import { companyIdOrFallback } from "./context";

// Channel.type and Tag.name are unique per company, not globally
export function channelKey(type: string) {
  return { companyId_type: { companyId: companyIdOrFallback(), type } };
}

export function tagKey(name: string) {
  return { companyId_name: { companyId: companyIdOrFallback(), name } };
}
