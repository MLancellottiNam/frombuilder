import { FileSignature, Table2, Link2, Download, ArrowRight, Check, AlertTriangle } from 'lucide-react';
import { useStore } from '../store/store';
import { flattenFields } from '../lib/matching';
import { VERSION, BADGE } from '../version';

/** Celda de estado del proyecto (qué hay cargado hoy). */
function Estado({ label, valor, hecho }: { label: string; valor: string; hecho: boolean }) {
  return (
    <div
      className={`rounded-md border px-2.5 py-1.5 ${
        hecho ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {hecho && <Check size={11} className="text-emerald-600" />}
        {label}
      </div>
      <div
        className={`text-xs mt-0.5 truncate ${hecho ? 'text-emerald-800 font-medium' : 'text-slate-400'}`}
        title={valor}
      >
        {valor}
      </div>
    </div>
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
  /** la tarjeta se muestra como el paso recomendado para arrancar */
  destacada?: boolean;
}

function EtapaCard({
  n,
  titulo,
  icon,
  badge,
  necesita,
  produce,
  comoSeUsa,
  onClick,
  cta,
  destacada,
}: EtapaCardProps) {
  return (
    <button
      onClick={onClick}
      className={`group w-full text-left rounded-lg border bg-white p-4 hover:shadow-sm transition-all flex flex-col ${
        destacada
          ? 'border-brand-300 ring-1 ring-brand-100 hover:border-brand-500'
          : 'border-slate-200 hover:border-brand-400'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center justify-center w-7 h-7 rounded-md bg-brand-50 text-brand-700 shrink-0">
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Etapa {n}</span>
        {destacada && (
          <span className="text-[10px] font-medium bg-brand-600 text-white rounded px-1.5 py-0.5">Empezá acá</span>
        )}
        <div className="flex-1" />
        {badge && (
          <span className="text-[10px] font-mono bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{badge}</span>
        )}
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
  const etapa0 = project.etapa0;

  return (
    <div className="h-full overflow-y-auto scroll-thin bg-slate-100">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Encabezado */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-800">Signframe Form Builder</h1>
          <span
            className="rounded-full bg-slate-800 text-white text-[11px] font-mono px-2 py-0.5"
            title={BADGE}
            data-version
          >
            v{VERSION}
          </span>
        </div>
        <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
          Armá el JSON de definición de formularios de Signframe a partir de la ficha del INS y el PDF.
          Elegí por dónde arrancar.
        </p>

        {/* Estado actual */}
        <div className="mt-5">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
            Estado del proyecto
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <Estado
              label="Ficha"
              hecho={project.sourceFields.length > 0}
              valor={project.sourceFields.length > 0 ? `${project.sourceFields.length} campos` : 'sin cargar'}
            />
            <Estado
              label="Esqueleto"
              hecho={secciones > 0}
              valor={secciones > 0 ? `${secciones} secciones · ${campos} campos` : 'vacío'}
            />
            <Estado
              label="Campos PDF"
              hecho={project.acroForms.length > 0}
              valor={project.acroForms.length > 0 ? `${project.acroForms.length} campos` : 'sin cargar'}
            />
            <Estado label="Vinculados" hecho={bindeados > 0} valor={`${bindeados} con sourceMeta`} />
            <Estado label="PDF" hecho={!!pdfName} valor={pdfName ?? 'sin adjuntar'} />
          </div>
        </div>

        {/* Aviso duro de Etapa 0 */}
        <div className="mt-5 flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-600" />
          <p>
            <b>El renombrado del PDF (Etapa 0) va siempre antes</b> de cargar el PDF en Signframe. Si lo cargás
            primero, el <code>sourceMeta</code> queda clavado a los nombres genéricos del AcroForm.
          </p>
        </div>

        {/* Etapa 0, destacada como punto de entrada */}
        <div className="mt-6">
          <EtapaCard
            n="0"
            titulo="Campos del PDF"
            icon={<FileSignature size={15} />}
            badge={BADGE}
            destacada
            necesita="Solo el PDF crudo (la ficha es opcional)"
            produce="PDF renombrado + PDF con los nombres impresos + paquete de campos (xlsx)"
            comoSeUsa="Adentro: detectar campos, editarlos (nombre, tipo, caja, crear / borrar / trocear) y exportar el paquete. El mapeo se resuelve afuera y vuelve por «Cargar nombres»."
            cta={etapa0 ? 'Retomar' : 'Empezar por el PDF'}
            onClick={() => setView('etapa0')}
          />
          {etapa0 && (
            <p className="text-[11px] text-slate-400 mt-1.5">
              Hay trabajo guardado{etapa0.pdfNombre ? ` sobre «${etapa0.pdfNombre}»` : ''}. Volvé a adjuntar el PDF
              para retomarlo.
            </p>
          )}
        </div>

        {/* Etapas 1–3 */}
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mt-7 mb-1.5">
          Después, en el workspace
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <EtapaCard
            n="1"
            titulo="Generar el formulario"
            icon={<Table2 size={15} />}
            badge={BADGE}
            necesita="Ficha con la col N llena + el JSON main de Signframe"
            produce="El formulario armado, navegable por pasos, y el JSON que escribe"
            comoSeUsa="Adentro: cargar los tres archivos, «Generar», y revisar en dos paneles: el formulario y su payload en vivo."
            cta="Ir a generar"
            onClick={() => setView('etapa1')}
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
