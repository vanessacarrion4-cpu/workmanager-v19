// ─────────────────────────────────────────────────────────────────────────────
// Avisos (B1, FASE 2 §16.3-2): bus a nivel de módulo, como diag().
// Las escrituras viven en HOOKS (no en componentes), así que el aviso se dispara
// importando `toast` directamente, sin enhebrar un callback por las options.
// El <ToastContainer/> (montado una vez en App) se suscribe y pinta la pila.
//
// AGRUPACIÓN (requisito): una acción en lote / un reordenado escriben muchas filas.
// Si fallan 20, NO queremos 20 avisos apilados: pasando la misma `key`, los fallos
// vivos se funden en UN aviso con contador. El texto puede depender del contador
// (message como función) para poder decir "No se pudieron guardar 20 tareas".
// ─────────────────────────────────────────────────────────────────────────────

export type ToastType = 'error' | 'warn' | 'success';

export interface Toast {
  id: number;
  type: ToastType;
  render: (count: number) => string; // texto; puede depender del contador (agrupación)
  detail?: string;
  count: number;
  sticky: boolean; // pegajoso = se queda hasta que lo cierre la usuaria
  key?: string;
}

export interface EmitOpts {
  detail?: string;
  key?: string; // mismos `key` vivos se funden en un solo aviso con contador
  sticky?: boolean; // override; por defecto error = pegajoso, warn/success = no
  ttlMs?: number; // vida de los no-pegajosos
}

type Message = string | ((count: number) => string);

const DEFAULT_TTL = 5000;

let seq = 0;
let toasts: Toast[] = [];
let listeners: Array<() => void> = [];
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function notify() {
  listeners.forEach(l => { try { l(); } catch { /* noop */ } });
}

function clearTimer(id: number) {
  const h = timers.get(id);
  if (h) { clearTimeout(h); timers.delete(id); }
}

function scheduleDismiss(id: number, ttlMs: number) {
  clearTimer(id);
  timers.set(id, setTimeout(() => dismiss(id), ttlMs));
}

function emit(type: ToastType, message: Message, opts: EmitOpts = {}): number {
  const render = typeof message === 'function' ? message : () => message;
  const sticky = opts.sticky ?? (type === 'error');
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL;

  // Agrupación: si hay un aviso vivo con la misma key, súmale en vez de apilar otro.
  if (opts.key) {
    const existing = toasts.find(t => t.key === opts.key);
    if (existing) {
      existing.count += 1;
      existing.render = render; // el texto puede depender del nuevo contador
      if (opts.detail !== undefined) existing.detail = opts.detail;
      if (!sticky) scheduleDismiss(existing.id, ttlMs);
      notify();
      return existing.id;
    }
  }

  const t: Toast = { id: ++seq, type, render, detail: opts.detail, count: 1, sticky, key: opts.key };
  toasts = [...toasts, t];
  if (!sticky) scheduleDismiss(t.id, ttlMs);
  notify();
  return t.id;
}

export function dismiss(id: number) {
  clearTimer(id);
  toasts = toasts.filter(t => t.id !== id);
  notify();
}

export const toast = {
  error: (message: Message, opts?: EmitOpts) => emit('error', message, opts),
  warn: (message: Message, opts?: EmitOpts) => emit('warn', message, opts),
  success: (message: Message, opts?: EmitOpts) => emit('success', message, opts),
  dismiss,
};

export function getToasts(): Toast[] { return toasts; }

export function subscribeToasts(fn: () => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

// Solo para tests: limpia estado y temporizadores.
export function __resetToasts() {
  timers.forEach(h => clearTimeout(h));
  timers.clear();
  toasts = [];
  seq = 0;
  listeners = [];
}
