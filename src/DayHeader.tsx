// DayHeader.tsx — TRAMO 1 (CABECERA + FOTO). Sustituye a las 3 tarjetas (Pendientes/Pendiente/Registrado).
// Sin caja: contenido directo sobre el fondo, al margen de las filas. Reglas de cálculo en §16.8 (getStatsForDay).
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Camera } from 'lucide-react';
import { DayStats, EntradaForDay } from './filters';
import { formatMinutes } from './utils';
import { TAG_LABELS } from './constants';
import { DaySnapshot } from './useDaySnapshot';

const DESGLOSE_KEY = 'wm_desglose_open';
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const tagLabel = (tag: string): string => (TAG_LABELS as any)[tag]?.label || tag;
const tagIcon = (tag: string): string => (TAG_LABELS as any)[tag]?.icon || '•';

function fmtSigned(minutes: number): string {
  const s = minutes < 0 ? '−' : '+';
  return `${s}${formatMinutes(Math.abs(minutes))}`;
}
function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// "jueves 21" a partir de 'YYYY-MM-DD' (fecha local, sin desfase de zona)
function diaLargo(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return `${WEEKDAYS[date.getDay()]} ${d}`;
}

export function DayHeader({
  stats, blocks, latest, jornada, entrada, onFijar, onSetJornada, onOpenTimeHistory, onOpenReport,
}: {
  stats: DayStats;
  blocks: any[];
  latest: DaySnapshot | null;
  jornada: number;
  entrada: EntradaForDay | null; // TRAMO 2: qué se creó el día que miro
  onFijar: () => void;
  onSetJornada: (min: number) => void;
  onOpenTimeHistory: () => void; // restaura el "Ver historial" que colgaba de la tarjeta Registrado (sesión 26)
  onOpenReport: () => void;      // TRAMO 4: abre el Reporte del día
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(DESGLOSE_KEY) === '1'; } catch { return false; }
  });
  const toggle = () => setOpen(o => { const n = !o; try { localStorage.setItem(DESGLOSE_KEY, n ? '1' : '0'); } catch {} return n; });
  const [entOpen, setEntOpen] = useState(false); // lista de entradas (efímera, no persiste)

  // Aviso de sobreplanificación (al fijar, si el estimado del día supera la jornada). No bloquea.
  const [overWarn, setOverWarn] = useState<number | null>(null);
  const doFijar = () => {
    onFijar();
    if (stats.estimatedTotal > jornada) setOverWarn(stats.estimatedTotal); else setOverWarn(null);
  };

  const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const blockName = (id: string) => blocks.find((b: any) => b.id === id)?.name || '—';
  const blockColor = (id: string) => blocks.find((b: any) => b.id === id)?.color || '#888';
  const maxBlock = stats.byBlock.length ? stats.byBlock[0].minutes : 1;
  const maxTag = stats.byTag.length ? stats.byTag[0].minutes : 1;

  return (
    <div className="pt-1 pb-2">
      {/* FILA PRINCIPAL — izquierda y derecha a la MISMA línea base (items-end). Único acento = turquesa (lo accionable). */}
      <div className="flex items-end justify-between gap-8 flex-wrap">
        {/* IZQUIERDA: los dos datos que miro cada día, con aire */}
        <div className="flex items-end gap-8">
          {/* FALTAN */}
          <div className="flex flex-col leading-none">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] dark:text-text-secondary text-text-secondary-light">Faltan</span>
            <span className="text-5xl font-black dark:text-white text-text-main-light tabular-nums mt-1.5">{stats.pending}</span>
          </div>
          {/* hechas / pendiente — neutro (el color no aporta significado aquí) */}
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light">{stats.completed} hechas de {stats.total}</span>
            <span className="mt-0.5">
              <span className="text-xl font-black dark:text-white text-text-main-light tabular-nums">{formatMinutes(stats.estimatedPending)}</span>
              <span className="ml-1 text-[11px] font-bold dark:text-text-secondary text-text-secondary-light">pendiente</span>
            </span>
          </div>
        </div>

        {/* DERECHA: comparación (una unidad) + acciones de bajo peso, todo a la misma base */}
        <div className="flex items-end gap-6">
          {/* COMPARACIÓN: la misma medida vista dos veces — etiqueta común y números enfrentados (§16.8 a propósito, p2) */}
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[9px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Estimado vs registrado hoy</span>
            <div className="flex items-baseline gap-2.5 mt-0.5">
              <span className="text-xl font-black dark:text-white text-text-main-light tabular-nums">{formatMinutes(stats.estimatedCompleted)}</span>
              <span className="w-px h-4 self-center dark:bg-border-main bg-border-main-light" />
              <span className="text-xl font-black dark:text-white text-text-main-light tabular-nums">{formatMinutes(stats.registered)}</span>
              <button
                onClick={onOpenTimeHistory}
                title="Ver historial de tiempos registrados"
                className="text-[10px] font-black uppercase tracking-wider text-turquesa hover:underline self-center"
              >historial ›</button>
            </div>
          </div>

          {/* ACCIONES ocasionales: bajo peso, como enlaces (no compiten con los datos) */}
          <div className="flex items-center gap-4 pb-1">
            <button
              onClick={doFijar}
              title="Fijar el día: guarda cuántas tareas y cuánto tiempo tienes previstos ahora. Luego verás lo que se añada."
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-turquesa hover:underline"
            >
              <Camera size={13} /> {latest ? 'Re-fijar' : 'Fijar'}
            </button>
            <button onClick={toggle} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-turquesa hover:underline">
              Desglose {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            <button onClick={onOpenReport} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-turquesa hover:underline">
              Reporte ›
            </button>
          </div>
        </div>
      </div>

      {/* LÍNEA DE LA FOTO (si hay fijación hoy) */}
      {latest && (
        <div className="mt-1.5 text-[11px] font-bold dark:text-text-secondary text-text-secondary-light">
          Fijado a las {hhmm(latest.taken_at)}
          <span className="mx-1.5 opacity-40">·</span>
          <span className="tabular-nums">{fmtSigned0(stats.total - latest.task_count)} tarea{Math.abs(stats.total - latest.task_count) === 1 ? '' : 's'}</span>
          <span className="mx-1.5 opacity-40">·</span>
          <span className="tabular-nums">{fmtSigned(stats.estimatedTotal - latest.estimated_minutes)}</span>
        </div>
      )}

      {/* TRAMO 2 · ENTRADA DEL DÍA — qué se creó el día que miro. Solo se muestra si entró algo (día sin creaciones = sin ruido). */}
      {entrada && entrada.total > 0 && (
        <div className="mt-1.5">
          <button
            onClick={() => setEntOpen(o => !o)}
            className="flex items-center gap-1.5 text-[11px] font-bold dark:text-text-secondary text-text-secondary-light hover:text-verde group/ent"
          >
            {entOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>
              Entró el {diaLargo(entrada.day)}
              <span className="mx-1.5 opacity-40">·</span>
              <span className="tabular-nums dark:text-white text-text-main-light">{entrada.total}</span> tarea{entrada.total === 1 ? '' : 's'}
              {entrada.forToday > 0 && entrada.later > 0 && (
                <span className="opacity-70"> ({entrada.forToday} para hoy · {entrada.later} más adelante)</span>
              )}
              {entrada.forToday > 0 && entrada.later === 0 && <span className="opacity-70"> (para hoy)</span>}
              {entrada.forToday === 0 && entrada.later > 0 && <span className="opacity-70"> (todas más adelante)</span>}
            </span>
          </button>
          {entOpen && (
            <div className="mt-1.5 ml-4 pl-3 border-l dark:border-border-main border-border-main-light space-y-1">
              {entrada.items.map(it => (
                <div key={it.id} className="flex items-center gap-2 text-[11px]">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${it.taskType === 'adhoc' ? 'bg-rosa' : 'bg-turquesa'}`} />
                  <span className="dark:text-white text-text-main-light truncate max-w-[340px]">{it.title || '(sin título)'}</span>
                  <span className={`text-[9px] font-black uppercase tracking-wider shrink-0 ${it.forToday ? 'text-verde' : 'dark:text-text-secondary text-text-secondary-light'}`}>
                    {it.forToday ? 'para hoy' : (it.dueDate ? diaLargo(it.dueDate) : 'sin fecha')}
                  </span>
                  {it.estimatedMinutes > 0 && (
                    <span className="text-[10px] tabular-nums dark:text-text-secondary text-text-secondary-light shrink-0">{formatMinutes(it.estimatedMinutes)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AVISO DE SOBREPLANIFICACIÓN (al fijar) */}
      {overWarn != null && (
        <div className="mt-2 flex items-center gap-2 text-[11px] font-bold text-naranja">
          <span>⚠️ Has fijado {formatMinutes(overWarn)} — más que tu jornada ({formatMinutes(jornada)}).</span>
          <label className="flex items-center gap-1 text-text-secondary font-medium">
            Jornada:
            <input
              type="number" min={0} step={30}
              defaultValue={Math.round(jornada / 60 * 10) / 10}
              onBlur={e => { const h = parseFloat(e.target.value); if (h > 0) onSetJornada(Math.round(h * 60)); }}
              className="w-12 px-1 py-0.5 rounded dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light text-center tabular-nums outline-none"
            /> h
          </label>
          <button onClick={() => setOverWarn(null)} className="text-text-secondary/60 hover:text-white">✕</button>
        </div>
      )}

      {/* BARRA DE PROGRESO — % del día COMPLETADO. Track visible + % a un lado → se lee como barra incluso a 0%. */}
      <div className="mt-3 flex items-center gap-2.5">
        <div className="flex-1 h-2 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
          <div className="h-full rounded-full bg-turquesa transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[10px] font-black tabular-nums dark:text-text-secondary text-text-secondary-light w-9 text-right">{pct}%</span>
      </div>

      {/* DESGLOSE (estimado PENDIENTE = lo que QUEDA; la barra de arriba es % completado → no se contradicen).
          Dos columnas: izquierda tipo+bloque (de qué proyecto queda), derecha etiqueta (con lo que decide qué hacer ahora). */}
      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3">
          {/* COLUMNA IZQUIERDA: tipo + bloque */}
          <div className="space-y-2">
            {/* color EXPLÍCITO (sesión 26): sin él, en modo CLARO el texto heredaba blanco = invisible sobre fondo blanco. */}
            <div className="flex items-center gap-4 text-[11px] font-bold flex-wrap dark:text-white text-text-main-light">
              <span className="text-[9px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Queda por tipo</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-turquesa" /> Core {formatMinutes(stats.byType.core)}</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rosa" /> Ad-hoc {formatMinutes(stats.byType.adhoc)}</span>
            </div>
            {stats.byBlock.length > 0 && (
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Queda por bloque</span>
                {stats.byBlock.slice(0, 8).map(b => (
                  <div key={b.blockId} className="flex items-center gap-2 text-[11px] font-bold">
                    <span className="w-24 truncate dark:text-text-secondary text-text-secondary-light">{blockName(b.blockId)}</span>
                    <div className="w-[120px] shrink-0 h-1.5 rounded-full dark:bg-white/5 bg-black/5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((b.minutes / (maxBlock || 1)) * 100))}%`, backgroundColor: blockColor(b.blockId) }} />
                    </div>
                    <span className="tabular-nums dark:text-text-secondary text-text-secondary-light">{formatMinutes(b.minutes)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* COLUMNA DERECHA: etiqueta — resume lo que Mi Día tiene agrupado debajo (§16.41 p·etiqueta) */}
          {stats.byTag.length > 0 && (
            <div className="space-y-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Queda por etiqueta</span>
              {stats.byTag.slice(0, 8).map(g => (
                <div key={g.tag} className="flex items-center gap-2 text-[11px] font-bold">
                  <span className="w-24 truncate dark:text-text-secondary text-text-secondary-light">{tagIcon(g.tag)} {tagLabel(g.tag)}</span>
                  <div className="w-[120px] shrink-0 h-1.5 rounded-full dark:bg-white/5 bg-black/5 overflow-hidden">
                    <div className="h-full rounded-full dark:bg-white/40 bg-black/40" style={{ width: `${Math.min(100, Math.round((g.minutes / (maxTag || 1)) * 100))}%` }} />
                  </div>
                  <span className="tabular-nums dark:text-text-secondary text-text-secondary-light">{formatMinutes(g.minutes)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// delta de TAREAS con signo (entero, sin formatMinutes)
function fmtSigned0(n: number): string { return `${n < 0 ? '−' : '+'}${Math.abs(n)}`; }
