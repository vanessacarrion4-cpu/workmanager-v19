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
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Layers, Tag, X } from 'lucide-react';
import { Task, WorkBlock, TimeEntry } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { formatMinutes } from './utils';
import { occursOn } from './instanceEngine';
import { useJornada } from './useJornada';

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

function getISOWeekNum(monday: Date): number {
  const jan4 = new Date(monday.getFullYear(), 0, 4);
  const startW1 = getMondayOfWeek(jan4);
  return Math.round((monday.getTime() - startW1.getTime()) / (7 * 86400000)) + 1;
}

function getWeekKey(date: Date): string {
  const monday = getMondayOfWeek(date);
  const isoNum = getISOWeekNum(monday);
  let year = monday.getFullYear();
  if (isoNum === 1 && monday.getMonth() === 11) year += 1;
  if (isoNum >= 52 && monday.getMonth() === 0) year -= 1;
  return `${year}-W${String(isoNum).padStart(2, '0')}`;
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

function buildMonths(baseYear: number, baseMonth: number, numMonths: number, today: string, generatedEndStr: string, jornadaMins: number = MINS_PER_DAY): MonthInfo[] {
  const months: MonthInfo[] = [];

  for (let m = 0; m < numMonths; m++) {
    let year = baseYear, month = baseMonth + m;
    while (month > 11) { month -= 12; year++ }

    const firstDay = formatLocalISO(new Date(year, month, 1));
    const lastDay = formatLocalISO(new Date(year, month + 1, 0));

    // Semanas: incluir la semana del primer día del mes aunque el lunes esté en el mes anterior
    const weeks: WeekInfo[] = [];
    const seen = new Set<string>();
    // Empezar desde el lunes de la semana que contiene el día 1 del mes
    let current = new Date(year, month, 1);
    const firstDow = current.getDay();
    // Retroceder al lunes de esa semana
    const backDays = firstDow === 0 ? 6 : firstDow - 1;
    current.setDate(current.getDate() - backDays);

    while (formatLocalISO(current) <= lastDay) {
      const key = getWeekKey(current);
      if (!seen.has(key)) {
        seen.add(key);
        const monday = formatLocalISO(current);
        const sunday = addDays(monday, 6);
        // Capacidad cuenta TODOS los días laborables de la semana (no solo los del mes)
        let wd = 0;
        let d = monday;
        while (d <= sunday) {
          const dow = parseLocalISO(d).getDay();
          if (dow !== 0 && dow !== 6) wd++;
          d = addDays(d, 1);
        }
        weeks.push({
          key,
          label: `W${getISOWeekNum(current)}`,
          startDate: monday,
          endDate: sunday,
          capacityMins: wd * jornadaMins,
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
      capacityMins: wd * jornadaMins,
    });
  }
  return months;
}

// ─── Días de una semana ───────────────────────────────────────────────────────

function buildDays(week: WeekInfo, today: string, jornadaMins: number = MINS_PER_DAY): DayInfo[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(week.startDate, i);
    const dow = parseLocalISO(date).getDay();
    const isWorkday = dow !== 0 && dow !== 6;
    return {
      date,
      label: `${DAY_LABELS[dow]} ${parseLocalISO(date).getDate()}`,
      isWorkday,
      isToday: date === today,
      capacityMins: isWorkday ? jornadaMins : 0,
    };
  });
}

// ─── Cálculo recurrencia ──────────────────────────────────────────────────────

function countOccurrencesInRange(recurrence: any, startStr: string, endStr: string): number {
  if (!recurrence) return 0;
  // Fuente única de verdad: se delega la regla de recurrencia en occursOn.
  // Se conservan el corte por endDate y el salto anual como optimizaciones del bucle.
  const recurringTask = { recurrence } as Task;
  let count = 0, current = startStr;
  while (current <= endStr) {
    if (current < (recurrence.startDate || '')) { current = addDays(current, 1); continue; }
    if (recurrence.endDate && current > recurrence.endDate) break;
    const matches = occursOn(recurringTask, current);
    if (matches) count++;
    // Optimización: para yearly saltar al año siguiente tras encontrar la fecha
    if (recurrence.frequency === 'yearly' && matches) {
      const date = parseLocalISO(current);
      const next = new Date(date.getFullYear() + 1, date.getMonth(), date.getDate());
      current = formatLocalISO(next);
    } else {
      current = addDays(current, 1);
    }
  }
  return count;
}

// ─── Calcular minutos de una tarea hoja en un rango ──────────────────────────

function calcRangeMinutes(
  task: any, startStr: string, endStr: string,
  isPast: boolean,
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

/**
 * Resuelve el blockId de una tarea subiendo por la jerarquía si es necesario.
 * Una subtarea hereda el blockId de su contenedor padre.
 */
function resolveBlockId(task: any, allTasksMap: Record<string, Task>): string | null {
  if (task.blockId) return task.blockId;
  if (task.parentTaskId) {
    const parent = allTasksMap[task.parentTaskId];
    if (parent) return resolveBlockId(parent, allTasksMap);
  }
  return null;
}

function buildTaskLoads(
  allTasksMap: Record<string, Task>,
  months: MonthInfo[],
  registeredByDay: Record<string, number>,
  generatedEndStr: string,
  today: string,
  timeEntries: any[]
): TaskLoad[] {
  const loads: TaskLoad[] = [];
  const allWeeks = months.flatMap(m => m.weeks);

  // ── PASADO: construir desde time_entries directamente ──────────────────────
  // Para cada time_entry, resolver a qué bloque pertenece y acumular por bloque/semana/mes
  // Esto captura CUALQUIER registro de tiempo sin importar si la tarea tiene dueDate o no

  const pastBlockLoads: Record<string, { monthMinutes: Record<string, number>; weekMinutes: Record<string, number> }> = {};

  timeEntries.forEach((te: any) => {
    if (!te.date || te.date >= today) return; // solo pasado

    // Resolver la tarea: puede ser subtaskId o taskId
    const taskId = te.subtaskId || te.taskId;
    const task = allTasksMap[taskId];
    if (!task) return;

    const blockId = resolveBlockId(task, allTasksMap);
    if (!blockId) return;

    const duration = te.duration || 0;
    if (duration === 0) return;

    if (!pastBlockLoads[blockId]) {
      pastBlockLoads[blockId] = { monthMinutes: {}, weekMinutes: {} };
    }

    // Asignar al mes correspondiente
    const monthKey = te.date.substring(0, 7); // 'YYYY-MM'
    const moMatch = months.find(m => m.key === monthKey);
    if (moMatch) {
      pastBlockLoads[blockId].monthMinutes[moMatch.key] = (pastBlockLoads[blockId].monthMinutes[moMatch.key] || 0) + duration;
    }

    // Asignar a la semana correspondiente
    const teDate = parseLocalISO(te.date);
    const weekKey = getWeekKey(teDate);
    const wkMatch = allWeeks.find(w => w.key === weekKey);
    if (wkMatch) {
      pastBlockLoads[blockId].weekMinutes[wkMatch.key] = (pastBlockLoads[blockId].weekMinutes[wkMatch.key] || 0) + duration;
    }
  });

  // Crear TaskLoad entries para bloques con datos pasados
  // Estos son nodos especiales de solo-pasado que se mezclarán con los futuros
  const pastLoadsByBlock: Record<string, TaskLoad> = {};
  Object.entries(pastBlockLoads).forEach(([blockId, data]) => {
    pastLoadsByBlock[blockId] = {
      taskId: `__past__${blockId}`,
      title: '__past__',
      blockId,
      taskType: 'adhoc', // #6: tiempo pasado registrado sin clasificar → adhoc (regla única sin tipo = adhoc)
      isContainer: false,
      monthMinutes: data.monthMinutes,
      weekMinutes: data.weekMinutes,
      dayMinutes: {},
    };
  });

  // ── FUTURO/PRESENTE: calcular desde tareas con recurrencia o dueDate ───────
  const calcLoad = (task: any, startStr: string, endStr: string, isPast: boolean) =>
    calcRangeMinutes(task, startStr, endStr, isPast, allTasksMap, registeredByDay);

  const processTask = (task: any, parentId?: string) => {
    const isContainer = (task.subtasks || []).length > 0 && task.isTemplate;

    const monthMinutes: Record<string, number> = {};
    const weekMinutes: Record<string, number> = {};

    if (isContainer) {
      const subs = (task.subtasks || []).map((sid: string) => allTasksMap[sid]).filter((s: any) => {
        if (!s || s.isDeleted) return false;
        // Sin recurrencia y con fecha pasada → no tiene carga futura
        if (!s.recurrence && s.dueDate && s.dueDate < today) return false;
        // Completada sin recurrencia y sin fecha → ya hecha
        if (s.status === 'completed' && !s.recurrence && !s.dueDate) return false;
        return true;
      });
      months.forEach(mo => {
        const firstDay = formatLocalISO(new Date(mo.year, mo.month, 1));
        const lastDay = formatLocalISO(new Date(mo.year, mo.month + 1, 0));
        const isPast = lastDay < today;
        // Para meses pasados, los datos vienen de pastBlockLoads — no duplicar
        if (isPast) { monthMinutes[mo.key] = 0; return; }
        monthMinutes[mo.key] = subs.reduce((acc: number, sub: any) =>
          acc + calcLoad(sub, firstDay, lastDay, isPast), 0);
      });
      allWeeks.forEach(week => {
        if (week.isPast) { weekMinutes[week.key] = 0; return; }
        weekMinutes[week.key] = subs.reduce((acc: number, sub: any) =>
          acc + calcLoad(sub, week.startDate, week.endDate, week.isPast), 0);
      });
    } else {
      months.forEach(mo => {
        const firstDay = formatLocalISO(new Date(mo.year, mo.month, 1));
        const lastDay = formatLocalISO(new Date(mo.year, mo.month + 1, 0));
        const isPast = lastDay < today;
        if (isPast) { monthMinutes[mo.key] = 0; return; }
        monthMinutes[mo.key] = calcLoad(task, firstDay, lastDay, isPast);
      });
      allWeeks.forEach(week => {
        if (week.isPast) { weekMinutes[week.key] = 0; return; }
        weekMinutes[week.key] = calcLoad(task, week.startDate, week.endDate, week.isPast);
      });
    }

    // Tarea hoja sin recurrencia: solo aparece si su fecha cae en el rango visible
    if (!isContainer && !task.recurrence && task.dueDate) {
      const inRange = months.some(mo => {
        const firstDay = formatLocalISO(new Date(mo.year, mo.month, 1));
        const lastDay = formatLocalISO(new Date(mo.year, mo.month + 1, 0));
        return task.dueDate >= firstDay && task.dueDate <= lastDay;
      });
      if (!inRange) return;
    }

    loads.push({
      // Fix (#3 barrido): la hoja/subtarea hereda bloque del padre y suele tener blockId undefined → resolver como en el pasado
      // (resolveBlockId). Antes con el filtro por Bloque activo las hijas (blockId undefined) se descartaban y el contenedor
      // perdía su detalle diario.
      taskId: task.id, title: task.title, blockId: resolveBlockId(task, allTasksMap) || task.blockId,
      taskType: task.taskType || 'adhoc', isContainer, parentId,
      monthMinutes, weekMinutes,
      dayMinutes: {},
    });

    if (isContainer) {
      (task.subtasks || []).forEach((subId: string) => {
        const sub = allTasksMap[subId] as any;
        if (!sub || sub.isDeleted) return;
        // Sin recurrencia y con fecha pasada → no tiene carga futura
        if (!sub.recurrence && sub.dueDate && sub.dueDate < today) return;
        // Sin recurrencia y completada → ya hecha
        if (sub.status === 'completed' && !sub.recurrence) return;
        // Sin recurrencia → verificar si tiene alguna excepción futura o fecha futura
        if (!sub.recurrence) {
          const hasFutureLoad = (sub.dueDate && sub.dueDate >= today) ||
            Object.values(allTasksMap).some((t: any) =>
              t && t.templateId === sub.id && !t.isDeleted && t.dueDate && t.dueDate >= today
            );
          if (!hasFutureLoad) return;
        }
        processTask(sub, task.id);
      });
    }
  };

  Object.values(allTasksMap).filter((t: any) =>
    t && t.isTemplate && !t.templateId && !t.isDeleted && !t.parentTaskId && t.isActive !== false
  ).forEach((t: any) => processTask(t));

  Object.values(allTasksMap).filter((t: any) =>
    t && !t.isTemplate && !t.templateId && !t.isDeleted && !t.parentTaskId && t.dueDate &&
    !(!t.recurrence && t.dueDate < today)
  ).forEach((t: any) => {
    const inRange = months.some(mo => {
      const firstDay = formatLocalISO(new Date(mo.year, mo.month, 1));
      const lastDay = formatLocalISO(new Date(mo.year, mo.month + 1, 0));
      return t.dueDate >= firstDay && t.dueDate <= lastDay;
    });
    if (!inRange) return;
    processTask(t);
  });

  // Añadir pastLoads como entradas independientes — sumField los acumula por bloque
  // NO fusionar con loads existentes para evitar multiplicación por número de tareas
  Object.values(pastLoadsByBlock).forEach(pastLoad => {
    loads.push(pastLoad);
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

  const rootLoads = loads.filter(l => !l.parentId && !l.taskId.startsWith('__past__'));
  const pastLoads = loads.filter(l => l.taskId.startsWith('__past__'));

  if (mode === 'block') {
    const bMap = new Map<string, Map<string, TaskLoad[]>>();
    rootLoads.forEach(l => {
      if (!bMap.has(l.blockId)) bMap.set(l.blockId, new Map());
      const tm = bMap.get(l.blockId)!;
      if (!tm.has(l.taskType)) tm.set(l.taskType, []);
      tm.get(l.taskType)!.push(l);
    });
    // Bloques con solo datos pasados tambien deben aparecer
    pastLoads.forEach(l => {
      if (!bMap.has(l.blockId)) bMap.set(l.blockId, new Map());
    });
    return Array.from(bMap.entries()).map(([bid, tm]) => {
      const b = blocks.find(b => b.id === bid);
      const all = Array.from(tm.values()).flat();
      const pastForBlock = pastLoads.filter(p => p.blockId === bid);
      // Sumar minutos pasados al bloque
      const blockMonthMins = sumField(all, 'monthMinutes', monthKeys);
      const blockWeekMins = sumField(all, 'weekMinutes', weekKeys);
      const blockDayMins = sumField(all, 'dayMinutes', dayKeys);
      pastForBlock.forEach(p => {
        monthKeys.forEach(k => { blockMonthMins[k] = (blockMonthMins[k] || 0) + (p.monthMinutes[k] || 0); });
        weekKeys.forEach(k => { blockWeekMins[k] = (blockWeekMins[k] || 0) + (p.weekMinutes[k] || 0); });
      });
      const tmEntries = Array.from(tm.entries());
      return {
        key: bid, label: `${b?.icon||''} ${b?.name||bid}`, color: b?.color,
        monthMinutes: blockMonthMins,
        weekMinutes: blockWeekMins,
        dayMinutes: blockDayMins,
        isLeaf: false,
        children: tmEntries.map(([type, items], tidx) => {
          const typeMonthMins = sumField(items, 'monthMinutes', monthKeys);
          const typeWeekMins = sumField(items, 'weekMinutes', weekKeys);
          const typeDayMins = sumField(items, 'dayMinutes', dayKeys);
          // Agregar minutos pasados al primer grupo de tipo
          if (tidx === 0) {
            pastForBlock.forEach(p => {
              monthKeys.forEach(k => { typeMonthMins[k] = (typeMonthMins[k] || 0) + (p.monthMinutes[k] || 0); });
              weekKeys.forEach(k => { typeWeekMins[k] = (typeWeekMins[k] || 0) + (p.weekMinutes[k] || 0); });
            });
          }
          return {
            key: `${bid}-${type}`, label: tLabel(type), color: tColor(type),
            monthMinutes: typeMonthMins,
            weekMinutes: typeWeekMins,
            dayMinutes: typeDayMins,
            isLeaf: false,
            children: items.filter(i => !i.taskId.startsWith('__past__')).map(makeLeafNode),
          };
        }),
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
    children: items.filter(i => !i.taskId.startsWith('__past__')).map(makeLeafNode),
  }));
}




// ─── ProgressCell ─────────────────────────────────────────────────────────────

function ProgressCell({ minutes, capacityMins, size = 'md' }: {
  minutes: number; capacityMins: number; size?: 'sm' | 'md' | 'lg';
}) {
  const pct = capacityMins > 0 ? Math.round((minutes / capacityMins) * 100) : 0;
  const color = getPctColor(pct);
  const textClass = getPctTextClass(pct);
  const barPct = Math.min(100, pct);
  if (minutes === 0) return <span className="text-[10px] dark:text-text-secondary/20 text-text-secondary-light/20">—</span>;
  if (size === 'sm') return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className={`text-[10px] font-black ${textClass}`}>{pct}%</span>
        <span className="text-[9px] dark:text-text-secondary text-text-secondary-light">{formatMinutes(minutes)}</span>
      </div>
      <div className="w-full h-0.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
  if (size === 'lg') return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className={`text-[20px] font-black leading-none ${textClass}`}>{pct}%</span>
        <span className={`text-[13px] font-bold ${textClass}`}>{formatMinutes(minutes)}</span>
      </div>
      <div className="w-full h-2 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className={`text-[12px] font-black ${textClass}`}>{pct}%</span>
        <span className={`text-[11px] font-bold ${textClass}`}>{formatMinutes(minutes)}</span>
      </div>
      <div className="w-full h-1 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
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
  const jornada = useJornada(); // #5 barrido: capacidad = jornada configurable (como Semana/Calendario), no 480 fijo
  const todayDate = new Date();
  const today = formatLocalISO(todayDate);
  const generatedEnd = new Date(todayDate);
  generatedEnd.setDate(generatedEnd.getDate() + 365);
  const generatedEndStr = formatLocalISO(generatedEnd);

  const [groupMode, setGroupMode] = useState<GroupMode>('block');
  const [baseOffset, setBaseOffset] = useState(0); // meses desde hoy
  // Por defecto todo contraído
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [filterBlocks, setFilterBlocks] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [showDetalle, setShowDetalle] = useState(false); // §16.55 Carga liviana: la tabla mes/semana/día/tarea queda plegada

  const months = useMemo(() => {
    const base = new Date(todayDate.getFullYear(), todayDate.getMonth() + baseOffset, 1);
    return buildMonths(base.getFullYear(), base.getMonth(), 7, today, generatedEndStr, jornada);
  }, [today, generatedEndStr, baseOffset, jornada]);

  const registeredByDay = useMemo(() => {
    const map: Record<string, number> = {};
    timeEntries.forEach(te => {
      const key = `${te.subtaskId || te.taskId}__${te.date}`;
      map[key] = (map[key] || 0) + te.duration;
    });
    return map;
  }, [timeEntries]);

  const allLoads = useMemo(() =>
    buildTaskLoads(allTasksMap, months, registeredByDay, generatedEndStr, today, timeEntries),
    [allTasksMap, months, registeredByDay, generatedEndStr, today, timeEntries]
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

  // §16.55 Carga liviana — TIRA DE SEMANAS: cada semana una barra (carga/capacidad), meses como separadores. La semana de
  // FRONTERA (aparece en dos meses) se deduplica por `key` → ya no se expande/pinta dos veces. Real (≤hoy, time_entries) vs
  // proyectado (>hoy, rutinas) se distingue en el render. `totalWeekMins` ya integra pasado-registrado + futuro-proyectado.
  const weekStrip = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string; startDate: string; endDate: string; monthKey: string; monthLabel: string; load: number; cap: number; pct: number; isCurrent: boolean; isProjected: boolean }[] = [];
    months.forEach(mo => mo.weeks.forEach(w => {
      if (seen.has(w.key)) return;
      seen.add(w.key);
      const load = totalWeekMins[w.key] || 0;
      const cap = w.capacityMins || 1;
      out.push({
        key: w.key, label: w.label, startDate: w.startDate, endDate: w.endDate,
        monthKey: mo.key, monthLabel: mo.label, load, cap, pct: Math.round((load / cap) * 100),
        isCurrent: w.startDate <= today && today <= w.endDate,
        isProjected: w.startDate > today,
      });
    }));
    return out;
  }, [months, totalWeekMins, today]);

  const { dayLoadCache, totalDayMins } = useMemo(() => {
    const cache: Record<string, number> = {};
    const totals: Record<string, number> = {};
    if (expandedWeeks.size === 0) return { dayLoadCache: cache, totalDayMins: totals };
    const expandedWeekList = months.flatMap(m => m.weeks).filter(w => expandedWeeks.has(w.key));
    taskLoads.forEach(load => {
      expandedWeekList.forEach(week => {
        buildDays(week, today, jornada).forEach(day => {
          if (!day.isWorkday) return;
          const task = allTasksMap[load.taskId] as any;
          if (!task) return;
          let mins = 0;
          if (load.isContainer) {
            const subs = (task.subtasks || []).map((sid: string) => allTasksMap[sid]).filter((s: any) => s && !s.isDeleted);
            mins = subs.reduce((acc: number, sub: any) =>
              acc + calcRangeMinutes(sub, day.date, day.date, week.isPast, allTasksMap, registeredByDay), 0);
          } else {
            mins = calcRangeMinutes(task, day.date, day.date, week.isPast, allTasksMap, registeredByDay);
          }
          cache[`${load.taskId}__${day.date}`] = mins;
          if (!load.parentId) totals[day.date] = (totals[day.date] || 0) + mins;
        });
      });
    });
    return { dayLoadCache: cache, totalDayMins: totals };
  }, [taskLoads, expandedWeeks, allTasksMap, registeredByDay, months, today]);

  const toggleMonth = (key: string) => setExpandedMonths(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleWeek = (key: string) => setExpandedWeeks(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleGroup = (key: string) => setExpandedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleFilter = (arr: string[], setArr: (v: string[]) => void, v: string) =>
    setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const blockOptions = blocks.map(b => ({ value: b.id, label: `${b.icon} ${b.name}`, color: b.color }));
  const typeOptions = [{ value: 'core', label: 'Puesto (Core)' }, { value: 'adhoc', label: 'Puntual (Ad-hoc)' }];

  // Función para obtener minutos de un nodo para un día
  const getNodeDayMins = (node: GroupNode, date: string): number => {
    if (node.isLeaf) {
      const taskId = node.key.includes('__') ? node.key.split('__').pop()! : node.key;
      return dayLoadCache[`${taskId}__${date}`] || 0;
    }
    return node.children.reduce((acc, child) => acc + getNodeDayMins(child, date), 0);
  };

  return (
    <div className="max-w-full space-y-4 pb-32">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-3xl font-black dark:text-white text-text-main-light">Carga de Trabajo</h2>
          <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-1">
            {months.length > 0 ? `${months[0].label} – ${months[months.length - 1].label}` : '8h/día · 40h/semana'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Navegación meses */}
          <div className="flex items-center gap-1">
            <button onClick={() => setBaseOffset(v => v - 1)}
              className="w-8 h-8 flex items-center justify-center dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl hover:border-turquesa/50 transition-all dark:text-text-secondary text-text-secondary-light hover:text-turquesa">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => setBaseOffset(0)}
              className="px-3 h-8 text-[10px] font-black uppercase tracking-widest dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl hover:border-turquesa/50 transition-all dark:text-text-secondary text-text-secondary-light hover:text-turquesa">
              Hoy
            </button>
            <button onClick={() => setBaseOffset(v => v + 1)}
              className="w-8 h-8 flex items-center justify-center dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl hover:border-turquesa/50 transition-all dark:text-text-secondary text-text-secondary-light hover:text-turquesa">
              <ChevronRight size={16} />
            </button>
            {/* Label con picker nativo */}
            <div className="relative">
              <input
                type="date"
                value={(() => {
                  const base = new Date(todayDate.getFullYear(), todayDate.getMonth() + baseOffset, 1);
                  return formatLocalISO(base);
                })()}
                onChange={e => {
                  if (!e.target.value) return;
                  const d = new Date(e.target.value + 'T12:00:00');
                  const diff = (d.getFullYear() - todayDate.getFullYear()) * 12 + (d.getMonth() - todayDate.getMonth());
                  setBaseOffset(diff);
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <div className="h-8 px-3 flex items-center gap-2 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl pointer-events-none select-none">
                <span className="text-[11px] font-black dark:text-white text-text-main-light uppercase tracking-widest">
                  {months.length > 0 ? months[0].label : '—'}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="dark:text-text-secondary text-text-secondary-light shrink-0">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
            </div>
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
      </div>

      {/* §16.55 TIRA DE SEMANAS — el paisaje de 26 semanas para fasear tareas grandes por los valles */}
      <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] p-5 shadow-xl">
        <div className="flex items-end gap-4 overflow-x-auto pb-1">
          {(() => {
            const byMonth: Record<string, typeof weekStrip> = {};
            weekStrip.forEach(w => { (byMonth[w.monthKey] = byMonth[w.monthKey] || []).push(w); });
            return Object.entries(byMonth).map(([mk, weeks]) => (
              <div key={mk} className="flex flex-col gap-2 shrink-0">
                <div className="text-[9px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light text-center">{weeks[0].monthLabel.split(' ')[0]}</div>
                <div className="flex items-end gap-1.5">
                  {weeks.map(w => (
                    <button key={w.key} onClick={() => onNavigateToDashboard(w.startDate)}
                      title={`${w.startDate} – ${w.endDate} · ${formatMinutes(w.load)} de ${formatMinutes(w.cap)} (${w.pct}%)${w.isProjected ? ' · proyectado' : ''}`}
                      className="flex flex-col items-center gap-1 group">
                      <span className={`text-[8px] font-bold ${getPctTextClass(w.pct)}`}>{w.pct}%</span>
                      <div className={`w-6 h-24 rounded-md dark:bg-bg-main/40 bg-gray-100 flex items-end overflow-hidden relative ${w.isCurrent ? 'ring-2 ring-turquesa ring-offset-1 dark:ring-offset-bg-card' : ''} group-hover:brightness-110`}>
                        <div className="w-full rounded-md transition-all" style={{ height: `${Math.min(100, w.pct)}%`, backgroundColor: getPctColor(w.pct), opacity: w.isProjected ? 0.4 : 1 }} />
                      </div>
                      <span className={`text-[8px] font-bold ${w.isCurrent ? 'text-turquesa' : 'dark:text-text-secondary/50 text-text-secondary-light/50'}`}>{w.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ));
          })()}
        </div>
        <div className="flex items-center gap-4 mt-3 text-[9px] font-bold dark:text-text-secondary text-text-secondary-light">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-turquesa" /> Real (hasta hoy)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-turquesa opacity-40" /> Proyectado (rutinas)</span>
          <span className="ml-auto opacity-70">Clic en una semana → ir a ella</span>
        </div>
      </div>

      {/* Detalle avanzado (tabla mes/semana/día/tarea) — plegado por defecto */}
      <button onClick={() => setShowDetalle(v => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50 hover:text-turquesa transition-all text-[10px] font-black uppercase tracking-widest">
        <ChevronRight size={12} className={`transition-transform ${showDetalle ? 'rotate-90' : ''}`} /> {showDetalle ? 'Ocultar detalle' : 'Ver detalle (mes · semana · día · tarea)'}
      </button>

      {showDetalle && (<>
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

      {/* Tabla principal */}
      <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] overflow-hidden shadow-xl">
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '75vh' }}>
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-20">
              {/* FILA 1 — Meses */}
              <tr className="border-b dark:border-border-main border-border-main-light">
                <th className="sticky left-0 dark:bg-bg-card bg-white z-20 px-5 py-4 text-left min-w-[220px]" rowSpan={4}>
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
                      className={`border-l dark:border-border-main/50 border-border-main-light/50 px-4 py-4 min-w-[160px] text-left align-middle transition-all dark:bg-bg-card bg-white ${isExp ? 'dark:bg-turquesa/10 bg-turquesa/5' : ''}`}
                    >
                      <button onClick={() => toggleMonth(mo.key)} className="flex items-start gap-3 w-full group">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={`text-[12px] font-black uppercase tracking-wider transition-all ${isExp ? 'text-turquesa' : 'dark:text-white text-text-main-light group-hover:text-turquesa'}`}>{mo.label}</span>
                            {total > 0 && <span className={`text-[13px] font-black ${getPctTextClass(pct)}`}>{formatMinutes(total)}</span>}
                            {total > 0 && <span className={`text-[10px] font-bold dark:text-text-secondary text-text-secondary-light`}>{pct}%</span>}
                          </div>
                          {total > 0 && (
                            <div className="w-full h-1.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: getPctColor(pct) }} />
                            </div>
                          )}
                        </div>
                        <ChevronDown size={14} className={`shrink-0 mt-0.5 transition-transform ${isExp ? 'rotate-180 text-turquesa' : 'dark:text-text-secondary/40 text-text-secondary-light/40'}`} />
                      </button>
                    </th>
                  );
                })}
              </tr>

              {/* FILA 2 — Semanas */}
              <tr className="border-b dark:border-border-main/40 border-border-main-light/40">
                {months.map(mo => {
                  if (!expandedMonths.has(mo.key)) return <td key={mo.key} className="border-l dark:border-border-main/20 border-border-main-light/20" />;
                  return mo.weeks.map(week => {
                    const isWeekExp = expandedWeeks.has(week.key);
                    const wTotal = totalWeekMins[week.key] || 0;
                    const wPct = week.capacityMins > 0 ? Math.round((wTotal / week.capacityMins) * 100) : 0;
                    const colSpan = isWeekExp ? 1 + buildDays(week, today, jornada).length : 1;
                    return (
                      <th key={week.key} colSpan={colSpan}
                        className={`border-l dark:border-border-main/30 border-border-main-light/30 px-3 py-2.5 min-w-[110px] text-left dark:bg-bg-card bg-white ${isWeekExp ? 'dark:bg-azul/10 bg-azul/5' : ''}`}
                      >
                        <button onClick={() => toggleWeek(week.key)} className="flex items-center gap-2 w-full group">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`text-[10px] font-black uppercase tracking-wide ${isWeekExp ? 'text-azul' : 'dark:text-text-secondary text-text-secondary-light group-hover:dark:text-white'}`}>{week.label}</span>
                              {wTotal > 0 && <span className={`text-[10px] font-bold ${getPctTextClass(wPct)}`}>{formatMinutes(wTotal)}</span>}
                              {wTotal > 0 && <span className="text-[9px] dark:text-text-secondary/50 text-text-secondary-light/50">{wPct}%</span>}
                            </div>
                            {wTotal > 0 && (
                              <div className="w-full h-0.5 rounded-full dark:bg-white/10 bg-black/10 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, wPct)}%`, backgroundColor: getPctColor(wPct) }} />
                              </div>
                            )}
                          </div>
                          <ChevronDown size={10} className={`shrink-0 transition-transform ${isWeekExp ? 'rotate-180 text-azul' : 'dark:text-text-secondary/30'}`} />
                        </button>
                      </th>
                    );
                  });
                })}
              </tr>

              {/* FILA 3 — Días */}
              <tr className="border-b dark:border-border-main/30 border-border-main-light/30">
                {months.map(mo => {
                  if (!expandedMonths.has(mo.key)) return <td key={mo.key} />;
                  return mo.weeks.map(week => {
                    if (!expandedWeeks.has(week.key)) return <td key={week.key} className="border-l dark:border-border-main/20" />;
                    return buildDays(week, today, jornada).map(day => (
                      <th key={day.date}
                        className={`border-l dark:border-border-main/10 border-border-main-light/10 px-2 py-2 min-w-[64px] text-center ${!day.isWorkday ? 'dark:bg-black/10 bg-gray-100/40' : 'dark:bg-bg-main/30 bg-gray-50/60'} ${day.isToday ? 'dark:bg-turquesa/15 bg-turquesa/10' : ''}`}
                      >
                        <button onClick={() => onNavigateToDashboard(day.date)} className="w-full hover:text-turquesa transition-all">
                          <span className={`text-[9px] font-black block ${day.isToday ? 'text-turquesa' : !day.isWorkday ? 'dark:text-text-secondary/30 text-text-secondary-light/30' : 'dark:text-text-secondary text-text-secondary-light'}`}>
                            {day.label}
                          </span>
                        </button>
                      </th>
                    ));
                  });
                })}
              </tr>

              {/* FILA 4 — Total por día */}
              <tr className="border-b-2 dark:border-border-main border-border-main-light">
                {months.map(mo => {
                  if (!expandedMonths.has(mo.key)) return <td key={mo.key} />;
                  return mo.weeks.map(week => {
                    if (!expandedWeeks.has(week.key)) return <td key={week.key} className="border-l dark:border-border-main/20" />;
                    return buildDays(week, today, jornada).map(day => {
                      const dTotal = totalDayMins[day.date] || 0;
                      const dPct = day.capacityMins > 0 ? Math.round((dTotal / day.capacityMins) * 100) : 0;
                      return (
                        <td key={day.date}
                          className={`border-l dark:border-border-main/10 border-border-main-light/10 px-2 py-2 min-w-[64px] ${!day.isWorkday ? 'dark:bg-black/10 bg-gray-100/40' : 'dark:bg-bg-main/30 bg-gray-50/60'} ${day.isToday ? 'dark:bg-turquesa/10 bg-turquesa/5' : ''}`}
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
                            <span className="text-[9px] dark:text-text-secondary/15 text-text-secondary-light/15 block text-center">—</span>
                          )}
                        </td>
                      );
                    });
                  });
                })}
              </tr>
            </thead>

            <tbody>
              {grouped.map((node, gi) => (
                <WorkloadRow
                  key={node.key}
                  node={node}
                  months={months}
                  expandedMonths={expandedMonths}
                  expandedWeeks={expandedWeeks}
                  expandedGroups={expandedGroups}
                  onToggleGroup={toggleGroup}
                  depth={0}
                  today={today}
                  onNavigate={onNavigateToDashboard}
                  dayLoadCache={dayLoadCache}
                  getNodeDayMins={getNodeDayMins}
                  jornada={jornada}
                  isLastGroup={gi === grouped.length - 1}
                />
              ))}
              {grouped.length === 0 && (
                <tr>
                  <td colSpan={99} className="text-center py-16">
                    <p className="text-sm font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest opacity-30">Sin datos de carga</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>)}
    </div>
  );
}

// ─── WorkloadRow ──────────────────────────────────────────────────────────────

function WorkloadRow({
  node, months, expandedMonths, expandedWeeks, expandedGroups,
  onToggleGroup, depth, today, onNavigate, dayLoadCache, getNodeDayMins, isLastGroup, jornada,
}: {
  node: GroupNode;
  months: MonthInfo[];
  expandedMonths: Set<string>;
  expandedWeeks: Set<string>;
  expandedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  depth: number;
  today: string;
  onNavigate: (date: string) => void;
  dayLoadCache: Record<string, number>;
  getNodeDayMins: (node: GroupNode, date: string) => number;
  isLastGroup?: boolean;
  jornada: number;
}) {
  const isOpen = expandedGroups.has(node.key);
  const isGroup = depth === 0;
  const isType = depth === 1;
  const isTask = depth >= 2;

  // Estilos por nivel
  const pl = isGroup ? 'pl-5' : isType ? 'pl-8' : 'pl-11';
  const bg = isGroup ? 'dark:bg-white/[0.03] bg-gray-50/60' : isType ? 'dark:bg-white/[0.015] bg-white/80' : '';
  const borderTop = isGroup && !isLastGroup ? 'dark:border-t-border-main/40 border-t-border-main-light/40' : '';
  const txt = isGroup
    ? 'text-[12px] font-black dark:text-white text-text-main-light'
    : isType ? 'text-[11px] font-bold dark:text-text-secondary text-text-secondary-light'
    : 'text-[11px] font-medium dark:text-text-secondary/80 text-text-secondary-light/80';

  return (
    <>
      <tr
        className={`border-b dark:border-border-main/15 border-border-main-light/15 ${bg} ${borderTop && 'border-t-2 ' + borderTop} ${!node.isLeaf ? 'cursor-pointer hover:dark:bg-white/[0.05] hover:bg-black/[0.02] transition-all' : 'hover:dark:bg-white/[0.02] transition-all'}`}
        onClick={!node.isLeaf ? () => onToggleGroup(node.key) : undefined}
      >
        {/* Nombre */}
        <td className={`${pl} pr-4 py-3 sticky left-0 z-10 min-w-[220px] max-w-[280px]`}
          style={{ backgroundColor: 'var(--bg-card, transparent)' }}
        >          <div className="flex items-center gap-2 min-w-0">
            {node.color && (isGroup || isType) && (
              <div className={`rounded-full shrink-0 ${isGroup ? 'w-2.5 h-2.5' : 'w-2 h-2 opacity-70'}`} style={{ backgroundColor: node.color }} />
            )}
            <span className={`${txt} truncate flex-1`}>{node.label}</span>
            {!node.isLeaf && (
              isOpen
                ? <ChevronUp size={10} className="shrink-0 dark:text-text-secondary/40 text-text-secondary-light/40" />
                : <ChevronDown size={10} className="shrink-0 dark:text-text-secondary/40 text-text-secondary-light/40" />
            )}
          </div>
          {/* Total mensual visible siempre para tareas */}
          {isTask && (() => {
            const totalAllMonths = months.reduce((acc, mo) => acc + (node.monthMinutes[mo.key] || 0), 0);
            if (totalAllMonths === 0) return null;
            return <div className="text-[9px] dark:text-text-secondary/50 text-text-secondary-light/50 mt-0.5 pl-0">{formatMinutes(totalAllMonths)} total</div>;
          })()}
        </td>

        {/* Columnas de meses → semanas → días */}
        {months.map(mo => {
          const isMonthExp = expandedMonths.has(mo.key);
          const mMins = node.monthMinutes[mo.key] || 0;

          if (!isMonthExp) {
            return (
              <td key={mo.key} className="border-l dark:border-border-main/30 border-border-main-light/30 px-4 py-3 min-w-[160px] align-middle">
                {mMins > 0
                  ? <ProgressCell minutes={mMins} capacityMins={mo.capacityMins} size={isGroup ? 'md' : 'sm'} />
                  : <span className="text-[10px] dark:text-text-secondary/20 text-text-secondary-light/20">—</span>
                }
              </td>
            );
          }

          // Mes expandido → mostrar semanas
          return mo.weeks.map(week => {
            const isWeekExp = expandedWeeks.has(week.key);
            const wMins = node.weekMinutes[week.key] || 0;

            if (!isWeekExp) {
              return (
                <td key={week.key} className="border-l dark:border-border-main/20 border-border-main-light/20 px-3 py-3 min-w-[110px] align-middle dark:bg-bg-main/10">
                  {wMins > 0
                    ? <ProgressCell minutes={wMins} capacityMins={week.capacityMins} size="sm" />
                    : <span className="text-[10px] dark:text-text-secondary/15 text-text-secondary-light/15">—</span>
                  }
                </td>
              );
            }

            // Semana expandida → mostrar días
            return buildDays(week, today, jornada).map(day => {
              const dMins = getNodeDayMins(node, day.date);
              return (
                <td key={day.date}
                  className={`border-l dark:border-border-main/10 border-border-main-light/10 px-2 py-3 min-w-[64px] align-middle text-center ${!day.isWorkday ? 'dark:bg-black/10 bg-gray-100/40 opacity-40' : ''} ${day.isToday ? 'dark:bg-turquesa/5 bg-turquesa/5' : ''}`}
                >
                  {day.isWorkday && dMins > 0
                    ? <ProgressCell minutes={dMins} capacityMins={day.capacityMins} size="sm" />
                    : <span className="text-[9px] dark:text-text-secondary/15 text-text-secondary-light/15">—</span>
                  }
                </td>
              );
            });
          });
        })}
      </tr>

      {/* Hijos */}
      {!node.isLeaf && isOpen && node.children.map((child, ci) => (
        <WorkloadRow
          key={child.key}
          node={child}
          months={months}
          expandedMonths={expandedMonths}
          expandedWeeks={expandedWeeks}
          expandedGroups={expandedGroups}
          onToggleGroup={onToggleGroup}
          depth={depth + 1}
          today={today}
          onNavigate={onNavigate}
          dayLoadCache={dayLoadCache}
          getNodeDayMins={getNodeDayMins}
          jornada={jornada}
        />
      ))}
    </>
  );
}
