/**
 * WeekView.tsx — v3
 * - Tiempo estimado correcto (suma subtareas hoja)
 * - Header día: pasado → registrado, futuro → estimado
 * - Toggle "Carga" para ver Core/Adhoc por bloque
 * - Dropdown agrupación: Bloque / Tipo / Bloque→Tipo / Tipo→Bloque
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Plus, Check, RefreshCw, Layers, Clock, LayoutGrid, Tag
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Task, WorkBlock, TimeEntry } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { filterTasksForDay } from './filters';
import { formatMinutes, getTaskEstimatedCombo } from './utils';
import { TAG_LABELS } from './constants';

// ─── Colores carga ────────────────────────────────────────────────────────────
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

// ─── Recurrencia fuera de ventana ─────────────────────────────────────────────
function occursOnDate(recurrence: any, dateStr: string): boolean {
  if (!recurrence) return false;
  if (dateStr < recurrence.startDate) return false;
  if (recurrence.endDate && dateStr > recurrence.endDate) return false;
  const d = parseLocalISO(dateStr);
  const dow = (d.getDay() + 6) % 7;
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
function generateVirtualInstances(allTasksMap: Record<string, Task>, date: string): Task[] {
  const result: Task[] = [];
  const templates = Object.values(allTasksMap).filter(t => t.isTemplate && !t.templateId && !t.isDeleted);
  templates.forEach(container => {
    const subtasks = (container.subtasks || []).map(id => allTasksMap[id]).filter(Boolean);
    subtasks.forEach(sub => {
      if (!sub.recurrence || !occursOnDate(sub.recurrence, date)) return;
      const contInstId = `inst-${container.id}-${date}`;
      if (!result.find(r => r.id === contInstId)) {
        result.push({ ...container, id: contInstId, templateId: container.id, instanceDate: date, dueDate: date, isTemplate: false, isException: false });
      }
      result.push({ ...sub, id: `inst-${sub.id}-${date}`, templateId: sub.id, instanceDate: date, dueDate: date, parentTaskId: contInstId, isTemplate: false, isException: false });
    });
  });
  return result;
}

// ─── Calcular minutos de una tarea para UN DÍA concreto ──────────────────────
// Igual que WorkloadView: usa estimatedMinutes del propio contenedor raíz
function getTaskMins(task: Task): number {
  return task.estimatedMinutes || 0;
}

// ─── Tipo efectivo — directo del taskType del contenedor ─────────────────────
function getEffectiveType(task: Task): 'core' | 'adhoc' | 'sin' {
  if (task.taskType === 'core') return 'core';
  if (task.taskType === 'adhoc') return 'adhoc';
  return 'sin';
}

const MINS_CAPACITY_DAY = 480;
const TURQUESA = '#14B8A6';
const ROSA = '#EC4899';

type GroupMode = 'bloque' | 'tipo' | 'bloque-tipo' | 'tipo-bloque';

const GROUP_OPTIONS: { id: GroupMode; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'bloque',      label: 'Bloque',        desc: 'Agrupar por bloque de trabajo',     icon: <LayoutGrid size={13} /> },
  { id: 'tipo',        label: 'Tipo',          desc: 'Agrupar por Core / Adhoc',          icon: <Tag size={13} /> },
  { id: 'bloque-tipo', label: 'Bloque → Tipo', desc: 'Bloque, luego Core / Adhoc dentro', icon: <><LayoutGrid size={11} /><ChevronRight size={9} /><Tag size={11} /></> },
  { id: 'tipo-bloque', label: 'Tipo → Bloque', desc: 'Core / Adhoc, luego bloque dentro', icon: <><Tag size={11} /><ChevronRight size={9} /><LayoutGrid size={11} /></> },
];

function GroupDropdown({ value, onChange }: { value: GroupMode; onChange: (v: GroupMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = GROUP_OPTIONS.find(o => o.id === value)!;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50 hover:text-turquesa dark:bg-bg-card bg-white`}
      >
        <span className="flex items-center gap-0.5">{current.icon}</span>
        <span>{current.label}</span>
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-2xl shadow-xl overflow-hidden min-w-[200px]">
          {GROUP_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all hover:dark:bg-white/5 hover:bg-black/5 ${value === opt.id ? 'dark:bg-turquesa/10 bg-turquesa/5' : ''}`}
            >
              <span className={`flex items-center gap-0.5 shrink-0 ${value === opt.id ? 'text-turquesa' : 'dark:text-text-secondary text-text-secondary-light'}`}>
                {opt.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-black uppercase tracking-widest ${value === opt.id ? 'text-turquesa' : 'dark:text-white text-text-main-light'}`}>
                  {opt.label}
                </p>
                <p className="text-[9px] dark:text-text-secondary text-text-secondary-light mt-0.5">{opt.desc}</p>
              </div>
              {value === opt.id && <Check size={11} className="text-turquesa shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── WeekView ─────────────────────────────────────────────────────────────────
export function WeekView({
  allTasksMap, blocks, timeEntries = [],
  onEditTask, onToggle, onAddTask, onNavigateToDashboard,
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

  const [weekStart, setWeekStart] = useState(() => formatLocalISO(getMondayOfWeek(new Date())));
  const [showWeekend, setShowWeekend] = useState(false);
  const [jumpDate, setJumpDate] = useState('');
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [showCarga, setShowCarga] = useState(false); // Toggle modo carga
  const [groupMode, setGroupMode] = useState<GroupMode>('bloque');

  const days = useMemo(() => {
    const count = showWeekend ? 7 : 5;
    return Array.from({ length: count }, (_, i) => addDays(weekStart, i));
  }, [weekStart, showWeekend]);

  const weekLabel = useMemo(() => {
    const s = parseLocalISO(days[0]);
    const e = parseLocalISO(days[days.length - 1]);
    const m = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${s.getDate()} ${m[s.getMonth()]} – ${e.getDate()} ${m[e.getMonth()]} ${e.getFullYear()}`;
  }, [days]);

  const activeBlockIds = useMemo(() => new Set(blocks.filter(b => b.isActive).map(b => b.id)), [blocks]);
  const activeBlocks = useMemo(() => blocks.filter(b => b.isActive), [blocks]);

  const tasksByDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    days.forEach(date => {
      if (date >= generatedStart && date <= generatedEnd) {
        const all = filterTasksForDay(Object.values(allTasksMap), allTasksMap, activeBlockIds, date, { hideCompleted: false, hideDelegatedNoTag: false });
        map[date] = all.filter(t => !t.parentTaskId);
      } else {
        const virtual = generateVirtualInstances(allTasksMap, date);
        const manual = Object.values(allTasksMap).filter(t => !t.isTemplate && !t.templateId && t.dueDate === date && !t.isDeleted && !t.parentTaskId);
        map[date] = [...manual, ...virtual.filter(t => !t.parentTaskId)];
      }
    });
    return map;
  }, [days, allTasksMap, activeBlockIds, generatedStart, generatedEnd]);

  // Stats por día: estimado (futuro) y registrado (pasado)
  const statsByDay = useMemo(() => {
    const map: Record<string, { estimatedMins: number; registeredMins: number; pct: number }> = {};
    days.forEach(date => {
      const tasks = tasksByDay[date] || [];
      const estimatedMins = tasks.reduce((acc, t) => acc + getTaskMins(t), 0);
      const registeredMins = timeEntries
        .filter(e => e.date === date)
        .reduce((acc, e) => acc + (e.duration || 0), 0);
      const pct = Math.round((estimatedMins / MINS_CAPACITY_DAY) * 100);
      map[date] = { estimatedMins, registeredMins, pct };
    });
    return map;
  }, [days, tasksByDay, timeEntries, allTasksMap]);

  const toggleBlock = (date: string, blockId: string) => {
    const key = `${date}__${blockId}`;
    setExpandedBlocks(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  const isOutsideWindow = days.some(d => d < generatedStart || d > generatedEnd);

  // ─── Helpers de renderizado ───────────────────────────────────────────────────

  const renderCargaBar = (coreMins: number, adhocMins: number, totalMins: number) => (
    <div className="flex items-center gap-2 px-2 pb-1.5">
      {coreMins > 0 && (
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: TURQUESA }} />
          <span className="text-[9px] font-bold" style={{ color: TURQUESA }}>{formatMinutes(coreMins)}</span>
        </div>
      )}
      {adhocMins > 0 && (
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ROSA }} />
          <span className="text-[9px] font-bold" style={{ color: ROSA }}>{formatMinutes(adhocMins)}</span>
        </div>
      )}
      {totalMins > 0 && (
        <div className="flex-1 h-1 dark:bg-white/10 bg-black/8 rounded-full overflow-hidden flex">
          <div className="h-full" style={{ width: `${Math.round((coreMins / totalMins) * 100)}%`, backgroundColor: TURQUESA }} />
          <div className="h-full" style={{ width: `${Math.round((adhocMins / totalMins) * 100)}%`, backgroundColor: ROSA }} />
        </div>
      )}
    </div>
  );

  const renderBlockGroup = (date: string, block: WorkBlock, dayTasks: Task[]) => {
    const blockTasks = dayTasks.filter(t => t.blockId === block.id && !t.isDeleted);
    if (blockTasks.length === 0) return null;
    const key = `${date}__${block.id}`;
    const isExpanded = expandedBlocks.has(key);
    const pendingCount = blockTasks.filter(t => t.status !== 'completed').length;
    const blockMins = blockTasks.reduce((acc, t) => acc + getTaskMins(t), 0);
    const coreMins = blockTasks.filter(t => getEffectiveType(t) === 'core').reduce((acc, t) => acc + getTaskMins(t), 0);
    const adhocMins = blockTasks.filter(t => getEffectiveType(t) === 'adhoc').reduce((acc, t) => acc + getTaskMins(t), 0);
    return (
      <div key={block.id} className="rounded-xl overflow-hidden">
        <button onClick={() => toggleBlock(date, block.id)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:dark:bg-white/5 hover:bg-black/5 transition-all rounded-xl">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
          <span className="text-[10px] font-black dark:text-white text-text-main-light truncate flex-1 text-left uppercase tracking-wide">{block.icon} {block.name}</span>
          <span className="text-[9px] dark:text-text-secondary text-text-secondary-light shrink-0">{pendingCount}/{blockTasks.length}</span>
          {blockMins > 0 && <span className="text-[9px] font-black shrink-0 dark:text-text-secondary text-text-secondary-light">{formatMinutes(blockMins)}</span>}
          {isExpanded ? <ChevronUp size={10} className="shrink-0 opacity-40" /> : <ChevronDown size={10} className="shrink-0 opacity-40" />}
        </button>
        {showCarga && (coreMins > 0 || adhocMins > 0) && renderCargaBar(coreMins, adhocMins, blockMins)}
        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="space-y-0.5 pb-1 px-1">
                {blockTasks.map(task => (
                  <WeekTaskCard key={task.id} task={task} allTasksMap={allTasksMap}
                    onEdit={() => onEditTask(task.id)} onToggle={() => onToggle(task.id)} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderTipoGroups = (date: string, dayTasks: Task[], subMode: 'con-bloques' | null) => {
    const tipos: { id: 'core' | 'adhoc' | 'sin', label: string, color: string }[] = [
      { id: 'core',  label: '⬡ Core',     color: TURQUESA },
      { id: 'adhoc', label: '◇ Adhoc',    color: ROSA },
      { id: 'sin',   label: '— Sin tipo', color: '#6B7280' },
    ];
    return tipos.map(tipo => {
      const tipoTasks = dayTasks.filter(t => !t.isDeleted && getEffectiveType(t) === tipo.id);
      if (tipoTasks.length === 0) return null;
      const key = `${date}__tipo__${tipo.id}`;
      const isExpanded = expandedBlocks.has(key);
      const tipoMins = tipoTasks.reduce((acc, t) => acc + getTaskMins(t), 0);
      const pendingCount = tipoTasks.filter(t => t.status !== 'completed').length;
      return (
        <div key={tipo.id} className="rounded-xl overflow-hidden">
          <button onClick={() => toggleBlock(date, `tipo__${tipo.id}`)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:dark:bg-white/5 hover:bg-black/5 transition-all rounded-xl">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tipo.color }} />
            <span className="text-[10px] font-black truncate flex-1 text-left uppercase tracking-wide" style={{ color: tipo.color }}>{tipo.label}</span>
            <span className="text-[9px] dark:text-text-secondary text-text-secondary-light shrink-0">{pendingCount}/{tipoTasks.length}</span>
            {tipoMins > 0 && <span className="text-[9px] font-black shrink-0 dark:text-text-secondary text-text-secondary-light">{formatMinutes(tipoMins)}</span>}
            {isExpanded ? <ChevronUp size={10} className="shrink-0 opacity-40" /> : <ChevronDown size={10} className="shrink-0 opacity-40" />}
          </button>
          <AnimatePresence>
            {isExpanded && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="space-y-0.5 pb-1 px-1">
                  {subMode === 'con-bloques'
                    ? activeBlocks.map(block => {
                        const bTasks = tipoTasks.filter(t => t.blockId === block.id);
                        if (bTasks.length === 0) return null;
                        const bMins = bTasks.reduce((acc, t) => acc + getTaskMins(t), 0);
                        const bPending = bTasks.filter(t => t.status !== 'completed').length;
                        const bKey = `${date}__tipo__${tipo.id}__bloque__${block.id}`;
                        const isBExpanded = expandedBlocks.has(bKey);
                        return (
                          <div key={block.id}>
                            <button onClick={() => toggleBlock(date, `tipo__${tipo.id}__bloque__${block.id}`)}
                              className="w-full flex items-center gap-1 px-1 py-1 rounded-lg hover:dark:bg-white/5 hover:bg-black/5 transition-all">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0 inline-block" style={{ backgroundColor: block.color }} />
                              <span className="text-[8px] font-black uppercase tracking-widest dark:text-white/60 text-text-main-light/60 flex-1 text-left">{block.icon} {block.name}</span>
                              <span className="text-[8px] dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0">{bPending}/{bTasks.length}</span>
                              {bMins > 0 && <span className="text-[8px] font-black dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0 ml-1">{formatMinutes(bMins)}</span>}
                              {isBExpanded ? <ChevronUp size={8} className="shrink-0 opacity-30 ml-0.5" /> : <ChevronDown size={8} className="shrink-0 opacity-30 ml-0.5" />}
                            </button>
                            <AnimatePresence>
                              {isBExpanded && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                  {bTasks.map(task => (
                                    <WeekTaskCard key={task.id} task={task} allTasksMap={allTasksMap}
                                      onEdit={() => onEditTask(task.id)} onToggle={() => onToggle(task.id)} />
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })
                    : tipoTasks.map(task => (
                        <WeekTaskCard key={task.id} task={task} allTasksMap={allTasksMap}
                          onEdit={() => onEditTask(task.id)} onToggle={() => onToggle(task.id)} />
                      ))
                  }
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="space-y-4 pb-32 max-w-full">

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-3xl font-black dark:text-white text-text-main-light">Semana</h2>
          <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Dropdown agrupación */}
          <GroupDropdown value={groupMode} onChange={setGroupMode} />
          {/* Toggle Carga */}
          <button onClick={() => setShowCarga(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
              showCarga ? 'bg-morado text-white border-morado shadow-md shadow-morado/20' : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-morado/50'
            }`}>
            <Layers size={12} /> Carga
          </button>
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
            onChange={e => { setJumpDate(e.target.value); if (e.target.value) setWeekStart(formatLocalISO(getMondayOfWeek(parseLocalISO(e.target.value)))); }}
            className="h-8 px-3 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl text-[11px] font-bold dark:text-white text-text-main-light outline-none focus:border-turquesa/50 transition-all"
          />
        </div>
      </div>

      {isOutsideWindow && (
        <div className="flex items-center gap-2 px-4 py-2.5 dark:bg-azul/10 bg-azul/5 border dark:border-azul/20 border-azul/20 rounded-2xl">
          <RefreshCw size={13} className="text-azul shrink-0" />
          <p className="text-[11px] dark:text-text-secondary text-text-secondary-light">
            Semana fuera de la ventana generada — recurrentes calculadas desde plantillas.
          </p>
        </div>
      )}

      {/* ── GRID ── */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map(date => {
          const { estimatedMins, registeredMins, pct } = statsByDay[date] || { estimatedMins: 0, registeredMins: 0, pct: 0 };
          const isPast = date < today;
          const isToday = date === today;
          const label = formatDayLabel(date);
          const dayTasks = tasksByDay[date] || [];
          const d = parseLocalISO(date);
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          // Para días pasados: mostrar registrado; para hoy/futuro: estimado
          const displayMins = isPast ? registeredMins : estimatedMins;
          const displayPct = isPast
            ? Math.round((registeredMins / MINS_CAPACITY_DAY) * 100)
            : pct;

          return (
            <div key={date} className={`flex flex-col rounded-2xl border overflow-hidden transition-all ${
              isToday ? 'dark:border-turquesa/50 border-turquesa/40 dark:bg-turquesa/5 bg-turquesa/3'
              : isWeekend ? 'dark:border-border-main/30 border-border-main-light/30 dark:bg-white/[0.01] bg-gray-50/50'
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
                    <span className="text-[10px] dark:text-text-secondary/50 text-text-secondary-light/50">{label.month}</span>
                  </div>
                  {displayMins > 0 && (
                    <div className="flex items-center gap-1">
                      {isPast && <Clock size={9} className="text-turquesa" />}
                      <span className={`text-[10px] font-black ${getPctTextClass(displayPct)}`}>
                        {formatMinutes(displayMins)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="w-full h-1.5 dark:bg-white/10 bg-black/8 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, displayPct)}%`, backgroundColor: getPctColor(displayPct) }} />
                </div>
              </button>

              {/* Bloques / agrupación */}
              <div className="flex-1 p-2 pt-0 space-y-1 min-h-[80px]">
                {(() => {
                  if (groupMode === 'bloque') {
                    return activeBlocks.map(block => renderBlockGroup(date, block, dayTasks));
                  }
                  if (groupMode === 'tipo') {
                    return renderTipoGroups(date, dayTasks, null);
                  }
                  if (groupMode === 'bloque-tipo') {
                    return activeBlocks.map(block => {
                      const blockTasks = dayTasks.filter(t => t.blockId === block.id && !t.isDeleted);
                      if (blockTasks.length === 0) return null;
                      const key = `${date}__${block.id}`;
                      const isExpanded = expandedBlocks.has(key);
                      const blockMins = blockTasks.reduce((acc, t) => acc + getTaskMins(t), 0);
                      const pendingCount = blockTasks.filter(t => t.status !== 'completed').length;
                      const coreMins = blockTasks.filter(t => getEffectiveType(t) === 'core').reduce((acc, t) => acc + getTaskMins(t), 0);
                      const adhocMins = blockTasks.filter(t => getEffectiveType(t) === 'adhoc').reduce((acc, t) => acc + getTaskMins(t), 0);
                      return (
                        <div key={block.id} className="rounded-xl overflow-hidden">
                          <button onClick={() => toggleBlock(date, block.id)}
                            className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:dark:bg-white/5 hover:bg-black/5 transition-all rounded-xl">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
                            <span className="text-[10px] font-black dark:text-white text-text-main-light truncate flex-1 text-left uppercase tracking-wide">{block.icon} {block.name}</span>
                            <span className="text-[9px] dark:text-text-secondary text-text-secondary-light shrink-0">{pendingCount}/{blockTasks.length}</span>
                            {blockMins > 0 && <span className="text-[9px] font-black shrink-0 dark:text-text-secondary text-text-secondary-light">{formatMinutes(blockMins)}</span>}
                            {isExpanded ? <ChevronUp size={10} className="shrink-0 opacity-40" /> : <ChevronDown size={10} className="shrink-0 opacity-40" />}
                          </button>
                          {showCarga && (coreMins > 0 || adhocMins > 0) && renderCargaBar(coreMins, adhocMins, blockMins)}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                <div className="space-y-0.5 pb-1 px-1">
                                  {(['core', 'adhoc', 'sin'] as const).map(tipoId => {
                                    const tipoTasks = blockTasks.filter(t => getEffectiveType(t) === tipoId);
                                    if (tipoTasks.length === 0) return null;
                                    const tipoMins = tipoTasks.reduce((acc, t) => acc + getTaskMins(t), 0);
                                    const tipoPending = tipoTasks.filter(t => t.status !== 'completed').length;
                                    const tipoColor = tipoId === 'core' ? TURQUESA : tipoId === 'adhoc' ? ROSA : '#6B7280';
                                    const tipoLabel = tipoId === 'core' ? '⬡ Core' : tipoId === 'adhoc' ? '◇ Adhoc' : '— Sin tipo';
                                    const tipoKey = `${date}__${block.id}__tipo__${tipoId}`;
                                    const isTipoExpanded = expandedBlocks.has(tipoKey);
                                    return (
                                      <div key={tipoId}>
                                        <button onClick={() => toggleBlock(date, `${block.id}__tipo__${tipoId}`)}
                                          className="w-full flex items-center gap-1 px-1 py-1 rounded-lg hover:dark:bg-white/5 hover:bg-black/5 transition-all">
                                          <span className="w-1.5 h-1.5 rounded-full shrink-0 inline-block" style={{ backgroundColor: tipoColor }} />
                                          <span className="text-[8px] font-black uppercase tracking-widest flex-1 text-left" style={{ color: tipoColor }}>{tipoLabel}</span>
                                          <span className="text-[8px] dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0">{tipoPending}/{tipoTasks.length}</span>
                                          {tipoMins > 0 && <span className="text-[8px] font-black dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0 ml-1">{formatMinutes(tipoMins)}</span>}
                                          {isTipoExpanded ? <ChevronUp size={8} className="shrink-0 opacity-30 ml-0.5" /> : <ChevronDown size={8} className="shrink-0 opacity-30 ml-0.5" />}
                                        </button>
                                        <AnimatePresence>
                                          {isTipoExpanded && (
                                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                              {tipoTasks.map(task => (
                                                <WeekTaskCard key={task.id} task={task} allTasksMap={allTasksMap}
                                                  onEdit={() => onEditTask(task.id)} onToggle={() => onToggle(task.id)} />
                                              ))}
                                            </motion.div>
                                          )}
                                        </AnimatePresence>
                                      </div>
                                    );
                                  })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    });
                  }
                  if (groupMode === 'tipo-bloque') {
                    return renderTipoGroups(date, dayTasks, 'con-bloques');
                  }
                  return null;
                })()}

                {dayTasks.length === 0 && (
                  <div className="flex items-center justify-center py-4 opacity-20">
                    <p className="text-[10px] dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Sin tareas</p>
                  </div>
                )}

                <button onClick={() => onAddTask(null, undefined, date)}
                  className="w-full flex items-center justify-center gap-1 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest dark:text-text-secondary/30 text-text-secondary-light/30 hover:dark:text-turquesa hover:text-turquesa hover:dark:bg-turquesa/5 hover:bg-turquesa/5 transition-all border border-dashed dark:border-border-main/20 border-border-main-light/20 hover:border-turquesa/30">
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
function WeekTaskCard({ task, allTasksMap, onEdit, onToggle }: {
  task: Task; allTasksMap: Record<string, Task>;
  onEdit: () => void; onToggle: () => void;
}) {
  const tagEmoji = task.tags?.[0] ? TAG_LABELS[task.tags[0]]?.icon : null;
  const isCompleted = task.status === 'completed';
  const taskMins = getTaskMins(task);

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
      {taskMins > 0 && (
        <span className="text-[9px] dark:text-text-secondary/60 text-text-secondary-light/60 shrink-0 font-bold">
          {formatMinutes(taskMins)}
        </span>
      )}
    </div>
  );
}
