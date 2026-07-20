import { useEffect, useMemo, useState } from 'react';
import { Modal, Field, Select, Button, Checkbox } from './ui';
import { parseCsv, toSourceFields, type ParsedCsv, type ColumnMapping } from '../lib/csv';
import { detectConvention } from '../lib/idConvention';
import { useStore } from '../store/store';
import type { IdConvention } from '../types';

export default function CsvImportDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const loadSourceFields = useStore((s) => s.loadSourceFields);
  const [hasHeader, setHasHeader] = useState(true);
  const parsed: ParsedCsv = useMemo(() => parseCsv(text, hasHeader), [text, hasHeader]);
  const [mapping, setMapping] = useState<ColumnMapping>({ sourceName: '' });

  // Auto-guess the column mapping from header names whenever the parse changes.
  useEffect(() => {
    const find = (...cands: string[]) =>
      parsed.headers.find((h) => cands.some((c) => h.toLowerCase().includes(c)));
    setMapping({
      sourceName: find('sourcename', 'source', 'name', 'campo', 'field') ?? parsed.headers[0] ?? '',
      label: find('label', 'etiqueta', 'descrip'),
      page: find('page', 'pagina', 'página', 'pág'),
      nativeType: find('type', 'tipo'),
    });
  }, [parsed]);
  const [convention, setConvention] = useState<IdConvention>('exact');
  const [conventionTouched, setConventionTouched] = useState(false);

  // Initialise sourceName to the first column and guess convention.
  const effectiveMapping = mapping.sourceName ? mapping : { ...mapping, sourceName: parsed.headers[0] ?? '' };
  const preview = useMemo(
    () => (effectiveMapping.sourceName ? toSourceFields(parsed, effectiveMapping) : []),
    [parsed, effectiveMapping],
  );
  const guessedConvention = useMemo(
    () => detectConvention(preview.map((p) => p.sourceName)),
    [preview],
  );
  const effectiveConvention = conventionTouched ? convention : guessedConvention;

  const none = '(ninguna)';
  const setCol = (key: keyof ColumnMapping) => (v: string) =>
    setMapping((m) => ({ ...m, [key]: v === none ? undefined : v }));

  const confirm = () => {
    if (!effectiveMapping.sourceName) return;
    loadSourceFields(toSourceFields(parsed, effectiveMapping), effectiveConvention);
    onClose();
  };

  return (
    <Modal title="Importar CSV de campos" onClose={onClose} wide>
      <Checkbox label="La primera fila es un encabezado" checked={hasHeader} onChange={setHasHeader} />

      <div className="grid grid-cols-2 gap-3 mt-2">
        <Field label="Columna sourceName (obligatoria)">
          <Select value={effectiveMapping.sourceName} onChange={(e) => setCol('sourceName')(e.target.value)}>
            {parsed.headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Columna label (opcional)">
          <Select value={mapping.label ?? none} onChange={(e) => setCol('label')(e.target.value)}>
            <option>{none}</option>
            {parsed.headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Columna page (opcional)">
          <Select value={mapping.page ?? none} onChange={(e) => setCol('page')(e.target.value)}>
            <option>{none}</option>
            {parsed.headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Columna tipo nativo (opcional)">
          <Select value={mapping.nativeType ?? none} onChange={(e) => setCol('nativeType')(e.target.value)}>
            <option>{none}</option>
            {parsed.headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Convención de id detectada" hint="Se aplica a los campos derivados de un sourceName.">
        <Select
          value={effectiveConvention}
          onChange={(e) => {
            setConventionTouched(true);
            setConvention(e.target.value as IdConvention);
          }}
        >
          <option value="exact">exact (respeta mayúsculas/minúsculas)</option>
          <option value="lower">lower (todo minúsculas)</option>
        </Select>
      </Field>

      <div className="mt-3 border border-slate-200 rounded-md">
        <div className="px-3 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
          Vista previa — {preview.length} campos
        </div>
        <div className="max-h-48 overflow-y-auto scroll-thin text-sm">
          {preview.slice(0, 100).map((p) => (
            <div key={p.sourceName} className="px-3 py-1 border-b border-slate-50 flex justify-between">
              <span className="font-mono text-slate-700">{p.sourceName}</span>
              <span className="text-slate-400 text-xs">
                {p.nativeType ?? ''} {p.page != null ? `p.${p.page}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={confirm} disabled={preview.length === 0}>
          Cargar {preview.length} campos
        </Button>
      </div>
    </Modal>
  );
}
