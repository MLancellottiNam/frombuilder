import { Plus, Trash2 } from 'lucide-react';
import type { FieldOption } from '../types';
import { Button, TextInput } from './ui';

export default function OptionsEditor({
  options,
  onChange,
}: {
  options: FieldOption[] | null;
  onChange: (opts: FieldOption[] | null) => void;
}) {
  const list = options ?? [];

  const update = (i: number, patch: Partial<FieldOption>) =>
    onChange(list.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <div className="rounded-md border border-slate-200 p-2 bg-slate-50 mb-3">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 text-[10px] text-slate-400 mb-1 px-0.5">
        <span>label</span>
        <span>pdfValue</span>
        <span>jsonValue</span>
        <span />
      </div>
      {list.map((o, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 mb-1 items-center">
          <TextInput value={o.label} onChange={(e) => update(i, { label: e.target.value })} className="!py-1 text-xs" />
          <TextInput
            value={String(o.pdfValue ?? '')}
            onChange={(e) => update(i, { pdfValue: e.target.value })}
            className="!py-1 text-xs"
          />
          <TextInput
            value={String(o.jsonValue ?? '')}
            onChange={(e) => update(i, { jsonValue: e.target.value })}
            className="!py-1 text-xs"
          />
          <button onClick={() => onChange(list.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        className="!py-0.5 !px-1 text-xs mt-1"
        onClick={() => onChange([...list, { label: '', pdfValue: '', jsonValue: '' }])}
      >
        <Plus size={13} /> Opción
      </Button>
      {list.length > 0 && (
        <Button variant="ghost" className="!py-0.5 !px-1 text-xs mt-1 ml-1" onClick={() => onChange(null)}>
          Vaciar (null)
        </Button>
      )}
    </div>
  );
}
