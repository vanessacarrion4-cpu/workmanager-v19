/**
 * DashboardView.tsx
 * Vista principal de tareas del día.
 * Extraído de App.tsx - Sesión 3 del refactor.
 */

import React, { useState, useMemo } from 'react';
import {
  Plus, CheckCircle2, ChevronRight, ChevronDown, Clock,
  Zap, ArrowRight, X, CalendarIcon, Trash2, Edit
} from 'lucide-react';
import { Calendar as CalendarIcon2 } from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import { Task, TagType, WorkBlock, TimeEntry, Person } from './types';
import { TAG_LABELS } from './constants';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { isTaskCompleted, getTaskEstimatedCombo, formatMinutes } from './utils';
import { filterTasksForDay, groupTasksByTag, getStatsForDay } from './filters';
import { supabase } from './supabaseClient';
import { TaskCard, BulkActionBar, DashboardHarmonicCalendar } from './components';

interface DashboardViewProps {
  tasks: Task[];
  allTasksMap: Record<string, Task>;
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
  onAddTask: (parentTaskId?: string | null, blockId?: string) => void;
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
  hideCompleted?: boolean;
  onHideCompletedChange?: (v: boolean) => void;
  expandAll?: boolean | null;
  onExpandAllChange?: (v: boolean | null) => void;
  expandedBlocks?: Set<string>;
  onExpandedBlocksChange?: (v: Set<string>) => void;
}

export function DashboardView({
  tasks, allTasksMap, blocks, people = [], onAddPerson, onRenamePerson, onDeletePerson,
  timeEntries = [], activeTimer, onStartTimer, onStopTimer, onToggle, onDelete, onAddTask,
  onUpdateTask, onEditTask, editingTaskId, inlineEditingTaskId, setInlineEditingTaskId,
  onOpenTimePanel, activeDate, onSetDate, onDayChange, onReorderTasks, onReorderSubtasks, onBatchUpdateOrder,
  onToggleExpand, onPromote, onDemote, onRecurrenceDateChange = null, onGoToTemplate = null,
  onAddTimeEntry = null,
  selectionMode = false, selectedTaskIds = new Set(), onToggleTaskSelection = null,
  onToggleSelectionMode = null, bulkUpdateTasks = null, bulkDeleteTasks = null,
  bulkDuplicateTasks = null, bulkDelegateModal = false, setBulkDelegateModal = null,
  bulkDateModal = false, setBulkDateModal = null, bulkTimeModal = false, setBulkTimeModal = null,
  onDeleteTimeEntry = null,
  onUpdateTimeEntry = null,
  searchQuery = '',
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
    let result = dayTasks.filter((t: Task) => !hideCompleted || !isTaskCompleted(t.id, allTasksMap));
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
      className="space-y-10"
    >
      {/* Date Header */}
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-3 items-center dark:bg-bg-card bg-bg-card-light p-4 rounded-[2rem] border dark:border-border-main border-border-main-light shadow-xl">
          {/* Izquierda: navegación */}
          <div className="flex gap-2">
            <button onClick={() => onDayChange(-1)} className="p-3 dark:hover:bg-bg-main hover:bg-bg-secondary-light rounded-2xl transition-all dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light">
              <ChevronRight size={20} className="rotate-180" />
            </button>
            <button
              onClick={() => { const today = formatLocalISO(new Date()); onSetDate(today); }}
              className="px-6 py-2 bg-turquesa/10 text-turquesa rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-turquesa hover:text-white transition-all"
            >
              HOY
            </button>
            <button onClick={() => onDayChange(1)} className="p-3 dark:hover:bg-bg-main hover:bg-bg-secondary-light rounded-2xl transition-all dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light">
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-0.5">
              <CalendarIcon2 size={16} className="text-turquesa" />
              <div className="relative">
                <button
                  onClick={() => setShowDashboardCalendar(!showDashboardCalendar)}
                  className="text-xl font-black capitalize dark:text-white text-text-main-light flex items-center gap-2 hover:text-turquesa transition-all"
                >
                  {dayName}, {dayNum}
                  <ChevronDown size={14} className={`transition-transform duration-300 ${showDashboardCalendar ? 'rotate-180' : ''}`} />
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
            <motion.p
              key={stats.completed}
              initial={{ scale: 1.4, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              className="text-[9px] font-bold uppercase tracking-[0.2em]"
              style={{ color: '#14B8A6' }}
            >{stats.completed} de {stats.total} completadas</motion.p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* TAREAS */}
        <SummaryCard
          label="Tareas"
          value={stats.completed}
          total={stats.total}
          progress={(stats.completed / (stats.total || 1)) * 100}
          color="turquesa"
        />
        {/* PENDIENTE */}
        <SummaryCard
          label="Pendiente"
          value={formatMinutes(stats.estimatedPending)}
          subtitle={stats.estimatedTotal > 0 ? `de ${formatMinutes(stats.estimatedTotal)} estimado` : null}
          progress={stats.estimatedTotal > 0 ? ((stats.estimatedTotal - stats.estimatedPending) / stats.estimatedTotal) * 100 : 0}
          color="azul"
        />
        {/* REGISTRADO */}
        <SummaryCard
          label="Registrado"
          value={formatMinutes(stats.registered)}
          color="morado"
          onClick={() => setShowTimeHistory(true)}
          clickable={true}
        />
      </div>

      <div className="h-px dark:bg-border-main/50 bg-border-main-light/50" />

      {/* Task Groups */}
      <div className="space-y-3 pb-32">
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
                                    // Subtareas → comportamiento normal.
                                    if (taskId === task.id) {
                                      const key = `${tag}__${task.id}`;
                                      setContainerExpand(prev => {
                                        if (key in prev) return { ...prev, [key]: !prev[key] };
                                        const base = (expandAll === true || expandAll === false)
                                          ? expandAll
                                          : (containerExpandInitRef.current[key] ?? (task.isExpanded ?? true));
                                        return { ...prev, [key]: !base };
                                      });
                                    }
                                    // Escritura de #4 intacta (cero cambio; se limpia en 3B).
                                    onToggleExpand(taskId);
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

        {dayTasks.length === 0 && (
          <div className="py-32 flex flex-col items-center justify-center text-text-secondary border-2 border-dashed border-border-main rounded-[2.5rem] bg-bg-card/30">
            <div className="w-16 h-16 bg-bg-card rounded-3xl flex items-center justify-center mb-6 border border-border-main shadow-2xl">
              <Zap size={32} className="text-turquesa opacity-40" />
            </div>
            <p className="font-bold text-lg mb-1">Día totalmente despejado</p>
            <p className="text-sm opacity-50 mb-8">No tienes nada planificado para hoy</p>
            <button
              onClick={() => onAddTask()}
              className="bg-turquesa hover:bg-turquesa/90 text-white px-8 py-3 rounded-2xl font-bold shadow-lg shadow-turquesa/20 transition-all flex items-center gap-3"
            >
              <Plus size={20} />
              + Tarea
            </button>
          </div>
        )}

        {dayTasks.length > 0 && (
          <button
            onClick={() => onAddTask()}
            className="w-full py-5 border-2 border-dashed border-border-main rounded-[1.5rem] flex items-center justify-center gap-3 font-bold text-turquesa hover:bg-bg-card/50 transition-all"
          >
            <Plus size={20} />
            + Nueva tarea para hoy
          </button>
        )}
      </div>

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

export function SummaryCard({ label, value, total, progress, color, subtitle, clickable, onClick }: any) {
  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={`dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-[2rem] p-4 shadow-xl relative overflow-hidden group ${clickable ? 'cursor-pointer hover:border-morado/50 transition-all' : ''}`}
    >
      <div className="relative z-10">
        <p className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em] mb-2">{label}</p>
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-2xl font-black dark:text-white text-text-main-light">
            {total !== undefined ? `${value}/${total}` : value}
          </h4>
          {progress !== undefined && (
            <span className={`text-xs font-black text-${color}`}>{Math.round(progress)}%</span>
          )}
        </div>
        {subtitle && (
          <p className="text-[10px] dark:text-text-secondary/60 text-text-secondary-light/60 mt-0.5">{subtitle}</p>
        )}
        {clickable && (
          <p className="text-[9px] text-morado/60 mt-1 uppercase tracking-widest font-bold">Ver historial →</p>
        )}
      </div>

      {progress !== undefined && (
        <div className="mt-3">
          <div className="h-1.5 dark:bg-bg-main/50 bg-bg-main-light/30 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(progress, 100)}%` }}
              className={`h-full bg-${color}`}
            />
          </div>
        </div>
      )}

      <div className={`absolute -bottom-10 -right-10 w-24 h-24 bg-${color} opacity-5 blur-[60px] group-hover:opacity-10 transition-opacity`} />
    </div>
  );
}
