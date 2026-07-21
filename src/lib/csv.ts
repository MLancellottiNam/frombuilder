import Papa from 'papaparse';
import type { SourceField } from '../types';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** true when the file had no header row and we synthesized col_0, col_1... */
  synthesizedHeaders: boolean;
}

export interface ColumnMapping {
  sourceName: string; // required column
  label?: string;
  page?: string;
  nativeType?: string;
}

/** Parse a CSV string. Header row is auto-detected by papaparse's `header`. */
export function parseCsv(text: string, hasHeader: boolean): ParsedCsv {
  if (hasHeader) {
    const res = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    const headers = res.meta.fields ?? [];
    return { headers, rows: res.data, synthesizedHeaders: false };
  }
  // No header: parse as arrays and synthesize column names.
  const res = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  const width = res.data.reduce((m, r) => Math.max(m, r.length), 0);
  const headers = Array.from({ length: width }, (_, i) => `col_${i}`);
  const rows = res.data.map((arr) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => (o[h] = arr[i] ?? ''));
    return o;
  });
  return { headers, rows, synthesizedHeaders: true };
}

/** Apply a column mapping to produce SourceField[], de-duplicating by name. */
export function toSourceFields(parsed: ParsedCsv, mapping: ColumnMapping): SourceField[] {
  const out: SourceField[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const sourceName = (row[mapping.sourceName] ?? '').trim();
    if (!sourceName || seen.has(sourceName)) continue;
    seen.add(sourceName);
    const field: SourceField = { sourceName };
    if (mapping.label && row[mapping.label]) field.label = row[mapping.label].trim();
    if (mapping.nativeType && row[mapping.nativeType]) {
      field.nativeType = row[mapping.nativeType].trim();
    }
    if (mapping.page && row[mapping.page]) {
      const p = parseInt(row[mapping.page], 10);
      if (!Number.isNaN(p)) field.page = p;
    }
    out.push(field);
  }
  return out;
}
