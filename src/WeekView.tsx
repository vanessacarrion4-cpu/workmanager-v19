/**
 * WeekView.tsx
 * Vista semanal — Modo Bloques (default) + Modo Cards expandible
 * Para semanas dentro de ±60 días usa allTasksMap (instancias generadas por Worker)
 * Para semanas fuera de esa ventana calcula recurrentes desde templates
 */

import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Plus, Check, CalendarDays, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Task, WorkBlock, TimeEntry } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { filterTasksForDay } from './filters';
import { formatMinutes } from './utils';
import { TAG_LABELS } from './constants';

// ─── Colores carga (igual que WorkloadView) ───────────────────────────────────
function getPctColor(pct: number): string {
  if (pct === 0) return 'transparent';
  if (pct < 60) return '#10B981';
  if (pct < 80) return '#F59E0B';
  if (pct <= 100) return '#A855F7';
  return '#EC4899';
}
function getPctTextClass(pct: number): string {
  if (pct === 0) return 'dark:text-text-secondary/30 text-text-secondary-light/30';
  if (pct < 60) return 'text-[#10B981]';
  if (pct < 80) return 'text-[#F59E0B]';
  if (pct <= 100) return 'text-[#A855F7]';
  return 'text-[#EC4899]';
}

// ─── Helpers fecha ─────────────────────────────────────────────────────────────
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(dateStr: string, n: number): string {
  const d = parseLocalISO(dateStr);
  d.setDate(d.getDate() + n);
  return formatLocalISO(d);
}
function formatDayLabel(dateStr: string) {
  const d = parseLocalISO(dateStr);
  const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return { day: days[d.getDay()], num: d.getDate(), month: months[d.getMonth()] };
}

// ─── Calcular si una fecha de recurrencia aplica ──────────────────────────────
function occursOnDate(recurrence: any, dateStr: string): boolean {
  if (!recurrence) return false;
  if (dateStr < recurrence.startDate) return false;
  if (recurrence.endDate && dateStr > recurrence.endDate) return false;
  const d = parseLocalISO(dateStr);
  const dow = (d.getDay() + 6) % 7; // 0=lun...6=dom
  switch (recurrence.frequency) {
    case 'daily': return true;
    case 'weekdays': return dow <= 4;
    case 'weekly': return (recurrence.weekDays || []).includes(dow);
    case 'monthly': return d.getDate() === (recurrence.monthDay || 1);
    case 'yearly':
      return d.getDate() === (recurrence.yearDay || 1) &&
             (d.getMonth() + 1) === (recurrence.yearMonth || 1);
    default: return false;
  }
}

// ─── Generar instancias virtuales desde templates para fechas fuera del Worker ─
function generateVirtualInstances(
  allTasksMap: Record<string, Task>,
  date: string
): Task[] {
  const result: Task[] = [];
  const templates = Object.values(allTasksMap).filter(
    t => t.isTemplate && !t.templateId && !t.isDeleted
  );

  templates.forEach(container => {
    const subtasks = (container.subtasks || [])
      .map(id => allTasksMap[id])
      .filter(Boolean);

    subtasks.forEach(sub => {
      if (!sub.recurrence) return;
      if (!occursOnDate(sub.recurrence, date)) return;

      // Crear instancia virtual del contenedor
      const contInstId = `inst-${container.id}-${date}`;
      if (!result.find(r => r.id === contInstId)) {
        result.push({
          ...container,
          id: contInstId,
          templateId: container.id,
          instanceDate: date,
          dueDate: date,
          isTemplate: false,
          isException: false,
        });
      }
      // Crear instancia virtual de la subtarea
      const subInstId = `inst-${sub.id}-${date}`;
      result.push({
        ...sub,
        id: subInstId,
        templateId: sub.id,
        instanceDate: date,
        dueDate: date,
        parentTaskId: contInstId,
        isTemplate: false,
        isException: false,
      });
    });
  });
  return result;
}

const MINS_CAPACITY_DAY = 480;

// ─── WeekView ─────────────────────────────────────────────────────────────────
export function WeekView({
  allTasksMap,
  blocks,
  timeEntries = [],
  onEditTask,
  onToggle,
  onAddTask,
  onNavigateToDashboard,
}: {
  allTasksMap: Record<string, Task>;
  blocks: WorkBlock[];
  timeEntries: TimeEntry[];
  onEditTask: (id: string) => void;
  onToggle: (id: string) => void;
  onAddTask: (parentId: string | null, blockId?: string, date?: string) => void;
  onNavigateToDashboard: (date: string) => void;
}) {
  const today = formatLocalISO(new Date());
  const generatedEnd = addDays(today, 60);
  const generatedStart = addDays(today, -30);

  const [weekStart, setWeekStart] = useState(() =>
    formatLocalISO(getMondayOfWeek(new Date()))
  );
  const [showWeekend, setShowWeekend] = useState(false);
  const [jumpDate, setJumpDate] = useState('');
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());

  const days = useMemo(() => {
    const count = showWeekend ? 7 : 5;
    return Array.from({ length: count }, (_, i) => addDays(weekStart, i));
  }, [weekStart, showWeekend]);

  const weekLabel = useMemo(() => {
    const start = parseLocalISO(days[0]);
    const end = parseLocalISO(days[days.length - 1]);
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`;
  }, [days]);

  // Para cada día: usar allTasksMap si está en ventana, calcular desde templates si no
  const tasksByDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    days.forEach(date => {
      const inWindow = date >= generatedStart && date <= generatedEnd;
      if (inWindow) {
        map[date] = filterTasksForDay(Object.values(allTasksMap), date);
      } else {
        // Fuera de ventana: calcular desde templates
        const virtual = generateVirtualInstances(allTasksMap, date);
        // También incluir tareas manuales con esa fecha
        const manual = Object.values(allTasksMap).filter(
          t => !t.isTemplate && !t.templateId && t.dueDate === date && !t.isDeleted
        );
        map[date] = [...manual, ...virtual];
      }
    });
    return map;
  }, [days, allTasksMap, generatedStart, generatedEnd]);

  const activeBlocks = useMemo(() => blocks.filter(b => b.isActive), [blocks]);

  const statsByDay = useMemo(() => {
    const map: Record<string, { totalMins: number; pct: number }> = {};
    days.forEach(date => {
      const tasks = tasksByDay[date] || [];
      const totalMins = tasks.reduce((acc, t) => {
        if (!t.subtasks || t.subtasks.length === 0) return acc + (t.estimatedMinutes || 0);
        return acc;
      }, 0);
      map[date] = { totalMins, pct: Math.round((totalMins / MINS_CAPACITY_DAY) * 100) };
    });
    return map;
  }, [days, tasksByDay]);

  const toggleBlock = (date: string, blockId: string) => {
    const key = `${date}__${blockId}`;
    setExpandedBlocks(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const isOutsideWindow = days.some(d => d < generatedStart || d > generatedEnd);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-4 pb-32 max-w-full"
    >
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-3xl font-black dark:text-white text-text-main-light">Semana</h2>
          <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle L-V / L-D */}
          <div className="flex rounded-xl overflow-hidden border dark:border-border-main border-border-main-light">
            <button onClick={() => setShowWeekend(false)}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${!showWeekend ? 'bg-turquesa text-white' : 'dark:text-text-secondary text-text-secondary-light hover:dark:text-white'}`}
            >L-V</button>
            <button onClick={() => setShowWeekend(true)}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${showWeekend ? 'bg-turquesa text-white' : 'dark:text-text-secondary text-text-secondary-light hover:dark:text-white'}`}
            >L-D</button>
          </div>
          {/* Nav semana */}
          <div className="flex items-center gap-1">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))}
              className="w-8 h-8 flex items-center justify-center dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl hover:border-turquesa/50 transition-all dark:text-text-secondary text-text-secondary-light hover:text-turquesa">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setWeekStart(formatLocalISO(getMondayOfWeek(new Date())))}
              className="px-3 h-8 text-[10px] font-black uppercase tracking-widest dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl hover:border-turquesa/50 transition-all dark:text-text-secondary text-text-secondary-light hover:text-turquesa">
              Hoy
            </button>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))}
              className="w-8 h-8 flex items-center justify-center dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl hover:border-turquesa/50 transition-all dark:text-text-secondary text-text-secondary-light hover:text-turquesa">
              <ChevronRight size={14} />
            </button>
          </div>
          {/* Jump to date */}
          <input type="date" value={jumpDate}
            onChange={e => {
              setJumpDate(e.target.value);
              if (e.target.value) setWeekStart(formatLocalISO(getMondayOfWeek(parseLocalISO(e.target.value))));
            }}
            className="h-8 px-3 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl text-[11px] font-bold dark:text-white text-text-main-light outline-none focus:border-turquesa/50 transition-all"
          />
        </div>
      </div>

      {/* Aviso semana fuera de ventana generada */}
      {isOutsideWindow && (
        <div className="flex items-center gap-2 px-4 py-2.5 dark:bg-azul/10 bg-azul/5 border dark:border-azul/20 border-azul/20 rounded-2xl">
          <RefreshCw size={13} className="text-azul shrink-0" />
          <p className="text-[11px] dark:text-text-secondary text-text-secondary-light">
            Semana fuera de la ventana generada — mostrando tareas recurrentes calculadas desde plantillas. Las tareas manuales fuera del rango no aparecen.
          </p>
        </div>
      )}

      {/* ── GRID SEMANAL ── */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map(date => {
          const { totalMins, pct } = statsByDay[date] || { totalMins: 0, pct: 0 };
          const isToday = date === today;
          const label = formatDayLabel(date);
          const dayTasks = tasksByDay[date] || [];
          const d = parseLocalISO(date);
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;

          return (
            <div key={date} className={`flex flex-col rounded-2xl border overflow-hidden transition-all ${
              isToday
                ? 'dark:border-turquesa/50 border-turquesa/40 dark:bg-turquesa/5 bg-turquesa/3'
                : isWeekend
                  ? 'dark:border-border-main/30 border-border-main-light/30 dark:bg-white/[0.01] bg-gray-50/50'
                  : 'dark:border-border-main border-border-main-light dark:bg-bg-card bg-white'
            }`}>

              {/* Header día */}
              <button onClick={() => onNavigateToDashboard(date)}
                className="w-full text-left p-3 hover:dark:bg-white/5 hover:bg-black/5 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${isToday ? 'text-turquesa' : 'dark:text-text-secondary text-text-secondary-light'}`}>
                      {label.day}
                    </span>
                    <span className={`text-lg font-black leading-none ${isToday ? 'text-turquesa' : 'dark:text-white text-text-main-light'}`}>
                      {label.num}
                    </span>
                    <span className="text-[10px] dark:text-text-secondary/50 text-text-secondary-light/50">
                      {label.month}
                    </span>
                  </div>
                  {totalMins > 0 && (
                    <span className={`text-[10px] font-black ${getPctTextClass(pct)}`}>
                      {formatMinutes(totalMins)}
                    </span>
                  )}
                </div>
                <div className="w-full h-1.5 dark:bg-white/10 bg-black/8 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, pct)}%`, backgroundColor: getPctColor(pct) }} />
                </div>
              </button>

              {/* Bloques */}
              <div className="flex-1 p-2 pt-0 space-y-1 min-h-[80px]">
                {activeBlocks.map(block => {
                  const blockTasks = dayTasks.filter(t => t.blockId === block.id && !t.isDeleted);
                  if (blockTasks.length === 0) return null;
                  const key = `${date}__${block.id}`;
                  const isExpanded = expandedBlocks.has(key);
                  const pendingCount = blockTasks.filter(t => t.status !== 'completed').length;
                  const blockMins = blockTasks.reduce((acc, t) =>
                    (!t.subtasks || t.subtasks.length === 0) ? acc + (t.estimatedMinutes || 0) : acc, 0);

                  return (
                    <div key={block.id} className="rounded-xl overflow-hidden">
                      <button onClick={() => toggleBlock(date, block.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 hover:dark:bg-white/5 hover:bg-black/5 transition-all rounded-xl">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
                        <span className="text-[10px] font-black dark:text-white text-text-main-light truncate flex-1 text-left uppercase tracking-wide">
                          {block.icon} {block.name}
                        </span>
                        <span className="text-[9px] dark:text-text-secondary text-text-secondary-light shrink-0">
                          {pendingCount}/{blockTasks.length}
                        </span>
                        {blockMins > 0 && (
                          <span className={`text-[9px] font-black shrink-0 ${getPctTextClass(pct)}`}>
                            {formatMinutes(blockMins)}
                          </span>
                        )}
                        {isExpanded
                          ? <ChevronUp size={10} className="shrink-0 dark:text-text-secondary/50 text-text-secondary-light/50" />
                          : <ChevronDown size={10} className="shrink-0 dark:text-text-secondary/50 text-text-secondary-light/50" />
                        }
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-0.5 pb-1 px-1">
                              {blockTasks.map(task => (
                                <WeekTaskCard
                                  key={task.id}
                                  task={task}
                                  onEdit={() => onEditTask(task.id)}
                                  onToggle={() => onToggle(task.id)}
                                />
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}

                {dayTasks.length === 0 && (
                  <div className="flex items-center justify-center py-4 opacity-20">
                    <p className="text-[10px] dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Sin tareas</p>
                  </div>
                )}

                <button
                  onClick={() => onAddTask(null, undefined, date)}
                  className="w-full flex items-center justify-center gap-1 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest dark:text-text-secondary/30 text-text-secondary-light/30 hover:dark:text-turquesa hover:text-turquesa hover:dark:bg-turquesa/5 hover:bg-turquesa/5 transition-all border border-dashed dark:border-border-main/20 border-border-main-light/20 hover:border-turquesa/30"
                >
                  <Plus size={10} /> Añadir
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── WeekTaskCard ─────────────────────────────────────────────────────────────
function WeekTaskCard({ task, onEdit, onToggle }: {
  task: Task;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const tagEmoji = task.tags?.[0] ? TAG_LABELS[task.tags[0]]?.icon : null;
  const isCompleted = task.status === 'completed';

  return (
    <div onClick={onEdit}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all cursor-pointer hover:dark:bg-white/5 hover:bg-black/5 ${isCompleted ? 'opacity-40' : ''}`}>
      <button onClick={e => { e.stopPropagation(); onToggle(); }}
        className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border-2 transition-all ${
          isCompleted ? 'bg-turquesa border-turquesa text-white' : 'dark:border-border-main border-border-main-light hover:border-turquesa'
        }`}>
        {isCompleted && <Check size={8} strokeWidth={3} />}
      </button>
      {tagEmoji && <span className="text-[11px] shrink-0">{tagEmoji}</span>}
      <span className={`text-[11px] font-bold dark:text-white text-text-main-light truncate flex-1 ${isCompleted ? 'line-through' : ''}`}>
        {task.title}
      </span>
      {task.templateId && <RefreshCw size={9} className="text-turquesa shrink-0 opacity-60" />}
      {(task.estimatedMinutes || 0) > 0 && (
        <span className="text-[9px] dark:text-text-secondary/60 text-text-secondary-light/60 shrink-0 font-bold">
          {formatMinutes(task.estimatedMinutes)}
        </span>
      )}
    </div>
  );
}
