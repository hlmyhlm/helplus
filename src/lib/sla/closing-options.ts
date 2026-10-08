const DAYS = [1, 2, 3, 5, 7, 14];

const label = (d: number) => (d === 0 ? "Off (staff close only)" : `${d} day${d === 1 ? "" : "s"}`);

// keeps a stored value that isn't in the list, like 4 set through the api
export function closingOptions(current: number): { value: number; label: string }[] {
  const values = [0, ...DAYS];
  if (!values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b).map((value) => ({ value, label: label(value) }));
}
