import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Search, GripVertical, Layers } from 'lucide-react';
import { useStore } from '../store/store';
import type { SourceField } from '../types';
import { Button } from './ui';

function PoolCard({
  src,
  selected,
  onToggle,
}: {
  src: SourceField;
  selected: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pool:${src.sourceName}`,
    data: { type: 'pool', sourceName: src.sourceName },
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 mb-1.5 bg-white text-sm ${
        selected ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-slate-300 hover:text-slate-500 touch-none"
        title="Arrastrar al canvas"
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-slate-700 truncate">{src.sourceName}</div>
        <div className="text-[11px] text-slate-400 truncate">
          {src.nativeType ?? 'text'}
          {src.page != null ? ` · p.${src.page}` : ''}
          {src.label ? ` · ${src.label}` : ''}
        </div>
      </div>
    </div>
  );
}

export default function Pool() {
  const pool = useStore((s) => s.project.pool);
  const sourceFields = useStore((s) => s.project.sourceFields);
  const groupSourceFields = useStore((s) => s.groupSourceFields);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const byName = useMemo(() => new Map(sourceFields.map((s) => [s.sourceName, s])), [sourceFields]);
  const items = useMemo(() => {
    const q = query.toLowerCase();
    return pool
      .map((n) => byName.get(n))
      .filter((s): s is SourceField => !!s)
      .filter(
        (s) =>
          !q ||
          s.sourceName.toLowerCase().includes(q) ||
          (s.label ?? '').toLowerCase().includes(q) ||
          (s.nativeType ?? '').toLowerCase().includes(q),
      );
  }, [pool, byName, query]);

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const groupSelected = () => {
    const names = items.map((s) => s.sourceName).filter((n) => selected.has(n));
    if (names.length === 0) return;
    groupSourceFields(names);
    setSelected(new Set());
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-700">Pool ({pool.length})</h2>
          {selected.size > 0 && (
            <Button variant="primary" onClick={groupSelected} className="!py-1 !px-2 text-xs">
              <Layers size={13} /> Agrupar {selected.size}
            </Button>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar campo..."
            className="w-full rounded-md border border-slate-300 pl-7 pr-2 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-2">
        {items.length === 0 && (
          <p className="text-xs text-slate-400 text-center mt-6 px-4">
            {pool.length === 0
              ? 'Cargá un CSV para ver los campos acá.'
              : 'Ningún campo coincide con la búsqueda.'}
          </p>
        )}
        {items.map((s) => (
          <PoolCard key={s.sourceName} src={s} selected={selected.has(s.sourceName)} onToggle={() => toggle(s.sourceName)} />
        ))}
      </div>
    </div>
  );
}
