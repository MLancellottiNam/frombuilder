import { Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store/store';
import { allFields } from '../lib/validation';
import { parseCondition, serializeCondition, NEVER_CONDITION } from '../lib/conditions';
import type { Condition, ConditionGroup } from '../types';
import { Button, Select, TextInput } from './ui';

export default function ConditionEditor({
  value,
  onChange,
  currentFieldId,
}: {
  value: string | null;
  onChange: (serialized: string | null) => void;
  currentFieldId: string;
}) {
  const project = useStore((s) => s.project);
  const fields = allFields(project)
    .map((r) => r.field)
    .filter((f) => f.id !== currentFieldId);
  const group: ConditionGroup = parseCondition(value) ?? { logic: 'and', conditions: [] };

  const emit = (g: ConditionGroup) => onChange(serializeCondition(g));

  const isNever =
    group.conditions.length === 1 && group.conditions[0].fieldId === 'field_NEVER_EXISTS';

  const setCondition = (i: number, patch: Partial<Condition>) => {
    const conditions = group.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c));
    emit({ ...group, conditions });
  };

  return (
    <div className="rounded-md border border-slate-200 p-2 bg-slate-50 mb-3">
      {isNever ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-600">Siempre oculto (NEVER)</span>
          <Button variant="ghost" className="!py-0.5 !px-1" onClick={() => onChange(null)}>
            Quitar
          </Button>
        </div>
      ) : (
        <>
          {group.conditions.length > 1 && (
            <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
              Lógica:
              <Select
                value={group.logic}
                onChange={(e) => emit({ ...group, logic: e.target.value as 'and' | 'or' })}
                className="!w-auto !py-0.5"
              >
                <option value="and">and (todas)</option>
                <option value="or">or (alguna)</option>
              </Select>
            </div>
          )}
          {group.conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1 mb-1">
              <Select
                value={c.fieldId}
                onChange={(e) => setCondition(i, { fieldId: e.target.value })}
                className="!py-1 text-xs flex-1"
              >
                <option value="">— campo —</option>
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({f.id})
                  </option>
                ))}
              </Select>
              <Select
                value={c.operator}
                onChange={(e) => setCondition(i, { operator: e.target.value as Condition['operator'] })}
                className="!py-1 text-xs !w-auto"
              >
                <option value="not_empty">tiene valor</option>
                <option value="empty">vacío</option>
                <option value="equals">= igual a</option>
              </Select>
              {c.operator === 'equals' && (
                <TextInput
                  value={c.value ?? ''}
                  onChange={(e) => setCondition(i, { value: e.target.value })}
                  placeholder="valor"
                  className="!py-1 text-xs !w-24"
                />
              )}
              <button
                onClick={() => emit({ ...group, conditions: group.conditions.filter((_, j) => j !== i) })}
                className="text-slate-400 hover:text-red-500"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <Button
              variant="ghost"
              className="!py-0.5 !px-1 text-xs"
              onClick={() =>
                emit({ ...group, conditions: [...group.conditions, { fieldId: '', operator: 'not_empty' }] })
              }
            >
              <Plus size={13} /> Condición
            </Button>
            <Button variant="ghost" className="!py-0.5 !px-1 text-xs" onClick={() => onChange(serializeCondition(NEVER_CONDITION))}>
              Siempre oculto
            </Button>
            {value && (
              <Button variant="ghost" className="!py-0.5 !px-1 text-xs" onClick={() => onChange(null)}>
                Limpiar
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
