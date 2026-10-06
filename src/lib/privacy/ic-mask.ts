export const IC_PLACEHOLDER = "[IC HIDDEN]";

// malaysian IC: YYMMDD-PB-####, dashes or spaces optional.
// we don't check the date part on purpose, a false positive is cheaper than a leak.
export const IC_REGEX_SOURCE = String.raw`(?<!\d)\d{6}[\s-]?\d{2}[\s-]?\d{4}(?!\d)`;
const IC_PATTERN = new RegExp(IC_REGEX_SOURCE, "g");

export function maskIC(text: string): { text: string; count: number } {
  let count = 0;
  const masked = text.replace(IC_PATTERN, () => {
    count++;
    return IC_PLACEHOLDER;
  });
  return { text: masked, count };
}
