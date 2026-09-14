// ---------------------------------------------------------------------------
// La app (v3.0.0).
//
// Una sola pantalla. Antes había un selector de etapas, un workspace con
// drag&drop y tres pantallas más; el recorte a Etapa 0 dejó lo mecánico, que es
// lo único que se puede congelar: leer el PDF, editar sus campos, renombrarlo y
// exportar el paquete. El mapeo y el form-def los resuelve la skill, afuera.
// ---------------------------------------------------------------------------

import Etapa0Screen from './components/etapa0/Etapa0Screen';

export default function App() {
  return <Etapa0Screen />;
}
