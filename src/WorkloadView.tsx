/**
 * WorkloadView.tsx - Vista de carga de trabajo estilo ClickUp
 *
 * LAYOUT: filas = tareas, columnas = meses → expandible a semanas → días
 * CAPACIDAD: 8h/día, 40h/semana (solo días laborables)
 * COLORES: verde <60%, naranja 60-80%, morado 80-100%, rosa >100%
 *
 * TRES TRAMOS TEMPORALES:
 * ─ Pasado    → time_entries reales
 * ─ Presente  → instancias en memoria (12 meses)
 * ─ Futuro+12 → cálculo matemático desde templates
 */

import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Layers, Tag, X } from 'lucide-react';
import { Task, WorkBlock, TimeEntry } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { formatMinutes } from './utils';

// ─── Capacidad ────────────────────────────────────────────────────────────────

const HOURS_PER_DAY = 8;
const MINS_PER_DAY = HOURS_PER_DAY * 60;   // 480
const MINS_PER_WEEK = MINS_PER_DAY * 5;    // 2400

function workdaysInMonth(year: number, month: number): number {
  let count = 0;
  const days = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function workdaysInWeek(startDate: string, endDate: string): number {
  let count = 0;
  let current = startDate;
  while (current <= endDate) {
    const dow = parseLocalISO(current).getDay();
    if (dow !== 0 && dow !== 6) count++;
    current = addDays(current, 1);
  }
  return count;
}

// ─── Colores por % de capacidad ──────────────────────────────────────────────

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

// ─── Tipos ────────────────────────────────────────────────────────────────────

type GroupMode = 'block' | 'type';
type ColLevel = 'month' | 'week' | 'day';

interface MonthInfo {
  key: string;       // 'YYYY-MM'
  label: string;     // 'May 2026'
  year: number;
  month: number;
  weeks: WeekInfo[];
  capacityMins: number;
}

interface WeekInfo {
  key: string;
  label: string;    // 'W20'
  startDate: string;
  endDate: string;
  capacityMins: number;
  isPast: boolean;
  isGenerated: boolean;
}

interface DayInfo {
  date: string;
  label: string;  // 'L 12'
  isWorkday: boolean;
  isToday: boolean;
  capacityMins: number;
}

interface TaskLoad {
  taskId: string;
  title: string;
  blockId: string;
  taskType: string;
  isContainer: boolean;
  parentId?: string;
  // minutos por clave (monthKey, weekKey, date)
  monthMinutes: Record<string, number>;
  weekMinutes: Record<string, number>;
  dayMinutes: Record<string, number>;
}

interface GroupNode {
  key: string;
  label: string;
  color?: string;
  monthMinutes: Record<string, number>;
  weekMinutes: Record<string, number>;
  dayMinutes: Record<string, number>;
  children: GroupNode[];
  isLeaf: boolean;
}

// ─── Helpers fecha ────────────────────────────────────────────────────────────

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekKey(date: Date): string {
  const monday = getMondayOfWeek(date);
  const year = monday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const weekNum = Math.ceil(((monday.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

function getISOWeekNum(monday: Date): number {
  const jan4 = new Date(monday.getFullYear(), 0, 4);
  const startW1 = getMondayOfWeek(jan4);
  return Math.round((monday.getTime() - startW1.getTime()) / (7 * 86400000)) + 1;
}

function addDays(dateStr: string, days: number): string {
  const d = parseLocalISO(dateStr);
  d.setDate(d.getDate() + days);
  return formatLocalISO(d);
}

function getMonthLabel(year: number, month: number): string {
  return ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][month] + ' ' + year;
}

const DAY_LABELS = ['D','L','M','X','J','V','S'];

// ─── Construir estructura de columnas (7 meses) ───────────────────────────────

function buildMonths(baseYear: number, baseMonth: number, numMonths: number, today: string, generatedEndStr: string): MonthInfo[] {
  const months: MonthInfo[] = [];

  for (let m = 0; m < numMonths; m++) {
    let year = baseYear, month = baseMonth + m;
    while (month > 11) { month -= 12; year++ }

    const firstDay = formatLocalISO(new Date(year, month, 1));
    const lastDay = formatLocalISO(new Date(year, month + 1, 0));

    // Opción C: solo semanas cuyo LUNES está dentro del mes
    const weeks: WeekInfo[] = [];
    const seen = new Set<string>();
    let current = new Date(year, month, 1);

    // Avanzar hasta el primer lunes del mes
    while (current.getDay() !== 1) current.setDate(current.getDate() + 1);

    while (formatLocalISO(current) <= lastDay) {
      const key = getWeekKey(current);
      if (!seen.has(key)) {
        seen.add(key);
        const monday = formatLocalISO(current);
        const sunday = addDays(monday, 6);
        // Capacidad solo cuenta días laborables dentro del mes
        let wd = 0;
        let d = monday;
        while (d <= sunday) {
          if (d >= firstDay && d <= lastDay) {
            const dow = parseLocalISO(d).getDay();
            if (dow !== 0 && dow !== 6) wd++;
          }
          d = addDays(d, 1);
        }
        weeks.push({
          key,
          label: `W${getISOWeekNum(current)}`,
          startDate: monday,
          endDate: sunday,
          capacityMins: wd * MINS_PER_DAY,
          isPast: sunday < today,
          isGenerated: monday <= generatedEndStr,
        });
      }
      current.setDate(current.getDate() + 7);
    }

    const wd = workdaysInMonth(year, month);
    months.push({
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: getMonthLabel(year, month),
      year, month, weeks,
      capacityMins: wd * MINS_PER_DAY,
    });
  }
  return months;
}

// ─── Días de una semana ───────────────────────────────────────────────────────

function buildDays(week: WeekInfo, today: string): DayInfo[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(week.startDate, i);
    const dow = parseLocalISO(date).getDay();
    const isWorkday = dow !== 0 && dow !== 6;
    return {
      date,
      label: `${DAY_LABELS[dow]} ${parseLocalISO(date).getDate()}`,
      isWorkday,
      isToday: date === today,
      capacityMins: isWorkday ? MINS_PER_DAY : 0,
    };
  });
}

// ─── Cálculo recurrencia ──────────────────────────────────────────────────────

function countOccurrencesInRange(recurrence: any, startStr: string, endStr: string): number {
  if (!recurrence) return 0;
  let count = 0, current = startStr;
  while (current <= endStr) {
    if (current < (recurrence.startDate || '')) { current = addDays(current, 1); continue; }
    if (recurrence.endDate && current > recurrence.endDate) break;
    const date = parseLocalISO(current);
    const specDay = (date.getDay() + 6) % 7;
    let matches = false;
    switch (recurrence.frequency) {
      case 'daily': matches = true; break;
      case 'weekdays': matches = specDay <= 4; break;
      case 'weekly': matches = (recurrence.weekDays || []).includes(specDay); break;
      case 'monthly': matches = date.getDate() === (recurrence.monthDay || 1); break;
    }
    if (matches) count++;
    current = addDays(current, 1);
  }
  return count;
}

// ─── Calcular minutos de una tarea hoja en un rango ──────────────────────────

function calcRangeMinutes(
  task: any, startStr: string, endStr: string,
  isPast: boolean, isGenerated: boolean,
  allTasksMap: Record<string, Task>,
  registeredByDay: Record<string, number>
): number {
  if (isPast) {
    let total = 0;
    let current = startStr;
    while (current <= endStr) {
      total += registeredByDay[`${task.id}__${current}`] || 0;
      current = addDays(current, 1);
    }
    return total;
  }
  // Presente y futuro: usar cálculo matemático siempre que haya recurrence
  // (más fiable y rápido que buscar instancias en memoria)
  if (task.recurrence) {
    const count = countOccurrencesInRange(task.recurrence, startStr, endStr);
    return count * (task.estimatedMinutes || 0);
  }
  // Tarea puntual con fecha
  if (task.dueDate && task.dueDate >= startStr && task.dueDate <= endStr)
    return task.estimatedMinutes || 0;
  return 0;
}

// ─── buildTaskLoads ───────────────────────────────────────────────────────────

function buildTaskLoads(
  allTasksMap: Record<string, Task>,
  months: MonthInfo[],
  registeredByDay: Record<string, number>,
  generatedEndStr: string,
  today: string
): TaskLoad[] {
  const loads: TaskLoad[] = [];

  const calcLoad = (task: any, startStr: string, endStr: string, isPast: boolean, isGen: boolean) =>
    calcRangeMinutes(task, startStr, endStr, isPast, isGen, allTasksMap, registeredByDay);

  const allWeeks = months.flatMap(m => m.weeks);

  const processTask = (task: any, parentId?: string) => {
    const isContainer = (task.subtasks || []).length > 0 && task.isTemplate;

    const monthMinutes: Record<string, number> = {};
    const weekMinutes: Record<string, number> = {};
    // dayMinutes calculado bajo demanda — NO aquí

    if (isContainer) {
      const subs = (task.subtasks || []).map((sid: string) => allTasksMap[sid]).filter((s: any) => s && !s.isDeleted);
      months.forEach(mo => {
        const firstDay = formatLocalISO(new Date(mo.year, mo.month, 1));
        const lastDay = formatLocalISO(new Date(mo.year, mo.month + 1, 0));
        const isPast = lastDay < today;
        monthMinutes[mo.key] = subs.reduce((acc: number, sub: any) =>
          acc + calcLoad(sub, firstDay, lastDay, isPast, firstDay <= generatedEndStr), 0);
      });
      allWeeks.forEach(week => {
        weekMinutes[week.key] = subs.reduce((acc: number, sub: any) =>
          acc + calcLoad(sub, week.startDate, week.endDate, week.isPast, week.isGenerated), 0);
      });
    } else {
      months.forEach(mo => {
        const firstDay = formatLocalISO(new Date(mo.year, mo.month, 1));
        const lastDay = formatLocalISO(new Date(mo.year, mo.month + 1, 0));
        const isPast = lastDay < today;
        monthMinutes[mo.key] = calcLoad(task, firstDay, lastDay, isPast, firstDay <= generatedEndStr);
      });
      allWeeks.forEach(week => {
        weekMinutes[week.key] = calcLoad(task, week.startDate, week.endDate, week.isPast, week.isGenerated);
      });
    }

    loads.push({
      taskId: task.id, title: task.title, blockId: task.blockId,
      taskType: task.taskType || 'core', isContainer, parentId,
      monthMinutes, weekMinutes,
      dayMinutes: {}, // vacío — se calcula bajo demanda
    });

    if (isContainer) {
      (task.subtasks || []).forEach((subId: string) => {
        const sub = allTasksMap[subId] as any;
        if (!sub || sub.isDeleted) return;
        processTask(sub, task.id);
      });
    }
  };

  Object.values(allTasksMap).filter((t: any) =>
    t && t.isTemplate && !t.templateId && !t.isDeleted && !t.parentTaskId && t.isActive !== false
  ).forEach((t: any) => processTask(t));

  Object.values(allTasksMap).filter((t: any) =>
    t && !t.isTemplate && !t.templateId && !t.isDeleted && !t.parentTaskId && t.dueDate
  ).forEach((t: any) => {
    const inRange = months.some(mo => {
      const firstDay = formatLocalISO(new Date(mo.year, mo.month, 1));
      const lastDay = formatLocalISO(new Date(mo.year, mo.month + 1, 0));
      return t.dueDate >= firstDay && t.dueDate <= lastDay;
    });
    if (!inRange) return;
    processTask(t);
  });

  return loads;
}

// ─── Agrupación ───────────────────────────────────────────────────────────────

function sumField(loads: TaskLoad[], field: 'monthMinutes' | 'weekMinutes' | 'dayMinutes', keys: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  keys.forEach(k => { map[k] = 0; });
  loads.filter(l => !l.parentId).forEach(l => { keys.forEach(k => { map[k] += (l as any)[field][k] || 0; }); });
  return map;
}

function groupLoads(loads: TaskLoad[], mode: GroupMode, blocks: WorkBlock[], months: MonthInfo[]): GroupNode[] {
  const monthKeys = months.map(m => m.key);
  const allWeeks = months.flatMap(m => m.weeks);
  const weekKeys = allWeeks.map(w => w.key);
  const dayKeys = allWeeks.flatMap(w => buildDays(w, '').map(d => d.date));

  const tLabel = (t: string) => t === 'core' ? 'Puesto (Core)' : 'Puntual (Ad-hoc)';
  const tColor = (t: string) => t === 'core' ? '#10B981' : '#F59E0B';

  const makeLeafNode = (l: TaskLoad): GroupNode => {
    const subLoads = loads.filter(sl => sl.parentId === l.taskId);
    const children: GroupNode[] = subLoads.map(sl => ({
      key: `${l.taskId}__${sl.taskId}`, label: sl.title,
      monthMinutes: sl.monthMinutes, weekMinutes: sl.weekMinutes, dayMinutes: sl.dayMinutes,
      children: [], isLeaf: true,
    }));
    return {
      key: l.taskId, label: l.title,
      monthMinutes: l.monthMinutes, weekMinutes: l.weekMinutes, dayMinutes: l.dayMinutes,
      children, isLeaf: children.length === 0,
    };
  };

  const rootLoads = loads.filter(l => !l.parentId);

  if (mode === 'block') {
    const bMap = new Map<string, Map<string, TaskLoad[]>>();
    rootLoads.forEach(l => {
      if (!bMap.has(l.blockId)) bMap.set(l.blockId, new Map());
      const tm = bMap.get(l.blockId)!;
      if (!tm.has(l.taskType)) tm.set(l.taskType, []);
      tm.get(l.taskType)!.push(l);
    });
    return Array.from(bMap.entries()).map(([bid, tm]) => {
      const b = blocks.find(b => b.id === bid);
      const all = Array.from(tm.values()).flat();
      return {
        key: bid, label: `${b?.icon||''} ${b?.name||bid}`, color: b?.color,
        monthMinutes: sumField(all, 'monthMinutes', monthKeys),
        weekMinutes: sumField(all, 'weekMinutes', weekKeys),
        dayMinutes: sumField(all, 'dayMinutes', dayKeys),
        isLeaf: false,
        children: Array.from(tm.entries()).map(([type, items]) => ({
          key: `${bid}-${type}`, label: tLabel(type), color: tColor(type),
          monthMinutes: sumField(items, 'monthMinutes', monthKeys),
          weekMinutes: sumField(items, 'weekMinutes', weekKeys),
          dayMinutes: sumField(items, 'dayMinutes', dayKeys),
          isLeaf: false,
          children: items.map(makeLeafNode),
        })),
      };
    });
  }

  // type
  const tMap = new Map<string, TaskLoad[]>();
  rootLoads.forEach(l => { if (!tMap.has(l.taskType)) tMap.set(l.taskType, []); tMap.get(l.taskType)!.push(l); });
  return Array.from(tMap.entries()).map(([type, items]) => ({
    key: type, label: tLabel(type), color: tColor(type),
    monthMinutes: sumField(items, 'monthMinutes', monthKeys),
    weekMinutes: sumField(items, 'weekMinutes', weekKeys),
    dayMinutes: sumField(items, 'dayMinutes', dayKeys),
    isLeaf: false,
    children: items.map(makeLeafNode),
  }));
}

// ─── ProgressCell ─────────────────────────────────────────────────────────────

function ProgressCell({ minutes, capacityMins, compact = false }: { minutes: number; capacityMins: number; compact?: boolean }) {
  const pct = capacityMins > 0 ? Math.round((minutes / capacityMins) * 100) : 0;
  const color = getPctColor(pct);
  const textClass = getPctTextClass(pct);
  const barPct = Math.min(100, pct);

  if (minutes === 0) return <span className="text-[10px] dark:text-text-secondary/20 text-text-secondary-light/20">—</span>;

  if (compact) {
    // Semana/día: % + horas + barra fina
    return (
      <div className="flex flex-col items-start gap-0.5 min-w-[72px]">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-black ${textClass}`}>{pct}%</span>
          <span className={`text-[9px] font-bold dark:text-text-secondary text-text-secondary-light`}>{formatMinutes(minutes)}</span>
        </div>
        <div className="w-full h-0.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: color }} />
        </div>
      </div>
    );
  }

  // Mes: % + horas + barra
  return (
    <div className="flex flex-col gap-1 min-w-[100px]">
      <div className="flex items-center gap-2">
        <span className={`text-[13px] font-black ${textClass}`}>{pct}%</span>
        <span className={`text-[11px] font-bold ${textClass}`}>{formatMinutes(minutes)}</span>
      </div>
      <div className="w-full h-1.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─── FilterChip ───────────────────────────────────────────────────────────────

function FilterChip({ label, count, options, selected, onToggle, onClear }: {
  label: string; count: number;
  options: { value: string; label: string; color?: string }[];
  selected: string[]; onToggle: (v: string) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${selected.length > 0 ? 'bg-turquesa text-white border-turquesa' : 'dark:bg-bg-card bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50'}`}
      >
        {label}
        {count > 0 && <span className="w-4 h-4 rounded-full bg-white/30 text-[9px] font-black flex items-center justify-center">{count}</span>}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-2 left-0 z-50 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl min-w-[180px] overflow-hidden">
          <div className="py-1.5 max-h-60 overflow-y-auto">
            {options.map(opt => (
              <button key={opt.value} onClick={() => onToggle(opt.value)}
                className="w-full flex items-center gap-2.5 px-4 py-2 hover:dark:bg-white/5 hover:bg-gray-50 transition-all"
              >
                <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 ${selected.includes(opt.value) ? 'bg-turquesa border-turquesa text-white' : 'dark:border-border-main border-border-main-light'}`}>
                  {selected.includes(opt.value) && <span className="text-[9px]">✓</span>}
                </div>
                {opt.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />}
                <span className={`text-[11px] font-bold truncate ${selected.includes(opt.value) ? 'dark:text-white text-text-main-light' : 'dark:text-text-secondary text-text-secondary-light'}`}>{opt.label}</span>
              </button>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t dark:border-border-main border-border-main-light">
              <button onClick={() => { onClear(); setOpen(false); }} className="w-full px-4 py-2 text-[10px] font-black uppercase tracking-widest text-rosa/70 hover:text-rosa text-left">Limpiar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WorkloadRow — fila recursiva ─────────────────────────────────────────────

function WorkloadRow({
  node, months, expandedMonths, expandedWeeks, expandedGroups,
  onToggleMonth, onToggleWeek, onToggleGroup, depth, today, onNavigate, dayLoadCache,
}: {
  node: GroupNode;
  months: MonthInfo[];
  expandedMonths: Set<string>;
  expandedWeeks: Set<string>;
  expandedGroups: Set<string>;
  onToggleMonth: (key: string) => void;
  onToggleWeek: (key: string) => void;
  onToggleGroup: (key: string) => void;
  depth: number;
  today: string;
  onNavigate: (date: string) => void;
  dayLoadCache: Record<string, number>;
}) {
  // Suma minutos de un día para este nodo (recursivo sobre hojas)
  const getNodeDayMins = (n: GroupNode, date: string): number => {
    if (n.isLeaf) {
      const taskId = n.key.includes('__') ? n.key.split('__').pop()! : n.key;
      return dayLoadCache[`${taskId}__${date}`] || 0;
    }
    return n.children.reduce((acc, child) => acc + getNodeDayMins(child, date), 0);
  };
  const isOpen = expandedGroups.has(node.key);
  const pl = depth === 0 ? 'pl-5' : depth === 1 ? 'pl-9' : depth === 2 ? 'pl-13' : 'pl-16';
  const bgRow = depth === 0
    ? 'dark:bg-white/[0.04] bg-gray-50/80 border-t-2 dark:border-t-border-main/40 border-t-border-main-light/40'
    : depth === 1 ? '' : 'dark:bg-black/[0.02]';
  const txtCls = depth === 0
    ? 'text-[12px] font-black dark:text-white text-text-main-light'
    : depth === 1 ? 'text-[11px] font-bold dark:text-text-secondary text-text-secondary-light'
    : depth === 2 ? 'text-[10px] font-semibold dark:text-text-secondary/80 text-text-secondary-light/80'
    : 'text-[10px] font-medium dark:text-text-secondary/60 text-text-secondary-light/60';

  return (
    <>
      <tr className={`border-b dark:border-border-main/15 border-border-main-light/15 ${bgRow} ${!node.isLeaf ? 'cursor-pointer hover:dark:bg-white/[0.06] hover:bg-black/[0.03] transition-all' : 'hover:dark:bg-white/[0.02] hover:bg-black/[0.01] transition-all'}`}
        onClick={!node.isLeaf ? () => onToggleGroup(node.key) : undefined}
      >
        {/* Nombre tarea */}
        <td className={`${pl} pr-4 py-3 sticky left-0 z-10 min-w-[240px] max-w-[300px]`}
          style={{ backgroundColor: 'inherit' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {node.color && !node.isLeaf && depth <= 1 && <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: node.color }} />}
            {node.color && !node.isLeaf && depth > 1 && <div className="w-1.5 h-1.5 rounded-full shrink-0 opacity-70" style={{ backgroundColor: node.color }} />}
            <span className={`${txtCls} truncate flex-1`}>{node.label}</span>
            {!node.isLeaf && (isOpen
              ? <ChevronUp size={10} className="shrink-0 opacity-40" />
              : <ChevronDown size={10} className="shrink-0 opacity-40" />
            )}
          </div>
        </td>

        {/* Columnas de meses */}
        {months.map(mo => {
          const mins = node.monthMinutes[mo.key] || 0;
          const isMonthExp = expandedMonths.has(mo.key);
          return (
            <React.Fragment key={mo.key}>
              {/* Celda mes */}
              <td className="px-3 py-2 border-l dark:border-border-main/30 border-border-main-light/30 min-w-[120px]">
                <ProgressCell minutes={mins} capacityMins={mo.capacityMins} />
              </td>

              {/* Columnas de semanas (si el mes está expandido) */}
              {isMonthExp && mo.weeks.map(week => {
                const wMins = node.weekMinutes[week.key] || 0;
                const isWeekExp = expandedWeeks.has(week.key);
                return (
                  <React.Fragment key={week.key}>
                    <td className="px-2 py-2 border-l dark:border-border-main/20 border-border-main-light/20 min-w-[90px]">
                      <ProgressCell minutes={wMins} capacityMins={week.capacityMins} compact />
                    </td>
                    {/* Columnas de días */}
                    {isWeekExp && buildDays(week, today).map(day => {
                      const dMins = getNodeDayMins(node, day.date);
                      return (
                        <td key={day.date}
                          className={`px-1 py-2 border-l dark:border-border-main/10 border-border-main-light/10 min-w-[64px] text-center ${!day.isWorkday ? 'dark:bg-black/10 bg-gray-100/50' : ''} ${day.isToday ? 'dark:bg-turquesa/5 bg-turquesa/5' : ''}`}
                        >
                          {day.isWorkday
                            ? <ProgressCell minutes={dMins} capacityMins={day.capacityMins} compact />
                            : <span className="text-[9px] dark:text-text-secondary/20 text-text-secondary-light/20">—</span>
                          }
                        </td>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}
      </tr>

      {/* Hijos */}
      {!node.isLeaf && isOpen && node.children.map(child => (
        <WorkloadRow key={child.key} node={child} months={months}
          expandedMonths={expandedMonths} expandedWeeks={expandedWeeks} expandedGroups={expandedGroups}
          onToggleMonth={onToggleMonth} onToggleWeek={onToggleWeek} onToggleGroup={onToggleGroup}
          depth={depth + 1} today={today} onNavigate={onNavigate} dayLoadCache={dayLoadCache}
        />
      ))}
    </>
  );
}

// ─── WorkloadView ─────────────────────────────────────────────────────────────

export function WorkloadView({
  tasks, allTasksMap, blocks, timeEntries = [], onNavigateToDashboard,
}: {
  tasks: Record<string, Task>;
  allTasksMap: Record<string, Task>;
  blocks: WorkBlock[];
  timeEntries: TimeEntry[];
  onNavigateToDashboard: (date: string) => void;
}) {
  const todayDate = new Date();
  const today = formatLocalISO(todayDate);
  const generatedEnd = new Date(todayDate);
  generatedEnd.setDate(generatedEnd.getDate() + 365);
  const generatedEndStr = formatLocalISO(generatedEnd);

  const [groupMode, setGroupMode] = useState<GroupMode>('block');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [filterBlocks, setFilterBlocks] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);

  const months = useMemo(() =>
    buildMonths(todayDate.getFullYear(), todayDate.getMonth(), 7, today, generatedEndStr),
    [today, generatedEndStr]
  );

  const registeredByDay = useMemo(() => {
    const map: Record<string, number> = {};
    timeEntries.forEach(te => {
      const key = `${te.subtaskId || te.taskId}__${te.date}`;
      map[key] = (map[key] || 0) + te.duration;
    });
    return map;
  }, [timeEntries]);

  const allLoads = useMemo(() =>
    buildTaskLoads(allTasksMap, months, registeredByDay, generatedEndStr, today),
    [allTasksMap, months, registeredByDay, generatedEndStr, today]
  );

  const taskLoads = useMemo(() => allLoads.filter(l => {
    if (filterBlocks.length > 0 && !filterBlocks.includes(l.blockId)) return false;
    if (filterTypes.length > 0 && !filterTypes.includes(l.taskType)) return false;
    return true;
  }), [allLoads, filterBlocks, filterTypes]);

  const grouped = useMemo(() =>
    groupLoads(taskLoads, groupMode, blocks, months),
    [taskLoads, groupMode, blocks, months]
  );

  // Totales globales por mes/semana para el header
  const totalMonthMins = useMemo(() => {
    const map: Record<string, number> = {};
    taskLoads.filter(l => !l.parentId).forEach(l => {
      Object.entries(l.monthMinutes).forEach(([k, v]) => { map[k] = (map[k] || 0) + v; });
    });
    return map;
  }, [taskLoads]);

  const totalWeekMins = useMemo(() => {
    const map: Record<string, number> = {};
    taskLoads.filter(l => !l.parentId).forEach(l => {
      Object.entries(l.weekMinutes).forEach(([k, v]) => { map[k] = (map[k] || 0) + v; });
    });
    return map;
  }, [taskLoads]);

  // Total por día — suma de todos los loads raíz para cada fecha
  const totalDayMins = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(dayLoadCache).forEach(([key, mins]) => {
      const date = key.split('__').pop()!;
      // Solo contar loads raíz (sin parentId) para evitar doble conteo
      const taskId = key.split('__')[0];
      const load = taskLoads.find(l => l.taskId === taskId && !l.parentId);
      if (load) map[date] = (map[date] || 0) + mins;
    });
    return map;
  }, [dayLoadCache, taskLoads]);

  // Carga por día — calculada bajo demanda solo para semanas expandidas
  const dayLoadCache = useMemo(() => {
    const cache: Record<string, Record<string, number>> = {}; // nodeKey__date → mins
    if (expandedWeeks.size === 0) return cache;

    const expandedWeekList = months.flatMap(m => m.weeks).filter(w => expandedWeeks.has(w.key));

    taskLoads.forEach(load => {
      expandedWeekList.forEach(week => {
        buildDays(week, today).forEach(day => {
          if (!day.isWorkday) return;
          const task = allTasksMap[load.taskId] as any;
          if (!task) return;
          let mins = 0;
          if (load.isContainer) {
            const subs = (task.subtasks || []).map((sid: string) => allTasksMap[sid]).filter((s: any) => s && !s.isDeleted);
            mins = subs.reduce((acc: number, sub: any) =>
              acc + calcRangeMinutes(sub, day.date, day.date, week.isPast, week.isGenerated, allTasksMap, registeredByDay), 0);
          } else {
            mins = calcRangeMinutes(task, day.date, day.date, week.isPast, week.isGenerated, allTasksMap, registeredByDay);
          }
          const key = `${load.taskId}__${day.date}`;
          cache[key] = mins;
        });
      });
    });
    return cache;
  }, [taskLoads, expandedWeeks, allTasksMap, registeredByDay, months, today]);
  const toggleMonth = (key: string) => setExpandedMonths(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleWeek = (key: string) => setExpandedWeeks(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleGroup = (key: string) => setExpandedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleFilter = (arr: string[], setArr: (v: string[]) => void, v: string) =>
    setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const blockOptions = blocks.map(b => ({ value: b.id, label: `${b.icon} ${b.name}`, color: b.color }));
  const typeOptions = [{ value: 'core', label: 'Puesto (Core)' }, { value: 'adhoc', label: 'Puntual (Ad-hoc)' }];

  const rootLoads = taskLoads.filter(l => !l.parentId);

  return (
    <div className="max-w-full space-y-4 pb-32">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-3xl font-black dark:text-white text-text-main-light">Carga de Trabajo</h2>
          <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-1">
            {rootLoads.length} tareas · 8h/día · 40h/semana
          </p>
        </div>
        <div className="flex rounded-xl overflow-hidden border dark:border-border-main border-border-main-light">
          {([
            { v: 'block' as GroupMode, icon: <Layers size={12} />, label: 'Bloque' },
            { v: 'type' as GroupMode, icon: <Tag size={12} />, label: 'Tipo' },
          ]).map(({ v, icon, label }) => (
            <button key={v} onClick={() => setGroupMode(v)}
              className={`flex items-center gap-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${groupMode === v ? 'bg-morado text-white' : 'dark:bg-bg-card bg-white dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light'}`}
            >{icon}<span>{label}</span></button>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip label="Bloque" count={filterBlocks.length} options={blockOptions} selected={filterBlocks}
          onToggle={v => toggleFilter(filterBlocks, setFilterBlocks, v)} onClear={() => setFilterBlocks([])} />
        <FilterChip label="Tipo" count={filterTypes.length} options={typeOptions} selected={filterTypes}
          onToggle={v => toggleFilter(filterTypes, setFilterTypes, v)} onClear={() => setFilterTypes([])} />
        {(filterBlocks.length > 0 || filterTypes.length > 0) && (
          <button onClick={() => { setFilterBlocks([]); setFilterTypes([]); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-rosa hover:text-rosa transition-all text-[11px] font-black uppercase tracking-widest"
          ><X size={11} /> Limpiar</button>
        )}
      </div>

      {/* Tabla */}
      <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse">
            <thead>
              {/* FILA 1 — Meses */}
              <tr className="border-b-2 dark:border-border-main border-border-main-light">
                <th className="sticky left-0 dark:bg-bg-card bg-white z-20 px-5 py-4 text-left min-w-[240px]" rowSpan={4}>
                  <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Tarea</span>
                </th>
                {months.map(mo => {
                  const isExp = expandedMonths.has(mo.key);
                  const total = totalMonthMins[mo.key] || 0;
                  const pct = mo.capacityMins > 0 ? Math.round((total / mo.capacityMins) * 100) : 0;
                  const colSpan = isExp
                    ? mo.weeks.reduce((acc, w) => acc + 1 + (expandedWeeks.has(w.key) ? buildDays(w, today).length : 0), 0)
                    : 1;
                  return (
                    <th key={mo.key} colSpan={colSpan}
                      className={`border-l dark:border-border-main/50 border-border-main-light/50 px-4 py-4 min-w-[140px] text-left align-middle ${isExp ? 'dark:bg-turquesa/5 bg-turquesa/5' : ''}`}
                    >
                      <button onClick={() => toggleMonth(mo.key)} className="flex items-center gap-3 w-full group">
                        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[12px] font-black uppercase tracking-wider ${isExp ? 'text-turquesa' : 'dark:text-white text-text-main-light'}`}>{mo.label}</span>
                            {total > 0 && <span className={`text-[11px] font-black ${getPctTextClass(pct)}`}>{formatMinutes(total)}</span>}
                            {total > 0 && <span className={`text-[10px] font-bold dark:text-text-secondary text-text-secondary-light`}>{pct}%</span>}
                          </div>
                          {total > 0 && (
                            <div className="w-full h-1.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: getPctColor(pct) }} />
                            </div>
                          )}
                        </div>
                        <ChevronDown size={14} className={`shrink-0 transition-transform ${isExp ? 'rotate-180 text-turquesa' : 'dark:text-text-secondary/50 text-text-secondary-light/50'}`} />
                      </button>
                    </th>
                  );
                })}
              </tr>

              {/* FILA 2 — Semanas */}
              <tr className="border-b dark:border-border-main/40 border-border-main-light/40 dark:bg-bg-main/20 bg-gray-50/50">
                {months.map(mo => {
                  if (!expandedMonths.has(mo.key)) return null;
                  return mo.weeks.map(week => {
                    const isWeekExp = expandedWeeks.has(week.key);
                    const wTotal = totalWeekMins[week.key] || 0;
                    const wPct = week.capacityMins > 0 ? Math.round((wTotal / week.capacityMins) * 100) : 0;
                    const colSpan = isWeekExp ? 1 + buildDays(week, today).length : 1;
                    return (
                      <th key={week.key} colSpan={colSpan}
                        className={`border-l dark:border-border-main/20 border-border-main-light/20 px-3 py-2.5 min-w-[90px] text-left align-middle ${isWeekExp ? 'dark:bg-azul/5 bg-azul/5' : ''}`}
                      >
                        <button onClick={() => toggleWeek(week.key)} className="flex items-center gap-2 w-full">
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10px] font-black ${isWeekExp ? 'text-azul' : 'dark:text-text-secondary text-text-secondary-light'}`}>{week.label}</span>
                              {wTotal > 0 && <span className={`text-[9px] font-bold ${getPctTextClass(wPct)}`}>{formatMinutes(wTotal)}</span>}
                              {wTotal > 0 && <span className={`text-[8px] dark:text-text-secondary/50 text-text-secondary-light/50`}>{wPct}%</span>}
                            </div>
                            {wTotal > 0 && (
                              <div className="w-full h-0.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, wPct)}%`, backgroundColor: getPctColor(wPct) }} />
                              </div>
                            )}
                          </div>
                          <ChevronDown size={11} className={`shrink-0 transition-transform ${isWeekExp ? 'rotate-180 text-azul' : 'dark:text-text-secondary/30'}`} />
                        </button>
                      </th>
                    );
                  });
                })}
              </tr>

              {/* FILA 3 — Días */}
              <tr className="border-b dark:border-border-main/30 border-border-main-light/30 dark:bg-bg-main/30 bg-gray-50/70">
                {months.map(mo => {
                  if (!expandedMonths.has(mo.key)) return null;
                  return mo.weeks.map(week => {
                    if (!expandedWeeks.has(week.key)) return null;
                    return buildDays(week, today).map(day => (
                      <th key={day.date}
                        className={`border-l dark:border-border-main/10 border-border-main-light/10 px-1 py-2 min-w-[60px] text-center ${!day.isWorkday ? 'opacity-30' : ''} ${day.isToday ? 'dark:bg-turquesa/15 bg-turquesa/10' : ''}`}
                      >
                        <button onClick={() => onNavigateToDashboard(day.date)} className="w-full hover:text-turquesa transition-all">
                          <span className={`text-[9px] font-black block ${day.isToday ? 'text-turquesa' : 'dark:text-text-secondary text-text-secondary-light'}`}>
                            {day.label}
                          </span>
                        </button>
                      </th>
                    ));
                  });
                })}
              </tr>

              {/* FILA 4 — Total por día */}
              <tr className="border-b-2 dark:border-border-main border-border-main-light dark:bg-bg-main/40 bg-gray-100/60">
                {months.map(mo => {
                  if (!expandedMonths.has(mo.key)) return null;
                  return mo.weeks.map(week => {
                    if (!expandedWeeks.has(week.key)) return null;
                    return buildDays(week, today).map(day => {
                      const dTotal = totalDayMins[day.date] || 0;
                      const dPct = day.capacityMins > 0 ? Math.round((dTotal / day.capacityMins) * 100) : 0;
                      return (
                        <td key={day.date}
                          className={`border-l dark:border-border-main/10 border-border-main-light/10 px-1 py-2 min-w-[60px] text-center ${!day.isWorkday ? 'opacity-20' : ''} ${day.isToday ? 'dark:bg-turquesa/10 bg-turquesa/5' : ''}`}
                        >
                          {day.isWorkday && dTotal > 0 ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`text-[10px] font-black ${getPctTextClass(dPct)}`}>{dPct}%</span>
                              <span className={`text-[9px] font-bold ${getPctTextClass(dPct)}`}>{formatMinutes(dTotal)}</span>
                              <div className="w-full h-0.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, dPct)}%`, backgroundColor: getPctColor(dPct) }} />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[9px] dark:text-text-secondary/20 text-text-secondary-light/20">—</span>
                          )}
                        </td>
                      );
                    });
                  });
                })}
              </tr>
            </thead>

            <tbody>
              {grouped.map(node => (
                <WorkloadRow key={node.key} node={node} months={months}
                  expandedMonths={expandedMonths} expandedWeeks={expandedWeeks} expandedGroups={expandedGroups}
                  onToggleMonth={toggleMonth} onToggleWeek={toggleWeek} onToggleGroup={toggleGroup}
                  depth={0} today={today} onNavigate={onNavigateToDashboard} dayLoadCache={dayLoadCache}
                />
              ))}
              {grouped.length === 0 && (
                <tr>
                  <td colSpan={99} className="text-center py-20">
                    <p className="text-sm font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest opacity-30">Sin datos de carga</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
