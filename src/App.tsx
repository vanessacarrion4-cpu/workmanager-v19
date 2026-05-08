/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
 
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Plus, 
  LayoutDashboard, 
  Grid2X2, 
  Calendar as CalendarIcon, 
  Settings, 
  Bell, 
  Search, 
  CheckCircle2, 
  Circle,
  Compass, 
  Clock, 
  ChevronRight,
  ChevronLeft, 
  ChevronDown,
  ChevronUp,
  Trash2,
  Edit,
  Check,
  History,
  ArrowRight,
  MoreVertical,
  X,
  PlusCircle,
  Briefcase,
  Layers,
  Users,
  CreditCard,
  Megaphone,
  User,
  Zap,
  Target,
  ArrowUpRight,
  Pause,
  Play,
  Hammer,
  Coffee,
  Globe,
  LifeBuoy,
  Eye,
  EyeOff,
  RefreshCw,
  GripVertical,
  Paperclip,
  Maximize2,
  Minimize2,
  Dot,
  ArrowUpLeft,
  ArrowDownRight,
  ChevronsUp,
  ChevronsDown,
  Moon,
  Sun,
  Tag,
  Copy
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { WorkBlock, Task, ViewType, TagType, SubtaskTemplate, Priority, TimeEntry, Person, DelegationMeeting } from './types';
import { INITIAL_BLOCKS, TAG_LABELS, MOCK_TASKS, COLORS } from './constants';
import { supabase } from './supabaseClient';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { 
  getTaskLevel, 
  generateInstances, 
  isTaskCompleted, 
  isTaskRepetitive,
  projectLoad, 
  projectLoadForDay,
  getTaskEstimatedCombo,
  getTaskEstimatedPending,
  getTaskRegisteredSelf,
  getTaskRegisteredCombo,
  formatMinutes,
  isTaskVisible,
  isTaskInstance
} from './utils';
import { filterTasksForDay, groupTasksByTag, getStatsForDay } from './filters';
import { useSupabase } from './useSupabase';
import { useGeneration } from './useGeneration';
import { BlocksManagerView } from './BlocksView';
import { DashboardView } from './DashboardView';
import { CalendarView } from './CalendarView';
import { 
  TaskCard, BulkActionBar, DashboardHarmonicCalendar, RecurrenceChoiceModal,
  BlockModal, TimeManagementPanel, SearchView, getTagColor
} from './components';
 
// --- Storage Key ---
const STORAGE_KEY = 'workmanager-v19-data-v1';
 
export default function App() {
  // --- State ---
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('workmanager-theme');
    return saved !== 'light'; // Por defecto dark mode
  });
  const [blocks, setBlocks] = useState<WorkBlock[]>([]);
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');

  // Resetear modo selección al cambiar de vista
  useEffect(() => {
    setSelectionMode(false);
    setSelectedTaskIds(new Set());
  }, [currentView]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const todayLocal = formatLocalISO(new Date());
  const [activeDate, setActiveDate] = useState(todayLocal);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [inlineEditingTaskId, setInlineEditingTaskId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [recurrenceAction, setRecurrenceAction] = useState<{ taskId: string, type: 'edit' | 'delete', ruleId: string } | null>(null);
  const [pendingDateChange, setPendingDateChange] = useState<{ task: any, newDate: string } | null>(null);
  const [addSubtaskWarning, setAddSubtaskWarning] = useState<{ parentTaskId: string, blockId?: string, overrideDate?: string } | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<{
    entityId: string;
    parentTaskId: string;
    subtaskId: string | null;
    startTime: string;
    accumulatedSeconds: number;
    title: string;
  } | null>(null);
  const [showTimePanel, setShowTimePanel] = useState<{ taskId: string, subtaskId: string | null } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [meetings, setMeetings] = useState<DelegationMeeting[]>([]);

  // --- Selection Mode State ---
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkDelegateModal, setBulkDelegateModal] = useState(false);
  const [bulkDateModal, setBulkDateModal] = useState(false);
  const [bulkTimeModal, setBulkTimeModal] = useState(false);
  
  // Search filters
  const [searchText, setSearchText] = useState('');
  const [searchFilters, setSearchFilters] = useState({
    tags: [] as string[],
    status: 'all' as 'all' | 'pending' | 'completed',
    taskType: 'all' as 'all' | 'core' | 'adhoc',
    dueDateRange: { start: '', end: '' },
    createdRange: { start: '', end: '' },
    completedRange: { start: '', end: '' },
    recurrence: 'all' as 'all' | 'recurring' | 'instances' | 'manual',
    hasEstimatedTime: false,
    estimatedTimeRange: { min: 0, max: 999 }
  });

  // Helper: Toggle selection mode
  const toggleSelectionMode = () => {
    setSelectionMode(prev => {
      if (prev) {
        // Salir de modo selección → limpiar seleccionados
        setSelectedTaskIds(new Set());
      }
      return !prev;
    });
  };

  // Helper: Toggle task selection
  const toggleTaskSelection = (taskId: string, autoSelectSubtasks = false) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        // Desmarcar
        next.delete(taskId);
        // Si tiene subtareas, también desmarcarlas
        const task = tasks[taskId];
        if (task?.subtasks) {
          task.subtasks.forEach(subId => next.delete(subId));
        }
      } else {
        // Marcar
        next.add(taskId);
        // Auto-seleccionar subtareas si es contenedor
        if (autoSelectSubtasks) {
          const task = tasks[taskId];
          if (task?.subtasks && task.subtasks.length > 0) {
            task.subtasks.forEach(subId => {
              const sub = tasks[subId];
              if (sub && !sub.isDeleted) {
                next.add(subId);
              }
            });
          }
        }
      }
      return next;
    });
  };

  // Helper: Bulk actions
  const bulkUpdateTasks = (updates: Partial<Task>) => {
    const timestamp = new Date().toISOString();
    setTasks(prev => {
      const next = { ...prev };
      selectedTaskIds.forEach(id => {
        if (next[id]) {
          next[id] = { ...next[id], ...updates, modifiedAt: timestamp };
        }
      });
      return next;
    });

    // Persistir en Supabase
    selectedTaskIds.forEach(id => {
      const supabaseUpdates: any = { modified_at: timestamp };
      if (updates.status !== undefined) supabaseUpdates.status = updates.status;
      if (updates.completedAt !== undefined) supabaseUpdates.completed_at = updates.completedAt || null;
      if (updates.dueDate !== undefined) supabaseUpdates.due_date = updates.dueDate || null;
      if (updates.tags !== undefined) supabaseUpdates.tags = updates.tags;
      if (updates.estimatedMinutes !== undefined) supabaseUpdates.estimated_minutes = updates.estimatedMinutes;
      if (updates.delegation !== undefined) supabaseUpdates.delegation = updates.delegation || null;

      supabase.from('tasks').update(supabaseUpdates).eq('id', id).then(({ error }) => {
        if (error) console.error('[SUPABASE] Error bulk update:', error);
      });
    });

    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  };

  const bulkDeleteTasks = () => {
    const timestamp = new Date().toISOString();
    setTasks(prev => {
      const next = { ...prev };
      selectedTaskIds.forEach(id => {
        if (next[id]) {
          next[id] = { ...next[id], isDeleted: true, modifiedAt: timestamp };
        }
      });
      return next;
    });

    // Persistir en Supabase
    selectedTaskIds.forEach(id => {
      supabase.from('tasks').update({
        is_deleted: true,
        modified_at: timestamp
      }).eq('id', id).then(({ error }) => {
        if (error) console.error('[SUPABASE] Error bulk delete:', error);
      });
    });

    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  };

  const bulkDuplicateTasks = () => {
    const timestamp = new Date().toISOString();
    const duplicates: Task[] = [];
    const idMapping = new Map<string, string>(); // oldId -> newId

    // Función recursiva para duplicar tarea y sus subtareas
    const duplicateTaskRecursive = (original: Task, newParentId: string | null = null): Task | null => {
      if (!original || original.isDeleted) return null;

      const newId = `t-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      idMapping.set(original.id, newId);

      const duplicate: Task = {
        ...original,
        id: newId,
        title: newParentId ? original.title : `${original.title} (copia)`, // Solo añadir (copia) a la raíz
        parentTaskId: newParentId,
        status: 'pending',
        createdAt: timestamp,
        modifiedAt: timestamp,
        completedAt: undefined,
        subtasks: [], // Se llenarán con los IDs nuevos
      };

      return duplicate;
    };

    setTasks(prev => {
      const next = { ...prev };
      
      selectedTaskIds.forEach(id => {
        const original = prev[id];
        if (!original || original.isDeleted) return;

        // Duplicar tarea raíz
        const rootDuplicate = duplicateTaskRecursive(original);
        if (!rootDuplicate) return;

        next[rootDuplicate.id] = rootDuplicate;
        duplicates.push(rootDuplicate);

        // Duplicar subtareas recursivamente
        if (original.subtasks && original.subtasks.length > 0) {
          const newSubtaskIds: string[] = [];

          original.subtasks.forEach(subId => {
            const subOriginal = prev[subId];
            if (!subOriginal) return;

            const subDuplicate = duplicateTaskRecursive(subOriginal, rootDuplicate.id);
            if (!subDuplicate) return;

            newSubtaskIds.push(subDuplicate.id);
            next[subDuplicate.id] = subDuplicate;
            duplicates.push(subDuplicate);
          });

          rootDuplicate.subtasks = newSubtaskIds;
          next[rootDuplicate.id] = rootDuplicate;
        }
      });

      return next;
    });

    // Persistir TODAS las tareas duplicadas en Supabase
    duplicates.forEach(task => {
      supabase.from('tasks').insert({
        id: task.id,
        block_id: task.blockId,
        parent_task_id: task.parentTaskId || null,
        template_id: task.templateId || null,
        instance_date: task.instanceDate || null,
        title: task.title,
        notes: task.notes || '',
        priority: task.priority,
        status: task.status,
        due_date: task.dueDate || null,
        due_time: task.dueTime || null,
        completed_at: null,
        estimated_minutes: task.estimatedMinutes || 0,
        actual_minutes: task.actualMinutes || 0,
        total_estimated_combo: task.totalEstimatedCombo || 0,
        total_registered_combo: task.totalRegisteredCombo || 0,
        tags: task.tags || [],
        order: task.order || 0,
        is_template: task.isTemplate || false,
        is_active: task.isActive !== false,
        is_exception: task.isException || false,
        is_deleted: false,
        is_expanded: task.isExpanded || false,
        task_type: task.taskType || 'core',
        recurrence: task.recurrence || null,
        delegation: task.delegation || null,
        created_at: timestamp,
        modified_at: timestamp,
        deleted_at: null
      }).then(({ error }) => {
        if (error) console.error('[SUPABASE] Error duplicando tarea:', error);
      });
    });

    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  };

  // Toggle theme
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (isDarkMode) {
      root.classList.remove('light');
      root.classList.add('dark');
      body.classList.remove('light');
      body.classList.add('dark');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
      body.classList.remove('dark');
      body.classList.add('light');
    }
    localStorage.setItem('workmanager-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);
 
  // --- Initialization & Sync ---
  // Carga inicial desde Supabase
  useSupabase({ setBlocks, setTasks, setPeople, setIsDataLoaded });
 
  // Guardado automático desactivado - ahora se guarda directamente en Supabase en cada operación
  // useEffect(() => {
  //   if (!isDataLoaded) return;
  //   localStorage.setItem(STORAGE_KEY, JSON.stringify({ blocks, tasks: tasksToSave, timeEntries, activeTimer, people, meetings }));
  // }, [blocks, tasks, timeEntries, activeTimer, people, meetings, isDataLoaded]);
 
  const handleAddPerson = async (person: Person) => {
    try {
      // Verificar si ya existe (por nombre, case-insensitive)
      const existing = people.find(p => p.name.toLowerCase() === person.name.toLowerCase());
      if (existing) {
        console.log('[SUPABASE] Person already exists:', person.name);
        return; // No crear duplicado
      }
      
      // Insertar en Supabase
      const { data, error } = await supabase
        .from('persons')
        .insert({
          id: person.id,
          name: person.name,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Actualizar estado local
      setPeople((prev: Person[]) => [...prev, person]);
      console.log('[SUPABASE] Person created:', person.name);
    } catch (e) {
      console.error('[SUPABASE] Error creating person:', e);
      // Aún así actualizar estado local para no bloquear UX (solo si no existe)
      const existing = people.find(p => p.name.toLowerCase() === person.name.toLowerCase());
      if (!existing) {
        setPeople((prev: Person[]) => [...prev, person]);
      }
    }
  };

  const handleRenamePerson = async (id: string, name: string) => {
    try {
      // Actualizar en Supabase
      const { error } = await supabase
        .from('persons')
        .update({ name })
        .eq('id', id);

      if (error) throw error;

      // Actualizar estado local
      setPeople((prev: Person[]) => prev.map((p: Person) => p.id === id ? { ...p, name } : p));
      console.log('[SUPABASE] Person renamed:', name);
    } catch (e) {
      console.error('[SUPABASE] Error renaming person:', e);
      // Aún así actualizar estado local
      setPeople((prev: Person[]) => prev.map((p: Person) => p.id === id ? { ...p, name } : p));
    }
  };

  const handleDeletePerson = async (id: string) => {
    try {
      // Eliminar en Supabase
      const { error } = await supabase
        .from('persons')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Actualizar estado local
      setPeople((prev: Person[]) => prev.filter((p: Person) => p.id !== id));
      
      // Limpiar delegaciones de tareas
      setTasks(prev => {
        const updated = { ...prev };
        Object.values(updated).forEach((t: Task) => {
          if (t.delegation?.personId === id) {
            updated[t.id] = { ...t, delegation: undefined };
          }
        });
        return updated;
      });
      
      console.log('[SUPABASE] Person deleted');
    } catch (e) {
      console.error('[SUPABASE] Error deleting person:', e);
      // Aún así actualizar estado local
      setPeople((prev: Person[]) => prev.filter((p: Person) => p.id !== id));
      setTasks(prev => {
        const updated = { ...prev };
        Object.values(updated).forEach((t: Task) => {
          if (t.delegation?.personId === id) {
            updated[t.id] = { ...t, delegation: undefined };
          }
        });
        return updated;
      });
    }
  };

  const handleResetData = () => {
    if (confirm("¿Estás seguro de que quieres reiniciar todos los datos?")) {
      localStorage.removeItem(STORAGE_KEY);
      setBlocks(INITIAL_BLOCKS);
      setTasks(MOCK_TASKS);
      setCurrentView('dashboard');
      window.location.reload();
    }
  };
 
  const handleToggleExpandTask = (taskId: string) => {
    const timestamp = new Date().toISOString();
    const task = tasks[taskId];
    if (!task) {
      console.error('[EXPAND] Task not found:', taskId);
      return;
    }

    const newExpanded = task.isExpanded !== undefined ? !task.isExpanded : true;
    console.log('[EXPAND] Toggling', taskId, 'from', task.isExpanded, 'to', newExpanded);
    
    // Actualizar state
    setTasks(prev => ({
      ...prev,
      [taskId]: {
        ...prev[taskId],
        isExpanded: newExpanded,
        modifiedAt: timestamp
      }
    }));

    // Persistir en Supabase
    supabase.from('tasks').update({
      is_expanded: newExpanded,
      modified_at: timestamp
    }).eq('id', taskId).then(({ error }) => {
      if (error) console.error('[SUPABASE] Error actualizando isExpanded:', error);
      else console.log('[SUPABASE] isExpanded actualizado:', taskId, newExpanded);
    });
  };
 
  const handleExpandAllInBlock = (blockId: string, expand: boolean) => {
    const updatedTasks = { ...tasks };
    Object.values(updatedTasks).forEach((t: Task) => {
      if (t.blockId === blockId) {
        t.isExpanded = expand;
      }
    });
    setTasks(updatedTasks);
  };
 
  // Generación de instancias de tareas recurrentes
  useGeneration({ tasks, isDataLoaded, setTasks });
 
  // --- Handlers ---
  const handleUpdateTasksOrder = (orderedTasks: Task[]) => {
    const updated = { ...tasks };
    orderedTasks.forEach((t, i) => {
      updated[t.id] = { ...updated[t.id], order: i, modifiedAt: new Date().toISOString() };
    });
    setTasks(updated);
  };
 
  const handleUpdateSubtasksOrder = (parentId: string, subtaskIds: string[]) => {
    setTasks(prev => ({
      ...prev,
      [parentId]: {
        ...prev[parentId],
        subtasks: subtaskIds,
        modifiedAt: new Date().toISOString()
      }
    }));
  };
 
  const handleEditTaskRequest = (taskId: string | null) => {
    if (taskId === null) {
      setEditingTaskId(null);
      setInlineEditingTaskId(null);
      return;
    }
    let task = tasks[taskId];
    if (!task) {
      task = dashboardTasks.find(t => t.id === taskId);
      if (task) {
        // Materialize it in main state to allow editing
        setTasks(prev => ({ ...prev, [taskId]: task! }));
      }
    }
 
    if (task?.templateId) {
      setRecurrenceAction({ taskId, type: 'edit', ruleId: task.templateId });
    } else {
      setEditingTaskId(taskId);
    }
  };
 
  const handleDeleteTaskRequest = (taskId: string) => {
    let task = tasks[taskId];
    if (!task) {
      task = dashboardTasks.find(t => t.id === taskId);
    }
 
    // Si es una subtarea, buscamos a su padre para materializarla si es necesario
    if (task?.parentTaskId && !tasks[task.parentTaskId]) {
      const parentTask = dashboardTasks.find(t => t.id === task!.parentTaskId);
      if (parentTask) {
        setTasks(prev => ({ ...prev, [parentTask.id]: parentTask }));
      }
    }
 
    if (task?.templateId) {
      // Es una instancia → modal de recurrencia
      setRecurrenceAction({ taskId, type: 'delete', ruleId: task.templateId });
    } else if (task?.isTemplate && (task?.recurrence || (task?.subtasks && task.subtasks.some((subId: string) => tasks[subId]?.recurrence)))) {
      // Es un template recurrente → confirmar borrado de toda la serie
      if (confirm(`¿Borrar "${task.title}" y todas sus instancias futuras?`)) {
        handleDeleteTask(taskId);
      }
    } else {
      handleDeleteTask(taskId);
    }
  };
 
  const handleToggleStatus = (taskId: string) => {
    // Buscar la tarea en tasks o en allTasksMap (que incluye instancias generadas)
    const taskFromState = tasks[taskId];
    const taskFromAll = taskFromState || Object.values(tasks).find(t => t.id === taskId);
    const task = taskFromAll;

    if (!task) {
      console.error('[STATUS] Tarea no encontrada:', taskId);
      return;
    }

    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    const timestamp = new Date().toISOString();
    const tasksToUpsert: Task[] = [];

    const toggleRecursive = (targetTask: Task, status: 'pending' | 'completed') => {
      const isInstance = !!targetTask.templateId;
      const updated = {
        ...targetTask,
        status,
        isException: isInstance ? true : targetTask.isException,
        existsInSupabase: true,
        modifiedAt: timestamp,
        completedAt: status === 'completed' ? timestamp : undefined
      };
      tasksToUpsert.push(updated);

      // Buscar subtareas recursivamente
      (targetTask.subtasks || []).forEach(sid => {
        const sub = tasks[sid];
        if (sub) toggleRecursive(sub, status);
      });
    };

    toggleRecursive(task, newStatus);

    // Actualizar state local
    setTasks(prev => {
      const next = { ...prev };
      tasksToUpsert.forEach(t => { next[t.id] = t; });
      return next;
    });

    // Persistir en Supabase
    tasksToUpsert.forEach(t => {
      console.log('[STATUS] Guardando:', t.id, t.status, 'templateId:', t.templateId);
      if (t.templateId) {
        // Instancias subtarea (tienen parentTaskId): no guardar parent_task_id en BD
        // Su jerarquía se reconstruye desde el contenedor padre al cargar
        // Solo guardar parent_task_id si es una instancia raíz (sin padre)
        supabase.from('tasks').upsert({
          id: t.id,
          block_id: t.blockId,
          parent_task_id: null, // Siempre null — jerarquía se reconstruye via template_id
          template_id: t.templateId,
          instance_date: t.instanceDate || null,
          title: t.title,
          notes: t.notes || '',
          priority: t.priority || 'medium',
          status: t.status,
          due_date: t.dueDate || null,
          due_time: t.dueTime || null,
          completed_at: t.completedAt || null,
          estimated_minutes: t.estimatedMinutes || 0,
          actual_minutes: t.actualMinutes || 0,
          total_estimated_combo: t.totalEstimatedCombo || 0,
          total_registered_combo: t.totalRegisteredCombo || 0,
          tags: t.tags || [],
          order: t.order || 0,
          is_template: false,
          is_active: true,
          is_exception: true,
          is_deleted: false,
          is_expanded: t.isExpanded || false,
          task_type: t.taskType || 'core',
          recurrence: null,
          delegation: t.delegation || null,
          created_at: t.createdAt || timestamp,
          modified_at: timestamp,
        }, { onConflict: 'id' }).then(({ error }) => {
          if (error) console.error('[SUPABASE] Error upsert instancia:', t.id, error);
          else console.log('[SUPABASE] Instancia guardada OK:', t.id, t.status);
        });
      } else {
        // Tarea normal: update simple
        supabase.from('tasks').update({
          status: t.status,
          completed_at: t.completedAt || null,
          modified_at: timestamp
        }).eq('id', t.id).then(({ error }) => {
          if (error) console.error('[SUPABASE] Error update tarea:', t.id, error);
          else console.log('[SUPABASE] Tarea actualizada OK:', t.id, t.status);
        });
      }
    });
  };
 
  const handleAddTask = (parentTaskId: string | null = null, blockId?: string, overrideDate?: string, defaultPersonId?: string) => {
    // Si el padre tiene fecha, etiqueta, recurrencia, hora o delegación y no tiene subtareas aún → mostrar aviso de conversión a contenedor
    if (parentTaskId && tasks[parentTaskId]) {
      const parent = tasks[parentTaskId];
      const hasDate = !!parent.dueDate;
      const hasTag = parent.tags && parent.tags.length > 0;
      const hasRecurrence = !!parent.recurrence;
      const hasTime = !!parent.dueTime;
      const hasDelegation = !!parent.delegation;
      if ((hasDate || hasTag || hasRecurrence || hasTime || hasDelegation) && (!parent.subtasks || parent.subtasks.length === 0)) {
        setAddSubtaskWarning({ parentTaskId, blockId, overrideDate });
        return;
      }
    }
    return doAddTask(parentTaskId, blockId, overrideDate, defaultPersonId);
  };

  const doAddTask = (parentTaskId: string | null = null, blockId?: string, overrideDate?: string, defaultPersonId?: string) => {
    const id = `t-${Date.now()}`;
    const timestamp = new Date().toISOString();
    
    let finalBlockId = blockId;
    let isTemplate = false;
    
    // Si se pasa un parentId, heredamos su bloque si no se especifica uno y su estado de template
    if (parentTaskId && tasks[parentTaskId]) {
      const parent = tasks[parentTaskId];
      if (!finalBlockId) finalBlockId = parent.blockId;
      isTemplate = parent.isTemplate || false;
    }
 
    // Fallback al bloque seleccionado globalmente o al primero disponible
    if (!finalBlockId) {
      finalBlockId = selectedBlockId || (blocks.length > 0 ? blocks[0].id : 'b1');
    }
 
    const newTask: Task = {
      id,
      blockId: finalBlockId,
      title: '',
      notes: '',
      priority: 'media',
      status: 'pending',
      dueDate: isTemplate ? null : (overrideDate || activeDate),
      dueTime: '',
      parentTaskId,
      ...(defaultPersonId ? { delegation: { personId: defaultPersonId, delegatedAt: formatLocalISO(new Date()) } } : {}),
      subtasks: [],
      estimatedMinutes: 0,
      tags: [],
      order: 0,
      createdAt: timestamp,
      modifiedAt: timestamp,
      attachments: [],
      isExpanded: true,
      isTemplate
    };
 
    const updatedTasks = { ...tasks, [id]: newTask };
    if (parentTaskId && updatedTasks[parentTaskId]) {
      const isFirstSubtask = (updatedTasks[parentTaskId].subtasks || []).length === 0;
      updatedTasks[parentTaskId] = {
        ...updatedTasks[parentTaskId],
        subtasks: [...(updatedTasks[parentTaskId].subtasks || []), id],
        isExpanded: true,
        // Quitar fecha y tags del padre cuando tiene su primera subtarea
        dueDate: isFirstSubtask ? null : updatedTasks[parentTaskId].dueDate,
        tags: isFirstSubtask ? [] : updatedTasks[parentTaskId].tags,
        estimatedMinutes: isFirstSubtask ? 0 : updatedTasks[parentTaskId].estimatedMinutes,
        modifiedAt: timestamp
      };
    }
    setTasks(updatedTasks);

    // --- Sync to Supabase ---
    (async () => {
      try {
        // Si el padre es una instancia en memoria (id empieza por 'inst-'),
        // NO existe en Supabase → usar el templateId del padre como parent_task_id
        // para evitar FK constraint violation
        let supabaseParentId = newTask.parentTaskId || null;
        if (supabaseParentId && supabaseParentId.startsWith('inst-')) {
          const parentInstance = tasks[supabaseParentId];
          if (parentInstance?.templateId) {
            supabaseParentId = parentInstance.templateId;
            // También actualizar en memoria
            setTasks(prev => ({
              ...prev,
              [newTask.id]: { ...prev[newTask.id], parentTaskId: supabaseParentId }
            }));
          } else {
            supabaseParentId = null; // Fallback: sin padre en Supabase
          }
        }

        const dbTask = {
          id: newTask.id,
          block_id: newTask.blockId,
          title: newTask.title || '',
          notes: newTask.notes || '',
          priority: newTask.priority,
          status: newTask.status,
          due_date: newTask.dueDate || null,
          due_time: newTask.dueTime || null,
          estimated_minutes: newTask.estimatedMinutes || 0,
          actual_minutes: newTask.actualMinutes || 0,
          tags: newTask.tags || [],
          order: newTask.order || 0,
          is_template: newTask.isTemplate || false,
          is_active: true,
          is_deleted: false,
          parent_task_id: supabaseParentId,
          template_id: newTask.templateId || null,
          instance_date: newTask.instanceDate || null,
          recurrence: newTask.recurrence || null,
          delegation: newTask.delegation || null,
          created_at: newTask.createdAt,
          modified_at: newTask.modifiedAt
        };
        
        const { error } = await supabase.from('tasks').insert([dbTask]);
        if (error) throw error;
        console.log('[SUPABASE] Task created:', newTask.id);
      } catch (e) {
        console.error('[SUPABASE] Error creating task:', e);
      }
    })();

    // Always open modal for root tasks, inline for subtasks
    if (!parentTaskId) {
      setTimeout(() => setEditingTaskId(id), 50);
    } else {
      setInlineEditingTaskId(id);
    }
    return id;
  };
 
  const handleUpdateTask = (updatedTask: Task) => {
    const isException = updatedTask.templateId && 
      updatedTask.instanceDate && 
      updatedTask.dueDate !== updatedTask.instanceDate;
    
    setTasks(prev => {
      const updated = { ...prev };
      const timestamp = new Date().toISOString();

      if (isException && updatedTask.parentTaskId && updatedTask.instanceDate) {
        const newDate = updatedTask.dueDate;
        const oldDate = updatedTask.instanceDate;
        
        // 1. Obtener instancia padre original
        const oldParent = updated[updatedTask.parentTaskId];
        
        if (oldParent) {
          // 2. Quitar esta subtarea del padre original
          const newParentSubtasks = (oldParent.subtasks || []).filter(
            sid => sid !== updatedTask.id
          );
          
          // Si el padre queda sin subtareas Y es una instancia generada NO excepción, eliminarlo
          // Las excepciones se mantienen aunque queden vacías (el usuario las movió explícitamente)
          if (newParentSubtasks.length === 0 && oldParent.templateId && !oldParent.isException) {
            delete updated[oldParent.id];
          } else {
            updated[oldParent.id] = {
              ...oldParent,
              subtasks: newParentSubtasks,
              modifiedAt: timestamp
            };
          }

          // 3. Crear o actualizar instancia padre en el nuevo día
          const newParentId = oldParent.templateId 
            ? `inst-${oldParent.templateId}-${newDate}`
            : `inst-${oldParent.id}-${newDate}`;
          
          const existingNewParent = updated[newParentId];
          const newSubtaskId = `inst-${updatedTask.templateId}-${newDate}`;
          
          if (existingNewParent) {
            // Ya existe padre en nuevo día → añadir subtarea
            updated[newParentId] = {
              ...existingNewParent,
              subtasks: [...(existingNewParent.subtasks || []), newSubtaskId],
              modifiedAt: timestamp
            };
          } else {
            // Crear nuevo padre en el nuevo día
            const parentTemplate = oldParent.templateId 
              ? updated[oldParent.templateId] 
              : oldParent;
            updated[newParentId] = {
              ...(parentTemplate || oldParent),
              id: newParentId,
              templateId: oldParent.templateId || oldParent.id,
              dueDate: newDate,
              instanceDate: newDate,
              isTemplate: false,
              isException: true,
              subtasks: [newSubtaskId],
              status: 'pending',
              modifiedAt: timestamp,
              createdAt: timestamp
            };
          }

          // 4. Crear la subtarea excepción en el nuevo día
          updated[newSubtaskId] = {
            ...updatedTask,
            id: newSubtaskId,
            dueDate: newDate,
            instanceDate: oldDate,
            parentTaskId: newParentId,
            isException: true,
            modifiedAt: timestamp
          };

          // 5. Eliminar la subtarea del día original
          delete updated[updatedTask.id];
          
          return updated;
        }
      }

      // Para tareas normales o instancias sin cambio de fecha.
      // Si es una instancia (templateId presente), marcar isException: true para
      // que se persista en localStorage (tags, título, tiempo, etc.).
      // generateInstances está protegido con !t.templateId así que esto no genera cascadas.
      updated[updatedTask.id] = { 
        ...updatedTask, 
        isException: updatedTask.templateId ? true : (isException ? true : updatedTask.isException),
        modifiedAt: timestamp
      };

      // CRÍTICO: si esta subtarea tiene recurrencia, el padre debe ser isTemplate:true y dueDate:null
      if (updatedTask.recurrence && updatedTask.parentTaskId && updated[updatedTask.parentTaskId]) {
        let parent = updated[updatedTask.parentTaskId];
        
        // Si el padre es una INSTANCIA (tiene templateId), redirigir al template original
        // Esto ocurre cuando se añade subtarea recurrente desde el Dashboard
        if (parent.templateId && updated[parent.templateId]) {
          const realParentTemplateId = parent.templateId;
          const realParent = updated[realParentTemplateId];
          
          // Reconectar la subtarea al template padre real
          updated[updatedTask.id] = {
            ...updated[updatedTask.id],
            parentTaskId: realParentTemplateId
          };
          
          // Actualizar subtasks del template padre
          if (!realParent.subtasks.includes(updatedTask.id)) {
            updated[realParentTemplateId] = {
              ...realParent,
              subtasks: [...realParent.subtasks, updatedTask.id]
            };
          }
          
          // Quitar del array de subtasks de la instancia
          updated[parent.id] = {
            ...parent,
            subtasks: (parent.subtasks || []).filter((id: string) => id !== updatedTask.id)
          };

          // Persistir el cambio de parentTaskId en Supabase
          setTimeout(() => {
            supabase.from('tasks')
              .update({ parent_task_id: realParentTemplateId })
              .eq('id', updatedTask.id)
              .then(({ error }) => {
                if (error) console.error('[SUPABASE] Error reconectando subtarea al template:', error);
                else console.log('[SUPABASE] Subtarea reconectada al template padre:', realParentTemplateId);
              });
          }, 0);
          
          parent = realParent; // Usar el template real para el resto de la lógica
        }
        
        if (!parent.isTemplate || parent.dueDate) {
          // NO actualizar modifiedAt del padre para evitar bucle infinito en templateKey
          updated[parent.id] = { ...parent, isTemplate: true, dueDate: null };
          setTimeout(() => {
            supabase.from('tasks')
              .update({ is_template: true, due_date: null })
              .eq('id', parent.id)
              .then(({ error }) => {
                if (error) console.error('[SUPABASE] Error propagando isTemplate al padre:', error);
                else console.log('[SUPABASE] Contenedor marcado isTemplate:', parent.title);
              });
          }, 0);
        }
      }

      // CRÍTICO: si una tarea raíz del Dashboard recibe recurrencia,
      // debe convertirse en template y crear una instancia para el día actual.
      // Sin esto, generateInstances no la procesa y desaparece al recargar.
      if (
        updatedTask.recurrence &&
        !updatedTask.parentTaskId &&
        !updatedTask.templateId &&
        !updatedTask.isTemplate
      ) {
        const instanceDate = updatedTask.dueDate || formatLocalISO(new Date());
        const instanceId = `inst-${updatedTask.id}-${instanceDate}`;
        const instanceTimestamp = new Date().toISOString();

        // Convertir la tarea en template
        updated[updatedTask.id] = {
          ...updatedTask,
          isTemplate: true,
          dueDate: null,
          dueTime: null,
          modifiedAt: instanceTimestamp
        };

        // Crear instancia para el día actual (sin recurrence - eso es del template)
        updated[instanceId] = {
          ...updatedTask,
          id: instanceId,
          templateId: updatedTask.id,
          dueDate: instanceDate,
          instanceDate,
          isTemplate: false,
          isException: true,
          existsInSupabase: true,
          recurrence: null, // Las instancias NO tienen recurrence, solo el template
          createdAt: instanceTimestamp,
          modifiedAt: instanceTimestamp
        };

        // Persistir template en Supabase
        setTimeout(() => {
          supabase.from('tasks')
            .update({ 
              is_template: true, 
              due_date: null, 
              due_time: null,
              recurrence: updatedTask.recurrence,
              modified_at: instanceTimestamp
            })
            .eq('id', updatedTask.id)
            .then(({ error }) => {
              if (error) console.error('[SUPABASE] Error convirtiendo a template:', error);
              else console.log('[SUPABASE] Tarea convertida a template:', updatedTask.title);
            });

          // Persistir instancia del día en Supabase
          supabase.from('tasks').upsert({
            id: instanceId,
            block_id: updatedTask.blockId,
            parent_task_id: null,
            template_id: updatedTask.id,
            instance_date: instanceDate,
            title: updatedTask.title,
            notes: updatedTask.notes || '',
            priority: updatedTask.priority || 'media',
            status: updatedTask.status,
            due_date: instanceDate,
            due_time: updatedTask.dueTime || null,
            estimated_minutes: updatedTask.estimatedMinutes || 0,
            actual_minutes: updatedTask.actualMinutes || 0,
            tags: updatedTask.tags || [],
            delegation: updatedTask.delegation || null,
            is_template: false,
            is_active: true,
            is_exception: true,
            is_deleted: false,
            recurrence: null, // Las instancias NO tienen recurrence
            created_at: instanceTimestamp,
            modified_at: instanceTimestamp
          }, { onConflict: 'id' }).then(({ error }) => {
            if (error) console.error('[SUPABASE] Error creando instancia del día:', error);
            else console.log('[SUPABASE] Instancia del día creada:', instanceId);
          });
        }, 0);
      }
      
      return updated;
    });
    setEditingTaskId(null);
    setInlineEditingTaskId(null);

    // --- Sync to Supabase ---
    (async () => {
      try {
        const isInstance = !!updatedTask.templateId;
        
        // Si parentTaskId apunta a una instancia en memoria (empieza por 'inst-'),
        // usar el templateId del padre para evitar FK constraint en Supabase
        let supabaseParentId = isInstance ? null : (updatedTask.parentTaskId || null);
        if (supabaseParentId && supabaseParentId.startsWith('inst-')) {
          const parentInstance = tasks[supabaseParentId];
          supabaseParentId = parentInstance?.templateId || null;
        }
        // Para instancias: parent_task_id null para evitar FK constraint
        // La jerarquía se reconstruye en memoria via generateInstances
        const dbTask = {
          id: updatedTask.id,
          block_id: updatedTask.blockId,
          title: updatedTask.title || '',
          notes: updatedTask.notes || '',
          priority: updatedTask.priority,
          status: updatedTask.status,
          due_date: updatedTask.dueDate || null,
          due_time: updatedTask.dueTime || null,
          completed_at: updatedTask.completedAt || null,
          estimated_minutes: updatedTask.estimatedMinutes || 0,
          actual_minutes: updatedTask.actualMinutes || 0,
          total_estimated_combo: updatedTask.totalEstimatedCombo || 0,
          total_registered_combo: updatedTask.totalRegisteredCombo || 0,
          tags: updatedTask.tags || [],
          order: updatedTask.order || 0,
          is_template: isInstance ? false : (updatedTask.isTemplate || false),
          is_active: updatedTask.isActive !== false,
          is_exception: isInstance ? true : (updatedTask.isException || false), // Siempre true para instancias
          is_deleted: updatedTask.isDeleted || false,
          is_expanded: updatedTask.isExpanded,
          task_type: updatedTask.taskType,
          parent_task_id: supabaseParentId,
          template_id: updatedTask.templateId || null,
          instance_date: updatedTask.instanceDate || null,
          recurrence: isInstance ? null : (updatedTask.recurrence || null),
          delegation: updatedTask.delegation || null,
          created_at: updatedTask.createdAt,
          modified_at: new Date().toISOString()
        };

        const { error } = await supabase.from('tasks').upsert([dbTask], { onConflict: 'id' });
        if (error) throw error;
        console.log('[SUPABASE] Task updated:', updatedTask.id, isInstance ? '(instancia excepción)' : '');
      } catch (e) {
        console.error('[SUPABASE] Error updating task:', e);
      }
    })();
  };
 
  // Subir nivel: la tarea sale de su padre y queda al mismo nivel que su padre
  const handlePromoteTask = (taskId: string) => {
    setTasks(prev => {
      const task = prev[taskId];
      if (!task || !task.parentTaskId) return prev; // Ya es nivel 1, no puede subir

      const parentTask = prev[task.parentTaskId];
      if (!parentTask) return prev;
      const grandParentId = parentTask.parentTaskId || null;

      const newTasks = { ...prev };

      // 1. Quitar la tarea del array de subtareas del padre
      newTasks[parentTask.id] = {
        ...parentTask,
        subtasks: parentTask.subtasks.filter(sid => sid !== taskId),
        modifiedAt: new Date().toISOString()
      };

      // 2. Añadir la tarea al abuelo (o a nivel raíz si no hay abuelo)
      if (grandParentId && newTasks[grandParentId]) {
        const grandParent = newTasks[grandParentId];
        // Insertar justo después del padre en el array del abuelo
        const parentIdx = grandParent.subtasks.indexOf(parentTask.id);
        const newSubtasks = [...grandParent.subtasks];
        newSubtasks.splice(parentIdx + 1, 0, taskId);
        newTasks[grandParentId] = {
          ...grandParent,
          subtasks: newSubtasks,
          modifiedAt: new Date().toISOString()
        };
      }

      // 3. Actualizar la tarea con nuevo parentTaskId
      newTasks[taskId] = {
        ...task,
        parentTaskId: grandParentId,
        modifiedAt: new Date().toISOString()
      };

      return newTasks;
    });
  };

  // Bajar nivel: la tarea se convierte en subtarea de la tarea inmediatamente anterior
  const handleDemoteTask = (taskId: string) => {
    setTasks(prev => {
      const task = prev[taskId];
      if (!task) return prev;

      // No permitir bajar más de nivel 3
      const currentLevel = task.parentTaskId
        ? (prev[task.parentTaskId]?.parentTaskId ? 3 : 2)
        : 1;
      if (currentLevel >= 3) return prev;

      // Buscar hermanos EN ORDEN DEL ARRAY (orden visual real)
      let siblingIds: string[] = [];
      if (task.parentTaskId && prev[task.parentTaskId]) {
        siblingIds = prev[task.parentTaskId].subtasks || [];
      } else {
        // Nivel raíz: usar el orden del campo order
        siblingIds = (Object.values(prev) as Task[])
          .filter(t => !t.parentTaskId && t.blockId === task.blockId && !t.isTemplate && !t.isDeleted)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(t => t.id);
      }

      const idx = siblingIds.indexOf(taskId);
      if (idx <= 0) return prev; // Es la primera, no hay tarea arriba

      const aboveTaskId = siblingIds[idx - 1];
      const aboveTask = prev[aboveTaskId];
      if (!aboveTask) return prev;

      const newTasks = { ...prev };

      // 1. Quitar del padre actual (o de nivel raíz — no hace falta nada para raíz)
      if (task.parentTaskId && newTasks[task.parentTaskId]) {
        const parent = newTasks[task.parentTaskId];
        newTasks[task.parentTaskId] = {
          ...parent,
          subtasks: (parent.subtasks || []).filter(sid => sid !== taskId),
          modifiedAt: new Date().toISOString()
        };
      }

      // 2. Añadir como última subtarea de la tarea de arriba
      newTasks[aboveTaskId] = {
        ...aboveTask,
        subtasks: [...(aboveTask.subtasks || []), taskId],
        isExpanded: true,
        modifiedAt: new Date().toISOString()
      };

      // 3. Actualizar la tarea con nuevo padre
      newTasks[taskId] = {
        ...task,
        parentTaskId: aboveTaskId,
        modifiedAt: new Date().toISOString()
      };

      return newTasks;
    });
  };
 
  const handleDeleteTask = (taskId: string) => {
    const updatedTasks = { ...tasks };
    const task = updatedTasks[taskId];
    if (!task) return;
 
    if (task.parentTaskId && updatedTasks[task.parentTaskId]) {
      updatedTasks[task.parentTaskId] = {
        ...updatedTasks[task.parentTaskId],
        subtasks: updatedTasks[task.parentTaskId].subtasks.filter(id => id !== taskId)
      };
    }
 
    const removeRecursive = (id: string) => {
      const t = updatedTasks[id];
      if (!t) return;
      t.subtasks.forEach(sid => removeRecursive(sid));
      delete updatedTasks[id];
    };
 
    // Recoger todos los IDs a borrar antes de eliminar del state
    const idsToDelete: Task[] = [];
    const collectRecursive = (id: string) => {
      const t = updatedTasks[id];
      if (!t) return;
      idsToDelete.push(t);
      t.subtasks.forEach(sid => collectRecursive(sid));
    };
    collectRecursive(taskId);

    // Si es un template recurrente, también recoger y borrar todas sus instancias en memoria
    if (task.isTemplate && !task.templateId) {
      Object.values(updatedTasks).forEach((t: Task) => {
        if (!t || idsToDelete.find(d => d.id === t.id)) return;
        // Instancia directa del template
        if (t.templateId === taskId) {
          idsToDelete.push(t);
        }
        // Instancia de subtarea cuyo template tiene este padre
        if (t.templateId) {
          const tTemplate = updatedTasks[t.templateId];
          if (tTemplate && tTemplate.parentTaskId === taskId) {
            idsToDelete.push(t);
          }
        }
      });
    }

    removeRecursive(taskId);
    
    // Borrar instancias de memoria también
    idsToDelete.forEach(t => {
      if (t.id !== taskId) delete updatedTasks[t.id];
    });
    setTasks(updatedTasks);

    // --- Soft delete en Supabase para TODOS (tarea + subtareas) ---
    (async () => {
      const timestamp = new Date().toISOString();
      for (const t of idsToDelete) {
        try {
          if (t.templateId) {
            // Instancia generada: upsert con is_deleted
            await supabase.from('tasks').upsert({
              id: t.id,
              block_id: t.blockId,
              parent_task_id: null,
              template_id: t.templateId,
              instance_date: t.instanceDate || null,
              title: t.title,
              notes: t.notes || '',
              priority: t.priority || 'medium',
              status: t.status,
              due_date: t.dueDate || null,
              due_time: t.dueTime || null,
              completed_at: t.completedAt || null,
              estimated_minutes: t.estimatedMinutes || 0,
              actual_minutes: t.actualMinutes || 0,
              tags: t.tags || [],
              delegation: t.delegation || null,
              is_template: false,
              is_exception: true,
              is_deleted: true,
              deleted_at: timestamp,
              is_active: false,
              created_at: t.createdAt || timestamp,
              modified_at: timestamp
            }, { onConflict: 'id' });
          } else {
            // Tarea normal: update
            await supabase.from('tasks')
              .update({ is_deleted: true, deleted_at: timestamp })
              .eq('id', t.id);
          }
        } catch (e) {
          console.error('[SUPABASE] Error borrando:', t.id, e);
        }
      }
      console.log('[SUPABASE] Borradas', idsToDelete.length, 'tareas/instancias');
    })();
  };
 
  const handleDayChange = (offset: number) => {
    const current = parseLocalISO(activeDate);
    current.setDate(current.getDate() + offset);
    setActiveDate(formatLocalISO(current));
  };
 
  const handleAddRule = (blockId?: string) => {
    const id = `tmpl-${Date.now()}`;
    const newTemplate: Task = {
      id,
      blockId: blockId || (blocks.length > 0 ? blocks[0].id : 'b1'),
      title: '',
      notes: '',
      priority: 'media',
      status: 'pending',
      dueDate: null,
      subtasks: [],
      estimatedMinutes: 0,
      tags: [],
      order: 0,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      isTemplate: true,
      isActive: true
    };
    setTasks(prev => ({ ...prev, [id]: newTemplate }));
    setEditingRuleId(id);
  };
 
  const handleAddBlock = async () => {
    const id = `b-${Date.now()}`;
    const newBlock: WorkBlock = {
      id,
      name: '',
      color: COLORS.turquesa.main,
      pastelColor: COLORS.turquesa.pastel,
      icon: '🏢',
      isActive: true,
      order: blocks.length
    };
    
    try {
      // Guardar en Supabase
      const { error } = await supabase
        .from('work_blocks')
        .insert({
          id: newBlock.id,
          name: newBlock.name,
          color: newBlock.color,
          pastel_color: newBlock.pastelColor,
          icon: newBlock.icon,
          is_active: newBlock.isActive,
          order: newBlock.order
        });
      
      if (error) throw error;
      
      // Actualizar state local
      setBlocks(prev => [...prev, newBlock]);
      setEditingBlockId(id);
      console.log('[SUPABASE] Block created:', id);
    } catch (e) {
      console.error('[SUPABASE] Error creating block:', e);
    }
  };
 
  const handleUpdateBlock = async (updated: WorkBlock) => {
    try {
      // Guardar en Supabase
      const { error } = await supabase
        .from('work_blocks')
        .update({
          name: updated.name,
          color: updated.color,
          pastel_color: updated.pastelColor,
          icon: updated.icon,
          is_active: updated.isActive,
          order: updated.order
        })
        .eq('id', updated.id);
      
      if (error) throw error;
      
      // Actualizar state local
      setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
      setEditingBlockId(null);
      console.log('[SUPABASE] Block updated:', updated.id);
    } catch (e) {
      console.error('[SUPABASE] Error updating block:', e);
    }
  };
 
  const handleReorderBlocks = async (newOrder: WorkBlock[]) => {
    const updated = newOrder.map((b, i) => ({ ...b, order: i + 1 }));
    
    try {
      // Guardar cada bloque con su nuevo order en Supabase
      const promises = updated.map(block =>
        supabase
          .from('work_blocks')
          .update({ order: block.order })
          .eq('id', block.id)
      );
      
      await Promise.all(promises);
      
      // Actualizar state local
      setBlocks(updated);
      console.log('[SUPABASE] Blocks reordered');
    } catch (e) {
      console.error('[SUPABASE] Error reordering blocks:', e);
    }
  };
 
  const handleToggleBlockActive = async (id: string) => {
    const block = blocks.find(b => b.id === id);
    if (!block) return;
    
    const newIsActive = !block.isActive;
    
    try {
      // Guardar en Supabase
      const { error } = await supabase
        .from('work_blocks')
        .update({ is_active: newIsActive })
        .eq('id', id);
      
      if (error) throw error;
      
      // Actualizar state local
      setBlocks(prev => prev.map(b => b.id === id ? { ...b, isActive: newIsActive } : b));
      console.log('[SUPABASE] Block toggled:', id, newIsActive);
    } catch (e) {
      console.error('[SUPABASE] Error toggling block:', e);
    }
  };
 
  const handleDeleteBlock = (id: string) => {
    if (confirm('¿Eliminar este bloque y todas sus tareas/reglas asociadas?')) {
      setBlocks(prev => prev.filter(b => b.id !== id));
      setTasks(prev => {
        const newTasks = { ...prev };
        Object.keys(newTasks).forEach(taskId => {
          if (newTasks[taskId].blockId === id) delete newTasks[taskId];
        });
        return newTasks;
      });
    }
  };
 
  // --- Timer Handlers ---
  const handleStartTimer = (taskId: string, subtaskId: string | null = null) => {
    if (activeTimer) {
      if (!confirm("Ya hay un cronómetro activo. ¿Deseas pararlo y empezar este?")) return;
      // Note: In real app we would save the current one first. 
      // For this action, let's just stop it and discard or save. 
      // User said: "Si intenta iniciar otro, se le avisa con opción de parar el actual primero"
      handleStopTimer();
    }
    
    const task = tasks[taskId];
    if (!task) return;
    const targetEntity = subtaskId ? tasks[subtaskId] : task;
    const title = targetEntity?.title || "Tarea sin título";
 
    setActiveTimer({
      entityId: subtaskId || taskId,
      parentTaskId: taskId,
      subtaskId,
      startTime: new Date().toISOString(),
      accumulatedSeconds: 0,
      title
    });
  };
 
  const handleStopTimer = () => {
    if (!activeTimer) return;
    
    const start = new Date(activeTimer.startTime).getTime();
    const now = new Date().getTime();
    const elapsedSeconds = Math.floor((now - start) / 1000) + activeTimer.accumulatedSeconds;
    const minutes = Math.floor(elapsedSeconds / 60);
 
    if (minutes < 1) {
      if (confirm("El tiempo transcurrido es menor a 1 minuto. ¿Deseas descartarlo?")) {
        setActiveTimer(null);
        return;
      }
    }
 
    let note = prompt("Nota opcional para el registro de tiempo:", "");
    if (note === null) note = ""; // If cancelled, just proceed with empty note
 
    const newEntry: TimeEntry = {
      id: `te-${Date.now()}`,
      taskId: activeTimer.parentTaskId,
      subtaskId: activeTimer.subtaskId,
      date: formatLocalISO(new Date()),
      duration: Math.max(1, minutes),
      note,
      createdAt: new Date().toISOString(),
      source: 'timer'
    };
 
    setTimeEntries(prev => [...prev, newEntry]);
    setActiveTimer(null);
  };
 
  const handleManualTimeEntry = (taskId: string, subtaskId: string | null, minutes: number, date: string, note?: string) => {
    const newEntry: TimeEntry = {
      id: `te-${Date.now()}`,
      taskId,
      subtaskId,
      date,
      duration: minutes,
      note,
      createdAt: new Date().toISOString(),
      source: 'manual'
    };
    setTimeEntries(prev => [...prev, newEntry]);
  };
 
  const handleDeleteTimeEntry = (entryId: string) => {
    setTimeEntries(prev => prev.filter(e => e.id !== entryId));
  };
 
  const handleUpdateTimeEntry = (id: string, updates: Partial<TimeEntry>) => {
    setTimeEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  };
 
  // --- Computed ---
  const allActiveTasks = useMemo(() => Object.values(tasks).filter((t: Task) => !t.isDeleted && !t.isTemplate), [tasks]);
 
  const filteredTasks = useMemo(() => {
    let result = allActiveTasks;
    if (searchQuery) {
      result = result.filter((t: Task) => t.title.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return result;
  }, [allActiveTasks, searchQuery]);
 
  // --- Views ---
  const dashboardTasks = useMemo(() => {
    const activeBlockIds = new Set(blocks.filter(b => b && b.isActive).map(b => b.id));
    return filterTasksForDay(
      filteredTasks,
      tasks,
      activeBlockIds,
      activeDate,
      { hideCompleted: false, hideDelegatedNoTag: true }
    );
  }, [filteredTasks, blocks, activeDate, tasks]);
 
  const dashboardTasksMap = useMemo(() => {
    // Empezar con tasks filtradas (sin borradas, sin templates puros)
    const map: any = {};
    Object.values(tasks).forEach((t: Task) => {
      if (!t.isDeleted) map[t.id] = t;
    });
    
    // Añadir tareas raíz
    dashboardTasks.forEach(t => {
      map[t.id] = t;
      
      // Añadir subtareas del día activo (filtrar delegadas sin tag real)
      if (t.subtasks && t.subtasks.length > 0) {
        t.subtasks.forEach(subId => {
          const sub = tasks[subId];
          if (sub && sub.dueDate === activeDate) {
            // Filtro delegación en subtareas
            if (sub.delegation) {
              const tags = sub.tags || [];
              const hasRealTag = tags.some((tag: string) => tag !== 'resto');
              if (!hasRealTag) return; // no añadir delegadas sin tag
            }
            map[subId] = sub;
          }
        });
      }
    });
    
    return map;
  }, [tasks, dashboardTasks, activeDate]);
 
  // Loading state mientras carga desde Supabase
  if (!isDataLoaded) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-turquesa border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-text-secondary font-black uppercase tracking-widest text-sm">
            Cargando datos desde Supabase...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-main text-text-main flex flex-col md:flex-row font-sans relative">
      {/* Global Timer Bar */}
      <AnimatePresence>
        {activeTimer && (
          <motion.div 
            initial={{ y: -50 }}
            animate={{ y: 0 }}
            exit={{ y: -50 }}
            className="fixed top-0 left-0 right-0 h-10 bg-rosa z-[200] flex items-center justify-between px-6 shadow-lg"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
              <span className="text-[10px] font-black text-white uppercase tracking-widest truncate max-w-[200px]">
                {activeTimer.title}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <TimerDisplay startTime={activeTimer.startTime} accumulatedSeconds={activeTimer.accumulatedSeconds} />
              <button 
                onClick={handleStopTimer}
                className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-[10px] font-black text-white uppercase transition-all"
              >
                Parar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
 
      {/* Sidebar Navigation */}
      <nav className={`w-full md:w-20 lg:w-72 ${isDarkMode ? 'bg-bg-secondary' : 'bg-bg-secondary-light'} border-r ${isDarkMode ? 'border-border-main' : 'border-border-main-light'} flex flex-col py-6 shrink-0 transition-all duration-300`}>
        <div className="flex items-center gap-3 mb-6 px-6">
          <div className="w-10 h-10 bg-gradient-to-br from-turquesa to-azul rounded-2xl flex items-center justify-center text-white shadow-xl shadow-turquesa/20">
            <Zap size={22} fill="white" />
          </div>
          <div className="hidden lg:block overflow-hidden">
            <h1 className={`text-xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-text-main-light'} whitespace-nowrap`}>WM v18</h1>
            <p className={`text-[10px] ${isDarkMode ? 'text-text-secondary' : 'text-text-secondary-light'} uppercase font-bold tracking-widest leading-none`}>Enterprise Edition</p>
          </div>
        </div>

        {/* Theme Toggle */}
        <div className="px-6 mb-6">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`w-full flex items-center justify-between gap-3 p-3 rounded-2xl transition-all ${
              isDarkMode 
                ? 'bg-bg-main hover:bg-bg-card border border-border-main' 
                : 'bg-bg-card-light hover:bg-bg-secondary-light border border-border-main-light'
            }`}
          >
            <div className="flex items-center gap-3">
              {isDarkMode ? (
                <Moon size={18} className="text-azul" />
              ) : (
                <Sun size={18} className="text-turquesa" />
              )}
              <span className={`hidden lg:block text-sm font-bold ${isDarkMode ? 'text-white' : 'text-text-main-light'}`}>
                {isDarkMode ? 'Modo Oscuro' : 'Modo Claro'}
              </span>
            </div>
            <div className={`hidden lg:flex w-12 h-6 rounded-full relative transition-all ${isDarkMode ? 'bg-azul' : 'bg-turquesa'}`}>
              <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all ${isDarkMode ? 'left-0.5' : 'left-6'}`} />
            </div>
          </button>
        </div>
 
        <div className="flex flex-col gap-1 w-full px-4">
          <NavItem 
            active={currentView === 'dashboard'} 
            onClick={() => setCurrentView('dashboard')} 
            icon={<LayoutDashboard size={20} />} 
            label="Mi Día" 
          />
          <NavItem 
            active={currentView === 'blocks'} 
            onClick={() => setCurrentView('blocks')} 
            icon={<Grid2X2 size={20} />} 
            label="Bloques" 
          />
          <NavItem 
            active={currentView === 'calendar'} 
            onClick={() => setCurrentView('calendar')} 
            icon={<CalendarIcon size={20} />} 
            label="Calendario" 
          />
          <NavItem 
            active={currentView === 'delegadas'} 
            onClick={() => setCurrentView('delegadas')} 
            icon={<Users size={20} />} 
            label="Delegadas" 
          />
          <NavItem 
            active={currentView === 'search'} 
            onClick={() => setCurrentView('search')} 
            icon={<Search size={20} />} 
            label="Búsqueda" 
          />
        </div>
 
        <div className="mt-auto px-4">
          <div className="h-px bg-border-main/50 mb-6" />
          <NavItem 
            active={false} 
            onClick={handleResetData} 
            icon={<Settings size={20} />} 
            label="Configuración" 
          />
        </div>
      </nav>
 
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden max-w-full">
        {/* Header Bar */}
        <header className="h-20 dark:bg-bg-main bg-bg-main-light border-b dark:border-border-main border-border-main-light flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-6 flex-1">
            <div className="flex items-center gap-2 lg:hidden">
               <div className="w-8 h-8 bg-turquesa rounded-lg flex items-center justify-center text-white">
                 <Zap size={18} />
               </div>
            </div>
            <div className="relative max-w-sm w-full hidden sm:block">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 dark:text-text-secondary text-text-secondary-light" size={16} />
              <input 
                type="text" 
                placeholder="Buscar tareas, bloques..."
                className="w-full pl-11 pr-4 py-2.5 dark:bg-bg-secondary bg-white rounded-xl text-sm dark:text-text-main text-text-main-light border dark:border-border-main border-border-main-light focus:ring-2 focus:ring-turquesa/20 outline-none transition-all dark:placeholder:text-text-secondary/50 placeholder:text-text-secondary-light/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
 
          <div className="flex items-center gap-5">
            <button className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light transition-colors">
              <span className="w-2 h-2 bg-lima rounded-full animate-pulse" />
              Sincronizado
            </button>
            <div className="h-8 w-px dark:bg-border-main bg-border-main-light" />
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold leading-none dark:text-white text-text-main-light">Vanessa Carrión</p>
                <p className="text-[10px] dark:text-text-secondary text-text-secondary-light font-bold uppercase tracking-tighter">Pro Plan</p>
              </div>
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br dark:from-bg-secondary dark:to-bg-card from-bg-secondary-light to-bg-card-light border dark:border-border-main border-border-main-light flex items-center justify-center text-turquesa font-bold text-sm shadow-inner">
                VC
              </div>
            </div>
          </div>
        </header>
 
        {/* Content Container */}
        <div className="flex-1 overflow-y-auto p-4 md:p-10 custom-scrollbar dark:bg-bg-main bg-bg-main-light">
          <AnimatePresence mode="wait">
            {currentView === 'dashboard' && (
              <DashboardView 
                tasks={dashboardTasks} 
                allTasksMap={dashboardTasksMap}
                blocks={blocks}
                people={people}
                onAddPerson={handleAddPerson}
                onRenamePerson={handleRenamePerson}
                onDeletePerson={handleDeletePerson}
                onRecurrenceDateChange={(task: any, newDate: string) => setPendingDateChange({ task, newDate })}
                timeEntries={timeEntries}
                activeTimer={activeTimer}
                onStartTimer={handleStartTimer}
                onStopTimer={handleStopTimer}
                onToggle={handleToggleStatus} 
                onDelete={handleDeleteTaskRequest}
                onAddTask={handleAddTask}
                onUpdateTask={handleUpdateTask}
                onEditTask={handleEditTaskRequest}
                editingTaskId={editingTaskId}
                inlineEditingTaskId={inlineEditingTaskId}
                setInlineEditingTaskId={setInlineEditingTaskId}
                onOpenTimePanel={(taskId: string, subtaskId: string | null) => setShowTimePanel({ taskId, subtaskId })}
                activeDate={activeDate}
                onSetDate={setActiveDate}
                onDayChange={handleDayChange}
                onReorderTasks={handleUpdateTasksOrder}
                onReorderSubtasks={handleUpdateSubtasksOrder}
                onToggleExpand={handleToggleExpandTask}
                onPromote={handlePromoteTask}
                onDemote={handleDemoteTask}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleTaskSelection={toggleTaskSelection}
                onToggleSelectionMode={toggleSelectionMode}
                bulkUpdateTasks={bulkUpdateTasks}
                bulkDeleteTasks={bulkDeleteTasks}
                bulkDuplicateTasks={bulkDuplicateTasks}
                bulkDelegateModal={bulkDelegateModal}
                setBulkDelegateModal={setBulkDelegateModal}
                bulkDateModal={bulkDateModal}
                setBulkDateModal={setBulkDateModal}
                bulkTimeModal={bulkTimeModal}
                setBulkTimeModal={setBulkTimeModal}
              />
            )}
            {currentView === 'blocks' && (
              <BlocksManagerView 
                blocks={blocks} 
                tasks={Object.values(tasks).filter((t: Task) => !t.isDeleted)}
                allTasksMap={tasks}
                people={people}
                onAddPerson={handleAddPerson}
                onRenamePerson={handleRenamePerson}
                onDeletePerson={handleDeletePerson}
                onRecurrenceDateChange={(task: any, newDate: string) => setPendingDateChange({ task, newDate })}
                timeEntries={timeEntries}
                activeTimer={activeTimer}
                onStartTimer={handleStartTimer}
                onStopTimer={handleStopTimer}
                onAddBlock={handleAddBlock} 
                onDelete={handleDeleteTaskRequest}
                onAddTask={handleAddTask}
                onAddRule={handleAddRule}
                onToggleTask={handleToggleStatus}
                onUpdateTask={handleUpdateTask}
                onEditTask={handleEditTaskRequest}
                editingTaskId={editingTaskId}
                inlineEditingTaskId={inlineEditingTaskId}
                setInlineEditingTaskId={setInlineEditingTaskId}
                onOpenTimePanel={(taskId: string, subtaskId: string | null) => setShowTimePanel({ taskId, subtaskId })}
                onEditRule={setEditingRuleId}
                onToggleRule={(id: string) => setTasks(prev => ({
                  ...prev,
                  [id]: { ...prev[id], isActive: prev[id].isActive !== false, modifiedAt: new Date().toISOString() }
                }))}
                onEditBlock={setEditingBlockId}
                onReorderBlocks={handleReorderBlocks}
                onToggleBlock={handleToggleBlockActive}
                activeDate={activeDate}
                onReorderTasks={handleUpdateTasksOrder}
                onReorderSubtasks={handleUpdateSubtasksOrder}
                onToggleExpand={handleToggleExpandTask}
                onExpandAll={handleExpandAllInBlock}
                onPromote={handlePromoteTask}
                onDemote={handleDemoteTask}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleTaskSelection={toggleTaskSelection}
                onToggleSelectionMode={toggleSelectionMode}
                bulkUpdateTasks={bulkUpdateTasks}
                bulkDeleteTasks={bulkDeleteTasks}
                bulkDuplicateTasks={bulkDuplicateTasks}
                setBulkDelegateModal={setBulkDelegateModal}
                setBulkDateModal={setBulkDateModal}
                setBulkTimeModal={setBulkTimeModal}
              />
            )}
            {currentView === 'calendar' && (
              <CalendarView 
                tasks={allActiveTasks} 
                allTasksMap={tasks}
                blocks={blocks}
                people={people}
                onAddPerson={handleAddPerson}
                onRenamePerson={handleRenamePerson}
                onDeletePerson={handleDeletePerson}
                onRecurrenceDateChange={(task: any, newDate: string) => setPendingDateChange({ task, newDate })}
                timeEntries={timeEntries}
                activeTimer={activeTimer}
                onStartTimer={handleStartTimer}
                onStopTimer={handleStopTimer}
                onUpdateTask={handleUpdateTask}
                onEditTask={handleEditTaskRequest}
                editingTaskId={editingTaskId}
                inlineEditingTaskId={inlineEditingTaskId}
                setInlineEditingTaskId={setInlineEditingTaskId}
                onOpenTimePanel={(taskId: string, subtaskId: string | null) => setShowTimePanel({ taskId, subtaskId })}
                activeDate={activeDate}
                onDateSelect={(d: string) => { setActiveDate(d); setCurrentView('dashboard'); }}
                onAddTask={handleAddTask}
                onToggleTask={handleToggleStatus}
                onDelete={handleDeleteTaskRequest}
                onReorderTasks={handleUpdateTasksOrder}
                onReorderSubtasks={handleUpdateSubtasksOrder}
                onToggleExpand={handleToggleExpandTask}
                onPromote={handlePromoteTask}
                onDemote={handleDemoteTask}
              />
            )}
            {currentView === 'delegadas' && (
              <DelegadasView
                tasks={allActiveTasks}
                allTasksMap={tasks}
                blocks={blocks}
                people={people}
                meetings={meetings}
                timeEntries={timeEntries}
                onUpdateTask={handleUpdateTask}
                onUpdatePeople={setPeople}
                onUpdateMeetings={setMeetings}
                onAddTask={handleAddTask}
                onEditTask={(id: string) => setEditingTaskId(id)}
                onDeleteTask={handleDeleteTaskRequest}
                onRenamePerson={handleRenamePerson}
                onDeletePerson={handleDeletePerson}
                onRecurrenceDateChange={(task: any, newDate: string) => setPendingDateChange({ task, newDate })}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleTaskSelection={toggleTaskSelection}
                onToggleSelectionMode={toggleSelectionMode}
                bulkUpdateTasks={bulkUpdateTasks}
                bulkDeleteTasks={bulkDeleteTasks}
                bulkDuplicateTasks={bulkDuplicateTasks}
                setBulkDelegateModal={setBulkDelegateModal}
                setBulkDateModal={setBulkDateModal}
                setBulkTimeModal={setBulkTimeModal}
              />
            )}
            
            {currentView === 'search' && (
              <SearchView
                searchText={searchText}
                setSearchText={setSearchText}
                searchFilters={searchFilters}
                setSearchFilters={setSearchFilters}
                tasks={Object.values(tasks).filter(t => !t.isDeleted)}
                allTasksMap={tasks}
                blocks={blocks}
                onEditTask={(id: string) => setEditingTaskId(id)}
                onToggle={handleToggleStatus}
                onDelete={handleDeleteTaskRequest}
                onUpdateTask={handleUpdateTask}
              />
            )}
          </AnimatePresence>
        </div>
      </main>
 
      {editingTaskId && tasks[editingTaskId] && (
        <TaskModal 
          key={editingTaskId}
          task={tasks[editingTaskId]}
          allTasksMap={tasks}
          people={people}
          onAddPerson={handleAddPerson}
          onRenamePerson={handleRenamePerson}
          onDeletePerson={handleDeletePerson}
                onRecurrenceDateChange={(task: any, newDate: string) => setPendingDateChange({ task, newDate })}
          onClose={() => setEditingTaskId(null)}
          onSave={handleUpdateTask}
          onAddTask={handleAddTask}
          onDeleteTask={handleDeleteTask}
          onEditTask={handleEditTaskRequest}
          blocks={blocks}
        />
      )}
 
      {editingRuleId && tasks[editingRuleId] && (
        <TaskModal 
          key={editingRuleId}
          task={tasks[editingRuleId]}
          allTasksMap={tasks}
          people={people}
          onAddPerson={handleAddPerson}
          onRenamePerson={handleRenamePerson}
          onDeletePerson={handleDeletePerson}
                onRecurrenceDateChange={(task: any, newDate: string) => setPendingDateChange({ task, newDate })}
          onClose={() => setEditingRuleId(null)}
          onSave={handleUpdateTask}
          onAddTask={handleAddTask}
          onDeleteTask={handleDeleteTask}
          onEditTask={handleEditTaskRequest}
          blocks={blocks}
        />
      )}
 
      {editingBlockId && (
        <BlockModal 
          block={blocks.find(b => b.id === editingBlockId) || { id: editingBlockId, name: '', color: COLORS.turquesa.main, pastelColor: COLORS.turquesa.pastel, icon: '🏢', isActive: true, order: blocks.length }}
          onClose={() => setEditingBlockId(null)}
          onSave={handleUpdateBlock}
          onDelete={handleDeleteBlock}
        />
      )}
 
      {/* Modal aviso: añadir subtarea a tarea con fecha */}
      {addSubtaskWarning && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAddSubtaskWarning(null)} />
          <div className="relative bg-bg-card border border-border-main rounded-3xl p-6 shadow-2xl max-w-sm w-full z-10">
            <div className="text-center mb-5">
              <div className="text-3xl mb-3">⚠️</div>
              <h3 className="text-white font-black text-lg mb-2">¿Convertir en tarea contenedora?</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Al añadir subtareas, se convertirá en una <span className="text-white font-bold">tarea contenedora</span>. Esto implica:
              </p>
              <ul className="text-text-secondary text-sm mt-2 space-y-1 text-left">
                {tasks[addSubtaskWarning.parentTaskId]?.dueDate && (
                  <li>• Su <span className="text-turquesa font-bold">fecha de ejecución</span> se eliminará</li>
                )}
                {tasks[addSubtaskWarning.parentTaskId]?.dueTime && (
                  <li>• Su <span className="text-azul font-bold">hora</span> se eliminará</li>
                )}
                {tasks[addSubtaskWarning.parentTaskId]?.tags?.length > 0 && (
                  <li>• Su <span className="text-rosa font-bold">etiqueta</span> se eliminará</li>
                )}
                {tasks[addSubtaskWarning.parentTaskId]?.recurrence && (
                  <li>• Su <span className="text-naranja font-bold">recurrencia</span> se eliminará</li>
                )}
                {tasks[addSubtaskWarning.parentTaskId]?.delegation && (
                  <li>• Su <span className="text-morado font-bold">delegación</span> se eliminará</li>
                )}
                <li className="text-text-secondary/60 text-xs mt-1">Los contenedores no tienen datos propios. Toda la información la asignan sus subtareas.</li>
              </ul>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setAddSubtaskWarning(null)}
                className="flex-1 py-3 rounded-2xl border border-border-main text-text-secondary hover:text-white hover:border-white/30 transition-all font-bold text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const { parentTaskId, blockId, overrideDate } = addSubtaskWarning;
                  setAddSubtaskWarning(null);
                  // Al convertir en contenedor: quitar fecha, etiqueta y forzar expandido
                  // Todo en un solo setTasks para evitar race conditions
                  const id = `t-${Date.now()}`;
                  const timestamp = new Date().toISOString();
                  const parentTask = tasks[parentTaskId];
                  const newTask = {
                    id,
                    blockId: blockId || parentTask?.blockId || (blocks.length > 0 ? blocks[0].id : 'b1'),
                    title: '',
                    notes: '',
                    priority: 'media' as const,
                    status: 'pending' as const,
                    dueDate: overrideDate || activeDate,
                    dueTime: '',
                    parentTaskId,
                    subtasks: [],
                    estimatedMinutes: 0,
                    tags: [],
                    order: 0,
                    createdAt: timestamp,
                    modifiedAt: timestamp,
                    attachments: [],
                    isExpanded: true,
                    isTemplate: false
                  };
                  setTasks(prev => ({
                    ...prev,
                    [parentTaskId]: { 
                      ...prev[parentTaskId], 
                      dueDate: null,
                      dueTime: '',
                      tags: [],
                      estimatedMinutes: 0,
                      recurrence: undefined,
                      isTemplate: false,
                      delegation: undefined,
                      isExpanded: true,
                      subtasks: [...(prev[parentTaskId]?.subtasks || []), id],
                      modifiedAt: timestamp
                    },
                    [id]: newTask
                  }));
                  // Persistir la limpieza del contenedor en Supabase
                  supabase.from('tasks').update({
                    due_date: null,
                    due_time: null,
                    tags: [],
                    estimated_minutes: 0,
                    recurrence: null,
                    is_template: false,
                    delegation: null,
                    is_expanded: true,
                    modified_at: timestamp
                  }).eq('id', parentTaskId).then(({ error }) => {
                    if (error) console.error('[SUPABASE] Error limpiando contenedor:', error);
                  });
                  setTimeout(() => setEditingTaskId(id), 50);
                }}
                className="flex-1 py-3 rounded-2xl bg-turquesa text-white font-black text-sm hover:bg-turquesa/80 transition-all"
              >
                Sí, convertir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modales de acciones bulk */}
      {bulkDelegateModal && (
        <BulkDelegateModal
          people={people}
          onClose={() => setBulkDelegateModal(false)}
          onConfirm={(personId: string) => {
            const person = people.find((p: any) => p.id === personId);
            if (!person) return;
            const timestamp = new Date().toISOString();
            setTasks(prev => {
              const next = { ...prev };
              selectedTaskIds.forEach(id => {
                if (next[id]) {
                  next[id] = { ...next[id], delegation: { personId, personName: person.name, delegatedAt: timestamp }, modifiedAt: timestamp };
                }
              });
              return next;
            });
            setSelectedTaskIds(new Set());
            setSelectionMode(false);
            setBulkDelegateModal(false);
          }}
        />
      )}

      {bulkDateModal && (
        <BulkDateModal
          onClose={() => setBulkDateModal(false)}
          onConfirm={(date: string) => {
            const timestamp = new Date().toISOString();
            setTasks(prev => {
              const next = { ...prev };
              selectedTaskIds.forEach(id => {
                if (next[id]) next[id] = { ...next[id], dueDate: date, modifiedAt: timestamp };
              });
              return next;
            });
            setSelectedTaskIds(new Set());
            setSelectionMode(false);
            setBulkDateModal(false);
          }}
        />
      )}

      {bulkTimeModal && (
        <BulkTimeModal
          onClose={() => setBulkTimeModal(false)}
          onConfirm={(minutes: number) => {
            const timestamp = new Date().toISOString();
            setTasks(prev => {
              const next = { ...prev };
              selectedTaskIds.forEach(id => {
                if (next[id]) next[id] = { ...next[id], estimatedMinutes: minutes, modifiedAt: timestamp };
              });
              return next;
            });
            setSelectedTaskIds(new Set());
            setSelectionMode(false);
            setBulkTimeModal(false);
          }}
        />
      )}

      {/* Modal cambio de fecha en instancia recurrente */}
      {pendingDateChange && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 dark:bg-black/60 bg-black/40 backdrop-blur-sm">
            <div className="dark:bg-bg-card bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border dark:border-border-main border-border-main-light space-y-4">
              <h3 className="font-black dark:text-white text-text-main-light text-base uppercase tracking-widest">Cambiar fecha</h3>
              <p className="text-sm dark:text-text-secondary text-text-secondary-light">¿Qué quieres cambiar?</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  const { task, newDate } = pendingDateChange;
                  // Solo este día: guardar como excepción
                  handleUpdateTask({ ...task, dueDate: newDate });
                  setPendingDateChange(null);
                }}
                className="w-full py-3 rounded-2xl bg-turquesa text-white font-black text-sm hover:bg-turquesa/80 transition-all"
              >
                Solo este día
              </button>
              <button
                onClick={() => {
                  const { task, newDate } = pendingDateChange;
                  // Toda la serie: actualizar el startDate del template
                  const templateId = task.templateId;
                  if (templateId && tasks[templateId]) {
                    const template = tasks[templateId];
                    handleUpdateTask({
                      ...template,
                      recurrence: template.recurrence ? { ...template.recurrence, startDate: newDate } : template.recurrence
                    });
                  }
                  setPendingDateChange(null);
                }}
                className="w-full py-3 rounded-2xl dark:bg-bg-secondary bg-gray-100 dark:text-white text-text-main-light font-black text-sm hover:opacity-80 transition-all"
              >
                Toda la serie (cambia el inicio)
              </button>
              <button
                onClick={() => setPendingDateChange(null)}
                className="w-full py-3 rounded-2xl text-rosa font-black text-sm hover:bg-rosa/10 transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {recurrenceAction && (
        <RecurrenceChoiceModal 
          type={recurrenceAction.type}
          onClose={() => setRecurrenceAction(null)}
          onConfirm={(choice) => {
            const { taskId, type, ruleId } = recurrenceAction;
            setRecurrenceAction(null);
            const today = formatLocalISO(new Date());
            const timestamp = new Date().toISOString();

            if (choice === 'instance') {
              if (type === 'edit') {
                // Marcar como excepción y abrir modal
                setTasks(prev => ({
                  ...prev,
                  [taskId]: { ...prev[taskId], isException: true }
                }));
                setEditingTaskId(taskId);
              } else {
                // Eliminar solo esta instancia → persistir en Supabase con UPSERT
                const taskToDelete = tasks[taskId] || dashboardTasks.find(t => t.id === taskId);
                if (!taskToDelete) {
                  console.error('[DELETE] Tarea no encontrada:', taskId);
                  return;
                }
                
                setTasks(prev => ({
                  ...prev,
                  [taskId]: { ...(prev[taskId] || taskToDelete), isDeleted: true, isException: true, existsInSupabase: true, modifiedAt: timestamp }
                }));
                
                // UPSERT en lugar de UPDATE para que funcione con instancias no guardadas
                supabase.from('tasks').upsert({
                  id: taskToDelete.id,
                  block_id: taskToDelete.blockId,
                  parent_task_id: null,
                  template_id: taskToDelete.templateId,
                  instance_date: taskToDelete.instanceDate || null,
                  title: taskToDelete.title,
                  notes: taskToDelete.notes || '',
                  priority: taskToDelete.priority || 'medium',
                  status: taskToDelete.status,
                  due_date: taskToDelete.dueDate || null,
                  due_time: taskToDelete.dueTime || null,
                  completed_at: taskToDelete.completedAt || null,
                  estimated_minutes: taskToDelete.estimatedMinutes || 0,
                  actual_minutes: taskToDelete.actualMinutes || 0,
                  tags: taskToDelete.tags || [],
                  delegation: taskToDelete.delegation || null,
                  is_template: false,
                  is_exception: true,
                  is_deleted: true, // ← ESTO ES LO IMPORTANTE
                  deleted_at: new Date().toISOString(),
                  is_active: false,
                  created_at: taskToDelete.createdAt || new Date().toISOString(),
                  modified_at: timestamp
                }, { onConflict: 'id' })
                  .then(({ error }) => {
                    if (error) console.error('[SUPABASE] Error eliminando instancia:', error);
                    else console.log('[SUPABASE] Instancia eliminada (upsert):', taskId);
                  });
              }
            } else if (choice === 'series') {
              if (type === 'edit') {
                // Editar el template original
                setEditingRuleId(ruleId);
              } else {
                // Eliminar serie: desactivar template + borrar instancias futuras (>= hoy)
                // Las pasadas (< hoy) se respetan siempre
                setTasks(prev => {
                  const updated = { ...prev };
                  if (updated[ruleId]) {
                    updated[ruleId] = { ...updated[ruleId], isActive: false, modifiedAt: timestamp };
                  }
                  Object.values(updated).forEach(t => {
                    if (t && t.templateId === ruleId && !t.isDeleted && t.dueDate && t.dueDate >= today) {
                      updated[t.id] = { ...t, isDeleted: true, modifiedAt: timestamp };
                    }
                  });
                  return updated;
                });
                supabase.from('tasks')
                  .update({ is_active: false, modified_at: timestamp })
                  .eq('id', ruleId)
                  .then(({ error }) => {
                    if (error) console.error('[SUPABASE] Error desactivando serie:', error);
                  });
              }
            }
          }}
        />
      )}
 
      <AnimatePresence>
        {showTimePanel && (
          <TimeManagementPanel 
            taskId={showTimePanel.taskId}
            subtaskId={showTimePanel.subtaskId}
            allTasksMap={tasks}
            timeEntries={timeEntries}
            onAddEntry={handleManualTimeEntry}
            onDeleteEntry={handleDeleteTimeEntry}
            onUpdateEntry={handleUpdateTimeEntry}
            onClose={() => setShowTimePanel(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
 
// --- Task Modal ---
function TaskModal({ task, allTasksMap, onClose, onSave, onAddTask, onDeleteTask, onEditTask, blocks, people = [], onAddPerson, onRenamePerson, onDeletePerson, onRecurrenceDateChange = null }: any) {
  const [localTask, setLocalTask] = useState<Task>(task);
  const [focusedSubtaskId, setFocusedSubtaskId] = useState<string | null>(null);
  const [showDateSelector, setShowDateSelector] = useState(false);
  const tags: TagType[] = ['con_hora', 'focus', 'dirección', 'espera', 'resto'];
 
  useEffect(() => {
    setLocalTask(task);
  }, [task]);
 
  const subtasks = useMemo(() => {
    return (localTask.subtasks || [])
      .map(id => allTasksMap[id])
      .filter(Boolean)
      .sort((a, b) => (a?.order || 0) - (b?.order || 0));
  }, [localTask.subtasks, allTasksMap]);
 
  const handleUpdateSubtask = (sid: string, updates: Partial<Task>) => {
    const subtask = allTasksMap[sid];
    onSave({ ...subtask, ...updates });
    
    // Si la subtarea tiene/activa recurrencia, asegurarse que el padre es isTemplate:true y dueDate:null
    const hasRecurrence = updates.recurrence !== undefined 
      ? !!updates.recurrence 
      : !!subtask?.recurrence;
    
    if (hasRecurrence && subtask?.parentTaskId) {
      const parent = allTasksMap[subtask.parentTaskId];
      if (parent && (!parent.isTemplate || parent.dueDate)) {
        onSave({ ...parent, isTemplate: true, dueDate: null });
      }
    }
  };
 
  const frequencies = [
    { id: 'daily', label: 'Diaria' },
    { id: 'weekdays', label: 'L-V' },
    { id: 'weekly', label: 'Semanal' },
    { id: 'monthly', label: 'Mensual' },
    { id: 'yearly', label: 'Anual' }
  ];
 
  return (
    <div className="fixed inset-0 dark:bg-bg-main/80 bg-white/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        key={localTask.id}
        className="dark:bg-bg-card bg-white w-full max-w-2xl rounded-[2.5rem] shadow-[0_30px_100px_rgba(0,0,0,0.5)] border dark:border-border-main border-border-main-light overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b dark:border-border-main border-border-main-light flex justify-between items-start dark:bg-bg-card bg-white">
          <div className="flex-1 flex items-start gap-4">
            {localTask.parentTaskId && (
              <button 
                onClick={() => onEditTask(localTask.parentTaskId)}
                className="p-2 bg-turquesa/10 text-turquesa rounded-xl border border-turquesa/20 hover:bg-turquesa/20 transition-all mt-6"
                title="Volver al padre"
              >
                <ArrowUpLeft size={16} />
              </button>
            )}
            <div className="flex-1">
              <p className="text-[10px] font-black text-turquesa uppercase tracking-[0.2em] mb-2">
                {localTask.templateId 
                  ? 'Instancia de Tarea Repetitiva' 
                  : (localTask.recurrence || localTask.isTemplate) 
                    ? 'Configurar Tarea Repetitiva' 
                    : 'Configurar Tarea Puntual'}
              </p>
              <input 
                autoFocus
                className="text-3xl font-black w-full bg-transparent outline-none placeholder:text-text-secondary dark:text-white text-text-main-light"
                value={localTask.title}
                onChange={e => setLocalTask(prev => ({ ...prev, title: e.target.value }))}
                placeholder="¿Qué hay que hacer?"
              />
            </div>
          </div>
          <button onClick={onClose} className="p-3 dark:bg-bg-secondary bg-bg-secondary-light dark:hover:bg-bg-main hover:bg-gray-200 rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light transition-all">
            <X size={20} />
          </button>
        </div>
 
        <div className="p-8 space-y-8 overflow-y-auto custom-scrollbar flex-1">
          {/* Core/Ad-hoc Toggle */}
          <div className="space-y-3">
            <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Tipo de Tarea</label>
            <div className="flex gap-3 dark:bg-bg-main bg-white p-1 rounded-2xl border dark:border-border-main border-border-main-light">
              <button 
                onClick={() => setLocalTask(prev => ({ ...prev, taskType: 'core' }))}
                className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl transition-all ${localTask.taskType === 'core' || ((localTask.recurrence || localTask.isTemplate) && !localTask.taskType) ? 'bg-turquesa dark:text-white text-text-main-light shadow-lg' : 'text-text-secondary hover:text-white hover:bg-white/5'}`}
              >
                <Compass size={18} />
                <span className="text-[11px] font-black uppercase tracking-widest">Puesto (CORE)</span>
              </button>
              <button 
                onClick={() => setLocalTask(prev => ({ ...prev, taskType: 'adhoc' }))}
                className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl transition-all ${localTask.taskType === 'adhoc' || ((!localTask.recurrence && !localTask.isTemplate) && !localTask.taskType) ? 'bg-rosa dark:text-white text-text-main-light shadow-lg' : 'text-text-secondary hover:text-white hover:bg-white/5'}`}
              >
                <div className="w-3 h-3 bg-current rounded-full mx-1 shadow-[0_0_8px_rgba(251,113,133,0.5)]" />
                <span className="text-[11px] font-black uppercase tracking-widest">Puntual (AD-HOC)</span>
              </button>
            </div>
          </div>
 
          {/* Delegación */}
          {!(localTask.subtasks && localTask.subtasks.length > 0) && (
            <div className="space-y-3">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Delegar a</label>
              <div className="dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl p-3">
                <DelegationChip
                  delegation={localTask.delegation}
                  people={people}
                  onAddPerson={onAddPerson}
                  onRenamePerson={onRenamePerson}
                  onDeletePerson={onDeletePerson}
                onRecurrenceDateChange={onRecurrenceDateChange}
                  onChange={(delegation: any) => setLocalTask(prev => ({ ...prev, delegation }))}
                />
              </div>
            </div>
          )}

          {/* Main Config Grid */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Bloque / Contexto</label>
              <select 
                className="w-full p-4 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl text-sm font-bold dark:text-white text-text-main-light outline-none focus:ring-2 focus:ring-turquesa/20 appearance-none cursor-pointer"
                value={localTask.blockId}
                onChange={e => setLocalTask(prev => ({ ...prev, blockId: e.target.value }))}
              >
                {blocks.filter((b: any) => b.isActive).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.icon} {b.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Estimado (min)</label>
              <div className="relative">
                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-turquesa" size={16} />
                <input 
                  type="number"
                  className="w-full pl-12 pr-4 py-4 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl text-sm font-bold dark:text-white text-text-main-light outline-none focus:ring-2 focus:ring-turquesa/20"
                  value={localTask.estimatedMinutes || ''}
                  onChange={e => setLocalTask(prev => ({ ...prev, estimatedMinutes: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>
 
          <div className="space-y-3">
            <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Categoría</label>
            {localTask.subtasks && localTask.subtasks.length > 0 ? (
              <div className="dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl p-3 flex items-center gap-2">
                <span className="text-lg">🗂️</span>
                <p className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light">
                  Las tareas contenedor no tienen etiqueta. La etiqueta la asignan sus subtareas.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map(t => {
                  const active = localTask.tags.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => setLocalTask(prev => ({ ...prev, tags: [t] }))}
                      className={`
                        px-4 py-3 rounded-xl text-xl border transition-all flex items-center justify-center
                        ${active 
                          ? 'bg-turquesa border-turquesa shadow-lg shadow-turquesa/20' 
                          : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light hover:border-turquesa/50'}
                      `}
                      title={TAG_LABELS[t].label}
                    >
                      {TAG_LABELS[t].icon}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
 
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Fecha de ejecución</label>
            </div>
            
            <div className="dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CalendarIcon size={18} className="text-turquesa" />
                  <span className="text-sm font-bold dark:text-white text-text-main-light">
                    {localTask.dueDate ? (() => {
                      const d = parseLocalISO(localTask.dueDate);
                      const dd = d.getDate().toString().padStart(2, '0');
                      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
                      const yyyy = d.getFullYear();
                      return `${dd}-${mm}-${yyyy}`;
                    })() : 'Sin fecha asignada'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setShowDateSelector(!showDateSelector)}
                    className={`p-2 rounded-lg transition-all ${showDateSelector ? 'bg-turquesa dark:text-white text-text-main-light' : 'text-turquesa hover:bg-turquesa/10'}`}
                    title="Modificar fecha"
                  >
                    <CalendarIcon size={18} />
                  </button>
                  {localTask.dueDate && (
                    <button 
                      onClick={() => setLocalTask(prev => ({ ...prev, dueDate: null, dueTime: '' }))}
                      className="p-2 text-rosa hover:bg-rosa/10 rounded-lg transition-all"
                      title="Eliminar fecha"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
              
              {/* Campo hora - solo cuando NO hay recurrencia activa (si hay recurrencia, el campo hora está en esa sección) */}
              {!localTask.recurrence && (
              <div className="flex items-center gap-3 pt-2 border-t dark:border-border-main/30 border-border-main-light/30">
                <Clock size={16} className="text-azul shrink-0" />
                <span className="text-xs font-bold dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Hora</span>
                <input
                  type="time"
                  value={localTask.dueTime || ''}
                  onChange={e => setLocalTask(prev => ({ ...prev, dueTime: e.target.value }))}
                  className="flex-1 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-1.5 text-sm font-bold text-azul outline-none focus:border-azul/50"
                />
                {localTask.dueTime && (
                  <button
                    onClick={() => setLocalTask(prev => ({ ...prev, dueTime: '' }))}
                    className="p-1.5 text-rosa hover:bg-rosa/10 rounded-lg transition-all"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              )}
            </div>
 
            {showDateSelector && (
              <div className="p-4 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-[2rem] animate-in fade-in slide-in-from-top-2">
                <div className="mb-4 flex items-center justify-between px-2">
                  <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Seleccionar Día</span>
                </div>
                <MonthDatePicker 
                  value={localTask.dueDate} 
                  onChange={(d) => {
                    setLocalTask(prev => ({ ...prev, dueDate: d }));
                    setShowDateSelector(false);
                  }} 
                />
              </div>
            )}
          </div>
 
          {/* Recurrence Section */}
          <div className="p-6 dark:bg-bg-main/20 bg-gray-100/50 border dark:border-border-main border-border-main-light rounded-[2rem] space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <RefreshCw size={20} className={localTask.recurrence || localTask.templateId ? 'text-turquesa' : 'dark:text-text-secondary text-text-secondary-light'} />
                <h3 className="text-sm font-black dark:text-white text-text-main-light uppercase tracking-widest">Recurrencia (Repetir tarea)</h3>
              </div>
              {localTask.templateId ? (
                // Instancia: badge que indica que pertenece a una serie
                <span className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-turquesa/20 text-turquesa border border-turquesa/30">
                  SERIE ACTIVA
                </span>
              ) : (
                <button 
                  onClick={() => setLocalTask(prev => ({ 
                    ...prev, 
                    recurrence: prev.recurrence ? undefined : { frequency: 'daily', startDate: prev.dueDate || formatLocalISO(new Date()) },
                    isTemplate: !prev.recurrence,
                    dueDate: prev.recurrence ? (prev.dueDate || formatLocalISO(new Date())) : null
                  }))}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${localTask.recurrence ? 'bg-turquesa text-white' : 'dark:bg-bg-secondary bg-gray-200 dark:text-text-secondary text-text-secondary-light'}`}
                >
                  {localTask.recurrence ? 'ACTIVA' : 'DESACTIVADA'}
                </button>
              )}
            </div>

            {/* Info instancia */}
            {localTask.templateId && (() => {
              const template = allTasksMap[localTask.templateId];
              const rec = template?.recurrence || 
                (template?.parentTaskId ? allTasksMap[template.parentTaskId]?.recurrence : null);
              
              const formatRecurrence = () => {
                if (!rec) return null;
                const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
                const freq = rec.frequency || rec.type || rec.freq;
                if (!freq) return null;
                if (freq === 'daily') return 'Diaria — todos los días';
                if (freq === 'weekdays') return 'Semanal — Lun, Mar, Mié, Jue, Vie';
                if (freq === 'weekly') {
                  const days = (rec.weekDays || rec.days || []).map((d: number) => dayNames[d]).join(', ');
                  return `Semanal — ${days || 'todos los días'}`;
                }
                if (freq === 'monthly') {
                  const day = rec.monthDay || rec.day || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getDate() : '?');
                  return `Mensual — día ${day}`;
                }
                if (freq === 'yearly') {
                  if (rec.startDate) {
                    const d = new Date(rec.startDate + 'T12:00:00');
                    return `Anual — ${d.getDate()} de ${d.toLocaleDateString('es-ES', { month: 'long' })}`;
                  }
                  return 'Anual';
                }
                return freq;
              };

              const recDesc = formatRecurrence();

              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-3 dark:bg-turquesa/10 bg-turquesa/5 border border-turquesa/20 rounded-xl">
                    <RefreshCw size={14} className="text-turquesa shrink-0" />
                    <p className="text-xs dark:text-text-secondary text-text-secondary-light">
                      Esta tarea es una <span className="text-turquesa font-bold">instancia de una serie recurrente</span>. Los cambios solo afectan a este día concreto.
                    </p>
                  </div>
                  {recDesc && (
                    <div className="flex items-center gap-3 p-3 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl">
                      <RefreshCw size={12} className="text-turquesa shrink-0" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Patrón de repetición</span>
                        <span className="text-xs font-bold text-turquesa">{recDesc}</span>
                        {rec.startDate && (
                          <span className="text-[10px] dark:text-text-secondary text-text-secondary-light">
                            Desde {new Date(rec.startDate + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {!recDesc && (
                    <div className="flex items-center gap-3 p-3 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl">
                      <RefreshCw size={12} className="text-turquesa shrink-0" />
                      <span className="text-xs dark:text-text-secondary text-text-secondary-light">Parte de una serie recurrente</span>
                    </div>
                  )}
                </div>
              );
            })()}
 
            {localTask.recurrence && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Frecuencia</label>
                    <div className="flex dark:bg-bg-secondary bg-bg-secondary-light rounded-xl p-1 gap-1">
                      {frequencies.map(f => (
                        <button 
                          key={f.id}
                          onClick={() => setLocalTask(prev => {
                            const today = new Date();
                            const updates: any = { frequency: f.id as any };
                            if (f.id === 'weekly' && (!prev.recurrence?.weekDays || prev.recurrence.weekDays.length === 0)) {
                              updates.weekDays = [(today.getDay() + 6) % 7];
                            }
                            if (f.id === 'monthly' && !prev.recurrence?.monthDay) {
                              updates.monthDay = today.getDate();
                            }
                            return { ...prev, recurrence: { ...prev.recurrence!, ...updates } };
                          })}
                          className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${localTask.recurrence?.frequency === f.id ? 'bg-turquesa dark:text-white text-text-main-light' : 'text-text-secondary hover:text-white'}`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Inicio de Serie</label>
                    <input 
                      type="date"
                      className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold dark:text-white text-text-main-light outline-none"
                      value={localTask.recurrence.startDate}
                      onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, startDate: e.target.value } }))}
                    />
                  </div>
                </div>

                {/* Campo hora para recurrentes */}
                <div className="space-y-2">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Hora de ejecución (opcional)</label>
                  <div className="flex items-center gap-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl p-3">
                    <Clock size={14} className="text-azul shrink-0" />
                    <input
                      type="time"
                      value={localTask.dueTime || ''}
                      onChange={e => setLocalTask(prev => ({ ...prev, dueTime: e.target.value }))}
                      className="flex-1 bg-transparent text-sm font-bold text-azul outline-none"
                    />
                    {localTask.dueTime && (
                      <button
                        onClick={() => setLocalTask(prev => ({ ...prev, dueTime: '' }))}
                        className="p-1 text-rosa hover:bg-rosa/10 rounded-lg transition-all"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
 
                {localTask.recurrence.frequency === 'weekly' && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Días de ejecución</label>
                    <div className="flex justify-between gap-1">
                      {['L','M','X','J','V','S','D'].map((d, i) => {
                        const dayNum = i; // 0=Lunes, ..., 6=Domingo (matches matchesRecurrence specDay)
                        const active = localTask.recurrence?.weekDays?.includes(dayNum);
                        return (
                          <button 
                            key={d}
                            onClick={() => {
                              const curr = localTask.recurrence?.weekDays || [];
                              const next = curr.includes(dayNum) ? curr.filter(v => v !== dayNum) : [...curr, dayNum];
                              setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, weekDays: next } }));
                            }}
                            className={`flex-1 py-1 px-1 aspect-square rounded-lg text-[9px] font-black border transition-all ${active ? 'bg-turquesa border-turquesa dark:text-white text-text-main-light' : 'dark:bg-bg-secondary bg-bg-secondary-light dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light'}`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
 
                {localTask.recurrence.frequency === 'monthly' && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Día del mes (1-31)</label>
                    <input 
                      type="number"
                      min="1"
                      max="31"
                      className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold text-turquesa outline-none text-center focus:ring-2 focus:ring-turquesa/20"
                      value={localTask.recurrence.monthDay || parseLocalISO(localTask.recurrence.startDate || formatLocalISO(new Date())).getDate()}
                      onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, monthDay: parseInt(e.target.value) || 1 } }))}
                    />
                  </div>
                )}

                {localTask.recurrence.frequency === 'yearly' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Día (1-31)</label>
                      <input 
                        type="number"
                        min="1"
                        max="31"
                        className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold text-turquesa outline-none text-center focus:ring-2 focus:ring-turquesa/20"
                        value={localTask.recurrence.yearDay || new Date().getDate()}
                        onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, yearDay: parseInt(e.target.value) || 1 } }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Mes (1-12)</label>
                      <input 
                        type="number"
                        min="1"
                        max="12"
                        className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold text-turquesa outline-none text-center focus:ring-2 focus:ring-turquesa/20"
                        value={localTask.recurrence.yearMonth || new Date().getMonth() + 1}
                        onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, yearMonth: parseInt(e.target.value) || 1 } }))}
                      />
                    </div>
                  </div>
                )}

                {/* Termina */}
                <div className="space-y-2">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Termina:</label>
                  <div className="flex gap-2">
                    {/* Nunca */}
                    <button
                      onClick={() => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, endDate: undefined } }))}
                      className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        !localTask.recurrence.endDate
                          ? 'bg-turquesa text-white'
                          : 'dark:bg-bg-secondary bg-bg-secondary-light dark:text-text-secondary text-text-secondary-light'
                      }`}
                    >
                      Nunca
                    </button>

                    {/* El [fecha] */}
                    <button
                      onClick={() => {
                        if (!localTask.recurrence.endDate) {
                          const sixMonthsLater = new Date();
                          sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
                          setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, endDate: formatLocalISO(sixMonthsLater) } }));
                        }
                      }}
                      className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        localTask.recurrence.endDate
                          ? 'bg-turquesa text-white'
                          : 'dark:bg-bg-secondary bg-bg-secondary-light dark:text-text-secondary text-text-secondary-light'
                      }`}
                    >
                      El
                    </button>
                  </div>
                  {localTask.recurrence.endDate && (
                    <input
                      type="date"
                      value={localTask.recurrence.endDate}
                      onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, endDate: e.target.value } }))}
                      className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold text-turquesa outline-none text-center focus:ring-2 focus:ring-turquesa/20"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
 
          {/* Subtasks Section */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black dark:text-white text-text-main-light uppercase tracking-[0.1em]">Pasos / Subtareas</h3>
              <button 
                onClick={() => {
                  const nid = onAddTask(localTask.id);
                  if (nid) setFocusedSubtaskId(nid);
                }}
                className="flex items-center gap-2 p-3 bg-turquesa/10 hover:bg-turquesa/20 text-turquesa rounded-2xl transition-all font-black text-[10px] uppercase tracking-widest"
              >
                <Plus size={14} /> Añadir Paso
              </button>
            </div>
 
            <div className="space-y-3">
              {subtasks.map((st: Task) => (
                <div key={st.id} className="flex gap-3 items-start dark:bg-bg-main/40 bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light group">
                  {/* Checkbox completar/descompletar subtarea */}
                  <button
                    onClick={() => handleUpdateSubtask(st.id, { status: st.status === 'completed' ? 'pending' : 'completed', modifiedAt: new Date().toISOString() })}
                    className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      st.status === 'completed'
                        ? 'bg-turquesa border-turquesa text-white'
                        : 'dark:border-border-main border-border-main-light hover:border-turquesa'
                    }`}
                  >
                    {st.status === 'completed' && <Check size={10} />}
                  </button>
                  <div className="flex-1 space-y-3">
                    <input 
                      autoFocus={st.id === focusedSubtaskId}
                      onFocus={() => { if(st.id === focusedSubtaskId) setFocusedSubtaskId(null); }}
                      className={`w-full bg-transparent text-sm font-bold dark:text-white text-text-main-light outline-none border-b dark:border-border-main border-border-main-light/20 focus:border-turquesa transition-all py-1 ${st.status === 'completed' ? 'line-through' : ''}`}
                      value={st.title}
                      onChange={e => handleUpdateSubtask(st.id, { title: e.target.value })}
                      placeholder="Título del paso..."
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* TimePickerChip - subtareas pueden tener hora */}
                      {!st.isTemplate && st.dueDate && (
                        <TimePickerChip
                          value={st.dueTime || ''}
                          onChange={(time: string) => handleUpdateSubtask(st.id, { dueTime: time })}
                        />
                      )}
                      {/* DatePickerChip - permitir cambio de fecha incluso para instancias */}
                      <DatePickerChip
                        value={st.dueDate}
                        onChange={(date: string) => handleUpdateSubtask(st.id, { dueDate: date })}
                      />
                      {/* RecurrencePickerChip - solo para templates, no instancias */}
                      {!st.templateId && (!st.subtasks || st.subtasks.length === 0) ? (
                        <RecurrencePickerChip 
                          value={st.recurrence}
                          onChange={(rec: any) => handleUpdateSubtask(st.id, { 
                            recurrence: rec || undefined,
                            isTemplate: !!rec,
                            dueDate: rec ? null : (st.dueDate || formatLocalISO(new Date())),
                            dueTime: st.dueTime // ✅ Preservar hora concreta
                          })}
                        />
                      ) : null}
                      <TagPickerChip 
                        selectedTags={st.tags || []} 
                        onChange={(tags: TagType[]) => handleUpdateSubtask(st.id, { tags })} 
                      />
                      <DelegationChip
                        delegation={st.delegation}
                        people={people}
                        onChange={(delegation: any) => handleUpdateSubtask(st.id, { delegation })}
                        onAddPerson={onAddPerson}
                        onRenamePerson={onRenamePerson}
                        onDeletePerson={onDeletePerson}
                      />
                      <EstimatedTimeChip 
                        value={st.estimatedMinutes || 0} 
                        onChange={(val: number) => handleUpdateSubtask(st.id, { estimatedMinutes: val })}
                        variant="mini"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button 
                      onClick={() => onEditTask(st.id)}
                      className="p-2 dark:text-text-secondary text-text-secondary-light hover:text-turquesa"
                      title="Editar"
                    >
                      <Edit size={16} />
                    </button>
                    <button 
                      onClick={() => onDeleteTask(st.id)}
                      className="p-2 dark:text-text-secondary text-text-secondary-light hover:text-rosa"
                      title="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {subtasks.length === 0 && (
                <div className="py-8 border-2 border-dashed dark:border-border-main border-border-main-light rounded-[2rem] flex flex-col items-center justify-center dark:text-text-secondary text-text-secondary-light italic">
                  <p className="text-xs">Sin subtareas configuradas</p>
                </div>
              )}
            </div>
          </div>
 
          <div className="space-y-3">
            <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Notas y Detalles</label>
            <textarea 
              rows={4}
              className="w-full p-4 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl text-sm font-bold dark:text-white text-text-main-light outline-none focus:ring-2 focus:ring-turquesa/20 resize-none placeholder:text-text-secondary/30"
              placeholder="Anota cualquier detalle relevante..."
              value={localTask.notes || ''}
              onChange={e => setLocalTask(prev => ({ ...prev, notes: e.target.value }))}
            />
          </div>
        </div>
 
        <div className="p-8 dark:bg-bg-main/20 bg-gray-100/50 border-t dark:border-border-main border-border-main-light flex gap-4">
          <button 
            onClick={onClose}
            className="flex-1 py-5 rounded-3xl text-sm font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light dark:hover:bg-bg-secondary hover:bg-gray-200 transition-all"
          >
            Cerrar
          </button>
          <button 
            onClick={() => { 
              const taskToSave = localTask.templateId 
                ? { ...localTask, isException: true, existsInSupabase: true }
                : localTask;
              onSave(taskToSave); 
              onClose(); 
            }}
            className="flex-[2] py-5 bg-gradient-to-r from-turquesa to-azul rounded-3xl text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-turquesa/20 hover:scale-[1.02] active:scale-95 transition-all"
          >
            Guardar Cambios
          </button>
        </div>
      </motion.div>
    </div>
  );
}
 
// --- Subcomponents ---
 
function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`
        flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all group w-full relative
        ${active 
          ? 'dark:bg-bg-card dark:text-white bg-bg-card-light text-text-main-light shadow-xl dark:border-border-main border-border-main-light border' 
          : 'dark:text-text-secondary text-text-secondary-light dark:hover:text-text-main hover:text-text-main-light dark:hover:bg-bg-card/50 hover:bg-bg-secondary-light'}
      `}
    >
      {active && (
        <motion.div 
          layoutId="activeNav"
          className="absolute left-0 w-1.5 h-6 bg-turquesa rounded-r-full"
        />
      )}
      <span className={`${active ? 'text-turquesa' : 'group-hover:scale-110 transition-transform'}`}>
        {icon}
      </span>
      <span className="text-sm font-bold tracking-tight hidden lg:block tracking-wide">{label}</span>
      {active && (
        <ChevronRight size={14} className="ml-auto hidden lg:block text-turquesa" />
      )}
    </button>
  );
}
 

const formatMinutes = (mins: number) => {
  if (mins === 0) return '0m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// --- Bulk Delegate Modal ---
function BulkDelegateModal({ people, onConfirm, onClose }: any) {
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 dark:bg-black/60 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative dark:bg-bg-card bg-white rounded-[2rem] border dark:border-border-main border-border-main-light shadow-2xl p-6 w-full max-w-sm">
        <h3 className="text-lg font-black dark:text-white text-text-main-light mb-4">Delegar tareas seleccionadas</h3>
        <div className="space-y-2 mb-6">
          {people.map((p: any) => (
            <button
              key={p.id}
              onClick={() => setSelectedPerson(p.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition-all text-left ${
                selectedPerson === p.id
                  ? 'bg-morado/10 border-morado text-morado'
                  : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-white text-text-main-light hover:border-morado/50'
              }`}
            >
              <div className="w-8 h-8 rounded-xl bg-morado/20 flex items-center justify-center text-morado font-black text-sm">
                {p.name[0]}
              </div>
              <span className="font-bold text-sm">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light font-bold text-sm hover:border-rosa transition-all">Cancelar</button>
          <button
            onClick={() => selectedPerson && onConfirm(selectedPerson)}
            disabled={!selectedPerson}
            className={`flex-1 py-3 rounded-2xl font-black text-sm transition-all ${selectedPerson ? 'bg-morado text-white hover:bg-morado/90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
          >Delegar</button>
        </div>
      </div>
    </div>
  );
}

// --- Bulk Date Modal ---
function BulkDateModal({ onConfirm, onClose }: any) {
  const [date, setDate] = useState(formatLocalISO(new Date()));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 dark:bg-black/60 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative dark:bg-bg-card bg-white rounded-[2rem] border dark:border-border-main border-border-main-light shadow-2xl p-6 w-full max-w-sm">
        <h3 className="text-lg font-black dark:text-white text-text-main-light mb-4">Cambiar fecha</h3>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl border dark:border-border-main border-border-main-light dark:bg-bg-main bg-gray-50 dark:text-white text-text-main-light font-bold mb-6 focus:outline-none focus:border-turquesa"
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light font-bold text-sm hover:border-rosa transition-all">Cancelar</button>
          <button onClick={() => onConfirm(date)} className="flex-1 py-3 rounded-2xl bg-turquesa text-white font-black text-sm hover:bg-turquesa/90 transition-all">Aplicar</button>
        </div>
      </div>
    </div>
  );
}

// --- Bulk Time Modal ---
function BulkTimeModal({ onConfirm, onClose }: any) {
  const [minutes, setMinutes] = useState(30);
  const options = [5, 10, 15, 20, 30, 45, 60, 90, 120];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 dark:bg-black/60 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative dark:bg-bg-card bg-white rounded-[2rem] border dark:border-border-main border-border-main-light shadow-2xl p-6 w-full max-w-sm">
        <h3 className="text-lg font-black dark:text-white text-text-main-light mb-4">Cambiar tiempo estimado</h3>
        <div className="grid grid-cols-3 gap-2 mb-6">
          {options.map(m => (
            <button
              key={m}
              onClick={() => setMinutes(m)}
              className={`py-3 rounded-2xl border font-black text-sm transition-all ${
                minutes === m
                  ? 'bg-azul text-white border-azul'
                  : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-white text-text-main-light hover:border-azul'
              }`}
            >
              {m >= 60 ? `${m/60}h` : `${m}m`}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center mb-4">
          <span className="dark:text-text-secondary text-text-secondary-light text-sm">Personalizado:</span>
          <input
            type="number"
            min={1}
            value={minutes}
            onChange={e => setMinutes(Number(e.target.value))}
            className="flex-1 px-3 py-2 rounded-xl border dark:border-border-main border-border-main-light dark:bg-bg-main bg-gray-50 dark:text-white text-text-main-light font-bold text-sm focus:outline-none focus:border-azul"
          />
          <span className="dark:text-text-secondary text-text-secondary-light text-sm">min</span>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light font-bold text-sm hover:border-rosa transition-all">Cancelar</button>
          <button onClick={() => onConfirm(minutes)} className="flex-1 py-3 rounded-2xl bg-azul text-white font-black text-sm hover:bg-azul/90 transition-all">Aplicar</button>
        </div>
      </div>
    </div>
  );
}

// --- Bulk Action Bar Component ---
function DelegadasView({ tasks, allTasksMap, blocks, people, meetings, timeEntries, onUpdateTask, onUpdatePeople, onUpdateMeetings, onAddTask, onEditTask, onDeleteTask, onRenamePerson, onDeletePerson, onRecurrenceDateChange = null, selectionMode = false, selectedTaskIds = new Set(), onToggleTaskSelection = null, onToggleSelectionMode = null, bulkUpdateTasks = null, bulkDeleteTasks = null, bulkDuplicateTasks = null, setBulkDelegateModal = null, setBulkDateModal = null, setBulkTimeModal = null }: any) {
  const [activeTab, setActiveTab] = useState<'tareas' | 'reuniones'>('tareas');
  const [filterPersonId, setFilterPersonId] = useState<string | null>(null);
  const [expandedPersons, setExpandedPersons] = useState<Set<string>>(new Set());
  const [showManageTeam, setShowManageTeam] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [newMeeting, setNewMeeting] = useState<{ personId: string; date: string; notes: string; items: any[] } | null>(null);
  const [expandedMeetings, setExpandedMeetings] = useState<Set<string>>(new Set());

  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(true);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editingPersonName, setEditingPersonName] = useState('');
  const [hideCompletedDelegadas, setHideCompletedDelegadas] = useState(false);
  // Expandir/contraer todos los contenedores de una persona
  const [allContainersExpanded, setAllContainersExpanded] = useState<Record<string, boolean>>({});

  const toggleAllContainersForPerson = (personId: string, containerIds: string[]) => {
    const currentlyExpanded = allContainersExpanded[personId] !== false; // default true
    if (currentlyExpanded) {
      // contraer todos
      setExpandedTasks(prev => { const n = new Set(prev); containerIds.forEach(id => n.delete(id)); return n; });
      setAllContainersExpanded(prev => ({ ...prev, [personId]: false }));
    } else {
      // expandir todos
      setExpandedTasks(prev => { const n = new Set(prev); containerIds.forEach(id => n.add(id)); return n; });
      setAllContainersExpanded(prev => ({ ...prev, [personId]: true }));
    }
  };

  // Modal selector de tareas para reunión
  const [showTaskSelector, setShowTaskSelector] = useState(false);
  const [selectorPersonId, setSelectorPersonId] = useState<string | null>(null);
  const [meetingSelectedIds, setMeetingSelectedIds] = useState<Set<string>>(new Set());

  const toggleTask = (id: string) => {
    setExpandedTasks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleAllPersons = () => {
    if (allExpanded) {
      setExpandedPersons(new Set());
    } else {
      setExpandedPersons(new Set(tasksByPerson.map((g: any) => g.person.id)));
    }
    setAllExpanded(!allExpanded);
  };

  const handleRenamePersonLocal = (id: string, name: string) => {
    onUpdatePeople((prev: any[]) => prev.map((p: any) => p.id === id ? { ...p, name } : p));
    if (onRenamePerson) onRenamePerson(id, name);
    setEditingPersonId(null);
  };

  // Tareas raíz delegadas directamente
  // Incluye: tareas normales, excepciones, Y templates con delegación (recurrentes delegadas)
  // Excluye: instancias generadas en memoria (templateId && !isException)
  const delegatedRootTasks = Object.values(allTasksMap).filter((t: any) =>
    t && t.delegation && !t.isDeleted && !t.parentTaskId &&
    (t.isTemplate || (!t.templateId || t.isException))
  );
  // Subtareas delegadas directamente (misma lógica)
  const delegatedSubtasks = Object.values(allTasksMap).filter((t: any) =>
    t && t.delegation && !t.isDeleted && t.parentTaskId &&
    (t.isTemplate || (!t.templateId || t.isException))
  );
  // Unión para uso en modal de reunión etc.
  const delegatedTasks = [...delegatedRootTasks, ...delegatedSubtasks];

  // Estado local para mantener el orden visual mientras se persiste
  const [localTaskOrders, setLocalTaskOrders] = useState<Record<string, string[]>>({});

  // Tipo de entrada en la lista: tarea raíz O contenedor-con-subtareas
  // { task: Task, subtasksForGroup: string[] | null }
  const tasksByPerson = people.map((p: any) => {
    // 1) Tareas raíz delegadas a esta persona
    const rootTasks = delegatedRootTasks
      .filter((t: any) => t.delegation?.personId === p.id)
      .filter((t: any) => !hideCompletedDelegadas || t.status !== 'completed');

    // 2) Subtareas delegadas a esta persona → agrupar bajo su padre
    const subtasksForPerson = delegatedSubtasks.filter((t: any) => t.delegation?.personId === p.id);
    const containerMap: Record<string, string[]> = {};
    subtasksForPerson.forEach((sub: any) => {
      if (!hideCompletedDelegadas || sub.status !== 'completed') {
        if (!containerMap[sub.parentTaskId]) containerMap[sub.parentTaskId] = [];
        containerMap[sub.parentTaskId].push(sub.id);
      }
    });

    // Construir entradas: { task, subtasksForGroup }
    // Para tareas raíz: subtasksForGroup = null
    // Para contenedores con subtareas delegadas: subtasksForGroup = [ids de subtareas delegadas a esta persona]
    const entries: { task: any; subtasksForGroup: string[] | null }[] = [];

    // Raíces directas
    rootTasks.forEach((t: any) => {
      entries.push({ task: t, subtasksForGroup: null });
    });

    // Contenedores con subtareas delegadas (que no estén ya como raíz directa)
    Object.entries(containerMap).forEach(([parentId, subIds]) => {
      const parentTask = allTasksMap[parentId];
      if (!parentTask || parentTask.isDeleted) return;
      // Evitar duplicado si el propio contenedor ya está delegado a esta persona
      if (entries.some(e => e.task.id === parentId)) return;
      entries.push({ task: parentTask, subtasksForGroup: subIds as string[] });
    });

    // Ordenar por campo order
    const localOrder = localTaskOrders[p.id];
    let sorted;
    if (localOrder) {
      const idMap: Record<string, any> = {};
      entries.forEach((e: any) => { idMap[e.task.id] = e; });
      sorted = localOrder.map((id: string) => idMap[id]).filter(Boolean);
      entries.forEach((e: any) => { if (!localOrder.includes(e.task.id)) sorted.push(e); });
    } else {
      sorted = [...entries].sort((a: any, b: any) => (a.task.order ?? 0) - (b.task.order ?? 0));
    }

    // Para compatibilidad con el render existente, extraemos .tasks como array de tareas
    // pero también exponemos subtasksForGroup por entrada
    return { person: p, tasks: sorted.map((e: any) => e.task), entries: sorted };
  }).filter((g: any) => g.entries.length > 0);

  const filteredByPerson = filterPersonId
    ? tasksByPerson.filter((g: any) => g.person.id === filterPersonId)
    : tasksByPerson;

  const togglePerson = (id: string) => {
    setExpandedPersons(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleMeeting = (id: string) => {
    setExpandedMeetings(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddPerson = () => {
    if (!newPersonName.trim()) return;
    const p: any = { id: `p-${Date.now()}`, name: newPersonName.trim(), createdAt: new Date().toISOString() };
    onUpdatePeople((prev: any[]) => [...prev, p]);
    setNewPersonName('');
  };

  const handleDeletePerson = (id: string) => {
    onUpdatePeople((prev: any[]) => prev.filter((p: any) => p.id !== id));
    if (onDeletePerson) onDeletePerson(id);
  };

  const handleStartMeeting = (personId: string) => {
    // Solo tareas padre — misma lógica que el selector
    const seen = new Set<string>();
    const parentIds: string[] = [];

    delegatedRootTasks
      .filter((t: any) => t.delegation?.personId === personId)
      .forEach((t: any) => { if (!seen.has(t.id)) { seen.add(t.id); parentIds.push(t.id); } });

    delegatedSubtasks
      .filter((t: any) => t.delegation?.personId === personId)
      .forEach((sub: any) => {
        const parentId = sub.parentTaskId;
        const parent = allTasksMap[parentId];
        if (parent && !parent.isDeleted && !seen.has(parentId)) {
          seen.add(parentId);
          parentIds.push(parentId);
        }
      });

    // Pre-seleccionar solo las pendientes
    const pendingIds = new Set<string>(
      parentIds.filter(id => allTasksMap[id]?.status !== 'completed')
    );
    setSelectorPersonId(personId);
    setMeetingSelectedIds(pendingIds);
    setShowTaskSelector(true);
  };

  const handleConfirmTaskSelection = () => {
    if (!selectorPersonId || meetingSelectedIds.size === 0) return;
    const selectedTasks = Array.from(meetingSelectedIds).map(id => allTasksMap[id]).filter(Boolean);
    setNewMeeting({
      personId: selectorPersonId,
      date: formatLocalISO(new Date()),
      notes: '',
      items: selectedTasks.map((t: any) => ({ taskId: t.id, note: '', isSubtask: !!t.parentTaskId }))
    });
    setShowTaskSelector(false);
    setShowNewMeeting(true);
  };

  const handleSaveMeeting = () => {
    if (!newMeeting) return;
    const person = people.find((p: any) => p.id === newMeeting.personId);
    const personName = person?.name || 'Desconocido';
    const meetingDate = parseLocalISO(newMeeting.date);
    const dayName = new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(meetingDate);
    const dateStr = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(meetingDate);
    const dayNameCap = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    const tasksStr = newMeeting.items
      .map((item: any) => { const task = allTasksMap[item.taskId]; return task ? `- ${task.title}` : ''; })
      .filter(Boolean).join('\n');
    const formattedNotes = `Reunión con ${personName} - ${dayNameCap}, ${dateStr}\n\nTareas tratadas:\n${tasksStr}`;

    const meeting: DelegationMeeting = {
      id: `m-${Date.now()}`,
      personId: newMeeting.personId,
      date: newMeeting.date,
      notes: formattedNotes,
      items: newMeeting.items.filter((i: any) => i.note.trim()),
      createdAt: new Date().toISOString()
    };
    // Añadir notas a cada tarea con timestamp día+hora
    meeting.items.forEach((item: any) => {
      const task = allTasksMap[item.taskId];
      if (task && item.note.trim()) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const timestamp = `${dd}/${mm}/${yyyy}, ${hh}:${min}`;
        const existingNotes = task.notes || '';
        const newNote = `[${timestamp}] Reunión ${personName} ${dd}/${mm}/${yyyy} - ${item.note}`;
        onUpdateTask({ ...task, notes: existingNotes ? `${existingNotes}\n${newNote}` : newNote });
      }
    });
    onUpdateMeetings((prev: any[]) => [meeting, ...prev]);
    setShowNewMeeting(false);
    setNewMeeting(null);
  };

  const filteredMeetings = filterPersonId
    ? meetings.filter((m: any) => m.personId === filterPersonId)
    : meetings;

  const getPersonName = (id: string) => people.find((p: any) => p.id === id)?.name || 'Desconocido';
  const getBlock = (blockId: string) => blocks.find((b: any) => b.id === blockId);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 pb-32">

      {/* Bulk Action Bar Delegadas */}
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

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black dark:text-white text-text-main-light">Delegadas</h2>
          <p className="text-text-secondary text-sm mt-1">{delegatedTasks.length} tareas · {people.length} personas</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Seleccionar */}
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
          {/* Expandir/Contraer - igual que Dashboard */}
          <button
            onClick={toggleAllPersons}
            className={`w-10 h-10 flex items-center justify-center rounded-full border-2 transition-all relative group ${
              allExpanded
                ? 'bg-azul text-white border-azul shadow-lg shadow-azul/30'
                : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul dark:hover:bg-azul/10 hover:bg-azul/5'
            }`}
            title={allExpanded ? 'Contraer personas' : 'Expandir personas'}
          >
            {allExpanded ? <ChevronsUp size={15} /> : <ChevronsDown size={15} />}
            <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 px-2.5 py-1.5 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-xl text-[9px] font-bold dark:text-white text-text-main-light whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
              {allExpanded ? 'Contraer personas' : 'Expandir personas'}
            </span>
          </button>
          {/* Ver/Ocultar completadas - igual que Dashboard */}
          <button
            onClick={() => setHideCompletedDelegadas(!hideCompletedDelegadas)}
            className={`w-10 h-10 flex items-center justify-center rounded-2xl border transition-all relative group ${
              hideCompletedDelegadas
                ? 'bg-turquesa text-white border-turquesa'
                : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa hover:text-turquesa dark:hover:bg-turquesa/10 hover:bg-turquesa/5'
            }`}
            title={hideCompletedDelegadas ? 'Ver completadas' : 'Ocultar completadas'}
          >
            {hideCompletedDelegadas ? <Eye size={16} /> : <EyeOff size={16} />}
            <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 px-2.5 py-1.5 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-xl text-[9px] font-bold dark:text-white text-text-main-light whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
              {hideCompletedDelegadas ? 'Ver completadas' : 'Ocultar completadas'}
            </span>
          </button>
          <button
            onClick={() => { setShowNewMeeting(true); setNewMeeting({ personId: '', date: formatLocalISO(new Date()), notes: '', items: [] }); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-azul/10 border border-azul/30 text-azul rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-azul/20 transition-all"
          >
            <History size={14} />
            Nueva reunión
          </button>
          <button
            onClick={() => onAddTask && onAddTask()}
            className="flex items-center gap-2 px-4 py-2.5 bg-morado dark:text-white text-text-main-light rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-morado/80 transition-all shadow-lg shadow-morado/20"
          >
            <Plus size={14} />
            Nueva tarea
          </button>
          <button
            onClick={() => setShowManageTeam(true)}
            className="flex items-center gap-2 px-4 py-2.5 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl text-[11px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light hover:text-white hover:border-white/20 transition-all"
          >
            <Users size={14} />
            Equipo
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 dark:bg-bg-card bg-bg-card-light p-1.5 rounded-2xl border dark:border-border-main border-border-main-light w-fit">
        {(['tareas', 'reuniones'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab ? 'bg-morado dark:text-white text-text-main-light shadow-lg shadow-morado/20' : 'text-text-secondary hover:text-white'
            }`}
          >
            {tab === 'tareas' ? 'Tareas' : 'Reuniones'}
          </button>
        ))}
      </div>

      {/* Filter by person */}
      {people.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterPersonId(null)}
            className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
              !filterPersonId ? 'bg-morado/10 border-morado/50 text-morado' : 'dark:bg-bg-card bg-gray-100 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'
            }`}
          >
            Todos
          </button>
          {people.map((p: any) => (
            <button
              key={p.id}
              onClick={() => setFilterPersonId(filterPersonId === p.id ? null : p.id)}
              className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                filterPersonId === p.id ? 'bg-morado/10 border-morado/50 text-morado' : 'dark:bg-bg-card bg-gray-100 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* TAREAS TAB */}
      {activeTab === 'tareas' && (
        <div className="space-y-4">
          {filteredByPerson.length === 0 && (
            <div className="py-24 text-center dark:text-text-secondary text-text-secondary-light border-2 border-dashed dark:border-border-main border-border-main-light rounded-[2.5rem] opacity-50">
              <User size={40} className="mx-auto mb-4 opacity-20" />
              <p className="font-black uppercase tracking-widest text-sm">Sin tareas delegadas</p>
              <p className="text-xs mt-2 opacity-60">Delega tareas desde el Dashboard usando el chip 👤</p>
            </div>
          )}
          {filteredByPerson.map(({ person, tasks: personTasks, entries: personEntries }: any) => {
            const isOpen = expandedPersons.has(person.id);
            // IDs de contenedores con subtareas delegadas en esta persona
            const containerIds = (personEntries || []).filter((e: any) => e.subtasksForGroup && e.subtasksForGroup.length > 0).map((e: any) => e.task.id);
            const allContainersExp = allContainersExpanded[person.id] !== false;
            return (
              <div key={person.id} className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] overflow-hidden shadow-xl">
                {/* Person header */}
                <button
                  onClick={() => togglePerson(person.id)}
                  className="w-full flex items-center justify-between p-5 hover:bg-white/2 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-morado/20 border border-morado/30 flex items-center justify-center text-morado font-black text-lg">
                      {person.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="font-black dark:text-white text-text-main-light uppercase tracking-widest text-sm">{person.name}</p>
                      <p className="text-[10px] dark:text-text-secondary text-text-secondary-light">{(personEntries || personTasks).length} elemento{(personEntries || personTasks).length !== 1 ? 's' : ''} delegado{(personEntries || personTasks).length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Botón expandir/contraer todos los contenedores de esta persona */}
                    {containerIds.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleAllContainersForPerson(person.id, containerIds); }}
                        className="flex items-center gap-1.5 px-3 py-2 dark:bg-bg-main bg-gray-100 hover:bg-turquesa/10 border dark:border-border-main border-border-main-light hover:border-turquesa/30 text-turquesa rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                        title={allContainersExp ? 'Contraer contenedores' : 'Expandir contenedores'}
                      >
                        {allContainersExp ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddTask && onAddTask(null, undefined, undefined, person.id); }}
                      className="w-8 h-8 flex items-center justify-center bg-morado dark:text-white text-text-main-light rounded-xl hover:bg-morado/80 transition-all shadow-lg shadow-morado/20"
                      title={`Nueva tarea delegada a ${person.name}`}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStartMeeting(person.id); }}
                      className="flex items-center gap-2 px-3 py-2 bg-azul/10 hover:bg-azul/20 border border-azul/30 text-azul rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                    >
                      <History size={12} />
                      Reunión
                    </button>
                    {isOpen ? <ChevronUp size={18} className="text-text-secondary" /> : <ChevronDown size={18} className="text-text-secondary" />}
                  </div>
                </button>

                {/* Tasks list */}
                {isOpen && (
                  <div className="border-t dark:border-border-main border-border-main-light/50 divide-y dark:divide-border-main divide-border-main-light">
                      {(personEntries || personTasks.map((t: any) => ({ task: t, subtasksForGroup: null }))).map(({ task, subtasksForGroup: delegatedSubIds }: any, taskIdx: number) => {
                        const block = getBlock(task.blockId);
                        const tag = task.tags?.[0];
                        // Si hay subtasksForGroup (contenedor con subtareas delegadas), mostrar solo esas subtareas
                        const isContainerWithDelegatedSubs = delegatedSubIds && delegatedSubIds.length > 0;
                        const hasSubtasks = isContainerWithDelegatedSubs || (task.subtasks && task.subtasks.length > 0);
                        const isTaskOpen = expandedTasks.has(task.id);
                        const subtaskList = isContainerWithDelegatedSubs
                          ? delegatedSubIds.map((sid: string) => allTasksMap[sid]).filter((s: any) => s && !s.isDeleted)
                          : hasSubtasks
                            ? (task.subtasks || []).map((sid: string) => allTasksMap[sid]).filter((s: any) => s && !s.isDeleted)
                            : [];

                        const handleMoveUp = () => {
                          if (taskIdx === 0) return;
                          const allEntries = personEntries || personTasks.map((t: any) => ({ task: t, subtasksForGroup: null }));
                          const newOrder = allEntries.map((e: any) => e.task.id);
                          [newOrder[taskIdx - 1], newOrder[taskIdx]] = [newOrder[taskIdx], newOrder[taskIdx - 1]];
                          setLocalTaskOrders(prev => ({ ...prev, [person.id]: newOrder }));
                          const prevEntry = allEntries[taskIdx - 1];
                          const curr = task;
                          onUpdateTask({ ...curr, order: taskIdx - 1, modifiedAt: new Date().toISOString() });
                          onUpdateTask({ ...prevEntry.task, order: taskIdx, modifiedAt: new Date().toISOString() });
                        };
                        const handleMoveDown = () => {
                          const allEntries = personEntries || personTasks.map((t: any) => ({ task: t, subtasksForGroup: null }));
                          if (taskIdx === allEntries.length - 1) return;
                          const newOrder = allEntries.map((e: any) => e.task.id);
                          [newOrder[taskIdx], newOrder[taskIdx + 1]] = [newOrder[taskIdx + 1], newOrder[taskIdx]];
                          setLocalTaskOrders(prev => ({ ...prev, [person.id]: newOrder }));
                          const nextEntry = allEntries[taskIdx + 1];
                          const curr = task;
                          onUpdateTask({ ...curr, order: taskIdx + 1, modifiedAt: new Date().toISOString() });
                          onUpdateTask({ ...nextEntry.task, order: taskIdx, modifiedAt: new Date().toISOString() });
                        };
                        const totalEntries = (personEntries || personTasks).length;

                        return (
                          <div key={task.id} className={`border-b dark:border-border-main border-border-main-light/30 last:border-0 ${task.status === 'completed' ? 'opacity-50' : ''}`}>
                            {/* Task row */}
                            <div className="flex items-center gap-3 px-4 py-3 hover:dark:bg-white/2 hover:bg-gray-50 transition-all group/trow">

                              {/* Flechitas reordenar - hover */}
                              <div className="flex flex-col gap-0.5 opacity-0 group-hover/trow:opacity-100 transition-opacity shrink-0">
                                <button onClick={handleMoveUp} disabled={taskIdx === 0} className={`w-5 h-5 flex items-center justify-center rounded transition-all ${taskIdx === 0 ? 'dark:text-text-secondary/20 text-text-secondary-light/20 cursor-not-allowed' : 'dark:text-text-secondary text-text-secondary-light hover:text-turquesa hover:bg-turquesa/10'}`} title="Subir"><ChevronUp size={12} /></button>
                                <button onClick={handleMoveDown} disabled={taskIdx === totalEntries - 1} className={`w-5 h-5 flex items-center justify-center rounded transition-all ${taskIdx === totalEntries - 1 ? 'dark:text-text-secondary/20 text-text-secondary-light/20 cursor-not-allowed' : 'dark:text-text-secondary text-text-secondary-light hover:text-turquesa hover:bg-turquesa/10'}`} title="Bajar"><ChevronDown size={12} /></button>
                              </div>

                              {/* Barra color bloque */}
                              <div className="w-1 h-full min-h-[2.5rem] rounded-full shrink-0" style={{ backgroundColor: block?.color || '#666' }} />

                              {/* Checkbox - turquesa normal, azul en modo selección */}
                              {selectionMode && onToggleTaskSelection ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleTaskSelection(task.id, false);
                                  }}
                                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                                    selectedTaskIds.has(task.id)
                                      ? 'bg-azul border-azul text-white'
                                      : 'dark:border-border-main border-border-main-light hover:border-azul'
                                  }`}
                                >
                                  {selectedTaskIds.has(task.id) && <Check size={10} />}
                                </button>
                              ) : (
                                <button
                                  onClick={() => onUpdateTask({ ...task, status: task.status === 'completed' ? 'pending' : 'completed', modifiedAt: new Date().toISOString() })}
                                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${task.status === 'completed' ? 'bg-turquesa border-turquesa text-white' : 'dark:border-border-main border-border-main-light hover:border-turquesa'}`}
                                >
                                  {task.status === 'completed' && <Check size={10} />}
                                </button>
                              )}

                              {/* Título + info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className={`font-black dark:text-white text-text-main-light text-[13px] truncate capitalize tracking-normal flex-1 ${task.status === 'completed' ? 'line-through' : ''}`}>{task.title}</p>
                                  {/* Badge circular subtareas - junto al título como Dashboard */}
                                  {hasSubtasks && (() => {
                                    const pendingCount = subtaskList.filter((s: any) => s && !s.isDeleted && s.status !== 'completed').length;
                                    return (
                                      <button
                                        onClick={() => toggleTask(task.id)}
                                        className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center bg-rosa/20 border border-rosa/40 text-rosa transition-all hover:bg-rosa/30"
                                      >
                                        {String(pendingCount)}
                                      </button>
                                    );
                                  })()}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  {/* Contenedor: solo bloque + recurrencia */}
                                  {isContainerWithDelegatedSubs ? (
                                    <>
                                      {task.recurrence && (
                                        <span className="flex items-center gap-1 text-[8px] font-black text-morado uppercase">
                                          <RefreshCw size={9} />
                                          {task.recurrence.frequency === 'daily' ? 'Diaria' : task.recurrence.frequency === 'weekdays' ? 'L-V' : task.recurrence.frequency === 'weekly' ? 'Semanal' : task.recurrence.frequency === 'monthly' ? 'Mensual' : 'Anual'}
                                        </span>
                                      )}
                                      {/* Badge bloque */}
                                      {block && <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light shrink-0">{block.icon} {block.name}</span>}
                                    </>
                                  ) : (
                                    <>
                                      {task.recurrence && (
                                        <span className="flex items-center gap-1 text-[8px] font-black text-morado uppercase">
                                          <RefreshCw size={9} />
                                          {task.recurrence.frequency === 'daily' ? 'Diaria' : task.recurrence.frequency === 'weekdays' ? 'L-V' : task.recurrence.frequency === 'weekly' ? 'Semanal' : task.recurrence.frequency === 'monthly' ? 'Mensual' : 'Anual'}
                                        </span>
                                      )}
                                      {!task.isTemplate && <TimePickerChip value={task.dueTime || ''} onChange={(time: string) => onUpdateTask({ ...task, dueTime: time })} />}
                                      {!task.isTemplate && <DatePickerChip value={task.dueDate} onChange={(date: string) => onUpdateTask({ ...task, dueDate: date })} />}
                                      <TagPickerChip selectedTags={task.tags} onChange={(tags: TagType[]) => onUpdateTask({ ...task, tags })} />
                                      <DelegationChip delegation={task.delegation} people={people || []} onChange={(delegation: any) => onUpdateTask({ ...task, delegation })} onAddPerson={(p: any) => onUpdatePeople((prev: any[]) => [...prev, p])} onRenamePerson={onRenamePerson} onDeletePerson={onDeletePerson} />
                                      <EstimatedTimeChip value={task.estimatedMinutes} onChange={(val: number) => onUpdateTask({ ...task, estimatedMinutes: val })} variant="mini" />
                                      {(() => { const reg = getTaskRegisteredCombo(task.id, allTasksMap, timeEntries || []); return reg > 0 ? <RegisteredTimeChip value={reg} estimated={task.estimatedMinutes || 0} onClick={() => {}} /> : null; })()}
                                      {/* Badge bloque al final */}
                                      {block && <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light shrink-0">{block.icon} {block.name}</span>}
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Fechas - solo para tareas huérfanas */}
                              {!isContainerWithDelegatedSubs && (
                                <div className="flex items-center gap-3 shrink-0">
                                  {task.dueDate && (
                                    <div className="text-right">
                                      <p className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light/40 uppercase">Ejec.</p>
                                      <p className="text-[10px] font-bold text-turquesa">{new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }).format(parseLocalISO(task.dueDate))}</p>
                                    </div>
                                  )}
                                  {task.delegation?.delegatedAt && (
                                    <div className="text-right">
                                      <p className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light/40 uppercase">Deleg.</p>
                                      <p className="text-[10px] font-bold text-morado">{new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }).format(parseLocalISO(task.delegation.delegatedAt))}</p>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Edit/Delete - hover, PARA TODOS (contenedores y huérfanas) */}
                              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/trow:opacity-100 transition-all">
                                <button onClick={() => onEditTask && onEditTask(task.id)} className="w-7 h-7 flex items-center justify-center text-turquesa bg-turquesa/5 hover:bg-turquesa/15 rounded-lg border border-turquesa/20 transition-all" title="Editar"><Edit size={12} /></button>
                                <button onClick={() => onDeleteTask && onDeleteTask(task.id)} className="w-7 h-7 flex items-center justify-center text-rosa bg-rosa/5 hover:bg-rosa/15 rounded-lg border border-rosa/20 transition-all" title="Eliminar"><Trash2 size={12} /></button>
                              </div>

                            </div>
                            {/* Subtasks expandable */}
                            <AnimatePresence>
                              {isTaskOpen && hasSubtasks && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="border-t dark:border-border-main border-border-main-light/20 ml-20 border-l dark:border-l-border-main/30 border-l-border-main-light/30"
                                >
                                  {subtaskList.map((sub: any) => {
                                    return (
                                      <div key={sub.id} className="flex items-center gap-3 pl-4 pr-4 py-3 hover:dark:bg-white/2 hover:bg-gray-50 transition-all border-b dark:border-border-main border-border-main-light/10 last:border-0 group/subrow">
                                        {/* Checkbox completar subtarea */}
                                        <button
                                          onClick={() => onUpdateTask({ ...sub, status: sub.status === 'completed' ? 'pending' : 'completed', modifiedAt: new Date().toISOString() })}
                                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                                            sub.status === 'completed'
                                              ? 'bg-turquesa border-turquesa text-white'
                                              : 'dark:border-border-main border-border-main-light hover:border-turquesa'
                                          }`}
                                        >
                                          {sub.status === 'completed' && <Check size={10} />}
                                        </button>
                                        <div className="flex-1 min-w-0">
                                          <p className={`font-bold dark:text-white text-text-main-light text-xs truncate capitalize tracking-normal mb-1 ${sub.status === 'completed' ? 'line-through' : ''}`}>{sub.title}</p>
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            {/* TimePickerChip - subtareas pueden tener hora */}
                                            {!sub.isTemplate && sub.dueDate && (
                                              <TimePickerChip
                                                value={sub.dueTime || ''}
                                                onChange={(time: string) => onUpdateTask({ ...sub, dueTime: time })}
                                              />
                                            )}
                                            {/* DatePickerChip */}
                                            {!sub.isTemplate && (
                                              <DatePickerChip
                                                value={sub.dueDate}
                                                onChange={(date: string) => onUpdateTask({ ...sub, dueDate: date })}
                                              />
                                            )}
                                            {/* RecurrencePickerChip - subtareas pueden ser recurrentes */}
                                            {!sub.subtasks || sub.subtasks.length === 0 ? (
                                              <RecurrencePickerChip 
                                                value={sub.recurrence}
                                                onChange={(rec: any) => {
                                                  onUpdateTask({ 
                                                    ...sub, 
                                                    recurrence: rec || undefined,
                                                    isTemplate: !!rec,
                                                    dueDate: rec ? null : (sub.dueDate || formatLocalISO(new Date())),
                                                    dueTime: sub.dueTime
                                                  });
                                                  // Si la subtarea tiene recurrencia, marcar el padre como isTemplate y dueDate:null
                                                  if (rec && sub.parentTaskId && allTasksMap[sub.parentTaskId]) {
                                                    const parent = allTasksMap[sub.parentTaskId];
                                                    if (!parent.isTemplate || parent.dueDate) {
                                                      onUpdateTask({ ...parent, isTemplate: true, dueDate: null });
                                                    }
                                                  }
                                                }}
                                              />
                                            ) : null}
                                            <TagPickerChip
                                              selectedTags={sub.tags}
                                              onChange={(tags: TagType[]) => onUpdateTask({ ...sub, tags })}
                                            />
                                            <DelegationChip
                                              delegation={sub.delegation}
                                              people={people || []}
                                              onChange={(delegation: any) => onUpdateTask({ ...sub, delegation })}
                                              onAddPerson={(p: any) => onUpdatePeople((prev: any[]) => [...prev, p])}
                                              onRenamePerson={onRenamePerson}
                                              onDeletePerson={onDeletePerson}
                                            />
                                            <EstimatedTimeChip
                                              value={sub.estimatedMinutes}
                                              onChange={(val: number) => onUpdateTask({ ...sub, estimatedMinutes: val })}
                                              variant="mini"
                                            />
                                            {(() => { const reg = getTaskRegisteredCombo(sub.id, allTasksMap, timeEntries || []); return reg > 0 ? <RegisteredTimeChip value={reg} estimated={sub.estimatedMinutes || 0} onClick={() => {}} /> : null; })()}
                                          </div>
                                        </div>
                                        {/* Fecha delegación subtarea */}
                                        {sub.delegation?.delegatedAt && (
                                          <div className="text-right shrink-0">
                                            <p className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light/40 uppercase">Deleg.</p>
                                            <p className="text-[10px] font-bold text-morado">
                                              {new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }).format(parseLocalISO(sub.delegation.delegatedAt))}
                                            </p>
                                          </div>
                                        )}
                                        <div className="flex items-center gap-1 opacity-0 group-hover/subrow:opacity-100 transition-all">
                                          <button onClick={() => onEditTask && onEditTask(sub.id)} className="w-7 h-7 flex items-center justify-center text-turquesa bg-turquesa/5 hover:bg-turquesa/15 rounded-lg border border-turquesa/20 transition-all"><Edit size={12} /></button>
                                          <button onClick={() => onDeleteTask && onDeleteTask(sub.id)} className="w-7 h-7 flex items-center justify-center text-rosa bg-rosa/5 hover:bg-rosa/15 rounded-lg border border-rosa/20 transition-all"><Trash2 size={12} /></button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* REUNIONES TAB */}
      {activeTab === 'reuniones' && (
        <div className="space-y-4">
          {filteredMeetings.length === 0 && (
            <div className="py-24 text-center dark:text-text-secondary text-text-secondary-light border-2 border-dashed dark:border-border-main border-border-main-light rounded-[2.5rem] opacity-50">
              <History size={40} className="mx-auto mb-4 opacity-20" />
              <p className="font-black uppercase tracking-widest text-sm">Sin reuniones registradas</p>
              <p className="text-xs mt-2 opacity-60">Crea una reunión desde la pestaña Tareas</p>
            </div>
          )}
          {filteredMeetings.map((meeting: any) => {
            const isOpen = expandedMeetings.has(meeting.id);
            return (
              <div key={meeting.id} className="bg-bg-card border dark:border-border-main border-border-main-light rounded-[2rem] overflow-hidden shadow-xl">
                <button
                  onClick={() => toggleMeeting(meeting.id)}
                  className="w-full flex items-center justify-between p-5 hover:bg-white/2 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-azul/20 border border-azul/30 flex items-center justify-center text-azul">
                      <History size={18} />
                    </div>
                    <div className="text-left">
                      <p className="font-black dark:text-white text-text-main-light uppercase tracking-widest text-sm">
                        Reunión con {getPersonName(meeting.personId)}
                      </p>
                      <p className="text-[10px] dark:text-text-secondary text-text-secondary-light">
                        {new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseLocalISO(meeting.date))}
                        {' · '}{meeting.items.length} notas
                      </p>
                    </div>
                  </div>
                  {isOpen ? <ChevronUp size={18} className="text-text-secondary" /> : <ChevronDown size={18} className="text-text-secondary" />}
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t dark:border-border-main border-border-main-light/50 p-5 space-y-3"
                    >
                      {meeting.notes && (
                        <div className="bg-bg-main rounded-xl p-3 border dark:border-border-main border-border-main-light">
                          <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-1">Nota general</p>
                          <p className="text-sm dark:text-white text-text-main-light">{meeting.notes}</p>
                        </div>
                      )}
                      {meeting.items.map((item: any) => {
                        const task = allTasksMap[item.taskId];
                        const block = task ? getBlock(task.blockId) : null;
                        return (
                          <div key={item.taskId} className="flex gap-3 p-3 dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light group/mitem">
                            <div className="w-1 h-full min-h-[2rem] rounded-full shrink-0 bg-morado/40" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-black text-morado uppercase tracking-wider truncate">{task?.title || item.taskId}</p>
                                  {block && <span className="text-[8px] text-text-secondary font-black">{block.icon} {block.name}</span>}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover/mitem:opacity-100 transition-all shrink-0">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); if (onEditTask) onEditTask(item.taskId); }}
                                    className="w-6 h-6 flex items-center justify-center text-turquesa/70 hover:text-turquesa hover:bg-turquesa/10 rounded-lg transition-all"
                                    title="Abrir tarea"
                                  >
                                    <Edit size={11} />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); if (onDeleteTask) onDeleteTask(item.taskId); }}
                                    className="w-6 h-6 flex items-center justify-center text-rosa/70 hover:text-rosa hover:bg-rosa/10 rounded-lg transition-all"
                                    title="Eliminar tarea"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                              <p className="text-sm text-text-secondary mt-1">{item.note}</p>
                            </div>
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* MANAGE TEAM MODAL */}
      <AnimatePresence>
        {showManageTeam && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowManageTeam(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-3xl p-6 shadow-2xl w-full max-w-sm z-10"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black dark:text-white text-text-main-light uppercase tracking-widest">Equipo</h3>
                <button onClick={() => setShowManageTeam(false)} className="w-8 h-8 flex items-center justify-center dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light dark:bg-bg-main bg-gray-100 rounded-xl border dark:border-border-main border-border-main-light">
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                {people.length === 0 && (
                  <p className="dark:text-text-secondary text-text-secondary-light text-sm text-center py-4">Sin personas. Añade la primera.</p>
                )}
                {people.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-2 p-3 dark:bg-bg-main bg-gray-100 rounded-xl border dark:border-border-main border-border-main-light group/mgr">
                    <div className="w-8 h-8 rounded-xl bg-morado/20 flex items-center justify-center text-morado font-black text-sm shrink-0">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    {editingPersonId === p.id ? (
                      <input
                        autoFocus
                        value={editingPersonName}
                        onChange={e => setEditingPersonName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRenamePersonLocal(p.id, editingPersonName);
                          if (e.key === 'Escape') setEditingPersonId(null);
                        }}
                        onBlur={() => handleRenamePersonLocal(p.id, editingPersonName)}
                        className="flex-1 dark:bg-bg-card bg-white border border-morado/50 rounded-lg px-2 py-1 text-sm dark:text-white text-text-main-light outline-none"
                      />
                    ) : (
                      <span className="flex-1 font-bold dark:text-white text-text-main-light text-sm">{p.name}</span>
                    )}
                    <button
                      onClick={() => { setEditingPersonId(p.id); setEditingPersonName(p.name); }}
                      className="w-7 h-7 flex items-center justify-center text-turquesa/40 hover:text-turquesa hover:bg-turquesa/10 rounded-lg transition-all opacity-0 group-hover/mgr:opacity-100"
                      title="Renombrar"
                    >
                      <Edit size={12} />
                    </button>
                    <button
                      onClick={() => handleDeletePerson(p.id)}
                      className="w-7 h-7 flex items-center justify-center text-rosa/40 hover:text-rosa hover:bg-rosa/10 rounded-lg transition-all opacity-0 group-hover/mgr:opacity-100"
                      title="Eliminar"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPersonName}
                  onChange={e => setNewPersonName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddPerson()}
                  placeholder="Nombre..."
                  className="flex-1 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2.5 text-sm dark:text-white text-text-main-light dark:placeholder:text-text-secondary/40 placeholder:text-text-secondary-light/40 outline-none focus:border-morado/50"
                />
                <button
                  onClick={handleAddPerson}
                  className="px-4 py-2.5 bg-morado text-white rounded-xl font-black text-sm hover:bg-morado/80 transition-all"
                >
                  <Plus size={16} />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL SELECTOR DE TAREAS PARA REUNIÓN */}
      <AnimatePresence>
        {showTaskSelector && selectorPersonId && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowTaskSelector(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-3xl p-6 shadow-2xl w-full max-w-lg z-10 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-lg font-black dark:text-white text-text-main-light uppercase tracking-widest">Nueva Reunión</h3>
                  <p className="text-[11px] text-morado font-black mt-0.5">{getPersonName(selectorPersonId)}</p>
                </div>
                <button onClick={() => setShowTaskSelector(false)} className="w-8 h-8 flex items-center justify-center dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light dark:bg-bg-main bg-gray-100 rounded-xl border dark:border-border-main border-border-main-light">
                  <X size={16} />
                </button>
              </div>
              <p className="text-[11px] dark:text-text-secondary text-text-secondary-light mb-4">Selecciona las tareas que quieres tratar:</p>
              <div className="space-y-2 mb-6">
                {(() => {
                  // Solo mostrar tareas padre para esta persona — sin subtareas individuales
                  // Incluye: raíces delegadas directamente + contenedores padre de subtareas delegadas
                  const seen = new Set<string>();
                  const items: any[] = [];

                  // 1) Tareas raíz delegadas directamente a esta persona
                  delegatedRootTasks
                    .filter((t: any) => t.delegation?.personId === selectorPersonId)
                    .forEach((t: any) => { if (!seen.has(t.id)) { seen.add(t.id); items.push({ task: t, subtitleIds: [] }); } });

                  // 2) Contenedores padre de subtareas delegadas a esta persona
                  delegatedSubtasks
                    .filter((t: any) => t.delegation?.personId === selectorPersonId)
                    .forEach((sub: any) => {
                      const parent = allTasksMap[sub.parentTaskId];
                      if (!parent || parent.isDeleted) return;
                      if (seen.has(parent.id)) {
                        // añadir subtarea al grupo existente
                        const entry = items.find((e: any) => e.task.id === parent.id);
                        if (entry) entry.subtitleIds.push(sub.id);
                      } else {
                        seen.add(parent.id);
                        items.push({ task: parent, subtitleIds: [sub.id] });
                      }
                    });

                  return items.map(({ task, subtitleIds }: any) => {
                    const isSelected = meetingSelectedIds.has(task.id);
                    const isCompleted = task.status === 'completed';
                    const subNames = subtitleIds.map((sid: string) => allTasksMap[sid]?.title).filter(Boolean);
                    return (
                      <button
                        key={task.id}
                        onClick={() => setMeetingSelectedIds(prev => { const n = new Set(prev); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n; })}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${isSelected ? 'dark:bg-morado/10 bg-morado/5 border-morado' : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light hover:border-morado/30'} ${isCompleted ? 'opacity-50' : ''}`}
                      >
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? 'bg-morado border-morado text-white' : 'dark:border-border-main border-border-main-light'}`}>
                          {isSelected && <Check size={12} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold dark:text-white text-text-main-light truncate ${isCompleted ? 'line-through' : ''}`}>{task.title}</p>
                          {subNames.length > 0 && (
                            <p className="text-[9px] dark:text-text-secondary text-text-secondary-light truncate mt-0.5">{subNames.join(' · ')}</p>
                          )}
                          {isCompleted && <span className="text-[9px] text-turquesa font-black uppercase tracking-wider">Completada</span>}
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowTaskSelector(false)}
                  className="flex-1 px-4 py-3 dark:bg-bg-main bg-gray-100 border dark:border-border-main border-border-main-light rounded-2xl text-[11px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmTaskSelection}
                  disabled={meetingSelectedIds.size === 0}
                  className={`flex-1 px-4 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${meetingSelectedIds.size === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-azul text-white hover:bg-azul/90 shadow-lg shadow-azul/20'}`}
                >
                  Crear reunión ({meetingSelectedIds.size})
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* NEW MEETING MODAL */}
      <AnimatePresence>
        {showNewMeeting && newMeeting && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNewMeeting(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-3xl p-6 shadow-2xl w-full max-w-lg z-10 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-black dark:text-white text-text-main-light uppercase tracking-widest">Nueva Reunión</h3>
                  {newMeeting.personId && <p className="text-[11px] text-morado font-black mt-0.5">{getPersonName(newMeeting.personId)}</p>}
                </div>
                <button onClick={() => { setShowNewMeeting(false); setNewMeeting(null); }} className="w-8 h-8 flex items-center justify-center dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light dark:bg-bg-main bg-gray-100 rounded-xl border dark:border-border-main border-border-main-light">
                  <X size={16} />
                </button>
              </div>
              {/* Person selector - only show if no person preselected */}
              {!newMeeting.personId && (
                <div className="mb-4 space-y-2">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block">Persona</label>
                  <div className="flex flex-wrap gap-2">
                    {people.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          const personTasks = delegatedTasks.filter((t: any) => t.delegation?.personId === p.id);
                          const allItems: any[] = [];
                          personTasks.forEach((t: any) => {
                            allItems.push({ taskId: t.id, note: '', isSubtask: false });
                            if (t.subtasks) t.subtasks.forEach((sid: string) => {
                              const sub = allTasksMap[sid];
                              if (sub && !sub.isDeleted) allItems.push({ taskId: sid, note: '', isSubtask: true });
                            });
                          });
                          setNewMeeting({ ...newMeeting, personId: p.id, items: allItems });
                        }}
                        className="flex items-center gap-2 px-3 py-2 dark:bg-bg-main bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-[11px] font-bold dark:text-white text-text-main-light hover:border-morado/50 transition-all"
                      >
                        <div className="w-6 h-6 rounded-lg bg-morado/20 flex items-center justify-center text-morado text-[10px] font-black">
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block mb-2">Fecha</label>
                  <input
                    type="date"
                    value={newMeeting.date}
                    onChange={e => setNewMeeting({ ...newMeeting, date: e.target.value })}
                    className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2.5 text-sm dark:text-white text-text-main-light outline-none focus:border-morado/50"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block mb-2">Nota general</label>
                  <textarea
                    value={newMeeting.notes}
                    onChange={e => setNewMeeting({ ...newMeeting, notes: e.target.value })}
                    placeholder="Resumen de la reunión..."
                    rows={1}
                    onInput={(e: any) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                    className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2.5 text-sm dark:text-white text-text-main-light dark:placeholder:text-text-secondary/40 placeholder:text-text-secondary-light/40 outline-none focus:border-morado/50 resize-none overflow-hidden"
                  />
                </div>

                {newMeeting.items.length > 0 && (
                  <div>
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block mb-2">Seguimiento por tarea</label>
                    <div className="space-y-2">
                      {newMeeting.items.map((item: any, idx: number) => {
                        const task = allTasksMap[item.taskId];
                        if (!task) return null;
                        const block = getBlock(task.blockId);
                        const tag = task.tags?.[0];
                        return (
                          <div key={item.taskId} className={`border dark:border-border-main border-border-main-light rounded-xl overflow-hidden ${item.isSubtask ? 'ml-4 dark:bg-bg-main/50 bg-gray-50' : 'dark:bg-bg-main bg-white'}`}>
                            {/* Task header with chips */}
                            <div className="flex items-center gap-2 px-3 py-2 border-b dark:border-border-main/30 border-border-main-light/30">
                              <div className="w-1 h-6 rounded-full shrink-0" style={{ backgroundColor: block?.color || '#666' }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-wider truncate">{task.title}</p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {block && <span className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light">{block.icon} {block.name}</span>}
                                  {task.dueDate && (
                                    <span className="text-[8px] font-black text-turquesa px-1 py-0.5 bg-turquesa/10 rounded-md">
                                      {new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }).format(parseLocalISO(task.dueDate))}
                                    </span>
                                  )}
                                  {task.taskType && (
                                    <span className={`text-[8px] font-black uppercase px-1 py-0.5 rounded-full border ${task.taskType === 'core' ? 'bg-turquesa/10 border-turquesa/20 text-turquesa' : 'bg-rosa/10 border-rosa/20 text-rosa'}`}>
                                      {task.taskType === 'core' ? 'Core' : 'Ad-hoc'}
                                    </span>
                                  )}
                                  {tag && <span className="text-[8px] font-black text-text-secondary">{TAG_LABELS[tag as TagType]?.label || tag}</span>}
                                  {task.estimatedMinutes > 0 && (
                                    <span className="text-[8px] font-black text-azul flex items-center gap-0.5"><Clock size={8} />{formatMinutes(task.estimatedMinutes)}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="p-3">
                              <textarea
                                value={item.note}
                                onChange={e => {
                                  const items = [...newMeeting.items];
                                  items[idx] = { ...item, note: e.target.value };
                                  setNewMeeting({ ...newMeeting, items });
                                }}
                                placeholder="¿Qué dijo sobre esta tarea?..."
                                rows={1}
                                onInput={(e: any) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                                className="w-full dark:bg-bg-card bg-gray-50 border dark:border-border-main/50 border-border-main-light rounded-lg px-3 py-2 text-sm dark:text-white text-text-main-light dark:placeholder:text-text-secondary/30 placeholder:text-text-secondary-light/50 outline-none focus:border-morado/40 resize-none overflow-hidden"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowNewMeeting(false)}
                  className="flex-1 py-3 rounded-2xl border border-border-main text-text-secondary hover:text-white hover:border-white/20 transition-all font-black text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveMeeting}
                  className="flex-1 py-3 rounded-2xl bg-morado text-white font-black text-sm hover:bg-morado/80 transition-all"
                >
                  Guardar reunión
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
