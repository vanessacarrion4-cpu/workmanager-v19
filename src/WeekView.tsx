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
  Plus, Check, RefreshCw, Clock, LayoutGrid, Tag,
  Calendar as CalendarIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Task, WorkBlock, TimeEntry } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { materializeDay } from './instanceEngine';
import { formatMinutes, getTaskEstimatedCombo } from './utils';
import { MonthDatePicker } from './TimeComponents';
import { TAG_LABELS } from './constants';
import { useJornada } from './useJornada';

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

// ─── Minutos de una tarea para un día ────────────────────────────────────────
// Trabaja sobre el mapa YA materializado del día (materializeDay): las subtareas
// presentes son exactamente las que ocurren ese día, así que basta con sumarlas.
// #2 (sesión 26): Semana es vista de PLANIFICACIÓN → mide lo PENDIENTE (lo que queda por delante), no el total con
// completadas. Una hoja/subtarea completada aporta 0.
function getTaskMins(task: Task, dayMap: Record<string, Task>): number {
  // Tarea hoja (sin subtareas): su estimado si está pendiente; 0 si ya está hecha
  if (!task.subtasks || task.subtasks.length === 0) {
    return task.status === 'completed' ? 0 : (task.estimatedMinutes || 0);
  }
  // Contenedor: sumar las subtareas materializadas de este día que sigan PENDIENTES
  return task.subtasks.reduce((acc, subId) => {
    const sub = dayMap[subId];
    if (!sub || sub.isDeleted || sub.status === 'completed') return acc;
    return acc + (sub.estimatedMinutes || 0);
  }, 0);
}

// ─── Conteo de HOJAS hechas/total ────────────────────────────────────────────
// #7 (sesión 26): el X/Y de las cabeceras de grupo (bloque/tipo) contaba `status === 'completed'` sobre la tarea top-level;
// para un CONTENEDOR ese status es el campo muerto (no refleja sus hijas). Aquí contamos HOJAS: la subtarea materializada del
// día (si es contenedor) o la propia tarea (si no tiene subtareas). Misma noción de hoja que getTaskMins.
function leafCounts(tasks: Task[], dayMap: Record<string, Task>): { done: number; total: number } {
  let done = 0, total = 0;
  for (const t of tasks) {
    if (!t.subtasks || t.subtasks.length === 0) {
      total += 1;
      if (t.status === 'completed') done += 1;
    } else {
      for (const subId of t.subtasks) {
        const sub = dayMap[subId];
        if (!sub || sub.isDeleted) continue;
        total += 1;
        if (sub.status === 'completed') done += 1;
      }
    }
  }
  return { done, total };
}

// ─── Tipo efectivo — directo del taskType del contenedor ─────────────────────
// #6 (sesión 26): la sin-tipo NO es categoría propia — se pliega a Core (como Mi Día/Reporte/Carga) hasta que se limpien las
// 1.061 sin tipo. Decisión de la propietaria: no llenar las vistas de "Sin tipo" mientras el dato malo esté sin resolver.
function getEffectiveType(task: Task): 'core' | 'adhoc' {
  return task.taskType === 'adhoc' ? 'adhoc' : 'core';
}

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
  onUpdateTask, onRecurrenceDateChange,
}: {
  allTasksMap: Record<string, Task>;
  blocks: WorkBlock[];
  timeEntries: TimeEntry[];
  onEditTask: (id: string) => void;
  onToggle: (id: string, day?: string) => void;
  onAddTask: (parentId: string | null, blockId?: string, date?: string) => void;
  onNavigateToDashboard: (date: string) => void;
  onUpdateTask: (task: Task) => void;
  onRecurrenceDateChange: (task: Task, newDate: string) => void;
}) {
  const today = formatLocalISO(new Date());
  const jornada = useJornada(); // #2: % de carga contra la jornada real, no 480 fijos

  const [weekStart, setWeekStart] = useState(() => formatLocalISO(getMondayOfWeek(new Date())));
  const [showWeekend, setShowWeekend] = useState(false);
  const [jumpDate, setJumpDate] = useState('');
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
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

  // Motor V20: cada día se materializa al vuelo (sin depender de instancias
  // pre-generadas). dayData guarda, por fecha, las raíces a mostrar y el mapa
  // {id: task} de ese día para que getTaskMins y WeekTaskCard lean de ahí.
  const dayData = useMemo(() => {
    const result: Record<string, { roots: Task[]; map: Record<string, Task> }> = {};
    days.forEach(date => {
      const instances = materializeDay(date, allTasksMap);
      // Tareas manuales de nivel superior (puntuales de ese día, no plantillas)
      const manual = Object.values(allTasksMap).filter(t =>
        t && !t.isTemplate && !t.templateId && !t.parentTaskId && t.dueDate === date && !t.isDeleted
      );
      const all = [...instances, ...manual];
      const map: Record<string, Task> = {};
      all.forEach(t => { map[t.id] = t; });
      const roots = all.filter(t => !t.parentTaskId && activeBlockIds.has(t.blockId));
      result[date] = { roots, map };
    });
    return result;
  }, [days, allTasksMap, activeBlockIds]);

  const tasksByDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    days.forEach(date => { map[date] = dayData[date]?.roots ?? []; });
    return map;
  }, [days, dayData]);

  // Stats por día: estimado (futuro) y registrado (pasado)
  const statsByDay = useMemo(() => {
    const map: Record<string, { estimatedMins: number; registeredMins: number; pct: number }> = {};
    days.forEach(date => {
      const tasks = tasksByDay[date] || [];
      const dayMap = dayData[date]?.map ?? {};
      const estimatedMins = tasks.reduce((acc, t) => acc + getTaskMins(t, dayMap), 0);
      const registeredMins = timeEntries
        .filter(e => e.date === date)
        .reduce((acc, e) => acc + (e.duration || 0), 0);
      const pct = Math.round((estimatedMins / (jornada || 480)) * 100);
      map[date] = { estimatedMins, registeredMins, pct };
    });
    return map;
  }, [days, tasksByDay, timeEntries, dayData, jornada]);

  // #barrido: total de la SEMANA junto al título = suma de lo que muestra cada día (registrado los pasados, estimado los
  // futuros) sobre la capacidad jornada × nº de días mostrados (L-V=5 / L-D=7). Si pasa de la capacidad, se resalta.
  const weekSummary = useMemo(() => {
    let mins = 0;
    days.forEach(date => {
      const s = statsByDay[date] || { estimatedMins: 0, registeredMins: 0 };
      mins += date < today ? s.registeredMins : s.estimatedMins;
    });
    const capacity = (jornada || 480) * days.length;
    return { mins, capacity, over: mins > capacity };
  }, [days, statsByDay, today, jornada]);

  const toggleBlock = (date: string, blockId: string) => {
    const key = `${date}__${blockId}`;
    setExpandedBlocks(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  // ─── Helpers de renderizado ───────────────────────────────────────────────────

  const renderBlockGroup = (date: string, block: WorkBlock, dayTasks: Task[]) => {
    const blockTasks = dayTasks.filter(t => t.blockId === block.id && !t.isDeleted);
    if (blockTasks.length === 0) return null;
    const dayMap = dayData[date]?.map ?? {};
    const key = `${date}__${block.id}`;
    const isExpanded = expandedBlocks.has(key);
    const { done: hechasCount, total: hojasTotal } = leafCounts(blockTasks, dayMap); // #7: hojas, no status del contenedor
    const blockMins = blockTasks.reduce((acc, t) => acc + getTaskMins(t, dayMap), 0);
    return (
      <div key={block.id} className="rounded-xl overflow-hidden">
        <button onClick={() => toggleBlock(date, block.id)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:dark:bg-white/5 hover:bg-black/5 transition-all rounded-xl">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
          <span className="text-[10px] font-black dark:text-white text-text-main-light truncate flex-1 text-left uppercase tracking-wide">{block.icon} {block.name}</span>
          <span className="text-[9px] dark:text-text-secondary text-text-secondary-light shrink-0">{hechasCount}/{hojasTotal}</span>
          {blockMins > 0 && <span className="text-[9px] font-black shrink-0 dark:text-text-secondary text-text-secondary-light">{formatMinutes(blockMins)}</span>}
          {isExpanded ? <ChevronUp size={10} className="shrink-0 opacity-40" /> : <ChevronDown size={10} className="shrink-0 opacity-40" />}
        </button>
        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="space-y-0.5 pb-1 px-1">
                {blockTasks.map(task => (
                  <WeekTaskCard key={task.id} task={task} dayMap={dayMap}
                    onEdit={() => onEditTask(task.id)} onToggle={() => onToggle(task.id, date)} onToggleId={onToggle} date={date} onEditTask={onEditTask}
                    onUpdateTask={onUpdateTask} onRecurrenceDateChange={onRecurrenceDateChange} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderTipoGroups = (date: string, dayTasks: Task[], subMode: 'con-bloques' | null) => {
    const dayMap = dayData[date]?.map ?? {};
    const tipos: { id: 'core' | 'adhoc', label: string, color: string }[] = [
      { id: 'core',  label: '⬡ Core',     color: TURQUESA },
      { id: 'adhoc', label: '◇ Adhoc',    color: ROSA },
    ];
    return tipos.map(tipo => {
      const tipoTasks = dayTasks.filter(t => !t.isDeleted && getEffectiveType(t) === tipo.id);
      if (tipoTasks.length === 0) return null;
      const key = `${date}__tipo__${tipo.id}`;
      const isExpanded = expandedBlocks.has(key);
      const tipoMins = tipoTasks.reduce((acc, t) => acc + getTaskMins(t, dayMap), 0);
      const { done: hechasCount, total: hojasTotal } = leafCounts(tipoTasks, dayMap); // #7: hojas
      return (
        <div key={tipo.id} className="rounded-xl overflow-hidden">
          <button onClick={() => toggleBlock(date, `tipo__${tipo.id}`)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:dark:bg-white/5 hover:bg-black/5 transition-all rounded-xl">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tipo.color }} />
            <span className="text-[10px] font-black truncate flex-1 text-left uppercase tracking-wide" style={{ color: tipo.color }}>{tipo.label}</span>
            <span className="text-[9px] dark:text-text-secondary text-text-secondary-light shrink-0">{hechasCount}/{hojasTotal}</span>
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
                        const bMins = bTasks.reduce((acc, t) => acc + getTaskMins(t, dayMap), 0);
                        const { done: bHechas, total: bTotal } = leafCounts(bTasks, dayMap); // #7: hojas
                        const bKey = `${date}__tipo__${tipo.id}__bloque__${block.id}`;
                        const isBExpanded = expandedBlocks.has(bKey);
                        return (
                          <div key={block.id}>
                            <button onClick={() => toggleBlock(date, `tipo__${tipo.id}__bloque__${block.id}`)}
                              className="w-full flex items-center gap-1 px-1 py-1 rounded-lg hover:dark:bg-white/5 hover:bg-black/5 transition-all">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0 inline-block" style={{ backgroundColor: block.color }} />
                              <span className="text-[8px] font-black uppercase tracking-widest dark:text-white/60 text-text-main-light/60 flex-1 text-left">{block.icon} {block.name}</span>
                              <span className="text-[8px] dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0">{bHechas}/{bTotal}</span>
                              {bMins > 0 && <span className="text-[8px] font-black dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0 ml-1">{formatMinutes(bMins)}</span>}
                              {isBExpanded ? <ChevronUp size={8} className="shrink-0 opacity-30 ml-0.5" /> : <ChevronDown size={8} className="shrink-0 opacity-30 ml-0.5" />}
                            </button>
                            <AnimatePresence>
                              {isBExpanded && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                  {bTasks.map(task => (
                                    <WeekTaskCard key={task.id} task={task} dayMap={dayMap}
                                      onEdit={() => onEditTask(task.id)} onToggle={() => onToggle(task.id, date)} onToggleId={onToggle} date={date} onEditTask={onEditTask}
                    onUpdateTask={onUpdateTask} onRecurrenceDateChange={onRecurrenceDateChange} />
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })
                    : tipoTasks.map(task => (
                        <WeekTaskCard key={task.id} task={task} dayMap={dayMap}
                          onEdit={() => onEditTask(task.id)} onToggle={() => onToggle(task.id, date)} onToggleId={onToggle} date={date} onEditTask={onEditTask}
                    onUpdateTask={onUpdateTask} onRecurrenceDateChange={onRecurrenceDateChange} />
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
          <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-0.5">
            {weekLabel}
            <span className="mx-1.5 opacity-40">·</span>
            <span className={`font-black ${weekSummary.over ? 'text-rosa' : 'dark:text-white text-text-main-light'}`}>
              {formatMinutes(weekSummary.mins)}
            </span>
            <span className="opacity-60"> de {formatMinutes(weekSummary.capacity)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Dropdown agrupación */}
          <GroupDropdown value={groupMode} onChange={setGroupMode} />
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
            ? Math.round((registeredMins / (jornada || 480)) * 100)
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
                      const dayMap = dayData[date]?.map ?? {};
                      const key = `${date}__${block.id}`;
                      const isExpanded = expandedBlocks.has(key);
                      const blockMins = blockTasks.reduce((acc, t) => acc + getTaskMins(t, dayMap), 0);
                      const { done: hechasCount, total: hojasTotal } = leafCounts(blockTasks, dayMap); // #7: hojas
                      return (
                        <div key={block.id} className="rounded-xl overflow-hidden">
                          <button onClick={() => toggleBlock(date, block.id)}
                            className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:dark:bg-white/5 hover:bg-black/5 transition-all rounded-xl">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
                            <span className="text-[10px] font-black dark:text-white text-text-main-light truncate flex-1 text-left uppercase tracking-wide">{block.icon} {block.name}</span>
                            <span className="text-[9px] dark:text-text-secondary text-text-secondary-light shrink-0">{hechasCount}/{hojasTotal}</span>
                            {blockMins > 0 && <span className="text-[9px] font-black shrink-0 dark:text-text-secondary text-text-secondary-light">{formatMinutes(blockMins)}</span>}
                            {isExpanded ? <ChevronUp size={10} className="shrink-0 opacity-40" /> : <ChevronDown size={10} className="shrink-0 opacity-40" />}
                          </button>
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                <div className="space-y-0.5 pb-1 px-1">
                                  {(['core', 'adhoc'] as const).map(tipoId => {
                                    const tipoTasks = blockTasks.filter(t => getEffectiveType(t) === tipoId);
                                    if (tipoTasks.length === 0) return null;
                                    const tipoMins = tipoTasks.reduce((acc, t) => acc + getTaskMins(t, dayMap), 0);
                                    const { done: tipoHechas, total: tipoTotal } = leafCounts(tipoTasks, dayMap); // #7: hojas
                                    const tipoColor = tipoId === 'core' ? TURQUESA : ROSA;
                                    const tipoLabel = tipoId === 'core' ? '⬡ Core' : '◇ Adhoc';
                                    const tipoKey = `${date}__${block.id}__tipo__${tipoId}`;
                                    const isTipoExpanded = expandedBlocks.has(tipoKey);
                                    return (
                                      <div key={tipoId}>
                                        <button onClick={() => toggleBlock(date, `${block.id}__tipo__${tipoId}`)}
                                          className="w-full flex items-center gap-1 px-1 py-1 rounded-lg hover:dark:bg-white/5 hover:bg-black/5 transition-all">
                                          <span className="w-1.5 h-1.5 rounded-full shrink-0 inline-block" style={{ backgroundColor: tipoColor }} />
                                          <span className="text-[8px] font-black uppercase tracking-widest flex-1 text-left" style={{ color: tipoColor }}>{tipoLabel}</span>
                                          <span className="text-[8px] dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0">{tipoHechas}/{tipoTotal}</span>
                                          {tipoMins > 0 && <span className="text-[8px] font-black dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0 ml-1">{formatMinutes(tipoMins)}</span>}
                                          {isTipoExpanded ? <ChevronUp size={8} className="shrink-0 opacity-30 ml-0.5" /> : <ChevronDown size={8} className="shrink-0 opacity-30 ml-0.5" />}
                                        </button>
                                        <AnimatePresence>
                                          {isTipoExpanded && (
                                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                              {tipoTasks.map(task => (
                                                <WeekTaskCard key={task.id} task={task} dayMap={dayMap}
                                                  onEdit={() => onEditTask(task.id)} onToggle={() => onToggle(task.id, date)} onToggleId={onToggle} date={date} onEditTask={onEditTask}
                    onUpdateTask={onUpdateTask} onRecurrenceDateChange={onRecurrenceDateChange} />
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
function WeekTaskCard({ task, dayMap, onEdit, onToggle, onToggleId, date, onEditTask, onUpdateTask, onRecurrenceDateChange }: {
  task: Task; dayMap: Record<string, Task>;
  onEdit: () => void; onToggle: () => void; onToggleId?: (id: string, day: string) => void; date: string;
  onEditTask?: (id: string) => void;
  onUpdateTask: (task: Task) => void;
  onRecurrenceDateChange: (task: Task, newDate: string) => void;
}) {
  const tagEmoji = task.tags?.[0] ? TAG_LABELS[task.tags[0]]?.icon : null;
  const isCompleted = task.status === 'completed';
  const taskMins = getTaskMins(task, dayMap);

  // Mover a otro día. Recurrente → pregunta (modal "este día / serie") reusando el
  // mismo camino de App (onRecurrenceDateChange). Normal → mueve directo.
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [showMoveCalendar, setShowMoveCalendar] = useState(false);
  const handleMoveTask = (newDate: string | null) => {
    if (!newDate || newDate === date) { setShowMovePicker(false); setShowMoveCalendar(false); return; }
    if (task.templateId) {
      onRecurrenceDateChange(task, newDate);
    } else {
      onUpdateTask({ ...task, dueDate: newDate, modifiedAt: new Date().toISOString() });
    }
    setShowMovePicker(false);
    setShowMoveCalendar(false);
  };

  // Contenedor: mostrar subtareas del día al expandir. Las subtareas del mapa
  // materializado son exactamente las que ocurren este día.
  const [expanded, setExpanded] = useState(false);
  const isContainer = !!(task.subtasks && task.subtasks.length > 0);
  const subTasksForDay = isContainer
    ? (task.subtasks || [])
        .map(id => dayMap[id])
        .filter((s): s is Task => !!s && !s.isDeleted)
    : [];

  return (
    <div className={isCompleted ? 'opacity-40' : ''}>
      <div
        onClick={isContainer ? () => setExpanded(v => !v) : onEdit}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all cursor-pointer hover:dark:bg-white/5 hover:bg-black/5"
      >
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
        {/* Mover a otro día */}
        <div className="relative shrink-0">
          <button
            onClick={e => { e.stopPropagation(); setShowMovePicker(v => !v); setShowMoveCalendar(false); }}
            className="w-5 h-5 flex items-center justify-center text-azul/70 hover:text-azul rounded transition-all"
            title="Mover a otro día"
          >
            <CalendarIcon size={11} />
          </button>
          <AnimatePresence>
            {showMovePicker && (
              <>
                <div className="fixed inset-0 z-[210]" onClick={e => { e.stopPropagation(); setShowMovePicker(false); setShowMoveCalendar(false); }} />
                <motion.div
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                  onClick={e => e.stopPropagation()}
                  className="fixed bottom-4 right-4 z-[220] dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 w-[220px]"
                >
                  {!showMoveCalendar ? (
                    <div className="space-y-2">
                      {task.templateId && (
                        <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest text-center pb-1 border-b dark:border-border-main/50 border-border-main-light/50">
                          Recurrente · preguntará
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={e => { e.stopPropagation(); handleMoveTask(formatLocalISO(new Date())); }}
                          className="flex flex-col items-center gap-1 p-3 dark:bg-bg-main bg-bg-secondary-light rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                        >
                          <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Hoy</span>
                          <span className="text-[8px] dark:text-text-secondary text-text-secondary-light">{new Date().getDate()}</span>
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); const m = new Date(); m.setDate(m.getDate() + 1); handleMoveTask(formatLocalISO(m)); }}
                          className="flex flex-col items-center gap-1 p-3 dark:bg-bg-main bg-bg-secondary-light rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                        >
                          <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Mañana</span>
                          <span className="text-[8px] dark:text-text-secondary text-text-secondary-light">{(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getDate(); })()}</span>
                        </button>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setShowMoveCalendar(true); }}
                        className="w-full flex items-center justify-between p-3 dark:bg-bg-main bg-bg-secondary-light rounded-xl border dark:border-border-main border-border-main-light hover:border-azul transition-all group"
                      >
                        <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-azul">Elegir fecha</span>
                        <CalendarIcon size={14} className="dark:text-text-secondary text-text-secondary-light group-hover:text-azul" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between px-1">
                        <button
                          onClick={e => { e.stopPropagation(); setShowMoveCalendar(false); }}
                          className="text-[10px] font-black text-turquesa uppercase tracking-widest hover:underline flex items-center gap-1"
                        >
                          <ChevronLeft size={12} /> Volver
                        </button>
                        <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Mensual</span>
                      </div>
                      <MonthDatePicker
                        value={task.dueDate || date}
                        onChange={(d) => { handleMoveTask(d); }}
                      />
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
        {isContainer && (
          <span className="text-[9px] dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0">
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </span>
        )}
        {taskMins > 0 && (
          <span className="text-[9px] dark:text-text-secondary/60 text-text-secondary-light/60 shrink-0 font-bold">
            {formatMinutes(taskMins)}
          </span>
        )}
      </div>
      {/* Subtareas del día — visibles al expandir contenedor */}
      {isContainer && expanded && subTasksForDay.length > 0 && (
        <div className="ml-4 border-l dark:border-border-main/30 border-border-main-light/30 pl-2 space-y-0.5">
          {subTasksForDay.map(sub => (
            <div
              key={sub.id}
              onClick={(e) => { e.stopPropagation(); onEditTask ? onEditTask(sub.id) : onEdit(); }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer hover:dark:bg-white/5 hover:bg-black/5 transition-all ${sub.status === 'completed' ? 'opacity-40' : ''}`}
            >
              {/* Completar la subtarea DESDE Semana (antes era un div decorativo → no se podía, sí en Mi Día). */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleId?.(sub.id, date); }}
                title={sub.status === 'completed' ? 'Marcar pendiente' : 'Completar'}
                className={`w-3 h-3 rounded flex items-center justify-center shrink-0 border-2 transition-all ${
                  sub.status === 'completed' ? 'bg-turquesa border-turquesa text-white' : 'dark:border-border-main border-border-main-light hover:border-turquesa'
                }`}>
                {sub.status === 'completed' && <Check size={7} strokeWidth={3} />}
              </button>
              <span className={`text-[10px] font-bold dark:text-white/80 text-text-main-light truncate flex-1 ${sub.status === 'completed' ? 'line-through' : ''}`}>
                {sub.title}
              </span>
              {sub.estimatedMinutes > 0 && (
                <span className="text-[9px] dark:text-text-secondary/50 text-text-secondary-light/50 shrink-0">
                  {formatMinutes(sub.estimatedMinutes)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {isContainer && expanded && subTasksForDay.length === 0 && (
        <div className="ml-4 pl-2 py-1">
          <span className="text-[9px] dark:text-text-secondary/40 text-text-secondary-light/40 italic">Sin subtareas para este día</span>
        </div>
      )}
    </div>
  );
}
