// DayHeader.tsx — TRAMO 1 (CABECERA + FOTO). Sustituye a las 3 tarjetas (Pendientes/Pendiente/Registrado).
// Sin caja: contenido directo sobre el fondo, al margen de las filas. Reglas de cálculo en §16.8 (getStatsForDay).
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, BarChart3, FileText, History } from 'lucide-react';
import { DayStats, EntradaForDay } from './filters';
import { formatMinutes } from './utils';
import { TAG_LABELS } from './constants';
import { getTagColor } from './helpers';
import { DaySnapshot } from './useDaySnapshot';

const DESGLOSE_KEY = 'wm_desglose_open';
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const tagLabel = (tag: string): string => (TAG_LABELS as any)[tag]?.label || tag;

// Color de ENTIDAD para las barras del desglose (§16.43 2ª vuelta, item 4): el color no decora, IDENTIFICA — la barra de
// cada etiqueta/bloque/tipo lleva su propio color (el mismo que en el resto de la app), para reconocer sin leer.
const NAME_HEX: Record<string, string> = { turquesa: '#14B8A6', azul: '#3B82F6', morado: '#8B5CF6', naranja: '#F97316', rosa: '#EC4899', verde: '#10B981' };
const tagHex = (tag: string): string => NAME_HEX[getTagColor(tag as any)] || '#94A3B8';
// TIPO: dos tonos de UNA familia (verde), no dos colores: core saturado, ad-hoc más claro.
const CORE_HEX = '#10B981';
const ADHOC_HEX = '#6EE7B7';

// Fila del desglose — idéntica en las tres columnas: nombre · barra (color de entidad) · valor a la derecha.
function DesRow({ name, minutes, pct, color }: { name: string; minutes: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-bold">
      <span className="w-16 shrink-0 truncate dark:text-text-secondary text-slate-600">{name}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-12 shrink-0 text-right tabular-nums dark:text-text-secondary text-slate-600">{formatMinutes(minutes)}</span>
    </div>
  );
}

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
      {/* FILA 2 · ESTADO (héroe) + MEDIDAS — agrupados a la izquierda. Los NÚMEROS alineados por su LÍNEA BASE exacta:
          el eyebrow va en `absolute` (fuera del flujo) → no descuadra la base. §16.43 3ª vuelta, item 2. */}
      <div className="flex items-baseline gap-16 w-fit pt-5">
        {/* HÉROE */}
        <div className="relative">
          <span className="absolute bottom-full left-0 mb-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.2em] dark:text-text-secondary text-text-secondary-light">Faltan</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[40px] font-extrabold tracking-tight leading-none tabular-nums dark:text-white text-text-main-light">{stats.pending}</span>
            <span className="text-[20px] font-semibold leading-none dark:text-text-secondary text-text-secondary-light">
              <span className="dark:text-white/25 text-black/20 mr-1.5">·</span>{formatMinutes(stats.estimatedPending)}
            </span>
          </div>
          <span className="block mt-1.5 text-[12px] dark:text-text-secondary text-text-secondary-light tabular-nums">{stats.completed} de {stats.total} hechas</span>
        </div>
        {/* MEDIDAS */}
        <div className="relative">
          <span className="absolute bottom-full left-0 mb-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.2em] dark:text-text-secondary text-text-secondary-light">Estimado vs registrado hoy</span>
          <div className="flex items-baseline gap-3">
            <span className="text-[18px] leading-none font-bold tabular-nums dark:text-white text-text-main-light">{formatMinutes(stats.estimatedCompleted)}</span>
            <span className="w-px h-4 self-center dark:bg-border-main bg-border-main-light" />
            <span className="text-[18px] leading-none font-bold tabular-nums dark:text-white text-text-main-light">{formatMinutes(stats.registered)}</span>
          </div>
        </div>
      </div>

      {/* FILA 3 · META (foto + entrada) — contexto silencioso, solo si aplica */}
      {latest && (
        <div className="mt-1.5 text-[12px] font-medium dark:text-text-secondary text-text-secondary-light">
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
            className="flex items-center gap-1.5 text-[12px] font-medium dark:text-text-secondary text-text-secondary-light hover:text-turquesa group/ent"
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

      {/* FILA 4 · BARRA (progreso, hace de separador) + ACCIONES. Sin "%": la barra y "N de M hechas" ya lo dicen (§16.43).
          Un solo acento: Fijar (única acción que cambia estado); Desglose/Reporte/Historial en slate → turquesa al hover. */}
      <div className="mt-3 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[140px] h-1.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
          <div className="h-full rounded-full bg-turquesa transition-all" style={{ width: `${pct}%` }} />
        </div>
        {/* De un vistazo: UN botón sólido (Fijar, la acción) + TRES enlaces con icono (accesos). §16.43 3ª vuelta, item 4. */}
        <div className="flex items-center gap-6">
          <button
            onClick={doFijar}
            title="Fijar el día: guarda cuántas tareas y cuánto tiempo tienes previstos ahora. Luego verás lo que se añada."
            className="px-3.5 py-1.5 rounded-lg bg-turquesa text-white hover:bg-turquesa/90 text-[11px] font-bold uppercase tracking-wider transition-colors shrink-0"
          >{latest ? 'Re-fijar' : 'Fijar'}</button>
          <div className="flex items-center gap-4 text-[10px] font-semibold uppercase tracking-wider">
            <button onClick={toggle} className="flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-turquesa dark:hover:text-turquesa transition-colors"><BarChart3 size={11} /> Desglose</button>
            <button onClick={onOpenReport} className="flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-turquesa dark:hover:text-turquesa transition-colors"><FileText size={11} /> Reporte</button>
            <button onClick={onOpenTimeHistory} className="flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-turquesa dark:hover:text-turquesa transition-colors"><History size={11} /> Historial</button>
          </div>
        </div>
      </div>

      {/* DESGLOSE — estimado PENDIENTE (lo que QUEDA). TIPO = línea compacta (solo 2 valores, no merece columna, §16.43 3ª
          vuelta item 3); BLOQUE y ETIQUETA a mitades, que es donde sí hacen falta las barras. Color de barra = entidad. */}
      {open && (
        <div className="mt-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Queda por</span>
            {/* TIPO en una línea, con su punto de color delante (familia verde: core saturado, ad-hoc claro) */}
            <span className="flex items-center gap-3 text-[11px] font-bold dark:text-text-secondary text-slate-600">
              {stats.byType.core > 0 && (
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CORE_HEX }} /> Core {formatMinutes(stats.byType.core)}</span>
              )}
              {stats.byType.core > 0 && stats.byType.adhoc > 0 && <span className="text-text-secondary/40">·</span>}
              {stats.byType.adhoc > 0 && (
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ADHOC_HEX }} /> Ad-hoc {formatMinutes(stats.byType.adhoc)}</span>
              )}
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            {/* BLOQUE — color propio de cada bloque */}
            <div className="space-y-1.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/60">Bloque</span>
              {stats.byBlock.slice(0, 8).map(b => (
                <DesRow key={b.blockId} name={blockName(b.blockId)} minutes={b.minutes} pct={Math.min(100, Math.round((b.minutes / (maxBlock || 1)) * 100))} color={blockColor(b.blockId)} />
              ))}
            </div>
            {/* ETIQUETA — color real de cada etiqueta (el de sus cabeceras en Mi Día) */}
            <div className="space-y-1.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/60">Etiqueta</span>
              {stats.byTag.slice(0, 8).map(g => (
                <DesRow key={g.tag} name={tagLabel(g.tag)} minutes={g.minutes} pct={Math.min(100, Math.round((g.minutes / (maxTag || 1)) * 100))} color={tagHex(g.tag)} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// delta de TAREAS con signo (entero, sin formatMinutes)
function fmtSigned0(n: number): string { return `${n < 0 ? '−' : '+'}${Math.abs(n)}`; }
