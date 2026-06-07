/**
 * BlocksView.tsx
 * Vista de gestión de bloques de trabajo.
 * Extraído de App.tsx - Sesión 3 del refactor.
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  Plus,
  CheckCircle2,
  Compass,
  ChevronRight,
  Edit,
  Eye,
  EyeOff,
  GripVertical,
  Play,
  Pause,
  Grid2X2
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Reorder } from 'framer-motion';
import { WorkBlock, Task } from './types';
import { isTaskRepetitive } from './utils';
import { TaskCard, BulkActionBar, ToggleExpandButton } from './components';

// Componentes compartidos importados desde App.tsx vía props
// (TaskCard, BulkActionBar, ToggleExpandButton se pasan como props o se importarán
// cuando se extraigan a su propio archivo)

interface BlocksViewProps {
  blocks: WorkBlock[];
  tasks: Record<string, Task>;
  allTasksMap: Record<string, Task>;
  people?: any[];
  onAddPerson?: (name: string) => void;
  onRenamePerson?: ((id: string, name: string) => void) | null;
  onDeletePerson?: ((id: string) => void) | null;
  timeEntries?: any[];
  activeTimer?: any;
  onStartTimer?: (taskId: string, subtaskId?: string | null) => void;
  onStopTimer?: () => void;
  onAddTask: (parentTaskId: string | null, blockId?: string) => void;
  onAddRule?: (blockId?: string) => void;
  onToggleTask: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onUpdateTask: (task: Task) => void;
  onEditTask: (taskId: string) => void;
  editingTaskId?: string | null;
  inlineEditingTaskId?: string | null;
  setInlineEditingTaskId?: (id: string | null) => void;
  onOpenTimePanel?: (taskId: string, subtaskId: string | null) => void;
  onEditRule?: (taskId: string) => void;
  onToggleRule?: (taskId: string) => void;
  onAddBlock: () => void;
  onEditBlock: (blockId: string) => void;
  onReorderBlocks: (blocks: WorkBlock[]) => void;
  onToggleBlock: (blockId: string) => void;
  activeDate: string;
  onReorderSubtasks?: (parentId: string, subtaskIds: string[]) => void;
  onViewInstances?: (task: any) => void;
  highlightTaskId?: string | null;
  onClearHighlight?: () => void;
  onReorderTasks: (tasks: Task[]) => void;
  onToggleExpand?: (taskId: string) => void;
  onExpandAll?: (blockId: string) => void;
  onPromote?: (taskId: string) => void;
  onDemote?: (taskId: string) => void;
  onRecurrenceDateChange?: ((taskId: string, date: string) => void) | null;
  selectionMode?: boolean;
  selectedTaskIds?: Set<string>;
  onToggleTaskSelection?: ((taskId: string) => void) | null;
  onToggleSelectionMode?: (() => void) | null;
  bulkUpdateTasks?: ((updates: Partial<Task>) => void) | null;
  bulkDeleteTasks?: (() => void) | null;
  bulkDuplicateTasks?: (() => void) | null;
  setBulkDelegateModal?: ((open: boolean) => void) | null;
  setBulkDateModal?: ((open: boolean) => void) | null;
  setBulkTimeModal?: ((open: boolean) => void) | null;
  // Componentes compartidos pasados como props hasta que se extraigan
  TaskCard: React.ComponentType<any>;
  BulkActionBar: React.ComponentType<any>;
  setBulkTimeModal?: ((open: boolean) => void) | null;
  onExpandedChange?: (expanded: boolean) => void;
  onRegisterExpandToggle?: (fn: () => void) => void;
}

export function BlocksManagerView({
  blocks, tasks, allTasksMap, people = [], onAddPerson, onRenamePerson = null, onDeletePerson = null,
  timeEntries, activeTimer, onStartTimer, onStopTimer, onAddTask, onAddRule, onToggleTask, onDelete,
  onUpdateTask, onEditTask, editingTaskId, inlineEditingTaskId, setInlineEditingTaskId, onOpenTimePanel,
  onEditRule, onToggleRule, onAddBlock, onEditBlock, onReorderBlocks, onToggleBlock, activeDate,
  onReorderSubtasks, onReorderTasks, onToggleExpand, onExpandAll, onViewInstances, onPromote, onDemote,
  highlightTaskId, onClearHighlight,
  onRecurrenceDateChange = null, selectionMode = false, selectedTaskIds = new Set(),
  onToggleTaskSelection = null, onToggleSelectionMode = null, bulkUpdateTasks = null,
  bulkDeleteTasks = null, bulkDuplicateTasks = null, setBulkDelegateModal = null,
  setBulkDateModal = null, setBulkTimeModal = null, searchQuery = '',
  onExpandedChange, onRegisterExpandToggle
}: BlocksViewProps) {

  // Seleccionar bloque, expandir padre y hacer scroll al template resaltado
  React.useEffect(() => {
    if (!highlightTaskId) return;
    const targetTask = allTasksMap[highlightTaskId];
    if (!targetTask) return;

    // Seleccionar bloque correcto
    const targetBlock = blocks.find((b: any) => b.id === targetTask.blockId);
    if (targetBlock) setSelectedBlock(targetBlock);

    // Expandir el padre si la tarea es subtarea
    if (targetTask.parentTaskId) {
      setExpandedIds(prev => new Set([...prev, targetTask.parentTaskId!]));
    }
    // También expandir la propia tarea si tiene subtareas
    setExpandedIds(prev => new Set([...prev, highlightTaskId]));

    // El scroll lo hace el propio TaskCard via ref cuando isHighlighted=true
  }, [highlightTaskId]);

  const [selectedBlock, setSelectedBlock] = useState<WorkBlock | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Notify parent of expand state changes
  React.useEffect(() => {
    onExpandedChange?.(expandedIds.size > 0);
  }, [expandedIds]);

  // Toggle expand local (no persiste, solo para vista Bloques)
  const handleLocalToggleExpand = (taskId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // Comprueba si una tarea o alguna de sus subtareas coincide con searchQuery
  const taskMatchesSearch = (t: any, query: string): boolean => {
    if (!query) return true;
    const q = query.toLowerCase();
    if ((t.title || '').toLowerCase().includes(q)) return true;
    if ((t.notes || '').toLowerCase().includes(q)) return true;
    return (t.subtasks || []).some((subId: string) => {
      const sub = allTasksMap[subId];
      return sub && ((sub.title || '').toLowerCase().includes(q) || (sub.notes || '').toLowerCase().includes(q));
    });
  };

  const coreTasks = useMemo(() => {
    if (!selectedBlock) return [];
    return Object.values(allTasksMap).filter((t: any) => {
      if (!t || t.blockId !== selectedBlock.id) return false;
      if (t.parentTaskId) return false;
      if (t.templateId) return false;
      if (t.isDeleted) return false;
      if (hideCompleted && t.status === 'completed') return false;
      const type = t.taskType || (isTaskRepetitive(t.id, allTasksMap) ? 'core' : 'adhoc');
      if (type !== 'core') return false;
      return taskMatchesSearch(t, searchQuery);
    }).sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  }, [selectedBlock, allTasksMap, hideCompleted, searchQuery]);

  const adhocTasks = useMemo(() => {
    if (!selectedBlock) return [];
    return Object.values(allTasksMap).filter((t: any) => {
      if (!t || t.blockId !== selectedBlock.id) return false;
      if (t.parentTaskId) return false;
      if (t.templateId) return false;
      if (t.isDeleted) return false;
      if (hideCompleted && t.status === 'completed') return false;
      const type = t.taskType || (isTaskRepetitive(t.id, allTasksMap) ? 'core' : 'adhoc');
      if (type !== 'adhoc') return false;
      return taskMatchesSearch(t, searchQuery);
    }).sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  }, [selectedBlock, allTasksMap, hideCompleted, searchQuery]);

  // Cuando hay búsqueda activa, expandir automáticamente contenedores con coincidencias en subtareas
  useEffect(() => {
    if (!searchQuery) return;
    const toExpand = new Set<string>();
    [...coreTasks, ...adhocTasks].forEach((t: any) => {
      if (!(t.subtasks && t.subtasks.length > 0)) return;
      const hasSubMatch = (t.subtasks || []).some((subId: string) => {
        const sub = allTasksMap[subId];
        return sub && (sub.title || '').toLowerCase().includes(searchQuery.toLowerCase());
      });
      if (hasSubMatch) toExpand.add(t.id);
    });
    if (toExpand.size > 0) setExpandedIds(prev => new Set([...prev, ...toExpand]));
  }, [searchQuery, coreTasks, adhocTasks]);

  const filteredBlocks = useMemo(() => {
    if (filter === 'active') return blocks.filter(b => b.isActive);
    if (filter === 'inactive') return blocks.filter(b => !b.isActive);
    return blocks;
  }, [blocks, filter]);

  // Register expand toggle with App.tsx StickyActionBar
  React.useEffect(() => {
    if (!selectedBlock) return;
    onRegisterExpandToggle?.(() => {
      setExpandedIds(prev => {
        if (prev.size > 0) return new Set();
        const allIds = new Set([...coreTasks.map((t: any) => t.id), ...adhocTasks.map((t: any) => t.id)]);
        return allIds;
      });
    });
  }, [selectedBlock, coreTasks, adhocTasks]);

  if (selectedBlock) {
    return (
      <>
        {/* Header del bloque */}
        <div className="dark:bg-bg-secondary bg-bg-secondary-light border-b dark:border-border-main border-border-main-light rounded-[1.5rem] mb-6">
          <div className="flex items-center gap-3 p-4">
            <button onClick={() => setSelectedBlock(null)} className="p-2 dark:hover:bg-bg-main hover:bg-gray-100 rounded-xl transition-all shrink-0">
              <ChevronRight size={18} className="rotate-180 dark:text-white text-text-main-light" />
            </button>
            <div className="w-9 h-9 rounded-xl dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light flex items-center justify-center text-xl shadow-inner shrink-0">
              {selectedBlock.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black dark:text-white text-text-main-light truncate">{selectedBlock.name}</h2>
                <button onClick={() => onEditBlock(selectedBlock.id)} className="p-1 bg-turquesa/10 text-turquesa hover:bg-turquesa/20 rounded-lg transition-all shrink-0">
                  <Edit size={12} />
                </button>
              </div>
              <p className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">
                {coreTasks.length + adhocTasks.length} tareas
              </p>
            </div>
            <button
              onClick={() => setHideCompleted(p => !p)}
              className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-all ${hideCompleted ? 'bg-turquesa text-white border-turquesa' : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light'}`}
              title={hideCompleted ? 'Ver completadas' : 'Ocultar completadas'}
            >
              {hideCompleted ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 pb-32">

        <div className="space-y-12">
          {/* Ad-hoc Tasks Section */}
          <div className="space-y-6">
            <div className="flex items-center gap-3 px-4">
              <div className="p-2 bg-rosa/10 rounded-xl text-rosa shadow-[0_0_15px_rgba(251,113,133,0.2)]">
                <div className="w-3 h-3 bg-current rounded-full" />
              </div>
              <h3 className="font-black uppercase tracking-[0.25em] text-[11px] text-text-secondary">AD-HOC (PUNTUALES) ({adhocTasks.length})</h3>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <Reorder.Group axis="y" values={adhocTasks} onReorder={onReorderTasks} className="grid grid-cols-1 gap-4">
                {adhocTasks.map((t: Task, idx: number) => (
                  <Reorder.Item key={t.id} value={t} whileDrag={{ scale: 1.01, zIndex: 50, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }} style={{ cursor: 'grab' }}>
                  <TaskCard
                    key={t.id}
                    task={t}
                    variant="FULL"
                    allTasksMap={allTasksMap}
                    people={people}
                    onAddPerson={onAddPerson}
                    blocks={blocks}
                    timeEntries={timeEntries}
                    activeTimer={activeTimer}
                    onStartTimer={onStartTimer}
                    onStopTimer={onStopTimer}
                    onToggleStatus={t.isTemplate ? onToggleRule : onToggleTask}
                    onUpdateTask={onUpdateTask}
                    onEditTask={t.isTemplate ? onEditRule : onEditTask}
                    editingTaskId={editingTaskId}
                    inlineEditingTaskId={inlineEditingTaskId}
                    setInlineEditingTaskId={setInlineEditingTaskId}
                    onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel && onOpenTimePanel(taskId, subtaskId)}
                    onAddTask={onAddTask}
                    onDelete={onDelete}
                    onPromote={onPromote}
                    onDemote={onDemote}
                    onReorderSubtasks={onReorderSubtasks}
                    onViewInstances={onViewInstances}
                    highlightTaskId={highlightTaskId}
                    forceExpanded={expandedIds.has(t.id) ? true : false}
                    onToggleExpand={handleLocalToggleExpand}
                    hideCompleted={hideCompleted}
                    selectionMode={selectionMode}
                    selectedTaskIds={selectedTaskIds}
                    onToggleTaskSelection={onToggleTaskSelection}
                    taskIndex={idx}
                    taskCount={adhocTasks.length}
                    onMoveUp={() => {
                      if (idx === 0) return;
                      const reordered = [...adhocTasks];
                      [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
                      onReorderTasks(reordered);
                    }}
                    onMoveDown={() => {
                      if (idx === adhocTasks.length - 1) return;
                      const reordered = [...adhocTasks];
                      [reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
                      onReorderTasks(reordered);
                    }}
                    searchQuery={searchQuery}
                  />
                  </Reorder.Item>
                ))}
              </Reorder.Group>
              {adhocTasks.length === 0 && (
                <div className="py-12 text-center dark:text-text-secondary text-text-secondary-light border-2 border-dashed dark:border-border-main border-border-main-light rounded-[2rem] bg-bg-card/20 opacity-50">
                  <p className="font-bold uppercase tracking-widest text-[10px]">No hay tareas ad-hoc activas</p>
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-border-main/50" />

          {/* Core Tasks Section */}
          <div className="space-y-6">
            <div className="flex items-center gap-3 px-4">
              <div className="p-2 bg-turquesa/10 rounded-xl text-turquesa">
                <Compass size={18} />
              </div>
              <h3 className="font-black uppercase tracking-[0.25em] text-[11px] text-text-secondary">PUESTO (CORE) ({coreTasks.length})</h3>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <Reorder.Group axis="y" values={coreTasks} onReorder={onReorderTasks} className="grid grid-cols-1 gap-4">
                {coreTasks.map((t: Task, idx: number) => (
                  <Reorder.Item key={t.id} value={t} whileDrag={{ scale: 1.01, zIndex: 50, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }} style={{ cursor: 'grab' }}>
                  <TaskCard
                    key={t.id}
                    task={t}
                    variant="FULL"
                    allTasksMap={allTasksMap}
                    people={people}
                    onAddPerson={onAddPerson}
                    blocks={blocks}
                    timeEntries={timeEntries}
                    activeTimer={activeTimer}
                    onStartTimer={onStartTimer}
                    onStopTimer={onStopTimer}
                    onToggleStatus={t.isTemplate ? onToggleRule : onToggleTask}
                    onUpdateTask={onUpdateTask}
                    onEditTask={t.isTemplate ? onEditRule : onEditTask}
                    editingTaskId={editingTaskId}
                    inlineEditingTaskId={inlineEditingTaskId}
                    setInlineEditingTaskId={setInlineEditingTaskId}
                    onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel && onOpenTimePanel(taskId, subtaskId)}
                    onAddTask={onAddTask}
                    onDelete={onDelete}
                    onPromote={onPromote}
                    onDemote={onDemote}
                    onReorderSubtasks={onReorderSubtasks}
                    onViewInstances={onViewInstances}
                    highlightTaskId={highlightTaskId}
                    forceExpanded={expandedIds.has(t.id) ? true : false}
                    onToggleExpand={handleLocalToggleExpand}
                    hideCompleted={hideCompleted}
                    selectionMode={selectionMode}
                    selectedTaskIds={selectedTaskIds}
                    onToggleTaskSelection={onToggleTaskSelection}
                    taskIndex={idx}
                    taskCount={coreTasks.length}
                    onMoveUp={() => {
                      if (idx === 0) return;
                      const reordered = [...coreTasks];
                      [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
                      onReorderTasks(reordered);
                    }}
                    onMoveDown={() => {
                      if (idx === coreTasks.length - 1) return;
                      const reordered = [...coreTasks];
                      [reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
                      onReorderTasks(reordered);
                    }}
                    searchQuery={searchQuery}
                  />
                  </Reorder.Item>
                ))}
              </Reorder.Group>
              {coreTasks.length === 0 && (
                <div className="py-12 text-center dark:text-text-secondary text-text-secondary-light border-2 border-dashed dark:border-border-main border-border-main-light rounded-[2rem] bg-bg-card/20 opacity-50">
                  <p className="font-bold uppercase tracking-widest text-[10px]">Sin tareas Core configuradas</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10 pb-32">

      {/* Bulk Action Bar Bloques */}
      {selectionMode && selectedTaskIds.size > 0 && bulkUpdateTasks && (
        <BulkActionBar
          count={selectedTaskIds.size}
          onDelegate={() => setBulkDelegateModal && setBulkDelegateModal(true)}
          onChangeDate={() => setBulkDateModal && setBulkDateModal(true)}
          onComplete={() => bulkUpdateTasks({ status: 'completed', completedAt: new Date().toISOString() })}
          onChangeTime={() => setBulkTimeModal && setBulkTimeModal(true)}
          onDuplicate={() => bulkDuplicateTasks && bulkDuplicateTasks()}
          onDelete={() => { if (confirm(`¿Eliminar ${selectedTaskIds.size} tarea${selectedTaskIds.size > 1 ? 's' : ''}?`)) { bulkDeleteTasks && bulkDeleteTasks(); } }}
          onCancel={onToggleSelectionMode}
          isMobile={window.innerWidth < 768}
        />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 dark:bg-bg-card bg-bg-card-light rounded-2xl border dark:border-border-main border-border-main-light flex items-center justify-center text-turquesa shadow-xl">
            <Grid2X2 size={24} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-white">Bloques</h2>
            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">Contextos de trabajo</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleSelectionMode && onToggleSelectionMode()}
            className={`flex items-center gap-1.5 px-3 h-10 rounded-2xl border-2 transition-all text-[10px] font-black uppercase tracking-widest ${
              selectionMode
                ? 'bg-azul text-white border-azul shadow-lg shadow-azul/30'
                : 'bg-azul/10 border-azul text-azul hover:bg-azul hover:text-white'
            }`}
          >
            <CheckCircle2 size={14} />
            <span className="hidden sm:inline">{selectionMode ? 'Cancelar' : 'Seleccionar'}</span>
          </button>
          <button
            onClick={onAddBlock}
            className="bg-azul hover:bg-azul/90 text-white px-8 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-azul/20 transition-all flex items-center gap-2"
          >
            <Plus size={18} /> Nuevo Contexto
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 dark:bg-bg-card/50 bg-gray-200 p-2 rounded-2xl border dark:border-border-main border-border-main-light w-fit">
        {(['all', 'active', 'inactive'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === f
                ? 'bg-turquesa text-white shadow-lg shadow-turquesa/20'
                : 'dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'active' ? 'Activos' : 'Inactivos'}
          </button>
        ))}
        <div className="w-px h-4 dark:bg-border-main bg-border-main-light mx-2" />
        <span className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light uppercase px-4">{filteredBlocks.length} Contextos</span>
      </div>

      <Reorder.Group
        axis="y"
        values={filteredBlocks}
        onReorder={(newOrder) => {
          if (filter !== 'all') return;
          onReorderBlocks(newOrder);
        }}
        className="space-y-4"
      >
        {filteredBlocks.map(block => {
          return (
            <Reorder.Item
              key={block.id}
              value={block}
              dragListener={filter === 'all'}
              className={`w-full group relative dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-[2rem] p-6 hover:border-turquesa/50 transition-all text-left flex items-center gap-6 shadow-xl overflow-hidden ${!block.isActive ? 'opacity-70' : ''}`}
            >
              <div
                onClick={() => setSelectedBlock(block)}
                className="flex-1 flex items-center gap-6 cursor-pointer"
              >
                <div className="w-16 h-16 rounded-3xl dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light flex items-center justify-center text-3xl group-hover:scale-110 transition-transform shadow-inner">
                  {block.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className={`text-xl font-black transition-colors ${block.isActive ? 'dark:text-white text-text-main-light' : 'dark:text-text-secondary text-text-secondary-light italic'}`}>
                      {block.name}
                    </h3>
                    {!block.isActive && (
                      <span className="text-[8px] font-black uppercase dark:bg-bg-main bg-white px-1.5 py-0.5 rounded border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light tracking-widest">Inactivo</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em]">
                      {Object.values(allTasksMap).filter((t: any) => t && t.blockId === block.id && t.isTemplate && !t.parentTaskId).length} reglas · {Object.values(allTasksMap).filter((t: any) => t && t.blockId === block.id && !t.isTemplate && !t.templateId && !t.parentTaskId).length} manuales
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                {filter === 'all' && (
                  <div className="p-3 dark:bg-bg-main bg-white rounded-xl dark:text-text-secondary text-text-secondary-light cursor-grab active:cursor-grabbing mr-2">
                    <GripVertical size={20} />
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); onEditBlock(block.id); }} className="p-3 dark:bg-bg-main bg-white rounded-xl text-turquesa border dark:border-border-main border-border-main-light">
                  <Edit size={20} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleBlock(block.id); }}
                  className={`p-3 rounded-xl border transition-all ${block.isActive ? 'bg-turquesa/10 border-turquesa text-turquesa' : 'bg-bg-main dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light'}`}
                >
                  {block.isActive ? <Play size={20} /> : <Pause size={20} />}
                </button>
                <ChevronRight size={24} className="dark:text-text-secondary text-text-secondary-light ml-2" />
              </div>

              <div className="absolute top-0 left-0 w-2 h-full" style={{ backgroundColor: block.color, opacity: block.isActive ? 1 : 0.3 }} />
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
    </motion.div>
  );
}
