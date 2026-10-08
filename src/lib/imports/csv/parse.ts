import Papa from "papaparse";

export function readCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // strip a leading BOM, exports from Excel often have one
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return { headers: result.meta.fields ?? [], rows: result.data };
}

export function headersSignature(headers: string[]): string {
  return headers.map((h) => h.trim().toLowerCase()).join("|");
}
