import { useEffect, useMemo, useState } from 'react';
import { Modal, Field, Select, Button } from './ui';
import { parseTable, type Table } from '../lib/matrix';
import { extractAcroFromForm } from '../lib/matching';
import { useStore } from '../store/store';
import type { AcroField } from '../types';

const none = '(ninguna)';

/**
 * Import the PDF field universe. Accepts either a Signframe "main" JSON (the
 * auto-mapped PDF import, with real sourceMeta per field) or an xlsx/CSV list
 * of AcroForm names.
 */
export default function AcroFormsImportDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const loadAcroForms = useStore((s) => s.loadAcroForms);
  const [table, setTable] = useState<Table | null>(null);
  const [jsonList, setJsonList] = useState<AcroField[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameCol, setNameCol] = useState('');
  const [pageCol, setPageCol] = useState<string | undefined>(undefined);
  const isJson = file.name.toLowerCase().endsWith('.json');

  useEffect(() => {
    if (isJson) {
      file
        .text()
        .then((t) => {
          const acro = extractAcroFromForm(JSON.parse(t));
          if (acro.length === 0) throw new Error('el JSON no tiene campos con sourceMeta');
          setJsonList(acro);
        })
        .catch((e) => setError(String(e)));
      return;
    }
    parseTable(file)
      .then((t) => {
        setTable(t);
        const guess =
          t.headers.find((h) => /acroform|source|campo|nombre|field/i.test(h)) ?? t.headers[0] ?? '';
        setNameCol(guess);
      })
      .catch((e) => setError(String(e)));
  }, [file, isJson]);

  const list = useMemo<AcroField[]>(() => {
    if (isJson) return jsonList ?? [];
    if (!table || !nameCol) return [];
    const seen = new Set<string>();
    const out: AcroField[] = [];
    for (const row of table.rows) {
      const name = (row[nameCol] ?? '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const f: AcroField = { name };
      if (pageCol && row[pageCol]) {
        const p = parseInt(row[pageCol], 10);
        if (!Number.isNaN(p)) f.page = p;
      }
      out.push(f);
    }
    return out;
  }, [table, nameCol, pageCol]);

  if (error) {
    return (
      <Modal title="Importar AcroForms del PDF" onClose={onClose}>
        <p className="text-sm text-red-600">No se pudo leer: {error}</p>
      </Modal>
    );
  }
  if (!isJson && !table) {
    return (
      <Modal title="Importar campos del PDF" onClose={onClose}>
        <p className="text-sm text-slate-500">Leyendo…</p>
      </Modal>
    );
  }

  return (
    <Modal title="Importar campos del PDF" onClose={onClose}>
      {isJson ? (
        <p className="text-xs text-slate-500 mb-3">
          JSON auto-mapeado de <b>Signframe</b>: se toma el <code>sourceMeta</code> real de cada campo (para que los
          valores rendericen bien) y su <code>id</code> autoritativo al vincular.
        </p>
      ) : (
        <p className="text-xs text-slate-500 mb-3">
          Lista de campos del PDF (p. ej. la columna <code>AcroForm Actual</code>). Al vincular se fabrica un
          <code>sourceMeta</code> básico; para rendering exacto, importá el JSON de Signframe.
        </p>
      )}
      {!isJson && table && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Columna con el nombre (sourceName)">
            <Select value={nameCol} onChange={(e) => setNameCol(e.target.value)}>
              {table.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Columna página (opcional)">
            <Select value={pageCol ?? none} onChange={(e) => setPageCol(e.target.value === none ? undefined : e.target.value)}>
              <option>{none}</option>
              {table.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <div className="mt-2 text-xs text-slate-500">
        {list.length} campos detectados{isJson ? ' (con sourceMeta real)' : ''}.
      </div>
      <div className="max-h-40 overflow-y-auto scroll-thin border border-slate-200 rounded mt-1 text-sm">
        {list.slice(0, 80).map((a) => (
          <div key={a.name} className="px-2 py-0.5 font-mono text-slate-600 border-b border-slate-50">
            {a.name}
            {a.page != null ? <span className="text-slate-400"> · p.{a.page}</span> : null}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          disabled={list.length === 0}
          onClick={() => {
            loadAcroForms(list);
            onClose();
          }}
        >
          Cargar {list.length} AcroForms
        </Button>
      </div>
    </Modal>
  );
}
