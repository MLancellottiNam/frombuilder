import { FileSignature, Table2, Link2, Download, ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { useStore } from '../store/store';
import { flattenFields } from '../lib/matching';

/** Chip de estado del proyecto (qué hay cargado hoy). */
function Estado({ hecho, children }: { hecho: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        hecho ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {hecho ? <CheckCircle2 size={13} /> : <Circle size={13} />}
      {children}
    </span>
  );
}

interface EtapaCardProps {
  n: string;
  titulo: string;
  icon: React.ReactNode;
  badge?: string;
  necesita: string;
  produce: string;
  comoSeUsa: string;
  onClick: () => void;
  cta: string;
}

function EtapaCard({ n, titulo, icon, badge, necesita, produce, comoSeUsa, onClick, cta }: EtapaCardProps) {
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-400 hover:shadow-sm transition-all flex flex-col"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center justify-center w-7 h-7 rounded-md bg-brand-50 text-brand-700">{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Etapa {n}</span>
        {badge && <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">{badge}</span>}
      </div>
      <h3 className="text-sm font-semibold text-slate-800 mb-2">{titulo}</h3>
      <dl className="text-[11px] text-slate-500 space-y-1 flex-1">
        <div>
          <dt className="inline font-medium text-slate-600">Necesita: </dt>
          <dd className="inline">{necesita}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-slate-600">Produce: </dt>
          <dd className="inline">{produce}</dd>
        </div>
        <div className="text-slate-400 pt-1">{comoSeUsa}</div>
      </dl>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 group-hover:gap-2 transition-all">
        {cta} <ArrowRight size={13} />
      </span>
    </button>
  );
}

export default function Home() {
  const setView = useStore((s) => s.setView);
  const project = useStore((s) => s.project);
  const pdfName = useStore((s) => s.pdfName);

  const campos = flattenFields(project.form).length;
  const secciones = project.form.sections.length;
  const bindeados = flattenFields(project.form).filter((f) => f.sourceMeta).length;

  return (
    <div className="h-full overflow-y-auto scroll-thin bg-slate-100">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-800">Signframe Form Builder</h1>
        <p className="text-sm text-slate-500 mt-1">
          Armá el JSON de definición de formularios de Signframe a partir de la ficha del INS y el PDF.
          Elegí por dónde arrancar.
        </p>

        {/* Estado actual */}
        <div className="flex flex-wrap gap-2 mt-4">
          <Estado hecho={project.sourceFields.length > 0}>
            Ficha: {project.sourceFields.length > 0 ? `${project.sourceFields.length} campos` : 'sin cargar'}
          </Estado>
          <Estado hecho={secciones > 0}>
            Esqueleto: {secciones > 0 ? `${secciones} secciones · ${campos} campos` : 'vacío'}
          </Estado>
          <Estado hecho={project.acroForms.length > 0}>
            Campos PDF: {project.acroForms.length > 0 ? `${project.acroForms.length}` : 'sin cargar'}
          </Estado>
          <Estado hecho={bindeados > 0}>Vinculados: {bindeados}</Estado>
          <Estado hecho={!!pdfName}>PDF: {pdfName ?? 'sin adjuntar'}</Estado>
        </div>

        {/* Aviso duro de Etapa 0 */}
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <b>Importante:</b> el renombrado del PDF (Etapa 0) va <b>siempre antes</b> de cargar el PDF en Signframe.
          Si lo cargás primero, el <code>sourceMeta</code> queda clavado a los nombres genéricos del AcroForm.
        </div>

        {/* Etapas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
          <EtapaCard
            n="0"
            titulo="Renombrado asistido"
            icon={<FileSignature size={15} />}
            badge="v1.0.0 · análisis"
            necesita="Ficha cruda del INS (col N vacía) + PDF crudo"
            produce="PDF renombrado + ficha con la col N llena"
            comoSeUsa="Por ahora: análisis de la ficha cruda (hojas, exclusiones y qué fila va al PDF)."
            cta="Analizar ficha cruda"
            onClick={() => setView('etapa0')}
          />
          <EtapaCard
            n="1"
            titulo="Armar el esqueleto"
            icon={<Table2 size={15} />}
            necesita="Ficha ya mapeada (col N llena), xlsx o CSV"
            produce="Secciones → subsecciones → campos ordenados, con radios y condiciones"
            comoSeUsa="Adentro: botón «Matriz» → modo «Etapa 1 · Armar ordenado»."
            cta="Ir al workspace"
            onClick={() => setView('builder')}
          />
          <EtapaCard
            n="2"
            titulo="Unir con el PDF"
            icon={<Link2 size={15} />}
            necesita="JSON main de Signframe (auto-mapeado del PDF)"
            produce="Campos con sourceMeta real e id autoritativo (Regla de Oro)"
            comoSeUsa="Adentro: «Campos PDF» para cargar el JSON main, después «Unir»."
            cta="Ir al workspace"
            onClick={() => setView('builder')}
          />
          <EtapaCard
            n="3"
            titulo="Exportar"
            icon={<Download size={15} />}
            necesita="El esqueleto ya armado y vinculado"
            produce="form-definition JSON, o la matriz plana en CSV / xlsx"
            comoSeUsa="Adentro: «Exportar ▾». Revisá antes el panel de validaciones."
            cta="Ir al workspace"
            onClick={() => setView('builder')}
          />
        </div>

        <p className="text-[11px] text-slate-400 mt-6">
          La última milla (<code>autoFillConcat</code>, repeaters, <code>excludeFromJson</code>) se arma con la skill{' '}
          <code>signframe-form-def</code> sobre el esqueleto exportado.
        </p>
      </div>
    </div>
  );
}
