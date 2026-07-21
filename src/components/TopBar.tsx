import { useRef, useState } from 'react';
import { Upload, FileJson, Download, Save, FolderOpen, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useStore } from '../store/store';
import { runValidations, errorCount } from '../lib/validation';
import { buildExport, downloadJson, slugify } from '../lib/exporter';
import type { FormDefinition, Project } from '../types';
import { Button } from './ui';
import CsvImportDialog from './CsvImportDialog';
import ValidationPanel from './ValidationPanel';

export default function TopBar() {
  const project = useStore((s) => s.project);
  const importForm = useStore((s) => s.importForm);
  const loadProject = useStore((s) => s.loadProject);
  const setProjectName = useStore((s) => s.setProjectName);

  const csvInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  const errors = errorCount(runValidations(project));

  const readFile = (input: HTMLInputElement | null, cb: (text: string) => void) => {
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result));
    reader.readAsText(file);
    input.value = '';
  };

  const onImportJson = (text: string) => {
    try {
      const form = JSON.parse(text) as FormDefinition;
      if (!Array.isArray(form.sections)) throw new Error('sin sections[]');
      importForm(form);
    } catch (e) {
      alert('JSON de form-definition inválido: ' + (e as Error).message);
    }
  };

  const onLoadProject = (text: string) => {
    try {
      const proj = JSON.parse(text) as Project;
      if (!proj.form || !Array.isArray(proj.sourceFields)) throw new Error('formato de proyecto inválido');
      loadProject(proj);
    } catch (e) {
      alert('Proyecto inválido: ' + (e as Error).message);
    }
  };

  const doExport = () => {
    if (errors > 0 && !confirm(`Hay ${errors} validación(es) con errores. ¿Exportar igualmente?`)) return;
    const out = buildExport(project.form);
    downloadJson(out, `form-definition-${slugify(project.name)}.json`);
  };

  const doSaveProject = () => downloadJson(project, `proyecto-${slugify(project.name)}.json`);

  return (
    <>
      <header className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200">
        <span className="font-bold text-slate-800 mr-1">Signframe Builder</span>
        <input
          value={project.name}
          onChange={(e) => setProjectName(e.target.value)}
          className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          title="Nombre del proyecto / archivo"
        />
        <div className="flex-1" />

        <input ref={csvInput} type="file" accept=".csv,.txt" hidden onChange={() => readFile(csvInput.current, setCsvText)} />
        <input ref={jsonInput} type="file" accept=".json" hidden onChange={() => readFile(jsonInput.current, onImportJson)} />
        <input ref={projectInput} type="file" accept=".json" hidden onChange={() => readFile(projectInput.current, onLoadProject)} />

        <Button onClick={() => csvInput.current?.click()}>
          <Upload size={15} /> CSV
        </Button>
        <Button onClick={() => jsonInput.current?.click()}>
          <FileJson size={15} /> Importar JSON
        </Button>
        <Button onClick={doSaveProject} title="Guardar proyecto (.json)">
          <Save size={15} /> Proyecto
        </Button>
        <Button onClick={() => projectInput.current?.click()} title="Cargar proyecto (.json)">
          <FolderOpen size={15} />
        </Button>

        <button
          onClick={() => setShowValidation(true)}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${
            errors > 0 ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'
          }`}
        >
          {errors > 0 ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}
          {errors > 0 ? `${errors} errores` : 'OK'}
        </button>

        <Button variant="primary" onClick={doExport}>
          <Download size={15} /> Exportar
        </Button>
      </header>

      {csvText !== null && <CsvImportDialog text={csvText} onClose={() => setCsvText(null)} />}
      {showValidation && <ValidationPanel onClose={() => setShowValidation(false)} />}
    </>
  );
}
