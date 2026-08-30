/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LayoutDashboard, Grid2X2, Calendar as CalendarIcon, CalendarDays,
  Search, Users, Zap, Moon, Sun, ChevronRight, BarChart2, Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { WorkBlock, Task, ViewType, TagType, TimeEntry, Person, DelegationMeeting } from './types';
import { COLORS } from './constants';
import { supabase } from './supabaseClient';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { filterTasksForDay, getEntradaForDay, getDayLoad } from './filters';
import { materializeInstanceById, occursOn } from './instanceEngine';
import { reconcileDay, containerDayToggle } from './fase3Contracts'; // C3: mapa del día sin fuga; §16.28: nº hijas pendientes del día para el modal de papelera
import { getTaskRegisteredSelf } from './utils'; // A2: detectar "hija con tiempo registrado" ESE DÍA (guarda de intacta). Self, no Combo: Combo exige la tarea en el mapa y una instancia hija es virtual → devolvía 0.
import { toast } from './toast'; // A2: avisar cuando "quitar el día" no quita nada (todas con trabajo)
import { useSupabase } from './useSupabase';
import { useTaskCRUD, collectDeletableTasks } from './useTaskCRUD';
import { useTaskOrdering } from './useTaskOrdering';
import { useBlockHandlers } from './useBlockHandlers';
import { useTimerHandlers } from './useTimerHandlers';
import { DiagPanel } from './DiagPanel'; // DIAG-TEMP (sesión 15): quitar con el revert del commit de diagnóstico
import { ToastContainer } from './ToastContainer'; // Avisos (B1): pila de toasts, se suscribe al bus toast.ts
import { persist, reportPersistError } from './persist'; // Avisos (B1): escrituras que fallan avisan
import { useBulkActions } from './useBulkActions';
import { BlocksManagerView } from './BlocksView';
import { DashboardView } from './DashboardView';
import { CalendarView } from './CalendarView';
import { DelegadasView } from './DelegadasView';
import { SearchView } from './SearchView';
import { WorkloadView } from './WorkloadView';
import { PapeleraView } from './PapeleraView';
import { useDeletedTasks } from './useDeletedTasks';
import { WeekView } from './WeekView';
import { TaskModal } from './TaskModal';
import { StickyActionBar } from './StickyActionBar';
import {
  BlockModal, TimeManagementPanel, RecurrenceChoiceModal,
  TimerDisplay, InstancesModal
} from './components';


export default function App() {
  // --- Core State ---
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('workmanager-theme');
    return saved !== 'light';
  });
  const [blocks, setBlocks] = useState<WorkBlock[]>([]);
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const todayLocal = formatLocalISO(new Date());
  const [activeDate, setActiveDate] = useState(todayLocal);
  const [composerOpenSignal, setComposerOpenSignal] = useState(0); // 1a: el "+ Tarea" global abre el compositor de Mi Día

  // --- UI State ---
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [openModalWithTime, setOpenModalWithTime] = useState(false);
  const [modalInstanceDate, setModalInstanceDate] = useState<string | null>(null);
  const [inlineEditingTaskId, setInlineEditingTaskId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  // `plain:true` (§16.31, sesión 24): contenedor MANUAL (no recurrente) → mismo modal en modo borrado-directo
  // (banda-inventario + "No se puede deshacer desde la app.", sin opción "este día / serie").
  const [recurrenceAction, setRecurrenceAction] = useState<{ taskId: string; type: 'edit' | 'delete'; ruleId: string; plain?: boolean } | null>(null);
  // F5-7(a) (sesión 24): selector de bloque cuando se crea SIN bloque (Calendario/Semana/Delegadas). Guarda los params
  // de la creación pendiente; al elegir bloque se re-llama a handleAddTask con él. Sustituye al default silencioso a CM11.
  const [blockChoice, setBlockChoice] = useState<{ parentTaskId: string | null; overrideDate?: string; defaultPersonId?: string; initialTitle?: string } | null>(null);
  const [instancesModalTask, setInstancesModalTask] = useState<Task | null>(null);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const [pendingDateChange, setPendingDateChange] = useState<{ task: any; newDate: string } | null>(null);
  const [addSubtaskWarning, setAddSubtaskWarning] = useState<{ parentTaskId: string; blockId?: string; overrideDate?: string } | null>(null);

  // --- Timer & Time State ---
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<{
    entityId: string;
    parentTaskId: string;
    subtaskId: string | null;
    startTime: string;
    accumulatedSeconds: number;
    title: string;
  } | null>(null);
  const [showTimePanel, setShowTimePanel] = useState<{ taskId: string; subtaskId: string | null } | null>(null);
  const [timerStopModal, setTimerStopModal] = useState<{ minutes: number; pendingEntry: any } | null>(null);

  // --- People & Meetings ---
  const [people, setPeople] = useState<Person[]>([]);
  const [meetings, setMeetings] = useState<DelegationMeeting[]>([]);

  // --- Selection State ---
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkDelegateModal, setBulkDelegateModal] = useState(false);
  const [bulkDateModal, setBulkDateModal] = useState(false);
  const [bulkTimeModal, setBulkTimeModal] = useState(false);

  // --- StickyActionBar view states (lifted from views) ---
  const [dashHideCompleted, setDashHideCompleted] = useState(true);
  const [dashExpandAll, setDashExpandAll] = useState<boolean | null>(null);
  const [dashExpandedBlocks, setDashExpandedBlocks] = useState<Set<string>>(
    new Set(['con_hora', 'focus', 'dirección', 'espera', 'resto'])
  );
  const [delegadasHideCompleted, setDelegadasHideCompleted] = useState(false);
  const [blocksExpanded, setBlocksExpanded] = useState(false);
  const blocksToggleExpandRef = React.useRef<(() => void) | null>(null);

  // Reset selection on view change
  useEffect(() => {
    setSelectionMode(false);
    setSelectedTaskIds(new Set());
  }, [currentView]);

  // Theme effect
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (isDarkMode) {
      root.classList.remove('light'); root.classList.add('dark');
      body.classList.remove('light'); body.classList.add('dark');
    } else {
      root.classList.remove('dark'); root.classList.add('light');
      body.classList.remove('dark'); body.classList.add('light');
    }
    localStorage.setItem('workmanager-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Selection helpers
  const toggleSelectionMode = () => {
    setSelectionMode(prev => {
      if (prev) setSelectedTaskIds(new Set());
      return !prev;
    });
  };

  // C1 (bug #20): la auto-selección de hijas usa las `subtasks` del OBJETO RENDERIZADO (materializado)
  // que `TaskCard` ya tiene, NO `tasks[taskId]` (crudo). Un contenedor recurrente VIRGEN no está en
  // `tasks` (fuera de ventana de `useGeneration` / post-flip) → `tasks[taskId]` undefined → antes no
  // marcaba NINGUNA hija. Las `renderedSubtaskIds` (materializadas) ya vienen filtradas (visibles del
  // día, sin borradas). SOLO estado de selección (UI), sin escritura.
  const toggleTaskSelection = useCallback((taskId: string, renderedSubtaskIds: string[] = []) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      const subs = renderedSubtaskIds.length ? renderedSubtaskIds : (tasks[taskId]?.subtasks || []);
      if (next.has(taskId)) {
        next.delete(taskId);
        subs.forEach(subId => next.delete(subId));
      } else {
        next.add(taskId);
        // Cosmético (sesión 26): al marcar un contenedor NO se marcan sus hijas COMPLETADAS — el bulk nunca las borra
        // (bulkEffectiveIds las excluye), así que marcarlas era "mentira en pantalla" (se veían seleccionadas y no se iban).
        // Una completada está persistida (status en `tasks`); una virgen/pendiente no está o no es 'completed' → se marca.
        subs.forEach(subId => { if (tasks[subId]?.status === 'completed') return; next.add(subId); });
      }
      return next;
    });
  }, [tasks]);

  // F6-x2 (§16.33): selección con DOS ALCANCES (por etiqueta / global del día). Toggle en LOTE: si TODOS los ids ya están
  // seleccionados → deseleccionar; si no → seleccionar todos. El alcance (qué ids) lo calcula DashboardView (grupo o día).
  // Criterio = el DÍA, no la visibilidad (los ids incluyen hijas de contenedores contraídos). Nunca sale del día.
  const selectScope = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      const allSelected = ids.every(id => next.has(id));
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }, []);

  // PAPELERA (§16.47): tareas borradas de los últimos 30 días (desde el lanzamiento). Restaurar = elegir destino.
  const { deleted: deletedTasks, loading: papeleraLoading, reload: reloadPapelera } = useDeletedTasks();
  const isContainerAlive = (parentId: string) => !!tasks[parentId] && !tasks[parentId]?.isDeleted;
  const handleRestore = async (task: any, destino: string) => {
    const today = formatLocalISO(new Date());
    const newDate = destino === 'hoy' ? today : destino === 'original' ? (task.dueDate || task.instanceDate || today) : destino;
    const parentGone = !!task.parentTaskId && !isContainerAlive(task.parentTaskId); // subtarea sin contenedor → tarea suelta
    const patch: any = { is_deleted: false, deleted_at: null, due_date: newDate, modified_at: new Date().toISOString() };
    if (parentGone) patch.parent_task_id = null;
    const { error } = await supabase.from('tasks').update(patch).eq('id', task.id);
    if (error) { reportPersistError({ verbo: 'restaurar', titulo: task.title }); return; }
    // reflejar en el estado para que aparezca ya en su día
    setTasks(prev => ({ ...prev, [task.id]: { ...(prev[task.id] || {}), ...task, isDeleted: false, deletedAt: null, dueDate: newDate, parentTaskId: parentGone ? null : task.parentTaskId, existsInSupabase: true } as any }));
    reloadPapelera();
  };

  // --- Data Loading ---
  useSupabase({ setBlocks, setTasks, setPeople, setMeetings, setTimeEntries, setIsDataLoaded });

  // --- Computed dashboard tasks (needed by useTaskCRUD) ---
  const allActiveTasks = useMemo(() =>
    Object.values(tasks).filter((t: Task) => !t.isDeleted && !t.isTemplate), [tasks]);

  // Motor V20 (LECTURA): mapa del día activo = instancias materializadas al vuelo + estado, con el
  // ESTADO GANANDO (excepciones persistidas: completadas/movidas/borradas). `materializeDay` genera
  // las ocurrencias recurrentes del día (ya no hay `useGeneration` que las pre-fabrique en el estado).
  // C3 (sesión 18): mapa del día SIN FUGA. Antes overlayaba TODO `tasks` ("estado gana" leaky); ahora
  // `reconcileDay` conserva solo lo del día + contenedores (sin fecha) + plantillas (que filterTasksForDay
  // busca por templateId), y descarta las hojas datadas de otro día. El listado ya filtraba por día, así
  // que no debería desaparecer nada visible; validado en pantalla.
  const activeDayMap = useMemo(() => reconcileDay(activeDate, tasks), [tasks, activeDate]);

  const dashboardTasks = useMemo(() => {
    const activeBlockIds = new Set(blocks.filter(b => b && b.isActive).map(b => b.id));
    const candidates = Object.values(activeDayMap).filter((t: any) => t && !t.isDeleted && !t.isTemplate) as Task[];
    return filterTasksForDay(candidates, activeDayMap, activeBlockIds, activeDate, { hideCompleted: false, hideDelegatedNoTag: true });
  }, [activeDayMap, blocks, activeDate]);

  const dashboardTasksMap = useMemo(() => {
    const map: any = { ...activeDayMap };
    dashboardTasks.forEach(t => {
      map[t.id] = t;
      if (t.subtasks?.length > 0) {
        t.subtasks.forEach(subId => {
          const sub = tasks[subId];
          if (sub && sub.dueDate === activeDate) {
            if (sub.delegation) {
              const hasRealTag = (sub.tags || []).some((tag: string) => tag !== 'resto');
              if (!hasRealTag) return;
            }
            map[subId] = sub;
          }
        });
      }
      // También incluir subtareas manuales del template con dueDate===activeDate
      // (nuevas subtareas creadas desde el Dashboard que no son instancias recurrentes)
      const templateId = t.templateId || (t.id.startsWith('inst-') ? t.id.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '') : t.id);
      if (templateId && tasks[templateId]?.subtasks) {
        tasks[templateId].subtasks?.forEach((subId: string) => {
          const sub = tasks[subId];
          if (sub && !sub.isDeleted && sub.dueDate === activeDate && !sub.templateId && !subId.startsWith('inst-')) {
            map[subId] = sub;
          }
        });
      }
    });
    return map;
  }, [activeDayMap, tasks, dashboardTasks, activeDate]);

  // TRAMO 2 (entrada del día): qué se CREÓ el día visto. Necesita el mapa COMPLETO `tasks` (no el day-scoped),
  // porque algo creado hoy puede vencer en otra fecha. §16.39 tramo 2.
  const entradaDelDia = useMemo(() => getEntradaForDay(activeDate, tasks), [activeDate, tasks]);

  // --- Hooks ---
  const {
    handleEditTaskRequest, handleDeleteTaskRequest, handleToggleStatus,
    handleAddTask, doAddTask, handleUpdateTask, handleDeleteTask, handleAddRule,
  } = useTaskCRUD({
    tasks, setTasks, blocks, activeDate,
    setEditingTaskId, setInlineEditingTaskId, setEditingRuleId,
    setRecurrenceAction, setAddSubtaskWarning, setBlockChoice, dashboardTasks, timeEntries,
  });

  const {
    handleUpdateTasksOrder, handleUpdateSubtasksOrder, handleGoToTemplate,
    handleToggleExpandTask, handleExpandAllInBlock, handlePromoteTask, handleDemoteTask,
  } = useTaskOrdering({ tasks, setTasks, setCurrentView, setHighlightTaskId });

  const {
    handleAddBlock, handleUpdateBlock, handleReorderBlocks,
    handleToggleBlockActive, handleDeleteBlock, handleRestoreBlock,
  } = useBlockHandlers({ blocks, setBlocks, tasks, setTasks, setEditingBlockId });

  const timerHandlers = useTimerHandlers({
    tasks, setTasks, activeTimer, setActiveTimer,
    setTimerStopModal, setTimeEntries, handleUpdateTask,
  });

  // FASE 6 (cierre del día · repaso de lo no hecho) — §16.47
  // Mover una tarea a otra fecha desde el repaso: recurrente → excepción "solo este día"; one-off → cambia dueDate.
  // Incrementa rolled_over_count (veces ESQUIVADA). La columna no está en los row-builders → update dirigido para persistirla.
  const handleRepasoMove = (task: any, newDate: string) => {
    const isRecurrent = !!(task.templateId || task.recurrence?.frequency);
    const newCount = (task.rolledOverCount || 0) + 1;
    const moved = isRecurrent
      ? { ...task, dueDate: newDate, instanceDate: task.instanceDate || task.dueDate, isException: true, existsInSupabase: true, rolledOverCount: newCount }
      : { ...task, dueDate: newDate, rolledOverCount: newCount };
    handleUpdateTask(moved); // rolled_over_count se persiste en el row-builder de handleUpdateTask (§16.47)
  };
  // ¿la recurrente movida COLISIONA con su propia regla en el día destino (la rutina también cae ahí)?
  const repasoWillCollide = (task: any, destDay: string): boolean => {
    const tpl = task.templateId ? tasks[task.templateId] : (task.recurrence?.frequency ? task : null);
    return !!(tpl && occursOn(tpl, destDay));
  };
  // Carga pendiente estimada de un día cualquiera (impacto de "pasar a otro día").
  const repasoDayLoad = (dayISO: string) => getDayLoad(dayISO, tasks);

  const { bulkUpdateTasks, bulkDeleteTasks, bulkDuplicateTasks } = useBulkActions({
    tasks, setTasks, selectedTaskIds, setSelectedTaskIds, setSelectionMode, activeDate, timeEntries,
  });

  // Wrappers for attachment handlers (they need handleUpdateTask as param)
  const handleUploadAttachment = useCallback((taskId: string, file: File) =>
    timerHandlers.handleUploadAttachment(taskId, file, handleUpdateTask), [timerHandlers, handleUpdateTask]);

  const handleDeleteAttachment = useCallback((taskId: string, attachmentId: string, path: string) =>
    timerHandlers.handleDeleteAttachment(taskId, attachmentId, path, handleUpdateTask), [timerHandlers, handleUpdateTask]);

  // Timer stop confirm wrapper
  const handleTimerStopConfirm = useCallback((note: string, markComplete: boolean) => {
    if (!timerStopModal) return;
    timerHandlers.handleTimerStopConfirm(note, markComplete, timerStopModal);
    setTimerStopModal(null);
  }, [timerStopModal, timerHandlers]);

  // People handlers
  const handleAddPerson = async (person: Person) => {
    try {
      const existing = people.find(p => p.name.toLowerCase() === person.name.toLowerCase());
      if (existing) return;
      const { error } = await supabase.from('persons').insert({ id: person.id, name: person.name, created_at: new Date().toISOString() }).select().single();
      if (error) throw error;
      setPeople(prev => [...prev, person]);
    } catch (e) {
      console.error('[SUPABASE] Error creating person:', e);
      reportPersistError({ verbo: 'crear', titulo: person.name, singular: 'la persona', plural: 'personas' });
      const existing = people.find(p => p.name.toLowerCase() === person.name.toLowerCase());
      if (!existing) setPeople(prev => [...prev, person]);
    }
  };

  const handleRenamePerson = async (id: string, name: string) => {
    try {
      const { error } = await supabase.from('persons').update({ name }).eq('id', id);
      if (error) throw error;
      setPeople(prev => prev.map(p => p.id === id ? { ...p, name } : p));
    } catch (e) {
      console.error('[SUPABASE] Error renaming person:', e);
      reportPersistError({ verbo: 'guardar', titulo: name, singular: 'la persona', plural: 'personas' });
      setPeople(prev => prev.map(p => p.id === id ? { ...p, name } : p));
    }
  };

  const handleDeletePerson = async (id: string) => {
    try {
      const { error } = await supabase.from('persons').delete().eq('id', id);
      if (error) throw error;
      setPeople(prev => prev.filter(p => p.id !== id));
      setTasks(prev => {
        const updated = { ...prev };
        Object.values(updated).forEach((t: Task) => {
          if (t.delegation?.personId === id) updated[t.id] = { ...t, delegation: undefined };
        });
        return updated;
      });
    } catch (e) {
      console.error('[SUPABASE] Error deleting person:', e);
      reportPersistError({ verbo: 'borrar', titulo: people.find(p => p.id === id)?.name, singular: 'la persona', plural: 'personas' });
      setPeople(prev => prev.filter(p => p.id !== id));
    }
  };

  const handleDayChange = (offset: number) => {
    const current = parseLocalISO(activeDate);
    current.setDate(current.getDate() + offset);
    setActiveDate(formatLocalISO(current));
  };

  // --- Loading screen ---
  if (!isDataLoaded) {
    return (
      <>
        <div className="min-h-screen bg-bg-main flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-turquesa border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-text-secondary font-black uppercase tracking-widest text-sm">
              Cargando datos desde Supabase...
            </p>
          </div>
        </div>
        <DiagPanel /> {/* DIAG-TEMP */}
        <ToastContainer /> {/* Avisos (B1) */}
      </>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-bg-main text-text-main flex flex-col md:flex-row font-sans relative">

      {/* Global Timer Bar */}
      <AnimatePresence>
        {activeTimer && (
          <motion.div
            initial={{ y: -50 }} animate={{ y: 0 }} exit={{ y: -50 }}
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
                onClick={timerHandlers.handleStopTimer}
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
        <div className="flex items-center gap-3 mb-4 px-5">
          <div className="shrink-0" style={{ width: 46, height: 46 }}>
            <svg width="46" height="46" viewBox="0 0 46 46" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="0" width="21" height="21" rx="5" fill="#14B8A6"/>
              <text x="10.5" y="18" textAnchor="middle" fontFamily="Trebuchet MS, Verdana, sans-serif" fontWeight="900" fontSize="22" fill="white">W</text>
              <rect x="25" y="0" width="21" height="21" rx="5" fill="#3B82F6"/>
              <rect x="0" y="25" width="21" height="21" rx="5" fill="#A855F7"/>
              <rect x="25" y="25" width="21" height="21" rx="5" fill="#EC4899"/>
              <text x="35.5" y="43" textAnchor="middle" fontFamily="Trebuchet MS, Verdana, sans-serif" fontWeight="900" fontSize="22" fill="white">M</text>
            </svg>
          </div>
          <div className="hidden lg:block overflow-hidden">
            <h1 className={`text-[15px] font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-text-main-light'} whitespace-nowrap`}>WorkManager</h1>
          </div>
        </div>

        {/* Theme Toggle */}
        <div className="px-6 mb-6">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`w-full flex items-center justify-between gap-3 p-3 rounded-2xl transition-all ${isDarkMode ? 'bg-bg-main hover:bg-bg-card border border-border-main' : 'bg-bg-card-light hover:bg-bg-secondary-light border border-border-main-light'}`}
          >
            <div className="flex items-center gap-3">
              {isDarkMode ? <Moon size={18} className="text-azul" /> : <Sun size={18} className="text-turquesa" />}
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
          <NavItem active={currentView === 'dashboard'} onClick={() => setCurrentView('dashboard')} icon={<LayoutDashboard size={20} />} label="Mi Día" />
          <NavItem active={currentView === 'week'} onClick={() => setCurrentView('week')} icon={<CalendarDays size={20} />} label="Semana" />
          <NavItem active={currentView === 'blocks'} onClick={() => setCurrentView('blocks')} icon={<Grid2X2 size={20} />} label="Bloques" />
          <NavItem active={currentView === 'calendar'} onClick={() => setCurrentView('calendar')} icon={<CalendarIcon size={20} />} label="Calendario" />
          <NavItem active={currentView === 'delegadas'} onClick={() => setCurrentView('delegadas')} icon={<Users size={20} />} label="Delegadas" />
          <NavItem active={currentView === 'search'} onClick={() => setCurrentView('search')} icon={<Search size={20} />} label="Búsqueda" />
          <NavItem active={currentView === 'workload'} onClick={() => setCurrentView('workload')} icon={<BarChart2 size={20} />} label="Carga" />
          <NavItem active={currentView === 'papelera'} onClick={() => setCurrentView('papelera')} icon={<Trash2 size={20} />} label="Papelera" />
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
            {currentView !== 'search' && currentView !== 'calendar' && currentView !== 'workload' && currentView !== 'week' && (
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
            )}
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

        {/* StickyActionBar — fuera del scroll container, se ancla correctamente */}
        <StickyActionBar
          selectionMode={selectionMode}
          selectedCount={selectedTaskIds.size}
          onToggleSelectionMode={toggleSelectionMode}
          onAddTask={currentView === 'dashboard' ? () => setComposerOpenSignal(n => n + 1) : undefined}
          hideCompleted={currentView === 'dashboard' ? dashHideCompleted : currentView === 'delegadas' ? delegadasHideCompleted : undefined}
          onToggleHideCompleted={
            currentView === 'dashboard' ? () => setDashHideCompleted(p => !p) :
            currentView === 'delegadas' ? () => setDelegadasHideCompleted(p => !p) :
            undefined
          }
          expandAll={currentView === 'dashboard' ? dashExpandAll : undefined}
          onToggleExpandAll={currentView === 'dashboard' ? () => setDashExpandAll(p => p === true ? false : true) : undefined}
          expandedBlocksCount={currentView === 'dashboard' ? dashExpandedBlocks.size : undefined}
          expandedBlocksTotal={currentView === 'dashboard' ? 5 : undefined}
          onToggleExpandBlocks={currentView === 'dashboard' ? () => {
            const allTags = new Set(['con_hora', 'focus', 'dirección', 'espera', 'resto']);
            setDashExpandedBlocks(prev => prev.size === 5 ? new Set() : allTags);
          } : undefined}
          expanded={currentView === 'blocks' ? blocksExpanded : undefined}
          onToggleExpand={currentView === 'blocks' && blocksToggleExpandRef.current ? () => blocksToggleExpandRef.current!() : undefined}
          onDelegate={() => setBulkDelegateModal(true)}
          onChangeDate={() => setBulkDateModal(true)}
          onComplete={() => bulkUpdateTasks({ status: 'completed', completedAt: new Date().toISOString() })}
          onChangeTime={() => setBulkTimeModal(true)}
          onDuplicate={() => bulkDuplicateTasks()}
          onDelete={() => bulkDeleteTasks() /* (a) sesión 24: el confirm informativo vive en el hook (conteo real) */}
          onClearSelection={() => setSelectedTaskIds(new Set())}
        />

        {/* Content Container */}
        <div className="flex-1 overflow-y-auto p-4 md:p-10 custom-scrollbar dark:bg-bg-main bg-bg-main-light">
          {/* §16.13: ancho MÁXIMO del contenido (~1.200px, centrado) — no estirar a todo el ancho en pantallas grandes. */}
          <div className="max-w-[1200px] mx-auto w-full">
          <AnimatePresence mode="wait">
            {currentView === 'dashboard' && (
              <DashboardView
                tasks={dashboardTasks}
                allTasksMap={dashboardTasksMap}
                entrada={entradaDelDia}
                onRepasoMove={handleRepasoMove}
                repasoWillCollide={repasoWillCollide}
                repasoDayLoad={repasoDayLoad}
                blocks={blocks}
                people={people}
                onAddPerson={handleAddPerson}
                onRenamePerson={handleRenamePerson}
                onDeletePerson={handleDeletePerson}
                onRecurrenceDateChange={(task: any, newDate: string) => setPendingDateChange({ task, newDate })}
                timeEntries={timeEntries}
                activeTimer={activeTimer}
                onStartTimer={timerHandlers.handleStartTimer}
                onStopTimer={timerHandlers.handleStopTimer}
                onToggle={handleToggleStatus}
                onDelete={handleDeleteTaskRequest}
                onAddTask={handleAddTask}
                onUpdateTask={handleUpdateTask}
                onEditTask={handleEditTaskRequest}
                editingTaskId={editingTaskId}
                inlineEditingTaskId={inlineEditingTaskId}
                setInlineEditingTaskId={setInlineEditingTaskId}
                onOpenTimePanel={(taskId: string, subtaskId: string | null) => {
                  const resolveToTemplate = (id: string) => id.startsWith("inst-") ? id.replace(/^inst-/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "") : id;
                  const instId = subtaskId || taskId;
                  const dateMatch = instId.match(/-(\d{4}-\d{2}-\d{2})$/);
                  const resolved = subtaskId ? resolveToTemplate(subtaskId) : resolveToTemplate(taskId);
                  setModalInstanceDate(dateMatch ? dateMatch[1] : null);
                  setOpenModalWithTime(true);
                  setEditingTaskId(resolved);
                }}
                onAddTimeEntry={(taskId: string, subtaskId: string | null, minutes: number, date: string, note?: string, markComplete?: boolean) => timerHandlers.handleManualTimeEntry(taskId, subtaskId, minutes, date, note, markComplete)}
                activeDate={activeDate}
                onSetDate={setActiveDate}
                composerOpenSignal={composerOpenSignal}
                onDayChange={handleDayChange}
                onReorderTasks={handleUpdateTasksOrder}
                onReorderSubtasks={handleUpdateSubtasksOrder}
                onToggleExpand={handleToggleExpandTask}
                onViewInstances={(task: Task) => setInstancesModalTask(task)}
                onGoToTemplate={handleGoToTemplate}
                onPromote={handlePromoteTask}
                onDemote={handleDemoteTask}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleTaskSelection={toggleTaskSelection}
                onSelectScope={selectScope}
                onEnsureSelectionMode={() => setSelectionMode(true)}
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
                onDeleteTimeEntry={timerHandlers.handleDeleteTimeEntry}
                onUpdateTimeEntry={timerHandlers.handleUpdateTimeEntry}
                searchQuery={searchQuery}
                hideCompleted={dashHideCompleted}
                onHideCompletedChange={setDashHideCompleted}
                expandAll={dashExpandAll}
                onExpandAllChange={setDashExpandAll}
                expandedBlocks={dashExpandedBlocks}
                onExpandedBlocksChange={setDashExpandedBlocks}
              />
            )}

            {currentView === 'blocks' && (
              <BlocksManagerView
                highlightTaskId={highlightTaskId}
                onClearHighlight={() => setHighlightTaskId(null)}
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
                onStartTimer={timerHandlers.handleStartTimer}
                onStopTimer={timerHandlers.handleStopTimer}
                onAddBlock={handleAddBlock}
                onRestoreBlock={handleRestoreBlock}
                onDelete={handleDeleteTaskRequest}
                onAddTask={handleAddTask}
                onAddRule={handleAddRule}
                onToggleTask={handleToggleStatus}
                onUpdateTask={handleUpdateTask}
                onEditTask={handleEditTaskRequest}
                editingTaskId={editingTaskId}
                inlineEditingTaskId={inlineEditingTaskId}
                setInlineEditingTaskId={setInlineEditingTaskId}
                onOpenTimePanel={(taskId: string, subtaskId: string | null) => {
                  const resolveToTemplate = (id: string) => id.startsWith("inst-") ? id.replace(/^inst-/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "") : id;
                  const instId = subtaskId || taskId;
                  const dateMatch = instId.match(/-(\d{4}-\d{2}-\d{2})$/);
                  const resolved = subtaskId ? resolveToTemplate(subtaskId) : resolveToTemplate(taskId);
                  setModalInstanceDate(dateMatch ? dateMatch[1] : null);
                  setOpenModalWithTime(true);
                  setEditingTaskId(resolved);
                }}
                onEditRule={setEditingRuleId}
                onEditBlock={setEditingBlockId}
                onReorderBlocks={handleReorderBlocks}
                onToggleBlock={handleToggleBlockActive}
                activeDate={activeDate}
                onReorderTasks={handleUpdateTasksOrder}
                onReorderSubtasks={handleUpdateSubtasksOrder}
                onToggleExpand={handleToggleExpandTask}
                onExpandAll={handleExpandAllInBlock}
                onViewInstances={(task: Task) => setInstancesModalTask(task)}
                onGoToTemplate={handleGoToTemplate}
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
                searchQuery={searchQuery}
                onExpandedChange={setBlocksExpanded}
                onRegisterExpandToggle={(fn) => { blocksToggleExpandRef.current = fn; }}
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
                onStartTimer={timerHandlers.handleStartTimer}
                onStopTimer={timerHandlers.handleStopTimer}
                onUpdateTask={handleUpdateTask}
                onEditTask={handleEditTaskRequest}
                editingTaskId={editingTaskId}
                inlineEditingTaskId={inlineEditingTaskId}
                setInlineEditingTaskId={setInlineEditingTaskId}
                onOpenTimePanel={(taskId: string, subtaskId: string | null) => {
                  const resolveToTemplate = (id: string) => id.startsWith("inst-") ? id.replace(/^inst-/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "") : id;
                  const instId = subtaskId || taskId;
                  const dateMatch = instId.match(/-(\d{4}-\d{2}-\d{2})$/);
                  const resolved = subtaskId ? resolveToTemplate(subtaskId) : resolveToTemplate(taskId);
                  setModalInstanceDate(dateMatch ? dateMatch[1] : null);
                  setOpenModalWithTime(true);
                  setEditingTaskId(resolved);
                }}
                activeDate={activeDate}
                onDateSelect={(d: string) => { setActiveDate(d); setCurrentView('dashboard'); }}
                onAddTask={handleAddTask}
                onToggleTask={handleToggleStatus}
                onDelete={handleDeleteTaskRequest}
                onReorderTasks={handleUpdateTasksOrder}
                onReorderSubtasks={handleUpdateSubtasksOrder}
                onToggleExpand={handleToggleExpandTask}
                onViewInstances={(task: Task) => setInstancesModalTask(task)}
                onGoToTemplate={handleGoToTemplate}
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

            {currentView === 'delegadas' && (
              <DelegadasView
                hideCompletedExternal={delegadasHideCompleted}
                tasks={allActiveTasks}
                allTasksMap={tasks}
                blocks={blocks}
                people={people}
                meetings={meetings}
                timeEntries={timeEntries}
                onUpdateTask={handleUpdateTask}
                onToggleTask={handleToggleStatus}
                onUpdatePeople={setPeople}
                onUpdateMeetings={async (updatedMeetings: any[]) => {
                  setMeetings(updatedMeetings);
                  try {
                    for (const m of updatedMeetings) {
                      const { error } = await supabase.from('meetings').upsert({
                        id: m.id, person_id: m.personId, date: m.date,
                        notes: m.notes || '', items: m.items || [],
                        created_at: m.createdAt || new Date().toISOString()
                      }, { onConflict: 'id' });
                      if (error) throw error;
                    }
                    const currentIds = updatedMeetings.map((m: any) => m.id);
                    const { data: existing } = await supabase.from('meetings').select('id');
                    if (existing) {
                      const toDelete = existing.filter((r: any) => !currentIds.includes(r.id));
                      for (const r of toDelete) {
                        const { error } = await supabase.from('meetings').delete().eq('id', r.id);
                        if (error) throw error;
                      }
                    }
                  } catch (e) {
                    console.error('[SUPABASE] Error guardando reuniones:', e);
                    reportPersistError({ verbo: 'guardar', singular: 'la reunión', plural: 'reuniones' });
                  }
                }}
                onAddTask={handleAddTask}
                onEditTask={handleEditTaskRequest}
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
                searchQuery={searchQuery}
                onGoToTemplate={handleGoToTemplate}
              />
            )}

            {currentView === 'workload' && (
              <WorkloadView
                tasks={tasks}
                allTasksMap={tasks}
                blocks={blocks}
                timeEntries={timeEntries}
                onNavigateToDashboard={(date: string) => { setActiveDate(date); setCurrentView('dashboard'); }}
              />
            )}

            {currentView === 'papelera' && (
              <PapeleraView
                deleted={deletedTasks}
                loading={papeleraLoading}
                blocks={blocks}
                isContainerAlive={isContainerAlive}
                onRestore={handleRestore}
              />
            )}

            {currentView === 'week' && (
              <WeekView
                allTasksMap={tasks}
                blocks={blocks}
                timeEntries={timeEntries}
                onEditTask={handleEditTaskRequest}
                onToggle={handleToggleStatus}
                onUpdateTask={handleUpdateTask}
                onRecurrenceDateChange={(task: any, newDate: string) => setPendingDateChange({ task, newDate })}
                onAddTask={(parentId, blockId, date) => {
                  if (date) setActiveDate(date);
                  handleAddTask(parentId, blockId, date);
                }}
                onNavigateToDashboard={(date: string) => { setActiveDate(date); setCurrentView('dashboard'); }}
              />
            )}

            {currentView === 'search' && (
              <SearchView
                tasks={Object.values(tasks).filter((t: Task) => !t.isDeleted)}
                allTasksMap={tasks}
                blocks={blocks}
                people={people}
                timeEntries={timeEntries}
                activeTimer={activeTimer}
                onEditTask={handleEditTaskRequest}
                onToggle={handleToggleStatus}
                onDelete={handleDeleteTaskRequest}
                onUpdateTask={handleUpdateTask}
                onAddTask={handleAddTask}
                onNavigateToBlocks={() => setCurrentView('blocks')}
                onGoToTemplate={handleGoToTemplate}
              />
            )}
          </AnimatePresence>
          </div>
        </div>
      </main>

      {/* TaskModal - editar tarea */}
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
          onClose={() => { setEditingTaskId(null); setOpenModalWithTime(false); setModalInstanceDate(null); }}
          onSave={handleUpdateTask}
          onAddTask={handleAddTask}
          onDeleteTask={handleDeleteTask}
          onEditTask={handleEditTaskRequest}
          blocks={blocks}
          onUploadAttachment={handleUploadAttachment}
          onDeleteAttachment={handleDeleteAttachment}
          onToggleStatus={handleToggleStatus}
          timeEntries={timeEntries}
          onAddTimeEntry={(taskId, subtaskId, minutes, date, note, markComplete) => timerHandlers.handleManualTimeEntry(taskId, subtaskId, minutes, date, note, markComplete)}
          onDeleteTimeEntry={timerHandlers.handleDeleteTimeEntry}
          onUpdateTimeEntry={timerHandlers.handleUpdateTimeEntry}
          onGoToTemplate={handleGoToTemplate}
          initialShowTime={openModalWithTime}
          initialInstanceDate={modalInstanceDate}
        />
      )}

      {/* TaskModal - editar regla/template */}
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
          onUploadAttachment={handleUploadAttachment}
          onDeleteAttachment={handleDeleteAttachment}
          onToggleStatus={handleToggleStatus}
          timeEntries={timeEntries}
          onAddTimeEntry={(taskId, subtaskId, minutes, date, note, markComplete) => timerHandlers.handleManualTimeEntry(taskId, subtaskId, minutes, date, note, markComplete)}
          onDeleteTimeEntry={timerHandlers.handleDeleteTimeEntry}
          onUpdateTimeEntry={timerHandlers.handleUpdateTimeEntry}
          onGoToTemplate={handleGoToTemplate}
        />
      )}

      {/* BlockModal */}
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
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setAddSubtaskWarning(null); } }}
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAddSubtaskWarning(null)} />
          <div className="relative bg-bg-card border border-border-main rounded-3xl p-6 shadow-2xl max-w-sm w-full z-10">
            <div className="text-center mb-5">
              <div className="text-3xl mb-3">⚠️</div>
              <h3 className="text-white font-black text-lg mb-2">¿Convertir en tarea contenedora?</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Al añadir subtareas, se convertirá en una <span className="text-white font-bold">tarea contenedora</span>. Esto implica:
              </p>
              <ul className="text-text-secondary text-sm mt-2 space-y-1 text-left">
                {tasks[addSubtaskWarning.parentTaskId]?.dueDate && <li>• Su <span className="text-turquesa font-bold">fecha de ejecución</span> se eliminará</li>}
                {tasks[addSubtaskWarning.parentTaskId]?.dueTime && <li>• Su <span className="text-azul font-bold">hora</span> se eliminará</li>}
                {tasks[addSubtaskWarning.parentTaskId]?.tags?.length > 0 && <li>• Su <span className="text-rosa font-bold">etiqueta</span> se eliminará</li>}
                {tasks[addSubtaskWarning.parentTaskId]?.recurrence && <li>• Su <span className="text-naranja font-bold">recurrencia</span> se eliminará</li>}
                {tasks[addSubtaskWarning.parentTaskId]?.delegation && <li>• Su <span className="text-morado font-bold">delegación</span> se eliminará</li>}
                <li className="text-text-secondary/60 text-xs mt-1">Los contenedores no tienen datos propios. Toda la información la asignan sus subtareas.</li>
              </ul>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setAddSubtaskWarning(null)} className="flex-1 py-3 rounded-2xl border border-border-main text-text-secondary hover:text-white hover:border-white/30 transition-all font-bold text-sm">
                Cancelar
              </button>
              <button
                onClick={() => {
                  const { parentTaskId, blockId, overrideDate } = addSubtaskWarning;
                  setAddSubtaskWarning(null);
                  const id = `t-${Date.now()}`;
                  const timestamp = new Date().toISOString();
                  const parentTask = tasks[parentTaskId];
                  const newTask = {
                    id,
                    blockId: blockId || parentTask?.blockId || (blocks.length > 0 ? blocks[0].id : 'b1'),
                    title: '', notes: '', status: 'pending' as const,
                    dueDate: overrideDate || activeDate, dueTime: '',
                    parentTaskId, subtasks: [], estimatedMinutes: 0, tags: [], order: 0,
                    createdAt: timestamp, modifiedAt: timestamp, attachments: [],
                    isExpanded: true, isTemplate: false
                  };
                  setTasks(prev => ({
                    ...prev,
                    [parentTaskId]: {
                      ...prev[parentTaskId],
                      dueDate: null, dueTime: '', tags: [], estimatedMinutes: 0,
                      recurrence: undefined, isTemplate: false, delegation: undefined,
                      isExpanded: true, subtasks: [...(prev[parentTaskId]?.subtasks || []), id], modifiedAt: timestamp
                    },
                    [id]: newTask
                  }));
                  persist(supabase.from('tasks').update({
                    due_date: null, due_time: null, tags: [], estimated_minutes: 0,
                    recurrence: null, is_template: false, delegation: null, is_expanded: true, modified_at: timestamp
                  }).eq('id', parentTaskId), { verbo: 'guardar', titulo: tasks[parentTaskId]?.title });
                  setTimeout(() => setEditingTaskId(id), 50);
                }}
                autoFocus
                className="flex-1 py-3 rounded-2xl bg-turquesa text-white font-black text-sm hover:bg-turquesa/80 transition-all focus:outline-none focus:ring-2 focus:ring-turquesa/60 focus:ring-offset-2 focus:ring-offset-bg-card"
              >
                Sí, convertir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* F5-7(a): SELECTOR DE BLOQUE al crear sin bloque (Calendario/Semana/Delegadas). Obliga a elegir; no hay default. */}
      {blockChoice && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setBlockChoice(null); } }}
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setBlockChoice(null)} />
          <div className="relative bg-bg-card border border-border-main rounded-3xl p-6 shadow-2xl max-w-sm w-full z-10">
            <div className="text-center mb-5">
              <div className="text-3xl mb-3">📥</div>
              <h3 className="text-white font-black text-lg mb-2">¿En qué bloque?</h3>
              <p className="text-text-secondary text-sm leading-relaxed">Elige el bloque de la nueva tarea. No hay bloque por defecto.</p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto space-y-2">
              {blocks.filter((b: any) => b.isActive).map((b: any, i: number) => (
                <button
                  key={b.id}
                  autoFocus={i === 0}
                  onClick={() => {
                    const p = blockChoice;
                    setBlockChoice(null);
                    handleAddTask(p.parentTaskId, b.id, p.overrideDate, p.defaultPersonId, p.initialTitle);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl border border-border-main text-left text-white hover:border-turquesa hover:bg-bg-main transition-all focus:outline-none focus:ring-2 focus:ring-turquesa/60"
                  style={{ borderLeftColor: b.color, borderLeftWidth: 3 }}
                >
                  <span className="text-xl shrink-0">{b.icon}</span>
                  <span className="font-bold text-sm truncate">{b.name}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setBlockChoice(null)} className="w-full mt-4 py-3 text-[10px] font-black uppercase tracking-widest text-text-secondary hover:text-white transition-all">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modales bulk */}
      {bulkDelegateModal && (
        <BulkDelegateModal
          people={people}
          onClose={() => setBulkDelegateModal(false)}
          onConfirm={(personId: string | null) => {
            const timestamp = new Date().toISOString();
            const delegation = personId ? { personId, delegatedAt: timestamp } : undefined;
            bulkUpdateTasks({ delegation });
            setBulkDelegateModal(false);
          }}
        />
      )}
      {bulkDateModal && (
        <BulkDateModal
          onClose={() => setBulkDateModal(false)}
          onConfirm={(date: string) => {
            bulkUpdateTasks({ dueDate: date });
            setBulkDateModal(false);
          }}
        />
      )}
      {bulkTimeModal && (
        <BulkTimeModal
          onClose={() => setBulkTimeModal(false)}
          onConfirm={(minutes: number) => {
            bulkUpdateTasks({ estimatedMinutes: minutes });
            setBulkTimeModal(false);
          }}
        />
      )}

      {/* InstancesModal */}
      {instancesModalTask && (
        <InstancesModal
          task={instancesModalTask}
          allTasksMap={tasks}
          timeEntries={timeEntries}
          onClose={() => setInstancesModalTask(null)}
          onEditTask={(id) => { setInstancesModalTask(null); handleEditTaskRequest(id); }}
          onDelete={(id) => { handleDeleteTaskRequest(id); setInstancesModalTask(null); }}
          onRestore={(deletedTaskId) => {
            persist(supabase.from('tasks').delete().eq('id', deletedTaskId), { verbo: 'restaurar' });
            setTasks(prev => {
              const next = { ...prev };
              delete next[deletedTaskId];
              return next;
            });
          }}
        />
      )}

      {/* RecurrenceChoiceModal */}
      {recurrenceAction && (() => {
        // §16.28: contexto para el modal de papelera — la tarea objetivo, su fecha y cuántas hijas del día quedan
        // PENDIENTES (mismo día-scoped que el tapón, vía containerDayToggle). Con esto el modal nombra la tarea y
        // avisa de las subtareas que se ocultarían (el caso "Verduras vivas"). Una HOJA → 0 → sin aviso.
        const rTask = tasks[recurrenceAction.taskId] || dashboardTasks.find((t: Task) => t.id === recurrenceAction.taskId) || materializeInstanceById(recurrenceAction.taskId, tasks);
        const rDate = rTask?.dueDate || rTask?.instanceDate || null;
        const rc = rTask ? containerDayToggle(rTask, tasks, rDate) : null;
        const rPending = rc ? rc.children.filter((c: Task) => c.status !== 'completed').length : 0;
        // §16.31: lista de hijas para la banda-inventario. Recurrente → hijas del DÍA (rc.children, incluye completadas).
        // Plain (contenedor manual) → todas las descendientes que borra collectDeletableTasks, menos la propia.
        const rChildren = recurrenceAction.plain
          ? collectDeletableTasks(recurrenceAction.taskId, tasks).filter((t: Task) => t.id !== recurrenceAction.taskId)
          : (rc ? rc.children : []);
        return (
        <RecurrenceChoiceModal
          type={recurrenceAction.type}
          task={rTask}
          pendingChildCount={rPending}
          items={rChildren}
          recurrent={!recurrenceAction.plain}
          onClose={() => setRecurrenceAction(null)}
          onConfirm={(choice) => {
            const { taskId, type, ruleId, plain } = recurrenceAction;
            setRecurrenceAction(null);
            const today = formatLocalISO(new Date());
            const timestamp = new Date().toISOString();

            // §16.31 plain: contenedor manual → borrado directo (no hay "este día / serie").
            if (plain) { handleDeleteTask(taskId); return; }

            if (choice === 'instance') {
              if (type === 'edit') {
                // B3: materializar si la instancia es virgen (no está en estado) → el editor abre con datos
                // REALES, no un fantasma `{isException:true}` vacío. materializeInstanceById es puro.
                setTasks(prev => {
                  const base = prev[taskId] || materializeInstanceById(taskId, prev);
                  if (!base) return prev;
                  return { ...prev, [taskId]: { ...base, isException: true } };
                });
                setEditingTaskId(taskId);
              } else {
                // B2: incluir materializeInstanceById → resuelve la HIJA virgen (no está en el array
                // flat dashboardTasks) para poder crear su excepción isDeleted. El contenedor ya se
                // resolvía por dashboardTasks; esto cubre las hijas.
                const taskToDelete = tasks[taskId] || dashboardTasks.find(t => t.id === taskId) || materializeInstanceById(taskId, tasks);
                if (!taskToDelete) return;

                // A2 (sesión 23): "quitar SOLO este día" sobre un CONTENEDOR = CASCADA a las hijas del día.
                // Antes se escribía solo la excepción-borrada del contenedor y no las hijas → TAPÓN B lo resucitaba si
                // quedaba una hija pendiente persistida ("acepto y no borra"). Ahora se borran las hijas INTACTAS; las que
                // tienen trabajo (completadas / con tiempo) NO se tocan (§16.16) y MANTIENEN el contenedor visible (el motor
                // lo pinta mientras le queden hijas; si no queda ninguna, instanceEngine:285 lo suprime solo → no hace
                // falta excepción de contenedor, ni tocar TAPÓN B).
                // DÍA = activeDate (día VISIBLE), NO la fecha de la instancia: una hija MOVIDA a hoy tiene instanceDate en su
                // día original → usar instanceDate quitaría el día equivocado (bug de día, sesión 23). Corte clavado en lo que se ve.
                const _day = activeDate;
                const _rc = containerDayToggle(taskToDelete, tasks, _day);
                if (_rc && _rc.children.length > 0) {
                  // INTACTA = pendiente + sin tiempo registrado ese día + no completada. Se quita el `!isException`
                  // (sesión 23): editar el título o MOVER una hija a hoy NO es "trabajo" — solo completar o registrar
                  // tiempo lo es. Sin esto, las hijas movidas a hoy (isException) se trataban como con-trabajo y "no se quitaba nada".
                  const _intacta = (c: Task) => c.status === 'pending' && getTaskRegisteredSelf(c.id, timeEntries, _day) === 0;
                  const intactas = _rc.children.filter(_intacta);
                  const conTrabajo = _rc.children.filter(c => !_intacta(c));
                  // Todas con trabajo → no se quita nada. AVISO explícito (si no, "acepto y no pasa nada" = el mismo bug).
                  if (intactas.length === 0) {
                    toast.warn(`No se quitó nada: ${conTrabajo.length} tarea${conTrabajo.length !== 1 ? 's' : ''} de este día tiene${conTrabajo.length !== 1 ? 'n' : ''} trabajo (completada o con tiempo) y se conserva${conTrabajo.length !== 1 ? 'n' : ''}. Usa «Terminar la rutina» o quítalas una a una.`);
                    return;
                  }
                  setTasks(prev => {
                    const next = { ...prev } as Record<string, Task>;
                    intactas.forEach(c => { next[c.id] = { ...(prev[c.id] || c), isDeleted: true, isException: true, existsInSupabase: true, modifiedAt: timestamp } as Task; });
                    return next;
                  });
                  intactas.forEach(c => {
                    if (c.templateId) {
                      // hija recurrente (virgen o materializada) → excepción-borrada del día
                      persist(supabase.from('tasks').upsert({
                        id: c.id, block_id: c.blockId, parent_task_id: null, template_id: c.templateId,
                        instance_date: c.instanceDate || _day, title: c.title, notes: c.notes || '', priority: 'media',
                        status: c.status, due_date: c.dueDate || null, due_time: c.dueTime || null,
                        completed_at: c.completedAt || null, estimated_minutes: c.estimatedMinutes || 0,
                        actual_minutes: c.actualMinutes || 0, tags: c.tags || [], delegation: c.delegation || null,
                        is_template: false, is_exception: true, is_deleted: true, deleted_at: timestamp, is_active: false,
                        created_at: c.createdAt || timestamp, modified_at: timestamp
                      }, { onConflict: 'id' }), { verbo: 'borrar', titulo: c.title });
                    } else {
                      // hija manual (fila real) → soft-delete directo
                      persist(supabase.from('tasks').update({ is_deleted: true, deleted_at: timestamp, modified_at: timestamp }).eq('id', c.id), { verbo: 'borrar', titulo: c.title });
                    }
                  });
                  if (conTrabajo.length > 0) toast.success(`Quitado. ${conTrabajo.length} con trabajo se conserva${conTrabajo.length !== 1 ? 'n' : ''} bajo el contenedor.`);
                  return;
                }

                // No es contenedor con hijas del día (hoja recurrente, o contenedor vacío ese día) → borrar la instancia.
                setTasks(prev => ({
                  ...prev,
                  [taskId]: { ...(prev[taskId] || taskToDelete), isDeleted: true, isException: true, existsInSupabase: true, modifiedAt: timestamp }
                }));
                persist(supabase.from('tasks').upsert({
                  id: taskToDelete.id, block_id: taskToDelete.blockId, parent_task_id: null,
                  template_id: taskToDelete.templateId, instance_date: taskToDelete.instanceDate || null,
                  title: taskToDelete.title, notes: taskToDelete.notes || '',
                  priority: 'media', status: taskToDelete.status,
                  due_date: taskToDelete.dueDate || null, due_time: taskToDelete.dueTime || null,
                  completed_at: taskToDelete.completedAt || null, estimated_minutes: taskToDelete.estimatedMinutes || 0,
                  actual_minutes: taskToDelete.actualMinutes || 0, tags: taskToDelete.tags || [],
                  delegation: taskToDelete.delegation || null, is_template: false, is_exception: true,
                  is_deleted: true, deleted_at: new Date().toISOString(), is_active: false,
                  created_at: taskToDelete.createdAt || new Date().toISOString(), modified_at: timestamp
                }, { onConflict: 'id' }), { verbo: 'borrar', titulo: taskToDelete.title });
              }
            } else if (choice === 'series') {
              if (type === 'edit') {
                setEditingRuleId(ruleId);
              } else {
                // A1 (sesión 23): TERMINAR LA RUTINA = poner recurrence.endDate = AYER, NO is_active:false.
                // endDate es la PRIMITIVA DE TERMINACIÓN correcta: matchesRecurrence la respeta para TODAS las series
                // (top-level e hijas, instanceEngine:31). is_active solo lo mira el motor en contenedores top-level
                // (instanceEngine:222) → terminar una HIJA con is_active NO cortaba nada (bug de las 4 fantasmas, §16.35).
                // Modelo §16.16: pasado íntegro, corte de hoy en adelante → endDate = ayer.
                const yesterday = formatLocalISO(new Date(parseLocalISO(today).getTime() - 86400000));
                const tpl = tasks[ruleId];
                // Objetivos: si la plantilla tiene pauta propia (hoja top-level o hija) → es ella. Si es un CONTENEDOR
                // (sin pauta, §16.16) → terminar la rutina = terminar cada HIJA recurrente (cada una es su serie); las
                // hijas MANUALES no se tocan. Así endDate es la única primitiva y el pasado de cada serie se conserva.
                const targets: any[] = tpl?.recurrence
                  ? [tpl]
                  : (tpl?.subtasks || []).map((sid: string) => tasks[sid]).filter((c: any) => c && c.isTemplate && c.recurrence);
                const endRec = (t: any) => ({ ...t.recurrence, endDate: yesterday });
                // Futuras materializadas INTACTAS (pendiente + sin tiempo + sin excepción) ≥ hoy → soft-delete (con
                // endDate no regeneran, pero una fila ya materializada seguiría mostrándose vía findLanded). Las que
                // tengan trabajo encima (completada / con minutos / excepción) NO se tocan (§16.16) — se quedan.
                const intactFutures = Object.values(tasks).filter((t: any) =>
                  t && targets.some(g => g.id === t.templateId) && !t.isDeleted
                  && (t.dueDate || t.instanceDate || '') >= today
                  && t.status === 'pending' && !t.isException && !(t.actualMinutes && t.actualMinutes > 0));
                setTasks(prev => {
                  const updated = { ...prev };
                  targets.forEach(g => { if (updated[g.id]) updated[g.id] = { ...updated[g.id], recurrence: endRec(g), modifiedAt: timestamp }; });
                  intactFutures.forEach(o => { if (updated[o.id]) updated[o.id] = { ...updated[o.id], isDeleted: true, modifiedAt: timestamp }; });
                  return updated;
                });
                targets.forEach(g => persist(supabase.from('tasks').update({ recurrence: endRec(g), modified_at: timestamp }).eq('id', g.id), { verbo: 'borrar', titulo: g.title }));
                intactFutures.forEach(o => persist(supabase.from('tasks').update({ is_deleted: true, modified_at: timestamp }).eq('id', o.id), { verbo: 'borrar', titulo: o.title }));
              }
            }
          }}
        />
        );
      })()}

      {/* TimeManagementPanel */}
      <AnimatePresence>
        {showTimePanel && (
          <TimeManagementPanel
            taskId={showTimePanel.taskId}
            subtaskId={showTimePanel.subtaskId}
            allTasksMap={tasks}
            timeEntries={timeEntries}
            onAddEntry={timerHandlers.handleManualTimeEntry}
            onDeleteEntry={timerHandlers.handleDeleteTimeEntry}
            onUpdateEntry={timerHandlers.handleUpdateTimeEntry}
            onClose={() => setShowTimePanel(null)}
          />
        )}
      </AnimatePresence>

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
                  // instanceDate es la fecha original de la serie — si no existe, usamos dueDate actual
                  handleUpdateTask({
                    ...task,
                    dueDate: newDate,
                    instanceDate: task.instanceDate || task.dueDate,
                    isException: true,
                    existsInSupabase: true,
                  });
                  setPendingDateChange(null);
                }}
                className="w-full py-3 rounded-2xl bg-turquesa text-white font-black text-sm hover:bg-turquesa/80 transition-all"
              >
                Solo este día
              </button>
              <button
                onClick={() => {
                  const { task, newDate } = pendingDateChange;
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

      {/* TimerStopModal */}
      {timerStopModal && (
        <TimerStopModal
          minutes={timerStopModal.minutes}
          taskTitle={tasks[timerStopModal.pendingEntry.subtaskId || timerStopModal.pendingEntry.taskId]?.title || ''}
          onConfirm={handleTimerStopConfirm}
          onCancel={() => setTimerStopModal(null)}
        />
      )}

      <DiagPanel /> {/* DIAG-TEMP (sesión 15): panel de diagnóstico. Quitar con el revert del commit. */}
      <ToastContainer /> {/* Avisos (B1) */}
    </div>
  );
}

// --- NavItem ---
function NavItem({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all group w-full relative ${active ? 'dark:bg-bg-card dark:text-white bg-bg-card-light text-text-main-light shadow-xl dark:border-border-main border-border-main-light border' : 'dark:text-text-secondary text-text-secondary-light dark:hover:text-text-main hover:text-text-main-light dark:hover:bg-bg-card/50 hover:bg-bg-secondary-light'}`}
    >
      {active && <motion.div layoutId="activeNav" className="absolute left-0 w-1.5 h-6 bg-turquesa rounded-r-full" />}
      <span className={`${active ? 'text-turquesa' : 'group-hover:scale-110 transition-transform'}`}>{icon}</span>
      <span className="text-sm font-bold tracking-tight hidden lg:block tracking-wide">{label}</span>
      {active && <ChevronRight size={14} className="ml-auto hidden lg:block text-turquesa" />}
    </button>
  );
}

// --- TimerStopModal ---
function TimerStopModal({ minutes, taskTitle, onConfirm, onCancel }: {
  minutes: number; taskTitle: string;
  onConfirm: (note: string, markComplete: boolean) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = React.useState('');
  const [markComplete, setMarkComplete] = React.useState(false);
  const submittingRef = React.useRef(false); // guard anti-doble-envío: no crear dos time_entries con un doble clic

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="dark:bg-bg-secondary bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 flex flex-col gap-6"
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Registro de Tiempo</span>
          <h2 className="text-xl font-black dark:text-white text-text-main-light">{minutes} min registrados</h2>
          {taskTitle && <p className="text-sm dark:text-text-secondary text-text-secondary-light truncate">{taskTitle}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Nota opcional</label>
          <textarea
            rows={3}
            className="w-full p-4 dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl text-sm font-bold dark:text-white text-text-main-light outline-none focus:ring-2 focus:ring-turquesa/20 resize-none placeholder:opacity-30"
            placeholder="Añade un comentario..."
            value={note}
            onChange={e => setNote(e.target.value)}
            autoFocus
          />
        </div>
        <label className="flex items-center gap-3 cursor-pointer group">
          <div
            onClick={() => setMarkComplete(v => !v)}
            className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${markComplete ? 'bg-turquesa border-turquesa' : 'dark:border-border-main border-border-main-light'}`}
          >
            {markComplete && <span className="text-white text-xs font-black">✓</span>}
          </div>
          <span className="text-sm font-bold dark:text-white text-text-main-light group-hover:opacity-80 transition-opacity">Marcar tarea como completada</span>
        </label>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-4 rounded-2xl text-sm font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light dark:hover:bg-bg-main hover:bg-gray-100 transition-all">Cancelar</button>
          <button onClick={() => { if (submittingRef.current) return; submittingRef.current = true; onConfirm(note, markComplete); }} className="flex-[2] py-4 bg-gradient-to-r from-turquesa to-azul rounded-2xl text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-turquesa/20 hover:scale-[1.02] active:scale-95 transition-all">Guardar</button>
        </div>
      </motion.div>
    </div>
  );
}

// --- Bulk Modals ---
function BulkDelegateModal({ people, onConfirm, onClose }: any) {
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 dark:bg-black/60 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative dark:bg-bg-card bg-white rounded-[2rem] border dark:border-border-main border-border-main-light shadow-2xl p-6 w-full max-w-sm">
        <h3 className="text-lg font-black dark:text-white text-text-main-light mb-4">Delegar tareas seleccionadas</h3>
        <div className="space-y-2 mb-6">
          <button onClick={() => setSelectedPerson('__none__')} className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition-all text-left ${selectedPerson === '__none__' ? 'bg-rosa/10 border-rosa text-rosa' : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-rosa/50'}`}>
            <div className="w-8 h-8 rounded-xl bg-rosa/20 flex items-center justify-center text-rosa font-black text-sm">✕</div>
            <span className="font-bold text-sm">Quitar delegación</span>
          </button>
          {people.map((p: any) => (
            <button key={p.id} onClick={() => setSelectedPerson(p.id)} className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition-all text-left ${selectedPerson === p.id ? 'bg-morado/10 border-morado text-morado' : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-white text-text-main-light hover:border-morado/50'}`}>
              <div className="w-8 h-8 rounded-xl bg-morado/20 flex items-center justify-center text-morado font-black text-sm">{p.name[0]}</div>
              <span className="font-bold text-sm">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light font-bold text-sm hover:border-rosa transition-all">Cancelar</button>
          <button onClick={() => selectedPerson && onConfirm(selectedPerson === '__none__' ? null : selectedPerson)} disabled={!selectedPerson} className={`flex-1 py-3 rounded-2xl font-black text-sm transition-all ${selectedPerson ? 'bg-morado text-white hover:bg-morado/90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
            {selectedPerson === '__none__' ? 'Quitar delegación' : 'Delegar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkDateModal({ onConfirm, onClose }: any) {
  const [date, setDate] = useState(formatLocalISO(new Date()));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 dark:bg-black/60 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative dark:bg-bg-card bg-white rounded-[2rem] border dark:border-border-main border-border-main-light shadow-2xl p-6 w-full max-w-sm">
        <h3 className="text-lg font-black dark:text-white text-text-main-light mb-4">Cambiar fecha</h3>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-4 py-3 rounded-2xl border dark:border-border-main border-border-main-light dark:bg-bg-main bg-gray-50 dark:text-white text-text-main-light font-bold mb-6 focus:outline-none focus:border-turquesa" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light font-bold text-sm hover:border-rosa transition-all">Cancelar</button>
          <button onClick={() => onConfirm(date)} className="flex-1 py-3 rounded-2xl bg-turquesa text-white font-black text-sm hover:bg-turquesa/90 transition-all">Aplicar</button>
        </div>
      </div>
    </div>
  );
}

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
            <button key={m} onClick={() => setMinutes(m)} className={`py-3 rounded-2xl border font-black text-sm transition-all ${minutes === m ? 'bg-azul text-white border-azul' : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-white text-text-main-light hover:border-azul'}`}>
              {m >= 60 ? `${m / 60}h` : `${m}m`}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center mb-4">
          <span className="dark:text-text-secondary text-text-secondary-light text-sm">Personalizado:</span>
          <input type="number" min={1} value={minutes} onChange={e => setMinutes(Number(e.target.value))} className="flex-1 px-3 py-2 rounded-xl border dark:border-border-main border-border-main-light dark:bg-bg-main bg-gray-50 dark:text-white text-text-main-light font-bold text-sm focus:outline-none focus:border-azul" />
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
