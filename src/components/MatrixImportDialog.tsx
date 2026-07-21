import { useEffect, useMemo, useState } from 'react';
import { Layers, Columns3, FolderTree, Search, Copy } from 'lucide-react';
import { Modal, Field, Select, Button } from './ui';
import { parseTable, guessMatrixMapping, readMatrix, materializeMatrix, type Table, type MatrixMapping } from '../lib/matrix';
import { detectConvention } from '../lib/idConvention';
import { useStore } from '../store/store';
import type { IdConvention } from '../types';
import MatrixExplorer from './MatrixExplorer';

const none = '(ninguna)';

export default function MatrixImportDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const loadMatrix = useStore((s) => s.loadMatrix);
  const createEmptyStructure = useStore((s) => s.createEmptyStructure);
  const applyMatrixBuild = useStore((s) => s.applyMatrixBuild);

  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<MatrixMapping>({});
  const [convention, setConvention] = useState<IdConvention>('exact');
  const [mode, setMode] = useState<'build' | 'pool'>('build');
  const [showExplorer, setShowExplorer] = useState(false);

  useEffect(() => {
    parseTable(file)
      .then((t) => {
        setTable(t);
        setMapping(guessMatrixMapping(t.headers));
      })
      .catch((e) => setError(String(e)));
  }, [file]);

  const result = useMemo(() => (table ? readMatrix(table, mapping) : null), [table, mapping]);

  useEffect(() => {
    if (result) setConvention(detectConvention(result.sourceFields.filter((f) => !f.isUiOnly).map((f) => f.sourceName)));
  }, [result]);

  const setCol = (key: keyof MatrixMapping) => (v: string) =>
    setMapping((m) => ({ ...m, [key]: v === none ? undefined : v }));

  const confirm = () => {
    if (!result) return;
    if (mode === 'build') {
      const built = materializeMatrix(result, convention);
      applyMatrixBuild(built.sections, built.sourceFields, convention);
    } else {
      loadMatrix(result.sourceFields, convention);
      createEmptyStructure(result.groups);
    }
    onClose();
  };

  if (error) {
    return (
      <Modal title="Importar matriz / ficha" onClose={onClose}>
        <p className="text-sm text-red-600">No se pudo leer el archivo: {error}</p>
      </Modal>
    );
  }
  if (!table || !result) {
    return (
      <Modal title="Importar matriz / ficha" onClose={onClose}>
        <p className="text-sm text-slate-500">Leyendo archivo…</p>
      </Modal>
    );
  }

  const colSelect = (key: keyof MatrixMapping, label: string, optional = true) => (
    <Field label={label}>
      <Select value={mapping[key] ?? none} onChange={(e) => setCol(key)(e.target.value)}>
        {optional && <option>{none}</option>}
        {table.headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <Modal title="Importar matriz / ficha" onClose={onClose} wide>
      {/* Resumen: columnas + estructura detectada */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { icon: Columns3, n: result.stats.columns, l: 'columnas' },
          { icon: FolderTree, n: result.stats.sections, l: 'secciones' },
          { icon: Layers, n: result.stats.subsections, l: 'subsecciones' },
          { icon: Layers, n: result.stats.rows, l: 'filas / campos' },
        ].map((c, i) => (
          <div key={i} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center">
            <c.icon size={15} className="mx-auto text-brand-600 mb-0.5" />
            <div className="text-lg font-semibold text-slate-800 leading-none">{c.n}</div>
            <div className="text-[11px] text-slate-500">{c.l}</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500 mb-2">
        Mapeá qué columna es cada cosa. Los campos se cargan al <b>pool</b> (con la sección/subsección sugerida) para
        que los arrastres. No se arma la definición automáticamente.
      </p>

      <div className="grid grid-cols-3 gap-x-3">
        {colSelect('section', 'Columna Sección')}
        {colSelect('subsection', 'Columna Subsección')}
        {colSelect('sourceName', 'Columna campo/sourceName')}
        {colSelect('label', 'Columna Label')}
        {colSelect('type', 'Columna Tipo')}
        {colSelect('path', 'Columna Path (salidaJSON)')}
        {colSelect('condition', 'Columna Condición (Sí/No)')}
      </div>

      {/* Aviso de duplicados + explorador */}
      <div className="flex items-center justify-between mt-1 mb-2">
        {result.stats.duplicates > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700">
            <Copy size={13} /> {result.stats.duplicates} campo(s) repetido(s)
          </span>
        ) : (
          <span className="text-xs text-green-600">Sin duplicados</span>
        )}
        <Button onClick={() => setShowExplorer(true)}>
          <Search size={14} /> Explorar en detalle
        </Button>
      </div>

      <Field label="Convención de id (para los sourceName)">
        <Select value={convention} onChange={(e) => setConvention(e.target.value as IdConvention)}>
          <option value="exact">exact</option>
          <option value="lower">lower</option>
        </Select>
      </Field>

      {/* Árbol detectado */}
      <div className="mt-2 border border-slate-200 rounded-md">
        <div className="px-3 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
          Estructura detectada (no se completa sola)
        </div>
        <div className="max-h-52 overflow-y-auto scroll-thin p-2 text-sm">
          {result.groups.length === 0 && (
            <p className="text-xs text-slate-400 px-2 py-3">
              No se detectaron secciones. Revisá el mapeo de columnas.
            </p>
          )}
          {result.groups.map((g) => (
            <div key={g.section} className="mb-1.5">
              <div className="font-medium text-slate-700">▸ {g.section}</div>
              <div className="ml-4 text-slate-500 text-xs">
                {g.subsections.map((s) => (
                  <span key={s} className="inline-block bg-slate-100 rounded px-1.5 py-0.5 mr-1 mb-1">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => setMode('build')}
          className={`text-left rounded-md border px-3 py-2 ${
            mode === 'build' ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50' : 'border-slate-300'
          }`}
        >
          <div className="text-sm font-medium text-slate-800">Etapa 1 · Armar ordenado</div>
          <div className="text-[11px] text-slate-500">
            Crea las secciones/subsecciones con los campos <b>ya ubicados y ordenados</b> adentro (y vuelca las
            condiciones a visibilidad).
          </div>
        </button>
        <button
          onClick={() => setMode('pool')}
          className={`text-left rounded-md border px-3 py-2 ${
            mode === 'pool' ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50' : 'border-slate-300'
          }`}
        >
          <div className="text-sm font-medium text-slate-800">Solo al pool</div>
          <div className="text-[11px] text-slate-500">
            Carga los campos al pool + crea las secciones vacías, para arrastrarlos vos.
          </div>
        </button>
      </div>

      <div className="flex justify-end gap-2 mt-3">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={confirm} disabled={result.stats.uniqueFields === 0}>
          {mode === 'build'
            ? `Armar ${result.stats.sections} secciones con ${result.stats.uniqueFields} campos`
            : `Cargar ${result.stats.uniqueFields} campos al pool`}
        </Button>
      </div>

      {showExplorer && (
        <MatrixExplorer result={result} conditionMapped={!!mapping.condition} onClose={() => setShowExplorer(false)} />
      )}
    </Modal>
  );
}
