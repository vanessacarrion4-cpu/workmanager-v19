// DayHeader.tsx — TRAMO 1 (CABECERA + FOTO). Sustituye a las 3 tarjetas (Pendientes/Pendiente/Registrado).
// Sin caja: contenido directo sobre el fondo, al margen de las filas. Reglas de cálculo en §16.8 (getStatsForDay).
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Camera } from 'lucide-react';
import { DayStats } from './filters';
import { formatMinutes } from './utils';
import { DaySnapshot } from './useDaySnapshot';

const DESGLOSE_KEY = 'wm_desglose_open';

function fmtSigned(minutes: number): string {
  const s = minutes < 0 ? '−' : '+';
  return `${s}${formatMinutes(Math.abs(minutes))}`;
}
function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function DayHeader({
  stats, blocks, latest, jornada, onFijar, onSetJornada, onOpenTimeHistory,
}: {
  stats: DayStats;
  blocks: any[];
  latest: DaySnapshot | null;
  jornada: number;
  onFijar: () => void;
  onSetJornada: (min: number) => void;
  onOpenTimeHistory: () => void; // restaura el "Ver historial" que colgaba de la tarjeta Registrado (sesión 26)
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(DESGLOSE_KEY) === '1'; } catch { return false; }
  });
  const toggle = () => setOpen(o => { const n = !o; try { localStorage.setItem(DESGLOSE_KEY, n ? '1' : '0'); } catch {} return n; });

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

  return (
    <div className="pt-1 pb-2">
      {/* FILA PRINCIPAL */}
      <div className="flex items-end gap-6 flex-wrap">
        {/* FALTAN */}
        <div className="flex flex-col leading-none">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] dark:text-text-secondary text-text-secondary-light">Faltan</span>
          <span className="text-4xl font-black dark:text-white text-text-main-light tabular-nums mt-1">{stats.pending}</span>
        </div>
        {/* hechas / pendiente en horas */}
        <div className="flex flex-col leading-tight pb-1">
          <span className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light">
            {stats.completed} hechas de {stats.total}
          </span>
          <span className="text-sm font-black text-azul tabular-nums mt-0.5">{formatMinutes(stats.estimatedPending)} pendiente</span>
        </div>

        <div className="flex-1" />

        {/* COMPARACIÓN: estimado de lo hecho · registrado hoy (§16.8 modificado: SÍ como comparación, a propósito) */}
        <div className="flex items-end gap-4 pb-1">
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[9px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Estimado hecho</span>
            <span className="text-sm font-black dark:text-white text-text-main-light tabular-nums">{formatMinutes(stats.estimatedCompleted)}</span>
          </div>
          <span className="text-text-secondary/40 pb-0.5">·</span>
          <button
            onClick={onOpenTimeHistory}
            title="Ver historial de tiempos registrados"
            className="flex flex-col items-end leading-tight group/reg"
          >
            <span className="text-[9px] font-black uppercase tracking-widest text-morado group-hover/reg:underline">Registrado hoy ›</span>
            <span className="text-sm font-black text-morado tabular-nums">{formatMinutes(stats.registered)}</span>
          </button>
        </div>

        {/* FIJAR */}
        <button
          onClick={doFijar}
          title="Fijar el día: guarda cuántas tareas y cuánto tiempo tienes previstos ahora. Luego verás lo que se añada."
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa hover:text-turquesa self-center"
        >
          <Camera size={13} /> {latest ? 'Re-fijar' : 'Fijar'}
        </button>

        {/* DESGLOSE (+ hueco reservado para "Reporte ›" del tramo 4, a su lado) */}
        <button onClick={toggle} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-turquesa hover:underline self-center">
          Desglose {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {/* TRAMO 4 (reservado): enlace "Reporte ›" irá aquí, junto a Desglose. */}
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

      {/* TRAMO 2 (reservado): "Entró hoy: …" irá aquí, como otra línea compacta bajo la de la foto. */}

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

      {/* BARRA DE PROGRESO — % del día COMPLETADO (sobre el total). Hace de separador con la lista. */}
      <div className="mt-2.5 h-1 w-full rounded-full dark:bg-white/5 bg-black/5 overflow-hidden">
        <div className="h-full rounded-full bg-turquesa transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* DESGLOSE (estimado PENDIENTE = lo que QUEDA; la barra de arriba es % completado → no se contradicen) */}
      {open && (
        <div className="mt-3 space-y-2">
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
                  <div className="w-[140px] shrink-0 h-1.5 rounded-full dark:bg-white/5 bg-black/5 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((b.minutes / (maxBlock || 1)) * 100))}%`, backgroundColor: blockColor(b.blockId) }} />
                  </div>
                  <span className="tabular-nums dark:text-text-secondary text-text-secondary-light">{formatMinutes(b.minutes)}</span>
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
