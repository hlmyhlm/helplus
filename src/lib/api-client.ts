export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// list endpoints return { data, pagination }; a few older ones return a bare array
export function unwrapList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)) {
    return (json as { data: T[] }).data;
  }
  return [];
}

export function listMeta(json: unknown): ListMeta | null {
  if (json && typeof json === "object" && "pagination" in json) {
    return (json as { pagination: ListMeta }).pagination;
  }
  return null;
}
