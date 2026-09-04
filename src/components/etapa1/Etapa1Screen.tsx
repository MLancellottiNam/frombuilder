// ---------------------------------------------------------------------------
// Etapa 1 — Generador con preview de formulario y JSON en vivo (v3.0.0).
//
// Antes era un armador: se arrastraban campos del pool al canvas. Funcionaba,
// pero era lento y no contestaba las dos preguntas que importan: ¿cómo se ve el
// formulario? y ¿qué JSON escribe? La segunda no se podía ver en ningún lado
// hasta probar en Signframe.
//
// Ahora: cargar -> generar -> revisar en dos paneles, y los dos están
// conectados. Al llenar un campo, el valor aparece en su ruta del JSON; al
// clickear una ruta del JSON, se resalta el campo que la escribe.
//
// No hay preview del PDF a propósito: lo que el PDF escribe ya se sabe y se
// prueba en Signframe. Y no hay edición inline sobre la preview: se edita en el
// panel lateral, que es el Inspector que ya existía.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCopy,
  Eraser,
  FileSpreadsheet,
  FileText,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import { useStore } from '../../store/store';
import { BADGE } from '../../version';
import { Button } from '../ui';
import Inspector from '../Inspector';
import { buildFichaRaw, readFichaSheets, type FichaRawResult } from '../../lib/etapa0/fichaRaw';
import { extractAcroFromForm, flattenFields } from '../../lib/matching';
import { generarDesdeFicha, type ResultadoGeneracion } from '../../lib/etapa1/desdeFicha';
import {
  construirPayload,
  sinIndices,
  valoresDeEjemplo,
  type Diagnostico,
  type Valores,
} from '../../lib/etapa1/payload';
import type { AcroField, Field, FormDefinition } from '../../types';

const ANCHO_CLS: Record<string, string> = {
  full: 'w-full',
  half: 'w-[calc(50%-0.25rem)]',
  third: 'w-[calc(33.333%-0.34rem)]',
  quarter: 'w-[calc(25%-0.375rem)]',
  fit: 'w-auto',
};

/** Un campo como lo vería el usuario. Es una aproximación a Signframe. */
function CampoPreview({
  campo,
  valor,
  onChange,
  onSeleccionar,
  seleccionado,
  resaltado,
}: {
  campo: Field;
  valor: unknown;
  onChange: (v: unknown) => void;
  onSeleccionar: () => void;
  seleccionado: boolean;
  resaltado: boolean;
}) {
  const base =
    'rounded-md border px-2 py-1 text-xs w-full outline-none focus:border-brand-500 ' +
    (campo.readOnly ? 'bg-slate-100 text-slate-500' : 'bg-white border-slate-300');
  const marco = seleccionado
    ? 'ring-2 ring-brand-400'
    : resaltado
      ? 'ring-2 ring-amber-400'
      : 'hover:ring-1 hover:ring-slate-300';

  return (
    <div
      className={`${ANCHO_CLS[campo.width] ?? 'w-full'} rounded-md p-1.5 cursor-pointer ${marco}`}
      onClick={onSeleccionar}
      data-campo={campo.id}
      data-ancho={campo.width}
    >
      <label className="block text-[11px] text-slate-600 mb-0.5">
        {campo.type === 'radio' ? campo.radioGroupLabel || campo.label : campo.label}
        {campo.required && <span className="text-red-500"> *</span>}
        {!campo.salidaJSON && campo.sourceMeta && (
          <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 rounded px-1">sin ruta</span>
        )}
      </label>

      {campo.type === 'checkbox' || campo.type === 'radio' ? (
        <label className="flex items-center gap-1.5 text-xs text-slate-700">
          <input
            type={campo.type === 'radio' ? 'radio' : 'checkbox'}
            checked={valor === true}
            onChange={(e) => onChange(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            data-input={campo.id}
          />
          {campo.type === 'radio' ? campo.label : 'Sí'}
        </label>
      ) : campo.type === 'textarea' ? (
        <textarea
          value={String(valor ?? '')}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          rows={2}
          data-input={campo.id}
          className={base}
        />
      ) : campo.type === 'select' ? (
        <select
          value={String(valor ?? '')}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          data-input={campo.id}
          className={base}
        >
          <option value="">—</option>
          {(campo.options ?? []).map((o, i) => (
            <option key={i} value={String(o.jsonValue ?? o.label)}>
              {o.label}
            </option>
          ))}
        </select>
      ) : campo.type === 'signature' ? (
        <div className="rounded-md border border-dashed border-slate-300 px-2 py-3 text-center text-[10px] text-slate-400">
          firma
        </div>
      ) : (
        <input
          type={campo.type === 'number' ? 'number' : 'text'}
          value={String(valor ?? '')}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder={campo.type === 'date' ? 'dd/mm/aaaa' : ''}
          data-input={campo.id}
          className={base}
        />
      )}
    </div>
  );
}

export default function Etapa1Screen() {
  const setView = useStore((s) => s.setView);
  const importForm = useStore((s) => s.importForm);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const formStore = useStore((s) => s.project.form);

  const fichaInput = useRef<HTMLInputElement>(null);
  const mainInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);

  const [ficha, setFicha] = useState<FichaRawResult | null>(null);
  const [fichaNombre, setFichaNombre] = useState('');
  const [main, setMain] = useState<AcroField[]>([]);
  const [mainNombre, setMainNombre] = useState('');
  const [referencia, setReferencia] = useState<FormDefinition | null>(null);
  const [refNombre, setRefNombre] = useState('');
  const [gen, setGen] = useState<ResultadoGeneracion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [valores, setValores] = useState<Valores>({});
  const [paso, setPaso] = useState(0);
  const [deCorrido, setDeCorrido] = useState(false);
  const [rutaResaltada, setRutaResaltada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // --- carga ---------------------------------------------------------------

  const onFicha = async () => {
    const f = fichaInput.current?.files?.[0];
    if (!f) return;
    setError(null);
    try {
      setFicha(buildFichaRaw(await readFichaSheets(await f.arrayBuffer())));
      setFichaNombre(f.name);
    } catch (e) {
      setError('Ficha: ' + String(e));
    }
    if (fichaInput.current) fichaInput.current.value = '';
  };

  const onMain = async () => {
    const f = mainInput.current?.files?.[0];
    if (!f) return;
    setError(null);
    try {
      const json = JSON.parse(await f.text());
      const acro = extractAcroFromForm(json);
      if (acro.length === 0) throw new Error('el JSON no tiene campos con sourceMeta');
      setMain(acro);
      setMainNombre(f.name);
    } catch (e) {
      setError('JSON main: ' + String(e));
    }
    if (mainInput.current) mainInput.current.value = '';
  };

  const onReferencia = async () => {
    const f = refInput.current?.files?.[0];
    if (!f) return;
    setError(null);
    try {
      setReferencia(JSON.parse(await f.text()) as FormDefinition);
      setRefNombre(f.name);
    } catch (e) {
      setError('Form-def de referencia: ' + String(e));
    }
    if (refInput.current) refInput.current.value = '';
  };

  const generar = () => {
    if (!ficha) return;
    setError(null);
    try {
      const r = generarDesdeFicha({ ficha, main });
      setGen(r);
      setValores({});
      setPaso(0);
      // El form va al store para que el Inspector y el validador trabajen sobre
      // él sin duplicar estado.
      importForm(r.form, r.sourceFields);
    } catch (e) {
      setError('No se pudo generar: ' + String(e));
    }
  };

  // --- payload en vivo -----------------------------------------------------

  const rutasDeclaradas = useMemo(
    () => (ficha ? ficha.rows.filter((r) => r.campoJson.trim()).map((r) => r.campoJson.trim()) : []),
    [ficha],
  );

  const form = gen ? formStore : null;

  const payload = useMemo(() => {
    if (!form) return null;
    return construirPayload({ form, valores, rutasDeclaradas, huecos: gen?.huecos });
  }, [form, valores, rutasDeclaradas, gen]);

  const campos = useMemo(() => (form ? flattenFields(form) : []), [form]);
  const secciones = form?.sections ?? [];
  const visibles = deCorrido ? secciones : secciones.slice(paso, paso + 1);

  const idsDeRuta = (ruta: string): string[] => payload?.porRuta.get(ruta) ?? [];

  /** Al clickear una rama del JSON, resaltar y traer a la vista el campo. */
  const irARuta = (ruta: string) => {
    setRutaResaltada(ruta);
    const ids = idsDeRuta(ruta);
    if (ids.length === 0) return;
    const i = secciones.findIndex((s) =>
      [...s.fields, ...s.subsections.flatMap((x) => x.fields)].some((f) => ids.includes(f.id)),
    );
    if (i >= 0 && !deCorrido) setPaso(i);
    select({ kind: 'field', id: ids[0] });
    setTimeout(() => {
      document.querySelector(`[data-campo="${ids[0]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 30);
  };

  const copiar = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload.json);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      setError('El navegador no dejó copiar al portapapeles.');
    }
  };

  const seleccionado = selection?.kind === 'field' ? selection.id : null;
  const resaltados = new Set(rutaResaltada ? idsDeRuta(rutaResaltada) : []);

  // Patrones del form-def de referencia (§4.5): sugerencia con diff, nunca
  // automático. Por ahora se compara el ancho canónico por tipo.
  const sugerencias = useMemo(() => {
    if (!referencia || !form) return [];
    const canon = new Map<string, string>();
    for (const c of flattenFields(referencia)) {
      if (!canon.has(c.type)) canon.set(c.type, c.width);
    }
    const out: { id: string; label: string; de: string; a: string }[] = [];
    for (const c of campos) {
      const w = canon.get(c.type);
      if (w && w !== c.width) out.push({ id: c.id, label: c.label, de: c.width, a: w });
    }
    return out;
  }, [referencia, form, campos]);

  const aplicarSugerencias = () => {
    const patch = useStore.getState().updateField;
    for (const s of sugerencias) patch(s.id, { width: s.a as Field['width'] });
  };

  useEffect(() => {
    if (!gen) return;
    setRutaResaltada(null);
  }, [gen]);

  // --- UI ------------------------------------------------------------------

  const errores = payload?.diagnosticos.filter((d) => d.severidad === 'error') ?? [];
  const avisos = payload?.diagnosticos.filter((d) => d.severidad === 'aviso') ?? [];

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      <header className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200 shrink-0 flex-wrap">
        <Button onClick={() => setView('home')}>
          <ArrowLeft size={15} /> Inicio
        </Button>
        <span className="font-bold text-slate-800 flex items-center gap-1.5">
          <Wand2 size={16} /> Etapa 1 · Generar el formulario
        </span>
        <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">{BADGE}</span>
        {gen && (
          <span className="text-[11px] text-slate-600 ml-2" data-contadores>
            <b>{gen.stats.campos}</b> campos · <b className="text-emerald-700">{gen.stats.conSourceMeta}</b>{' '}
            vinculados ·{' '}
            <b className={gen.sinVincular.length ? 'text-red-600' : 'text-slate-500'}>{gen.sinVincular.length}</b> sin
            vincular · {gen.stats.secciones} pasos
          </span>
        )}
        <div className="flex-1" />
        <Button onClick={() => setView('builder')} title="El armador manual sigue disponible">
          Workspace
        </Button>
      </header>

      {/* --- ventana de carga --- */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200 shrink-0 flex-wrap text-xs">
        <input ref={fichaInput} type="file" accept=".xlsx,.xls" hidden onChange={onFicha} />
        <input ref={mainInput} type="file" accept=".json" hidden onChange={onMain} />
        <input ref={refInput} type="file" accept=".json" hidden onChange={onReferencia} />
        <Button onClick={() => fichaInput.current?.click()} data-cargar="ficha">
          <FileSpreadsheet size={14} /> Ficha con col N{ficha ? ' ✓' : ''}
        </Button>
        <span className="text-slate-400 max-w-[160px] truncate">{fichaNombre}</span>
        <Button onClick={() => mainInput.current?.click()} data-cargar="main">
          <FileText size={14} /> JSON main{main.length ? ` ✓ (${main.length})` : ''}
        </Button>
        <span className="text-slate-400 max-w-[160px] truncate">{mainNombre}</span>
        <Button onClick={() => refInput.current?.click()} data-cargar="referencia">
          <Upload size={14} /> Form-def de referencia{referencia ? ' ✓' : ''}
        </Button>
        <span className="text-slate-400 max-w-[140px] truncate">{refNombre}</span>
        <div className="flex-1" />
        <Button onClick={generar} disabled={!ficha} data-generar>
          <Sparkles size={14} /> Generar
        </Button>
      </div>

      {error && (
        <p className="px-3 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200" data-error>
          {error}
        </p>
      )}

      {!gen && (
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <div className="max-w-2xl mx-auto rounded-lg border border-slate-200 bg-white p-5 text-sm">
            <h2 className="font-semibold text-slate-800">Cargar y generar</h2>
            <p className="mt-1 text-slate-600 text-xs">
              La <b>ficha con la col N llena</b> es lo único obligatorio: de ahí salen secciones, labels, tipos,
              opciones, validaciones y rutas JSON.
            </p>
            <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
              <li>
                <b>JSON main de Signframe</b> (recomendado): trae el <code>sourceMeta</code> real —
                <code>sourceName</code>, <code>page</code>, <code>rect</code>—. Sin él se genera igual, pero los campos{' '}
                <b>no pintan el PDF</b> y los anchos quedan todos en «full».
              </li>
              <li>
                <b>Form-def de referencia</b> (opcional): un formulario ya terminado, para copiarle patrones. Se ofrece
                como sugerencia con diff, nunca automático.
              </li>
            </ul>
            {ficha && (
              <p className="mt-3 text-xs text-emerald-700">
                Ficha leída: {new Set(ficha.rows.map((r) => r.hoja)).size} hojas · {ficha.rows.length} filas de datos.
              </p>
            )}
          </div>
        </div>
      )}

      {gen && (
        <div className="flex-1 min-h-0 flex gap-2 p-3">
          {/* ---------- izquierda: el formulario ---------- */}
          <div className="w-1/2 min-w-0 flex flex-col rounded-md border border-slate-200 bg-white">
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200 text-xs flex-wrap">
              <span className="font-medium text-slate-700">Formulario</span>
              {!deCorrido && secciones.length > 0 && (
                <>
                  <button
                    onClick={() => setPaso((p) => Math.max(0, p - 1))}
                    disabled={paso === 0}
                    data-paso-anterior
                    className="rounded border border-slate-300 px-1.5 py-0.5 disabled:opacity-30"
                  >
                    Anterior
                  </button>
                  <span className="text-slate-500" data-paso>
                    Paso {paso + 1} de {secciones.length} · {secciones[paso]?.title}
                    {secciones[paso]?.hidden ? ' (oculta)' : ''}
                  </span>
                  <button
                    onClick={() => setPaso((p) => Math.min(secciones.length - 1, p + 1))}
                    disabled={paso >= secciones.length - 1}
                    data-paso-siguiente
                    className="rounded border border-slate-300 px-1.5 py-0.5 disabled:opacity-30"
                  >
                    Siguiente
                  </button>
                </>
              )}
              <label className="flex items-center gap-1 text-slate-500">
                <input type="checkbox" checked={deCorrido} onChange={(e) => setDeCorrido(e.target.checked)} data-de-corrido />
                ver todo de corrido
              </label>
              <div className="flex-1" />
              <button
                onClick={() => setValores(valoresDeEjemplo(form!))}
                data-llenar
                className="inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-white"
              >
                <Sparkles size={12} /> Llenar de ejemplo
              </button>
              <button
                onClick={() => setValores({})}
                data-limpiar
                className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-slate-600"
              >
                <Eraser size={12} /> Limpiar
              </button>
            </div>

            <div className="flex-1 overflow-auto scroll-thin p-2">
              {sugerencias.length > 0 && (
                <div className="mb-2 rounded-md border border-brand-300 bg-brand-50/40 px-2.5 py-2 text-[11px]" data-sugerencias>
                  <b>{sugerencias.length} campos</b> tienen un ancho distinto al canónico del form-def de referencia (
                  {sugerencias.slice(0, 3).map((s) => `${s.label}: ${s.de}→${s.a}`).join(' · ')}
                  {sugerencias.length > 3 ? ' …' : ''}).
                  <button onClick={aplicarSugerencias} data-aplicar-sugerencias className="ml-2 rounded bg-brand-600 px-2 py-0.5 text-white">
                    Aplicar
                  </button>
                </div>
              )}

              {visibles.map((sec) => (
                <div key={sec.id} className="mb-4" data-seccion={sec.title}>
                  <h3 className="text-xs font-semibold text-slate-700 border-b border-slate-100 pb-1 mb-1.5">
                    {sec.title}
                    {sec.hidden && (
                      <span className="ml-1.5 text-[9px] bg-slate-200 text-slate-600 rounded px-1">
                        oculta · contrato JSON
                      </span>
                    )}
                  </h3>
                  {sec.subsections.map((sub) => (
                    <div key={sub.id} className="mb-2">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">{sub.title}</div>
                      <div className="flex flex-wrap">
                        {sub.fields.map((c) => (
                          <CampoPreview
                            key={c.id}
                            campo={c}
                            valor={valores[c.id]}
                            onChange={(v) => setValores((p) => ({ ...p, [c.id]: v }))}
                            onSeleccionar={() => select({ kind: 'field', id: c.id })}
                            seleccionado={seleccionado === c.id}
                            resaltado={resaltados.has(c.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap">
                    {sec.fields.map((c) => (
                      <CampoPreview
                        key={c.id}
                        campo={c}
                        valor={valores[c.id]}
                        onChange={(v) => setValores((p) => ({ ...p, [c.id]: v }))}
                        onSeleccionar={() => select({ kind: 'field', id: c.id })}
                        seleccionado={seleccionado === c.id}
                        resaltado={resaltados.has(c.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ---------- derecha: el JSON ---------- */}
          <div className="w-1/2 min-w-0 flex flex-col gap-2 min-h-0">
            <div className="flex flex-col rounded-md border border-slate-200 bg-white flex-1 min-h-0">
              <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200 text-xs">
                <span className="font-medium text-slate-700">JSON de salida</span>
                <span className="text-slate-400">el payload que se le entrega al INS</span>
                <div className="flex-1" />
                <button
                  onClick={copiar}
                  data-copiar
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-slate-600"
                >
                  <ClipboardCopy size={12} /> {copiado ? 'copiado' : 'copiar'}
                </button>
              </div>

              {/* cobertura del contrato */}
              {payload && (
                <div className="px-2.5 py-1.5 border-b border-slate-100 text-[11px] text-slate-600" data-cobertura>
                  La ficha declara <b>{payload.cobertura.declaradas}</b> rutas · el formulario escribe{' '}
                  <b className="text-emerald-700">{payload.cobertura.escritas}</b> · faltan{' '}
                  <b className={payload.cobertura.faltantes.length ? 'text-amber-600' : 'text-slate-400'}>
                    {payload.cobertura.faltantes.length}
                  </b>
                  {payload.cobertura.faltantes.length > 0 && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-slate-400">ver las que faltan</summary>
                      <ul className="mt-0.5 list-disc pl-4 font-mono text-[10px] text-slate-500 max-h-24 overflow-auto">
                        {payload.cobertura.faltantes.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-auto scroll-thin">
                <pre className="p-2 text-[10px] leading-tight font-mono text-slate-700 whitespace-pre" data-json>
                  {payload?.json ?? '{}'}
                </pre>
              </div>

              {/* rutas clickeables */}
              {payload && payload.porRuta.size > 0 && (
                <details className="border-t border-slate-100 text-[11px]">
                  <summary className="cursor-pointer px-2.5 py-1 text-slate-500" data-ver-rutas>
                    {payload.porRuta.size} rutas · click para ir al campo que la escribe
                  </summary>
                  <ul className="max-h-40 overflow-auto px-2.5 pb-2">
                    {[...payload.porRuta.entries()].map(([ruta, ids]) => (
                      <li key={ruta}>
                        <button
                          onClick={() => irARuta(ruta)}
                          data-ruta={ruta}
                          className={`text-left font-mono text-[10px] hover:underline ${
                            rutaResaltada === ruta ? 'text-brand-700 font-semibold' : 'text-slate-600'
                          }`}
                        >
                          {sinIndices(ruta) !== ruta ? ruta : ruta} {ids.length > 1 ? `(${ids.length} campos)` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {/* diagnósticos */}
            <div className="rounded-md border border-slate-200 bg-white max-h-[38%] flex flex-col" data-diagnosticos>
              <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200 text-xs">
                <span className="font-medium text-slate-700">Diagnósticos</span>
                <span className={errores.length ? 'text-red-600' : 'text-slate-400'}>
                  {errores.length} error{errores.length === 1 ? '' : 'es'}
                </span>
                <span className="text-amber-600">{avisos.length} avisos</span>
                {gen.sinVincular.length > 0 && (
                  <span className="text-red-600">· {gen.sinVincular.length} sin vincular</span>
                )}
              </div>
              <div className="flex-1 overflow-auto scroll-thin p-2 space-y-1">
                {errores.length === 0 && avisos.length === 0 && (
                  <p className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                    <CheckCircle2 size={13} /> Sin problemas detectados.
                  </p>
                )}
                {[...errores, ...avisos].map((d, i) => (
                  <Fila key={i} d={d} onIr={() => d.ruta && irARuta(d.ruta)} />
                ))}
                {gen.reglasSinInterpretar.length > 0 && (
                  <details className="text-[11px] text-slate-500">
                    <summary className="cursor-pointer">
                      {gen.reglasSinInterpretar.length} reglas de las cols G/K que no se interpretaron
                    </summary>
                    <ul className="mt-0.5 list-disc pl-4 max-h-24 overflow-auto">
                      {gen.reglasSinInterpretar.slice(0, 40).map((r, i) => (
                        <li key={i}>
                          {r.hoja}·{r.fila}: {r.crudo}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </div>

          {/* ---------- panel lateral: el Inspector que ya existía ---------- */}
          {seleccionado && (
            <div className="w-72 shrink-0 overflow-auto scroll-thin rounded-md border border-slate-200 bg-white p-2" data-inspector>
              <Inspector />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Fila({ d, onIr }: { d: Diagnostico; onIr: () => void }) {
  const color =
    d.severidad === 'error' ? 'border-red-300 bg-red-50 text-red-700' : 'border-amber-300 bg-amber-50 text-amber-800';
  return (
    <div className={`flex items-start gap-1.5 rounded border px-2 py-1 text-[11px] ${color}`} data-diag={d.tipo}>
      <AlertTriangle size={12} className="mt-[2px] shrink-0" />
      <span className="flex-1">{d.mensaje}</span>
      {d.ruta && (
        <button onClick={onIr} className="shrink-0 underline decoration-dotted">
          ir
        </button>
      )}
    </div>
  );
}
