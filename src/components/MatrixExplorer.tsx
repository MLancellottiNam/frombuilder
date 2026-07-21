import { useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, GitBranch, CornerDownRight } from 'lucide-react';
import { Modal } from './ui';
import type { MatrixEntry, MatrixResult } from '../lib/matrix';
import type { FieldType } from '../types';

interface QNode {
  label: string;
  type: FieldType | null;
  typeRaw: string;
  path: string;
  entries: MatrixEntry[]; // >1 = pregunta con opciones (desdoblada)
}
interface SubNode {
  subsection: string;
  questions: QNode[];
}
interface SecNode {
  section: string;
  subs: SubNode[];
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

interface Trigger {
  key: string;
  ref: string;
  values: string[]; // observed equals-values
}

export default function MatrixExplorer({
  result,
  conditionMapped,
  onClose,
}: {
  result: MatrixResult;
  conditionMapped: boolean;
  onClose: () => void;
}) {
  // Distinct condition triggers and the values each one is compared against.
  const triggers = useMemo<Trigger[]>(() => {
    const map = new Map<string, Trigger>();
    for (const e of result.entries) {
      if (!e.condition) continue;
      const key = norm(e.condition.ref);
      if (!map.has(key)) map.set(key, { key, ref: e.condition.ref, values: [] });
      const t = map.get(key)!;
      if (e.condition.value && !t.values.includes(e.condition.value)) t.values.push(e.condition.value);
    }
    return Array.from(map.values());
  }, [result.entries]);

  // Simulator state: chosen value per trigger key ('' = sin valor / vacío).
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const isVisible = (e: MatrixEntry): boolean => {
    if (!e.condition) return true;
    const key = norm(e.condition.ref);
    const chosen = answers[key] ?? '';
    let sat: boolean;
    if (e.condition.value === '') sat = chosen !== ''; // needs any value
    else sat = norm(chosen) === norm(e.condition.value);
    return e.condition.negated ? !sat : sat;
  };

  const visibleCount = result.entries.filter(isVisible).length;

  // Group entries into section -> subsection -> QUESTION, collapsing consecutive
  // rows that share the same label (col D) into one question with its options.
  const grouped = useMemo(() => {
    const secs: SecNode[] = [];
    let lastQ: QNode | null = null;
    let lastKey = '';
    for (const e of result.entries) {
      let sec = secs.find((s) => s.section === e.section);
      if (!sec) {
        sec = { section: e.section, subs: [] };
        secs.push(sec);
      }
      let sub = sec.subs.find((s) => s.subsection === e.subsection);
      if (!sub) {
        sub = { subsection: e.subsection, questions: [] };
        sec.subs.push(sub);
      }
      const key = `${e.section}||${e.subsection}||${norm(e.label)}`;
      if (lastQ && key === lastKey && e.label) {
        lastQ.entries.push(e);
      } else {
        lastQ = { label: e.label, type: e.type, typeRaw: e.typeRaw, path: e.path, entries: [e] };
        lastKey = key;
        sub.questions.push(lastQ);
      }
    }
    return secs;
  }, [result.entries]);

  const dupList = Object.entries(result.duplicates);

  return (
    <Modal title="Explorar matriz" onClose={onClose} wide>
      {/* Duplicates */}
      {dupList.length > 0 ? (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 mb-1">
            <Copy size={14} /> {dupList.length} campo(s) repetido(s)
          </div>
          <div className="text-xs text-amber-700 flex flex-wrap gap-1">
            {dupList.map(([k, n]) => (
              <span key={k} className="font-mono bg-amber-100 rounded px-1.5 py-0.5">
                {k} ×{n}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-3 text-xs text-green-600">Sin campos repetidos.</div>
      )}

      {/* Condition simulator */}
      {conditionMapped ? (
        triggers.length > 0 ? (
          <div className="mb-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-brand-700 mb-2">
              <GitBranch size={14} /> Simular respuestas — se ven {visibleCount} de {result.entries.length} campos
            </div>
            <div className="space-y-2">
              {triggers.map((t) => {
                const opts = t.values.length ? t.values : ['con valor'];
                const chosen = answers[t.key] ?? '';
                return (
                  <div key={t.key} className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-600 font-medium min-w-[120px]">{t.ref}</span>
                    <button
                      onClick={() => setAnswers((a) => ({ ...a, [t.key]: '' }))}
                      className={`text-xs rounded px-2 py-0.5 border ${
                        chosen === '' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-300 text-slate-600'
                      }`}
                    >
                      (sin responder)
                    </button>
                    {opts.map((v) => {
                      const val = t.values.length ? v : '__any__';
                      const active = norm(chosen) === norm(val);
                      return (
                        <button
                          key={v}
                          onClick={() => setAnswers((a) => ({ ...a, [t.key]: val }))}
                          className={`text-xs rounded px-2 py-0.5 border ${
                            active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-slate-300 text-slate-600'
                          }`}
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mb-3 text-xs text-slate-500">La columna de condición no tiene reglas reconocibles.</div>
        )
      ) : (
        <div className="mb-3 text-xs text-slate-500">
          No mapeaste una columna de <b>condición</b>. Mapeala en el importador para simular las ramas “Sí / No”.
        </div>
      )}

      {/* Ordered tree */}
      <div className="border border-slate-200 rounded-md">
        <div className="px-3 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
          Orden tal como viene la matriz
        </div>
        <div className="max-h-[45vh] overflow-y-auto scroll-thin p-2">
          {grouped.map((sec) => (
            <div key={sec.section} className="mb-2">
              <div className="text-sm font-semibold text-slate-800">▸ {sec.section}</div>
              {sec.subs.map((sub) => (
                <div key={sub.subsection} className="ml-3 mt-1">
                  <div className="text-xs font-medium text-slate-500 mb-0.5">{sub.subsection}</div>
                  {sub.questions.map((q, qi) =>
                    q.entries.length > 1 ? (
                      <QuestionNode key={qi} q={q} isVisible={isVisible} />
                    ) : (
                      <FieldRow key={qi} e={q.entries[0]} isVisible={isVisible} />
                    ),
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Condition / reveal / duplicate chips shared by rows. */
function Chips({ e }: { e: MatrixEntry }) {
  return (
    <>
      {e.duplicateCount > 1 && (
        <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1 shrink-0" title="Aparece más de una vez">
          ×{e.duplicateCount}
        </span>
      )}
      {e.reveals.length > 0 && (
        <span className="text-[10px] bg-emerald-100 text-emerald-700 rounded px-1 shrink-0" title={e.conditionRaw}>
          ↳ muestra: {e.reveals.join(' · ')}
        </span>
      )}
      {e.condition && (
        <span className="text-[10px] bg-brand-100 text-brand-700 rounded px-1 shrink-0" title={e.conditionRaw}>
          👁 {e.condition.negated ? 'si NO ' : 'si '}
          {e.condition.ref}
          {e.condition.value ? ` = ${e.condition.value}` : ''}
        </span>
      )}
    </>
  );
}

function FieldRow({ e, isVisible }: { e: MatrixEntry; isVisible: (e: MatrixEntry) => boolean }) {
  const vis = isVisible(e);
  return (
    <div
      data-entry={e.sourceName ?? e.label}
      data-visible={vis ? '1' : '0'}
      className={`flex items-center gap-2 text-sm py-1 px-2 rounded border-b border-slate-50 ${vis ? '' : 'opacity-40'}`}
    >
      {vis ? <Eye size={13} className="text-slate-300 shrink-0" /> : <EyeOff size={13} className="text-slate-400 shrink-0" />}
      <span className="flex-1 truncate text-slate-700">{e.label}</span>
      {e.sourceName ? (
        <span className="font-mono text-[11px] text-slate-400 truncate max-w-[150px]">{e.sourceName}</span>
      ) : (
        <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-500">UI</span>
      )}
      <span className="text-[10px] uppercase text-slate-400 w-14 shrink-0">{e.type ?? e.typeRaw ?? ''}</span>
      <Chips e={e} />
    </div>
  );
}

/** A question (col D) with its options (col F) nested as sub-branches. */
function QuestionNode({ q, isVisible }: { q: QNode; isVisible: (e: MatrixEntry) => boolean }) {
  return (
    <div className="border-b border-slate-50 py-1">
      <div className="flex items-center gap-2 text-sm px-2">
        <span className="flex-1 truncate font-medium text-slate-800">{q.label}</span>
        <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded px-1 shrink-0">
          {q.entries.length} opciones
        </span>
        <span className="text-[10px] uppercase text-slate-400 w-14 shrink-0">{q.type ?? q.typeRaw ?? ''}</span>
      </div>
      <div className="ml-5 mt-0.5">
        {q.entries.map((e, i) => {
          const vis = isVisible(e);
          return (
            <div
              key={i}
              data-entry={e.sourceName ?? `${q.label}:${e.value}`}
              data-visible={vis ? '1' : '0'}
              className={`flex items-center gap-2 text-[13px] py-0.5 ${vis ? '' : 'opacity-40'}`}
            >
              <CornerDownRight size={12} className="text-slate-300 shrink-0" />
              <span className="flex-1 truncate text-slate-600">{e.value || e.label}</span>
              {e.sourceName && (
                <span className="font-mono text-[10px] text-slate-400 truncate max-w-[140px]">{e.sourceName}</span>
              )}
              <Chips e={e} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
