/**
 * WorkloadView.tsx
 * Vista de carga de trabajo semanal.
 *
 * TRES TRAMOS TEMPORALES:
 * ─ Pasado    → instancias Supabase (existsInSupabase) + time_entries reales
 * ─ Presente  → instancias generadas en memoria (allTasksMap, 12 meses)
 * ─ Futuro+12 → cálculo matemático desde templates
 *
 * ARQUITECTURA DE TAREAS:
 * ─ Contenedor: agrupa subtareas, sin recurrence/estimatedMinutes propios
 * ─ Template (isTemplate:true): puede ser simple o subtarea de contenedor
 * ─ Instancia (templateId presente): generada o guardada en Supabase
 * ─ Puntual: sin isTemplate, sin templateId, con dueDate
 */

import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  BarChart2, Layers, Tag, RotateCcw
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { Task, WorkBlock, TimeEntry } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { formatMinutes } from './utils';

// ─── Colores (mismo criterio que CalendarView) ──────────────────────────────

function getWeekColorHex(minutes: number): string {
  if (minutes === 0) return 'transparent';
  if (minutes < 900) return '#10B981';
  if (minutes < 1500) return '#F59E0B';
  if (minutes < 2100) return '#A855F7';
  return '#EC4899';
}

function getWeekColorText(minutes: number): string {
  if (minutes === 0) return 'dark:text-text-secondary/30 text-text-secondary-light/30';
  if (minutes < 900) return 'text-[#10B981]';
  if (minutes < 1500) return 'text-[#F59E0B]';
  if (minutes < 2100) return 'text-[#A855F7]';
  return 'text-[#EC4899]';
}

// ─── Tipos ──────────────────────────────────────────────────────────────────

type GroupMode = 'block' | 'type' | 'block-type' | 'type-block';

interface WeekInfo {
  key: string;        // 'YYYY-WW'
  label: string;      // 'S1', 'S2'...
  startDate: string;  // YYYY-MM-DD lunes
  endDate: string;    // YYYY-MM-DD domingo
  monthLabel: string; // 'Ene 2026'
  isPast: boolean;    // domingo < today
  isGenerated: boolean; // dentro de los 12 meses generados en memoria
}

interface TaskLoad {
  taskId: string;       // id del template o tarea
  title: string;
  blockId: string;
  taskType: string;     // 'core' | 'adhoc'
  isContainer: boolean;
  weekMinutes: Record<string, number>; // weekKey → minutos
}

interface GroupNode {
  key: string;
  label: string;
  color?: string;
  weekMinutes: Record<string, number>;
  children: GroupNode[];
  isLeaf: boolean;
  taskLoad?: TaskLoad;
}

// ─── Helpers de fecha ───────────────────────────────────────────────────────

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekKey(date: Date): string {
  const monday = getMondayOfWeek(date);
  const year = monday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const weekNum = Math.ceil(((monday.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${year}-${String(weekNum).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number): string {
  const d = parseLocalISO(dateStr);
  d.setDate(d.getDate() + days);
  return formatLocalISO(d);
}

function getMonthLabel(year: number, month: number): string {
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${months[month]} ${year}`;
}

function getWeeksForMonths(
  baseYear: number, baseMonth: number,
  numMonths: number, today: string, generatedEndDate: string
): WeekInfo[] {
  const weeks: WeekInfo[] = [];
  const seen = new Set<string>();

  for (let m = 0; m < numMonths; m++) {
    let year = baseYear;
    let month = baseMonth + m;
    while (month > 11) { month -= 12; year++; }

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const monthEnd = formatLocalISO(lastDay);

    let current = getMondayOfWeek(firstDay);
    let weekNumInMonth = 0;

    while (formatLocalISO(current) <= monthEnd) {
      const key = getWeekKey(current);
      if (!seen.has(key)) {
        seen.add(key);
        weekNumInMonth++;
        const monday = formatLocalISO(current);
        const sunday = addDays(monday, 6);
        weeks.push({
          key,
          label: `S${weekNumInMonth}`,
          startDate: monday,
          endDate: sunday,
          monthLabel: getMonthLabel(year, month),
          isPast: sunday < today,
          isGenerated: monday <= generatedEndDate,
        });
      }
      current.setDate(current.getDate() + 7);
    }
  }
  return weeks;
}

// ─── Cálculo matemático de recurrencia (para futuro > 12 meses) ─────────────
// Coherente con matchesRecurrence de utils.ts

function countOccurrencesInWeek(recurrence: any, weekStart: string, weekEnd: string): number {
  if (!recurrence) return 0;
  let count = 0;
  let current = weekStart;
  while (current <= weekEnd) {
    if (current < (recurrence.startDate || '')) { current = addDays(current, 1); continue; }
    if (recurrence.endDate && current > recurrence.endDate) break;

    const date = parseLocalISO(current);
    const jsDay = date.getDay();
    const specDay = (jsDay + 6) % 7; // 0=lunes...6=domingo

    let matches = false;
    switch (recurrence.frequency) {
      case 'daily':    matches = true; break;
      case 'weekdays': matches = specDay <= 4; break;
      case 'weekly':   matches = (recurrence.weekDays || []).includes(specDay); break;
      case 'monthly':  matches = date.getDate() === (recurrence.monthDay || 1); break;
    }
    if (matches) count++;
    current = addDays(current, 1);
  }
  return count;
}

// ─── Calcula minutos de una tarea hoja en una semana ────────────────────────

function calcLeafMinutes(
  task: Task,
  week: WeekInfo,
  allTasksMap: Record<string, Task>,
  registeredByKey: Record<string, number> // `${taskId}__${weekKey}` → minutes
): number {
  if (week.isPast) {
    // Pasado: tiempo registrado real
    return registeredByKey[`${task.id}__${week.key}`] || 0;
  }

  if (week.isGenerated) {
    // Presente/futuro cercano: instancias en memoria
    // Contar instancias con dueDate en esta semana
    const instances = Object.values(allTasksMap).filter((t: any) =>
      t && t.templateId === task.id &&
      !t.isDeleted &&
      t.dueDate >= week.startDate &&
      t.dueDate <= week.endDate
    );
    if (instances.length > 0) {
      return instances.reduce((acc, inst) => acc + (inst.estimatedMinutes || task.estimatedMinutes || 0), 0);
    }
    // Si no hay instancias generadas pero hay recurrence, calcular matemáticamente
    if (task.recurrence) {
      const count = countOccurrencesInWeek(task.recurrence, week.startDate, week.endDate);
      return count * (task.estimatedMinutes || 0);
    }
    // Tarea puntual
    if (task.dueDate && task.dueDate >= week.startDate && task.dueDate <= week.endDate) {
      return task.estimatedMinutes || 0;
    }
    return 0;
  }

  // Futuro lejano (> 12 meses): cálculo matemático
  if (task.recurrence) {
    const count = countOccurrencesInWeek(task.recurrence, week.startDate, week.endDate);
    return count * (task.estimatedMinutes || 0);
  }
  if (task.dueDate && task.dueDate >= week.startDate && task.dueDate <= week.endDate) {
    return task.estimatedMinutes || 0;
  }
  return 0;
}

// ─── Calcula carga de un nodo (contenedor o tarea hoja) ─────────────────────

function calcNodeMinutes(
  task: Task,
  weeks: WeekInfo[],
  allTasksMap: Record<string, Task>,
  registeredByKey: Record<string, number>
): Record<string, number> {
  const weekMinutes: Record<string, number> = {};
  weeks.forEach(w => { weekMinutes[w.key] = 0; });

  const isContainer = (task.subtasks || []).length > 0 && task.isTemplate;

  if (isContainer) {
    // Contenedor template: sumar carga de cada subtarea hoja
    (task.subtasks || []).forEach(subId => {
      const sub = allTasksMap[subId];
      if (!sub || sub.isDeleted) return;
      weeks.forEach(week => {
        weekMinutes[week.key] += calcLeafMinutes(sub, week, allTasksMap, registeredByKey);
      });
    });
  } else {
    // Tarea hoja (template simple o puntual)
    weeks.forEach(week => {
      weekMinutes[week.key] = calcLeafMinutes(task, week, allTasksMap, registeredByKey);
    });
  }

  return weekMinutes;
}

// ─── Construye lista de TaskLoad ─────────────────────────────────────────────

function buildTaskLoads(
  allTasksMap: Record<string, Task>,
  weeks: WeekInfo[],
  registeredByKey: Record<string, number>
): TaskLoad[] {
  const loads: TaskLoad[] = [];

  // ── Templates (isTemplate: true, sin parentTaskId — son raíz) ──
  const templates = Object.values(allTasksMap).filter((t: any) =>
    t && t.isTemplate && !t.templateId && !t.isDeleted &&
    !t.parentTaskId && t.isActive !== false
  );

  templates.forEach((template: any) => {
    const weekMinutes = calcNodeMinutes(template, weeks, allTasksMap, registeredByKey);
    loads.push({
      taskId: template.id,
      title: template.title,
      blockId: template.blockId,
      taskType: template.taskType || 'core',
      isContainer: (template.subtasks || []).length > 0,
      weekMinutes,
    });
  });

  // ── Tareas puntuales normales (sin isTemplate, sin templateId, raíz) ──
  const puntuales = Object.values(allTasksMap).filter((t: any) =>
    t && !t.isTemplate && !t.templateId && !t.isDeleted &&
    !t.parentTaskId && t.dueDate
  );

  puntuales.forEach((task: any) => {
    const weekMinutes = calcNodeMinutes(task, weeks, allTasksMap, registeredByKey);
    const hasLoad = Object.values(weekMinutes).some(m => m > 0);
    // Mostrar aunque sea 0 si tiene dueDate en el rango visible
    const inRange = weeks.some(w => task.dueDate >= w.startDate && task.dueDate <= w.endDate);
    if (!hasLoad && !inRange) return;

    loads.push({
      taskId: task.id,
      title: task.title,
      blockId: task.blockId,
      taskType: task.taskType || 'adhoc',
      isContainer: false,
      weekMinutes,
    });
  });

  // ── Instancias pasadas en Supabase que NO tienen template en allTasksMap ──
  // (templates borrados pero con historial)
  const pastInstances = Object.values(allTasksMap).filter((t: any) =>
    t && t.existsInSupabase && t.templateId &&
    !t.isDeleted && !t.parentTaskId &&
    !allTasksMap[t.templateId] // template ya no existe
  );

  pastInstances.forEach((inst: any) => {
    const weekMinutes: Record<string, number> = {};
    weeks.forEach(w => { weekMinutes[w.key] = 0; });
    if (inst.dueDate) {
      const week = weeks.find(w => inst.dueDate >= w.startDate && inst.dueDate <= w.endDate);
      if (week && week.isPast) {
        weekMinutes[week.key] = registeredByKey[`${inst.id}__${week.key}`] || 0;
      }
    }
    loads.push({
      taskId: inst.id,
      title: inst.title,
      blockId: inst.blockId,
      taskType: inst.taskType || 'adhoc',
      isContainer: false,
      weekMinutes,
    });
  });

  return loads;
}

// ─── Agrupación ──────────────────────────────────────────────────────────────

function sumWeeks(loads: TaskLoad[], weekKeys: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  weekKeys.forEach(k => { map[k] = 0; });
  loads.forEach(l => {
    if (l.isContainer) return; // No doble conteo
    weekKeys.forEach(k => { map[k] += l.weekMinutes[k] || 0; });
  });
  return map;
}

function groupTaskLoads(
  loads: TaskLoad[], mode: GroupMode,
  blocks: WorkBlock[], weekKeys: string[]
): GroupNode[] {
  const typeLabel = (t: string) => t === 'core' ? 'Puesto (Core)' : 'Puntual (Ad-hoc)';
  const typeColor = (t: string) => t === 'core' ? '#10B981' : '#F59E0B';

  const makeLeaf = (load: TaskLoad): GroupNode => ({
    key: load.taskId,
    label: load.title,
    weekMinutes: load.weekMinutes,
    children: [],
    isLeaf: true,
    taskLoad: load,
  });

  if (mode === 'block') {
    const map = new Map<string, TaskLoad[]>();
    loads.forEach(l => {
      if (!map.has(l.blockId)) map.set(l.blockId, []);
      map.get(l.blockId)!.push(l);
    });
    return Array.from(map.entries()).map(([blockId, items]) => {
      const block = blocks.find(b => b.id === blockId);
      return {
        key: blockId,
        label: `${block?.icon || ''} ${block?.name || blockId}`,
        color: block?.color,
        weekMinutes: sumWeeks(items, weekKeys),
        children: items.map(makeLeaf),
        isLeaf: false,
      };
    });
  }

  if (mode === 'type') {
    const map = new Map<string, TaskLoad[]>();
    loads.forEach(l => {
      if (!map.has(l.taskType)) map.set(l.taskType, []);
      map.get(l.taskType)!.push(l);
    });
    return Array.from(map.entries()).map(([type, items]) => ({
      key: type,
      label: typeLabel(type),
      color: typeColor(type),
      weekMinutes: sumWeeks(items, weekKeys),
      children: items.map(makeLeaf),
      isLeaf: false,
    }));
  }

  if (mode === 'block-type') {
    const blockMap = new Map<string, Map<string, TaskLoad[]>>();
    loads.forEach(l => {
      if (!blockMap.has(l.blockId)) blockMap.set(l.blockId, new Map());
      const tm = blockMap.get(l.blockId)!;
      if (!tm.has(l.taskType)) tm.set(l.taskType, []);
      tm.get(l.taskType)!.push(l);
    });
    return Array.from(blockMap.entries()).map(([blockId, tm]) => {
      const block = blocks.find(b => b.id === blockId);
      const allItems = Array.from(tm.values()).flat();
      return {
        key: blockId,
        label: `${block?.icon || ''} ${block?.name || blockId}`,
        color: block?.color,
        weekMinutes: sumWeeks(allItems, weekKeys),
        isLeaf: false,
        children: Array.from(tm.entries()).map(([type, items]) => ({
          key: `${blockId}-${type}`,
          label: typeLabel(type),
          color: typeColor(type),
          weekMinutes: sumWeeks(items, weekKeys),
          children: items.map(makeLeaf),
          isLeaf: false,
        })),
      };
    });
  }

  // type-block
  const typeMap = new Map<string, Map<string, TaskLoad[]>>();
  loads.forEach(l => {
    if (!typeMap.has(l.taskType)) typeMap.set(l.taskType, new Map());
    const bm = typeMap.get(l.taskType)!;
    if (!bm.has(l.blockId)) bm.set(l.blockId, []);
    bm.get(l.blockId)!.push(l);
  });
  return Array.from(typeMap.entries()).map(([type, bm]) => {
    const allItems = Array.from(bm.values()).flat();
    return {
      key: type,
      label: typeLabel(type),
      color: typeColor(type),
      weekMinutes: sumWeeks(allItems, weekKeys),
      isLeaf: false,
      children: Array.from(bm.entries()).map(([blockId, items]) => {
        const block = blocks.find(b => b.id === blockId);
        return {
          key: `${type}-${blockId}`,
          label: `${block?.icon || ''} ${block?.name || blockId}`,
          color: block?.color,
          weekMinutes: sumWeeks(items, weekKeys),
          children: items.map(makeLeaf),
          isLeaf: false,
        };
      }),
    };
  });
}

// ─── GroupRow — render recursivo ────────────────────────────────────────────

function GroupRow({
  node, weeks, depth, expanded, onToggle,
}: {
  node: GroupNode;
  weeks: WeekInfo[];
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const isOpen = expanded.has(node.key) || (depth === 0 && !expanded.has(`__closed_${node.key}`));

  const toggle = () => {
    if (depth === 0) {
      // nivel 0: por defecto abierto, toggle cierra
      if (isOpen) {
        onToggle(`__closed_${node.key}`);
        onToggle(node.key);
      } else {
        onToggle(`__closed_${node.key}`);
        onToggle(node.key);
      }
    } else {
      onToggle(node.key);
    }
  };

  const pl = depth === 0 ? 'pl-5' : depth === 1 ? 'pl-9' : 'pl-14';
  const bg = depth === 0
    ? 'dark:bg-white/[0.03] bg-gray-50/60'
    : depth === 1 ? '' : 'dark:bg-black/10';
  const textSize = depth === 0
    ? 'text-[11px] dark:text-white text-text-main-light font-black'
    : depth === 1
    ? 'text-[10px] dark:text-text-secondary text-text-secondary-light font-bold'
    : 'text-[10px] dark:text-text-secondary/70 text-text-secondary-light/70 font-medium';

  return (
    <>
      <tr
        className={`border-b dark:border-border-main/20 border-border-main-light/20 ${bg} ${!node.isLeaf ? 'cursor-pointer hover:dark:bg-white/5 hover:bg-black/[0.03] transition-all' : ''}`}
        onClick={!node.isLeaf ? toggle : undefined}
      >
        <td className={`${pl} pr-3 py-2.5 max-w-[220px]`}>
          <div className="flex items-center gap-2 min-w-0">
            {node.color && !node.isLeaf && (
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: node.color }} />
            )}
            <span className={`${textSize} truncate`}>{node.label}</span>
            {!node.isLeaf && (
              isOpen
                ? <ChevronUp size={10} className="shrink-0 dark:text-text-secondary/50 text-text-secondary-light/50" />
                : <ChevronDown size={10} className="shrink-0 dark:text-text-secondary/50 text-text-secondary-light/50" />
            )}
          </div>
        </td>
        {weeks.map((week, idx) => {
          const mins = node.weekMinutes[week.key] || 0;
          const isFirst = idx === 0 || weeks[idx - 1].monthLabel !== week.monthLabel;
          return (
            <td
              key={week.key}
              className={`text-center px-2 py-2.5 min-w-[72px] ${isFirst ? 'border-l dark:border-border-main/40 border-border-main-light/40' : ''}`}
            >
              {mins > 0 ? (
                <div className="flex flex-col items-center gap-0.5">
                  <span className={`text-[11px] font-black ${getWeekColorText(mins)}`}>
                    {formatMinutes(mins)}
                  </span>
                  {!node.isLeaf && (
                    <div className="w-6 h-0.5 rounded-full opacity-60" style={{ backgroundColor: getWeekColorHex(mins) }} />
                  )}
                </div>
              ) : (
                <span className="text-[10px] dark:text-text-secondary/20 text-text-secondary-light/20">—</span>
              )}
            </td>
          );
        })}
      </tr>
      {!node.isLeaf && isOpen && node.children.map(child => (
        <GroupRow
          key={child.key}
          node={child}
          weeks={weeks}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

// ─── WorkloadView ────────────────────────────────────────────────────────────

export function WorkloadView({
  tasks,
  allTasksMap,
  blocks,
  timeEntries = [],
  onNavigateToDashboard,
}: {
  tasks: Record<string, Task>;
  allTasksMap: Record<string, Task>;
  blocks: WorkBlock[];
  timeEntries: TimeEntry[];
  onNavigateToDashboard: (date: string) => void;
}) {
  const todayDate = new Date();
  const today = formatLocalISO(todayDate);

  // Fecha límite de instancias generadas (12 meses)
  const generatedEnd = new Date(todayDate);
  generatedEnd.setDate(generatedEnd.getDate() + 365);
  const generatedEndStr = formatLocalISO(generatedEnd);

  const [baseMonth, setBaseMonth] = useState(todayDate.getMonth());
  const [baseYear, setBaseYear] = useState(todayDate.getFullYear());
  const [numMonths, setNumMonths] = useState(1);
  const [groupMode, setGroupMode] = useState<GroupMode>('block-type');
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [extraPastMonths, setExtraPastMonths] = useState(0);

  // ── Semanas visibles ──
  const weeks = useMemo(() => {
    let startMonth = baseMonth - extraPastMonths;
    let startYear = baseYear;
    while (startMonth < 0) { startMonth += 12; startYear--; }
    return getWeeksForMonths(startYear, startMonth, numMonths + extraPastMonths, today, generatedEndStr);
  }, [baseYear, baseMonth, numMonths, extraPastMonths, today, generatedEndStr]);

  const weekKeys = useMemo(() => weeks.map(w => w.key), [weeks]);

  // ── Semanas agrupadas por mes para el header ──
  const weeksByMonth = useMemo(() => {
    const map: Record<string, WeekInfo[]> = {};
    weeks.forEach(w => {
      if (!map[w.monthLabel]) map[w.monthLabel] = [];
      map[w.monthLabel].push(w);
    });
    return Object.entries(map).map(([label, ws]) => ({ label, weeks: ws }));
  }, [weeks]);

  // ── Índice time_entries: `${taskId}__${weekKey}` → minutos ──
  const registeredByKey = useMemo(() => {
    const map: Record<string, number> = {};
    timeEntries.forEach(te => {
      const weekKey = getWeekKey(parseLocalISO(te.date));
      // Si hay subtaskId, sumar a la subtarea; si no, al taskId
      const targetId = te.subtaskId || te.taskId;
      const key = `${targetId}__${weekKey}`;
      map[key] = (map[key] || 0) + te.duration;
    });
    return map;
  }, [timeEntries]);

  // ── TaskLoads ──
  const taskLoads = useMemo(() =>
    buildTaskLoads(allTasksMap, weeks, registeredByKey),
    [allTasksMap, weeks, registeredByKey]
  );

  // ── Total por semana (solo hojas, sin doble conteo) ──
  const totalByWeek = useMemo(() => sumWeeks(taskLoads, weekKeys), [taskLoads, weekKeys]);

  // ── Agrupación ──
  const grouped = useMemo(() =>
    groupTaskLoads(taskLoads, groupMode, blocks, weekKeys),
    [taskLoads, groupMode, blocks, weekKeys]
  );

  // ── Handlers ──
  const toggleWeek = (key: string) => setExpandedWeeks(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
  });
  const toggleGroup = (key: string) => setExpandedGroups(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
  });
  const prevMonth = () => {
    setExtraPastMonths(0);
    if (baseMonth === 0) { setBaseMonth(11); setBaseYear(y => y - 1); }
    else setBaseMonth(m => m - 1);
  };
  const nextMonth = () => {
    setExtraPastMonths(0);
    if (baseMonth === 11) { setBaseMonth(0); setBaseYear(y => y + 1); }
    else setBaseMonth(m => m + 1);
  };

  const dayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  return (
    <div className="max-w-full space-y-5 pb-32">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-3xl font-black dark:text-white text-text-main-light">Carga de Trabajo</h2>
          <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-1">
            {weeks.length} semanas · {taskLoads.length} tareas
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle 1/2 meses */}
          <div className="flex rounded-xl overflow-hidden border dark:border-border-main border-border-main-light">
            {[1, 2].map(n => (
              <button key={n} onClick={() => setNumMonths(n)}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                  numMonths === n
                    ? 'bg-turquesa text-white'
                    : 'dark:bg-bg-card bg-white dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light'
                }`}
              >{n === 1 ? '1 mes' : '2 meses'}</button>
            ))}
          </div>

          {/* Agrupación */}
          <div className="flex rounded-xl overflow-hidden border dark:border-border-main border-border-main-light">
            {([
              { v: 'block' as GroupMode, icon: <Layers size={12} />, label: 'Bloque' },
              { v: 'type' as GroupMode, icon: <Tag size={12} />, label: 'Tipo' },
              { v: 'block-type' as GroupMode, icon: <Layers size={12} />, label: 'B→T' },
              { v: 'type-block' as GroupMode, icon: <Tag size={12} />, label: 'T→B' },
            ]).map(({ v, icon, label }) => (
              <button key={v} onClick={() => setGroupMode(v)}
                className={`flex items-center gap-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                  groupMode === v
                    ? 'bg-morado text-white'
                    : 'dark:bg-bg-card bg-white dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light'
                }`}
              >{icon}<span>{label}</span></button>
            ))}
          </div>

          {/* Navegación mes */}
          <div className="flex items-center gap-1">
            <button onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50 transition-all"
            ><ChevronLeft size={16} /></button>
            <span className="text-[11px] font-black dark:text-white text-text-main-light px-1 min-w-[80px] text-center">
              {getMonthLabel(baseYear, baseMonth)}
            </span>
            <button onClick={nextMonth}
              className="w-8 h-8 flex items-center justify-center dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50 transition-all"
            ><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse">
            <thead>
              {/* Fila meses */}
              <tr className="border-b dark:border-border-main border-border-main-light">
                <th className="text-left px-5 py-3 w-52 sticky left-0 dark:bg-bg-card bg-white z-10">
                  <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Tarea</span>
                </th>
                {weeksByMonth.map(({ label, weeks: mw }) => (
                  <th key={label} colSpan={mw.length}
                    className="text-center px-3 py-3 border-l dark:border-border-main/40 border-border-main-light/40"
                  >
                    <span className="text-[11px] font-black dark:text-white text-text-main-light uppercase tracking-widest">{label}</span>
                  </th>
                ))}
              </tr>

              {/* Fila semanas + totales */}
              <tr className="border-b-2 dark:border-border-main border-border-main-light">
                <th className="text-left px-5 py-2 sticky left-0 dark:bg-bg-card bg-white z-10">
                  <span className="text-[9px] dark:text-text-secondary text-text-secondary-light font-bold uppercase tracking-widest">Total</span>
                </th>
                {weeks.map((week, idx) => {
                  const total = totalByWeek[week.key] || 0;
                  const isFirst = idx === 0 || weeks[idx - 1].monthLabel !== week.monthLabel;
                  return (
                    <th key={week.key}
                      className={`text-center px-2 py-2 min-w-[72px] ${isFirst ? 'border-l dark:border-border-main/40 border-border-main-light/40' : ''}`}
                    >
                      <button
                        onClick={() => toggleWeek(week.key)}
                        className="flex flex-col items-center gap-0.5 w-full group"
                        title={`${week.startDate} → ${week.endDate}`}
                      >
                        <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light group-hover:dark:text-white transition-all">
                          {week.label}
                        </span>
                        <span className={`text-[11px] font-black ${getWeekColorText(total)}`}>
                          {total > 0 ? formatMinutes(total) : '—'}
                        </span>
                        {total > 0 && (
                          <div className="w-7 h-1 rounded-full opacity-50 transition-all"
                            style={{ backgroundColor: getWeekColorHex(total) }} />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>

              {/* Zoom días — cuando se expande una semana */}
              {weeks.some(w => expandedWeeks.has(w.key)) && (
                <tr className="border-b dark:border-border-main/30 border-border-main-light/30 dark:bg-bg-main/20 bg-gray-50/40">
                  <td className="px-5 py-1.5 sticky left-0 dark:bg-bg-main/20 bg-gray-50/40 z-10">
                    <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Días</span>
                  </td>
                  {weeks.map((week, idx) => {
                    const isFirst = idx === 0 || weeks[idx - 1].monthLabel !== week.monthLabel;
                    if (!expandedWeeks.has(week.key)) {
                      return <td key={week.key} className={isFirst ? 'border-l dark:border-border-main/40 border-border-main-light/40' : ''} />;
                    }
                    const days = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i));
                    return (
                      <td key={week.key}
                        className={`px-1 py-1.5 ${isFirst ? 'border-l dark:border-border-main/40 border-border-main-light/40' : ''}`}
                      >
                        <div className="flex gap-0.5 justify-center">
                          {days.map((day, di) => {
                            const isToday = day === today;
                            return (
                              <button key={day} onClick={() => onNavigateToDashboard(day)}
                                title={day}
                                className={`w-7 h-7 flex flex-col items-center justify-center rounded-lg transition-all text-[9px] font-black ${
                                  isToday
                                    ? 'bg-turquesa text-white'
                                    : 'dark:text-text-secondary text-text-secondary-light hover:bg-turquesa hover:text-white'
                                }`}
                              >
                                <span>{dayLabels[di]}</span>
                                <span className="text-[8px] opacity-60">{parseLocalISO(day).getDate()}</span>
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              )}
            </thead>

            <tbody>
              {grouped.length > 0 ? grouped.map(node => (
                <GroupRow
                  key={node.key}
                  node={node}
                  weeks={weeks}
                  depth={0}
                  expanded={expandedGroups}
                  onToggle={toggleGroup}
                />
              )) : (
                <tr>
                  <td colSpan={weeks.length + 1} className="text-center py-20">
                    <BarChart2 size={40} className="mx-auto mb-4 dark:text-text-secondary text-text-secondary-light opacity-10" />
                    <p className="text-sm font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest opacity-40">
                      Sin datos de carga
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Cargar más histórico ── */}
      <div className="flex justify-center">
        <button onClick={() => setExtraPastMonths(e => e + 3)}
          className="flex items-center gap-2 px-4 py-2 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50 hover:dark:text-white hover:text-text-main-light transition-all text-[11px] font-black uppercase tracking-widest"
        >
          <RotateCcw size={13} />
          Cargar 3 meses más atrás
        </button>
      </div>
    </div>
  );
}
