import { maskIC } from "@/lib/privacy/ic-mask";

// staff names are stored masked, so senders are compared masked too
export function staffMatcher(names: string[]): (sender: string) => boolean {
  const staff = new Set(names.map((n) => maskIC(n).text));
  const seen = new Map<string, boolean>();
  return (sender) => {
    let hit = seen.get(sender);
    if (hit === undefined) seen.set(sender, (hit = staff.has(maskIC(sender).text)));
    return hit;
  };
}
