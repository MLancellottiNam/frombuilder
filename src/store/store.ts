// ---------------------------------------------------------------------------
// Estado de la app (v3.0.0).
//
// El store se redujo con el recorte a Etapa 0. Antes modelaba el árbol del
// form-definition —secciones, subsecciones, campos con sus propiedades de UI,
// condicionales, pool de campos sin colocar— y todo eso se fue con Etapa 1: el
// form-def lo genera la skill, afuera.
//
// Lo que queda es lo mínimo para que el trabajo sobreviva a un refresh: el
// nombre del proyecto y las decisiones de Etapa 0 (ediciones de nombre y tipo,
// campos creados, borrados, geometría editada). Los ARCHIVOS no se guardan: al
// retomar se vuelven a adjuntar y el estado se re-hidrata por nombre de campo.
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import type { Etapa0State, Project } from '../types';

export interface AppState {
  project: Project;
  /** nombre del PDF adjunto (transitorio: no se persiste) */
  pdfName: string | null;

  setProjectName: (name: string) => void;
  setEtapa0: (e: Etapa0State) => void;
  setPdfName: (name: string | null) => void;
  loadProject: (p: Project) => void;
  resetProject: () => void;
}

function proyectoVacio(): Project {
  return { name: 'formulario', etapa0: undefined };
}

export const useStore = create<AppState>((set) => ({
  project: proyectoVacio(),
  pdfName: null,

  setProjectName: (name) => set((s) => ({ project: { ...s.project, name } })),
  setEtapa0: (e) => set((s) => ({ project: { ...s.project, etapa0: e } })),
  setPdfName: (name) => set({ pdfName: name }),
  loadProject: (p) => set({ project: { name: p.name ?? 'formulario', etapa0: p.etapa0 } }),
  resetProject: () => set({ project: proyectoVacio(), pdfName: null }),
}));
