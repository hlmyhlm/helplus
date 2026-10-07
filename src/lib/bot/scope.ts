// limited roles see chats in their projects plus ones not linked yet
export function chatWhere(ids: string[] | null): Record<string, unknown> {
  return ids === null ? {} : { OR: [{ projectId: { in: ids } }, { projectId: null }] };
}
