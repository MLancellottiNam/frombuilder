import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import { useStore } from './store/store';
import TopBar from './components/TopBar';
import Pool from './components/Pool';
import Canvas from './components/Canvas';
import Inspector from './components/Inspector';

/** Locate a field's subsection id and index within it. */
function locateField(fieldId: string) {
  const { form } = useStore.getState().project;
  for (const section of form.sections) {
    for (const sub of section.subsections) {
      const idx = sub.fields.findIndex((f) => f.id === fieldId);
      if (idx >= 0) return { subsectionId: sub.id, index: idx };
    }
  }
  return null;
}

function subsectionLength(subsectionId: string): number {
  const { form } = useStore.getState().project;
  for (const section of form.sections) {
    const sub = section.subsections.find((ss) => ss.id === subsectionId);
    if (sub) return sub.fields.length;
  }
  return 0;
}

export default function App() {
  const placeSourceField = useStore((s) => s.placeSourceField);
  const moveField = useStore((s) => s.moveField);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current;
    if (data?.type === 'pool') setActiveLabel(String(data.sourceName));
    else if (data?.type === 'field') {
      const f = useStore
        .getState()
        .project.form.sections.flatMap((s) => s.subsections)
        .flatMap((ss) => ss.fields)
        .find((x) => x.id === data.fieldId);
      setActiveLabel(f?.label ?? 'campo');
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveLabel(null);
    const { active, over } = e;
    if (!over) return;
    const a = active.data.current;
    const o = over.data.current;
    if (!a || !o) return;

    // Resolve target subsection + insertion index from the drop target.
    let targetSub: string | null = null;
    let index = 0;
    if (o.type === 'subsection') {
      targetSub = String(o.subsectionId);
      index = subsectionLength(targetSub);
    } else if (o.type === 'field') {
      const loc = locateField(String(o.fieldId));
      if (loc) {
        targetSub = loc.subsectionId;
        index = loc.index;
      }
    }
    if (!targetSub) return;

    if (a.type === 'pool') {
      placeSourceField(String(a.sourceName), '', targetSub, index);
    } else if (a.type === 'field') {
      const from = locateField(String(a.fieldId));
      // moveField extracts before inserting; if the field moves down within the
      // same subsection its removal shifts every later slot up by one.
      if (from && from.subsectionId === targetSub && from.index < index) index -= 1;
      moveField(String(a.fieldId), targetSub, index);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-col h-screen">
        <TopBar />
        <div className="flex flex-1 min-h-0">
          <aside className="w-72 shrink-0 bg-white border-r border-slate-200">
            <Pool />
          </aside>
          <main className="flex-1 min-w-0 bg-slate-100">
            <Canvas />
          </main>
          <aside className="w-80 shrink-0 bg-white border-l border-slate-200">
            <Inspector />
          </aside>
        </div>
      </div>
      <DragOverlay>
        {activeLabel ? (
          <div className="rounded-md border border-brand-500 bg-white px-2 py-1.5 text-sm shadow-lg font-mono text-slate-700">
            {activeLabel}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
