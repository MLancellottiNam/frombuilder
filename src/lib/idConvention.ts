import type { IdConvention } from '../types';

// The Regla de Oro requires id == "field_" + applyConvention(sourceName).
// A project uses ONE convention detected on import; new fields derived from a
// sourceName follow it. We do NOT force a naming style on the user's files.

/**
 * Apply the id convention to a sourceName. Independent of case-lowering, PDF
 * AcroForm array indices like `name[0]` become `name_0` because Signframe field
 * ids cannot contain brackets.
 */
export function applyConvention(sourceName: string, convention: IdConvention): string {
  const bracketsToUnderscore = sourceName.replace(/\[(\d+)\]/g, '_$1');
  return convention === 'lower' ? bracketsToUnderscore.toLowerCase() : bracketsToUnderscore;
}

/** Build the full field id for a source-derived field. */
export function fieldIdFor(sourceName: string, convention: IdConvention): string {
  return 'field_' + applyConvention(sourceName, convention);
}

/**
 * Detect the convention a set of sourceNames appears to follow. If every name
 * is already lowercase we assume 'lower'; otherwise 'exact'. Heuristic only —
 * the user can override in the import dialog.
 */
export function detectConvention(sourceNames: string[]): IdConvention {
  const meaningful = sourceNames.filter((n) => /[a-zA-Z]/.test(n));
  if (meaningful.length === 0) return 'exact';
  const allLower = meaningful.every((n) => n === n.toLowerCase());
  return allLower ? 'lower' : 'exact';
}

/**
 * When importing an existing form-definition, infer the convention from the
 * relationship between a field id and its sourceName so we can keep deriving
 * new ids consistently.
 */
export function detectConventionFromField(id: string, sourceName: string): IdConvention | null {
  const bare = id.replace(/^field_/, '');
  const exact = applyConvention(sourceName, 'exact');
  const lower = applyConvention(sourceName, 'lower');
  if (bare === exact && exact !== lower) return 'exact';
  if (bare === lower && exact !== lower) return 'lower';
  return null; // ambiguous (name has no letters)
}
