/**
 * SearchView.tsx
 * Buscador global con TaskCard editable, filtros y navegación a Bloques.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search, X, Filter, ChevronDown, ChevronUp,
  Layers, RefreshCw, CheckCircle2, Circle, ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Task, TagType } from './types';
import { TAG_LABELS } from './constants';
import { TaskCard } from './components';

// ─── helpers ───────────────────────────────────────────────────────────────

const EMPTY_FILTERS = {
  tags: [] as string[],
  status: 'all' as 'all' | 'pending' | 'completed',
  blockId: 'all' as string,
  taskType: 'all' as 'all' | 'core' | 'adhoc',
  recurrence: 'all' as 'all' | 'recurring' | 'manual',
  personId: 'all' as string,
  dueDateStart: '',
  dueDateEnd: '',
};

type Filters = typeof EMPTY_FILTERS;

function hasActiveFilters(f: Filters) {
  return (
    f.tags.length > 0 ||
    f.status !== 'all' ||
    f.blockId !== 'all' ||
    f.taskType !== 'all' ||
    f.recurrence !== 'all' ||
    f.personId !== 'all' ||
    !!f.dueDateStart ||
    !!f.dueDateEnd
  );
}

// ─── component ─────────────────────────────────────────────────────────────

export function SearchView({
  tasks,
  allTasksMap,
  blocks,
  people = [],
  timeEntries = [],
  activeTimer,
  onEditTask,
  onToggle,
  onDelete,
  onUpdateTask,
  onAddTask,
  onNavigateToBlocks,
}: any) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus al entrar
  useEffect(() => { inputRef.current?.focus(); }, []);

  const hasQuery = query.trim().length > 0;
  const hasFilters = hasActiveFilters(filters);
  const isActive = hasQuery || hasFilters;

  // Tareas raíz — excluir instancias generadas (templateId sin isException),
  // templates puros, borradas y subtareas
  const rootTasks = useMemo(() =>
    Object.values(allTasksMap).filter((t: any) =>
      t && !t.isDeleted && !t.parentTaskId &&
      (!t.templateId || t.isException) &&
      !t.isTemplate
    ),
  [allTasksMap]);

  const filteredTasks = useMemo(() => {
    if (!isActive) return [];
    const q = query.trim().toLowerCase();

    return rootTasks.filter((t: any) => {
      // Texto — busca en tarea y subtareas
      if (q) {
        const titleMatch = t.title.toLowerCase().includes(q);
        const subMatch = (t.subtasks || []).some((sid: string) =>
          allTasksMap[sid]?.title?.toLowerCase().includes(q)
        );
        if (!titleMatch && !subMatch) return false;
      }

      // Estado
      if (filters.status === 'pending' && t.status === 'completed') return false;
      if (filters.status === 'completed' && t.status !== 'completed') return false;

      // Bloque
      if (filters.blockId !== 'all' && t.blockId !== filters.blockId) return false;

      // Tipo
      if (filters.taskType !== 'all' && (t.taskType || 'adhoc') !== filters.taskType) return false;

      // Recurrencia
      if (filters.recurrence === 'recurring' && !t.recurrence) return false;
      if (filters.recurrence === 'manual' && t.recurrence) return false;

      // Persona delegada
      if (filters.personId !== 'all' && t.delegation?.personId !== filters.personId) return false;

      // Tags
      if (filters.tags.length > 0) {
        const has = filters.tags.some((tag: string) => (t.tags || []).includes(tag));
        if (!has) return false;
      }

      // Fecha ejecución
      if (filters.dueDateStart && (!t.dueDate || t.dueDate < filters.dueDateStart)) return false;
      if (filters.dueDateEnd && (!t.dueDate || t.dueDate > filters.dueDateEnd)) return false;

      return true;
    });
  }, [rootTasks, allTasksMap, query, filters, isActive]);

  // Agrupar por bloque
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

  const setFilter = (key: keyof Filters, value: any) =>
    setFilters(prev => ({ ...prev, [key]: value }));

  const toggleTag = (tag: string) =>
    setFilters(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
    }));

  const resetAll = () => { setQuery(''); setFilters(EMPTY_FILTERS); };

  // Tags disponibles en las tareas
  const availableTags = useMemo(() => {
    const s = new Set<string>();
    rootTasks.forEach((t: any) => (t.tags || []).forEach((tag: string) => s.add(tag)));
    return Array.from(s);
  }, [rootTasks]);

  const activeFilterCount = [
    filters.tags.length > 0,
    filters.status !== 'all',
    filters.blockId !== 'all',
    filters.taskType !== 'all',
    filters.recurrence !== 'all',
    filters.personId !== 'all',
    !!filters.dueDateStart || !!filters.dueDateEnd,
  ].filter(Boolean).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto space-y-6 pb-32"
    >
      {/* Header */}
      <div>
        <h2 className="text-3xl font-black dark:text-white text-text-main-light">Búsqueda</h2>
        <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-1">
          {isActive ? `${filteredTasks.length} resultado${filteredTasks.length !== 1 ? 's' : ''}` : 'Escribe para buscar'}
        </p>
      </div>

      {/* Barra de búsqueda */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
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

        {/* Botón filtros */}
        <button
          onClick={() => setShowFilters(v => !v)}
          className={`flex items-center gap-2 px-4 py-3.5 rounded-2xl border-2 transition-all text-sm font-black uppercase tracking-widest ${
            showFilters || hasFilters
              ? 'bg-turquesa text-white border-turquesa shadow-lg shadow-turquesa/20'
              : 'dark:bg-bg-card bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa hover:text-turquesa'
          }`}
        >
          <Filter size={15} />
          <span className="hidden sm:inline">Filtros</span>
          {activeFilterCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-white/30 text-white text-[10px] font-black flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        {(hasQuery || hasFilters) && (
          <button
            onClick={resetAll}
            className="flex items-center gap-2 px-4 py-3.5 rounded-2xl border-2 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-rosa hover:text-rosa transition-all text-sm font-black uppercase tracking-widest"
          >
            <X size={15} />
            <span className="hidden sm:inline">Limpiar</span>
          </button>
        )}
      </div>

      {/* Panel de filtros */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-2xl p-5 space-y-5">

              {/* Fila 1: Estado + Tipo + Recurrencia */}
              <div className="flex flex-wrap gap-6">
                {/* Estado */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Estado</p>
                  <div className="flex gap-1.5">
                    {[
                      { v: 'all', l: 'Todas' },
                      { v: 'pending', l: 'Pendientes' },
                      { v: 'completed', l: 'Completadas' },
                    ].map(({ v, l }) => (
                      <button key={v} onClick={() => setFilter('status', v)}
                        className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                          filters.status === v
                            ? 'bg-turquesa text-white border-turquesa'
                            : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50'
                        }`}
                      >{l}</button>
                    ))}
                  </div>
                </div>

                {/* Tipo */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Tipo</p>
                  <div className="flex gap-1.5">
                    {[
                      { v: 'all', l: 'Todas' },
                      { v: 'core', l: 'Core' },
                      { v: 'adhoc', l: 'Ad-hoc' },
                    ].map(({ v, l }) => (
                      <button key={v} onClick={() => setFilter('taskType', v)}
                        className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                          filters.taskType === v
                            ? 'bg-azul text-white border-azul'
                            : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul/50'
                        }`}
                      >{l}</button>
                    ))}
                  </div>
                </div>

                {/* Recurrencia */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Recurrencia</p>
                  <div className="flex gap-1.5">
                    {[
                      { v: 'all', l: 'Todas' },
                      { v: 'recurring', l: 'Recurrentes' },
                      { v: 'manual', l: 'Manuales' },
                    ].map(({ v, l }) => (
                      <button key={v} onClick={() => setFilter('recurrence', v)}
                        className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                          filters.recurrence === v
                            ? 'bg-morado text-white border-morado'
                            : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-morado/50'
                        }`}
                      >{l}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Fila 2: Bloque + Persona */}
              <div className="flex flex-wrap gap-6">
                {/* Bloque */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Bloque</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setFilter('blockId', 'all')}
                      className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                        filters.blockId === 'all'
                          ? 'bg-turquesa text-white border-turquesa'
                          : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50'
                      }`}
                    >Todos</button>
                    {blocks.map((b: any) => (
                      <button key={b.id} onClick={() => setFilter('blockId', filters.blockId === b.id ? 'all' : b.id)}
                        className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                          filters.blockId === b.id
                            ? 'text-white border-transparent'
                            : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light'
                        }`}
                        style={filters.blockId === b.id ? { backgroundColor: b.color, borderColor: b.color } : {}}
                      >{b.icon} {b.name}</button>
                    ))}
                  </div>
                </div>

                {/* Persona delegada */}
                {people.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Delegada a</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setFilter('personId', 'all')}
                        className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                          filters.personId === 'all'
                            ? 'bg-morado text-white border-morado'
                            : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-morado/50'
                        }`}
                      >Todas</button>
                      {people.map((p: any) => (
                        <button key={p.id} onClick={() => setFilter('personId', filters.personId === p.id ? 'all' : p.id)}
                          className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                            filters.personId === p.id
                              ? 'bg-morado text-white border-morado'
                              : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-morado/50'
                          }`}
                        >{p.name}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Fila 3: Tags */}
              {availableTags.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Etiqueta</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableTags.map((tag: string) => (
                      <button key={tag} onClick={() => toggleTag(tag)}
                        className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                          filters.tags.includes(tag)
                            ? 'bg-turquesa text-white border-turquesa'
                            : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50'
                        }`}
                      >{TAG_LABELS[tag as TagType] || tag}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Fila 4: Rango de fecha */}
              <div className="space-y-2">
                <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Fecha de ejecución</p>
                <div className="flex items-center gap-3">
                  <input
                    type="date"
                    value={filters.dueDateStart}
                    onChange={e => setFilter('dueDateStart', e.target.value)}
                    className="dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-xs dark:text-white text-text-main-light outline-none focus:border-turquesa/50 w-36"
                  />
                  <span className="text-[10px] dark:text-text-secondary text-text-secondary-light">→</span>
                  <input
                    type="date"
                    value={filters.dueDateEnd}
                    onChange={e => setFilter('dueDateEnd', e.target.value)}
                    className="dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-xs dark:text-white text-text-main-light outline-none focus:border-turquesa/50 w-36"
                  />
                  {(filters.dueDateStart || filters.dueDateEnd) && (
                    <button onClick={() => { setFilter('dueDateStart', ''); setFilter('dueDateEnd', ''); }}
                      className="w-6 h-6 flex items-center justify-center text-rosa/60 hover:text-rosa hover:bg-rosa/10 rounded-lg transition-all">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Estado vacío — esperando input */}
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

      {/* Resultados agrupados por bloque */}
      {isActive && filteredTasks.length > 0 && (
        <div className="space-y-8">
          {grouped.map(({ block, tasks: blockTasks }) => (
            <div key={block.id} className="space-y-3">
              {/* Header bloque */}
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-8 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
                <span className="text-sm font-black uppercase tracking-wider dark:text-white text-text-main-light">
                  {block.icon} {block.name}
                </span>
                <span className="text-[10px] dark:text-text-secondary text-text-secondary-light font-bold">
                  {blockTasks.length} {blockTasks.length === 1 ? 'tarea' : 'tareas'}
                </span>
                {/* Ir a Bloques */}
                <button
                  onClick={() => onNavigateToBlocks && onNavigateToBlocks(block.id)}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border dark:border-border-main border-border-main-light dark:bg-bg-card bg-white dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light hover:border-turquesa/50 transition-all text-[10px] font-black uppercase tracking-widest"
                >
                  <Layers size={11} />
                  Ver en Bloques
                  <ArrowRight size={10} />
                </button>
              </div>

              {/* TaskCards */}
              <div className="space-y-0 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] overflow-hidden shadow-xl divide-y dark:divide-border-main divide-border-main-light">
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
                    onToggleExpand={(taskId: string) => onUpdateTask({ ...allTasksMap[taskId], isExpanded: !allTasksMap[taskId]?.isExpanded })}
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
