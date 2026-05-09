/**
 * SearchView.tsx
 * Buscador global — filtros como chips dropdown compactos, multi-select.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, ChevronDown, Layers, ArrowRight, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Task, TagType } from './types';
import { TAG_LABELS } from './constants';
import { TaskCard } from './components';

// ─── tipos ─────────────────────────────────────────────────────────────────

interface Filters {
  statuses: string[];
  blockIds: string[];
  taskTypes: string[];
  recurrences: string[];
  personIds: string[];
  tags: string[];
  dueDateStart: string;
  dueDateEnd: string;
}

const EMPTY: Filters = {
  statuses: [],
  blockIds: [],
  taskTypes: [],
  recurrences: [],
  personIds: [],
  tags: [],
  dueDateStart: '',
  dueDateEnd: '',
};

function countActive(f: Filters) {
  return (
    f.statuses.length +
    f.blockIds.length +
    f.taskTypes.length +
    f.recurrences.length +
    f.personIds.length +
    f.tags.length +
    (f.dueDateStart || f.dueDateEnd ? 1 : 0)
  );
}

// ─── FilterChip dropdown ───────────────────────────────────────────────────

function FilterChip({
  label, count, options, selected, onToggle, onClear, extra,
}: {
  label: string;
  count: number;
  options: { value: string; label: string; color?: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isActive = selected.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
          isActive
            ? 'bg-turquesa text-white border-turquesa shadow-md shadow-turquesa/20'
            : 'dark:bg-bg-card bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50 hover:dark:text-white hover:text-text-main-light'
        }`}
      >
        {label}
        {count > 0 && (
          <span className="w-4 h-4 rounded-full bg-white/30 text-[9px] font-black flex items-center justify-center">
            {count}
          </span>
        )}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full mt-2 left-0 z-50 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl min-w-[180px] overflow-hidden"
          >
            {options.length > 0 && (
              <div className="py-1.5 max-h-60 overflow-y-auto">
                {options.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => onToggle(opt.value)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:dark:bg-white/5 hover:bg-gray-50 transition-all"
                  >
                    <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                      selected.includes(opt.value)
                        ? 'bg-turquesa border-turquesa text-white'
                        : 'dark:border-border-main border-border-main-light'
                    }`}>
                      {selected.includes(opt.value) && <Check size={10} />}
                    </div>
                    {opt.color && (
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                    )}
                    <span className={`text-[11px] font-bold truncate ${selected.includes(opt.value) ? 'dark:text-white text-text-main-light' : 'dark:text-text-secondary text-text-secondary-light'}`}>
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {extra && (
              <div className="px-4 py-3 border-t dark:border-border-main border-border-main-light">
                {extra}
              </div>
            )}
            {(selected.length > 0) && (
              <div className="border-t dark:border-border-main border-border-main-light">
                <button
                  onClick={() => { onClear(); setOpen(false); }}
                  className="w-full px-4 py-2 text-[10px] font-black uppercase tracking-widest text-rosa/70 hover:text-rosa hover:dark:bg-rosa/5 hover:bg-rosa/5 transition-all text-left"
                >
                  Limpiar
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── FilterChipDate — especial para fechas ─────────────────────────────────

function FilterChipDate({
  dueDateStart, dueDateEnd,
  onChangeStart, onChangeEnd, onClear,
}: any) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = !!(dueDateStart || dueDateEnd);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
          isActive
            ? 'bg-turquesa text-white border-turquesa shadow-md shadow-turquesa/20'
            : 'dark:bg-bg-card bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50 hover:dark:text-white hover:text-text-main-light'
        }`}
      >
        Fecha
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full mt-2 left-0 z-50 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl w-56 overflow-hidden"
          >
            <div className="px-4 py-3 space-y-3">
              <div className="space-y-1">
                <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Desde</p>
                <input type="date" value={dueDateStart} onChange={e => onChangeStart(e.target.value)}
                  className="w-full dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-xs dark:text-white text-text-main-light outline-none focus:border-turquesa/50"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Hasta</p>
                <input type="date" value={dueDateEnd} onChange={e => onChangeEnd(e.target.value)}
                  className="w-full dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-xs dark:text-white text-text-main-light outline-none focus:border-turquesa/50"
                />
              </div>
            </div>
            {isActive && (
              <div className="border-t dark:border-border-main border-border-main-light">
                <button onClick={() => { onClear(); setOpen(false); }}
                  className="w-full px-4 py-2 text-[10px] font-black uppercase tracking-widest text-rosa/70 hover:text-rosa hover:dark:bg-rosa/5 hover:bg-rosa/5 transition-all text-left"
                >Limpiar</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── ActiveBadge ───────────────────────────────────────────────────────────

function ActiveBadge({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-turquesa/10 border border-turquesa/30 text-turquesa text-[10px] font-black uppercase tracking-widest">
      {label}
      <button onClick={onRemove} className="hover:text-rosa transition-all ml-0.5">
        <X size={10} />
      </button>
    </span>
  );
}

// ─── SearchView ────────────────────────────────────────────────────────────

export function SearchView({
  tasks, allTasksMap, blocks, people = [], timeEntries = [], activeTimer,
  onEditTask, onToggle, onDelete, onUpdateTask, onAddTask, onNavigateToBlocks,
}: any) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const isActive = query.trim().length > 0 || countActive(filters) > 0;

  const toggle = (key: keyof Filters, value: string) => {
    setFilters(prev => {
      const arr = prev[key] as string[];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  };
  const clearKey = (key: keyof Filters) =>
    setFilters(prev => ({ ...prev, [key]: [] }));

  const resetAll = () => { setQuery(''); setFilters(EMPTY); };

  const rootTasks = useMemo(() =>
    Object.values(allTasksMap).filter((t: any) =>
      t && !t.isDeleted && !t.parentTaskId && (!t.templateId || t.isException) && !t.isTemplate
    ), [allTasksMap]);

  const availableTags = useMemo(() => {
    const s = new Set<string>();
    rootTasks.forEach((t: any) => (t.tags || []).forEach((tag: string) => s.add(tag)));
    return Array.from(s);
  }, [rootTasks]);

  const filteredTasks = useMemo(() => {
    if (!isActive) return [];
    const q = query.trim().toLowerCase();
    return rootTasks.filter((t: any) => {
      if (q) {
        const hit = t.title.toLowerCase().includes(q) ||
          (t.subtasks || []).some((sid: string) => allTasksMap[sid]?.title?.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (filters.statuses.length > 0 && !filters.statuses.includes(t.status)) return false;
      if (filters.blockIds.length > 0 && !filters.blockIds.includes(t.blockId)) return false;
      if (filters.taskTypes.length > 0 && !filters.taskTypes.includes(t.taskType || 'adhoc')) return false;
      if (filters.recurrences.length === 1) {
        if (filters.recurrences[0] === 'recurring' && !t.recurrence) return false;
        if (filters.recurrences[0] === 'manual' && t.recurrence) return false;
      }
      if (filters.personIds.length > 0 && !filters.personIds.includes(t.delegation?.personId)) return false;
      if (filters.tags.length > 0 && !filters.tags.some((tag: string) => (t.tags || []).includes(tag))) return false;
      if (filters.dueDateStart && (!t.dueDate || t.dueDate < filters.dueDateStart)) return false;
      if (filters.dueDateEnd && (!t.dueDate || t.dueDate > filters.dueDateEnd)) return false;
      return true;
    });
  }, [rootTasks, allTasksMap, query, filters, isActive]);

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    filteredTasks.forEach((t: any) => {
      const key = t.blockId || '__none__';
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return Object.entries(map).map(([blockId, blockTasks]) => ({
      block: blocks.find((b: any) => b.id === blockId) || { id: blockId, name: 'Sin bloque', color: '#666', icon: '📋' },
      tasks: blockTasks,
    }));
  }, [filteredTasks, blocks]);

  const blockOptions = blocks.map((b: any) => ({ value: b.id, label: `${b.icon} ${b.name}`, color: b.color }));
  const personOptions = people.map((p: any) => ({ value: p.id, label: p.name }));
  const tagOptions = availableTags.map((tag: string) => ({
    value: tag,
    label: TAG_LABELS[tag as TagType]?.label || tag,
  }));

  const activeBadges = [
    ...filters.statuses.map(v => ({ label: v === 'pending' ? 'Pendientes' : 'Completadas', onRemove: () => toggle('statuses', v) })),
    ...filters.blockIds.map(v => { const b = blocks.find((b: any) => b.id === v); return { label: b ? `${b.icon} ${b.name}` : v, onRemove: () => toggle('blockIds', v) }; }),
    ...filters.taskTypes.map(v => ({ label: v === 'core' ? 'Core' : 'Ad-hoc', onRemove: () => toggle('taskTypes', v) })),
    ...filters.recurrences.map(v => ({ label: v === 'recurring' ? 'Recurrentes' : 'Manuales', onRemove: () => toggle('recurrences', v) })),
    ...filters.personIds.map(v => { const p = people.find((p: any) => p.id === v); return { label: p?.name || v, onRemove: () => toggle('personIds', v) }; }),
    ...filters.tags.map(v => ({ label: TAG_LABELS[v as TagType]?.label || v, onRemove: () => toggle('tags', v) })),
    ...(filters.dueDateStart || filters.dueDateEnd ? [{ label: `${filters.dueDateStart || '…'} → ${filters.dueDateEnd || '…'}`, onRemove: () => setFilters(prev => ({ ...prev, dueDateStart: '', dueDateEnd: '' })) }] : []),
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto space-y-5 pb-32"
    >
      <div>
        <h2 className="text-3xl font-black dark:text-white text-text-main-light">Búsqueda</h2>
        <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-1">
          {isActive ? `${filteredTasks.length} resultado${filteredTasks.length !== 1 ? 's' : ''}` : 'Escribe para buscar'}
        </p>
      </div>

      {/* Barra búsqueda */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 dark:text-text-secondary text-text-secondary-light" size={18} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por título, subtarea..."
          className="w-full pl-12 pr-10 py-3.5 dark:bg-bg-card bg-white border-2 dark:border-border-main border-border-main-light rounded-2xl text-sm dark:text-white text-text-main-light outline-none focus:border-turquesa/60 transition-all dark:placeholder:text-text-secondary/40 placeholder:text-text-secondary-light/40 font-medium"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 dark:text-text-secondary text-text-secondary-light hover:text-rosa transition-all">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Chips filtro */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip label="Estado" count={filters.statuses.length}
          options={[{ value: 'pending', label: 'Pendientes' }, { value: 'completed', label: 'Completadas' }]}
          selected={filters.statuses} onToggle={v => toggle('statuses', v)} onClear={() => clearKey('statuses')}
        />
        <FilterChip label="Bloque" count={filters.blockIds.length}
          options={blockOptions} selected={filters.blockIds}
          onToggle={v => toggle('blockIds', v)} onClear={() => clearKey('blockIds')}
        />
        <FilterChip label="Tipo" count={filters.taskTypes.length}
          options={[{ value: 'core', label: 'Core' }, { value: 'adhoc', label: 'Ad-hoc' }]}
          selected={filters.taskTypes} onToggle={v => toggle('taskTypes', v)} onClear={() => clearKey('taskTypes')}
        />
        <FilterChip label="Recurrencia" count={filters.recurrences.length}
          options={[{ value: 'recurring', label: 'Recurrentes' }, { value: 'manual', label: 'Manuales' }]}
          selected={filters.recurrences} onToggle={v => toggle('recurrences', v)} onClear={() => clearKey('recurrences')}
        />
        {people.length > 0 && (
          <FilterChip label="Persona" count={filters.personIds.length}
            options={personOptions} selected={filters.personIds}
            onToggle={v => toggle('personIds', v)} onClear={() => clearKey('personIds')}
          />
        )}
        {tagOptions.length > 0 && (
          <FilterChip label="Etiqueta" count={filters.tags.length}
            options={tagOptions} selected={filters.tags}
            onToggle={v => toggle('tags', v)} onClear={() => clearKey('tags')}
          />
        )}
        <FilterChipDate
          dueDateStart={filters.dueDateStart}
          dueDateEnd={filters.dueDateEnd}
          onChangeStart={(v: string) => setFilters(prev => ({ ...prev, dueDateStart: v }))}
          onChangeEnd={(v: string) => setFilters(prev => ({ ...prev, dueDateEnd: v }))}
          onClear={() => setFilters(prev => ({ ...prev, dueDateStart: '', dueDateEnd: '' }))}
        />
        {countActive(filters) > 0 && (
          <button onClick={resetAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-rosa hover:text-rosa transition-all text-[11px] font-black uppercase tracking-widest"
          >
            <X size={11} /> Limpiar
          </button>
        )}
      </div>

      {/* Badges activos */}
      {activeBadges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeBadges.map((b, i) => <ActiveBadge key={i} label={b.label} onRemove={b.onRemove} />)}
        </div>
      )}

      {/* Vacío */}
      {!isActive && (
        <div className="py-32 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 dark:bg-bg-card bg-white rounded-[2rem] flex items-center justify-center mb-6 border dark:border-border-main border-border-main-light shadow-xl">
            <Search size={36} className="dark:text-text-secondary text-text-secondary-light opacity-30" />
          </div>
          <p className="text-lg font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Empieza a buscar</p>
          <p className="text-sm dark:text-text-secondary/50 text-text-secondary-light/50 mt-2">Escribe un título o aplica filtros</p>
        </div>
      )}

      {/* Sin resultados */}
      {isActive && filteredTasks.length === 0 && (
        <div className="py-24 flex flex-col items-center justify-center text-center border-2 border-dashed dark:border-border-main border-border-main-light rounded-[2.5rem] opacity-50">
          <Search size={40} className="dark:text-text-secondary text-text-secondary-light mb-4 opacity-20" />
          <p className="font-black uppercase tracking-widest text-sm dark:text-text-secondary text-text-secondary-light">Sin resultados</p>
          <p className="text-xs mt-2 opacity-60 dark:text-text-secondary text-text-secondary-light">Prueba con otros términos o filtros</p>
        </div>
      )}

      {/* Resultados */}
      {isActive && filteredTasks.length > 0 && (
        <div className="space-y-8">
          {grouped.map(({ block, tasks: blockTasks }) => (
            <div key={block.id} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-7 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
                <span className="text-sm font-black uppercase tracking-wider dark:text-white text-text-main-light">
                  {block.icon} {block.name}
                </span>
                <span className="text-[10px] dark:text-text-secondary text-text-secondary-light font-bold">
                  {blockTasks.length} {blockTasks.length === 1 ? 'tarea' : 'tareas'}
                </span>
                <button
                  onClick={() => onNavigateToBlocks && onNavigateToBlocks(block.id)}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border dark:border-border-main border-border-main-light dark:bg-bg-card bg-white dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light hover:border-turquesa/50 transition-all text-[10px] font-black uppercase tracking-widest"
                >
                  <Layers size={11} />
                  Bloques
                  <ArrowRight size={10} />
                </button>
              </div>
              <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] overflow-hidden shadow-xl divide-y dark:divide-border-main divide-border-main-light">
                {blockTasks.map((task: any, idx: number) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    variant="FULL"
                    allTasksMap={allTasksMap}
                    people={people}
                    blocks={blocks}
                    timeEntries={timeEntries}
                    activeTimer={activeTimer}
                    onToggleStatus={onToggle}
                    onUpdateTask={onUpdateTask}
                    onEditTask={onEditTask}
                    onAddTask={onAddTask}
                    onDelete={onDelete}
                    onReorderSubtasks={() => {}}
                    onToggleExpand={(taskId: string) =>
                      onUpdateTask({ ...allTasksMap[taskId], isExpanded: !allTasksMap[taskId]?.isExpanded })
                    }
                    taskIndex={idx}
                    taskCount={blockTasks.length}
                    onMoveUp={() => {}}
                    onMoveDown={() => {}}
                    searchQuery={query}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
