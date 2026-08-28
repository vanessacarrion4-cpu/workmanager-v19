// DayReportModal.tsx — TRAMO 4 (REPORTE DEL DÍA). El resumen del día con valoración automática, para ponerle nota
// sabiendo lo que ha pasado. Consultable siempre (no solo al cerrar) y para días pasados. NO es un "cerrar el día"
// obligatorio: el reporte + la nota ES el cierre; el día se congela solo a medianoche. Spec §16.39 tramo 4, umbrales §16.42.
import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { formatMinutes } from './utils';
import { TAG_LABELS } from './constants';
import { DayVerdict, DayBreakdown, EntradaForDay } from './filters';
import { DayReport, MotivoKey } from './useDayReport';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function diaLargo(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return `${WEEKDAYS[date.getDay()]} ${d}`;
}
const tagLabel = (tag: string): string => (TAG_LABELS as any)[tag]?.label || tag;
const tagIcon = (tag: string): string => (TAG_LABELS as any)[tag]?.icon || '•';

const MOTIVOS: { key: MotivoKey; label: string }[] = [
  { key: 'desviacion', label: 'Desviación entre tiempo estimado y real' },
  { key: 'prioridad', label: 'Cambio de prioridad' },
  { key: 'dependencia', label: 'Dependo de otro' },
];

// Color del veredicto: verde cumplido, naranja desviado/sobreplanificado (aviso, no fallo), neutro sin fijar.
const verdictColor = (key: string) =>
  key === 'cumplido' ? 'text-verde' : key === 'sin_fijar' ? 'dark:text-text-secondary text-text-secondary-light' : 'text-naranja';

export function DayReportModal({
  open, onClose, activeDate, verdict, breakdown, entrada, blocks, report, onGuardar,
}: {
  open: boolean;
  onClose: () => void;
  activeDate: string;
  verdict: DayVerdict;
  breakdown: DayBreakdown;
  entrada: EntradaForDay | null;
  blocks: any[];
  report: DayReport | null;
  onGuardar: (motivos: MotivoKey[], nota: string) => Promise<void>;
}) {
  const [motivos, setMotivos] = useState<MotivoKey[]>([]);
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Al abrir / cambiar de día, precargar lo guardado.
  useEffect(() => {
    setMotivos(report?.motivos || []);
    setNota(report?.nota || '');
    setSaved(false);
  }, [report, activeDate, open]);

  if (!open) return null;

  const blockName = (id: string) => blocks.find((b: any) => b.id === id)?.name || '—';
  const blockColor = (id: string) => blocks.find((b: any) => b.id === id)?.color || '#888';
  const maxBlock = breakdown.byBlock.length ? breakdown.byBlock[0].minutes : 1;
  const maxTag = breakdown.byTag.length ? breakdown.byTag[0].minutes : 1;

  const toggleMotivo = (k: MotivoKey) => setMotivos(m => (m.includes(k) ? m.filter(x => x !== k) : [...m, k]));

  const guardar = async () => {
    setSaving(true);
    try {
      await onGuardar(motivos, nota);
      setSaved(true);
    } catch (e) {
      alert('No se pudo guardar el reporte. Reintenta.');
    } finally {
      setSaving(false);
    }
  };

  const fechaLarga = (() => {
    const [y, m, d] = activeDate.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
  })();

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-3xl p-6 shadow-2xl w-full max-w-2xl z-10 max-h-[85vh] overflow-y-auto">
        {/* CABECERA */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-black dark:text-white text-text-main-light uppercase tracking-widest">Reporte del día</h3>
            <p className="text-[11px] text-turquesa font-black mt-0.5">{fechaLarga}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center dark:text-text-secondary text-text-secondary-light dark:bg-bg-main bg-gray-100 rounded-xl border dark:border-border-main border-border-main-light">
            <X size={16} />
          </button>
        </div>

        {/* 1 · SENTENCIA */}
        <div className="mb-5">
          <p className={`text-xl font-black ${verdictColor(verdict.key)}`}>{verdict.sentence}</p>
        </div>

        {/* 2 · LAS TRES MEDIDAS */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Medida titulo="Cumplimiento">
            <span className="tabular-nums">{verdict.hechas} de {verdict.total}</span>
            <span className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light"> tareas</span>
            {verdict.hasFoto && verdict.hechasTrasFijar != null && verdict.hechasTrasFijar > 0 && (
              <div className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light mt-0.5">{verdict.hechasTrasFijar} tras fijar</div>
            )}
          </Medida>
          <Medida titulo="Tiempo">
            <span className="tabular-nums">{formatMinutes(verdict.registrado)}</span>
            {verdict.hasFoto && verdict.previsto != null && (
              <span className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light"> de {formatMinutes(verdict.previsto)}</span>
            )}
          </Medida>
          <Medida titulo="Desviación">
            {verdict.hasFoto && verdict.anadido != null ? (
              <span className="tabular-nums">{verdict.anadido >= 0 ? '+' : '−'}{formatMinutes(Math.abs(verdict.anadido))}</span>
            ) : (
              <span className="dark:text-text-secondary text-text-secondary-light">—</span>
            )}
          </Medida>
        </div>

        {/* 3 · ENTRADA DEL DÍA (versión de cierre: lista completa desplegada) */}
        {entrada && entrada.total > 0 && (
          <div className="mb-6">
            <p className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70 mb-1.5">
              Entró el {diaLargo(entrada.day)} · {entrada.total} tarea{entrada.total === 1 ? '' : 's'}
              {entrada.forToday > 0 && entrada.later > 0 && <span className="opacity-70"> ({entrada.forToday} para hoy · {entrada.later} más adelante)</span>}
            </p>
            <div className="space-y-1 pl-3 border-l dark:border-border-main border-border-main-light">
              {entrada.items.map(it => (
                <div key={it.id} className="flex items-center gap-2 text-[11px]">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${it.taskType === 'adhoc' ? 'bg-rosa' : 'bg-turquesa'}`} />
                  <span className="dark:text-white text-text-main-light truncate max-w-[380px]">{it.title || '(sin título)'}</span>
                  <span className={`text-[9px] font-black uppercase tracking-wider shrink-0 ${it.forToday ? 'text-verde' : 'dark:text-text-secondary text-text-secondary-light'}`}>
                    {it.forToday ? 'para hoy' : (it.dueDate ? diaLargo(it.dueDate) : 'sin fecha')}
                  </span>
                  {it.estimatedMinutes > 0 && (
                    <span className="text-[10px] tabular-nums dark:text-text-secondary text-text-secondary-light shrink-0">{formatMinutes(it.estimatedMinutes)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4 · DESGLOSE DEL DÍA COMPLETO (tipo / bloque / etiqueta) */}
        <div className="mb-6">
          <p className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70 mb-2">Desglose del día (estimado)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-4 text-[11px] font-bold flex-wrap dark:text-white text-text-main-light">
                <span className="text-[9px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Por tipo</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-turquesa" /> Core {formatMinutes(breakdown.byType.core)}</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rosa" /> Ad-hoc {formatMinutes(breakdown.byType.adhoc)}</span>
              </div>
              {breakdown.byBlock.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Por bloque</span>
                  {breakdown.byBlock.slice(0, 10).map(b => (
                    <BarRow key={b.blockId} label={blockName(b.blockId)} minutes={b.minutes} pct={Math.min(100, Math.round((b.minutes / (maxBlock || 1)) * 100))} color={blockColor(b.blockId)} />
                  ))}
                </div>
              )}
            </div>
            {breakdown.byTag.length > 0 && (
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Por etiqueta</span>
                {breakdown.byTag.slice(0, 10).map(g => (
                  <BarRow key={g.tag} label={`${tagIcon(g.tag)} ${tagLabel(g.tag)}`} minutes={g.minutes} pct={Math.min(100, Math.round((g.minutes / (maxTag || 1)) * 100))} neutral />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 5 · MOTIVO (opcional, varias) + nota libre */}
        <div className="mb-5">
          <p className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70 mb-2">Motivo (opcional)</p>
          <div className="space-y-1.5">
            {MOTIVOS.map(m => (
              <button
                key={m.key}
                onClick={() => toggleMotivo(m.key)}
                className="flex items-center gap-2.5 w-full text-left group"
              >
                <span className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-all ${motivos.includes(m.key) ? 'bg-turquesa border-turquesa' : 'dark:border-border-main border-border-main-light'}`}>
                  {motivos.includes(m.key) && <Check size={11} className="text-white" strokeWidth={3} />}
                </span>
                <span className="text-[12px] font-bold dark:text-white text-text-main-light">{m.label}</span>
              </button>
            ))}
          </div>
          <textarea
            value={nota}
            onChange={e => { setNota(e.target.value); setSaved(false); }}
            placeholder="Nota libre…"
            rows={2}
            className="mt-3 w-full px-3 py-2 rounded-xl text-[12px] dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light dark:text-white text-text-main-light outline-none focus:border-turquesa transition-all resize-none"
          />
        </div>

        {/* GUARDAR */}
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-[11px] font-bold text-verde flex items-center gap-1"><Check size={13} /> Guardado</span>}
          <button
            onClick={guardar}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest bg-turquesa text-white hover:bg-turquesa/90 transition-all disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar reporte'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Medida({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="dark:bg-bg-main bg-gray-50 rounded-xl border dark:border-border-main border-border-main-light p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70 mb-1">{titulo}</p>
      <p className="text-base font-black dark:text-white text-text-main-light">{children}</p>
    </div>
  );
}

function BarRow({ label, minutes, pct, color, neutral }: { label: string; minutes: number; pct: number; color?: string; neutral?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-bold">
      <span className="w-24 truncate dark:text-text-secondary text-text-secondary-light">{label}</span>
      <div className="w-[120px] shrink-0 h-1.5 rounded-full dark:bg-white/5 bg-black/5 overflow-hidden">
        <div className={`h-full rounded-full ${neutral ? 'dark:bg-white/40 bg-black/40' : ''}`} style={{ width: `${pct}%`, backgroundColor: neutral ? undefined : color }} />
      </div>
      <span className="tabular-nums dark:text-text-secondary text-text-secondary-light">{formatMinutes(minutes)}</span>
    </div>
  );
}
