/**
 * WorkloadView.tsx - Vista de carga de trabajo semanal.
 *
 * TRES TRAMOS TEMPORALES:
 * ─ Pasado    → instancias Supabase (existsInSupabase) + time_entries reales
 * ─ Presente  → instancias generadas en memoria (allTasksMap, 12 meses)
 * ─ Futuro+12 → cálculo matemático desde templates
 */

import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, BarChart2, Layers, Tag, X } from 'lucide-react';
import { Task, WorkBlock, TimeEntry } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { formatMinutes } from './utils';

// ─── Colores ─────────────────────────────────────────────────────────────────

function getWeekColorHex(m: number): string {
  if (m === 0) return 'transparent';
  if (m < 900) return '#10B981';
  if (m < 1500) return '#F59E0B';
  if (m < 2100) return '#A855F7';
  return '#EC4899';
}
function getWeekColorText(m: number): string {
  if (m === 0) return 'dark:text-text-secondary/30 text-text-secondary-light/30';
  if (m < 900) return 'text-[#10B981]';
  if (m < 1500) return 'text-[#F59E0B]';
  if (m < 2100) return 'text-[#A855F7]';
  return 'text-[#EC4899]';
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

type GroupMode = 'block' | 'type' | 'block-type' | 'type-block';

interface WeekInfo {
  key: string; startDate: string; endDate: string;
  label: string; monthLabel: string;
  isPast: boolean; isGenerated: boolean;
}

interface TaskLoad {
  taskId: string; title: string; blockId: string;
  taskType: string; isContainer: boolean;
  weekMinutes: Record<string, number>;
  parentId?: string; // si es subtarea de un contenedor
}

interface GroupNode {
  key: string; label: string; color?: string;
  weekMinutes: Record<string, number>;
  children: GroupNode[]; isLeaf: boolean;
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
  return `${year}-${String(weekNum).padStart(2, '0')}`;
}

function getISOWeekNumber(monday: Date): number {
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

function getWeeksForMonths(
  baseYear: number, baseMonth: number,
  numMonths: number, today: string, generatedEndDate: string
): WeekInfo[] {
  const weeks: WeekInfo[] = [];
  const seen = new Set<string>();
  for (let m = 0; m < numMonths; m++) {
    let year = baseYear, month = baseMonth + m;
    while (month > 11) { month -= 12; year++; }
    const firstDay = new Date(year, month, 1);
    const monthEnd = formatLocalISO(new Date(year, month + 1, 0));
    let current = getMondayOfWeek(firstDay);
    while (formatLocalISO(current) <= monthEnd) {
      const key = getWeekKey(current);
      if (!seen.has(key)) {
        seen.add(key);
        const monday = formatLocalISO(current);
        const sunday = addDays(monday, 6);
        weeks.push({
          key, label: `W${getISOWeekNumber(current)}`,
          startDate: monday, endDate: sunday,
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

// ─── Cálculo recurrencia ──────────────────────────────────────────────────────

function countOccurrencesInWeek(recurrence: any, weekStart: string, weekEnd: string): number {
  if (!recurrence) return 0;
  let count = 0, current = weekStart;
  while (current <= weekEnd) {
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

// ─── Cálculo de carga ─────────────────────────────────────────────────────────

function calcLeafMinutes(
  task: Task, week: WeekInfo,
  allTasksMap: Record<string, Task>,
  registeredByKey: Record<string, number>
): number {
  if (week.isPast) return registeredByKey[`${task.id}__${week.key}`] || 0;
  if (week.isGenerated) {
    const instances = Object.values(allTasksMap).filter((t: any) =>
      t && t.templateId === task.id && !t.isDeleted &&
      t.dueDate >= week.startDate && t.dueDate <= week.endDate
    );
    if (instances.length > 0)
      return instances.reduce((acc, inst) => acc + ((inst as any).estimatedMinutes || (task as any).estimatedMinutes || 0), 0);
    if ((task as any).recurrence)
      return countOccurrencesInWeek((task as any).recurrence, week.startDate, week.endDate) * ((task as any).estimatedMinutes || 0);
    if ((task as any).dueDate && (task as any).dueDate >= week.startDate && (task as any).dueDate <= week.endDate)
      return (task as any).estimatedMinutes || 0;
    return 0;
  }
  if ((task as any).recurrence)
    return countOccurrencesInWeek((task as any).recurrence, week.startDate, week.endDate) * ((task as any).estimatedMinutes || 0);
  if ((task as any).dueDate && (task as any).dueDate >= week.startDate && (task as any).dueDate <= week.endDate)
    return (task as any).estimatedMinutes || 0;
  return 0;
}

function calcNodeMinutes(
  task: any, weeks: WeekInfo[],
  allTasksMap: Record<string, Task>,
  registeredByKey: Record<string, number>
): Record<string, number> {
  const wm: Record<string, number> = {};
  weeks.forEach(w => { wm[w.key] = 0; });
  if ((task.subtasks || []).length > 0 && task.isTemplate) {
    (task.subtasks || []).forEach((subId: string) => {
      const sub = allTasksMap[subId];
      if (!sub || (sub as any).isDeleted) return;
      weeks.forEach(week => { wm[week.key] += calcLeafMinutes(sub, week, allTasksMap, registeredByKey); });
    });
  } else {
    weeks.forEach(week => { wm[week.key] = calcLeafMinutes(task, week, allTasksMap, registeredByKey); });
  }
  return wm;
}

function buildTaskLoads(
  allTasksMap: Record<string, Task>,
  weeks: WeekInfo[],
  registeredByKey: Record<string, number>
): TaskLoad[] {
  const loads: TaskLoad[] = [];

  // Templates
  Object.values(allTasksMap).filter((t: any) =>
    t && t.isTemplate && !t.templateId && !t.isDeleted && !t.parentTaskId && t.isActive !== false
  ).forEach((t: any) => {
    const isContainer = (t.subtasks || []).length > 0;
    loads.push({
      taskId: t.id, title: t.title, blockId: t.blockId,
      taskType: t.taskType || 'core',
      isContainer,
      weekMinutes: calcNodeMinutes(t, weeks, allTasksMap, registeredByKey),
    });
    // Añadir subtareas como loads separados para poder mostrarlas expandidas
    if (isContainer) {
      (t.subtasks || []).forEach((subId: string) => {
        const sub = allTasksMap[subId] as any;
        if (!sub || sub.isDeleted) return;
        const subWm: Record<string, number> = {};
        weeks.forEach(w => { subWm[w.key] = 0; });
        weeks.forEach(week => { subWm[week.key] = calcLeafMinutes(sub, week, allTasksMap, registeredByKey); });
        loads.push({
          taskId: sub.id, title: sub.title, blockId: t.blockId,
          taskType: t.taskType || 'core',
          isContainer: false,
          weekMinutes: subWm,
          parentId: t.id,
        });
      });
    }
  });

  // Tareas puntuales
  Object.values(allTasksMap).filter((t: any) =>
    t && !t.isTemplate && !t.templateId && !t.isDeleted && !t.parentTaskId && t.dueDate
  ).forEach((t: any) => {
    const wm = calcNodeMinutes(t, weeks, allTasksMap, registeredByKey);
    const inRange = weeks.some(w => t.dueDate >= w.startDate && t.dueDate <= w.endDate);
    if (!Object.values(wm).some(m => m > 0) && !inRange) return;
    loads.push({ taskId: t.id, title: t.title, blockId: t.blockId, taskType: t.taskType || 'adhoc', isContainer: false, weekMinutes: wm });
  });

  // Instancias pasadas sin template
  Object.values(allTasksMap).filter((t: any) =>
    t && t.existsInSupabase && t.templateId && !t.isDeleted && !t.parentTaskId && !allTasksMap[t.templateId]
  ).forEach((t: any) => {
    const wm: Record<string, number> = {};
    weeks.forEach(w => { wm[w.key] = 0; });
    if (t.dueDate) {
      const week = weeks.find(w => t.dueDate >= w.startDate && t.dueDate <= w.endDate);
      if (week && week.isPast) wm[week.key] = registeredByKey[`${t.id}__${week.key}`] || 0;
    }
    loads.push({ taskId: t.id, title: t.title, blockId: t.blockId, taskType: t.taskType || 'adhoc', isContainer: false, weekMinutes: wm });
  });

  return loads;
}

// ─── Agrupación ───────────────────────────────────────────────────────────────

function sumWeeks(loads: TaskLoad[], wks: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  wks.forEach(k => { map[k] = 0; });
  // Solo sumar loads raíz (sin parentId) para evitar doble conteo
  loads.forEach(l => { if (!l.parentId) wks.forEach(k => { map[k] += l.weekMinutes[k] || 0; }); });
  return map;
}

function groupTaskLoads(loads: TaskLoad[], mode: GroupMode, blocks: WorkBlock[], wks: string[], allTasksMap: Record<string, Task>): GroupNode[] {
  const tLabel = (t: string) => t === 'core' ? 'Puesto (Core)' : 'Puntual (Ad-hoc)';
  const tColor = (t: string) => t === 'core' ? '#10B981' : '#F59E0B';

  // Solo agrupar loads raíz — las subtareas se muestran dentro de makeNode
  const rootLoads = loads.filter(l => !l.parentId);
  const makeNode = (l: TaskLoad): GroupNode => {
    if (!l.isContainer) return { key: l.taskId, label: l.title, weekMinutes: l.weekMinutes, children: [], isLeaf: true };
    // Contenedor: buscar sus subtareas en loads (tienen parentId === l.taskId)
    const subLoads = loads.filter(sl => sl.parentId === l.taskId);
    const children: GroupNode[] = subLoads.map(sl => ({
      key: `${l.taskId}__${sl.taskId}`,
      label: sl.title,
      weekMinutes: sl.weekMinutes,
      children: [],
      isLeaf: true,
    }));
    return { key: l.taskId, label: l.title, weekMinutes: l.weekMinutes, children, isLeaf: children.length === 0 };
  };

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
        weekMinutes: sumWeeks(all, wks), isLeaf: false,
        children: Array.from(tm.entries()).map(([type, items]) => ({
          key: `${bid}-${type}`, label: tLabel(type), color: tColor(type),
          weekMinutes: sumWeeks(items, wks), isLeaf: false,
          children: items.map(makeNode),
        }))
      };
    });
  }
  if (mode === 'type') {
    const map = new Map<string, TaskLoad[]>();
    rootLoads.forEach(l => { if (!map.has(l.taskType)) map.set(l.taskType, []); map.get(l.taskType)!.push(l); });
    return Array.from(map.entries()).map(([type, items]) => ({
      key: type, label: tLabel(type), color: tColor(type),
      weekMinutes: sumWeeks(items, wks), children: items.map(makeNode), isLeaf: false
    }));
  }
  if (mode === 'block-type') {
    const bMap2 = new Map<string, Map<string, TaskLoad[]>>();
    rootLoads.forEach(l => {
      if (!bMap2.has(l.blockId)) bMap2.set(l.blockId, new Map());
      const tm = bMap2.get(l.blockId)!;
      if (!tm.has(l.taskType)) tm.set(l.taskType, []);
      tm.get(l.taskType)!.push(l);
    });
    return Array.from(bMap2.entries()).map(([bid, tm]) => {
      const b = blocks.find(b => b.id === bid);
      const all = Array.from(tm.values()).flat();
      return {
        key: bid, label: `${b?.icon||''} ${b?.name||bid}`, color: b?.color,
        weekMinutes: sumWeeks(all, wks), isLeaf: false,
        children: Array.from(tm.entries()).map(([type, items]) => ({
          key: `${bid}-${type}`, label: tLabel(type), color: tColor(type),
          weekMinutes: sumWeeks(items, wks), children: items.map(makeNode), isLeaf: false,
        }))
      };
    });
  }
  // type-block
  const tMap = new Map<string, Map<string, TaskLoad[]>>();
  rootLoads.forEach(l => {
    if (!tMap.has(l.taskType)) tMap.set(l.taskType, new Map());
    const bm = tMap.get(l.taskType)!;
    if (!bm.has(l.blockId)) bm.set(l.blockId, []);
    bm.get(l.blockId)!.push(l);
  });
  return Array.from(tMap.entries()).map(([type, bm]) => {
    const all = Array.from(bm.values()).flat();
    return {
      key: type, label: tLabel(type), color: tColor(type),
      weekMinutes: sumWeeks(all, wks), isLeaf: false,
      children: Array.from(bm.entries()).map(([bid, items]) => {
        const b = blocks.find(b => b.id === bid);
        return { key: `${type}-${bid}`, label: `${b?.icon||''} ${b?.name||bid}`, color: b?.color, weekMinutes: sumWeeks(items, wks), children: items.map(makeNode), isLeaf: false };
      })
    };
  });
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

// ─── GroupRow ─────────────────────────────────────────────────────────────────

function GroupRow({ node, weeks, depth, expanded, onToggle }: {
  node: GroupNode; weeks: WeekInfo[]; depth: number;
  expanded: Set<string>; onToggle: (key: string) => void;
}) {
  const isOpen = expanded.has(node.key);
  const pl = depth === 0 ? 'pl-5' : depth === 1 ? 'pl-9' : 'pl-14';
  const bg = depth === 0 ? 'dark:bg-white/[0.03] bg-gray-50/60' : depth === 1 ? '' : 'dark:bg-black/10';
  const txt = depth === 0 ? 'text-[11px] dark:text-white text-text-main-light font-black'
    : depth === 1 ? 'text-[10px] dark:text-text-secondary text-text-secondary-light font-bold'
    : 'text-[10px] dark:text-text-secondary/70 text-text-secondary-light/70 font-medium';
  return (
    <>
      <tr className={`border-b dark:border-border-main/20 border-border-main-light/20 ${bg} ${!node.isLeaf ? 'cursor-pointer hover:dark:bg-white/5 hover:bg-black/[0.03] transition-all' : ''}`}
        onClick={!node.isLeaf ? () => onToggle(node.key) : undefined}
      >
        <td className={`${pl} pr-3 py-2.5 max-w-[220px]`}>
          <div className="flex items-center gap-2 min-w-0">
            {node.color && !node.isLeaf && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: node.color }} />}
            <span className={`${txt} truncate`}>{node.label}</span>
            {!node.isLeaf && (isOpen
              ? <ChevronUp size={10} className="shrink-0 dark:text-text-secondary/50 text-text-secondary-light/50" />
              : <ChevronDown size={10} className="shrink-0 dark:text-text-secondary/50 text-text-secondary-light/50" />
            )}
          </div>
        </td>
        {weeks.map((week, idx) => {
          const mins = node.weekMinutes[week.key] || 0;
          const isFirst = idx === 0 || weeks[idx - 1].monthLabel !== week.monthLabel;
          return (
            <td key={week.key} className={`text-center px-2 py-2.5 min-w-[72px] ${isFirst ? 'border-l dark:border-border-main/40 border-border-main-light/40' : ''}`}>
              {mins > 0 ? (
                <div className="flex flex-col items-center gap-0.5">
                  <span className={`text-[11px] font-black ${getWeekColorText(mins)}`}>{formatMinutes(mins)}</span>
                  {!node.isLeaf && <div className="w-6 h-0.5 rounded-full opacity-60" style={{ backgroundColor: getWeekColorHex(mins) }} />}
                </div>
              ) : (
                <span className="text-[10px] dark:text-text-secondary/20 text-text-secondary-light/20">—</span>
              )}
            </td>
          );
        })}
      </tr>
      {!node.isLeaf && isOpen && node.children.map(child => (
        <GroupRow key={child.key} node={child} weeks={weeks} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
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
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set()); // meses expandidos → muestran semanas
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [filterBlocks, setFilterBlocks] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);

  const weeks = useMemo(() =>
    getWeeksForMonths(todayDate.getFullYear(), todayDate.getMonth(), 7, today, generatedEndStr),
    [today, generatedEndStr]
  );
  const weekKeys = useMemo(() => weeks.map(w => w.key), [weeks]);

  const weeksByMonth = useMemo(() => {
    const map: Record<string, WeekInfo[]> = {};
    weeks.forEach(w => { if (!map[w.monthLabel]) map[w.monthLabel] = []; map[w.monthLabel].push(w); });
    return Object.entries(map).map(([label, ws]) => ({ label, weeks: ws }));
  }, [weeks]);

  const registeredByKey = useMemo(() => {
    const map: Record<string, number> = {};
    timeEntries.forEach(te => {
      const key = `${te.subtaskId || te.taskId}__${getWeekKey(parseLocalISO(te.date))}`;
      map[key] = (map[key] || 0) + te.duration;
    });
    return map;
  }, [timeEntries]);

  const registeredByDay = useMemo(() => {
    const map: Record<string, number> = {};
    timeEntries.forEach(te => {
      const key = `${te.subtaskId || te.taskId}__${te.date}`;
      map[key] = (map[key] || 0) + te.duration;
    });
    return map;
  }, [timeEntries]);

  const allLoads = useMemo(() => buildTaskLoads(allTasksMap, weeks, registeredByKey), [allTasksMap, weeks, registeredByKey]);

  const taskLoads = useMemo(() => allLoads.filter(l => {
    if (filterBlocks.length > 0 && !filterBlocks.includes(l.blockId)) return false;
    if (filterTypes.length > 0 && !filterTypes.includes(l.taskType)) return false;
    return true;
  }), [allLoads, filterBlocks, filterTypes]);

  const totalByWeek = useMemo(() => sumWeeks(taskLoads, weekKeys), [taskLoads, weekKeys]);
  const grouped = useMemo(() => groupTaskLoads(taskLoads, groupMode, blocks, weekKeys, allTasksMap), [taskLoads, groupMode, blocks, weekKeys, allTasksMap]);

  const toggleWeek = (key: string) => setExpandedWeeks(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleMonth = (label: string) => setExpandedMonths(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });
  const toggleGroup = (key: string) => setExpandedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleFilter = (arr: string[], setArr: (v: string[]) => void, v: string) =>
    setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  // Carga total por mes
  const totalByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    weeksByMonth.forEach(({ label, weeks: mw }) => {
      map[label] = mw.reduce((acc, w) => acc + (totalByWeek[w.key] || 0), 0);
    });
    return map;
  }, [weeksByMonth, totalByWeek]);

  const getDayLoad = (dateStr: string): number => {
    const week = weeks.find(w => dateStr >= w.startDate && dateStr <= w.endDate);
    if (!week) return 0;
    let total = 0;
    taskLoads.forEach(load => {
      if (load.isContainer) return;
      if (week.isPast) {
        total += registeredByDay[`${load.taskId}__${dateStr}`] || 0;
      } else {
        const task = allTasksMap[load.taskId] as any;
        if (!task) return;
        if (task.recurrence) {
          total += countOccurrencesInWeek(task.recurrence, dateStr, dateStr) * (task.estimatedMinutes || 0);
        } else if (task.dueDate === dateStr) {
          total += task.estimatedMinutes || 0;
        }
      }
    });
    return total;
  };

  const blockOptions = blocks.map(b => ({ value: b.id, label: `${b.icon} ${b.name}`, color: b.color }));
  const typeOptions = [{ value: 'core', label: 'Puesto (Core)' }, { value: 'adhoc', label: 'Puntual (Ad-hoc)' }];
  const dayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  return (
    <div className="max-w-full space-y-4 pb-32">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-3xl font-black dark:text-white text-text-main-light">Carga de Trabajo</h2>
          <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-1">{taskLoads.length} tareas · {weeks.length} semanas</p>
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

      {/* Vista por meses */}
      <div className="space-y-2">
        {weeksByMonth.map(({ label: monthLabel, weeks: monthWeeks }) => {
          const monthTotal = totalByMonth[monthLabel] || 0;
          const isMonthOpen = expandedMonths.has(monthLabel);

          return (
            <div key={monthLabel} className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] overflow-hidden shadow-xl">
              {/* Header mes */}
              <button
                onClick={() => toggleMonth(monthLabel)}
                className="w-full flex items-center justify-between px-6 py-4 hover:dark:bg-white/[0.02] hover:bg-gray-50/50 transition-all"
              >
                <div className="flex items-center gap-4">
                  <span className="text-base font-black dark:text-white text-text-main-light uppercase tracking-wider">{monthLabel}</span>
                  {monthTotal > 0 && (
                    <span className={`text-sm font-black ${getWeekColorText(monthTotal / 4)}`}>
                      {formatMinutes(monthTotal)}
                    </span>
                  )}
                  {monthTotal > 0 && (
                    <div className="w-24 h-1.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
                      <div className="h-full rounded-full" style={{ backgroundColor: getWeekColorHex(monthTotal / 4), width: `${Math.min(100, (monthTotal / 4) / 21 * 100)}%` }} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] dark:text-text-secondary text-text-secondary-light font-bold">
                    {monthWeeks.length} semanas
                  </span>
                  {isMonthOpen
                    ? <ChevronUp size={16} className="dark:text-text-secondary text-text-secondary-light" />
                    : <ChevronDown size={16} className="dark:text-text-secondary text-text-secondary-light" />
                  }
                </div>
              </button>

              {/* Tabla semanas del mes */}
              {isMonthOpen && (
                <div className="border-t dark:border-border-main border-border-main-light overflow-x-auto">
                  <table className="w-full min-w-max border-collapse">
                    <thead>
                      {/* Semanas + totales */}
                      <tr className="border-b dark:border-border-main/50 border-border-main-light/50">
                        <th className="text-left px-5 py-2 w-52 sticky left-0 dark:bg-bg-card bg-white z-10">
                          <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Tarea</span>
                        </th>
                        {monthWeeks.map(week => {
                          const total = totalByWeek[week.key] || 0;
                          const isExp = expandedWeeks.has(week.key);
                          return (
                            <th key={week.key} className={`text-center px-2 py-2 min-w-[80px] ${week.isPast ? 'dark:bg-bg-main/20 bg-gray-50/40' : ''}`}>
                              <button onClick={() => toggleWeek(week.key)} className="flex flex-col items-center gap-0.5 w-full group" title={`${week.startDate} → ${week.endDate}`}>
                                <span className={`text-[10px] font-black transition-all ${isExp ? 'text-turquesa' : 'dark:text-text-secondary text-text-secondary-light group-hover:dark:text-white'}`}>{week.label}</span>
                                <span className={`text-[11px] font-black ${getWeekColorText(total)}`}>{total > 0 ? formatMinutes(total) : '—'}</span>
                                {total > 0 && <div className="w-7 h-1 rounded-full opacity-50" style={{ backgroundColor: getWeekColorHex(total) }} />}
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                      {/* Zoom días */}
                      {monthWeeks.some(w => expandedWeeks.has(w.key)) && (
                        <tr className="border-b dark:border-border-main/30 border-border-main-light/30 dark:bg-bg-main/30 bg-gray-50/50">
                          <td className="px-5 py-2 sticky left-0 dark:bg-bg-main/30 bg-gray-50/50 z-10">
                            <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Días</span>
                          </td>
                          {monthWeeks.map(week => {
                            if (!expandedWeeks.has(week.key)) return <td key={week.key} />;
                            const days = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i));
                            return (
                              <td key={week.key} className="px-1 py-2">
                                <div className="flex gap-1 justify-center">
                                  {days.map((day, di) => {
                                    const isToday = day === today;
                                    const dayLoad = getDayLoad(day);
                                    return (
                                      <button key={day} onClick={() => onNavigateToDashboard(day)} title={day}
                                        className={`flex flex-col items-center justify-center rounded-xl px-1 py-1.5 min-w-[36px] transition-all hover:bg-turquesa/10 ${isToday ? 'ring-2 ring-turquesa' : ''}`}
                                      >
                                        <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light">{dayLabels[di]}</span>
                                        <span className="text-[9px] dark:text-text-secondary/60 text-text-secondary-light/60">{parseLocalISO(day).getDate()}</span>
                                        {dayLoad > 0
                                          ? <span className={`text-[9px] font-black mt-0.5 ${getWeekColorText(dayLoad * 5)}`}>{formatMinutes(dayLoad)}</span>
                                          : <span className="text-[8px] dark:text-text-secondary/20 text-text-secondary-light/20 mt-0.5">—</span>
                                        }
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
                        <GroupRow key={node.key} node={node} weeks={monthWeeks} depth={0} expanded={expandedGroups} onToggle={toggleGroup} />
                      )) : (
                        <tr>
                          <td colSpan={monthWeeks.length + 1} className="text-center py-10">
                            <p className="text-sm dark:text-text-secondary text-text-secondary-light opacity-30">Sin tareas</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
