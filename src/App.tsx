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
    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  };

  const bulkDuplicateTasks = () => {
    const timestamp = new Date().toISOString();
    setTasks(prev => {
      const next = { ...prev };
      selectedTaskIds.forEach(id => {
        const original = prev[id];
        if (original && !original.isDeleted) {
          const newId = `t-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const duplicate: Task = {
            ...original,
            id: newId,
            title: `${original.title} (copia)`,
            status: 'pending',
            createdAt: timestamp,
            modifiedAt: timestamp,
            completedAt: undefined,
            subtasks: [], // No duplicar subtareas por ahora
          };
          next[newId] = duplicate;
        }
      });
      return next;
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
  useEffect(() => {
    const loadFromSupabase = async () => {
      try {
        console.log('[SUPABASE] Loading initial data...');
        
        // Cargar bloques
        const { data: blocksData, error: blocksError } = await supabase
          .from('work_blocks')
          .select('*')
          .order('order', { ascending: true });

        if (blocksError) throw blocksError;

        // Cargar tareas (excluyendo eliminadas y sin templateId para evitar instancias duplicadas)
        const { data: tasksData, error: tasksError } = await supabase
          .from('tasks')
          .select('*')
          .or('is_deleted.is.null,is_deleted.eq.false')
          .is('template_id', null) // Solo cargar templates y tareas manuales, no instancias
          .order('order', { ascending: true });

        if (tasksError) throw tasksError;
        
        // Cargar personas
        const { data: personsData, error: personsError } = await supabase
          .from('persons')
          .select('*')
          .order('created_at', { ascending: true });

        if (personsError) {
          console.warn('[SUPABASE] Error loading persons:', personsError);
        }

        console.log('[SUPABASE] Loaded:', { 
          blocks: blocksData?.length, 
          tasks: tasksData?.length,
          persons: personsData?.length 
        });

        // Mapear bloques
        if (blocksData && blocksData.length > 0) {
          const mappedBlocks = blocksData.map((b: any) => ({
            id: b.id,
            name: b.name,
            color: b.color,
            icon: b.icon,
            order: b.order || 0,
            isActive: b.is_active !== false // Default true
          }));
          setBlocks(mappedBlocks);
        } else {
          setBlocks(INITIAL_BLOCKS); // Fallback
        }
        
        // Mapear personas
        if (personsData && personsData.length > 0) {
          const mappedPersons = personsData.map((p: any) => ({
            id: p.id,
            name: p.name,
            createdAt: p.created_at
          }));
          setPeople(mappedPersons);
          console.log('[SUPABASE] Loaded persons:', mappedPersons.map(p => p.name).join(', '));
        }

        // Mapear tareas
        if (tasksData && tasksData.length > 0) {
          const mappedTasks: Record<string, Task> = {};
          tasksData.forEach((t: any) => {
            mappedTasks[t.id] = {
              id: t.id,
              blockId: t.block_id,
              title: t.title,
              notes: t.notes,
              priority: t.priority,
              status: t.status,
              dueDate: t.due_date,
              dueTime: t.due_time,
              completedAt: t.completed_at,
              estimatedMinutes: t.estimated_minutes,
              actualMinutes: t.actual_minutes,
              totalEstimatedCombo: t.total_estimated_combo,
              totalRegisteredCombo: t.total_registered_combo,
              tags: t.tags || [],
              order: t.order,
              isTemplate: t.is_template,
              isActive: t.is_active !== false, // Default true
              isException: t.is_exception,
              isDeleted: t.is_deleted,
              isExpanded: t.is_expanded,
              taskType: t.task_type,
              parentTaskId: t.parent_task_id,
              templateId: t.template_id,
              instanceDate: t.instance_date,
              recurrence: t.recurrence,
              delegation: t.delegation,
              createdAt: t.created_at,
              modifiedAt: t.modified_at,
              deletedAt: t.deleted_at,
              subtasks: [], // Inicializar subtasks como array vacío
              attachments: [] // Inicializar attachments como array vacío
            };
          });

          // Reconstruir relaciones padre-hijo
          Object.values(mappedTasks).forEach(task => {
            if (task.parentTaskId && mappedTasks[task.parentTaskId]) {
              if (!mappedTasks[task.parentTaskId].subtasks) {
                mappedTasks[task.parentTaskId].subtasks = [];
              }
              mappedTasks[task.parentTaskId].subtasks.push(task.id);
            }
          });
          
          setTasks(mappedTasks);
        }

        setIsDataLoaded(true);
        console.log('[SUPABASE] Data loaded successfully');
      } catch (e) {
        console.error("[SUPABASE] Error loading data:", e);
        // Fallback a datos iniciales si falla
        setBlocks(INITIAL_BLOCKS);
        setIsDataLoaded(true);
      }
    };

    loadFromSupabase();
  }, []);
 
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
    setTasks(prev => ({
      ...prev,
      [taskId]: {
        ...prev[taskId],
        isExpanded: prev[taskId].isExpanded !== undefined ? !prev[taskId].isExpanded : true // Fix logic: if was undefined (default collapsed), now becomes expanded (true)
      }
    }));
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
 
  // Generation Trigger - genera instancias SOLO al cargar
  // Clave que cambia solo cuando se añaden/modifican templates recurrentes
  // Evita bucle infinito al no depender de 'tasks' directamente
  // templateKey: solo cambia cuando se añaden/modifican templates reales.
  // Usamos useRef para evitar que las instancias generadas relancen el effect.
  const prevTemplateKeyRef = useRef<string>('');
  const templateKey = useMemo(() => {
    return Object.values(tasks)
      .filter(t => t && t.isTemplate && !t.templateId)
      .map(t => `${t.id}:${t.modifiedAt}`)
      .sort()
      .join('|');
  }, [tasks]);

  useEffect(() => {
    if (!isDataLoaded) return;
    // Solo regenerar si los templates han cambiado realmente (no por instancias añadidas)
    if (templateKey === prevTemplateKeyRef.current && prevTemplateKeyRef.current !== '') return;
    prevTemplateKeyRef.current = templateKey;
    console.log('[GENERATION] useEffect triggered');
    const start = formatLocalISO(new Date());
    setTasks(prev => {
      const instantiated = generateInstances(prev, start, 365);
      console.log(`[GENERATION] Generated ${instantiated.length} instances`);
      if (instantiated.length === 0) return prev;
      let changed = false;
      const updated = { ...prev };
      instantiated.forEach(t => {
        if (!updated[t.id]) {
          updated[t.id] = t;
          changed = true;
        }
      });
      console.log(`[GENERATION] Added ${Object.keys(updated).length - Object.keys(prev).length} new instances to state`);
      return changed ? updated : prev;
    });
  }, [isDataLoaded, templateKey]);
 
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
 
    if (task?.templateId && currentView !== 'dashboard') {
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
 
    if (task?.templateId && currentView !== 'dashboard') {
      setRecurrenceAction({ taskId, type: 'delete', ruleId: task.templateId });
    } else if (task?.templateId && currentView === 'dashboard') {
      // Si es recurrente y estamos en dashboard, simplemente marcamos ESTA instancia como eliminada
      setTasks(prev => ({
        ...prev,
        [taskId]: { ...(prev[taskId] || task!), isDeleted: true, modifiedAt: new Date().toISOString() }
      }));
    } else {
      handleDeleteTask(taskId);
    }
  };
 
  const handleToggleStatus = (taskId: string) => {
    const updatedTasks = { ...tasks };
    let task = updatedTasks[taskId];
 
    if (!task) {
      // Find in generated dashboard tasks
      task = dashboardTasks.find(t => t.id === taskId);
    }
 
    if (!task) return;
 
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    const timestamp = new Date().toISOString();
    
    const toggleRecursive = (targetTask: Task, status: 'pending' | 'completed') => {
      updatedTasks[targetTask.id] = { 
        ...targetTask, 
        status, 
        modifiedAt: timestamp,
        completedAt: status === 'completed' ? timestamp : undefined 
      };
      
      targetTask.subtasks.forEach(sid => {
        const subtask = updatedTasks[sid] || dashboardTasks.find(dt => dt.id === sid);
        if (subtask) {
          toggleRecursive(subtask, status);
        }
      });
    };
 
    toggleRecursive(task, newStatus);
    setTasks(updatedTasks);
  };
 
  const handleAddTask = (parentTaskId: string | null = null, blockId?: string, overrideDate?: string, defaultPersonId?: string) => {
    // Si el padre tiene fecha o etiqueta y no tiene subtareas aún → mostrar aviso de conversión a contenedor
    if (parentTaskId && tasks[parentTaskId]) {
      const parent = tasks[parentTaskId];
      const hasDate = !!parent.dueDate;
      const hasTag = parent.tags && parent.tags.length > 0;
      if ((hasDate || hasTag) && (!parent.subtasks || parent.subtasks.length === 0)) {
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
          parent_task_id: newTask.parentTaskId || null,
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
      
      return updated;
    });
    setEditingTaskId(null);
    setInlineEditingTaskId(null);

    // --- Sync to Supabase ---
    (async () => {
      try {
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
          is_template: updatedTask.isTemplate || false,
          is_active: updatedTask.isActive !== false,
          is_exception: updatedTask.isException || false,
          is_deleted: updatedTask.isDeleted || false,
          is_expanded: updatedTask.isExpanded,
          task_type: updatedTask.taskType,
          parent_task_id: updatedTask.parentTaskId || null,
          template_id: updatedTask.templateId || null,
          instance_date: updatedTask.instanceDate || null,
          recurrence: updatedTask.recurrence || null,
          delegation: updatedTask.delegation || null,
          created_at: updatedTask.createdAt,
          modified_at: new Date().toISOString()
        };

        const { error } = await supabase.from('tasks').upsert([dbTask]);
        if (error) throw error;
        console.log('[SUPABASE] Task updated:', updatedTask.id);
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
 
    removeRecursive(taskId);
    setTasks(updatedTasks);

    // --- Soft delete in Supabase ---
    (async () => {
      try {
        const { error } = await supabase
          .from('tasks')
          .update({ is_deleted: true, deleted_at: new Date().toISOString() })
          .eq('id', taskId);
        
        if (error) throw error;
        console.log('[SUPABASE] Task deleted (soft):', taskId);
      } catch (e) {
        console.error('[SUPABASE] Error deleting task:', e);
      }
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
    const result = filteredTasks.filter(t => {
      if (!t) return false;

      // Bloque inactivo
      if (!activeBlockIds.has(t.blockId)) return false;

      // Nunca mostrar templates originales (isTemplate=true son las plantillas, no instancias)
      if (t.isTemplate) return false;

      // Subtareas: nunca aparecen solas en el Dashboard (se muestran bajo su padre)
      if (t.parentTaskId) return false;

      // Tareas delegadas sin etiqueta real o con solo 'resto': no mostrar en Dashboard
      if (t.delegation) {
        const tags = t.tags || [];
        const hasRealTag = tags.some((tag: string) => tag !== 'resto');
        if (!hasRealTag) return false;
      }

      // ── Instancias generadas en memoria (templateId presente) ──
      // Son las instancias de tareas recurrentes generadas por generateInstances.
      // Solo mostrar si su dueDate coincide con el día activo.
      if (t.templateId) {
        return t.dueDate === activeDate;
      }

      // ── Excepciones guardadas ──
      // Instancias modificadas por el usuario y guardadas en Supabase.
      if (t.isException) {
        return t.dueDate === activeDate;
      }

      // ── Contenedor padre sin dueDate propio ──
      // El padre aparece si alguna subtarea (instancia o excepción) tiene dueDate = hoy.
      if (!t.dueDate && t.subtasks && t.subtasks.length > 0) {
        return t.subtasks.some(subId => {
          const sub = tasks[subId];
          return sub && sub.dueDate === activeDate;
        });
      }

      // ── Tareas manuales normales (sin recurrencia, sin templateId) ──
      if (t.dueDate !== activeDate) return false;

      return true;
    });
    return result;
  }, [filteredTasks, blocks, activeDate, tasks]);
 
  const dashboardTasksMap = useMemo(() => {
    const map: any = { ...tasks };
    
    // Añadir tareas raíz
    dashboardTasks.forEach(t => {
      map[t.id] = t;
      
      // Añadir subtareas del día activo
      if (t.subtasks && t.subtasks.length > 0) {
        t.subtasks.forEach(subId => {
          const sub = tasks[subId];
          if (sub && sub.dueDate === activeDate) {
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
                tasks={allActiveTasks}
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
                {tasks[addSubtaskWarning.parentTaskId]?.tags?.length > 0 && (
                  <li>• Su <span className="text-rosa font-bold">etiqueta</span> se eliminará</li>
                )}
                <li>• La fecha y etiqueta las asignarán sus subtareas</li>
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
                      tags: [],
                      estimatedMinutes: 0,
                      isExpanded: true,
                      subtasks: [...(prev[parentTaskId]?.subtasks || []), id],
                      modifiedAt: timestamp
                    },
                    [id]: newTask
                  }));
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
                  const updated = { ...task, dueDate: newDate, isException: true, modifiedAt: new Date().toISOString() };
                  setTasks(prev => ({ ...prev, [task.id]: updated }));
                  // Guardar excepción en Supabase
                  fetch(task.isException ? `/api/tasks/${task.id}` : '/api/tasks', {
                    method: task.isException ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id: task.id, blockId: task.blockId, title: task.title,
                      priority: task.priority, status: task.status,
                      dueDate: newDate, notes: task.notes || '',
                      estimatedMinutes: task.estimatedMinutes || 0,
                      parentTaskId: task.parentTaskId || null,
                      isTemplate: false, isException: true,
                      templateId: task.templateId || null,
                      instanceDate: task.instanceDate || null,
                      tags: task.tags || [], delegation: task.delegation || null,
                    })
                  }).catch(e => console.error('[API] Error guardando excepción fecha:', e));
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
                  if (templateId) {
                    setTasks(prev => {
                      const template = prev[templateId];
                      if (!template) return prev;
                      const updatedTemplate = {
                        ...template,
                        recurrence: template.recurrence ? { ...template.recurrence, startDate: newDate } : template.recurrence,
                        modifiedAt: new Date().toISOString()
                      };
                      return { ...prev, [templateId]: updatedTemplate };
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
 
            if (choice === 'instance') {
              if (type === 'edit') {
                setTasks(prev => ({
                  ...prev,
                  [taskId]: { ...prev[taskId], isException: true }
                }));
                setEditingTaskId(taskId);
              } else {
                setTasks(prev => ({
                  ...prev,
                  [taskId]: { ...prev[taskId], isDeleted: true }
                }));
              }
            } else if (choice === 'series') {
              if (type === 'edit') {
                setEditingRuleId(ruleId);
              } else {
                setTasks(prev => ({
                  ...prev,
                  [ruleId]: { ...prev[ruleId], isActive: false, modifiedAt: new Date().toISOString() }
                }));
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
    onSave({ ...allTasksMap[sid], ...updates });
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
            {localTask.templateId && (
              <div className="flex items-center gap-3 p-3 dark:bg-turquesa/10 bg-turquesa/5 border border-turquesa/20 rounded-xl">
                <RefreshCw size={14} className="text-turquesa shrink-0" />
                <p className="text-xs dark:text-text-secondary text-text-secondary-light">
                  Esta tarea es una <span className="text-turquesa font-bold">instancia de una serie recurrente</span>. Los cambios solo afectan a este día concreto.
                </p>
              </div>
            )}
 
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
                      {/* DatePickerChip */}
                      {!st.isTemplate && (
                        <DatePickerChip
                          value={st.dueDate}
                          onChange={(date: string) => handleUpdateSubtask(st.id, { dueDate: date })}
                        />
                      )}
                      {/* RecurrencePickerChip - subtareas pueden ser recurrentes */}
                      {!st.subtasks || st.subtasks.length === 0 ? (
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
            onClick={() => { onSave(localTask); onClose(); }}
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
function BulkActionBar({ 
  count, 
  onDelegate, 
  onChangeDate, 
  onComplete, 
  onChangeTime, 
  onDuplicate, 
  onDelete, 
  onCancel,
  isMobile = false 
}: any) {
  return (
    <div className={`${isMobile ? 'fixed bottom-0 left-0 right-0' : 'sticky top-0'} z-50 dark:bg-bg-card bg-white border-t dark:border-border-main border-border-main-light shadow-2xl`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="w-6 h-6 rounded-full bg-azul/20 border-2 border-azul flex items-center justify-center">
            <Check size={12} className="text-azul" />
          </div>
          <span className="text-sm font-black dark:text-white text-text-main-light">
            {count} seleccionada{count !== 1 ? 's' : ''}
          </span>
        </div>
        
        <div className="flex items-center gap-1.5">
          <button 
            onClick={onDelegate}
            className="px-3 py-2 rounded-xl bg-morado/10 border border-morado/30 text-morado hover:bg-morado/20 transition-all flex items-center gap-1.5 text-xs font-bold"
            title="Delegar"
          >
            <Users size={14} />
            {!isMobile && <span>Delegar</span>}
          </button>
          
          <button 
            onClick={onChangeDate}
            className="px-3 py-2 rounded-xl bg-turquesa/10 border border-turquesa/30 text-turquesa hover:bg-turquesa/20 transition-all flex items-center gap-1.5 text-xs font-bold"
            title="Cambiar fecha"
          >
            <CalendarIcon size={14} />
            {!isMobile && <span>Fecha</span>}
          </button>
          
          <button 
            onClick={onComplete}
            className="px-3 py-2 rounded-xl bg-azul/10 border border-azul/30 text-azul hover:bg-azul/20 transition-all flex items-center gap-1.5 text-xs font-bold"
            title="Completar"
          >
            <CheckCircle2 size={14} />
            {!isMobile && <span>Completar</span>}
          </button>
          
          <button 
            onClick={onChangeTime}
            className="px-3 py-2 rounded-xl bg-azul/10 border border-azul/30 text-azul hover:bg-azul/20 transition-all flex items-center gap-1.5 text-xs font-bold"
            title="Cambiar tiempo"
          >
            <Clock size={14} />
            {!isMobile && <span>Tiempo</span>}
          </button>
          
          <button 
            onClick={onDuplicate}
            className="px-3 py-2 rounded-xl dark:bg-bg-main bg-gray-100 border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:dark:bg-white/5 hover:bg-gray-200 transition-all flex items-center gap-1.5 text-xs font-bold"
            title="Duplicar"
          >
            <Copy size={14} />
            {!isMobile && <span>Duplicar</span>}
          </button>
          
          <button 
            onClick={onDelete}
            className="px-3 py-2 rounded-xl bg-rosa/10 border border-rosa/30 text-rosa hover:bg-rosa/20 transition-all flex items-center gap-1.5 text-xs font-bold"
            title="Eliminar"
          >
            <Trash2 size={14} />
            {!isMobile && <span>Eliminar</span>}
          </button>
          
          <button 
            onClick={onCancel}
            className="px-3 py-2 rounded-xl dark:bg-bg-main bg-gray-100 border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:dark:bg-white/5 hover:bg-gray-200 transition-all flex items-center gap-1.5 text-xs font-bold"
            title="Cancelar"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardView({ 
  tasks, 
  allTasksMap, 
  blocks,
  people = [],
  onAddPerson,
  onRenamePerson,
  onDeletePerson,
  timeEntries, 
  activeTimer, 
  onStartTimer, 
  onStopTimer, 
  onToggle, 
  onDelete, 
  onAddTask, 
  onUpdateTask, 
  onEditTask,
  editingTaskId,
  inlineEditingTaskId,
  setInlineEditingTaskId,
  onOpenTimePanel,
  activeDate, 
  onSetDate,
  onDayChange, 
  onReorderTasks,
  onReorderSubtasks,
  onToggleExpand,
  onPromote,
  onDemote,
  onRecurrenceDateChange = null,
  // Selection props
  selectionMode = false,
  selectedTaskIds = new Set(),
  onToggleTaskSelection = null,
  onToggleSelectionMode = null,
  // Bulk action props
  bulkUpdateTasks = null,
  bulkDeleteTasks = null,
  bulkDuplicateTasks = null,
  bulkDelegateModal = false,
  setBulkDelegateModal = null,
  bulkDateModal = false,
  setBulkDateModal = null,
  bulkTimeModal = false,
  setBulkTimeModal = null
}: any) {
  const [hideCompleted, setHideCompleted] = useState(true);
  const [showDashboardCalendar, setShowDashboardCalendar] = useState(false);
  const [expandAll, setExpandAll] = useState(true);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set(['con_hora', 'focus', 'dirección', 'espera', 'resto']));
  const [isFrozen, setIsFrozen] = useState(false);
  const frozenOrderRef = React.useRef<string[]>([]);
  // Estado local para reordenar con flechitas
  const [localTagOrders, setLocalTagOrders] = useState<Record<string, string[]>>({});
 
  const dayTasks = useMemo(() => {
    const activeBlockIds = new Set(blocks.filter((b: any) => b.isActive).map((b: any) => b.id));
    return tasks.filter((t: Task) => {
      if (!activeBlockIds.has(t.blockId)) return false;
      if (t.parentTaskId) return false;
      if (t.dueDate === activeDate) return true;
      if (!t.dueDate && t.subtasks && t.subtasks.length > 0) {
        return t.subtasks.some(subId => {
          const sub = allTasksMap[subId];
          return sub && sub.dueDate === activeDate;
        });
      }
      return false;
    }).sort((a: Task, b: Task) => (a.order || 0) - (b.order || 0));
  }, [tasks, activeDate, blocks, allTasksMap]);
 
  const filteredDayTasks = useMemo(() => {
    return dayTasks.filter((t: Task) => !hideCompleted || !isTaskCompleted(t.id, allTasksMap));
  }, [dayTasks, hideCompleted, allTasksMap]);
 
  const stats = useMemo(() => {
    const activeBlockIds = new Set(blocks.filter((b: any) => b.isActive).map((b: any) => b.id));
    
    // Recoger todas las tareas hoja del día:
    // 1) Tareas raíz sin subtareas con dueDate === activeDate
    // 2) Subtareas de contenedores con dueDate === activeDate
    const leafTasks: any[] = [];

    dayTasks.forEach((t: any) => {
      if (!activeBlockIds.has(t.blockId)) return;
      if (!t.subtasks || t.subtasks.length === 0) {
        // Tarea hoja raíz
        leafTasks.push(t);
      } else {
        // Contenedor — contar sus subtareas del día
        (t.subtasks || []).forEach((subId: string) => {
          const sub = allTasksMap[subId];
          if (sub && !sub.isDeleted && sub.dueDate === activeDate) {
            leafTasks.push(sub);
          }
        });
      }
    });

    const total = leafTasks.length;
    const completedTasks = leafTasks.filter((t: any) => isTaskCompleted(t.id, allTasksMap));
    const pendingTasks = leafTasks.filter((t: any) => !isTaskCompleted(t.id, allTasksMap));
    const completed = completedTasks.length;
    const pending = pendingTasks.length;

    // Tiempo estimado
    const estimatedTotal = leafTasks.reduce((acc: number, t: any) => acc + getTaskEstimatedCombo(t.id, allTasksMap), 0);
    const estimatedCompleted = completedTasks.reduce((acc: number, t: any) => acc + getTaskEstimatedCombo(t.id, allTasksMap), 0);
    const estimatedPending = pendingTasks.reduce((acc: number, t: any) => acc + getTaskEstimatedCombo(t.id, allTasksMap), 0);

    // Tiempo registrado del día
    const registered = timeEntries
      .filter((e: any) => e && e.date === activeDate)
      .reduce((acc: number, e: any) => acc + (e.duration || 0), 0);

    return { 
      total, 
      completed, 
      pending,
      estimatedPending, 
      estimatedCompleted, 
      estimatedTotal,
      registered 
    };
  }, [dayTasks, allTasksMap, blocks, timeEntries, activeDate]);
 
  // groupedTasks: cada entrada es { task, subtasksForGroup }
  // Los contenedores (sin etiqueta) se reparten por grupos según sus subtareas
  // Cuando está congelado, usamos el orden guardado para renderizar
  // pero los datos de las tareas se actualizan normalmente
  const groupedTasks = useMemo(() => {
    const tagOrder: TagType[] = ['con_hora', 'focus', 'dirección', 'espera', 'resto'];
    const groups: Record<TagType, { task: Task, subtasksForGroup: string[] | null }[]> = {
      con_hora: [], focus: [], dirección: [], espera: [], resto: []
    };

    filteredDayTasks.forEach((t: Task) => {
      // Contenedor: sin etiqueta propia Y con subtareas
      // Las instancias padre (templateId + subtareas) heredan tags del template pero deben tratarse como contenedores
      const isContainer = t.subtasks && t.subtasks.length > 0 && (
        !t.tags || t.tags.length === 0 || (t.templateId && t.subtasks.length > 0)
      );

      if (isContainer) {
        // Repartir el contenedor en cada grupo donde tenga subtareas con esa etiqueta
        const subtasksByTag: Record<string, string[]> = {};
        (t.subtasks || []).forEach(subId => {
          const sub = allTasksMap[subId];
          if (!sub) return;
          if (hideCompleted && sub.status === 'completed') return;
          if (sub.dueDate !== activeDate) return;
          const subTag = (sub.tags && sub.tags[0]) || 'resto';
          if (!subtasksByTag[subTag]) subtasksByTag[subTag] = [];
          subtasksByTag[subTag].push(subId);
        });

        Object.entries(subtasksByTag).forEach(([tag, subIds]) => {
          if (groups[tag as TagType]) {
            groups[tag as TagType].push({ task: t, subtasksForGroup: subIds });
          } else {
            groups.resto.push({ task: t, subtasksForGroup: subIds });
          }
        });
      } else {
        // Tarea normal: va a su grupo por etiqueta
        const primaryTag = (t.tags && t.tags[0]) || 'resto';
        const group = groups[primaryTag as TagType] || groups.resto;
        group.push({ task: t, subtasksForGroup: null });
      }
    });

    // Ordenar dentro de cada grupo
    tagOrder.forEach(tag => {
      groups[tag].sort((a, b) => (a.task.order || 0) - (b.task.order || 0));
    });
    groups.con_hora.sort((a, b) => (a.task.dueTime || '99:99').localeCompare(b.task.dueTime || '99:99'));

    // Si está congelado y tenemos un orden guardado, aplicar ese orden
    if (isFrozen && frozenOrderRef.current.length > 0) {
      const orderMap = new Map(frozenOrderRef.current.map((id, i) => [id, i]));
      tagOrder.forEach(tag => {
        groups[tag].sort((a, b) => {
          const ia = orderMap.has(a.task.id) ? orderMap.get(a.task.id)! : 999;
          const ib = orderMap.has(b.task.id) ? orderMap.get(b.task.id)! : 999;
          return ia - ib;
        });
      });
    } else {
      // Guardar orden actual
      const allIds = tagOrder.flatMap(tag => groups[tag].map(e => e.task.id));
      frozenOrderRef.current = allIds;
    }

    return groups;
  }, [filteredDayTasks, hideCompleted, allTasksMap, activeDate, isFrozen]);
 
  const formatDate = (dateStr: string) => {
    const d = parseLocalISO(dateStr);
    const dayName = new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(d);
    const dayNum = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(d);
    return { dayName, dayNum };
  };
 
  const { dayName, dayNum } = formatDate(activeDate);
 
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      exit={{ opacity: 0, y: -20 }}
      className="space-y-10"
    >
      {/* Bulk Action Bar - adaptativo mobile/desktop */}
      {selectionMode && selectedTaskIds.size > 0 && bulkUpdateTasks && (
        <BulkActionBar 
          count={selectedTaskIds.size}
          onDelegate={() => setBulkDelegateModal && setBulkDelegateModal(true)}
          onChangeDate={() => setBulkDateModal && setBulkDateModal(true)}
          onComplete={() => {
            if (bulkUpdateTasks) {
              bulkUpdateTasks({ status: 'completed', completedAt: new Date().toISOString() });
            }
          }}
          onChangeTime={() => setBulkTimeModal && setBulkTimeModal(true)}
          onDuplicate={() => bulkDuplicateTasks && bulkDuplicateTasks()}
          onDelete={() => {
            if (confirm(`¿Eliminar ${selectedTaskIds.size} tarea${selectedTaskIds.size > 1 ? 's' : ''}?`)) {
              bulkDeleteTasks && bulkDeleteTasks();
            }
          }}
          onCancel={onToggleSelectionMode}
          isMobile={window.innerWidth < 768}
        />
      )}

      {/* Date Header */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between dark:bg-bg-card bg-bg-card-light p-4 rounded-[2rem] border dark:border-border-main border-border-main-light shadow-xl">
          <div className="flex gap-2">
            <button onClick={() => onDayChange(-1)} className="p-3 dark:hover:bg-bg-main hover:bg-bg-secondary-light rounded-2xl transition-all dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light">
              <ChevronRight size={20} className="rotate-180" />
            </button>
            <button 
              onClick={() => {
                const today = formatLocalISO(new Date());
                onSetDate(today);
              }}
              className="px-6 py-2 bg-turquesa/10 text-turquesa rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-turquesa hover:text-white transition-all"
            >
              HOY
            </button>
            <button onClick={() => onDayChange(1)} className="p-3 dark:hover:bg-bg-main hover:bg-bg-secondary-light rounded-2xl transition-all dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light">
              <ChevronRight size={20} />
            </button>
          </div>
          
          <div className="text-center">
             <div className="flex items-center justify-center gap-2 mb-0.5">
               <CalendarIcon size={16} className="text-turquesa" />
               <div className="relative">
                 <button 
                   onClick={() => setShowDashboardCalendar(!showDashboardCalendar)}
                   className="text-xl font-black capitalize dark:text-white text-text-main-light flex items-center gap-2 hover:text-turquesa transition-all"
                 >
                   {dayName}, {dayNum}
                   <ChevronDown size={14} className={`transition-transform duration-300 ${showDashboardCalendar ? 'rotate-180' : ''}`} />
                 </button>
                 
                 <AnimatePresence>
                   {showDashboardCalendar && (
                     <>
                       <div className="fixed inset-0 z-[150]" onClick={() => setShowDashboardCalendar(false)} />
                       <motion.div 
                         initial={{ opacity: 0, y: 10, scale: 0.95 }}
                         animate={{ opacity: 1, y: 0, scale: 1 }}
                         exit={{ opacity: 0, y: 10, scale: 0.95 }}
                         className="absolute top-full left-1/2 -translate-x-1/2 mt-4 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] p-7 z-[160] min-w-[340px] backdrop-blur-2xl"
                       >
                          <div className="flex items-center justify-between mb-6 px-1">
                             <div className="flex flex-col">
                               <p className="text-[10px] font-black text-turquesa uppercase tracking-[0.2em]">Agenda</p>
                               <p className="text-[14px] font-black dark:text-white text-text-main-light">Ir a fecha</p>
                             </div>
                             <button onClick={() => setShowDashboardCalendar(false)} className="w-9 h-9 flex items-center justify-center dark:bg-bg-main bg-white hover:bg-turquesa/10 rounded-xl transition-all border dark:border-border-main border-border-main-light group">
                               <X size={16} className="dark:text-text-secondary text-text-secondary-light group-hover:text-turquesa transition-colors" />
                             </button>
                          </div>
                          
                          <DashboardHarmonicCalendar 
                            activeDate={activeDate} 
                            onSetDate={onSetDate}
                            onClose={() => setShowDashboardCalendar(false)}
                          />
                          
                          <div className="mt-6 pt-6 border-t border-border-main/50 grid grid-cols-2 gap-3">
                               <button 
                                 onClick={() => {
                                   const today = formatLocalISO(new Date());
                                   onSetDate(today);
                                   setShowDashboardCalendar(false);
                                 }}
                                 className="flex items-center gap-3 p-3.5 bg-bg-main border border-border-main rounded-2xl hover:border-turquesa transition-all group"
                               >
                                 <div className="w-8 h-8 rounded-xl bg-turquesa/10 flex items-center justify-center text-turquesa group-hover:bg-turquesa group-hover:text-white transition-all">
                                   <Zap size={14} fill="currentColor" />
                                 </div>
                                 <span className="text-[10px] font-black text-white uppercase tracking-widest">Hoy</span>
                               </button>
                               
                               <button 
                                 onClick={() => {
                                   const tomorrow = new Date();
                                   tomorrow.setDate(tomorrow.getDate() + 1);
                                   const tomStr = formatLocalISO(tomorrow);
                                   onSetDate(tomStr);
                                   setShowDashboardCalendar(false);
                                 }}
                                 className="flex items-center gap-3 p-3.5 bg-bg-main border border-border-main rounded-2xl hover:border-azul transition-all group"
                               >
                                 <div className="w-8 h-8 rounded-xl bg-azul/10 flex items-center justify-center text-azul group-hover:bg-azul group-hover:text-white transition-all">
                                   <ArrowRight size={14} />
                                 </div>
                                 <span className="text-[10px] font-black text-white uppercase tracking-widest">Mañana</span>
                               </button>
                          </div>
                       </motion.div>
                     </>
                   )}
                 </AnimatePresence>
               </div>
             </div>
             <p className="text-[9px] font-bold text-text-secondary uppercase tracking-[0.2em]">{stats.completed} de {stats.total} completadas</p>
          </div>
 
          <div className="flex items-center gap-2">
             {/* Botón: Seleccionar (modo selección múltiple) */}
             <button 
               onClick={() => onToggleSelectionMode && onToggleSelectionMode()}
               className={`flex items-center gap-1.5 px-3 h-10 rounded-2xl border-2 transition-all text-[10px] font-black uppercase tracking-widest ${
                 selectionMode 
                   ? 'bg-azul text-white border-azul shadow-lg shadow-azul/30' 
                   : 'bg-azul/10 border-azul text-azul hover:bg-azul hover:text-white'
               }`}
               title={selectionMode ? 'Salir de selección' : 'Seleccionar múltiple'}
             >
               <CheckCircle2 size={14} />
               <span className="hidden sm:inline">{selectionMode ? 'Cancelar' : 'Seleccionar'}</span>
             </button>

             {/* Botón: Expandir/Contraer SUBTAREAS — flechas azul */}
             <button 
              onClick={() => setExpandAll(!expandAll)}
              className={`w-10 h-10 flex items-center justify-center rounded-full border-2 transition-all relative group ${
                expandAll 
                  ? 'bg-azul text-white border-azul shadow-lg shadow-azul/30' 
                  : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul dark:hover:bg-azul/10 hover:bg-azul/5'
              }`}
              title={expandAll ? 'Contraer subtareas' : 'Expandir subtareas'}
             >
               {expandAll ? <ChevronsUp size={15} /> : <ChevronsDown size={15} />}
               <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 px-2.5 py-1.5 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-xl text-[9px] font-bold dark:text-white text-text-main-light whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                 {expandAll ? 'Contraer subtareas' : 'Expandir subtareas'}
               </span>
             </button>

             {/* Botón: Expandir/Contraer GRUPOS ETIQUETAS — tag icon turquesa */}
             <button 
              onClick={() => {
                const allBlocks = new Set(['con_hora', 'focus', 'dirección', 'espera', 'resto']);
                setExpandedBlocks(expandedBlocks.size === 5 ? new Set() : allBlocks);
              }}
              className={`w-10 h-10 flex items-center justify-center rounded-full border-2 transition-all relative group ${
                expandedBlocks.size === 5 
                  ? 'bg-turquesa text-white border-turquesa shadow-lg shadow-turquesa/30' 
                  : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa hover:text-turquesa dark:hover:bg-turquesa/10 hover:bg-turquesa/5'
              }`}
              title={expandedBlocks.size === 5 ? 'Contraer grupos' : 'Expandir grupos'}
             >
               <Tag size={14} />
               <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 px-2.5 py-1.5 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-xl text-[9px] font-bold dark:text-white text-text-main-light whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                 {expandedBlocks.size === 5 ? 'Contraer grupos' : 'Expandir grupos'}
               </span>
             </button>

             {/* Botón: Ver/Ocultar completadas */}
             <button 
              onClick={() => setHideCompleted(!hideCompleted)}
              className={`w-10 h-10 flex items-center justify-center rounded-2xl border transition-all relative group ${
                hideCompleted 
                  ? 'bg-turquesa text-white border-turquesa' 
                  : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa hover:text-turquesa dark:hover:bg-turquesa/10 hover:bg-turquesa/5'
              }`}
              title={hideCompleted ? 'Ver completadas' : 'Ocultar completadas'}
             >
               {hideCompleted ? <Eye size={16} /> : <EyeOff size={16} />}
               <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 px-2.5 py-1.5 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-xl text-[9px] font-bold dark:text-white text-text-main-light whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                 {hideCompleted ? 'Ver completadas' : 'Ocultar completadas'}
               </span>
             </button>

             {/* Botón: Añadir tarea */}
             <button 
              onClick={() => onAddTask()}
              className="bg-azul hover:bg-azul/90 text-white w-10 h-10 flex items-center justify-center rounded-2xl shadow-lg shadow-azul/20 transition-all"
              title="Añadir tarea"
             >
               <Plus size={20} />
             </button>
          </div>
        </div>
      </div>
 
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard 
          label="Tareas" 
          value={stats.completed}
          total={stats.total}
          progress={(stats.completed / (stats.total || 1)) * 100}
          color="turquesa"
        />
        <SummaryCard 
          label="Pendiente" 
          value={formatMinutes(stats.estimatedPending)}
          color="azul"
        />
        <SummaryCard 
          label="Registrado" 
          value={formatMinutes(stats.registered)}
          color="morado"
        />
      </div>

      <div className="h-px dark:bg-border-main/50 bg-border-main-light/50" />
 
      {/* Task Groups */}
      <div className="space-y-3 pb-32">
        {(Object.entries(groupedTasks) as [TagType, { task: Task, subtasksForGroup: string[] | null }[]][]).map(([tag, tagEntries]) => {
          if (tagEntries.length === 0) return null;
          const isBlockExpanded = expandedBlocks.has(tag);
          const tagTasks = tagEntries.map(e => e.task);
          return (
            <div key={tag} className="space-y-2">
              <div className="flex items-center justify-between dark:border-border-main/50 border-border-main-light/50 border-b pb-2">
                <button 
                  onClick={() => {
                    const newExpanded = new Set(expandedBlocks);
                    if (isBlockExpanded) {
                      newExpanded.delete(tag);
                    } else {
                      newExpanded.add(tag);
                    }
                    setExpandedBlocks(newExpanded);
                  }}
                  className="flex items-center gap-3 hover:opacity-70 transition-opacity"
                >
                  <div className="w-8 h-8 rounded-xl dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light flex items-center justify-center">
                    {TAG_LABELS[tag].icon || <CheckCircle2 size={16} className="text-lima" />}
                  </div>
                  <h3 className="font-bold text-sm uppercase tracking-widest dark:text-text-main text-text-main-light">
                    {TAG_LABELS[tag].label}
                  </h3>
                  <motion.div
                    animate={{ rotate: isBlockExpanded ? 0 : -90 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown size={16} className="dark:text-text-secondary text-text-secondary-light" />
                  </motion.div>
                </button>
                <div className="flex items-center gap-1.5 text-[10px] font-black">
                  {(() => {
                    const groupTaskIds: string[] = [];
                    const pendingTaskIds: string[] = [];
                    tagEntries.forEach(({ task, subtasksForGroup: stfg }: any) => {
                      if (stfg && stfg.length > 0) {
                        stfg.forEach((sid: string) => {
                          groupTaskIds.push(sid);
                          const st = allTasksMap[sid];
                          if (st && st.status !== 'completed') pendingTaskIds.push(sid);
                        });
                      } else if (!task.subtasks || task.subtasks.length === 0) {
                        groupTaskIds.push(task.id);
                        if (task.status !== 'completed') pendingTaskIds.push(task.id);
                      }
                    });
                    const estimated = pendingTaskIds.reduce((acc: number, id: string) => acc + getTaskEstimatedCombo(id, allTasksMap), 0);
                    return <>
                      <span className="dark:bg-bg-card bg-bg-card-light px-2.5 py-1 rounded-lg border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light uppercase">{pendingTaskIds.length} Tareas</span>
                      <span className="text-azul dark:bg-bg-card bg-bg-card-light px-2 py-1 rounded-lg border dark:border-border-main border-border-main-light flex items-center gap-1"><Clock size={10} />{formatMinutes(estimated)}</span>
                    </>;
                  })()}
                </div>
              </div>

              <AnimatePresence>
                {isBlockExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] shadow-xl overflow-hidden divide-y dark:divide-border-main divide-border-main-light">
                      {(() => {
                        // Aplicar orden local si existe
                        const localOrder = localTagOrders[tag];
                        let orderedEntries = tagEntries;
                        if (localOrder) {
                          const idMap: Record<string, any> = {};
                          tagEntries.forEach((e: any) => { idMap[e.task.id] = e; });
                          orderedEntries = localOrder.map((id: string) => idMap[id]).filter(Boolean);
                          tagEntries.forEach((e: any) => { if (!localOrder.includes(e.task.id)) orderedEntries.push(e); });
                        }
                        return orderedEntries.map(({ task, subtasksForGroup }: any, idx: number) => (
                        <div key={`${task.id}-${tag}`}>
                        <TaskCard
                          task={task}
                          variant="DASHBOARD"
                          allTasksMap={allTasksMap}
                          people={people}
                          onAddPerson={onAddPerson}
                          onRenamePerson={onRenamePerson}
                          onDeletePerson={onDeletePerson}
                onRecurrenceDateChange={onRecurrenceDateChange}
                          blocks={blocks}
                          timeEntries={timeEntries}
                          activeTimer={activeTimer}
                          onStartTimer={onStartTimer}
                          onStopTimer={onStopTimer}
                          onToggleStatus={onToggle}
                          onUpdateTask={onUpdateTask}
                          onEditTask={onEditTask}
                          editingTaskId={editingTaskId}
                          inlineEditingTaskId={inlineEditingTaskId}
                          setInlineEditingTaskId={setInlineEditingTaskId}
                          onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel(taskId, subtaskId)}
                          onAddTask={onAddTask}
                          onDelete={onDelete}
                          onPromote={onPromote}
                          onDemote={onDemote}
                          onReorderSubtasks={onReorderSubtasks}
                          onToggleExpand={onToggleExpand}
                          hideCompleted={hideCompleted}
                          subtasksForGroup={subtasksForGroup}
                          forceExpanded={expandAll}
                          taskIndex={idx}
                          taskCount={orderedEntries.length}
                          onMoveUp={() => {
                            if (idx === 0) return;
                            const newOrder = orderedEntries.map((e: any) => e.task.id);
                            [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
                            setLocalTagOrders(prev => ({ ...prev, [tag]: newOrder }));
                            onUpdateTask({ ...task, order: idx - 1, modifiedAt: new Date().toISOString() });
                            onUpdateTask({ ...orderedEntries[idx - 1].task, order: idx, modifiedAt: new Date().toISOString() });
                          }}
                          onMoveDown={() => {
                            if (idx === orderedEntries.length - 1) return;
                            const newOrder = orderedEntries.map((e: any) => e.task.id);
                            [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
                            setLocalTagOrders(prev => ({ ...prev, [tag]: newOrder }));
                            onUpdateTask({ ...task, order: idx + 1, modifiedAt: new Date().toISOString() });
                            onUpdateTask({ ...orderedEntries[idx + 1].task, order: idx, modifiedAt: new Date().toISOString() });
                          }}
                          selectionMode={selectionMode}
                          selectedTaskIds={selectedTaskIds}
                          onToggleTaskSelection={onToggleTaskSelection}
                        />
                        </div>
                        ));
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
 
        {dayTasks.length === 0 && (
          <div className="py-32 flex flex-col items-center justify-center text-text-secondary border-2 border-dashed border-border-main rounded-[2.5rem] bg-bg-card/30">
            <div className="w-16 h-16 bg-bg-card rounded-3xl flex items-center justify-center mb-6 border border-border-main shadow-2xl">
              <Zap size={32} className="text-turquesa opacity-40" />
            </div>
            <p className="font-bold text-lg mb-1">Día totalmente despejado</p>
            <p className="text-sm opacity-50 mb-8">No tienes nada planificado para hoy</p>
            <button 
              onClick={() => onAddTask()}
              className="bg-turquesa hover:bg-turquesa/90 text-white px-8 py-3 rounded-2xl font-bold shadow-lg shadow-turquesa/20 transition-all flex items-center gap-3"
            >
              <Plus size={20} />
              + Tarea
            </button>
          </div>
        )}
 
        {dayTasks.length > 0 && (
           <button 
            onClick={() => onAddTask()}
            className="w-full py-5 border-2 border-dashed border-border-main rounded-[1.5rem] flex items-center justify-center gap-3 font-bold text-turquesa hover:bg-bg-card/50 transition-all"
           >
             <Plus size={20} />
             + Nueva tarea para hoy
           </button>
        )}
      </div>
    </motion.div>
  );
}
 
function SummaryCard({ label, value, total, progress, color }: any) {
  return (
    <div className="dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-[2rem] p-4 shadow-xl relative overflow-hidden group">
      <div className="relative z-10">
        <p className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em] mb-2">{label}</p>
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-2xl font-black dark:text-white text-text-main-light">
            {total !== undefined ? `${value}/${total}` : value}
          </h4>
          {progress !== undefined && (
            <span className={`text-xs font-black text-${color}`}>{Math.round(progress)}%</span>
          )}
        </div>
      </div>
      
      {progress !== undefined && (
        <div className="mt-3">
          <div className="h-1.5 dark:bg-bg-main/50 bg-bg-main-light/30 rounded-full overflow-hidden">
             <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className={`h-full bg-${color}`} 
             />
          </div>
        </div>
      )}
 
      {/* Decorative gradient */}
      <div className={`absolute -bottom-10 -right-10 w-24 h-24 bg-${color} opacity-5 blur-[60px] group-hover:opacity-10 transition-opacity`} />
    </div>
  );
}
 
 
 
 
 
// Botón toggle único expandir/contraer para la vista de bloque
function ToggleExpandButton({ blockId, onExpandAll }: { blockId: string, onExpandAll: (id: string, expand: boolean) => void }) {
  const [expanded, setExpanded] = React.useState(true);
  return (
    <button
      onClick={() => {
        const next = !expanded;
        setExpanded(next);
        onExpandAll(blockId, next);
      }}
      className={`w-9 h-9 flex items-center justify-center rounded-full border-2 transition-all relative group ${
        expanded
          ? 'bg-azul text-white border-azul shadow-lg shadow-azul/30'
          : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul'
      }`}
      title={expanded ? 'Contraer todo' : 'Expandir todo'}
    >
      {expanded ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
      <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-lg text-[9px] font-bold dark:text-white text-text-main-light whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
        {expanded ? 'Contraer' : 'Expandir'}
      </span>
    </button>
  );
}

function BlocksManagerView({ blocks, tasks, allTasksMap, people = [], onAddPerson, onRenamePerson = null, onDeletePerson = null, timeEntries, activeTimer, onStartTimer, onStopTimer, onAddTask, onAddRule, onToggleTask, onDelete, onUpdateTask, onEditTask, editingTaskId, inlineEditingTaskId, setInlineEditingTaskId, onOpenTimePanel, onEditRule, onToggleRule, onAddBlock, onEditBlock, onReorderBlocks, onToggleBlock, activeDate, onReorderSubtasks, onReorderTasks, onToggleExpand, onExpandAll, onPromote, onDemote, onRecurrenceDateChange = null, selectionMode = false, selectedTaskIds = new Set(), onToggleTaskSelection = null, onToggleSelectionMode = null, bulkUpdateTasks = null, bulkDeleteTasks = null, bulkDuplicateTasks = null, setBulkDelegateModal = null, setBulkDateModal = null, setBulkTimeModal = null }: any) {
  const [selectedBlock, setSelectedBlock] = useState<WorkBlock | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
 
  const coreTasks = useMemo(() => {
    if (!selectedBlock) return [];
    return Object.values(allTasksMap).filter((t: any) => {
      if (!t || t.blockId !== selectedBlock.id || t.parentTaskId || t.templateId) return false;
      const type = t.taskType || (isTaskRepetitive(t.id, allTasksMap) ? 'core' : 'adhoc');
      return type === 'core';
    }).sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  }, [selectedBlock, allTasksMap]);
 
  const adhocTasks = useMemo(() => {
    if (!selectedBlock) return [];
    return Object.values(allTasksMap).filter((t: any) => {
      if (!t || t.blockId !== selectedBlock.id || t.parentTaskId || t.templateId) return false;
      const type = t.taskType || (isTaskRepetitive(t.id, allTasksMap) ? 'core' : 'adhoc');
      return type === 'adhoc';
    }).sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  }, [selectedBlock, allTasksMap]);
 
  const filteredBlocks = useMemo(() => {
    if (filter === 'active') return blocks.filter(b => b.isActive);
    if (filter === 'inactive') return blocks.filter(b => !b.isActive);
    return blocks;
  }, [blocks, filter]);
 
  if (selectedBlock) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 pb-32">
        <div className="flex items-center justify-between dark:bg-bg-card bg-bg-card-light p-6 rounded-[2rem] border dark:border-border-main border-border-main-light shadow-xl">
          <div className="flex items-center gap-4">
            <button onClick={() => setSelectedBlock(null)} className="p-3 dark:hover:bg-bg-main hover:bg-gray-100 rounded-2xl transition-all">
              <ChevronRight size={20} className="rotate-180 dark:text-white text-text-main-light" />
            </button>
            <div className="w-12 h-12 rounded-2xl dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light flex items-center justify-center text-3xl shadow-inner">
               {selectedBlock.icon}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-black dark:text-white text-text-main-light">{selectedBlock.name}</h2>
                <button 
                  onClick={() => onEditBlock(selectedBlock.id)}
                  className="p-1.5 bg-turquesa/10 text-turquesa hover:bg-turquesa/20 rounded-lg transition-all"
                >
                  <Edit size={14} />
                </button>
              </div>
              <p className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em]">Gestión de contexto</p>
            </div>
          </div>
          <div className="flex gap-3">
              {/* Botón: Seleccionar (modo selección múltiple) */}
              {onToggleSelectionMode && (
                <button 
                  onClick={() => onToggleSelectionMode()}
                  className={`flex items-center gap-1.5 px-3 h-10 rounded-2xl border-2 transition-all text-[10px] font-black uppercase tracking-widest ${
                    selectionMode 
                      ? 'bg-azul text-white border-azul shadow-lg shadow-azul/30' 
                      : 'bg-azul/10 border-azul text-azul hover:bg-azul hover:text-white'
                  }`}
                  title={selectionMode ? 'Salir de selección' : 'Seleccionar múltiple'}
                >
                  <CheckCircle2 size={14} />
                  <span className="hidden sm:inline">{selectionMode ? 'Cancelar' : 'Seleccionar'}</span>
                </button>
              )}
              <ToggleExpandButton blockId={selectedBlock.id} onExpandAll={onExpandAll} />
             <button 
              onClick={() => onAddTask(null, selectedBlock.id)}
              className="px-6 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center gap-2 bg-white/5 dark:text-white text-text-main-light border border-white/10 hover:bg-white/15 hover:scale-[1.02] active:scale-95 shadow-xl backdrop-blur-md"
              style={{ borderColor: `${selectedBlock.color}44` }}
             >
               <Plus size={16} /> Tarea
             </button>
 
          </div>
        </div>
 
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
                    onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel(taskId, subtaskId)}
                    onAddTask={onAddTask}
                    onDelete={onDelete}
                    onPromote={onPromote}
                    onDemote={onDemote}
                    onReorderSubtasks={onReorderSubtasks}
                    onToggleExpand={onToggleExpand}
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
                  />
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
                    onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel(taskId, subtaskId)}
                    onAddTask={onAddTask}
                    onDelete={onDelete}
                    onPromote={onPromote}
                    onDemote={onDemote}
                    onReorderSubtasks={onReorderSubtasks}
                    onToggleExpand={onToggleExpand}
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
                  />
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
              dragListener={filter === 'all'} // Only drag when viewing all to keep order consistent
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
 
function CalendarView({ tasks, allTasksMap, blocks, people = [], onAddPerson, onRenamePerson = null, onDeletePerson = null, timeEntries, activeTimer, onStartTimer, onStopTimer, onUpdateTask, onEditTask, editingTaskId, inlineEditingTaskId, setInlineEditingTaskId, onOpenTimePanel, activeDate, onDateSelect, onAddTask, onToggleTask, onDelete, onReorderTasks, onReorderSubtasks, onToggleExpand, onPromote, onDemote, onRecurrenceDateChange = null }: any) {
  const [viewDate, setViewDate] = useState(() => parseLocalISO(activeDate));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
 
  const daysInMonth = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    
    // Adjust for Monday start (0=Sun, 1=Mon -> 1=Mon, 0=Sun)
    const padding = firstDay === 0 ? 6 : firstDay - 1;
    const array = [];
    for (let i = 0; i < padding; i++) array.push(null);
    for (let i = 1; i <= days; i++) {
       const d = new Date(year, month, i);
       array.push(formatLocalISO(d));
    }
    return array;
  }, [viewDate]);
 
  const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(viewDate);
 
  const activeBlockIds = useMemo(() => new Set(blocks.filter((b: any) => b.isActive).map((b: any) => b.id)), [blocks]);
 
  const getLoadColor = (dateStr: string) => {
    const load = projectLoadForDay(dateStr, allTasksMap);
    if (load === 0) return 'bg-bg-secondary opacity-20';
    if (load < 180) return 'bg-lima shadow-[0_0_10px_rgba(132,204,22,0.3)]';
    if (load < 300) return 'bg-naranja shadow-[0_0_10px_rgba(245,158,11,0.3)]';
    if (load < 420) return 'bg-morado shadow-[0_0_10px_rgba(139,92,246,0.3)]';
    return 'bg-rosa shadow-[0_0_10px_rgba(236,72,153,0.3)]';
  };

  // Helper para obtener color hex según minutos de carga
  const getLoadColorHex = (minutes: number) => {
    if (minutes === 0) return '#6B7280'; // gris
    if (minutes < 180) return '#10B981'; // esmeralda
    if (minutes < 300) return '#F59E0B'; // naranja
    if (minutes < 420) return '#A855F7'; // morado
    return '#EC4899'; // rosa
  };
 
  const dayTasks = useMemo(() => {
    if (!selectedDay) return [];
    const activeBlockIds = new Set(blocks.filter((b: any) => b.isActive).map((b: any) => b.id));
    const all = Object.values(allTasksMap).filter((t: any) => {
      if (!activeBlockIds.has(t.blockId)) return false;
      if (t.isTemplate) return false;
      if (t.isDeleted) return false;
      if (t.status === 'completed') return false; // Excluir completadas
      
      // Tareas delegadas sin etiqueta real o con solo 'resto': no mostrar (igual que Dashboard)
      if (t.delegation) {
        const tags = t.tags || [];
        const hasRealTag = tags.some((tag: string) => tag !== 'resto');
        if (!hasRealTag) return false;
      }
      
      // Subtareas: no aparecen solas (se muestran bajo su padre)
      if (t.parentTaskId) return false;
      
      // Instancias generadas (tienen templateId): mostrar si tienen la fecha correcta
      if (t.templateId) {
        return t.dueDate === selectedDay;
      }
      
      // Excepciones guardadas
      if (t.isException) {
        return t.dueDate === selectedDay;
      }
      
      // ── Contenedor padre sin dueDate propio ──
      // El padre aparece si alguna subtarea tiene dueDate = selectedDay
      if (!t.dueDate && t.subtasks && t.subtasks.length > 0) {
        return t.subtasks.some((subId: string) => {
          const sub = allTasksMap[subId];
          return sub && sub.dueDate === selectedDay;
        });
      }
      
      // Excluir templates originales con recurrencia (solo los que NO son instancias)
      if (t.recurrence) return false;
      
      // Excluir contenedores padre de tareas recurrentes
      if (t.subtasks && t.subtasks.length > 0) {
        const hasRecurringChild = t.subtasks.some((subId: string) => {
          const sub = allTasksMap[subId];
          return sub && (sub.recurrence || sub.isTemplate);
        });
        if (hasRecurringChild) return false;
      }
      
      // Tareas manuales normales: solo si tienen la fecha correcta
      if (t.dueDate !== selectedDay) return false;
      
      return true;
    });
    
    // Opción B: contenedores se expanden — agrupar subtareas del mismo contenedor
    const groups: any = {
      con_hora: [],
      focus: [],
      dirección: [],
      espera: [],
      resto: []
    };

    // Primero identificar contenedores y agrupar sus subtareas
    const containerGroups: any = {}; // { parentId: { parentTitle, tag, subtasks: [...] } }

    all.forEach((t: any) => {
      const hasSubtasksToday = t.subtasks && t.subtasks.length > 0 && t.subtasks.some((subId: string) => {
        const sub = allTasksMap[subId];
        if (!sub || sub.isDeleted || sub.status === 'completed' || sub.dueDate !== selectedDay) return false;
        // Filtro delegación: excluir delegadas sin etiqueta real
        if (sub.delegation) {
          const tags = sub.tags || [];
          const hasRealTag = tags.some((tag: string) => tag !== 'resto');
          if (!hasRealTag) return false;
        }
        return true;
      });

      if (hasSubtasksToday) {
        // Recolectar subtareas del día (excluir completadas y delegadas sin tag real)
        const subsToday = t.subtasks
          .map((subId: string) => allTasksMap[subId])
          .filter((sub: any) => {
            if (!sub || sub.isDeleted || sub.status === 'completed' || sub.dueDate !== selectedDay) return false;
            // Filtro delegación
            if (sub.delegation) {
              const tags = sub.tags || [];
              const hasRealTag = tags.some((tag: string) => tag !== 'resto');
              if (!hasRealTag) return false;
            }
            return true;
          });
        
        if (subsToday.length > 0) {
          // Determinar tag dominante (el del primer subtask)
          const primaryTag = (subsToday[0].tags && subsToday[0].tags[0]) || 'resto';
          
          if (!containerGroups[t.id]) {
            containerGroups[t.id] = {
              parentId: t.id,
              parentTitle: t.title,
              tag: primaryTag,
              subtasks: subsToday
            };
          }
        }
      } else {
        // Tarea huérfana normal
        const primaryTag = (t.tags && t.tags[0]) || 'resto';
        if (groups[primaryTag]) groups[primaryTag].push(t);
        else groups.resto.push(t);
      }
    });

    // Añadir grupos de contenedores a sus tags correspondientes
    Object.values(containerGroups).forEach((cg: any) => {
      if (groups[cg.tag]) groups[cg.tag].push(cg);
      else groups.resto.push(cg);
    });

    return groups;
  }, [selectedDay, tasks, allTasksMap, blocks]);
 
  const totalGroups = useMemo(() => {
    if (!selectedDay) return 0;
    return Object.values(dayTasks as any).flat().length;
  }, [dayTasks, selectedDay]);
 
  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="space-y-8 pb-32"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-black dark:text-white text-text-main-light capitalize">{monthName}</h2>
        <div className="flex gap-2">
          <button 
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
            className="p-3 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl dark:text-text-secondary text-text-secondary-light hover:text-white transition-all shadow-xl"
          >
            <ChevronRight size={20} className="rotate-180" />
          </button>
          <button 
            onClick={() => setViewDate(new Date())}
            className="px-6 py-2 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:text-white transition-all font-black uppercase text-[10px] tracking-widest rounded-2xl"
          >
            Hoy
          </button>
          <button 
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
            className="p-3 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl dark:text-text-secondary text-text-secondary-light hover:text-white transition-all shadow-xl"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
 
      <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2.5rem] p-8 shadow-2xl">
        <div className="grid grid-cols-8 mb-6">
          {['L', 'M', 'X', 'J', 'V', 'S', 'D', ''].map((d, i) => (
            <div key={i} className="text-center text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em]">{d}</div>
          ))}
        </div>
        {/* Agrupar días por semanas para añadir columna de resumen */}
        {(() => {
          // Construir filas de 7 días
          const rows: (string | null)[][] = [];
          for (let i = 0; i < daysInMonth.length; i += 7) {
            rows.push(daysInMonth.slice(i, i + 7));
          }
          // Rellenar última fila si no tiene 7
          while (rows[rows.length - 1]?.length < 7) rows[rows.length - 1].push(null);

          // Horas de jornada diaria (L-V)
          const WORKDAY_HOURS = 8 * 60; // 8h en minutos
          const WEEK_CAPACITY = WORKDAY_HOURS * 5; // L-V

          return rows.map((week, weekIdx) => {
            // Calcular carga total de la semana (solo días con datos)
            const weekDays = week.filter(Boolean) as string[];
            const weekLoad = weekDays.reduce((acc, day) => acc + projectLoadForDay(day, allTasksMap), 0);
            const pct = Math.min(100, Math.round((weekLoad / WEEK_CAPACITY) * 100));
            const freePct = 100 - pct;
            
            // Usar los mismos rangos de color que la carga diaria (en minutos totales semanales)
            // < 15h semana (900m) → esmeralda
            // 15-25h (900-1500m) → naranja  
            // 25-35h (1500-2100m) → morado
            // > 35h (2100m+) → rosa
            const getWeekColor = () => {
              if (weekLoad < 900) return '#10B981'; // esmeralda
              if (weekLoad < 1500) return '#F59E0B'; // naranja
              if (weekLoad < 2100) return '#A855F7'; // morado
              return '#EC4899'; // rosa
            };
            
            const getWeekColorClass = () => {
              if (weekLoad < 900) return 'text-esmeralda';
              if (weekLoad < 1500) return 'text-naranja';
              if (weekLoad < 2100) return 'text-morado';
              return 'text-rosa';
            };
            
            const hasAnyLoad = weekLoad > 0;

            return (
              <div key={weekIdx} className="grid grid-cols-8 gap-3 mb-3">
                {week.map((day, dIdx) => {
                  if (!day) return <div key={dIdx} className="aspect-square" />;
                  const isToday = day === formatLocalISO(new Date());
                  const isSelected = day === selectedDay;
                  const load = projectLoadForDay(day, allTasksMap);
                  return (
                    <button 
                      key={day}
                      onClick={() => setSelectedDay(day)}
                      className={`
                        aspect-square rounded-2xl flex flex-col items-center justify-center relative transition-all group border-2
                        ${isSelected ? 'border-turquesa scale-110 shadow-xl z-20 dark:bg-bg-card bg-white' : 'border-transparent dark:hover:border-white/10 hover:border-gray-300'}
                        ${isToday ? 'dark:bg-bg-main bg-gray-100 ring-2 ring-turquesa ring-offset-4 dark:ring-offset-bg-card ring-offset-white' : ''}
                      `}
                    >
                      <span className={`text-xl font-black ${isSelected ? 'dark:text-white text-text-main-light' : 'dark:text-text-secondary text-text-secondary-light dark:group-hover:text-white group-hover:text-text-main-light'}`}>
                        {parseLocalISO(day).getDate()}
                      </span>
                      {load > 0 && (
                        <div className="mt-1.5 flex flex-col items-center gap-1">
                          <div className="text-[11px] font-black text-turquesa leading-none">
                            {formatMinutes(load)}
                          </div>
                          <div 
                            className="w-10 h-1.5 rounded-full transition-all"
                            style={{ 
                              backgroundColor: getLoadColorHex(load),
                              boxShadow: `0 0 10px ${getLoadColorHex(load)}33`
                            }}
                          />
                        </div>
                      )}
                    </button>
                  );
                })}

                {/* Columna resumen semanal */}
                <div className={`flex flex-col items-center justify-center rounded-2xl border-2 px-3 py-4 gap-3 ${
                  hasAnyLoad 
                    ? 'dark:bg-bg-main/60 bg-gray-50 dark:border-border-main/50 border-gray-200' 
                    : 'border-transparent opacity-30'
                }`}>
                  {hasAnyLoad ? (
                    <>
                      {/* Barra horizontal de progreso - más estilizada */}
                      <div className="w-full h-5 dark:bg-bg-main bg-gray-200 rounded-full overflow-hidden shadow-inner">
                        <div 
                          className="h-full transition-all duration-500 rounded-full"
                          style={{ 
                            width: `${pct}%`,
                            backgroundColor: getWeekColor(),
                            boxShadow: `0 0 12px ${getWeekColor()}55, inset 0 1px 1px rgba(255,255,255,0.3)`
                          }}
                        />
                      </div>
                      {/* Porcentajes - más grandes */}
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-[14px] font-black leading-none ${getWeekColorClass()}`}>
                          {pct}%
                        </span>
                        <span className="text-[12px] font-bold dark:text-text-secondary/70 text-text-secondary-light/70 leading-none">
                          libre {freePct}%
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-4 dark:bg-bg-main bg-gray-200 rounded-full" />
                  )}
                </div>
              </div>
            );
          });
        })()}
 
        <div className="mt-10 space-y-4">
          {/* Leyenda carga diaria */}
          <div className="text-center">
            <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Carga Diaria</p>
            <div className="flex flex-wrap gap-6 justify-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10B981' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">&lt;3h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">3-5h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#A855F7' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">5-7h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#EC4899' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">&gt;7h</span>
              </div>
            </div>
          </div>

          {/* Leyenda carga semanal */}
          <div className="text-center">
            <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Carga Semanal (L-V)</p>
            <div className="flex flex-wrap gap-6 justify-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10B981' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">&lt;15h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">15-25h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#A855F7' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">25-35h</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#EC4899' }} />
                <span className="text-[11px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">&gt;35h</span>
              </div>
            </div>
          </div>
        </div>
      </div>
 
      {/* Day Drawer Overlay - DASHBOARD STYLE */}
      <AnimatePresence>
        {selectedDay && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDay(null)}
              className="fixed inset-0 z-40 bg-bg-main/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 z-50 dark:bg-bg-card bg-bg-card-light border-t dark:border-border-main border-border-main-light rounded-t-[3rem] p-8 max-h-[90vh] overflow-y-auto shadow-[0_-20px_50px_rgba(0,0,0,0.5)] custom-scrollbar"
            >
               <div className="flex items-center justify-between mb-8 sticky top-0 dark:bg-bg-card bg-bg-card-light backdrop-blur py-2 z-10">
                  <div className="flex items-center gap-4">
                     <button onClick={() => setSelectedDay(null)} className="p-3 dark:bg-bg-main bg-white rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light transition-all shadow-xl">
                        <ChevronRight size={20} className="rotate-180" />
                     </button>
                     <div>
                        <h3 className="text-2xl font-black dark:text-white text-text-main-light capitalize">
                          {new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseLocalISO(selectedDay))}
                        </h3>
                        <div className="flex items-center gap-3 mt-1">
                          {selectedDay >= formatLocalISO(new Date()) && (
                            <p className="text-[9px] font-black text-turquesa uppercase tracking-[0.2em]">Carga: {projectLoadForDay(selectedDay, allTasksMap)}m</p>
                          )}
                          {selectedDay >= formatLocalISO(new Date()) && <span className="dark:text-text-secondary text-text-secondary-light opacity-30 text-[9px]">•</span>}
                          <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em]">{totalGroups} tareas</p>
                        </div>
                     </div>
                  </div>
                  <div className="flex gap-3">
                     <button 
                      onClick={() => onDateSelect(selectedDay)}
                      className="px-6 py-3 bg-turquesa text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-turquesa/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                     >
                       <CalendarIcon size={16} /> Ver en Dashboard
                     </button>
                     <button 
                      onClick={() => onAddTask(null, undefined, selectedDay)}
                      className="px-6 py-3 bg-azul text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-azul/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                     >
                       <Plus size={16} /> Añadir
                     </button>
                     <button onClick={() => setSelectedDay(null)} className="p-3 dark:bg-bg-main bg-white rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light transition-all shadow-xl">
                        <X size={20} />
                     </button>
                  </div>
               </div>
 
                <div className="space-y-10">
                  {Object.entries(TAG_LABELS).map(([tag, label]: [any, any]) => {
                    const groupTasks = (dayTasks as any)[tag] || [];
                    if (groupTasks.length === 0) return null;
 
                    return (
                      <div key={tag} className="space-y-4">
                        <h4 className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.25em] pl-4 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-turquesa" />
                          {label.label} ({groupTasks.length})
                        </h4>
                        <div className="grid grid-cols-1 gap-4">
                          <Reorder.Group axis="y" values={groupTasks} onReorder={onReorderTasks} className="grid grid-cols-1 gap-4">
                            {groupTasks.map((item: any) => {
                              // Detectar si es un grupo de contenedor o tarea individual
                              const isContainerGroup = item.parentId && item.subtasks;
                              
                              if (isContainerGroup) {
                                // Renderizar grupo de contenedor con subtareas
                                return (
                                  <div key={item.parentId} className="space-y-2">
                                    {/* Badge del contenedor */}
                                    <div className="flex items-center gap-2 ml-2 mb-2">
                                      <RefreshCw size={12} className="text-turquesa" />
                                      <span className="text-[10px] font-black text-turquesa uppercase tracking-widest">
                                        {item.parentTitle} ({item.subtasks.length})
                                      </span>
                                    </div>
                                    
                                    {/* Lista de subtareas */}
                                    <div className="space-y-3 ml-4">
                                      {item.subtasks.map((sub: any) => (
                                        <TaskCard 
                                          key={sub.id}
                                          task={sub} 
                                          variant="COMPACT"
                                          allTasksMap={allTasksMap}
                                          people={people}
                                          onAddPerson={onAddPerson}
                                          blocks={blocks}
                                          timeEntries={timeEntries}
                                          activeTimer={activeTimer}
                                          onStartTimer={onStartTimer}
                                          onStopTimer={onStopTimer}
                                          onToggleStatus={onToggleTask}
                                          onUpdateTask={onUpdateTask}
                                          onEditTask={onEditTask}
                                          editingTaskId={editingTaskId}
                                          inlineEditingTaskId={inlineEditingTaskId}
                                          setInlineEditingTaskId={setInlineEditingTaskId}
                                          onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel(taskId, subtaskId)}
                                          onAddTask={onAddTask}
                                          onDelete={onDelete}
                                          onPromote={onPromote}
                                          onDemote={onDemote}
                                          onReorderSubtasks={onReorderSubtasks}
                                          onToggleExpand={onToggleExpand}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                );
                              } else {
                                // Tarea individual normal
                                return (
                                  <TaskCard 
                                    key={item.id}
                                    task={item} 
                                    variant="COMPACT"
                                    allTasksMap={allTasksMap}
                                    people={people}
                                    onAddPerson={onAddPerson}
                                    blocks={blocks}
                                    timeEntries={timeEntries}
                                    activeTimer={activeTimer}
                                    onStartTimer={onStartTimer}
                                    onStopTimer={onStopTimer}
                                    onToggleStatus={onToggleTask}
                                    onUpdateTask={onUpdateTask}
                                    onEditTask={onEditTask}
                                    editingTaskId={editingTaskId}
                                    inlineEditingTaskId={inlineEditingTaskId}
                                    setInlineEditingTaskId={setInlineEditingTaskId}
                                    onOpenTimePanel={(taskId: string, subtaskId: string | null) => onOpenTimePanel(taskId, subtaskId)}
                                    onAddTask={onAddTask}
                                    onDelete={onDelete}
                                    onPromote={onPromote}
                                    onDemote={onDemote}
                                    onReorderSubtasks={onReorderSubtasks}
                                    onToggleExpand={onToggleExpand}
                                  />
                                );
                              }
                            })}
                          </Reorder.Group>
                        </div>
                      </div>
                    );
                  })}
 
                  {totalGroups === 0 && (
                    <div className="py-20 text-center text-text-secondary border-2 border-dashed border-border-main rounded-[2.5rem] opacity-50 bg-bg-main/20">
                       <LayoutDashboard size={48} className="mx-auto mb-4 opacity-20" />
                       <p className="font-black uppercase tracking-[0.2em] text-xs">No hay tareas proyectadas para esta fecha</p>
                    </div>
                 )}
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
 
// --- Recurrence Choice Modal ---
function RecurrenceChoiceModal({ type, onClose, onConfirm }: { type: 'edit' | 'delete', onClose: () => void, onConfirm: (choice: 'instance' | 'series') => void }) {
  return (
    <div className="fixed inset-0 bg-bg-main/80 backdrop-blur-md z-[110] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-bg-card max-w-sm w-full rounded-[2.5rem] border border-border-main p-8 shadow-[0_30px_100px_rgba(0,0,0,0.6)] text-center"
      >
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 ${type === 'edit' ? 'bg-azul/20 text-azul' : 'bg-rosa/20 text-rosa'}`}>
          {type === 'edit' ? <Edit size={32} /> : <Trash2 size={32} />}
        </div>
        <h3 className="text-2xl font-black text-white mb-2">
          {type === 'edit' ? '¿Qué quieres editar?' : '¿Qué quieres eliminar?'}
        </h3>
        <p className="text-sm font-bold text-text-secondary mb-8 leading-relaxed">
          Esta tarea es parte de una rutina recurrente. Elige si quieres afectar solo a este día o a toda la serie.
        </p>
 
        <div className="space-y-3">
          <button 
            onClick={() => onConfirm('instance')}
            className="w-full py-4 bg-bg-main hover:bg-bg-secondary rounded-2xl text-[10px] font-black uppercase tracking-widest text-white border border-border-main transition-all flex items-center justify-center gap-2"
          >
            {type === 'edit' ? 'Solo esta tarea' : 'Solo este día'}
          </button>
          <button 
            onClick={() => onConfirm('series')}
            className={`w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white transition-all flex items-center justify-center gap-2 shadow-xl ${type === 'edit' ? 'bg-azul shadow-azul/20' : 'bg-rosa shadow-rosa/20'}`}
          >
            {type === 'edit' ? 'Toda la serie (Futuro)' : 'Toda la serie (Futuro)'}
          </button>
          <button 
            onClick={onClose}
            className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-text-secondary hover:text-white transition-all"
          >
            Cancelar
          </button>
        </div>
      </motion.div>
    </div>
  );
}
 
 
 
// --- Block Modal ---
function BlockModal({ block, onClose, onSave, onDelete }: { block: WorkBlock, onClose: () => void, onSave: (b: WorkBlock) => void, onDelete: (id: string) => void }) {
  const [localBlock, setLocalBlock] = useState<WorkBlock>(block);
  const [showAllIcons, setShowAllIcons] = useState(false);
  const [showAllColors, setShowAllColors] = useState(false);
  
  const allIcons = [
    '🏢', '💰', '🏦', '📜', '🏠', '👥', '⚙️', '🛡️', '🗓️', '✅', '🔥', '🚀', '🧠', '🛠️', '🛒', '📞',
    '💼', '📊', '🌐', '📡', '🔒', '🔑', '🏷️', '📦', '📅', '📝', '🔔', '📢', '🔍', '📱', '💻', '🎥',
    '🎨', '🎵', '⚽', '🏆', '🍕', '☕', '✈️', '⚡', '🌙', '☀️', '🌈', '🍀', '💎', '📍', '🎁', '💡'
  ];
  
  const icons = showAllIcons ? allIcons : allIcons.slice(0, 16);
  const allColorThemes = Object.values(COLORS);
  const colorThemes = showAllColors ? allColorThemes : allColorThemes.slice(0, 7);
 
  return (
    <div className="fixed inset-0 bg-bg-main/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-xl dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[3rem] shadow-[0_30px_100px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b dark:border-border-main border-border-main-light flex items-center justify-between sticky top-0 dark:bg-bg-card bg-white z-10">
           <div className="flex items-center gap-4">
              <div className="w-12 h-12 dark:bg-bg-main bg-gray-100 rounded-2xl flex items-center justify-center text-3xl border dark:border-border-main border-border-main-light" style={{ borderColor: localBlock.color }}>
                {localBlock.icon}
              </div>
              <div>
                <h3 className="text-2xl font-black dark:text-white text-text-main-light">{!localBlock.name ? 'Nuevo Bloque' : localBlock.name}</h3>
                <p className="text-[10px] font-black uppercase dark:text-text-secondary text-text-secondary-light tracking-widest">Configuración de contexto</p>
              </div>
           </div>
           <button onClick={onClose} className="p-3 dark:hover:bg-bg-main hover:bg-gray-100 rounded-2xl transition-all dark:text-text-secondary text-text-secondary-light">
              <X size={24} />
           </button>
        </div>
 
        <div className="p-10 space-y-10 overflow-y-auto custom-scrollbar">
           <div className="flex items-center justify-between dark:bg-bg-main/20 bg-gray-100 p-6 rounded-3xl border dark:border-border-main border-border-main-light">
              <div>
                <h4 className="text-sm font-black dark:text-white text-text-main-light mb-1 uppercase tracking-widest">Estado del Bloque</h4>
                <p className="text-[9px] font-bold dark:text-text-secondary text-text-secondary-light uppercase">Los bloques inactivos no aparecen en el dashboard</p>
              </div>
              <button 
                onClick={() => setLocalBlock(prev => ({ ...prev, isActive: !prev.isActive }))}
                className={`flex items-center gap-3 px-6 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all border-2 ${localBlock.isActive ? 'bg-turquesa/10 border-turquesa text-turquesa shadow-lg shadow-turquesa/10' : 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light'}`}
              >
                {localBlock.isActive ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                {localBlock.isActive ? 'ACTIVO' : 'INACTIVO'}
              </button>
           </div>
 
           <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light px-2">Nombre del Bloque</label>
              <input 
                type="text"
                autoFocus
                className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-3xl p-6 text-xl font-bold dark:text-white text-text-main-light focus:ring-4 focus:ring-turquesa/20 outline-none transition-all placeholder:opacity-20"
                placeholder="Ej: Contabilidad central"
                value={localBlock.name}
                onChange={e => setLocalBlock(prev => ({ ...prev, name: e.target.value }))}
              />
           </div>
 
           <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <label className="text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Icono Visual</label>
                <button onClick={() => setShowAllIcons(!showAllIcons)} className="text-[9px] font-black text-turquesa uppercase tracking-widest hover:underline">
                  {showAllIcons ? 'Ver menos' : 'Ver todos'}
                </button>
              </div>
              <div className="grid grid-cols-8 gap-3">
                 {icons.map(icon => (
                   <button 
                    key={icon}
                    onClick={() => setLocalBlock(prev => ({ ...prev, icon }))}
                    className={`aspect-square flex items-center justify-center text-2xl rounded-2xl border transition-all ${localBlock.icon === icon ? 'bg-turquesa/20 border-turquesa scale-110 shadow-lg' : 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:hover:border-white/20 hover:border-gray-300'}`}
                   >
                     {icon}
                   </button>
                 ))}
              </div>
           </div>
 
           <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <label className="text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Color del Bloque</label>
                <button onClick={() => setShowAllColors(!showAllColors)} className="text-[9px] font-black text-turquesa uppercase tracking-widest hover:underline">
                  {showAllColors ? 'Ver menos' : 'Ver todos'}
                </button>
              </div>
              <div className="flex flex-wrap gap-4">
                 {colorThemes.map((theme, idx) => (
                   <button 
                    key={idx}
                    onClick={() => setLocalBlock(prev => ({ ...prev, color: theme.main, pastelColor: theme.pastel }))}
                    className={`w-10 h-10 rounded-full border-4 transition-all ${localBlock.color === theme.main ? 'border-white scale-125 shadow-xl' : 'border-transparent opacity-60 hover:opacity-100'}`}
                    style={{ backgroundColor: theme.main }}
                   />
                 ))}
              </div>
           </div>
        </div>
 
        <div className="p-8 dark:bg-bg-main/20 bg-gray-100/50 border-t dark:border-border-main border-border-main-light flex items-center justify-between gap-4 sticky bottom-0 z-10 backdrop-blur-md">
           {localBlock.id.startsWith('b-') ? (
             <div />
           ) : (
             <button 
              onClick={() => { onDelete(localBlock.id); onClose(); }}
              className="px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-rosa hover:bg-rosa/10 transition-all flex items-center gap-2"
             >
               <Trash2 size={16} /> Eliminar
             </button>
           )}
           
           <div className="flex gap-4">
             <button onClick={onClose} className="px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-text-secondary hover:text-white transition-all">Cancelar</button>
             <button 
                disabled={!localBlock.name}
                onClick={() => onSave(localBlock)}
                className="px-10 py-4 rounded-2xl text-xs font-black uppercase tracking-widest bg-turquesa text-white shadow-2xl shadow-turquesa/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-3 disabled:opacity-50 disabled:scale-100"
             >
               <LayoutDashboard size={18} />
               Guardar Bloque
             </button>
           </div>
        </div>
      </motion.div>
    </div>
  );
}
 
// --- Helpers ---
function getTagColor(tag: TagType) {
  switch (tag) {
    case 'con_hora': return 'turquesa';
    case 'focus': return 'azul';
    case 'dirección': return 'morado';
    case 'espera': return 'naranja';
    case 'resto': return 'turquesa';
    default: return 'text-secondary';
  }
}
 
// --- NEW OVERHAUL COMPONENTS ---
 
function TimerDisplay({ startTime, accumulatedSeconds }: { startTime: string, accumulatedSeconds: number }) {
  const [now, setNow] = useState(new Date().getTime());
 
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date().getTime()), 1000);
    return () => clearInterval(interval);
  }, []);
 
  const totalSeconds = Math.floor((now - new Date(startTime).getTime()) / 1000) + (accumulatedSeconds || 0);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
 
  return (
    <span className="font-mono text-xs font-black text-white">
      {h > 0 ? `${h}h ` : ''}{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
    </span>
  );
}
 
function DashboardHarmonicCalendar({ activeDate, onSetDate, onClose }: any) {
  const [currentMonth, setCurrentMonth] = useState(() => parseLocalISO(activeDate));
  
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const totalDays = daysInMonth(year, month);
  const startDay = (firstDayOfMonth(year, month) + 6) % 7; // 0=lun...6=dom
  
  const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
 
  const prevMonthDays = daysInMonth(year, month - 1);
  
  const days = [];
  for (let i = startDay - 1; i >= 0; i--) {
     days.push({ day: prevMonthDays - i, current: false, date: new Date(year, month - 1, prevMonthDays - i) });
  }
  for (let i = 1; i <= totalDays; i++) {
     days.push({ day: i, current: true, date: new Date(year, month, i) });
  }
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
     days.push({ day: i, current: false, date: new Date(year, month + 1, i) });
  }
 
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between px-1">
        <button 
          onClick={() => setCurrentMonth(new Date(year, month - 1))} 
          className="w-8 h-8 flex items-center justify-center hover:bg-bg-main rounded-lg transition-all text-text-secondary hover:text-white"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-black text-xs uppercase tracking-[0.2em] text-white">
          {monthNames[month]} {year}
        </span>
        <button 
          onClick={() => setCurrentMonth(new Date(year, month + 1))} 
          className="w-8 h-8 flex items-center justify-center hover:bg-bg-main rounded-lg transition-all text-text-secondary hover:text-white"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {dayNames.map(d => (
          <div key={d} className="text-[10px] font-black text-text-secondary/40 text-center py-2 uppercase tracking-widest">{d}</div>
        ))}
        {days.map((d, i) => {
          const dateStr = formatLocalISO(d.date);
          const isSelected = dateStr === activeDate;
          const isToday = dateStr === formatLocalISO(new Date());
          
          return (
            <button 
              key={i}
              onClick={() => {
                onSetDate(dateStr);
                onClose();
              }}
              className={`
                aspect-square flex flex-col items-center justify-center rounded-xl text-[11px] font-bold transition-all relative
                ${isSelected ? 'bg-turquesa text-white shadow-lg shadow-turquesa/20 scale-105 z-10' : 'bg-bg-main/50'}
                ${!isSelected && d.current ? 'text-text-main hover:bg-turquesa/10 hover:text-turquesa border border-border-main/30' : ''}
                ${!d.current ? 'text-text-secondary/20 border-none bg-transparent' : ''}
                ${isToday && !isSelected ? 'border-turquesa/50' : ''}
              `}
            >
              <span className={!d.current ? 'opacity-20' : ''}>{d.day}</span>
              {isToday && !isSelected && (
                <div className="absolute bottom-1.5 w-1 h-1 bg-turquesa rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
 
function TaskCard({ 
  task, 
  variant, 
  allTasksMap,
  people = [],
  blocks, 
  timeEntries, 
  activeTimer,
  onStartTimer,
  onStopTimer,
  onToggleStatus, 
  onUpdateTask,
  onEditTask,
  editingTaskId,
  inlineEditingTaskId,
  setInlineEditingTaskId,
  onOpenTimePanel,
  // Navigation / Actions
  onAddTask,
  onDelete,
  onPromote,
  onDemote,
  onReorderSubtasks,
  onToggleExpand,
  level = 1,
  rootTaskId = null,
  hideCompleted = false,
  subtasksForGroup = null,
  forceExpanded = null,
  onAddPerson = null,
  onRenamePerson = null,
  onDeletePerson = null,
  onRecurrenceDateChange = null,
  taskIndex = null,
  taskCount = null,
  onMoveUp = null,
  onMoveDown = null,
  selectionMode = false,
  selectedTaskIds = new Set(),
  onToggleTaskSelection = null,
}: any) {
  if (!task || task.isDeleted) return null;
  const currentRootId = rootTaskId || task.id;
  const block = blocks.find((b: any) => b.id === task.blockId) || blocks[0] || { color: '#14B8A6', icon: '📋', name: 'General' };
  const hasSubtasks = (task.subtasks && task.subtasks.length > 0) || (subtasksForGroup && subtasksForGroup.length > 0);
  // If forceExpanded is null (Bloques), use task.isExpanded
  // If forceExpanded is true/false (Dashboard global toggle), still respect individual task.isExpanded if set
  const isExpanded = task.isExpanded ?? (forceExpanded ?? true);
  
  // En Dashboard con subtasksForGroup: solo sumar las subtareas de ese grupo
  // En Bloques: sumar todas las subtareas
  const totalEstimated = (() => {
    if (subtasksForGroup !== null) {
      // Dashboard: contenedor dividido por grupos - solo sumar subtareas PENDIENTES del grupo
      return subtasksForGroup.reduce((acc: number, subId: string) => {
        return acc + getTaskEstimatedPending(subId, allTasksMap);
      }, 0);
    } else {
      // Bloques o tarea normal: sumar PENDIENTES
      return getTaskEstimatedPending(task.id, allTasksMap);
    }
  })();
  
  const totalRegistered = (() => {
    if (subtasksForGroup !== null) {
      // Dashboard: solo tiempo de subtareas del grupo
      return subtasksForGroup.reduce((acc: number, subId: string) => {
        return acc + getTaskRegisteredCombo(subId, allTasksMap, timeEntries);
      }, 0);
    } else {
      // Bloques o tarea normal: sumar todo
      return getTaskRegisteredCombo(task.id, allTasksMap, timeEntries);
    }
  })();
  
  const isTimerRunning = activeTimer?.entityId === task.id;
  const [dragX, setDragX] = useState(0);
 
  if (variant === 'COMPACT') {
    const [showMovePicker, setShowMovePicker] = useState(false);
    const [showMoveCalendar, setShowMoveCalendar] = useState(false);

    const handleMoveTask = (newDate: string | null) => {
      if (!newDate || newDate === task.dueDate) { setShowMovePicker(false); setShowMoveCalendar(false); return; }
      const updated = {
        ...task,
        dueDate: newDate,
        instanceDate: task.instanceDate || task.dueDate,
        isException: !!task.templateId,
        modifiedAt: new Date().toISOString()
      };
      onUpdateTask(updated);
      setShowMovePicker(false);
      setShowMoveCalendar(false);
    };

    return (
      <Reorder.Item value={task} className="relative">
        <div className="flex items-center gap-2 p-2 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl transition-all group">
          <div className="w-1.5 h-6 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
          <span className="text-[11px] font-bold dark:text-white text-text-main-light truncate flex-1 uppercase tracking-tight">{task.title}</span>
          {(task.templateId || task.recurrence) && <RefreshCw size={10} className="text-turquesa shrink-0" />}
          <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light shrink-0">
            {formatMinutes(totalEstimated)}
          </span>
          {/* Botones de acción */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onEditTask(task.id); }}
              className="w-7 h-7 flex items-center justify-center text-turquesa bg-turquesa/5 hover:bg-turquesa/10 rounded-lg transition-all border border-turquesa/20"
              title="Editar tarea"
            >
              <Edit size={13} />
            </button>
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowMovePicker(!showMovePicker); setShowMoveCalendar(false); }}
                className="w-7 h-7 flex items-center justify-center text-azul bg-azul/5 hover:bg-azul/10 rounded-lg transition-all border border-azul/20"
                title="Mover a otro día"
              >
                <CalendarIcon size={13} />
              </button>

              <AnimatePresence>
                {showMovePicker && (
                  <>
                    <div className="fixed inset-0 z-[210]" onClick={() => { setShowMovePicker(false); setShowMoveCalendar(false); }} />
                    <motion.div
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                      className="fixed bottom-4 right-4 z-[220] bg-bg-card border border-border-main rounded-2xl shadow-2xl p-4 w-[220px]"
                    >
                      {!showMoveCalendar ? (
                        <div className="space-y-2">
                          {task.templateId && (
                            <p className="text-[9px] font-black text-text-secondary uppercase tracking-widest text-center pb-1 border-b border-border-main/50">
                              Solo esta instancia
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMoveTask(formatLocalISO(new Date())); }}
                              className="flex flex-col items-center gap-1 p-3 bg-bg-main rounded-xl border border-border-main hover:border-turquesa transition-all group"
                            >
                              <span className="text-[10px] font-black text-white uppercase tracking-widest group-hover:text-turquesa">Hoy</span>
                              <span className="text-[8px] text-text-secondary">{new Date().getDate()}</span>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); const m = new Date(); m.setDate(m.getDate() + 1); handleMoveTask(formatLocalISO(m)); }}
                              className="flex flex-col items-center gap-1 p-3 bg-bg-main rounded-xl border border-border-main hover:border-turquesa transition-all group"
                            >
                              <span className="text-[10px] font-black text-white uppercase tracking-widest group-hover:text-turquesa">Mañana</span>
                              <span className="text-[8px] text-text-secondary">{(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.getDate(); })()}</span>
                            </button>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowMoveCalendar(true); }}
                            className="w-full flex items-center justify-between p-3 bg-bg-main rounded-xl border border-border-main hover:border-azul transition-all group"
                          >
                            <span className="text-[10px] font-black text-white uppercase tracking-widest group-hover:text-azul">Elegir fecha</span>
                            <CalendarIcon size={14} className="text-text-secondary group-hover:text-azul" />
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between px-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowMoveCalendar(false); }}
                              className="text-[10px] font-black text-turquesa uppercase tracking-widest hover:underline flex items-center gap-1"
                            >
                              <ChevronLeft size={12} /> Volver
                            </button>
                            <span className="text-[10px] font-black text-text-secondary uppercase tracking-widest">Mensual</span>
                          </div>
                          <MonthDatePicker
                            value={task.dueDate}
                            onChange={(d) => { handleMoveTask(d); }}
                          />
                        </div>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </Reorder.Item>
    );
  }
 
  return (
    <div className="group relative">
      <div>
        <div
          className={`relative transition-all hover:dark:bg-white/[0.02] hover:bg-black/[0.02] ${task.status === 'completed' ? 'opacity-50' : ''}`}
        >
          {/* Main Row */}
          <div className="flex items-center gap-2 px-4 py-2.5 pl-3">

            {/* Flechitas reordenar - hover */}
            <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => onMoveUp && onMoveUp()}
                disabled={taskIndex === 0}
                className={`w-5 h-5 flex items-center justify-center rounded-md transition-all ${taskIndex === 0 ? 'text-text-secondary/20 cursor-not-allowed' : 'dark:text-text-secondary text-text-secondary-light hover:text-turquesa hover:bg-turquesa/10'}`}
                title="Subir"
              >
                <ChevronUp size={12} />
              </button>
              <button
                onClick={() => onMoveDown && onMoveDown()}
                disabled={taskIndex === taskCount - 1}
                className={`w-5 h-5 flex items-center justify-center rounded-md transition-all ${taskIndex === taskCount - 1 ? 'text-text-secondary/20 cursor-not-allowed' : 'dark:text-text-secondary text-text-secondary-light hover:text-turquesa hover:bg-turquesa/10'}`}
                title="Bajar"
              >
                <ChevronDown size={12} />
              </button>
            </div>

            {/* Barra color bloque - inline entre flechas y checkbox */}
            <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: block.color }} />

            {/* Checkbox - turquesa normal, azul en modo selección */}
            {selectionMode && onToggleTaskSelection ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const isContainer = task.subtasks && task.subtasks.length > 0;
                  onToggleTaskSelection(task.id, isContainer);
                }}
                className={`w-5 h-5 rounded-lg flex items-center justify-center transition-all shadow-lg shrink-0 ${
                  selectedTaskIds.has(task.id)
                    ? 'bg-azul text-white border-2 border-azul'
                    : 'dark:bg-bg-main bg-white border-2 dark:border-border-main border-border-main-light text-transparent hover:border-azul'
                }`}
              >
                <Check size={12} />
              </button>
            ) : (
              <button 
                onClick={() => onToggleStatus(task.id)}
                className={`w-5 h-5 rounded-lg flex items-center justify-center transition-all shadow-lg shrink-0 ${task.status === 'completed' ? 'bg-turquesa text-white' : 'dark:bg-bg-main bg-white border-2 dark:border-border-main border-border-main-light text-transparent hover:border-turquesa'}`}
              >
                <CheckCircle2 size={12} />
              </button>
            )}

            {/* Contenido: título + chips */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col gap-1">
                {/* Fila título */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <input 
                      autoFocus={editingTaskId === task.id || inlineEditingTaskId === task.id}
                      className={`text-[13px] font-black dark:text-white text-text-main-light bg-transparent outline-none min-w-0 flex-1 truncate dark:placeholder:text-text-secondary/20 placeholder:text-text-secondary-light/20 capitalize tracking-normal ${task.status === 'completed' ? 'line-through' : ''}`}
                      value={task.title}
                      onChange={(e) => onUpdateTask({ ...task, title: e.target.value })}
                      onBlur={() => { 
                        if(editingTaskId === task.id) onEditTask(null);
                        if(inlineEditingTaskId === task.id) setInlineEditingTaskId(null);
                      }}
                      onKeyDown={(e) => { 
                        if(e.key === 'Enter') {
                          if(editingTaskId === task.id) onEditTask(null);
                          if(inlineEditingTaskId === task.id) setInlineEditingTaskId(null);
                        }
                      }}
                      placeholder="Título de la tarea..."
                    />
                    {/* Badge circular subtareas pendientes */}
                    {hasSubtasks && (() => {
                      const subIds: string[] = subtasksForGroup || task.subtasks || [];
                      const pendingCount = subIds.filter((sid: string) => {
                        const s = allTasksMap[sid];
                        return s && !s.isDeleted && s.status !== 'completed';
                      }).length;
                      return (
                        <button
                          onClick={() => onToggleExpand(task.id)}
                          className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center bg-rosa/20 border border-rosa/40 text-rosa transition-all hover:bg-rosa/30"
                        >
                          {String(pendingCount)}
                        </button>
                      );
                    })()}
                  </div>
                </div>

                {/* Fila chips - incluye badge bloque al inicio */}
                <div className="flex flex-wrap items-center gap-1">
                  <TaskTypeChip 
                    value={task.taskType || (isTaskRepetitive(task.id, allTasksMap) ? 'core' : 'adhoc')} 
                    onChange={(val: string) => onUpdateTask({ ...task, taskType: val })} 
                    isCompact={true}
                  />
                  {!hasSubtasks && (
                    <DatePickerChip 
                      value={task.dueDate} 
                      onChange={(date: string) => {
                        if (task.templateId) {
                          onRecurrenceDateChange && onRecurrenceDateChange(task, date);
                        } else {
                          onUpdateTask({ ...task, dueDate: date });
                        }
                      }} 
                    />
                  )}
                  {!hasSubtasks && (
                    <TimePickerChip
                      value={task.dueTime || ''}
                      onChange={(time: string) => onUpdateTask({ ...task, dueTime: time })}
                    />
                  )}
                  {!hasSubtasks && (
                    <RecurrencePickerChip 
                      value={task.recurrence}
                      onChange={(rec: any) => onUpdateTask({ 
                        ...task, 
                        recurrence: rec || undefined,
                        isTemplate: !!rec,
                        dueDate: rec ? null : (task.dueDate || formatLocalISO(new Date())),
                        dueTime: task.dueTime // ✅ Preservar hora concreta
                      })}
                    />
                  )}
                  {!hasSubtasks && (
                    <TagPickerChip 
                      selectedTags={task.tags} 
                      onChange={(tags: TagType[]) => onUpdateTask({ ...task, tags })} 
                    />
                  )}
                  {!hasSubtasks && (
                    <DelegationChip
                      delegation={task.delegation}
                      people={people || []}
                      onChange={(delegation: any) => onUpdateTask({ ...task, delegation })}
                      onAddPerson={onAddPerson}
                      onRenamePerson={onRenamePerson}
                      onDeletePerson={onDeletePerson}
                      onRecurrenceDateChange={onRecurrenceDateChange}
                    />
                  )}
                  <EstimatedTimeChip 
                    value={hasSubtasks ? totalEstimated : task.estimatedMinutes} 
                    onChange={(val: number) => { if (!hasSubtasks) onUpdateTask({ ...task, estimatedMinutes: val }); }} 
                    readonly={hasSubtasks}
                    variant={level > 1 ? 'mini' : 'default'}
                  />
                  <RegisteredTimeChip 
                    value={totalRegistered} 
                    estimated={totalEstimated}
                    onClick={() => onOpenTimePanel(currentRootId, level === 1 ? null : task.id)} 
                  />
                  <button 
                    onClick={() => isTimerRunning ? onStopTimer() : onStartTimer(currentRootId, level === 1 ? null : task.id)}
                    className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${isTimerRunning ? 'bg-rosa text-white' : 'dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light text-turquesa hover:bg-turquesa/10'}`}
                  >
                    {isTimerRunning ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                  </button>

                  {/* Block picker - clickable chip to change context */}
                  {variant === 'FULL' ? (
                    // In Bloques: small discrete chip
                    <BlockPickerChip 
                      value={task.blockId}
                      blocks={blocks}
                      onChange={(blockId: string) => onUpdateTask({ ...task, blockId })}
                    />
                  ) : (
                    // In Dashboard: full chip with icon and name
                    <BlockPickerChip 
                      value={task.blockId}
                      blocks={blocks}
                      onChange={(blockId: string) => onUpdateTask({ ...task, blockId })}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Botones acción - una sola fila */}
            <div className="flex flex-col gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => onEditTask(task.id)} 
                  className="w-6 h-6 flex items-center justify-center text-turquesa bg-turquesa/5 hover:bg-turquesa/10 rounded-lg transition-all border border-turquesa/20"
                  title="Editar"
                >
                  <Edit size={12} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); onDelete(task.id); }} 
                  className="w-6 h-6 flex items-center justify-center text-rosa bg-rosa/5 hover:bg-rosa/10 rounded-lg transition-all border border-rosa/20"
                  title="Eliminar"
                >
                  <Trash2 size={12} />
                </button>
                {level < 3 && (
                  <button 
                    onClick={() => onAddTask(task.id, task.blockId)} 
                    className="w-6 h-6 flex items-center justify-center text-turquesa bg-turquesa/5 hover:bg-turquesa/10 rounded-lg transition-all border border-turquesa/20" 
                    title="Añadir subtarea"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {task.parentTaskId && (
                  <button 
                    onClick={() => onPromote(task.id)} 
                    title="Subir un nivel" 
                    className="w-6 h-6 flex items-center justify-center dark:text-text-secondary text-text-secondary-light hover:text-turquesa dark:bg-bg-main bg-white rounded-lg border dark:border-border-main border-border-main-light transition-all"
                  >
                    <ArrowUpLeft size={12} />
                  </button>
                )}
                <button 
                  onClick={() => onDemote(task.id)} 
                  title="Bajar un nivel" 
                  className="w-6 h-6 flex items-center justify-center dark:text-text-secondary text-text-secondary-light hover:text-azul dark:bg-bg-main bg-white rounded-lg border dark:border-border-main border-border-main-light transition-all"
                >
                  <ArrowDownRight size={12} />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* Subtasks */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={`border-l-2 dark:border-border-main/20 border-border-main-light/20 space-y-0 ${level === 1 ? "ml-5 pl-3" : "ml-7 pl-4"}`}
            >
              {hasSubtasks && (
                <Reorder.Group 
                  axis="y" 
                  values={task.subtasks.map((sid: string) => allTasksMap[sid]).filter(Boolean)} 
                  onReorder={(newSubtasks: any[]) => onReorderSubtasks(task.id, newSubtasks.map(t => t.id))}
                  className="space-y-0 divide-y dark:divide-border-main/20 divide-border-main-light/20"
                >
                  {(subtasksForGroup || task.subtasks)
                    .filter((subId: string) => {
                      if (!hideCompleted) return true;
                      const sub = allTasksMap[subId];
                      if (!sub) return true;
                      return sub.status !== 'completed';
                    })
                    .map((subId: string, idx: number, visibleSubs: string[]) => (
                    <TaskCard 
                      key={subId}
                      task={allTasksMap[subId]}
                      variant={variant}
                      allTasksMap={allTasksMap}
                      people={people}
                      onAddPerson={onAddPerson}
                      blocks={blocks}
                      timeEntries={timeEntries}
                      activeTimer={activeTimer}
                      onStartTimer={onStartTimer}
                      onStopTimer={onStopTimer}
                      onToggleStatus={onToggleStatus}
                      onUpdateTask={onUpdateTask}
                      onEditTask={onEditTask}
                      editingTaskId={editingTaskId}
                      inlineEditingTaskId={inlineEditingTaskId}
                      setInlineEditingTaskId={setInlineEditingTaskId}
                      onOpenTimePanel={onOpenTimePanel}
                      onAddTask={onAddTask}
                      onDelete={onDelete}
                      onPromote={onPromote}
                      onDemote={onDemote}
                      onReorderSubtasks={onReorderSubtasks}
                      onToggleExpand={onToggleExpand}
                      level={level + 1}
                      rootTaskId={currentRootId}
                      hideCompleted={hideCompleted}
                      selectionMode={selectionMode}
                      selectedTaskIds={selectedTaskIds}
                      onToggleTaskSelection={onToggleTaskSelection}
                      taskIndex={idx}
                      taskCount={visibleSubs.length}
                      onMoveUp={() => {
                        if (idx === 0) return;
                        const allSubs = task.subtasks || [];
                        const currentIdx = allSubs.indexOf(subId);
                        if (currentIdx <= 0) return;
                        const reordered = [...allSubs];
                        [reordered[currentIdx - 1], reordered[currentIdx]] = [reordered[currentIdx], reordered[currentIdx - 1]];
                        onReorderSubtasks(task.id, reordered);
                      }}
                      onMoveDown={() => {
                        if (idx === visibleSubs.length - 1) return;
                        const allSubs = task.subtasks || [];
                        const currentIdx = allSubs.indexOf(subId);
                        if (currentIdx < 0 || currentIdx >= allSubs.length - 1) return;
                        const reordered = [...allSubs];
                        [reordered[currentIdx], reordered[currentIdx + 1]] = [reordered[currentIdx + 1], reordered[currentIdx]];
                        onReorderSubtasks(task.id, reordered);
                      }}
                    />
                  ))}
                </Reorder.Group>
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
 
// --- Inline Editing Chips ---
function TaskTypeChip({ value, onChange, isCompact = false }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isCore = value === 'core';

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    setShow(!show);
  };
  
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleOpen}
        className={`h-6 px-2 py-0.5 rounded-lg flex items-center justify-center gap-1 border transition-all ${
          isCore 
            ? 'bg-turquesa/10 border-turquesa/40 text-turquesa shadow-sm shadow-turquesa/20 hover:border-turquesa' 
            : 'bg-rosa/10 border-rosa/30 text-rosa shadow-sm shadow-rosa/20 hover:border-rosa'
        }`}
        title={isCore ? 'Puesto de Trabajo (CORE)' : 'Tarea Puntual (Ad-hoc)'}
      >
        {isCore ? (
          <>
            <Compass size={10} strokeWidth={2.5} />
            {!isCompact && <span className="text-[8px] font-black uppercase tracking-widest leading-none">Core</span>}
          </>
        ) : (
          <>
            <div className="w-2 h-2 rounded-full bg-current shadow-[0_0_8px_rgba(251,113,133,0.4)]" />
            {!isCompact && <span className="text-[8px] font-black uppercase tracking-widest leading-none ml-0.5">Ad-hoc</span>}
          </>
        )}
      </button>
 
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShow(false)} />
            <motion.div 
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl p-2 shadow-2xl z-[220] backdrop-blur-xl w-48 overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
              <div className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest px-2 mb-2">Tipo de Tarea</div>
              <div className="space-y-1">
                <button 
                  onClick={() => { onChange('core'); setShow(false); }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                    isCore 
                      ? 'bg-turquesa text-white' 
                      : 'dark:hover:bg-white/5 hover:bg-bg-main-light/50 dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'
                  }`}
                >
                  <Compass size={14} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Puesto (CORE)</span>
                </button>
                <button 
                  onClick={() => { onChange('adhoc'); setShow(false); }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                    !isCore 
                      ? 'bg-rosa text-white' 
                      : 'dark:hover:bg-white/5 hover:bg-bg-main-light/50 dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'
                  }`}
                >
                  <div className="w-2 h-2 bg-current rounded-full" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Puntual (AD-HOC)</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
function TimePickerChip({ value, onChange }: any) {
  const [show, setShow] = useState(false);
  const [inputVal, setInputVal] = React.useState(value || '');
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  React.useEffect(() => { setInputVal(value || ''); }, [value]);

  const handleConfirm = () => {
    onChange(inputVal);
    setShow(false);
  };

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    setShow(s => !s);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className={`h-6 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border-2 transition-all flex items-center gap-1 ${
          value
            ? 'bg-azul/10 border-azul text-azul shadow-sm'
            : 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul'
        }`}
        title={value ? `Hora: ${value}` : 'Añadir hora'}
      >
        <Clock size={9} />
        {value && <span>{value}</span>}
      </button>
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={handleConfirm} />
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              onClick={e => e.stopPropagation()}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[160px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
              <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Hora ejecución</p>
              <input
                type="time"
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onClick={e => e.stopPropagation()}
                onFocus={e => e.stopPropagation()}
                className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-bold text-azul outline-none focus:border-azul/50 text-center"
                autoFocus
              />
              <div className="flex gap-2 mt-3">
                <button onClick={handleConfirm} className="flex-1 py-2 rounded-xl bg-azul text-white text-[10px] font-black uppercase tracking-widest hover:bg-azul/80 transition-all">OK</button>
                {value && <button onClick={() => { onChange(''); setShow(false); }} className="px-3 py-2 rounded-xl text-rosa bg-rosa/10 hover:bg-rosa/20 transition-all"><Trash2 size={12} /></button>}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function DatePickerChip({ value, onChange, dropUp = false }: any) {
  const [show, setShow] = useState(false);
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isSinFecha = !value;
  const label = isSinFecha ? 'Sin fecha' : new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(parseLocalISO(value));

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    setShow(s => !s);
  };
 
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleToggle}
        className={`h-6 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border-2 transition-all ${
          isSinFecha 
            ? 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light' 
            : 'bg-turquesa/10 border-turquesa text-turquesa shadow-sm'
        }`}
      >
        {label}
      </button>
 
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => { setShow(false); setShowFullCalendar(false); }} />
            <motion.div 
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[220px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
               {!showFullCalendar ? (
                 <div className="space-y-2">
                   <div className="grid grid-cols-2 gap-2">
                     <button 
                       onClick={() => { onChange(formatLocalISO(new Date())); setShow(false); }} 
                       className="flex flex-col items-center gap-1 p-3 dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                     >
                       <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Hoy</span>
                       <span className="text-[8px] dark:text-text-secondary text-text-secondary-light">{new Date().getDate()}</span>
                     </button>
                     <button 
                       onClick={() => { 
                         const m = new Date(); m.setDate(m.getDate() + 1); 
                         onChange(formatLocalISO(m)); setShow(false); 
                       }} 
                       className="flex flex-col items-center gap-1 p-3 dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                     >
                       <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Mañana</span>
                       <span className="text-[8px] dark:text-text-secondary text-text-secondary-light">{(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.getDate(); })()}</span>
                     </button>
                   </div>
                   
                   <button 
                     onClick={() => setShowFullCalendar(true)}
                     className="w-full flex items-center justify-between p-3 dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                   >
                     <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Calendario</span>
                     <CalendarIcon size={14} className="dark:text-text-secondary text-text-secondary-light group-hover:text-turquesa" />
                   </button>
 
                   <div className="h-px dark:bg-border-main/50 bg-border-main-light/50 my-1" />
 
                   <button 
                     onClick={() => { onChange(''); setShow(false); }} 
                     className="w-full flex items-center justify-center gap-2 p-3 bg-rosa/5 rounded-xl border border-rosa/20 text-rosa hover:bg-rosa/10 transition-all"
                   >
                     <Trash2 size={12} />
                     <span className="text-[10px] font-black uppercase tracking-widest">Quitar Fecha</span>
                   </button>
                 </div>
               ) : (
                 <div className="space-y-4">
                   <div className="flex items-center justify-between px-1">
                     <button 
                       onClick={() => setShowFullCalendar(false)}
                       className="text-[10px] font-black text-turquesa uppercase tracking-widest hover:underline flex items-center gap-1"
                     >
                       <ChevronLeft size={12} /> Volver
                     </button>
                     <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Mensual</span>
                   </div>
                   <MonthDatePicker 
                     value={value}
                     onChange={(d) => {
                       onChange(d);
                       setShow(false);
                       setShowFullCalendar(false);
                     }}
                   />
                 </div>
               )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
function RecurrencePickerChip({ value, onChange }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  const frequencies = [
    { id: 'daily', label: 'Diaria' },
    { id: 'weekdays', label: 'L-V' },
    { id: 'weekly', label: 'Semanal' },
    { id: 'monthly', label: 'Mensual' },
    { id: 'yearly', label: 'Anual' },
  ];

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({
        top: rect.bottom + 8,
        left: rect.left,
        maxHeight: spaceBelow
      });
    }
    setShow(!show);
  };
 
  const getLabel = () => {
    if (!value) return null;
    const { frequency, startDate, weekDays } = value;
    switch (frequency) {
      case 'daily': return 'Diaria';
      case 'weekdays': return 'L-V';
      case 'weekly': {
        const daysShort = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        if (!weekDays || weekDays.length === 0) {
          const dStr = startDate || formatLocalISO(new Date());
          const d = parseLocalISO(dStr);
          const specDay = (d.getDay() + 6) % 7; // 0=Lunes...6=Domingo
          return `Sem - ${daysShort[specDay]}`;
        }
        return `Sem - ${weekDays.map((d: number) => daysShort[d]).join(',')}`;
      }
      case 'monthly': {
        const dayNum = value.monthDay || parseLocalISO(value.startDate || formatLocalISO(new Date())).getDate();
        return `Mensual - Día ${dayNum}`;
      }
      default: return frequency;
    }
  };
 
  const handleDayToggle = (day: number) => {
    const current = value?.weekDays || [];
    const next = current.includes(day) 
      ? current.filter((d: number) => d !== day)
      : [...current, day];
    onChange({ ...(value || { frequency: 'weekly', startDate: formatLocalISO(new Date()) }), weekDays: next });
  };
 
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleOpen}
        className={`flex items-center justify-center transition-all group/rec h-6 rounded-lg ${
          value 
            ? 'px-2 py-0.5 bg-azul/10 border-2 border-azul text-azul hover:bg-azul/20 whitespace-nowrap shadow-sm' 
            : 'w-6 dark:bg-bg-main bg-white dark:border-border-main border-gray-300 dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul border-2'
        }`}
        title={value ? "Cambiar Recurrencia" : "Activar Recurrencia"}
      >
        <RefreshCw size={10} className={value ? "" : "opacity-50"} />
        {value && (
          <span className="text-[9px] font-black uppercase tracking-widest ml-1.5">
            {getLabel()}
          </span>
        )}
      </button>
 
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: -10 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-3 z-[220] min-w-[240px] space-y-3 overflow-y-auto"
              style={{
                top: `${modalPos.top}px`,
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                {frequencies.map(f => (
                  <button
                    key={f.id}
                    onClick={() => {
                      const today = new Date();
                      const baseRec = value || { frequency: f.id, startDate: formatLocalISO(today) };
                      const updates: any = { frequency: f.id };
                      if (f.id === 'weekly' && (!baseRec.weekDays || baseRec.weekDays.length === 0)) {
                        updates.weekDays = [(today.getDay() + 6) % 7];
                      }
                      if (f.id === 'monthly' && !baseRec.monthDay) {
                        updates.monthDay = today.getDate();
                      }
                      onChange({ ...baseRec, ...updates });
                    }}
                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all text-center ${
                      value?.frequency === f.id 
                        ? 'bg-azul text-white' 
                        : 'dark:text-text-secondary text-text-secondary-light dark:bg-white/5 bg-bg-main-light/50 dark:hover:text-white hover:text-text-main-light'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
 
              {value?.frequency === 'weekly' && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light">
                  <p className="text-[8px] font-black text-morado uppercase mb-2">Días de la semana:</p>
                  <div className="flex gap-1 justify-between">
                    {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => {
                      const dayNum = i;
                      const isSelected = (value.weekDays || []).includes(dayNum);
                      return (
                        <button
                          key={d}
                          onClick={() => handleDayToggle(dayNum)}
                          className={`w-7 h-7 rounded-lg text-[10px] font-black transition-all ${
                            isSelected 
                              ? 'bg-morado text-white' 
                              : 'dark:bg-bg-main bg-white dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light border dark:border-border-main border-border-main-light'
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
 
              {value?.frequency === 'monthly' && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light">
                  <p className="text-[8px] font-black text-morado uppercase mb-2">Día del mes (1-31):</p>
                  <input 
                    type="number"
                    min="1"
                    max="31"
                    className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-black text-morado outline-none text-center focus:ring-2 focus:ring-morado/20"
                    value={value.monthDay || parseLocalISO(value.startDate || formatLocalISO(new Date())).getDate()}
                    onChange={e => onChange({ ...value, monthDay: parseInt(e.target.value) || 1 })}
                  />
                </div>
              )}

              {value?.frequency === 'yearly' && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light space-y-2">
                  <p className="text-[8px] font-black text-morado uppercase mb-2">Día del año:</p>
                  <div className="flex gap-2 items-center">
                    <div className="flex-1">
                      <p className="text-[8px] dark:text-text-secondary text-text-secondary-light mb-1">Mes (1-12)</p>
                      <input 
                        type="number"
                        min="1"
                        max="12"
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-black text-morado outline-none text-center focus:ring-2 focus:ring-morado/20"
                        value={value.yearMonth || new Date().getMonth() + 1}
                        onChange={e => onChange({ ...value, yearMonth: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-[8px] dark:text-text-secondary text-text-secondary-light mb-1">Día (1-31)</p>
                      <input 
                        type="number"
                        min="1"
                        max="31"
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-black text-morado outline-none text-center focus:ring-2 focus:ring-morado/20"
                        value={value.yearDay || new Date().getDate()}
                        onChange={e => onChange({ ...value, yearDay: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                  </div>
                </div>
              )}
 
              {/* Sección Termina */}
              {value && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light space-y-2">
                  <p className="text-[8px] font-black text-azul uppercase mb-2">Termina:</p>
                  
                  {/* Nunca */}
                  <button
                    onClick={() => onChange({ ...value, endDate: null })}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      !value.endDate
                        ? 'bg-azul text-white'
                        : 'dark:bg-bg-main bg-white dark:text-text-secondary text-text-secondary-light border dark:border-border-main border-border-main-light'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                      !value.endDate ? 'border-white' : 'dark:border-border-main border-border-main-light'
                    }`}>
                      {!value.endDate && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    Nunca
                  </button>

                  {/* Fecha concreta - directamente el input */}
                  <div className="space-y-1">
                    <p className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light uppercase px-1">Fecha fin:</p>
                    <input
                      type="date"
                      value={value.endDate || ''}
                      onChange={e => onChange({ ...value, endDate: e.target.value || null })}
                      onClick={() => {
                        if (!value.endDate) {
                          const sixMonthsLater = new Date();
                          sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
                          onChange({ ...value, endDate: formatLocalISO(sixMonthsLater) });
                        }
                      }}
                      className={`w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[11px] font-black outline-none text-center transition-all ${
                        value.endDate 
                          ? 'text-azul focus:ring-2 focus:ring-azul/20' 
                          : 'dark:text-text-secondary/40 text-text-secondary-light/40'
                      }`}
                    />
                  </div>
                </div>
              )}

              <div className="h-px dark:bg-border-main bg-border-main-light" />
              <button
                onClick={() => {
                  onChange(value ? null : { frequency: 'daily', startDate: formatLocalISO(new Date()) });
                  if (value) setShow(false);
                }}
                className={`w-full text-center py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${value ? 'text-rosa border-rosa/20 hover:bg-rosa/10' : 'text-turquesa border-turquesa/20 hover:bg-turquesa/10'}`}
              >
                {value ? 'Quitar Recurrencia' : 'Activar Recurrencia'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
function TagPickerChip({ selectedTags = [], onChange }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tags: TagType[] = ['con_hora', 'focus', 'dirección', 'espera', 'resto'];

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    setShow(!show);
  };
 
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleOpen}
        className="flex items-center gap-1 cursor-pointer"
      >
        {selectedTags.length > 0 ? (
          <div className="flex -space-x-1.5 h-6 items-center">
            {selectedTags.map((t: any) => (
              <span key={t} className="w-5 h-5 rounded-md dark:bg-bg-card bg-white border-2 border-naranja flex items-center justify-center shadow-md ring-2 dark:ring-bg-main ring-white">
                <span className="text-[11px]">{TAG_LABELS[t].icon}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="w-6 h-6 rounded-lg dark:bg-bg-main bg-white border-2 dark:border-border-main/30 border-naranja/50 flex items-center justify-center opacity-40 hover:opacity-70 dark:hover:border-border-main hover:border-naranja transition-all" title="Sin categoría">
            <span className="text-[11px]">🏷️</span>
          </div>
        )}
      </button>
 
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div 
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[240px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
               <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3 pl-1">Categorías</p>
               <div className="grid grid-cols-5 gap-2">
                 {tags.map(t => {
                   const active = selectedTags.includes(t);
                   return (
                     <button
                       key={t}
                       onClick={() => {
                         const next = active ? [] : [t];
                         onChange(next);
                         setShow(false);
                       }}
                       className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-all border ${
                         active 
                           ? 'bg-turquesa border-turquesa shadow-lg shadow-turquesa/20 text-white' 
                           : 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa'
                       }`}
                       title={TAG_LABELS[t].label}
                     >
                       {TAG_LABELS[t].icon}
                     </button>
                   );
                 })}
               </div>
               {selectedTags.length > 0 && (
                 <button
                   onClick={() => { onChange([]); setShow(false); }}
                   className="w-full mt-2 flex items-center justify-center gap-2 p-2 bg-rosa/5 rounded-xl border border-rosa/20 text-rosa hover:bg-rosa/10 transition-all"
                 >
                   <X size={12} />
                   <span className="text-[9px] font-black uppercase tracking-widest">Sin etiqueta (Resto)</span>
                 </button>
               )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
function EstimatedTimeChip({ value, onChange, variant = 'default', readonly = false }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = formatMinutes(value);
  const isMini = variant === 'mini';

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!readonly && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    if (!readonly) setShow(!show);
  };
 
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleOpen}
        className={`${isMini ? 'h-6 px-1.5 py-0.5' : 'h-6 px-2 py-0.5'} rounded-lg bg-azul/10 border-2 border-azul/50 text-azul font-black uppercase tracking-widest transition-all flex items-center gap-1 shadow-sm ${readonly ? 'opacity-60 cursor-default' : 'hover:bg-azul/20'}`}
        title={readonly ? 'Suma de subtareas' : 'Editar tiempo estimado'}
      >
        <Clock size={9} />
        <span className="text-[11px]">{label}</span>
      </button>

      <AnimatePresence>
        {show && !readonly && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div 
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="fixed bg-bg-card border border-border-main rounded-2xl shadow-2xl p-5 z-[220] min-w-[280px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
               <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-4 pl-1">Tiempo Estimado (min)</p>
               <div className="flex gap-4 items-center mb-6">
                 <Zap size={20} className="text-azul" />
                 <input 
                  type="number"
                  className="w-full bg-bg-main p-4 rounded-2xl border border-border-main text-2xl font-black text-white outline-none focus:ring-4 focus:ring-azul/20 transition-all"
                  value={value}
                  onChange={(e) => onChange(parseInt(e.target.value) || 0)}
                 />
               </div>
               <div className="grid grid-cols-4 gap-2">
                 {[15, 30, 45, 60, 90, 120].map(v => (
                   <button 
                     key={v} 
                     onClick={() => { onChange(v); setShow(false); }}
                     className="p-2 bg-bg-main rounded-lg text-[10px] font-black text-white border border-border-main hover:border-azul transition-all"
                   >
                     {v}m
                   </button>
                 ))}
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
function RegisteredTimeChip({ value, estimated, onClick }: any) {
  const label = formatMinutes(value);
  let colorClass = "text-turquesa bg-turquesa/10 border-turquesa/50";
  if (value > estimated) colorClass = "text-rosa bg-rosa/10 border-rosa/50 animate-pulse";
  else if (value >= estimated * 0.9) colorClass = "text-naranja bg-naranja/10 border-naranja/50";
 
  return (
    <button 
      onClick={onClick}
      className={`h-6 px-2 py-0.5 rounded-lg font-black uppercase tracking-widest transition-all border-2 shadow-sm flex items-center gap-1 ${colorClass}`}
    >
      <Target size={9} />
      <span className="text-[11px]">{label}</span>
    </button>
  );
}
 
// --- Time Management Panel ---
 
function TimeManagementPanel({ taskId, subtaskId, allTasksMap, timeEntries, onAddEntry, onDeleteEntry, onUpdateEntry, onClose }: any) {
  const [activeTab, setActiveTab] = useState<'register' | 'history'>('register');
  const task = subtaskId ? allTasksMap[subtaskId] : allTasksMap[taskId];
  const parentTask = allTasksMap[taskId];
  const hasSubtasks = parentTask.subtasks && parentTask.subtasks.length > 0;
  
  const entries = useMemo(() => {
    return timeEntries.filter((e: TimeEntry) => {
      if (subtaskId) return e.subtaskId === subtaskId;
      if (e.taskId === taskId) return true;
      const isSubtaskEntry = (Object.values(allTasksMap) as Task[]).some(t => t.id === e.taskId && t.parentTaskId === taskId);
      return isSubtaskEntry;
    }).sort((a: any, b: any) => parseLocalISO(b.date).getTime() - parseLocalISO(a.date).getTime());
  }, [timeEntries, taskId, subtaskId, allTasksMap]);
 
  const totalRegistered = getTaskRegisteredSelf(subtaskId || taskId, timeEntries);
  const comboRegistered = subtaskId ? totalRegistered : getTaskRegisteredCombo(taskId, allTasksMap, timeEntries);
  const estimated = subtaskId ? task.estimatedMinutes : getTaskEstimatedCombo(taskId, allTasksMap);
 
  const [newMinutes, setNewMinutes] = useState(30);
  const [newDate, setNewDate] = useState(formatLocalISO(new Date()));
  const [newNote, setNewNote] = useState('');
  
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState(0);
  const [editNote, setEditNote] = useState('');
 
  const startEdit = (entry: any) => {
    setEditingEntryId(entry.id);
    setEditMinutes(entry.duration);
    setEditNote(entry.note || '');
  };
 
  const saveEdit = () => {
    if (editingEntryId) {
      onUpdateEntry(editingEntryId, {
        duration: editMinutes,
        note: editNote
      });
      setEditingEntryId(null);
    }
  };
 
  return (
    <div className="fixed inset-0 dark:bg-bg-main/80 bg-white/80 backdrop-blur-md z-[300] flex items-end justify-center">
      <motion.div 
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="w-full max-w-xl dark:bg-bg-main bg-white border-t border-x dark:border-border-main border-border-main-light rounded-t-[40px] p-4 shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-black dark:text-white text-text-main-light uppercase tracking-tighter">
              {task?.title || 'Gestionar Tiempo'}
            </h2>
            <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em]">Panel de Control de Horas</p>
          </div>
          <button onClick={onClose} className="p-2 dark:bg-bg-card bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl dark:hover:bg-bg-main hover:bg-gray-200 transition-all">
            <X size={18} className="dark:text-text-secondary text-text-secondary-light" />
          </button>
        </div>
 
        {/* Tab Navigation */}
        <div className="flex p-1 dark:bg-bg-card bg-gray-100 border dark:border-border-main border-border-main-light rounded-2xl mb-4">
          <button 
            onClick={() => setActiveTab('register')}
            className={`flex-1 py-2 px-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeTab === 'register' ? 'bg-turquesa text-white' : 'dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'}`}
          >
            <Plus size={14} /> Registro
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2 px-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeTab === 'history' ? 'bg-turquesa text-white' : 'dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'}`}
          >
            <History size={14} /> Historial
          </button>
        </div>
 
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'register' ? (
            <div className="space-y-4 overflow-y-auto custom-scrollbar px-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-[24px] relative overflow-hidden group">
                  <div className="absolute top-3 right-3 opacity-20"><Zap size={18} className="text-turquesa" /></div>
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-1">Total Registrado</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-turquesa">{comboRegistered}</span>
                    <span className="text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase">min</span>
                  </div>
                  {!subtaskId && hasSubtasks && (
                    <p className="text-[8px] font-bold dark:text-text-secondary text-text-secondary-light mt-1">Propio: {totalRegistered}m · Subtareas: {comboRegistered - totalRegistered}m</p>
                  )}
                </div>
 
                <div className="p-4 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-[24px]">
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3 text-center">Plan v Realidad</p>
                  <div className="flex items-center justify-center gap-4 mb-3">
                    <span className="text-lg font-black dark:text-text-secondary text-text-secondary-light">{estimated}m</span>
                    <ArrowRight size={16} className="dark:text-text-secondary/30 text-text-secondary-light/30" />
                    <span className="text-lg font-black dark:text-white text-text-main-light">{comboRegistered}m</span>
                  </div>
                  <div className="h-1.5 dark:bg-bg-main bg-gray-200 border dark:border-border-main border-border-main-light rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${comboRegistered > estimated ? 'bg-rosa' : 'bg-turquesa'}`}
                      style={{ width: `${Math.min(100, (comboRegistered / Math.max(1, estimated)) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
 
              <div className="p-4 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-[24px] space-y-4">
                <div className="space-y-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest ml-1">¿Qué hiciste en esta sesión?</label>
                    <textarea 
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Describe brevemente tu progreso..."
                      className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl p-3 text-sm font-medium dark:text-white text-text-main-light placeholder:text-text-secondary/30 outline-none focus:border-turquesa/50 transition-all resize-none h-20"
                    />
                  </div>
 
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest ml-1">Minutos</label>
                      <input 
                        type="number"
                        value={newMinutes}
                        onChange={(e) => setNewMinutes(parseInt(e.target.value) || 0)}
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl p-3 text-xl font-black text-turquesa outline-none focus:border-turquesa/50 transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest ml-1">Fecha</label>
                      <input 
                        type="date"
                        value={newDate}
                        onChange={(e) => setNewDate(e.target.value)}
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl p-3 text-xs font-black dark:text-white text-text-main-light outline-none focus:border-turquesa/50 transition-all uppercase"
                      />
                    </div>
                  </div>
                </div>
 
                <button 
                  onClick={() => {
                    onAddEntry(taskId, subtaskId, newMinutes, newDate, newNote);
                    setNewNote('');
                    // Removed setActiveTab('history') as per user request
                  }}
                  className="w-full py-3 bg-turquesa hover:bg-turquesa/90 text-bg-main font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-turquesa/20 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  <Plus size={20} strokeWidth={3} />
                  Registrar Tiempo
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-2 mb-6">
                 <div>
                   <h3 className="text-xs font-black dark:text-white text-text-main-light uppercase tracking-widest">Listado de Sesiones</h3>
                   <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase mt-1">Total acumulado: {comboRegistered}m</p>
                 </div>
                 <div className="text-right">
                    <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Ejecutado</span>
                    <p className="text-lg font-black text-turquesa">{comboRegistered}m</p>
                 </div>
              </div>
 
              <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar px-2 mb-4">
                {entries.length === 0 && (
                  <div className="py-20 text-center opacity-20">
                    <Clock size={48} className="mx-auto mb-4" />
                    <p className="font-bold uppercase tracking-widest text-xs">Sin registros aún</p>
                  </div>
                )}
                {entries.map((entry: any) => {
                  const isEditing = editingEntryId === entry.id;
                  const isForeignEntry = entry.taskId !== (subtaskId || taskId);
                  
                  // Formato de fecha dd-mm-yyyy
                  const displayDate = entry.date.split('-').reverse().join('-');
 
                  return (
                    <div key={entry.id} className="flex items-center justify-between p-4 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl group transition-all hover:border-turquesa/50">
                      <div className="flex items-center gap-4 flex-1">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 bg-turquesa/10 text-turquesa`}>
                           {entry.source === 'timer' ? <Clock size={20} /> : <Zap size={20} />}
                        </div>
                        <div className="flex-1">
                          {isEditing ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <input 
                                  type="number" 
                                  value={editMinutes} 
                                  onChange={(e) => setEditMinutes(parseInt(e.target.value) || 0)}
                                  className="w-16 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-md p-1 text-xs font-bold dark:text-white text-text-main-light outline-none focus:border-turquesa"
                                />
                                <span className="text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase">min</span>
                              </div>
                              <input 
                                type="text" 
                                value={editNote} 
                                onChange={(e) => setEditNote(e.target.value)}
                                className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-md p-1 text-xs font-medium dark:text-white text-text-main-light outline-none focus:border-turquesa"
                                placeholder="Nota..."
                              />
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 mb-1">
                                 <span className="text-sm font-black dark:text-white text-text-main-light">{entry.duration}m</span>
                                 <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">{displayDate}</span>
                                  {isForeignEntry && (
                                    <span className="text-[8px] font-black dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light px-1.5 py-0.5 rounded-md dark:text-text-secondary text-text-secondary-light uppercase tracking-tighter truncate max-w-[100px]">
                                      {allTasksMap[entry.taskId]?.title || 'Subtarea'}
                                    </span>
                                  )}
                              </div>
                              {entry.note ? (
                                <p className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light italic">"{entry.note}"</p>
                              ) : (
                                <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light/30 uppercase tracking-widest">Sin nota</p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 ml-4">
                        {isEditing ? (
                          <>
                            <button 
                              onClick={saveEdit}
                              className="p-2.5 text-turquesa hover:bg-turquesa/10 dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light transition-all"
                              title="Guardar"
                            >
                              <Check size={14} />
                            </button>
                            <button 
                              onClick={() => setEditingEntryId(null)}
                              className="p-2.5 dark:text-text-secondary text-text-secondary-light hover:text-white dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light transition-all"
                              title="Cancelar"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button 
                              onClick={() => startEdit(entry)}
                              className="p-2.5 dark:text-text-secondary text-text-secondary-light hover:text-white dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light transition-all"
                              title="Editar registro"
                            >
                              <Edit size={14} />
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteEntry(entry.id);
                              }}
                              className="p-2.5 dark:text-text-secondary text-text-secondary-light hover:text-rosa dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light transition-all"
                              title="Eliminar registro"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
 
function MonthDatePicker({ value, onChange }: { value: string | null, onChange: (d: string | null) => void }) {
  const [viewDate, setViewDate] = useState(() => parseLocalISO(value || formatLocalISO(new Date())));
  
  const daysInMonth = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const days = [];
    
    // Previous month days to align Monday
    const startDay = firstDay.getDay(); 
    const prevDaysCount = startDay === 0 ? 6 : startDay - 1;
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    
    for (let i = prevDaysCount - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthLastDay - i),
        isCurrentMonth: false
      });
    }
    
    // Current month days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true
      });
    }
    
    // Next month days to fill grid (6 weeks)
    const totalDays = 42; 
    const nextDaysCount = totalDays - days.length;
    for (let i = 1; i <= nextDaysCount; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false
      });
    }
    
    return days.map(d => {
      const dStr = formatLocalISO(d.date);
      return {
        ...d,
        str: dStr,
        isSelected: value === dStr,
        isToday: formatLocalISO(new Date()) === dStr,
        dayNum: d.date.getDate()
      };
    });
  }, [viewDate, value]);
 
  const weekHeaders = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
 
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
         <button onClick={() => setViewDate(prev => { 
           const n = new Date(prev); n.setMonth(n.getMonth() - 1); return n; 
         })} className="p-2 hover:bg-white/5 rounded-xl text-turquesa transition-all"><ChevronLeft size={20}/></button>
         <span className="text-[12px] font-black uppercase tracking-[0.2em] text-white">
           {viewDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}
         </span>
         <button onClick={() => setViewDate(prev => { 
           const n = new Date(prev); n.setMonth(n.getMonth() + 1); return n; 
         })} className="p-2 hover:bg-white/5 rounded-xl text-turquesa transition-all"><ChevronRight size={20}/></button>
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {weekHeaders.map(h => (
          <div key={h} className="text-[9px] font-black text-text-secondary text-center py-2 uppercase tracking-widest">{h}</div>
        ))}
        {daysInMonth.map((d, i) => (
          <button
            key={`${d.str}-${i}`}
            onClick={() => onChange(d.str)}
            className={`flex flex-col items-center justify-center h-10 rounded-xl transition-all border text-xs font-bold ${
              d.isSelected 
                ? 'bg-turquesa border-turquesa text-white shadow-lg shadow-turquesa/20 z-10' 
                : d.isCurrentMonth
                  ? 'bg-bg-card border-border-main text-white hover:border-turquesa/50'
                  : 'bg-transparent border-transparent text-text-secondary/30 hover:text-text-secondary'
            }`}
          >
            {d.dayNum}
            {d.isToday && !d.isSelected && <div className="absolute top-1 right-1 w-1 h-1 rounded-full bg-turquesa" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// DELEGATION CHIP
// ============================================================
// --- Block Picker Chip ---

function BlockPickerChip({ value, blocks = [], onChange }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0, maxHeight: 500 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedBlock = blocks.find((b: any) => b.id === value);

  const toggleShow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ 
        top: rect.bottom + 8, 
        left: rect.left,
        maxHeight: spaceBelow > 400 ? spaceBelow : 400
      });
    }
    setShow(!show);
  };

  const handleSelect = (blockId: string) => {
    onChange(blockId);
    setShow(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={toggleShow}
        className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full border tracking-tighter whitespace-nowrap shadow-sm dark:bg-bg-main bg-white dark:border-border-main border-border-main-light flex items-center gap-1.5 shrink-0 hover:shadow-md transition-all"
        style={{ color: selectedBlock?.color || '#64748b' }}
        title="Cambiar contexto"
      >
        <span>{selectedBlock?.icon || '📁'}</span>
        {selectedBlock?.name && <span>{selectedBlock.name}</span>}
        <ChevronDown size={10} />
      </button>

      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: -10 }}
              onClick={e => e.stopPropagation()}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[240px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight}px`
              }}
            >
              <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Cambiar Contexto</p>
              <div className="space-y-1">
                {blocks.filter((b: any) => b.isActive).map((block: any) => (
                  <button
                    key={block.id}
                    onClick={() => handleSelect(block.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-all ${
                      value === block.id
                        ? 'bg-turquesa text-white'
                        : 'dark:hover:bg-bg-main hover:bg-gray-100 dark:text-white text-text-main-light'
                    }`}
                  >
                    <div 
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ backgroundColor: `${block.color}20`, color: block.color }}
                    >
                      {block.icon}
                    </div>
                    {block.name}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Delegation Chip ---

function DelegationChip({ delegation, people = [], onChange, onAddPerson, onRenamePerson, onDeletePerson, onOpen = null, onClose = null, allTasksMap = {} }: any) {
  const [show, setShow] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const person = delegation ? people.find((p: any) => p.id === delegation.personId) : null;

  const toggleShow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20; // 20px margin
      setModalPos({ 
        top: rect.bottom + 8, 
        left: rect.left,
        maxHeight: spaceBelow
      });
    }
    const next = !show;
    setShow(next);
    if (next) { onOpen && onOpen(); } else { onClose && onClose(); }
  };

  const handleSelect = (personId: string) => {
    onChange({ personId, delegatedAt: formatLocalISO(new Date()) });
    setShow(false);
    onClose && onClose();
  };

  const handleRemove = () => {
    onChange(undefined);
    setShow(false);
    onClose && onClose();
  };

  const handleAddPerson = () => {
    if (!newName.trim()) return;
    const newPerson: any = { id: `p-${Date.now()}`, name: newName.trim(), createdAt: new Date().toISOString() };
    if (onAddPerson) onAddPerson(newPerson);
    setNewName('');
    onChange({ personId: newPerson.id, delegatedAt: formatLocalISO(new Date()) });
    setShow(false);
    onClose && onClose();
  };

  const handleStartEdit = (p: any) => {
    setEditingId(p.id);
    setEditingName(p.name);
  };

  const handleSaveEdit = () => {
    if (editingName.trim() && onRenamePerson) onRenamePerson(editingId, editingName.trim());
    setEditingId(null);
    setEditingName('');
  };

  const handleDeletePerson = (personId: string) => {
    const tasksAssigned = Object.values(allTasksMap).filter((t: any) =>
      t && !t.isDeleted && t.delegation?.personId === personId
    );
    if (tasksAssigned.length > 0) {
      alert(`Esta persona tiene ${tasksAssigned.length} tarea${tasksAssigned.length > 1 ? 's' : ''} asignada${tasksAssigned.length > 1 ? 's' : ''}. Reasígnalas primero antes de eliminarla.`);
      return;
    }
    if (confirm('¿Eliminar esta persona del equipo?')) {
      if (delegation?.personId === personId) onChange(undefined);
      if (onDeletePerson) onDeletePerson(personId);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={toggleShow}
        className={`h-6 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border-2 transition-all flex items-center gap-1 ${
          person
            ? 'bg-morado/10 border-morado text-morado shadow-sm'
            : 'dark:bg-bg-main bg-white dark:border-border-main/30 border-morado/50 dark:text-text-secondary/40 text-text-secondary-light/40 dark:hover:text-text-secondary hover:text-text-secondary-light dark:hover:border-border-main hover:border-morado transition-all'
        }`}
        title={person ? `Delegado a ${person.name}` : 'Delegar tarea'}
      >
        <User size={10} />
        {person && <span>{person.name}</span>}
      </button>

      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => { setShow(false); onClose && onClose(); }} />
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              onClick={e => e.stopPropagation()}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[220px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
              <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Delegar a</p>
              <div className="space-y-1 mb-3">
                {people.length === 0 && (
                  <p className="text-[10px] dark:text-text-secondary/50 text-text-secondary-light/50 text-center py-2">Sin personas en el equipo</p>
                )}
                {people.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-1 group/dp">
                    {editingId === p.id ? (
                      <div className="flex-1 flex items-center gap-1">
                        <input
                          type="text"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') { setEditingId(null); setEditingName(''); } }}
                          onClick={e => e.stopPropagation()}
                          onFocus={e => e.stopPropagation()}
                          autoFocus
                          className="flex-1 dark:bg-bg-main bg-white border border-turquesa rounded-lg px-2 py-1.5 text-[11px] dark:text-white text-text-main-light outline-none"
                        />
                        <button onClick={handleSaveEdit} className="w-6 h-6 flex items-center justify-center text-turquesa hover:bg-turquesa/10 rounded-lg transition-all" title="Guardar">
                          <Check size={12} />
                        </button>
                        <button onClick={() => { setEditingId(null); setEditingName(''); }} className="w-6 h-6 flex items-center justify-center text-rosa hover:bg-rosa/10 rounded-lg transition-all" title="Cancelar">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleSelect(p.id)}
                          className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-all ${
                            delegation?.personId === p.id
                              ? 'bg-morado text-white'
                              : 'dark:hover:bg-bg-main hover:bg-gray-100 dark:text-white text-text-main-light'
                          }`}
                        >
                          <div className="w-6 h-6 rounded-lg bg-morado/20 flex items-center justify-center text-morado text-[10px] font-black shrink-0">
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                          {p.name}
                        </button>
                        {onRenamePerson && (
                          <button
                            onClick={e => { e.stopPropagation(); handleStartEdit(p); }}
                            className="w-6 h-6 flex items-center justify-center text-turquesa/40 hover:text-turquesa hover:bg-turquesa/10 rounded-lg transition-all opacity-0 group-hover/dp:opacity-100"
                            title="Editar"
                          >
                            <Edit size={10} />
                          </button>
                        )}
                        {onDeletePerson && (
                          <button
                            onClick={e => { e.stopPropagation(); handleDeletePerson(p.id); }}
                            className="w-6 h-6 flex items-center justify-center text-rosa/40 hover:text-rosa hover:bg-rosa/10 rounded-lg transition-all opacity-0 group-hover/dp:opacity-100"
                            title="Eliminar"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="h-px dark:bg-border-main/50 bg-border-main-light/50 mb-3" />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onFocus={e => e.stopPropagation()}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleAddPerson(); }}
                  placeholder="Nueva persona..."
                  className="flex-1 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[11px] dark:text-white text-text-main-light dark:placeholder:text-text-secondary/40 placeholder:text-text-secondary-light/40 outline-none focus:border-morado/50"
                />
                <button
                  onClick={handleAddPerson}
                  className="w-8 h-8 flex items-center justify-center bg-morado/10 hover:bg-morado/20 border border-morado/30 text-morado rounded-xl transition-all"
                >
                  <Plus size={14} />
                </button>
              </div>
              {delegation && (
                <>
                  <div className="h-px dark:bg-border-main/50 bg-border-main-light/50 my-3" />
                  <button
                    onClick={handleRemove}
                    className="w-full flex items-center justify-center gap-2 p-2 bg-rosa/5 rounded-xl border border-rosa/20 text-rosa hover:bg-rosa/10 transition-all"
                  >
                    <X size={12} />
                    <span className="text-[9px] font-black uppercase tracking-widest">Quitar delegación</span>
                  </button>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// DELEGADAS VIEW
// ============================================================
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
                                                onChange={(rec: any) => onUpdateTask({ 
                                                  ...sub, 
                                                  recurrence: rec || undefined,
                                                  isTemplate: !!rec,
                                                  dueDate: rec ? null : (sub.dueDate || formatLocalISO(new Date())),
                                                  dueTime: sub.dueTime // ✅ Preservar hora concreta
                                                })}
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
                                  {tag && <span className="text-[8px] font-black text-text-secondary">{TAG_LABELS[tag as TagType]?.icon} {TAG_LABELS[tag as TagType]?.label}</span>}
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
