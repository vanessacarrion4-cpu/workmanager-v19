// ─────────────────────────────────────────────────────────────────────────────
// DIAG-TEMP (sesión 15): instrumentación TEMPORAL para cazar en producción el fallo
// "completar desde el panel de tiempo no guarda". Quitar con `git revert` del commit
// de diagnóstico. Archivos del diagnóstico: diag.ts, DiagPanel.tsx + marcas `DIAG-TEMP`.
//
// La traza se guarda en localStorage (sobrevive a recargas — el fallo es en la 1ª carga)
// y se ve en un panel flotante (DiagPanel) con botón de copiar. Sin necesidad de consola.
// ─────────────────────────────────────────────────────────────────────────────

export type DiagEntry = { t: string; ms: number; step: string; data?: any };

const KEY = 'wm-diag-trace';
const T0KEY = 'wm-diag-t0';
let listeners: Array<() => void> = [];

function readT0(): number {
  let v = Number(localStorage.getItem(T0KEY));
  if (!v) { v = Date.now(); try { localStorage.setItem(T0KEY, String(v)); } catch { /* noop */ } }
  return v;
}
function load(): DiagEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function persist(entries: DiagEntry[]) {
  try { localStorage.setItem(KEY, JSON.stringify(entries.slice(-400))); } catch { /* noop */ }
  listeners.forEach(l => { try { l(); } catch { /* noop */ } });
}
function safe(d: any) {
  if (typeof d === 'undefined') return undefined;
  try { return JSON.parse(JSON.stringify(d)); } catch { return String(d); }
}

export function diag(step: string, data?: any) {
  const now = Date.now();
  const entries = load();
  const clock = new Date(now).toLocaleTimeString('es-ES', { hour12: false }) + '.' + String(now % 1000).padStart(3, '0');
  entries.push({ t: clock, ms: now - readT0(), step, data: safe(data) });
  persist(entries);
  try { console.log('[DIAG]', step, data ?? ''); } catch { /* noop */ }
}

export function getDiag(): DiagEntry[] { return load(); }
export function clearDiag() { try { localStorage.removeItem(T0KEY); } catch { /* noop */ } persist([]); }
export function subscribeDiag(fn: () => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}
