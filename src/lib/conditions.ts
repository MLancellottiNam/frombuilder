import type { ConditionGroup } from '../types';

// conditionalVisibility / conditionalRequired are ALWAYS stored as a serialized
// JSON string (never an object) per spec 3.5.

export const NEVER_CONDITION: ConditionGroup = {
  logic: 'and',
  conditions: [{ fieldId: 'field_NEVER_EXISTS', operator: 'not_empty' }],
};

export function serializeCondition(group: ConditionGroup | null): string | null {
  if (!group || group.conditions.length === 0) return null;
  return JSON.stringify(group);
}

export function parseCondition(raw: string | null): ConditionGroup | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.conditions)) return parsed as ConditionGroup;
    return null;
  } catch {
    return null;
  }
}

export function isValidConditionJson(raw: string | null): boolean {
  if (!raw) return true; // null is valid (means "no condition")
  try {
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.conditions);
  } catch {
    return false;
  }
}

/** Extract every fieldId referenced by a serialized condition. */
export function referencedFieldIds(raw: string | null): string[] {
  const group = parseCondition(raw);
  if (!group) return [];
  return group.conditions.map((c) => c.fieldId).filter(Boolean);
}
