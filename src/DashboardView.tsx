/**
 * DashboardView.tsx
 * Vista principal de tareas del día.
 * Extraído de App.tsx - Sesión 3 del refactor.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus, CheckCircle2, ChevronRight, ChevronDown, Clock,
  Zap, ArrowRight, X, CalendarIcon, Trash2, Edit
} from 'lucide-react';
import { Calendar as CalendarIcon2 } from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import { Task, TagType, WorkBlock, TimeEntry, Person } from './types';
import { TAG_LABELS } from './constants';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { getTaskEstimatedCombo, formatMinutes } from './utils';
import { filterTasksForDay, groupTasksByTag, getStatsForDay, EntradaForDay, computeVerdict, getReportBreakdown, getEstimationDeviation, getOutOfPlanBreakdown, getFijadoVsHecho, getPendingLeavesForDay, collectLeafTasks, encodePlanEntry, planEntryId } from './filters';
import { isCompletedForDay } from './fase3Contracts'; // §16.16 (b3): completado POR DÍA para el filtro "ocultar completadas"
import { supabase } from './supabaseClient';
import { TaskCard, BulkActionBar, DashboardHarmonicCalendar } from './components';
import { DayHeader } from './DayHeader'; // TRAMO 1: cabecera + foto (sustituye a las 3 tarjetas)
import { useDaySnapshot } from './useDaySnapshot';
import { DayReportModal } from './DayReportModal'; // TRAMO 4: reporte del día
import { useDayReport } from './useDayReport';

interface DashboardViewProps {
  tasks: Task[];
  allTasksMap: Record<string, Task>;
  entrada?: EntradaForDay | null; // TRAMO 2: qué se creó el día visto (calculado en App con el mapa completo)
  onRepasoMove?: (task: Task, newDate: string) => void; // FASE 6 cierre del día: mover al día siguiente/otro
  repasoWillCollide?: (task: Task, destDay: string) => boolean; // ¿la recurrente movida choca con su regla ese día?
  repasoDayLoad?: (dayISO: string) => { minutes: number; count: number }; // carga pendiente de un día (impacto)
  blocks: WorkBlock[];
  people?: Person[];
  onAddPerson?: (name: string) => void;
  onRenamePerson?: (id: string, name: string) => void;
  onDeletePerson?: (id: string) => void;
  timeEntries?: TimeEntry[];
  activeTimer?: any;
  onStartTimer?: (taskId: string, subtaskId?: string | null) => void;
  onStopTimer?: () => void;
  onToggle: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onAddTask: (parentTaskId?: string | null, blockId?: string, overrideDate?: string, defaultPersonId?: string, initialTitle?: string) => void;
  onUpdateTask: (task: Task) => void;
  onEditTask: (taskId: string) => void;
  editingTaskId?: string | null;
  inlineEditingTaskId?: string | null;
  setInlineEditingTaskId?: (id: string | null) => void;
  onOpenTimePanel?: (taskId: string, subtaskId: string | null) => void;
  onAddTimeEntry?: ((taskId: string, subtaskId: string | null, minutes: number, date: string, note?: string, markComplete?: boolean) => void) | null;
  activeDate: string;
  onSetDate: (date: string) => void;
  onDayChange: (delta: number) => void;
  onReorderTasks: (tasks: Task[]) => void;
  onBatchUpdateOrder?: (updates: { id: string, order: number }[]) => void;
  onReorderSubtasks: (parentId: string, subtaskIds: string[]) => void;
  onToggleExpand: (taskId: string) => void;
  onPromote?: (taskId: string) => void;
  onDemote?: (taskId: string) => void;
  onRecurrenceDateChange?: ((task: any, newDate: string) => void) | null;
  selectionMode?: boolean;
  selectedTaskIds?: Set<string>;
  onToggleTaskSelection?: ((taskId: string) => void) | null;
  onSelectScope?: ((ids: string[]) => void) | null; // F6-x2: seleccionar todo un grupo/día (dos alcances)
  scopeMode?: 'group' | 'all';                       // §16.72 interruptor de alcance (global, persistido)
  onSetScopeMode?: ((m: 'group' | 'all') => void) | null;
  onToggleGroupSelection?: ((subIds: string[]) => void) | null; // marca solo las hijas de un grupo (sin el contenedor)
  onEnsureSelectionMode?: (() => void) | null;
  onToggleSelectionMode?: (() => void) | null;
  bulkUpdateTasks?: ((updates: Partial<Task>) => void) | null;
  bulkDeleteTasks?: (() => void) | null;
  bulkDuplicateTasks?: (() => void) | null;
  bulkDelegateModal?: boolean;
  setBulkDelegateModal?: ((open: boolean) => void) | null;
  bulkDateModal?: boolean;
  setBulkDateModal?: ((open: boolean) => void) | null;
  bulkTimeModal?: boolean;
  setBulkTimeModal?: ((open: boolean) => void) | null;
  searchQuery?: string;
  composerOpenSignal?: number; // 1a: el botón "+ Tarea" global (StickyActionBar) sube este contador → abre el compositor
  hideCompleted?: boolean;
  onHideCompletedChange?: (v: boolean) => void;
  expandAll?: boolean | null;
  onExpandAllChange?: (v: boolean | null) => void;
  expandedBlocks?: Set<string>;
  onExpandedBlocksChange?: (v: Set<string>) => void;
}

export function DashboardView({
  tasks, allTasksMap, entrada = null, onRepasoMove, repasoWillCollide, repasoDayLoad, blocks, people = [], onAddPerson, onRenamePerson, onDeletePerson,
  timeEntries = [], activeTimer, onStartTimer, onStopTimer, onToggle, onDelete, onAddTask,
  onUpdateTask, onEditTask, editingTaskId, inlineEditingTaskId, setInlineEditingTaskId,
  onOpenTimePanel, activeDate, onSetDate, onDayChange, onReorderTasks, onReorderSubtasks, onBatchUpdateOrder,
  onToggleExpand, onPromote, onDemote, onRecurrenceDateChange = null, onGoToTemplate = null,
  onAddTimeEntry = null,
  selectionMode = false, selectedTaskIds = new Set(), onToggleTaskSelection = null,
  onSelectScope = null, scopeMode = 'group', onSetScopeMode = null, onToggleGroupSelection = null, onEnsureSelectionMode = null,
  onToggleSelectionMode = null, bulkUpdateTasks = null, bulkDeleteTasks = null,
  bulkDuplicateTasks = null, bulkDelegateModal = false, setBulkDelegateModal = null,
  bulkDateModal = false, setBulkDateModal = null, bulkTimeModal = false, setBulkTimeModal = null,
  onDeleteTimeEntry = null,
  onUpdateTimeEntry = null,
  searchQuery = '',
  composerOpenSignal = 0,
  hideCompleted: hideCompletedProp,
  onHideCompletedChange,
  expandAll: expandAllProp,
  onExpandAllChange,
  expandedBlocks: expandedBlocksProp,
  onExpandedBlocksChange,
}: DashboardViewProps) {

  const [hideCompletedLocal, setHideCompletedLocal] = useState(true);
  const hideCompleted = hideCompletedProp !== undefined ? hideCompletedProp : hideCompletedLocal;
  const setHideCompleted = (v: boolean) => { setHideCompletedLocal(v); onHideCompletedChange?.(v); };
  const [showDashboardCalendar, setShowDashboardCalendar] = useState(false);

  // FASE 5 — COMPOSITOR DE TANDA (alta rápida): eliges bloque UNA vez por tanda (sin default), el chip queda
  // visible, Enter encadena creando en ESE bloque, y el chip es desplegable para cambiar de bloque a mitad sin
  // salir. Título + Enter SIN bloque → no crea, conserva el título y abre el selector (nada se pierde). Enter en
  // vacío o Esc cierran la tanda; el bloque NO se recuerda entre tandas. Solo bloque (la etiqueta, candidato §16.35).
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerBlockId, setComposerBlockId] = useState<string | null>(null);
  const [composerTitle, setComposerTitle] = useState('');
  const [composerBlockMenu, setComposerBlockMenu] = useState(false);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const composerBlock = blocks.find((b: any) => b.id === composerBlockId);
  // 1b: al ABRIR, el compositor arranca SIEMPRE vacío (sin bloque) — no recuerda el de la tanda anterior
  // (recordar el último bloque sería el mismo default silencioso con otro nombre, descartado).
  const openComposer = () => { setComposerOpen(true); setComposerTitle(''); setComposerBlockId(null); setComposerBlockMenu(false); };
  const closeComposer = () => { setComposerOpen(false); setComposerTitle(''); setComposerBlockId(null); setComposerBlockMenu(false); };
  // 1a: el botón "+ Tarea" global (StickyActionBar) sube composerOpenSignal → abre el compositor (mismo camino que
  // los botones de Mi Día), en vez de crear directo con bloque por defecto.
  useEffect(() => { if (composerOpenSignal > 0) openComposer(); /* eslint-disable-next-line */ }, [composerOpenSignal]);
  const composerCommit = () => {
    const title = composerTitle.trim();
    if (!title) { closeComposer(); return; }                        // Enter en vacío → cerrar la tanda
    if (!composerBlockId) { setComposerBlockMenu(true); return; }    // sin bloque → NO crea; abre el selector (título conservado)
    onAddTask(null, composerBlockId, undefined, undefined, title);  // crea ya titulada en el bloque de la tanda (día = activeDate)
    setComposerTitle('');                                            // el input sigue montado y con foco → encadena
  };
  const [expandAllLocal, setExpandAllLocal] = useState<boolean | null>(null);
  const expandAll = expandAllProp !== undefined ? expandAllProp : expandAllLocal;
  const setExpandAll = (fn: ((prev: boolean | null) => boolean | null) | (boolean | null)) => {
    const next = typeof fn === 'function' ? fn(expandAll) : fn;
    setExpandAllLocal(next);
    onExpandAllChange?.(next);
  };
  const [expandedBlocksLocal, setExpandedBlocksLocal] = useState<Set<string>>(new Set(['con_hora', 'focus', 'dirección', 'espera', 'resto']));
  const expandedBlocks = expandedBlocksProp !== undefined ? expandedBlocksProp : expandedBlocksLocal;
  const setExpandedBlocks = (v: Set<string>) => { setExpandedBlocksLocal(v); onExpandedBlocksChange?.(v); };
  const [isFrozen, setIsFrozen] = useState(false);
  const frozenOrderRef = React.useRef<string[]>([]);
  const [dragOrders, setDragOrders] = useState<Record<string, string[]>>({});
  const [showTimeHistory, setShowTimeHistory] = useState(false);
  // 3A: desplegado de contenedores POR-RENDER (memoria local, clave `tag__id`). Evita que
  // un contenedor que aparece en varios grupos comparta isExpanded ("despliego una y se abre
  // otra"). No cambia ninguna escritura: la persistencia de #4 sigue intacta (se limpia en 3B).
  const [containerExpand, setContainerExpand] = useState<Record<string, boolean>>({});
  // Default POR CONTENEDOR, capturado UNA vez (no un true global ni el task.isExpanded
  // compartido/mutable que #4 voltea). Así cada tarjeta es independiente y se respeta el
  // estado inicial (incluido el persistido tras recargar).
  const containerExpandInitRef = React.useRef<Record<string, boolean>>({});
  const getContainerExpanded = (tagKey: string, t: Task): boolean => {
    const key = `${tagKey}__${t.id}`;
    if (!(key in containerExpandInitRef.current)) containerExpandInitRef.current[key] = t.isExpanded ?? true;
    if (key in containerExpand) return containerExpand[key];           // override individual (gana)
    if (expandAll === true || expandAll === false) return expandAll;   // estado global (expandir/colapsar todo)
    return containerExpandInitRef.current[key];                        // default individual capturado
  };
  // Al pulsar "expandir/colapsar todo" (cambia expandAll), se limpian los overrides individuales
  // para que el global vuelva a aplicar a todos; luego se pueden volver a togglear individualmente.
  React.useEffect(() => { setContainerExpand({}); }, [expandAll]);

  const dayTasks = useMemo(() => {
    const activeBlockIds = new Set(blocks.filter((b: any) => b.isActive).map((b: any) => b.id));
    return filterTasksForDay(
      tasks,
      allTasksMap,
      activeBlockIds,
      activeDate,
      { hideCompleted: false, hideDelegatedNoTag: true }
    );
  }, [tasks, activeDate, blocks, allTasksMap]);

  const filteredDayTasks = useMemo(() => {
    // §16.16 (b3): "ocultar completadas" usa el completado POR DÍA. Un contenedor con las hijas de HOY
    // hechas se oculta aunque tenga hijas pendientes de otro día (antes usaba isTaskCompleted = todas).
    let result = dayTasks.filter((t: Task) => !hideCompleted || !isCompletedForDay(t.id, allTasksMap, activeDate));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t: Task) => {
        // Coincide la tarea misma
        if (t.title.toLowerCase().includes(q)) return true;
        // O alguna de sus subtareas
        const subs = t.subtasks || [];
        return subs.some((sid: string) => allTasksMap[sid]?.title?.toLowerCase().includes(q));
      });
    }
    return result;
  }, [dayTasks, hideCompleted, allTasksMap, searchQuery]);

  const stats = useMemo(() => {
    const s = getStatsForDay(dayTasks, allTasksMap, timeEntries, activeDate);
    return s;
  }, [dayTasks, allTasksMap, timeEntries, activeDate]);

  // TRAMO 1 (foto del día): fijaciones + jornada del día activo.
  const { latest: daySnapshot, jornada, fijar, setJornada } = useDaySnapshot(activeDate);

  // TRAMO 4 (reporte del día): valoración automática + motivos/nota guardados.
  const [showReport, setShowReport] = useState(false);
  const { report: dayReport, guardar: guardarReport } = useDayReport(activeDate);
  // §16.102: denominador del reporte = PLAN CONGELADO de la foto (no recuento en vivo, que se mueve). `hechas` = cuántas
  // de ese plan están hechas AHORA. Sin foto con plan → null → el reporte muestra recuento sin "de M" (hueco honesto).
  const planCompletion = useMemo(() => {
    const plan = daySnapshot?.plan_task_ids;
    if (!plan || plan.length === 0) return null;
    const hechas = plan.filter((e: string) => isCompletedForDay(planEntryId(e), allTasksMap, activeDate)).length; // §16.106
    return { total: plan.length, hechas };
  }, [daySnapshot, allTasksMap, activeDate]);
  const verdict = useMemo(
    () => computeVerdict(
      stats,
      daySnapshot ? { estimated_minutes: daySnapshot.estimated_minutes, completed_count: daySnapshot.completed_count, plan_task_ids: daySnapshot.plan_task_ids } : null,
      jornada, timeEntries, activeDate, planCompletion
    ),
    [stats, daySnapshot, jornada, timeEntries, activeDate, planCompletion]
  );
  const reportBreakdown = useMemo(() => getReportBreakdown(dayTasks, allTasksMap, activeDate), [dayTasks, allTasksMap, activeDate]);
  // §16.101 ¿Estimo bien? — desviación estimado vs registrado de lo completado (no depende de la foto).
  const reportDeviation = useMemo(() => getEstimationDeviation(dayTasks, allTasksMap, timeEntries, activeDate), [dayTasks, allTasksMap, timeEntries, activeDate]);
  // §16.104 (pieza 7): desglose del tiempo NO previsto (tareas con tiempo fuera del plan de la foto).
  const outOfPlanBreakdown = useMemo(() => getOutOfPlanBreakdown(daySnapshot?.plan_task_ids || [], timeEntries, allTasksMap, activeDate), [daySnapshot, timeEntries, allTasksMap, activeDate]);
  // §16.104 (pieza 6): FIJADO vs HECHO en tiempo, por bloque y etiqueta (necesita foto con plan).
  const reportFijadoHecho = useMemo(() => getFijadoVsHecho(daySnapshot?.plan_task_ids || [], timeEntries, allTasksMap, activeDate), [daySnapshot, timeEntries, allTasksMap, activeDate]);

  // §16.104 (pieza 9): RESCATE del día anterior. Al ir a fijar, buscar el día MÁS RECIENTE < hoy con actividad (fijado o
  // tiempo fichado) y SIN reporte, y ofrecer cerrarlo primero. Nunca más de uno; se puede saltar. closed_late lo marca el modal.
  const [rescateDay, setRescateDay] = useState<string | null>(null);
  const doFijar = () => {
    // §16.106: congelar el plan (estimado + bloque + etiqueta + tipo por tarea) codificado en plan_task_ids, sin columna nueva.
    const planIds = collectLeafTasks(dayTasks, allTasksMap, activeDate).map(t => encodePlanEntry(t, allTasksMap));
    fijar(stats.total, stats.estimatedTotal, stats.completed, planIds).catch(() => {});
  };
  const findPreviousUnclosedDay = async (): Promise<string | null> => {
    try {
      // §16.104 (pieza 9 + ampliación): candidatos = días < hoy con actividad. Señales: fijado (day_snapshots), tiempo
      // fichado (time_entries, en memoria) y TAREAS PLANIFICADAS (tasks.due_date pasado — se consulta porque esta vista solo
      // tiene el mapa del día). Se ofrece el más reciente que NO tenga fila en day_reports.
      const [{ data: reps }, { data: snaps }, { data: dued }] = await Promise.all([
        supabase.from('day_reports').select('date'),
        supabase.from('day_snapshots').select('date'),
        supabase.from('tasks').select('due_date').eq('is_deleted', false).eq('is_template', false).lt('due_date', activeDate).not('due_date', 'is', null).order('due_date', { ascending: false }).limit(1000),
      ]);
      const reportSet = new Set((reps || []).map((r: any) => r.date));
      const cand = new Set<string>();
      (snaps || []).forEach((s: any) => { if (s.date && s.date < activeDate) cand.add(s.date); });
      (timeEntries || []).forEach((e: any) => { if (e && e.date && e.date < activeDate) cand.add(e.date); });
      (dued || []).forEach((t: any) => { if (t.due_date && t.due_date < activeDate) cand.add(t.due_date); });
      const unclosed = [...cand].filter(d => !reportSet.has(d)).sort();
      return unclosed.length ? unclosed[unclosed.length - 1] : null;
    } catch { return null; }
  };
  const attemptFijar = async () => {
    const prev = await findPreviousUnclosedDay();
    if (prev) { setRescateDay(prev); return; }
    doFijar();
  };
  // FASE 6 (cierre del día): hojas pendientes del día para el "Repaso de lo no hecho".
  const pendingLeaves = useMemo(() => getPendingLeavesForDay(dayTasks, allTasksMap, activeDate), [dayTasks, allTasksMap, activeDate]);

  // F6-x2 (§16.33): ids seleccionables de un conjunto de entradas de grupo = contenedor + sus hijas PENDIENTES del día
  // (aunque el contenedor esté contraído; el alcance es el DÍA, no la visibilidad). Mismo criterio que toggleTaskSelection.
  const groupSelectIds = (entries: any[]): string[] => {
    const ids: string[] = [];
    entries.forEach(({ task, subtasksForGroup: stfg }: any) => {
      ids.push(task.id);
      if (stfg && stfg.length) stfg.forEach((sid: string) => { if (allTasksMap[sid]?.status !== 'completed') ids.push(sid); });
    });
    return ids;
  };

  const groupedTasks = useMemo(() => {
    return groupTasksByTag(
      filteredDayTasks,
      allTasksMap,
      activeDate,
      { hideCompleted, hideDelegatedNoTag: true }
    );
  }, [filteredDayTasks, allTasksMap, activeDate, hideCompleted]);

  const formatDate = (dateStr: string) => {
    const d = parseLocalISO(dateStr);
    const dayName = new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(d);
    const dayNum = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(d);
    return { dayName, dayNum };
  };

  const { dayName, dayNum } = formatDate(activeDate);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-3"
    >
      {/* FILA 1 · FECHA — a la IZQUIERDA, silenciosa (§16.43): contexto, no titular. Sin caja/sombra/icono decorativo. */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2 py-0.5">
          {/* navegación */}
          <div className="flex gap-1 items-center">
            <button onClick={() => onDayChange(-1)} className="p-1.5 dark:hover:bg-bg-main hover:bg-bg-secondary-light rounded-lg transition-all dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light">
              <ChevronRight size={16} className="rotate-180" />
            </button>
            <button
              onClick={() => { const today = formatLocalISO(new Date()); onSetDate(today); }}
              className="px-3 py-1 bg-turquesa/10 text-turquesa rounded-lg font-black uppercase text-[10px] tracking-widest hover:bg-turquesa hover:text-white transition-all"
            >
              HOY
            </button>
            <button onClick={() => onDayChange(1)} className="p-1.5 dark:hover:bg-bg-main hover:bg-bg-secondary-light rounded-lg transition-all dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="ml-1">
            <div className="flex items-center">
              <div className="relative">
                <button
                  onClick={() => setShowDashboardCalendar(!showDashboardCalendar)}
                  className="text-[20px] font-bold dark:text-text-secondary text-slate-800 flex items-center gap-1 hover:text-turquesa transition-all"
                >
                  {/* Solo la 1ª letra en mayúscula: `capitalize` de CSS ponía "31 De Agosto" (mayúscula por palabra). §16.43 item 3. */}
                  {dayName.charAt(0).toUpperCase() + dayName.slice(1)}, {dayNum}
                  <ChevronDown size={12} className={`transition-transform duration-300 ${showDashboardCalendar ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {showDashboardCalendar && (
                    <>
                      <div className="fixed inset-0 z-[150]" onClick={() => setShowDashboardCalendar(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full left-1/2 -translate-x-1/2 mt-4 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] p-7 z-[160] min-w-[340px] backdrop-blur-2xl"
                      >
                        <div className="flex items-center justify-between mb-6 px-1">
                          <div className="flex flex-col">
                            <p className="text-[10px] font-black text-turquesa uppercase tracking-[0.2em]">Agenda</p>
                            <p className="text-[14px] font-black dark:text-white text-text-main-light">Ir a fecha</p>
                          </div>
                          <button onClick={() => setShowDashboardCalendar(false)} className="w-9 h-9 flex items-center justify-center dark:bg-bg-main bg-white hover:bg-turquesa/10 rounded-xl transition-all border dark:border-border-main border-border-main-light group">
                            <X size={16} className="dark:text-text-secondary text-text-secondary-light group-hover:text-turquesa transition-colors" />
                          </button>
                        </div>

                        <DashboardHarmonicCalendar
                          activeDate={activeDate}
                          onSetDate={onSetDate}
                          onClose={() => setShowDashboardCalendar(false)}
                        />

                        <div className="mt-6 pt-6 border-t border-border-main/50 grid grid-cols-2 gap-3">
                          <button
                            onClick={() => {
                              const today = formatLocalISO(new Date());
                              onSetDate(today);
                              setShowDashboardCalendar(false);
                            }}
                            className="flex items-center gap-3 p-3.5 bg-bg-main border border-border-main rounded-2xl hover:border-turquesa transition-all group"
                          >
                            <div className="w-8 h-8 rounded-xl bg-turquesa/10 flex items-center justify-center text-turquesa group-hover:bg-turquesa group-hover:text-white transition-all">
                              <Zap size={14} fill="currentColor" />
                            </div>
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Hoy</span>
                          </button>

                          <button
                            onClick={() => {
                              const tomorrow = new Date();
                              tomorrow.setDate(tomorrow.getDate() + 1);
                              const tomStr = formatLocalISO(tomorrow);
                              onSetDate(tomStr);
                              setShowDashboardCalendar(false);
                            }}
                            className="flex items-center gap-3 p-3.5 bg-bg-main border border-border-main rounded-2xl hover:border-azul transition-all group"
                          >
                            <div className="w-8 h-8 rounded-xl bg-azul/10 flex items-center justify-center text-azul group-hover:bg-azul group-hover:text-white transition-all">
                              <ArrowRight size={14} />
                            </div>
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Mañana</span>
                          </button>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TRAMO 1: CABECERA + FOTO (sustituye a las 3 tarjetas). Sin caja; la barra de progreso hace de separador. */}
      <DayHeader
        stats={stats}
        blocks={blocks}
        latest={daySnapshot}
        jornada={jornada}
        entrada={entrada}
        onFijar={() => { attemptFijar(); }}
        onSetJornada={setJornada}
        onOpenTimeHistory={() => setShowTimeHistory(true)}
        onOpenReport={() => setShowReport(true)}
      />

      {/* Task Groups */}
      <div className="space-y-3 pb-32">
        {/* §16.72 INTERRUPTOR DE ALCANCE + "seleccionar todo el día". Solo en modo selección. */}
        {selectionMode && (() => {
          const dayIds = Object.values(groupedTasks).flat().flatMap((e: any) => groupSelectIds([e]));
          const all = dayIds.length > 0 && dayIds.every((id: string) => selectedTaskIds.has(id));
          return (
            <div className="flex items-center flex-wrap gap-x-4 gap-y-2">
              {/* Interruptor: un MODO que se queda puesto (global, persistido). Cambia qué selecciona marcar un
                  contenedor multi-etiqueta: 'group' = solo las hijas de ese grupo (check parcial, no arrastra el
                  contenedor); 'all' = el contenedor entero + todas sus hijas (marcado en todas sus apariciones). */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light">
                {([['group', 'Solo este grupo'], ['all', 'Todos los grupos']] as const).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => onSetScopeMode?.(m)}
                    title={m === 'group' ? 'Marcar selecciona solo dentro del grupo donde marcas' : 'Marcar selecciona en todos los grupos donde aparece'}
                    className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${scopeMode === m ? 'bg-azul text-white shadow-sm' : 'dark:text-text-secondary text-text-secondary-light hover:text-azul'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {dayIds.length > 0 && (
                <button
                  onClick={() => { onEnsureSelectionMode?.(); onSelectScope?.(dayIds); }}
                  className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-azul hover:opacity-80"
                >
                  <span className={`w-4 h-4 rounded border-2 flex items-center justify-center ${all ? 'bg-azul border-azul' : 'border-azul/40'}`}>{all && <CheckCircle2 size={11} className="text-white" />}</span>
                  Seleccionar todo el día
                </button>
              )}
            </div>
          );
        })()}
        {(Object.entries(groupedTasks) as [TagType, { task: Task, subtasksForGroup: string[] | null }[]][]).map(([tag, tagEntries]) => {
          if (tagEntries.length === 0) return null;
          const isBlockExpanded = expandedBlocks.has(tag);
          const tagTasks = tagEntries.map(e => e.task);
          return (
            <div key={tag} className="space-y-2">
              <div className="flex items-center justify-between dark:border-border-main/50 border-border-main-light/50 border-b pb-2">
                <button
                  onClick={() => {
                    const newExpanded = new Set(expandedBlocks);
                    if (isBlockExpanded) {
                      newExpanded.delete(tag);
                    } else {
                      newExpanded.add(tag);
                    }
                    setExpandedBlocks(newExpanded);
                  }}
                  className="flex items-center gap-3 hover:opacity-70 transition-opacity"
                >
                  <div className="w-8 h-8 rounded-xl dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light flex items-center justify-center">
                    {TAG_LABELS[tag].icon || <CheckCircle2 size={16} className="text-lima" />}
                  </div>
                  <h3 className="font-bold text-sm uppercase tracking-widest dark:text-text-main text-text-main-light">
                    {TAG_LABELS[tag].label}
                  </h3>
                  <motion.div animate={{ rotate: isBlockExpanded ? 0 : -90 }} transition={{ duration: 0.2 }}>
                    <ChevronDown size={16} className="dark:text-text-secondary text-text-secondary-light" />
                  </motion.div>
                </button>
                <div className="flex items-center gap-1.5 text-[10px] font-black">
                  {/* §16.72: la casilla "Grupo" (F6-x2) se retiró — confundía con el interruptor de alcance. El
                      "seleccionar todo el grupo" ya no es un botón por-grupo; el alcance lo decide el interruptor global. */}
                  {(() => {
                    const pendingTaskIds: string[] = [];
                    tagEntries.forEach(({ task, subtasksForGroup: stfg }: any) => {
                      if (stfg && stfg.length > 0) {
                        stfg.forEach((sid: string) => {
                          const st = allTasksMap[sid];
                          if (st && st.status !== 'completed') pendingTaskIds.push(sid);
                        });
                      } else if (!task.subtasks || task.subtasks.length === 0) {
                        if (task.status !== 'completed') pendingTaskIds.push(task.id);
                      }
                    });
                    const estimated = pendingTaskIds.reduce((acc: number, id: string) => acc + getTaskEstimatedCombo(id, allTasksMap), 0);
                    return <>
                      <span className="dark:bg-bg-card bg-bg-card-light px-2.5 py-1 rounded-lg border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light uppercase">{pendingTaskIds.length} Tareas</span>
                      <span className="text-azul dark:bg-bg-card bg-bg-card-light px-2 py-1 rounded-lg border dark:border-border-main border-border-main-light flex items-center gap-1"><Clock size={10} />{formatMinutes(estimated)}</span>
                    </>;
                  })()}
                </div>
              </div>

              <AnimatePresence>
                {isBlockExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] shadow-xl overflow-hidden">
                      {(() => {
                        const localOrder = dragOrders[tag];
                        let orderedEntries = tagEntries;
                        if (localOrder) {
                          const idMap: Record<string, any> = {};
                          tagEntries.forEach((e: any) => { idMap[e.task.id] = e; });
                          orderedEntries = localOrder.map((id: string) => idMap[id]).filter(Boolean);
                          tagEntries.forEach((e: any) => { if (!localOrder.includes(e.task.id)) orderedEntries.push(e); });
                        }
                        const entryIds = orderedEntries.map((e: any) => e.task.id);
                        return (
                          <Reorder.Group
                            axis="y"
                            values={entryIds}
                            onReorder={(newIds: string[]) => {
                              setDragOrders(prev => ({ ...prev, [tag]: newIds }));
                            }}
                            className="divide-y dark:divide-border-main divide-border-main-light"
                            as="div"
                          >
                            {orderedEntries.map(({ task, subtasksForGroup }: any, idx: number) => (
                              <Reorder.Item
                                key={task.id}
                                value={task.id}
                                dragListener={!selectionMode}
                                onDragEnd={() => {
                                  // Persistir orden en Supabase en batch
                                  const currentOrder = dragOrders[tag] || entryIds;
                                  const updates = currentOrder.map((id: string, i: number) => ({ id, order: i }));
                                  // Actualizar estado global
                                  const updatedTasks = updates.map(({ id, order }: any) => {
                                    const t = allTasksMap[id] || tagEntries.find((e: any) => e.task.id === id)?.task;
                                    return t ? { ...t, order } : null;
                                  }).filter(Boolean);
                                  if (updatedTasks.length > 0) onReorderTasks(updatedTasks);
                                  // Persistir en Supabase
                                  updates.forEach(({ id, order }: any) => {
                                    supabase.from('tasks').update({ order }).eq('id', id).then(({ error }: any) => {
                                      if (error) console.error('[ORDER] Error saving order:', error);
                                    });
                                  });
                                }}
                                style={{ cursor: selectionMode ? 'default' : 'grab' }}
                                className="relative"
                                whileDrag={{ scale: 1.02, zIndex: 50, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
                              >
                                <TaskCard
                                  task={{ ...task, isExpanded: getContainerExpanded(tag, task) }}
                                  variant="DASHBOARD"
                                  dayForTotals={activeDate}
                                  allTasksMap={allTasksMap}
                                  people={people}
                                  onAddPerson={onAddPerson}
                                  onRenamePerson={onRenamePerson}
                                  onDeletePerson={onDeletePerson}
                                  blocks={blocks}
                                  timeEntries={timeEntries}
                                  activeTimer={activeTimer}
                                  onStartTimer={onStartTimer}
                                  onStopTimer={onStopTimer}
                                  onToggleStatus={onToggle}
                                  onUpdateTask={onUpdateTask}
                                  onEditTask={onEditTask}
                                  editingTaskId={editingTaskId}
                                  inlineEditingTaskId={inlineEditingTaskId}
                                  setInlineEditingTaskId={setInlineEditingTaskId}
                                  onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel && onOpenTimePanel(taskId, subtaskId)}
                                  onAddTimeEntry={onAddTimeEntry}
                                  onAddTask={onAddTask}
                                  onDelete={onDelete}
                                  onPromote={onPromote}
                                  onDemote={onDemote}
                                  onReorderSubtasks={onReorderSubtasks}
                                  onGoToTemplate={onGoToTemplate}
                                  onToggleExpand={(taskId: string) => {
                                    // 3A: contenedor de nivel 1 → override individual local SOBRE el
                                    // estado global (expandir/colapsar todo). Solo se mueve el que tocas.
                                    if (taskId === task.id) {
                                      const key = `${tag}__${task.id}`;
                                      setContainerExpand(prev => {
                                        if (key in prev) return { ...prev, [key]: !prev[key] };
                                        const base = (expandAll === true || expandAll === false)
                                          ? expandAll
                                          : (containerExpandInitRef.current[key] ?? (task.isExpanded ?? true));
                                        return { ...prev, [key]: !base };
                                      });
                                      // 3B: el desplegado del contenedor es 100% estado local → ya NO se
                                      // persiste is_expanded (antes handleToggleExpandTask escribía a una
                                      // fila inexistente para instancias y pisaba modified_at en balde).
                                    } else {
                                      // Subtareas: comportamiento normal (mantienen su persistencia).
                                      onToggleExpand(taskId);
                                    }
                                  }}
                                  onRecurrenceDateChange={onRecurrenceDateChange}
                                  hideCompleted={hideCompleted}
                                  subtasksForGroup={subtasksForGroup}
                                  forceExpanded={null}
                                  taskIndex={idx}
                                  taskCount={orderedEntries.length}
                                  onMoveUp={() => {
                                    if (idx === 0) return;
                                    const newOrder = orderedEntries.map((e: any) => e.task.id);
                                    [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
                                    setDragOrders(prev => ({ ...prev, [tag]: newOrder }));
                                    const updates = newOrder.map((id: string, i: number) => ({ id, order: i }));
                                    const updatedTasks = updates.map(({ id, order }: any) => {
                                      const t = allTasksMap[id];
                                      return t ? { ...t, order } : null;
                                    }).filter(Boolean);
                                    onReorderTasks(updatedTasks);
                                    updates.forEach(({ id, order }: any) => {
                                      supabase.from('tasks').update({ order }).eq('id', id).then(({ error }: any) => {
                                        if (error) console.error('[ORDER] Error:', error);
                                      });
                                    });
                                  }}
                                  onMoveDown={() => {
                                    if (idx === orderedEntries.length - 1) return;
                                    const newOrder = orderedEntries.map((e: any) => e.task.id);
                                    [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
                                    setDragOrders(prev => ({ ...prev, [tag]: newOrder }));
                                    const updates = newOrder.map((id: string, i: number) => ({ id, order: i }));
                                    const updatedTasks = updates.map(({ id, order }: any) => {
                                      const t = allTasksMap[id];
                                      return t ? { ...t, order } : null;
                                    }).filter(Boolean);
                                    onReorderTasks(updatedTasks);
                                    updates.forEach(({ id, order }: any) => {
                                      supabase.from('tasks').update({ order }).eq('id', id).then(({ error }: any) => {
                                        if (error) console.error('[ORDER] Error:', error);
                                      });
                                    });
                                  }}
                                  selectionMode={selectionMode}
                                  selectedTaskIds={selectedTaskIds}
                                  onToggleTaskSelection={onToggleTaskSelection}
                                  scopeMode={scopeMode}
                                  onToggleGroupSelection={onToggleGroupSelection}
                                  searchQuery={searchQuery}
                                />
                              </Reorder.Item>
                            ))}
                          </Reorder.Group>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {dayTasks.length === 0 && !composerOpen && (
          <div className="py-32 flex flex-col items-center justify-center text-text-secondary border-2 border-dashed border-border-main rounded-[2.5rem] bg-bg-card/30">
            <div className="w-16 h-16 bg-bg-card rounded-3xl flex items-center justify-center mb-6 border border-border-main shadow-2xl">
              <Zap size={32} className="text-turquesa opacity-40" />
            </div>
            <p className="font-bold text-lg mb-1">Día totalmente despejado</p>
            <p className="text-sm opacity-50 mb-8">No tienes nada planificado para hoy</p>
            <button
              onClick={openComposer}
              className="bg-turquesa hover:bg-turquesa/90 text-white px-8 py-3 rounded-2xl font-bold shadow-lg shadow-turquesa/20 transition-all flex items-center gap-3"
            >
              <Plus size={20} />
              + Tarea
            </button>
          </div>
        )}

        {dayTasks.length > 0 && !composerOpen && (
          <button
            onClick={openComposer}
            className="w-full py-5 border-2 border-dashed border-border-main rounded-[1.5rem] flex items-center justify-center gap-3 font-bold text-turquesa hover:bg-bg-card/50 transition-all"
          >
            <Plus size={20} />
            + Nueva tarea para hoy
          </button>
        )}

        {/* FASE 5 — Compositor de tanda */}
        {composerOpen && (
          <div className="w-full p-4 border-2 border-turquesa/50 rounded-[1.5rem] dark:bg-bg-card/60 bg-bg-card/40 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Añadiendo a</span>
              <div className="relative">
                <button
                  onClick={() => setComposerBlockMenu(o => !o)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${composerBlockId ? 'dark:border-border-main border-border-main-light' : 'border-turquesa text-turquesa animate-pulse'}`}
                  style={composerBlockId ? { color: composerBlock?.color } : undefined}
                  title={composerBlockId ? 'Cambiar de bloque (a mitad de tanda)' : 'Elige un bloque'}
                >
                  <span>{composerBlockId ? `${composerBlock?.icon || '📁'} ${composerBlock?.name || ''}` : '📁 Elegir bloque'}</span>
                  <ChevronDown size={12} />
                </button>
                {composerBlockMenu && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setComposerBlockMenu(false)} />
                    <div className="absolute left-0 top-full mt-1 z-[70] w-56 max-h-72 overflow-y-auto rounded-xl border dark:border-border-main border-border-main-light dark:bg-bg-card bg-white shadow-2xl p-1">
                      {blocks.filter((b: any) => b.isActive !== false && (b.name || '').trim()).map((b: any) => (
                        <button
                          key={b.id}
                          onClick={() => { setComposerBlockId(b.id); setComposerBlockMenu(false); composerInputRef.current?.focus(); }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-bold hover:dark:bg-white/5 hover:bg-black/5 transition-all text-left"
                        >
                          <span>{b.icon}</span>
                          <span style={{ color: b.color }}>{b.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
            <input
              ref={composerInputRef}
              autoFocus
              value={composerTitle}
              onChange={e => setComposerTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); composerCommit(); }
                else if (e.key === 'Escape') { e.preventDefault(); closeComposer(); }
              }}
              placeholder="Título de la tarea — Enter crea y encadena · Esc cierra"
              className="w-full px-3 py-2 rounded-xl dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light text-sm font-bold dark:text-white text-text-main-light outline-none focus:border-turquesa transition-all"
            />
            {composerTitle.trim() && !composerBlockId && (
              <p className="text-[11px] font-bold text-turquesa">Elige un bloque para crear la tarea.</p>
            )}
          </div>
        )}
      </div>

      {/* TRAMO 4: Reporte del día */}
      <DayReportModal
        open={showReport}
        onClose={() => setShowReport(false)}
        activeDate={activeDate}
        verdict={verdict}
        breakdown={reportBreakdown}
        deviation={reportDeviation}
        outOfPlan={outOfPlanBreakdown}
        fijadoHecho={reportFijadoHecho}
        entrada={entrada}
        blocks={blocks}
        report={dayReport}
        onGuardar={async (measures: any, motivos, nota) => { await guardarReport(measures.key, measures, motivos, nota); }}
        pendingTasks={pendingLeaves}
        timeEntries={timeEntries}
        onComplete={onToggle}
        onDelete={onDelete}
        onRepasoMove={onRepasoMove}
        repasoWillCollide={repasoWillCollide}
        repasoDayLoad={repasoDayLoad}
      />

      {/* §16.104 (pieza 9): RESCATE del día anterior sin cerrar — antes de fijar hoy */}
      {rescateDay && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setRescateDay(null)} />
          <div className="relative dark:bg-bg-card bg-white rounded-3xl p-6 shadow-2xl border dark:border-border-main border-border-main-light w-full max-w-sm z-10">
            <h3 className="text-base font-black dark:text-white text-text-main-light mb-1">Tienes un día sin cerrar</h3>
            <p className="text-[12px] dark:text-text-secondary text-text-secondary-light mb-4">
              Dejaste <span className="font-black text-turquesa">{new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric' }).format(parseLocalISO(rescateDay))}</span> sin reporte. Ciérralo antes de fijar hoy, o sáltatelo.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { const d = rescateDay; setRescateDay(null); onSetDate(d); setShowReport(true); }}
                className="w-full px-4 py-2.5 rounded-xl bg-turquesa text-white text-[11px] font-black uppercase tracking-widest hover:bg-turquesa/90"
              >Cerrar el {new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric' }).format(parseLocalISO(rescateDay))}</button>
              <button
                onClick={() => { setRescateDay(null); doFijar(); }}
                className="w-full px-4 py-2 rounded-xl text-[11px] font-bold text-text-secondary hover:text-text-main-light"
              >Saltar y fijar hoy</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal historial de tiempo registrado */}
      {showTimeHistory && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowTimeHistory(false)} />
          <div className="relative dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-3xl p-6 shadow-2xl w-full max-w-lg z-10 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-black dark:text-white text-text-main-light uppercase tracking-widest">Tiempo Registrado</h3>
                <p className="text-[11px] text-morado font-black mt-0.5">{new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseLocalISO(activeDate))}</p>
              </div>
              <button onClick={() => setShowTimeHistory(false)} className="w-8 h-8 flex items-center justify-center dark:text-text-secondary text-text-secondary-light dark:bg-bg-main bg-gray-100 rounded-xl border dark:border-border-main border-border-main-light">
                <X size={16} />
              </button>
            </div>

            {timeEntries.filter((e: any) => e.date === activeDate).length === 0 ? (
              <div className="text-center py-12 dark:text-text-secondary text-text-secondary-light">
                <Clock size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-bold">No hay tiempo registrado para hoy</p>
              </div>
            ) : (
              <div className="space-y-2">
                {timeEntries
                  .filter((e: any) => e.date === activeDate)
                  .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((entry: any) => (
                    <div key={entry.id} className="dark:bg-bg-main bg-gray-50 rounded-xl border dark:border-border-main border-border-main-light overflow-hidden">
                      <TimeEntryItem
                        entry={entry}
                        allTasksMap={allTasksMap}
                        onDelete={onDeleteTimeEntry}
                        onUpdate={onUpdateTimeEntry}
                      />
                    </div>
                  ))}
                <div className="pt-3 border-t dark:border-border-main border-border-main-light flex justify-between items-center">
                  <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Total</span>
                  <span className="font-black text-morado">{formatMinutes(stats.registered)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// Componentes auxiliares del Dashboard
// ─────────────────────────────────────────────

function TimeEntryItem({ entry, allTasksMap, onDelete, onUpdate }: any) {
  const [editing, setEditing] = React.useState(false);
  const [editMinutes, setEditMinutes] = React.useState(entry.duration);
  const [editNote, setEditNote] = React.useState(entry.note || '');
  const task = allTasksMap[entry.subtaskId || entry.taskId];
  const getTaskTitle = () => {
    if (entry.subtaskId && allTasksMap[entry.subtaskId]?.title) return allTasksMap[entry.subtaskId].title;
    if (entry.taskId && allTasksMap[entry.taskId]) {
      const t = allTasksMap[entry.taskId];
      if (t.title && !t.id.startsWith('inst-')) return t.title;
      if (t.templateId && allTasksMap[t.templateId]?.title) return allTasksMap[t.templateId].title;
    }
    return task?.title || entry.subtaskId || entry.taskId;
  };
  const taskTitle = getTaskTitle();

  if (!editing) {
    return (
      <div className="flex items-center gap-3 p-3 group">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black dark:text-white text-text-main-light truncate uppercase">{taskTitle}</p>
          {entry.note && <p className="text-[10px] dark:text-text-secondary text-text-secondary-light mt-0.5">{entry.note}</p>}
          <p className="text-[9px] dark:text-text-secondary/50 text-text-secondary-light/50 mt-0.5">{entry.source === 'timer' ? '⏱ Timer' : '✏️ Manual'}</p>
        </div>
        <span className="text-sm font-black text-morado shrink-0">{formatMinutes(entry.duration)}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
          <button onClick={() => { setEditing(true); setEditMinutes(entry.duration); setEditNote(entry.note || ''); }} className="w-6 h-6 flex items-center justify-center text-turquesa/70 hover:text-turquesa hover:bg-turquesa/10 rounded-lg transition-all">
            <Edit size={12} />
          </button>
          <button onClick={() => onDelete(entry.id)} className="w-6 h-6 flex items-center justify-center text-rosa/70 hover:text-rosa hover:bg-rosa/10 rounded-lg transition-all">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">{taskTitle}</p>
      <div className="flex items-center gap-2">
        <label className="text-[9px] dark:text-text-secondary text-text-secondary-light font-bold uppercase">Min:</label>
        <input type="number" value={editMinutes} onChange={e => setEditMinutes(Number(e.target.value))} className="w-20 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-lg px-2 py-1 text-sm dark:text-white text-text-main-light outline-none focus:border-morado/50" min={1} />
      </div>
      <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Nota..." className="w-full dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-lg px-2 py-1.5 text-sm dark:text-white text-text-main-light outline-none focus:border-morado/50" />
      <div className="flex gap-2">
        <button onClick={() => setEditing(false)} className="flex-1 py-1.5 rounded-lg border dark:border-border-main border-border-main-light text-[10px] font-black dark:text-text-secondary text-text-secondary-light">Cancelar</button>
        <button onClick={() => { onUpdate(entry.id, { duration: editMinutes, note: editNote }); setEditing(false); }} className="flex-1 py-1.5 rounded-lg bg-morado text-white text-[10px] font-black">Guardar</button>
      </div>
    </div>
  );
}

// SummaryCard BORRADO (sesión 26, tramo 1): las 3 tarjetas se sustituyeron por DayHeader. Sin componentes muertos.
