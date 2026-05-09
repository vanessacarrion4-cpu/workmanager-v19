/**
 * CalendarView.tsx
 * Vista de calendario mensual con drawer de día.
 * Extraído de App.tsx - Sesión 3 del refactor.
 */

import React, { useState, useMemo } from 'react';
import {
  Plus, ChevronRight, ChevronLeft, ChevronDown, RefreshCw, Eye, EyeOff, X, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Task, TagType, WorkBlock, TimeEntry, Person } from './types';
import { TAG_LABELS, COLORS } from './constants';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { isTaskCompleted, formatMinutes } from './utils';
import { filterTasksForDay, groupTasksByTag, getStatsForDay } from './filters';
import {
  TaskCard, RecurrenceChoiceModal, BlockModal, DashboardHarmonicCalendar,
  DatePickerChip, TagPickerChip, RecurrencePickerChip, DelegationChip,
  EstimatedTimeChip, RegisteredTimeChip, BlockPickerChip, TimePickerChip,
  TaskTypeChip, TimerDisplay, BulkActionBar
} from './components';

/**
 * CalendarView.tsx
 * Vista de calendario mensual con drawer de día.
 * Extraído de App.tsx - Sesión 3 del refactor.
 */

import React, { useState, useMemo } from 'react';
import {
  Plus,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  RefreshCw,
  Eye,
  EyeOff,
  X,
  Clock,
  Calendar as CalendarIcon,
  Tag
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Task, TagType, WorkBlock, TimeEntry, Person } from './types';
import { TAG_LABELS, COLORS } from './constants';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { isTaskCompleted, getTaskEstimatedCombo, formatMinutes } from './utils';
import { filterTasksForDay, groupTasksByTag, getStatsForDay } from './filters';

export function CalendarView({ tasks, allTasksMap, blocks, people = [], onAddPerson, onRenamePerson = null, onDeletePerson = null, timeEntries, activeTimer, onStartTimer, onStopTimer, onUpdateTask, onEditTask, editingTaskId, inlineEditingTaskId, setInlineEditingTaskId, onOpenTimePanel, activeDate, onDateSelect, onAddTask, onToggleTask, onDelete, onReorderTasks, onReorderSubtasks, onToggleExpand, onPromote, onDemote, onRecurrenceDateChange = null }: any) {
  const [viewDate, setViewDate] = useState(() => parseLocalISO(activeDate));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
 
  const daysInMonth = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    
    // Adjust for Monday start (0=Sun, 1=Mon -> 1=Mon, 0=Sun)
    const padding = firstDay === 0 ? 6 : firstDay - 1;
    const array = [];
    for (let i = 0; i < padding; i++) array.push(null);
    for (let i = 1; i <= days; i++) {
       const d = new Date(year, month, i);
       array.push(formatLocalISO(d));
    }
    return array;
  }, [viewDate]);
 
  const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(viewDate);
 
  const activeBlockIds = useMemo(() => new Set(blocks.filter((b: any) => b.isActive).map((b: any) => b.id)), [blocks]);

  // Precalcular carga de todos los días del mes en un solo useMemo
  // Evita calcular filterTasksForDay para cada día en el render (muy costoso)
  // Incluir instancias generadas (recurrentes) además de tareas manuales y excepciones
  // Las instancias tienen templateId pero necesitamos sus dueDate para el calendario
  const realTasksForCalendar = useMemo(() => 
    Object.values(allTasksMap).filter((t: any) => {
      if (t.isDeleted) return false;
      if (t.isTemplate) return false; // No templates, solo instancias y manuales
      return true; // Incluir manuales, instancias generadas Y excepciones
    }) as Task[],
    [allTasksMap]
  );

  const monthLoadMap = useMemo(() => {
    const map: Record<string, number> = {};
    daysInMonth.forEach(day => {
      if (!day) return;
      const dayT = filterTasksForDay(realTasksForCalendar, allTasksMap, activeBlockIds, day, { hideCompleted: false, hideDelegatedNoTag: true });
      map[day] = getStatsForDay(dayT, allTasksMap, [], day).estimatedPending;
    });
    return map;
  }, [daysInMonth, realTasksForCalendar, activeBlockIds]);
 
  const getLoadColor = (minutes: number) => {
    if (minutes === 0) return 'bg-bg-secondary opacity-20';
    if (minutes < 180) return 'bg-lima shadow-[0_0_10px_rgba(132,204,22,0.3)]';
    if (minutes < 300) return 'bg-naranja shadow-[0_0_10px_rgba(245,158,11,0.3)]';
    if (minutes < 420) return 'bg-morado shadow-[0_0_10px_rgba(139,92,246,0.3)]';
    return 'bg-rosa shadow-[0_0_10px_rgba(236,72,153,0.3)]';
  };

  const getLoadColorHex = (minutes: number) => {
    if (minutes === 0) return '#6B7280';
    if (minutes < 180) return '#10B981';
    if (minutes < 300) return '#F59E0B';
    if (minutes < 420) return '#A855F7';
    return '#EC4899';
  };
 
  const dayTasks = useMemo(() => {
    if (!selectedDay) return [];
    const activeBlockIds = new Set(blocks.filter((b: any) => b.isActive).map((b: any) => b.id));
    return filterTasksForDay(
      tasks,
      allTasksMap,
      activeBlockIds,
      selectedDay,
      { hideCompleted: true, hideDelegatedNoTag: true }
    );
  }, [tasks, selectedDay, blocks, allTasksMap]);
  
  // Agrupar tareas por tags (igual que Dashboard)
  const groupedTasks = useMemo(() => {
    if (!selectedDay) return { con_hora: [], focus: [], dirección: [], espera: [], resto: [] };
    return groupTasksByTag(
      dayTasks,
      allTasksMap,
      selectedDay,
      { hideCompleted: true, hideDelegatedNoTag: true }
    );
  }, [dayTasks, selectedDay, allTasksMap]);
 
  const totalGroups = useMemo(() => {
    if (!selectedDay) return 0;
    return Object.values(groupedTasks as any).flat().length;
  }, [groupedTasks, selectedDay]);
 
  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="space-y-8 pb-32"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-black dark:text-white text-text-main-light capitalize">{monthName}</h2>
        <div className="flex gap-2">
          <button 
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
            className="p-3 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl dark:text-text-secondary text-text-secondary-light hover:text-white transition-all shadow-xl"
          >
            <ChevronRight size={20} className="rotate-180" />
          </button>
          <button 
            onClick={() => setViewDate(new Date())}
            className="px-6 py-2 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:text-white transition-all font-black uppercase text-[10px] tracking-widest rounded-2xl"
          >
            Hoy
          </button>
          <button 
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
            className="p-3 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl dark:text-text-secondary text-text-secondary-light hover:text-white transition-all shadow-xl"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
 
      <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2.5rem] p-8 shadow-2xl">
        <div className="grid grid-cols-8 mb-6">
          {['L', 'M', 'X', 'J', 'V', 'S', 'D', ''].map((d, i) => (
            <div key={i} className="text-center text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em]">{d}</div>
          ))}
        </div>
        {/* Agrupar días por semanas para añadir columna de resumen */}
        {(() => {
          // Construir filas de 7 días
          const rows: (string | null)[][] = [];
          for (let i = 0; i < daysInMonth.length; i += 7) {
            rows.push(daysInMonth.slice(i, i + 7));
          }
          // Rellenar última fila si no tiene 7
          while (rows[rows.length - 1]?.length < 7) rows[rows.length - 1].push(null);

          // Horas de jornada diaria (L-V)
          const WORKDAY_HOURS = 8 * 60; // 8h en minutos
          const WEEK_CAPACITY = WORKDAY_HOURS * 5; // L-V

          return rows.map((week, weekIdx) => {
            // Calcular carga total de la semana (solo días con datos)
            const weekDays = week.filter(Boolean) as string[];
            const weekLoad = weekDays.reduce((acc, day) => acc + (monthLoadMap[day] || 0), 0);
            const pct = Math.min(100, Math.round((weekLoad / WEEK_CAPACITY) * 100));
            const freePct = 100 - pct;
            
            // Usar los mismos rangos de color que la carga diaria (en minutos totales semanales)
            // < 15h semana (900m) → esmeralda
            // 15-25h (900-1500m) → naranja  
            // 25-35h (1500-2100m) → morado
            // > 35h (2100m+) → rosa
            const getWeekColor = () => {
              if (weekLoad < 900) return '#10B981'; // esmeralda
              if (weekLoad < 1500) return '#F59E0B'; // naranja
              if (weekLoad < 2100) return '#A855F7'; // morado
              return '#EC4899'; // rosa
            };
            
            const getWeekColorClass = () => {
              if (weekLoad < 900) return 'text-esmeralda';
              if (weekLoad < 1500) return 'text-naranja';
              if (weekLoad < 2100) return 'text-morado';
              return 'text-rosa';
            };
            
            const hasAnyLoad = weekLoad > 0;

            return (
              <div key={weekIdx} className="grid grid-cols-8 gap-3 mb-3">
                {week.map((day, dIdx) => {
                  if (!day) return <div key={dIdx} className="aspect-square" />;
                  const isToday = day === formatLocalISO(new Date());
                  const isSelected = day === selectedDay;
                  const load = monthLoadMap[day] || 0;
                  return (
                    <button 
                      key={day}
                      onClick={() => setSelectedDay(day)}
                      className={`
                        aspect-square rounded-2xl flex flex-col items-center justify-center relative transition-all group border-2
                        ${isSelected ? 'border-turquesa scale-110 shadow-xl z-20 dark:bg-bg-card bg-white' : 'border-transparent dark:hover:border-white/10 hover:border-gray-300'}
                        ${isToday ? 'dark:bg-bg-main bg-gray-100 ring-2 ring-turquesa ring-offset-4 dark:ring-offset-bg-card ring-offset-white' : ''}
                      `}
                    >
                      <span className={`text-xl font-black ${isSelected ? 'dark:text-white text-text-main-light' : 'dark:text-text-secondary text-text-secondary-light dark:group-hover:text-white group-hover:text-text-main-light'}`}>
                        {parseLocalISO(day).getDate()}
                      </span>
                      {load > 0 && (
                        <div className="mt-1.5 flex flex-col items-center gap-1">
                          <div className="text-[11px] font-black text-turquesa leading-none">
                            {formatMinutes(load)}
                          </div>
                          <div 
                            className="w-10 h-1.5 rounded-full transition-all"
                            style={{ 
                              backgroundColor: getLoadColorHex(load),
                              boxShadow: `0 0 10px ${getLoadColorHex(load)}33`
                            }}
                          />
                        </div>
                      )}
                    </button>
                  );
                })}

                {/* Columna resumen semanal */}
                <div className={`flex flex-col items-center justify-center rounded-2xl border-2 px-3 py-4 gap-3 ${
                  hasAnyLoad 
                    ? 'dark:bg-bg-main/60 bg-gray-50 dark:border-border-main/50 border-gray-200' 
                    : 'border-transparent opacity-30'
                }`}>
                  {hasAnyLoad ? (
                    <>
                      {/* Barra horizontal de progreso - más estilizada */}
                      <div className="w-full h-5 dark:bg-bg-main bg-gray-200 rounded-full overflow-hidden shadow-inner">
                        <div 
                          className="h-full transition-all duration-500 rounded-full"
                          style={{ 
                            width: `${pct}%`,
                            backgroundColor: getWeekColor(),
                            boxShadow: `0 0 12px ${getWeekColor()}55, inset 0 1px 1px rgba(255,255,255,0.3)`
                          }}
                        />
                      </div>
                      {/* Porcentajes - más grandes */}
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-[14px] font-black leading-none ${getWeekColorClass()}`}>
                          {pct}%
                        </span>
                        <span className="text-[12px] font-bold dark:text-text-secondary/70 text-text-secondary-light/70 leading-none">
                          libre {freePct}%
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-4 dark:bg-bg-main bg-gray-200 rounded-full" />
                  )}
                </div>
              </div>
            );
          });
        })()}
 
        <div className="mt-10 space-y-4">
          {/* Leyenda carga diaria */}
          <div className="text-center">
            <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Carga Diaria</p>
            <div className="flex flex-wrap gap-6 justify-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10B981' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">&lt;3h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">3-5h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#A855F7' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">5-7h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#EC4899' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">&gt;7h</span>
              </div>
            </div>
          </div>

          {/* Leyenda carga semanal */}
          <div className="text-center">
            <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Carga Semanal (L-V)</p>
            <div className="flex flex-wrap gap-6 justify-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10B981' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">&lt;15h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">15-25h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#A855F7' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">25-35h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#EC4899' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">&gt;35h</span>
              </div>
            </div>
          </div>
        </div>
      </div>
 
      {/* Day Drawer Overlay - DASHBOARD STYLE */}
      <AnimatePresence>
        {selectedDay && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDay(null)}
              className="fixed inset-0 z-40 bg-bg-main/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 z-50 dark:bg-bg-card bg-bg-card-light border-t dark:border-border-main border-border-main-light rounded-t-[3rem] p-8 max-h-[90vh] overflow-y-auto shadow-[0_-20px_50px_rgba(0,0,0,0.5)] custom-scrollbar"
            >
               <div className="flex items-center justify-between mb-8 sticky top-0 dark:bg-bg-card bg-bg-card-light backdrop-blur py-2 z-10">
                  <div className="flex items-center gap-4">
                     <button onClick={() => setSelectedDay(null)} className="p-3 dark:bg-bg-main bg-white rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light transition-all shadow-xl">
                        <ChevronRight size={20} className="rotate-180" />
                     </button>
                     <div>
                        <h3 className="text-2xl font-black dark:text-white text-text-main-light capitalize">
                          {new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseLocalISO(selectedDay))}
                        </h3>
                        <div className="flex items-center gap-3 mt-1">
                          {selectedDay >= formatLocalISO(new Date()) && (
                            <p className="text-[9px] font-black text-turquesa uppercase tracking-[0.2em]">Carga: {getStatsForDay(dayTasks, allTasksMap, [], selectedDay).estimatedPending}m</p>
                          )}
                          {selectedDay >= formatLocalISO(new Date()) && <span className="dark:text-text-secondary text-text-secondary-light opacity-30 text-[9px]">•</span>}
                          <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em]">{totalGroups} tareas</p>
                        </div>
                     </div>
                  </div>
                  <div className="flex gap-3">
                     <button 
                      onClick={() => onDateSelect(selectedDay)}
                      className="px-6 py-3 bg-turquesa text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-turquesa/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                     >
                       <CalendarIcon size={16} /> Ver en Dashboard
                     </button>
                     <button 
                      onClick={() => onAddTask(null, undefined, selectedDay)}
                      className="px-6 py-3 bg-azul text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-azul/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                     >
                       <Plus size={16} /> Añadir
                     </button>
                     <button onClick={() => setSelectedDay(null)} className="p-3 dark:bg-bg-main bg-white rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light transition-all shadow-xl">
                        <X size={20} />
                     </button>
                  </div>
               </div>
 
                <div className="space-y-10">
                  {Object.entries(TAG_LABELS).map(([tag, label]: [any, any]) => {
                    const groupTasks = (groupedTasks as any)[tag] || [];
                    if (groupTasks.length === 0) return null;
 
                    return (
                      <div key={tag} className="space-y-4">
                        <h4 className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.25em] pl-4 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-turquesa" />
                          {label.label} ({groupTasks.length})
                        </h4>
                        <div className="grid grid-cols-1 gap-4">
                          <Reorder.Group axis="y" values={groupTasks} onReorder={onReorderTasks} className="grid grid-cols-1 gap-4">
                            {groupTasks.map((item: any) => {
                              // Nuevo formato: { task, subtasksForGroup }
                              const task = item.task || item;
                              const subtasksForGroup = item.subtasksForGroup;
                              const isContainerGroup = subtasksForGroup && subtasksForGroup.length > 0;
                              
                              if (isContainerGroup) {
                                // Renderizar grupo de contenedor con subtareas
                                const subtaskObjects = subtasksForGroup
                                  .map((id: string) => allTasksMap[id])
                                  .filter(Boolean);
                                return (
                                  <div key={task.id} className="space-y-1">
                                    {/* Contenedor - mismo aspecto que tarea huérfana pero sin icono recurrencia */}
                                    <div className="flex items-center gap-2 px-2 py-1.5">
                                      <div className="w-2 h-2 rounded-full bg-turquesa/60 flex-shrink-0" />
                                      <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">
                                        {task.title}
                                      </span>
                                      <span className="text-[9px] dark:text-text-secondary text-text-secondary-light opacity-50">({subtaskObjects.length})</span>
                                    </div>
                                    
                                    {/* Subtareas con sangría */}
                                    <div className="space-y-2 ml-4 border-l-2 dark:border-border-main border-border-main-light pl-3">
                                      {subtaskObjects.map((sub: any) => (
                                        <TaskCard 
                                          key={sub.id}
                                          task={sub} 
                                          variant="COMPACT"
                                          allTasksMap={allTasksMap}
                                          people={people}
                                          onAddPerson={onAddPerson}
                                          blocks={blocks}
                                          timeEntries={timeEntries}
                                          activeTimer={activeTimer}
                                          onStartTimer={onStartTimer}
                                          onStopTimer={onStopTimer}
                                          onToggleStatus={onToggleTask}
                                          onUpdateTask={onUpdateTask}
                                          onEditTask={onEditTask}
                                          editingTaskId={editingTaskId}
                                          inlineEditingTaskId={inlineEditingTaskId}
                                          setInlineEditingTaskId={setInlineEditingTaskId}
                                          onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel(taskId, subtaskId)}
                                          onAddTask={onAddTask}
                                          onDelete={onDelete}
                                          onPromote={onPromote}
                                          onDemote={onDemote}
                                          onReorderSubtasks={onReorderSubtasks}
                                          onToggleExpand={onToggleExpand}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                );
                              } else {
                                // Tarea individual normal
                                return (
                                  <TaskCard 
                                    key={task.id}
                                    task={task} 
                                    variant="COMPACT"
                                    allTasksMap={allTasksMap}
                                    people={people}
                                    onAddPerson={onAddPerson}
                                    blocks={blocks}
                                    timeEntries={timeEntries}
                                    activeTimer={activeTimer}
                                    onStartTimer={onStartTimer}
                                    onStopTimer={onStopTimer}
                                    onToggleStatus={onToggleTask}
                                    onUpdateTask={onUpdateTask}
                                    onEditTask={onEditTask}
                                    editingTaskId={editingTaskId}
                                    inlineEditingTaskId={inlineEditingTaskId}
                                    setInlineEditingTaskId={setInlineEditingTaskId}
                                    onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel(taskId, subtaskId)}
                                    onAddTask={onAddTask}
                                    onDelete={onDelete}
                                    onPromote={onPromote}
                                    onDemote={onDemote}
                                    onReorderSubtasks={onReorderSubtasks}
                                    onToggleExpand={onToggleExpand}
                                  />
                                );
                              }
                            })}
                          </Reorder.Group>
                        </div>
                      </div>
                    );
                  })}
 
                  {totalGroups === 0 && (
                    <div className="py-20 text-center text-text-secondary border-2 border-dashed border-border-main rounded-[2.5rem] opacity-50 bg-bg-main/20">
                       <LayoutDashboard size={48} className="mx-auto mb-4 opacity-20" />
                       <p className="font-black uppercase tracking-[0.2em] text-xs">No hay tareas proyectadas para esta fecha</p>
                    </div>
                 )}
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
 
