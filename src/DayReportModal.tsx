// DayReportModal.tsx — TRAMO 4 (REPORTE DEL DÍA). El resumen del día con valoración automática, para ponerle nota
// sabiendo lo que ha pasado. Consultable siempre (no solo al cerrar) y para días pasados. NO es un "cerrar el día"
// obligatorio: el reporte + la nota ES el cierre; el día se congela solo a medianoche. Spec §16.39 tramo 4, umbrales §16.42.
import React, { useState, useEffect } from 'react';
import { X, Check, Repeat, CheckCircle2, ArrowRight, CalendarDays, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { formatMinutes } from './utils';
import { toast } from './toast';
import { TAG_LABELS } from './constants';
import { DayVerdict, DayBreakdown, EntradaForDay, EntradaSection, EstimationDeviation, OutOfPlanGroup, FijadoVsHecho, EntradasSalidas, DayReconciliation, DesvioTable } from './filters';
import { DayReport, MotivoKey } from './useDayReport';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { MonthDatePicker } from './TimeComponents';
import { getTagColor } from './helpers';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function diaLargo(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return `${WEEKDAYS[date.getDay()]} ${d}`;
}
const tagLabel = (tag: string): string => (TAG_LABELS as any)[tag]?.label || tag;
const tagIcon = (tag: string): string => (TAG_LABELS as any)[tag]?.icon || '•';

// Colores de ENTIDAD para el desglose — MISMOS que la cinta (§16.43): etiqueta = color real (getTagColor→hex),
// bloque = block.color, tipo = familia verde (core saturado, ad-hoc claro). Etiqueta en el ORDEN de Mi Día, no por tiempo.
const NAME_HEX: Record<string, string> = { turquesa: '#14B8A6', azul: '#3B82F6', morado: '#8B5CF6', naranja: '#F97316', rosa: '#EC4899', verde: '#10B981' };
const tagHexKey = (tag: string): string => NAME_HEX[getTagColor(tag as any)] || '#94A3B8';
const CORE_HEX = '#10B981';
const ADHOC_HEX = '#6EE7B7';
const TAG_ORDER = ['con_hora', 'focus', 'dirección', 'espera', 'resto'];
const tagRank = (t: string): number => { const i = TAG_ORDER.indexOf(t); return i === -1 ? 99 : i; };

const MOTIVOS: { key: MotivoKey; label: string }[] = [
  { key: 'desviacion', label: 'Desviación entre tiempo estimado y real' },
  { key: 'prioridad', label: 'Cambio de prioridad' },
  { key: 'dependencia', label: 'Dependo de otro' },
];

// Color de la etiqueta: verde cumplido/completo; neutro sin nota/sin fijar; naranja el resto (a medias/sin arrancar/sobreplanif.).
const verdictColor = (key: string) =>
  (key === 'cumplido' || key === 'completo') ? 'text-verde'
    : (key === 'sin_fijar' || key === 'sin_nota') ? 'dark:text-text-secondary text-text-secondary-light'
    : 'text-naranja';

// §16.104 (pieza 3): resumen de decisiones del repaso, guardado junto a las medidas.
// §16.105 (pieza 4): con TIEMPO por grupo (min), no solo el conteo — cuánto tiempo dejo sin decidir.
type Decisiones = {
  manana: number; otro: number; completadas: number; eliminadas: number;
  mananaMin: number; otroMin: number; completadasMin: number; eliminadasMin: number;
};

export function DayReportModal({
  open, onClose, activeDate, verdict: verdictLive, breakdown: breakdownLive, deviation: deviationLive, outOfPlan, fijadoHecho, entradasSalidas, reconciliation, causes, entrada, blocks, report, onGuardar,
  pendingTasks = [], timeEntries = [], onComplete, onDelete, onRepasoMove, repasoWillCollide, repasoDayLoad,
}: {
  open: boolean;
  onClose: () => void;
  activeDate: string;
  verdict: DayVerdict;
  breakdown: DayBreakdown;
  deviation: EstimationDeviation;
  outOfPlan?: { total: number; groups: OutOfPlanGroup[] };
  fijadoHecho?: FijadoVsHecho;
  entradasSalidas?: EntradasSalidas;
  reconciliation?: DayReconciliation;
  causes?: DesvioTable;
  entrada: EntradaForDay | null;
  blocks: any[];
  report: DayReport | null;
  onGuardar: (measures: any, motivos: MotivoKey[], nota: string) => Promise<void>;
  // FASE 6 · Repaso de lo no hecho (§16.47)
  pendingTasks?: any[];
  timeEntries?: any[];
  onComplete?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onRepasoMove?: (task: any, newDate: string) => void;
  repasoWillCollide?: (task: any, destDay: string) => boolean;
  repasoDayLoad?: (dayISO: string) => { minutes: number; count: number };
}) {
  const [motivos, setMotivos] = useState<MotivoKey[]>([]);
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // §16.104 (pieza 2): CONGELAR las medidas al ABRIR. El reporte refleja el estado ANTES de las decisiones del repaso
  // (si acabas con 29 pendientes y las mueves a mañana, el reporte dice 29, no 0). `decisiones` cuenta lo del repaso (pieza 3).
  // §16.108: un reporte YA GUARDADO es un DOCUMENTO HISTÓRICO — se renderiza desde lo guardado (measures.frozen), no se
  // recalcula con el estado de hoy. `fromSaved` marca ese modo; `entradaSaved` es la entrada congelada del cierre.
  const [snap, setSnap] = useState<{ verdict: DayVerdict; deviation: EstimationDeviation; breakdown: DayBreakdown; fijadoHecho?: FijadoVsHecho; outOfPlan?: { total: number; groups: OutOfPlanGroup[] }; entradasSalidas?: EntradasSalidas; reconciliation?: DayReconciliation; causes?: DesvioTable; entradaSaved?: EntradaForDay | null; pendingAtOpen: number; pendingMinsAtOpen: number; decisiones: Decisiones; fromSaved?: boolean } | null>(null);
  const [forceLive, setForceLive] = useState(false); // §16.108: "Actualizar con hoy" fuerza recálculo en vivo de un reporte cerrado
  const [entradaOpen, setEntradaOpen] = useState(true); // §16.104 (pieza 4): plegable
  const [hoyOpen, setHoyOpen] = useState(true);          // §16.104 (pieza 8): apartado "para hoy"
  const [otroOpen, setOtroOpen] = useState(true);        // §16.104 (pieza 8): apartado "para otro día"
  const [outOfPlanOpen, setOutOfPlanOpen] = useState(false); // §16.104 (pieza 7): plegado por defecto
  const [openCauses, setOpenCauses] = useState<Set<string>>(new Set()); // §16.113: detalle desplegable por causa
  const [openSeq, setOpenSeq] = useState<string | null>(null);          // §16.113: tramo de la secuencia desplegado

  // Al abrir / cambiar de día, precargar lo guardado.
  useEffect(() => {
    setMotivos(report?.motivos || []);
    setNota(report?.nota || '');
    setSaved(false);
  }, [report, activeDate, open]);

  useEffect(() => { setForceLive(false); }, [open, activeDate]); // reset del "actualizar con hoy" al abrir/cambiar de día

  // §16.108: si el día tiene reporte GUARDADO con snap congelado → renderizar ESO (documento histórico). Si no (día sin
  // cerrar, o reporte antiguo sin `frozen`), capturar en vivo AL ABRIR (congelado antes del repaso). No re-captura en el repaso.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const f = (report?.measures as any)?.frozen;
    if (f && !forceLive) {
      setSnap({ ...f, fromSaved: true });
    } else {
      setSnap({
        verdict: verdictLive, deviation: deviationLive, breakdown: breakdownLive, fijadoHecho, outOfPlan, entradasSalidas, reconciliation, causes,
        entradaSaved: null,
        pendingAtOpen: pendingTasks.length,
        pendingMinsAtOpen: pendingTasks.reduce((a: number, t: any) => a + (t.estimatedMinutes || 0), 0),
        decisiones: { manana: 0, otro: 0, completadas: 0, eliminadas: 0, mananaMin: 0, otroMin: 0, completadasMin: 0, eliminadasMin: 0 },
        fromSaved: false,
      });
    }
  }, [open, activeDate, report, forceLive]);

  if (!open) return null;

  // Medidas CONGELADAS (caen a los props vivos solo en el primer frame antes de que corra la captura).
  const verdict = snap?.verdict ?? verdictLive;
  const deviation = snap?.deviation ?? deviationLive;
  const breakdown = snap?.breakdown ?? breakdownLive;
  const fh = snap?.fijadoHecho ?? fijadoHecho;
  const oop = snap?.outOfPlan ?? outOfPlan;
  const es = snap?.entradasSalidas ?? entradasSalidas;
  const rec = snap?.reconciliation ?? reconciliation; // §16.110: secuencia del día (congelada)
  const caus = snap?.causes ?? causes;                 // §16.110: tabla de causas (congelada)
  const entradaEff = snap?.entradaSaved ?? entrada; // §16.108: entrada congelada si es documento histórico
  const isSaved = !!snap?.fromSaved;
  const pendingAtOpen = snap?.pendingAtOpen ?? pendingTasks.length;
  // §16.107 (#3): la tarjeta "Desviación" era en realidad "añadido" (estimatedTotal−previsto), mal nombrada. Se separan:
  //  · Desviación de tiempo = registré − fijé (lo que esperabas ver).   · Añadido durante el día = estimatedTotal − previsto.
  const devTiempo = verdict.hasFoto && verdict.previsto != null ? verdict.registrado - verdict.previsto : null;

  const blockName = (id: string) => blocks.find((b: any) => b.id === id)?.name || '—';
  const blockColor = (id: string) => blocks.find((b: any) => b.id === id)?.color || '#888';

  const toggleMotivo = (k: MotivoKey) => setMotivos(m => (m.includes(k) ? m.filter(x => x !== k) : [...m, k]));

  const guardar = async () => {
    setSaving(true);
    try {
      // §16.104: se guardan las medidas CONGELADAS (verdict del snap) + el resumen de decisiones del repaso.
      const measures = {
        key: verdict.key, nota: verdict.nota, previsto: verdict.previsto, registrado: verdict.registrado,
        planRegistered: verdict.planRegistered, outOfPlan: verdict.outOfPlan, anadido: verdict.anadido,
        hechas: verdict.hechas, total: verdict.total, hechasTrasFijar: verdict.hechasTrasFijar,
        sinHacer: pendingAtOpen, decisiones: snap?.decisiones ?? null,
        // §16.104 (pieza 9): cerrado en DIFERIDO si el día del reporte es anterior a hoy (rescate del día anterior).
        closedLate: activeDate < formatLocalISO(new Date()),
        entradasSalidas: es ?? null,
        // §16.108: SNAP COMPLETO congelado → al reabrir, el reporte se renderiza desde aquí (documento histórico), no se recalcula.
        frozen: {
          verdict, deviation, breakdown, fijadoHecho: fh ?? null, outOfPlan: oop ?? null, entradasSalidas: es ?? null,
          reconciliation: rec ?? null, causes: caus ?? null,
          entrada: entradaEff ?? null, pendingAtOpen, pendingMinsAtOpen, decisiones: snap?.decisiones ?? null,
        },
        // §16.105 (pieza 2 del ajuste): guardar TODO el desglose del día para poder dibujar la EVOLUCIÓN semana a semana.
        // Por tipo/bloque/etiqueta: estimado (desglose del día), fijado-vs-hecho (en tiempo), desviación (estimo bien), no previsto.
        // NOTA: `fijadoHecho.fijado` hoy recalcula en vivo (bug diagnosticado §1.b); quedará correcto al congelar el plan al fijar.
        desglose: {
          estimado: { byType: breakdown.byType, byBlock: breakdown.byBlock, byTag: breakdown.byTag },
          fijadoHecho: fh ? { byType: fh.byType, byBlock: fh.byBlock, byTag: fh.byTag, totalFijado: fh.totalFijado, totalHecho: fh.totalHecho } : null,
          desviacion: { byBlock: deviation.byBlock, byTag: deviation.byTag, estimated: deviation.estimated, registered: deviation.registered, deviation: deviation.deviation, ratioPct: deviation.ratioPct },
          noPrevisto: oop ? { total: oop.total, groups: oop.groups } : null,
        },
      };
      await onGuardar(measures, motivos, nota);
      setSaved(true);
    } catch (e) {
      toast.error('No se pudo guardar el reporte. Reintenta.');
    } finally {
      setSaving(false);
    }
  };

  // §16.104 (pieza 3) + §16.105 (pieza 4): contar las decisiones del repaso, con TIEMPO. 'mañana' vs 'otro día' por la fecha destino.
  const tomorrow = repNextDay(activeDate);
  const minsOf = (id: string) => (pendingTasks.find((t: any) => t.id === id)?.estimatedMinutes || 0);
  const bump = (k: 'manana' | 'otro' | 'completadas' | 'eliminadas', min: number) => setSnap(s => (s ? {
    ...s, decisiones: { ...s.decisiones, [k]: s.decisiones[k] + 1, [`${k}Min`]: (s.decisiones as any)[`${k}Min`] + min },
  } : s));
  const onCompleteW = (id: string) => { bump('completadas', minsOf(id)); onComplete?.(id); };
  const onDeleteW = (id: string) => { bump('eliminadas', minsOf(id)); onDelete?.(id); };
  const onRepasoMoveW = (task: any, date: string) => { bump(date === tomorrow ? 'manana' : 'otro', task?.estimatedMinutes || 0); onRepasoMove?.(task, date); };
  const dec = snap?.decisiones ?? { manana: 0, otro: 0, completadas: 0, eliminadas: 0, mananaMin: 0, otroMin: 0, completadasMin: 0, eliminadasMin: 0 };
  const pendingMinsAtOpen = snap?.pendingMinsAtOpen ?? 0;
  const sinTocar = Math.max(0, pendingAtOpen - dec.manana - dec.otro - dec.completadas - dec.eliminadas);
  const sinTocarMin = Math.max(0, pendingMinsAtOpen - dec.mananaMin - dec.otroMin - dec.completadasMin - dec.eliminadasMin);

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

        {/* §16.108: aviso de documento histórico — el reporte cerrado muestra lo GUARDADO, no recalcula. */}
        {isSaved && (
          <div className="flex items-center gap-2 flex-wrap mb-4 px-3 py-2 rounded-xl dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light">
            <span className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light">📄 Reporte cerrado — muestra lo que guardaste, no recalcula.</span>
            <button onClick={() => setForceLive(true)} className="ml-auto text-[10px] font-black uppercase tracking-widest text-turquesa hover:underline">Actualizar con hoy</button>
          </div>
        )}

        {/* 1 · NOTA (grande) + ETIQUETA + FRASE + tiempo fuera de plan (§16.47) */}
        <div className="mb-5">
          {verdict.nota != null ? (
            <div className="flex items-baseline gap-3">
              <span className="text-[44px] font-black leading-none tabular-nums dark:text-white text-text-main-light shrink-0">{verdict.nota.toFixed(1).replace('.', ',')}</span>
              <div className="min-w-0">
                <p className={`text-base font-black ${verdictColor(verdict.key)}`}>{verdict.label}</p>
                <p className="text-[12px] dark:text-text-secondary text-text-secondary-light">{verdict.frase}</p>
                {verdict.outOfPlan > 0 && (
                  <button onClick={() => setOutOfPlanOpen(o => !o)} className="flex items-center gap-1 group">
                    {outOfPlanOpen ? <ChevronDown size={11} className="text-morado" /> : <ChevronRight size={11} className="text-morado" />}
                    <span className="text-[12px] font-bold text-morado group-hover:underline">dedicaste {formatMinutes(verdict.outOfPlan)} a cosas no previstas</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className={`text-lg font-black ${verdictColor(verdict.key)}`}>{verdict.label}</p>
              {verdict.frase && <p className="text-[12px] dark:text-text-secondary text-text-secondary-light mt-0.5">{verdict.frase}</p>}
            </div>
          )}
          {/* §16.104 (pieza 7): desglose del tiempo NO previsto, plegado por defecto. Hijas agrupadas bajo su contenedor. */}
          {verdict.outOfPlan > 0 && outOfPlanOpen && outOfPlan && (
            <div className="mt-2 pl-3 border-l-2 border-morado/40 space-y-1.5">
              {outOfPlan.groups.map((g, gi) => (
                <div key={g.containerId || `oop-${gi}`}>
                  {g.containerId ? (
                    <>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="font-bold dark:text-white text-text-main-light truncate max-w-[300px]">{g.title}</span>
                        <span className="text-[10px] tabular-nums text-morado shrink-0 ml-auto">{formatMinutes(g.minutes)}</span>
                      </div>
                      <div className="pl-3 space-y-0.5 mt-0.5">
                        {g.rows.map(r => (
                          <div key={r.id} className="flex items-center gap-2 text-[11px]">
                            <span className="dark:text-text-secondary text-text-secondary-light truncate max-w-[280px]">{r.title}</span>
                            <span className="text-[10px] tabular-nums text-text-secondary shrink-0 ml-auto">{formatMinutes(r.minutes)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="dark:text-white text-text-main-light truncate max-w-[300px]">{g.title}</span>
                      <span className="text-[10px] tabular-nums text-morado shrink-0 ml-auto">{formatMinutes(g.minutes)}</span>
                    </div>
                  )}
                </div>
              ))}
              <p className="text-[9px] font-black uppercase tracking-widest text-morado/70 pt-1">Total no previsto · {formatMinutes(outOfPlan.total)}</p>
            </div>
          )}
        </div>

        {/* 2 · LAS TRES MEDIDAS */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Medida titulo="Cumplimiento">
            {/* §16.102: "de M" solo si hay denominador CONGELADO (foto). Sin foto → recuento honesto, sin inventar total. */}
            {verdict.total != null ? (
              <><span className="tabular-nums">{verdict.hechas} de {verdict.total}</span>
              <span className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light"> tareas</span></>
            ) : (
              <><span className="tabular-nums">{verdict.hechas}</span>
              <span className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light"> hechas · sin fijar</span></>
            )}
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
          <Medida titulo="Desviación de tiempo">
            {devTiempo != null ? (
              <span className={`tabular-nums ${devTiempo <= 0 ? 'text-verde' : 'text-rosa'}`}>{devTiempo >= 0 ? '+' : '−'}{formatMinutes(Math.abs(devTiempo))}</span>
            ) : (
              <span className="dark:text-text-secondary text-text-secondary-light">—</span>
            )}
            <span className="block text-[9px] font-bold dark:text-text-secondary text-text-secondary-light mt-0.5">registré − fijé</span>
          </Medida>
        </div>

        {/* §16.107 (#b): ENTRARON / SALIERON respecto al plan (sustituye el "añadido neto" que podía salir negativo). */}
        {verdict.hasFoto && es && (es.entraron.count > 0 || es.salieron.count > 0) && (
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mb-6 -mt-3 text-[11px] font-bold">
            {es.entraron.count > 0 && (
              <span className="text-morado">Entraron {es.entraron.count} tarea{es.entraron.count === 1 ? '' : 's'} · {formatMinutes(es.entraron.mins)}<span className="font-normal dark:text-text-secondary text-text-secondary-light"> después de fijar</span></span>
            )}
            {es.salieron.count > 0 && (
              <span className="text-morado">Salieron {es.salieron.count} tarea{es.salieron.count === 1 ? '' : 's'} · {formatMinutes(es.salieron.mins)}<span className="font-normal dark:text-text-secondary text-text-secondary-light"> del plan (movidas/borradas)</span></span>
            )}
          </div>
        )}

        {/* 2b · RESUMEN DE DECISIONES DEL REPASO (§16.104 pieza 3) — junto a las medidas, se guarda también. */}
        {pendingAtOpen > 0 && (
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mb-6 text-[11px] font-bold">
            <span className="dark:text-white text-text-main-light">{pendingAtOpen} sin hacer · {formatMinutes(pendingMinsAtOpen)}</span>
            {dec.manana > 0 && <span className="text-turquesa">· {dec.manana} a mañana · {formatMinutes(dec.mananaMin)}</span>}
            {dec.otro > 0 && <span className="text-turquesa">· {dec.otro} a otro día · {formatMinutes(dec.otroMin)}</span>}
            {dec.completadas > 0 && <span className="text-verde">· {dec.completadas} completada{dec.completadas === 1 ? '' : 's'} · {formatMinutes(dec.completadasMin)}</span>}
            {dec.eliminadas > 0 && <span className="text-rosa">· {dec.eliminadas} eliminada{dec.eliminadas === 1 ? '' : 's'} · {formatMinutes(dec.eliminadasMin)}</span>}
            <span className="dark:text-text-secondary text-text-secondary-light">· {sinTocar} sin tocar · {formatMinutes(sinTocarMin)}</span>
          </div>
        )}

        {/* §16.110 · ¿EN QUÉ SE ME FUE EL DÍA? — la secuencia que CIERRA (estimado) + UNA tabla de causas (peso vs sin-hacer). */}
        {rec && rec.fijado > 0 && (
          <div className="mb-6">
            <p className="text-[9px] font-black uppercase tracking-widest text-turquesa mb-1.5">¿En qué se me fue el día?</p>
            <div className="text-[11px] dark:text-text-secondary text-text-secondary-light mb-1 leading-relaxed">
              {(() => {
                const seg = (key: string, node: React.ReactNode, detail: { title: string; mins: number }[]) => (
                  <button onClick={() => detail.length && setOpenSeq(s => s === key ? null : key)} className={detail.length ? 'underline decoration-dotted decoration-text-secondary/40 hover:decoration-turquesa' : ''}>{node}</button>
                );
                return <>
                  Fijé <b className="dark:text-white text-text-main-light">{formatMinutes(rec.fijado)}</b>
                  {' · '}entraron {seg('entraron', <b className="dark:text-white text-text-main-light">{formatMinutes(rec.entraronMin)}</b>, rec.entraronDetail)} para hoy
                  {rec.saqueMin > 0 && <>{' · '}saqué {seg('saque', <b className="dark:text-white text-text-main-light">{formatMinutes(rec.saqueMin)}</b>, rec.saqueDetail)}</>}
                  {' · '}el día quedó en <b className="dark:text-white text-text-main-light">{formatMinutes(rec.diaMin)}</b>
                  {' · '}cumplí {seg('cumpli', <b className="dark:text-white text-text-main-light">{formatMinutes(rec.cumplidoMin)}</b>, rec.cumplidoDetail)}
                  {' · '}quedó {seg('sinhacer', <b className="text-rosa">sin hacer {formatMinutes(rec.sinHacerMin)}</b>, rec.sinHacerDetail)} ({rec.sinHacerCount} tarea{rec.sinHacerCount === 1 ? '' : 's'})
                </>;
              })()}
            </div>
            {openSeq && (() => {
              const d = openSeq === 'entraron' ? rec.entraronDetail : openSeq === 'saque' ? rec.saqueDetail : openSeq === 'cumpli' ? rec.cumplidoDetail : rec.sinHacerDetail;
              return (
                <div className="pl-3 mb-2 space-y-0.5 border-l-2 border-turquesa/30">
                  {d.map((x, xi) => (
                    <div key={xi} className="flex items-center gap-2 text-[10px]">
                      <span className="flex-1 truncate dark:text-text-secondary text-text-secondary-light">{x.title}</span>
                      <span className="tabular-nums dark:text-text-secondary text-text-secondary-light">{formatMinutes(x.mins)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <p className="text-[9px] dark:text-text-secondary/70 text-text-secondary-light mb-2.5">Todo en tiempo estimado · fiché {formatMinutes(rec.registrado)} — tiempo real, se compara aparte. Subrayado = desplegable a sus tareas.</p>
            {caus && caus.causas.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Por qué no cerró</p>
                <p className="text-[9px] dark:text-text-secondary/70 text-text-secondary-light mb-1 leading-snug">
                  <b className="text-morado">Impacto</b>: sobre lo que quedó sin hacer (puede pasar del 100%). <b className="text-turquesa">Peso rel.</b>: sobre el total de causas (suma 100, comparable entre días).
                </p>
                {/* cabecera de columnas */}
                <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-text-secondary/50">
                  <span className="flex-1">Causa</span>
                  <span className="w-8 text-right">Tar.</span>
                  <span className="w-14 text-right">Tiempo</span>
                  <span className="w-12 text-right text-morado/70">Impacto</span>
                  <span className="w-14 text-right text-turquesa/70">Peso rel.</span>
                </div>
                {caus.causas.map(c => {
                  const hasDetail = c.detail && c.detail.length > 0;
                  const isOpen = openCauses.has(c.key);
                  return (
                    <div key={c.key}>
                      <button
                        onClick={() => hasDetail && setOpenCauses(prev => { const n = new Set(prev); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })}
                        className={`flex items-center gap-2 text-[11px] font-bold w-full text-left ${hasDetail ? 'group' : 'cursor-default'}`}
                      >
                        <span className="flex-1 truncate dark:text-white text-text-main-light flex items-center gap-1">
                          {hasDetail && (isOpen ? <ChevronDown size={10} className="text-text-secondary/60 shrink-0" /> : <ChevronRight size={10} className="text-text-secondary/60 shrink-0" />)}
                          <span className={hasDetail ? 'group-hover:text-turquesa transition-colors' : ''}>{c.label}</span>
                        </span>
                        <span className="w-8 text-right tabular-nums dark:text-text-secondary text-text-secondary-light">{c.count != null ? c.count : '—'}</span>
                        <span className="w-14 text-right tabular-nums dark:text-text-secondary text-text-secondary-light">{formatMinutes(c.mins)}</span>
                        <span className="w-12 text-right tabular-nums text-morado">{c.impacto}%</span>
                        <span className="w-14 text-right tabular-nums text-turquesa">{c.pesoRel}%</span>
                      </button>
                      {hasDetail && isOpen && (
                        <div className="pl-4 py-0.5 space-y-0.5">
                          {c.detail.map((d, di) => (
                            <div key={di} className="flex items-center gap-2 text-[10px]">
                              <span className="flex-1 truncate dark:text-text-secondary text-text-secondary-light">{d.title}</span>
                              <span className="tabular-nums dark:text-text-secondary text-text-secondary-light">{formatMinutes(d.mins)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 2c · FIJADO vs HECHO (§16.104 pieza 6) — plan contra realidad, en tiempo, por bloque y etiqueta. Necesita foto. */}
        {verdict.hasPlan && fijadoHecho && fijadoHecho.byBlock.length > 0 && (
          <div className="mb-6">
            <div className="flex items-baseline gap-2 mb-2 flex-wrap">
              <p className="text-[9px] font-black uppercase tracking-widest text-turquesa">Fijado vs hecho</p>
              <span className="text-[9px] dark:text-text-secondary text-text-secondary-light">plan contra realidad · en tiempo</span>
              <span className="text-[11px] font-bold dark:text-white text-text-main-light ml-auto tabular-nums">{formatMinutes(fijadoHecho.totalFijado)} → {formatMinutes(fijadoHecho.totalHecho)}</span>
            </div>
            {/* §16.105 (pieza 3): Por TIPO (Core/Ad-hoc) — dice si el día se fue en puntual vs trabajo de fondo. */}
            {fijadoHecho.byType.length > 0 && (
              <div className="flex items-center gap-x-6 gap-y-1 flex-wrap mb-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Por tipo</span>
                {[...fijadoHecho.byType].sort((a, b) => (a.key === 'core' ? -1 : 1)).map(r => (
                  <FhRow key={r.key} label={r.key === 'core' ? 'Core' : 'Ad-hoc'} color={r.key === 'core' ? CORE_HEX : ADHOC_HEX} fijado={r.fijado} hecho={r.hecho} />
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3">
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Por bloque</span>
                {fijadoHecho.byBlock.slice(0, 12).map(r => (
                  <FhRow key={r.key} label={blockName(r.key)} color={blockColor(r.key)} fijado={r.fijado} hecho={r.hecho} />
                ))}
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Por etiqueta</span>
                {[...fijadoHecho.byTag].sort((a, b) => tagRank(a.key) - tagRank(b.key)).slice(0, 12).map(r => (
                  <FhRow key={r.key} label={tagLabel(r.key)} color={tagHexKey(r.key)} fijado={r.fijado} hecho={r.hecho} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3 · ENTRADA DEL DÍA (versión de cierre: lista completa desplegada) — §16.104 (pieza 4): plegable */}
        {entradaEff && entradaEff.total > 0 && (
          <div className="mb-6">
            <button onClick={() => setEntradaOpen(o => !o)} className="flex items-center gap-1.5 mb-1.5 group">
              {entradaOpen ? <ChevronDown size={12} className="text-text-secondary/70" /> : <ChevronRight size={12} className="text-text-secondary/70" />}
              <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70 group-hover:text-turquesa transition-colors">
                Entró el {diaLargo(entradaEff.day)} · {entradaEff.total} tarea{entradaEff.total === 1 ? '' : 's'}
                {entradaEff.forToday > 0 && entradaEff.later > 0 && <span className="opacity-70"> ({entradaEff.forToday} para hoy · {entradaEff.later} más adelante)</span>}
              </span>
            </button>
            {entradaOpen && (
            <div className="space-y-3 pl-3 border-l dark:border-border-main border-border-main-light">
              {/* §16.104 (pieza 8): dos apartados — PARA HOY primero, PARA OTRO DÍA después */}
              {entradaEff.hoy.count > 0 && (
                <EntradaSectionView label="Planificadas para hoy" section={entradaEff.hoy} otherPhrase="para otra fecha" open={hoyOpen} onToggle={() => setHoyOpen(o => !o)} showDate={false} />
              )}
              {entradaEff.otro.count > 0 && (
                <EntradaSectionView label="Para otro día" section={entradaEff.otro} otherPhrase="para hoy" open={otroOpen} onToggle={() => setOtroOpen(o => !o)} showDate={true} />
              )}
            </div>
            )}
          </div>
        )}

        {/* §16.107 (#4): quitado el "Desglose del día (estimado)" — era el estado del día al cierre con lo añadido dentro
            (el 4º número que confundía). El dato SÍ se sigue guardando en measures.desglose.estimado para las gráficas de
            evolución; solo se retira de la pantalla del reporte. Se ve en Mi Día durante la jornada si hace falta. */}

        {/* 4b · ¿ESTIMO BIEN? — desviación estimado vs registrado de lo COMPLETADO (§16.101). No depende de la foto. */}
        <div className="mb-6">
          <div className="flex items-baseline gap-2 mb-2 flex-wrap">
            <p className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">¿Estimo bien?</p>
            <span className="text-[9px] dark:text-text-secondary text-text-secondary-light">estimado vs tiempo real · solo completadas</span>
          </div>
          {deviation.count === 0 ? (
            <p className="text-[11px] dark:text-text-secondary text-text-secondary-light">
              Sin tareas completadas con tiempo fichado{deviation.sinTiempo.count > 0 ? ` · ${deviation.sinTiempo.count} completada${deviation.sinTiempo.count === 1 ? '' : 's'} sin fichar` : ''}.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap mb-2.5 text-[12px] font-bold">
                <span className="dark:text-white text-text-main-light">Estimé {formatMinutes(deviation.estimated)} · tardé {formatMinutes(deviation.registered)}</span>
                <span className={`tabular-nums ${devColor(deviation.ratioPct)}`}>{devDelta(deviation.deviation)}{deviation.ratioPct != null ? ` (${deviation.ratioPct}%)` : ''}</span>
                <span className="text-[10px] dark:text-text-secondary text-text-secondary-light">{deviation.count} tarea{deviation.count === 1 ? '' : 's'}</span>
              </div>
              {/* §16.110 (#3): Por TIPO (Core/Ad-hoc) — ¿estimo peor lo puntual que lo de fondo? (como FIJADO vs HECHO) */}
              {deviation.byType && deviation.byType.length > 0 && (
                <div className="flex items-center gap-x-6 gap-y-1 flex-wrap mb-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Por tipo</span>
                  {[...deviation.byType].sort((a, b) => (a.key === 'core' ? -1 : 1)).map(r => (
                    <DevRow key={r.key} label={r.key === 'core' ? 'Core' : 'Ad-hoc'} color={r.key === 'core' ? CORE_HEX : ADHOC_HEX} est={r.estimated} reg={r.registered} delta={r.deviation} />
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3">
                {deviation.byBlock.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Por bloque</span>
                    {deviation.byBlock.slice(0, 10).map(r => (
                      <DevRow key={r.key} label={blockName(r.key)} color={blockColor(r.key)} est={r.estimated} reg={r.registered} delta={r.deviation} />
                    ))}
                  </div>
                )}
                {deviation.byTag.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70">Por etiqueta</span>
                    {[...deviation.byTag].sort((a, b) => tagRank(a.key) - tagRank(b.key)).slice(0, 10).map(r => (
                      <DevRow key={r.key} label={tagLabel(r.key)} color={tagHexKey(r.key)} est={r.estimated} reg={r.registered} delta={r.deviation} />
                    ))}
                  </div>
                )}
              </div>
              {deviation.sinTiempo.count > 0 && (
                <p className="text-[10px] dark:text-text-secondary text-text-secondary-light mt-2">
                  {deviation.sinTiempo.count} completada{deviation.sinTiempo.count === 1 ? '' : 's'} sin tiempo fichado — fuera del cálculo.
                </p>
              )}
            </>
          )}
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

        {/* 6 · REPASO DE LO NO HECHO (§16.47) — antes de guardar */}
        <RepasoSection
          pendingTasks={pendingTasks}
          activeDate={activeDate}
          blocks={blocks}
          timeEntries={timeEntries}
          onComplete={onCompleteW}
          onDelete={onDeleteW}
          onRepasoMove={onRepasoMoveW}
          repasoWillCollide={repasoWillCollide}
          repasoDayLoad={repasoDayLoad}
        />

        {/* GUARDAR — §16.103: al FINAL de todo, después del repaso. Cerrar el día es un solo acto. */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-5 border-t dark:border-border-main border-border-main-light">
          {saved && <span className="text-[11px] font-bold text-verde flex items-center gap-1"><Check size={13} /> Guardado</span>}
          <button
            onClick={guardar}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest bg-turquesa text-white hover:bg-turquesa/90 transition-all disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar reporte y cerrar el día'}
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

// §16.101 · desviación estimado vs registrado: signo + color por precisión.
const devDelta = (min: number): string => (min === 0 ? 'clavado' : `${min > 0 ? '+' : '−'}${formatMinutes(Math.abs(min))}`);
const devColor = (ratioPct: number | null): string => {
  if (ratioPct == null) return 'dark:text-text-secondary text-text-secondary-light';
  if (ratioPct >= 90 && ratioPct <= 110) return 'text-verde';         // dentro de ±10% → estimé bien
  if (ratioPct >= 70 && ratioPct <= 130) return 'text-naranja';       // desviación moderada
  return 'text-rosa';                                                  // muy desviado
};
function DevRow({ label, color, est, reg, delta }: { label: string; color?: string; est: number; reg: number; delta: number }) {
  const ratio = est > 0 ? Math.round((reg / est) * 100) : null;
  return (
    <div className="flex items-center gap-2 text-[11px] font-bold">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="w-24 truncate dark:text-text-secondary text-text-secondary-light">{label}</span>
      <span className="tabular-nums dark:text-text-secondary text-text-secondary-light">{formatMinutes(est)}→{formatMinutes(reg)}</span>
      <span className={`tabular-nums ${devColor(ratio)}`}>{devDelta(delta)}</span>
    </div>
  );
}

// §16.104 (pieza 6): fila FIJADO → HECHO (en tiempo) por bloque/etiqueta.
function FhRow({ label, color, fijado, hecho }: { label: string; color?: string; fijado: number; hecho: number }) {
  const ratio = fijado > 0 ? Math.round((hecho / fijado) * 100) : null;
  return (
    <div className="flex items-center gap-2 text-[11px] font-bold">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="w-24 truncate dark:text-text-secondary text-text-secondary-light">{label}</span>
      <span className="tabular-nums dark:text-text-secondary text-text-secondary-light">{formatMinutes(fijado)}→{formatMinutes(hecho)}</span>
      <span className={`tabular-nums ${devColor(ratio)}`}>{devDelta(hecho - fijado)}</span>
    </div>
  );
}

// §16.104 (pieza 8): un apartado de la entrada (para hoy / para otro día), plegable, con hijas agrupadas bajo su contenedor.
function EntradaSectionView({ label, section, otherPhrase, open, onToggle, showDate }: { label: string; section: EntradaSection; otherPhrase: string; open: boolean; onToggle: () => void; showDate: boolean }) {
  return (
    <div>
      <button onClick={onToggle} className="flex items-center gap-1.5 group w-full">
        {open ? <ChevronDown size={11} className="text-text-secondary/60" /> : <ChevronRight size={11} className="text-text-secondary/60" />}
        <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/60 group-hover:text-turquesa transition-colors">{label}</span>
        <span className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light">· {section.count} · {formatMinutes(section.minutes)}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1.5">
          {section.groups.map((g, gi) => (
            <div key={g.containerId || `s-${gi}`}>
              {g.containerId ? (
                <>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-turquesa" />
                    <span className="font-bold dark:text-white text-text-main-light truncate max-w-[300px]">{g.title || '(contenedor)'}</span>
                    {g.otherCount > 0 && <span className="text-[9px] font-bold text-text-secondary/70 shrink-0">· {g.otherCount} {otherPhrase}</span>}
                    {g.minutes > 0 && <span className="text-[10px] tabular-nums text-text-secondary shrink-0 ml-auto">{formatMinutes(g.minutes)}</span>}
                  </div>
                  <div className="pl-4 space-y-0.5 mt-0.5">
                    {g.rows.map(r => (
                      <div key={r.id} className="flex items-center gap-2 text-[11px]">
                        <span className={`w-1 h-1 rounded-full shrink-0 ${r.taskType === 'adhoc' ? 'bg-rosa' : 'bg-turquesa'}`} />
                        <span className="dark:text-text-secondary text-text-secondary-light truncate max-w-[300px]">{r.title || '(sin título)'}</span>
                        {showDate && r.dueDate && <span className="text-[9px] font-black uppercase tracking-wider text-text-secondary/60 shrink-0">{diaLargo(r.dueDate)}</span>}
                        {r.estimatedMinutes > 0 && <span className="text-[10px] tabular-nums text-text-secondary shrink-0 ml-auto">{formatMinutes(r.estimatedMinutes)}</span>}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                g.rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.taskType === 'adhoc' ? 'bg-rosa' : 'bg-turquesa'}`} />
                    <span className="dark:text-white text-text-main-light truncate max-w-[300px]">{r.title || '(sin título)'}</span>
                    {showDate && r.dueDate && <span className="text-[9px] font-black uppercase tracking-wider text-text-secondary/60 shrink-0">{diaLargo(r.dueDate)}</span>}
                    {r.estimatedMinutes > 0 && <span className="text-[10px] tabular-nums text-text-secondary shrink-0 ml-auto">{formatMinutes(r.estimatedMinutes)}</span>}
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REPASO DE LO NO HECHO (§16.47) — al final del reporte. Cada pendiente con sus salidas; nada automático.
// ─────────────────────────────────────────────────────────────────────────────
const tagDot = (tags: any): string => tagHexKey((tags?.[0] || 'resto'));
const REP_WD = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function repDiaCorto(iso: string): string { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, (m || 1) - 1, d || 1); return `${REP_WD[dt.getDay()]} ${d}`; }
function repNextDay(iso: string): string { return formatLocalISO(new Date(parseLocalISO(iso).getTime() + 86400000)); }
function repCapFirst(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function RepasoSection({ pendingTasks, activeDate, blocks, timeEntries, onComplete, onDelete, onRepasoMove, repasoWillCollide, repasoDayLoad }: any) {
  const [otherFor, setOtherFor] = useState<any>(null);
  const [otherDate, setOtherDate] = useState<string | null>(null);
  const [collision, setCollision] = useState<any>(null);
  const [deleteFor, setDeleteFor] = useState<any>(null);
  const [dragAll, setDragAll] = useState(false);
  const [openRep, setOpenRep] = useState(true); // §16.104 (pieza 4): plegable

  if (!pendingTasks || pendingTasks.length === 0) return null;
  const tomorrow = repNextDay(activeDate);
  const blockName = (id: string) => blocks.find((b: any) => b.id === id)?.name || '';
  const blockColor = (id: string) => blocks.find((b: any) => b.id === id)?.color || '#888';
  const isHalfDone = (t: any) => (timeEntries || []).some((e: any) => e && (e.taskId === t.id || e.subtaskId === t.id) && e.date === activeDate);
  const isRecurrent = (t: any) => !!(t.templateId || t.recurrence?.frequency);
  const move = (task: any, date: string) => {
    if (repasoWillCollide?.(task, date)) { setCollision({ task, date }); return; }
    onRepasoMove?.(task, date); setOtherFor(null); setOtherDate(null);
  };
  const totalMins = pendingTasks.reduce((a: number, t: any) => a + (t.estimatedMinutes || 0), 0);
  const collisionCount = pendingTasks.filter((t: any) => repasoWillCollide?.(t, tomorrow)).length;

  return (
    <div className="mt-6 pt-5 border-t dark:border-border-main border-border-main-light">
      <button onClick={() => setOpenRep(o => !o)} className="flex items-center gap-1.5 mb-2.5 group">
        {openRep ? <ChevronDown size={12} className="text-text-secondary/70" /> : <ChevronRight size={12} className="text-text-secondary/70" />}
        <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary/70 group-hover:text-turquesa transition-colors">Te quedan {pendingTasks.length} sin hacer</span>
      </button>
      {openRep && (<>
      <div className="space-y-0.5">
        {pendingTasks.map((t: any) => {
          const roll = t.rolledOverCount || 0;
          const alert = roll >= 3; // §16.47: 3 veces movida = decisión que no se está tomando, no una tarea. Naranja.
          return (
            <div key={t.id} className="flex items-center gap-2 py-1 group/rep">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tagDot(t.tags) }} />
              {isRecurrent(t) && <Repeat size={11} className="shrink-0 text-text-secondary/60" />}
              <span className="text-[12px] dark:text-white text-text-main-light truncate max-w-[200px]">{t.title || '(sin título)'}</span>
              {blockName(t.blockId) && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: blockColor(t.blockId) + '22', color: blockColor(t.blockId) }}>{blockName(t.blockId)}</span>}
              {(t.estimatedMinutes || 0) > 0 && <span className="text-[10px] tabular-nums text-text-secondary shrink-0">{formatMinutes(t.estimatedMinutes)}</span>}
              {isHalfDone(t) && <span className="text-[8px] font-black uppercase tracking-wider text-azul shrink-0">a medias</span>}
              {roll >= 2 && <span className={`text-[8px] font-black uppercase tracking-wider shrink-0 ${alert ? 'text-naranja' : 'text-text-secondary/60'}`}>↻ movida {roll} veces</span>}
              <div className="flex items-center gap-0.5 ml-auto shrink-0 opacity-60 group-hover/rep:opacity-100 transition-opacity">
                <button onClick={() => onComplete?.(t.id)} title="Completar" className="p-1 rounded hover:bg-verde/10 text-verde"><CheckCircle2 size={14} /></button>
                <button onClick={() => move(t, tomorrow)} title="Pasar a mañana" className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider text-turquesa hover:bg-turquesa/10">Mañana</button>
                <button onClick={() => { setOtherFor(t); setOtherDate(null); }} title="Pasar a otro día" className="p-1 rounded hover:bg-turquesa/10 text-text-secondary hover:text-turquesa"><CalendarDays size={13} /></button>
                <button onClick={() => setDeleteFor(t)} title="Eliminar" className="p-1 rounded hover:bg-rosa/10 text-text-secondary hover:text-rosa"><Trash2 size={13} /></button>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={() => setDragAll(true)} className="mt-3 text-[10px] font-black uppercase tracking-widest text-turquesa hover:underline flex items-center gap-1">
        <ArrowRight size={12} /> Arrastrar todo a mañana ({formatMinutes(totalMins)})
      </button>
      </>)}

      {otherFor && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setOtherFor(null); setOtherDate(null); }} />
          <div className="relative dark:bg-bg-card bg-white rounded-3xl p-6 shadow-2xl border dark:border-border-main border-border-main-light w-full max-w-sm z-10">
            <p className="text-[11px] font-black uppercase tracking-widest dark:text-white text-text-main-light mb-3">Pasar "{(otherFor.title || '').slice(0, 28)}" a…</p>
            <MonthDatePicker value={otherDate} onChange={setOtherDate} />
            {otherDate && (() => { const l = repasoDayLoad?.(otherDate) || { minutes: 0, count: 0 }; return (
              <div className="mt-3 text-[11px] font-bold text-turquesa">{repCapFirst(repDiaCorto(otherDate))} · ya tienes {formatMinutes(l.minutes)}{l.count > 0 ? ` (${l.count} tarea${l.count === 1 ? '' : 's'})` : ''}</div>
            ); })()}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setOtherFor(null); setOtherDate(null); }} className="px-3 py-1.5 text-[11px] font-bold text-text-secondary hover:text-rosa">Cancelar</button>
              <button disabled={!otherDate} onClick={() => otherDate && move(otherFor, otherDate)} className="px-4 py-1.5 rounded-lg bg-turquesa text-white text-[11px] font-black uppercase disabled:opacity-40">Mover aquí</button>
            </div>
          </div>
        </div>
      )}

      {collision && <RepConfirm icon={<Repeat size={20} className="text-naranja" />} title="La rutina ya cae ese día"
        body={`"${(collision.task.title || '').slice(0, 40)}" es una rutina que también se genera el ${repDiaCorto(collision.date)}. Si la mueves, verás LAS DOS ese día (la que traes tú y la de la rutina).`}
        confirmText="Mover igual" onConfirm={() => { onRepasoMove?.(collision.task, collision.date); setCollision(null); setOtherFor(null); setOtherDate(null); }} onCancel={() => setCollision(null)} />}

      {deleteFor && <RepConfirm icon={<Trash2 size={20} className="text-rosa" />} title="¿Eliminar?" danger
        body={`Se elimina "${(deleteFor.title || '').slice(0, 40)}".`}
        confirmText="Eliminar" onConfirm={() => { onDelete?.(deleteFor.id); setDeleteFor(null); }} onCancel={() => setDeleteFor(null)} />}

      {dragAll && <RepConfirm icon={<ArrowRight size={20} className="text-turquesa" />} title="Arrastrar todo a mañana"
        body={`Mueves ${pendingTasks.length} tarea${pendingTasks.length === 1 ? '' : 's'} · ${formatMinutes(totalMins)}${collisionCount > 0 ? `. ${collisionCount} son rutinas que también caen mañana (verás las dos de cada una).` : '.'}`}
        confirmText="Mover todo" onConfirm={() => { pendingTasks.forEach((t: any) => onRepasoMove?.(t, tomorrow)); setDragAll(false); }} onCancel={() => setDragAll(false)} />}
    </div>
  );
}

function RepConfirm({ icon, title, body, confirmText, danger, onConfirm, onCancel }: any) {
  return (
    <div className="fixed inset-0 z-[330] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative dark:bg-bg-card bg-white rounded-3xl p-6 shadow-2xl border dark:border-border-main border-border-main-light w-full max-w-sm z-10">
        <div className="flex items-center gap-2 mb-2">{icon}<h3 className="text-base font-black dark:text-white text-text-main-light">{title}</h3></div>
        <p className="text-[12px] dark:text-text-secondary text-text-secondary-light">{body}</p>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-3 py-1.5 text-[11px] font-bold text-text-secondary hover:text-text-main-light">Cancelar</button>
          <button onClick={onConfirm} className={`px-4 py-1.5 rounded-lg text-white text-[11px] font-black uppercase ${danger ? 'bg-rosa hover:bg-rosa/90' : 'bg-turquesa hover:bg-turquesa/90'}`}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
