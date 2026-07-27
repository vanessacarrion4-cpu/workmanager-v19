/**
 * DelegadasView.tsx
 * Vista de tareas delegadas por persona.
 * Extraído de App.tsx - Sesión 3 del refactor.
 */

import React, { useState, useMemo } from 'react';
import {
  Plus, ChevronDown, ChevronRight, ChevronUp, Edit, Trash2, X, Check,
  Users, Calendar as CalendarIcon, Clock, MessageSquare, CheckCircle2,
  ChevronsUp, ChevronsDown, Eye, EyeOff, GripVertical, RefreshCw,
  ArrowRight, Tag, User, Zap, History
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Task, WorkBlock, Person, DelegationMeeting } from './types';
import { TAG_LABELS, COLORS } from './constants';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { isTaskCompleted, formatMinutes } from './utils';
import {
  TaskCard, BulkActionBar, DelegationChip, DatePickerChip, TagPickerChip,
  EstimatedTimeChip, RegisteredTimeChip, RecurrencePickerChip, BlockPickerChip, 
  TimePickerChip, TaskTypeChip, TimerDisplay
} from './components';
import { getTaskRegisteredCombo, getTaskEstimatedCombo } from './utils';

import { supabase } from './supabaseClient';

// ─── Colores por persona ─────────────────────────────────────────────────────
const PERSON_COLORS = [
  { main: '#14B8A6', bg: 'rgba(20,184,166,0.15)', border: 'rgba(20,184,166,0.5)' },   // turquesa
  { main: '#A855F7', bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.5)' },   // morado
  { main: '#3B82F6', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.5)' },   // azul
  { main: '#EC4899', bg: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.5)' },   // rosa
  { main: '#F97316', bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.5)' },   // naranja
  { main: '#10B981', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.5)' },   // verde
];
function getPersonColor(people: any[], personId: string) {
  const idx = people.findIndex((p: any) => p.id === personId);
  return PERSON_COLORS[idx >= 0 ? idx % PERSON_COLORS.length : 0];
}

export function DelegadasView({ tasks, allTasksMap, blocks, people, meetings, timeEntries, onUpdateTask, onToggleTask, onUpdatePeople, onUpdateMeetings, onAddTask, onEditTask, onDeleteTask, onRenamePerson, onDeletePerson, onRecurrenceDateChange = null, selectionMode = false, selectedTaskIds = new Set(), onToggleTaskSelection = null, onToggleSelectionMode = null, bulkUpdateTasks = null, bulkDeleteTasks = null, bulkDuplicateTasks = null, setBulkDelegateModal = null, setBulkDateModal = null, setBulkTimeModal = null, searchQuery = '', onGoToTemplate = null, hideCompletedExternal }: any) {

  // Highlight helper
  const HighlightText = ({ text }: { text: string }) => {
    if (!searchQuery) return <>{text}</>;
    const q = searchQuery.toLowerCase();
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ backgroundColor: '#facc15', color: 'inherit', borderRadius: '2px', padding: '0 1px' }}>
          {text.slice(idx, idx + searchQuery.length)}
        </mark>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  };

  const [activeTab, setActiveTab] = useState<'tareas' | 'reuniones'>('tareas');
  const [filterPersonId, setFilterPersonId] = useState<string | null>(null);
  const [expandedPersons, setExpandedPersons] = useState<Set<string>>(new Set());
  const [showManageTeam, setShowManageTeam] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [newMeeting, setNewMeeting] = useState<{ personId: string; date: string; notes: string; items: any[] } | null>(null);
  const [expandedMeetings, setExpandedMeetings] = useState<Set<string>>(new Set());
  const [editingMeeting, setEditingMeeting] = useState<any | null>(null);

  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(true);
  // Expand/contraer contenedores por reunión (por defecto comprimidos = vacío)
  const [meetingExpandedContainers, setMeetingExpandedContainers] = useState<Record<string, Set<string>>>({});
  const toggleMeetingContainer = (meetingId: string, taskId: string) => {
    setMeetingExpandedContainers(prev => {
      const set = new Set(prev[meetingId] || []);
      set.has(taskId) ? set.delete(taskId) : set.add(taskId);
      return { ...prev, [meetingId]: set };
    });
  };
  const toggleAllMeetingContainers = (meetingId: string, taskIds: string[]) => {
    setMeetingExpandedContainers(prev => {
      const current = prev[meetingId] || new Set<string>();
      const allOpen = taskIds.every((id: string) => current.has(id));
      const next = new Set<string>(allOpen ? [] : taskIds);
      return { ...prev, [meetingId]: next };
    });
  };
  // Filtro rango de fechas para reuniones
  const [meetingDateRange, setMeetingDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editingPersonName, setEditingPersonName] = useState('');
  const [hideCompletedDelegadas, setHideCompletedDelegadas] = useState(false);
  React.useEffect(() => {
    if (hideCompletedExternal !== undefined) setHideCompletedDelegadas(hideCompletedExternal);
  }, [hideCompletedExternal]);
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
    (t.isTemplate || !t.templateId)
  );
  // Subtareas delegadas directamente (misma lógica)
  const delegatedSubtasks = Object.values(allTasksMap).filter((t: any) =>
    t && t.delegation && !t.isDeleted && t.parentTaskId &&
    (t.isTemplate || !t.templateId)
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

    // Filtro búsqueda
    const q = searchQuery.toLowerCase();
    const filteredSorted = q ? sorted.filter(({ task, subtasksForGroup }: any) => {
      if (task.title.toLowerCase().includes(q)) return true;
      const subIds = subtasksForGroup || task.subtasks || [];
      return subIds.some((sid: string) => allTasksMap[sid]?.title?.toLowerCase().includes(q));
    }) : sorted;

    return { person: p, tasks: filteredSorted.map((e: any) => e.task), entries: filteredSorted };
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

    // Pre-seleccionar solo pendientes: tareas huérfanas pendientes + contenedores con al menos una subtarea pendiente
    const pendingIds = new Set<string>(
      parentIds.filter(id => {
        const t = allTasksMap[id];
        if (!t) return false;
        if (t.status === 'completed') return false;
        // Si es contenedor, verificar que tenga al menos una subtarea pendiente
        if (t.subtasks && t.subtasks.length > 0) {
          return t.subtasks.some((sid: string) => allTasksMap[sid]?.status !== 'completed');
        }
        return true;
      })
    );
    setSelectorPersonId(personId);
    setMeetingSelectedIds(pendingIds);
    setShowTaskSelector(true);
  };

  const handleConfirmTaskSelection = () => {
    if (!selectorPersonId || meetingSelectedIds.size === 0) return;
    const items: any[] = [];
    Array.from(meetingSelectedIds).forEach(id => {
      const task = allTasksMap[id];
      if (!task) return;
      const isContainer = task.subtasks && task.subtasks.length > 0;
      if (isContainer) {
        // Contenedor: añadir el contenedor + sus subtareas pendientes delegadas a esta persona
        items.push({ taskId: task.id, note: '', isSubtask: false });
        (task.subtasks || []).forEach((subId: string) => {
          const sub = allTasksMap[subId];
          if (!sub || sub.isDeleted || sub.status === 'completed') return;
          items.push({ taskId: sub.id, note: '', isSubtask: true });
        });
      } else {
        items.push({ taskId: task.id, note: '', isSubtask: !!task.parentTaskId });
      }
    });
    setNewMeeting({
      personId: selectorPersonId,
      date: formatLocalISO(new Date()),
      notes: '',
      items
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
      notes: newMeeting.notes, // Solo lo que escribió el usuario
      items: newMeeting.items,
      createdAt: new Date().toISOString()
    };
    // Añadir notas a cada tarea/subtarea con timestamp
    meeting.items.forEach((item: any) => {
      if (!item.note?.trim()) return;
      const task = allTasksMap[item.taskId];
      if (!task) return;
      // Buscar el template real (si es instancia usar templateId, si es manual usar id)
      const templateId = task.templateId || task.id;
      const template = allTasksMap[templateId];
      if (!template) return;
      const now = new Date();
      const dateLabel = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(now);
      const newNoteEntry = `\n--- Reunión con ${personName} - ${dateLabel} ---\n${item.note.trim()}`;
      if (!(template.notes || '').includes(newNoteEntry.trim())) {
        onUpdateTask({ ...template, notes: (template.notes || '') + newNoteEntry });
      }
    });
    onUpdateMeetings([meeting, ...(meetings || [])]);
    setShowNewMeeting(false);
    setNewMeeting(null);
  };

  const getRecurrenceLabel = (recurrence: any): string | null => {
    if (!recurrence) return null;
    const { frequency, weekDays, monthDay, startDate } = recurrence;
    switch (frequency) {
      case 'weekdays': return 'L-V';
      case 'daily': return 'Diaria';
      case 'weekly': {
        const dayMap: Record<number, string> = { 0: 'L', 1: 'M', 2: 'X', 3: 'J', 4: 'V', 5: 'S', 6: 'D' };
        return weekDays?.map((d: number) => dayMap[d]).join(' ') || 'Sem';
      }
      case 'monthly': return `Mes ${monthDay || ''}`;
      case 'yearly': {
        if (startDate) {
          const d = parseLocalISO(startDate);
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          return `Año ${dd}-${mm}`;
        }
        return 'Año';
      }
      default: return null;
    }
  };

  const getTagLabel = (tags: string[]): string | null => {
    if (!tags || tags.length === 0) return null;
    const tag = tags[0];
    const labels: Record<string, string> = {
      con_hora: '🕐',
      focus: '🎯',
      'dirección': '🚀',
      espera: '⏳',
      resto: null as any
    };
    return labels[tag] || null;
  };

  const filteredMeetings = (meetings || []).filter((m: any) => {
    if (filterPersonId && m.personId !== filterPersonId) return false;
    if (meetingDateRange.start && m.date < meetingDateRange.start) return false;
    if (meetingDateRange.end && m.date > meetingDateRange.end) return false;
    return true;
  });

  const getPersonName = (id: string) => people.find((p: any) => p.id === id)?.name || 'Desconocido';
  const getBlock = (blockId: string) => blocks.find((b: any) => b.id === blockId);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 pb-32">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black dark:text-white text-text-main-light">Delegadas</h2>
          <p className="text-text-secondary text-sm mt-1">{delegatedTasks.length} tareas · {people.length} personas</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { 
              setShowNewMeeting(true); 
              setNewMeeting({ personId: '', date: formatLocalISO(new Date()), notes: '', items: [] }); 
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-azul/10 border border-azul/30 text-azul rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-azul/20 transition-all"
          >
            <History size={13} />
            Reunión
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
          {people.map((p: any, idx: number) => {
            const personColors = PERSON_COLORS;
            const c = personColors[idx % personColors.length];
            const isActive = filterPersonId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setFilterPersonId(filterPersonId === p.id ? null : p.id)}
                className="px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all"
                style={isActive
                  ? { backgroundColor: c.bg, borderColor: c.main, color: c.main, opacity: 1, fontWeight: '900' }
                  : { backgroundColor: c.bg, borderColor: c.border, color: c.main, opacity: 0.8 }
                }
              >
                {p.name}
              </button>
            );
          })}
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
                    {(() => {
                      const pc = getPersonColor(people, person.id);
                      return (
                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-black text-lg"
                          style={{ backgroundColor: pc.bg, border: `1.5px solid ${pc.border}`, color: pc.main }}>
                          {person.name.charAt(0).toUpperCase()}
                        </div>
                      );
                    })()}
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
                      className="w-8 h-8 flex items-center justify-center rounded-xl transition-all text-white"
                      style={{ backgroundColor: getPersonColor(people, person.id).main }}
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

                {/* Tasks list - usando TaskCard (arrastre para reordenar; las flechas se retiraron) */}
                {isOpen && (() => {
                  const allEntries = personEntries || personTasks.map((t: any) => ({ task: t, subtasksForGroup: null }));
                  const orderIds = allEntries.map((e: any) => e.task.id);
                  const persistOrder = (newIds: string[]) => {
                    setLocalTaskOrders(prev => ({ ...prev, [person.id]: newIds }));
                    newIds.forEach((id: string, i: number) => {
                      const t = allTasksMap[id];
                      if (t) onUpdateTask({ ...t, order: i, modifiedAt: new Date().toISOString() });
                      supabase.from('tasks').update({ order: i }).eq('id', id).then(({ error }: any) => {
                        if (error) console.error('[ORDER] Error:', error);
                      });
                    });
                  };
                  return (
                  <Reorder.Group axis="y" values={orderIds} onReorder={persistOrder} className="border-t dark:border-border-main border-border-main-light/50">
                    {allEntries.map(({ task, subtasksForGroup: delegatedSubIds }: any) => (
                      <Reorder.Item key={task.id} value={task.id} as="div" whileDrag={{ scale: 1.01, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }} style={{ cursor: 'grab' }}>
                        <TaskCard
                          task={task}
                          variant="FULL"
                          allTasksMap={allTasksMap}
                          people={people}
                          blocks={blocks}
                          timeEntries={timeEntries}
                          onToggleStatus={(id: string) => {
                            const t = allTasksMap[id];
                            if (t) onUpdateTask({ ...t, status: t.status === 'completed' ? 'pending' : 'completed', modifiedAt: new Date().toISOString() });
                          }}
                          onUpdateTask={onUpdateTask}
                          onEditTask={onEditTask}
                          onAddTask={onAddTask}
                          onDelete={onDeleteTask}
                          onReorderSubtasks={() => {}}
                          onGoToTemplate={onGoToTemplate}
                          onToggleExpand={(taskId: string) => onUpdateTask({ ...allTasksMap[taskId], isExpanded: !allTasksMap[taskId]?.isExpanded })}
                          showDelegationDates={true}
                          subtasksForGroup={delegatedSubIds}
                          hideCompleted={false}
                          selectionMode={selectionMode}
                          selectedTaskIds={selectedTaskIds}
                          onToggleTaskSelection={onToggleTaskSelection}
                          searchQuery={searchQuery}
                        />
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* REUNIONES TAB */}
      {activeTab === 'reuniones' && (
        <div className="space-y-4">

          {/* Filtros reuniones: rango de fechas */}
          <div className="flex items-center gap-2 w-fit">
            <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest shrink-0">Rango</span>
            <input
              type="date"
              value={meetingDateRange.start}
              onChange={e => setMeetingDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl px-2 py-1 text-[11px] dark:text-white text-text-main-light outline-none focus:border-morado/50 w-32"
            />
            <span className="text-[10px] dark:text-text-secondary text-text-secondary-light">→</span>
            <input
              type="date"
              value={meetingDateRange.end}
              onChange={e => setMeetingDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl px-2 py-1 text-[11px] dark:text-white text-text-main-light outline-none focus:border-morado/50 w-32"
            />
            {(meetingDateRange.start || meetingDateRange.end) && (
              <button
                onClick={() => setMeetingDateRange({ start: '', end: '' })}
                className="w-6 h-6 flex items-center justify-center text-rosa/60 hover:text-rosa hover:bg-rosa/10 rounded-lg transition-all"
                title="Limpiar rango"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {filteredMeetings.length === 0 && (
            <div className="py-24 text-center dark:text-text-secondary text-text-secondary-light border-2 border-dashed dark:border-border-main border-border-main-light rounded-[2.5rem] opacity-50">
              <History size={40} className="mx-auto mb-4 opacity-20" />
              <p className="font-black uppercase tracking-widest text-sm">Sin reuniones registradas</p>
              <p className="text-xs mt-2 opacity-60">Crea una reunión desde la pestaña Tareas</p>
            </div>
          )}
          {filteredMeetings.map((meeting: any) => {
            const isOpen = expandedMeetings.has(meeting.id);
            // Tareas contenedor en esta reunión (tienen subtareas en allTasksMap)
            const containerTaskIds = meeting.items
              .map((item: any) => allTasksMap[item.taskId])
              .filter((t: any) => t && (t.subtasks?.length > 0))
              .map((t: any) => t.id);
            const meetingExpanded = meetingExpandedContainers[meeting.id] || new Set<string>();
            const allContainersOpen = containerTaskIds.length > 0 && containerTaskIds.every((id: string) => meetingExpanded.has(id));
            return (
              <div key={meeting.id} className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] overflow-hidden shadow-xl">
                <div className="flex items-center justify-between p-5">
                  <button
                    onClick={() => toggleMeeting(meeting.id)}
                    className="flex items-center gap-4 flex-1 text-left hover:opacity-80 transition-all"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-azul/20 border border-azul/30 flex items-center justify-center text-azul">
                      <History size={18} />
                    </div>
                    <div>
                      <p className="font-black dark:text-white text-text-main-light uppercase tracking-widest text-sm">
                        Reunión con {getPersonName(meeting.personId)}
                      </p>
                      <p className="text-[10px] dark:text-text-secondary text-text-secondary-light">
                        {new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseLocalISO(meeting.date))}
                        {' · '}{meeting.items.length} tareas
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    {/* Botón expandir/contraer contenedores de esta reunión */}
                    {containerTaskIds.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleAllMeetingContainers(meeting.id, containerTaskIds); }}
                        className={`flex items-center gap-1.5 px-3 h-8 rounded-xl border transition-all text-[9px] font-black uppercase tracking-widest ${
                          allContainersOpen
                            ? 'bg-turquesa/10 border-turquesa/50 text-turquesa'
                            : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50 hover:text-turquesa'
                        }`}
                        title={allContainersOpen ? 'Contraer contenedores' : 'Expandir contenedores'}
                      >
                        {allContainersOpen ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const person = people.find((p: any) => p.id === meeting.personId);
                        const personName = person?.name || '';
                        const dateLabel = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(parseLocalISO(meeting.date));
                        meeting.items.forEach((item: any) => {
                          if (!item.note?.trim()) return;
                          const task = allTasksMap[item.taskId];
                          if (!task) return;
                          const templateId = task.templateId || task.id;
                          const template = allTasksMap[templateId];
                          if (!template) return;
                          const newNoteEntry = `\n--- Reunión con ${personName} - ${dateLabel} ---\n${item.note.trim()}`;
                          if (!(template.notes || '').includes(item.note.trim())) {
                            onUpdateTask({ ...template, notes: (template.notes || '') + newNoteEntry });
                          }
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 h-8 rounded-xl bg-morado/10 text-morado hover:bg-morado hover:text-white transition-all text-[9px] font-black uppercase tracking-widest"
                      title="Guardar notas en tareas"
                    >
                      <Check size={11} /> Guardar
                    </button>
                    <button
                      onClick={() => setEditingMeeting({ ...meeting })}
                      className="w-8 h-8 flex items-center justify-center text-turquesa/60 hover:text-turquesa hover:bg-turquesa/10 rounded-xl transition-all"
                      title="Editar reunión"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`¿Eliminar la reunión con ${getPersonName(meeting.personId)}?`)) {
                          const updated = meetings.filter((m: any) => m.id !== meeting.id);
                          onUpdateMeetings(updated);
                        }
                      }}
                      className="w-8 h-8 flex items-center justify-center text-rosa/60 hover:text-rosa hover:bg-rosa/10 rounded-xl transition-all"
                      title="Eliminar reunión"
                    >
                      <Trash2 size={14} />
                    </button>
                    {isOpen ? <ChevronUp size={18} className="dark:text-text-secondary text-text-secondary-light" /> : <ChevronDown size={18} className="dark:text-text-secondary text-text-secondary-light" />}
                  </div>
                </div>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t dark:border-border-main border-border-main-light/50 p-5 space-y-3"
                    >
                      {meeting.notes && (
                        <div className="dark:bg-bg-main bg-gray-50 rounded-xl p-3 border dark:border-border-main border-border-main-light">
                          <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-1">Nota general</p>
                          <p className="text-sm dark:text-white text-text-main-light">{meeting.notes}</p>
                        </div>
                      )}
                      {meeting.items
                        .filter((item: any) => {
                          const task = allTasksMap[item.taskId];
                          if (!task) return false;
                          // Ocultar completadas
                          if (task.status === 'completed') return false;
                          // No mostrar si es subtarea Y su contenedor padre también está en los items
                          if (task.parentTaskId) {
                            const parentInItems = meeting.items.some((i: any) => i.taskId === task.parentTaskId);
                            if (parentInItems) return false;
                          }
                          return true;
                        })
                        .map((item: any) => {
                        const task = allTasksMap[item.taskId];
                        if (!task) return null;
                        const hasNote = item.note && item.note.trim().length > 0;
                        const isContainer = task.subtasks && task.subtasks.length > 0;
                        const isContainerOpen = meetingExpanded.has(task.id);
                        // Para contenedores: inyectar isExpanded desde meetingExpandedContainers
                        const taskForCard = isContainer ? { ...task, isExpanded: isContainerOpen } : task;
                        return (
                          <div key={item.taskId} className={`rounded-xl border transition-all ${hasNote ? 'dark:border-border-main border-border-main-light' : 'dark:border-border-main/30 border-border-main-light/30'}`}>
                            <TaskCard
                              task={taskForCard}
                              variant="FULL"
                              allTasksMap={allTasksMap}
                              people={people}
                              blocks={blocks}
                              timeEntries={timeEntries}
                              onToggleStatus={onToggleTask}
                              onUpdateTask={onUpdateTask}
                              onEditTask={onEditTask}
                              onAddTask={onAddTask}
                              onReorderSubtasks={() => {}}
                              onGoToTemplate={onGoToTemplate}
                              onToggleExpand={(taskId: string) => {
                                if (isContainer && taskId === task.id) {
                                  toggleMeetingContainer(meeting.id, task.id);
                                } else {
                                  onUpdateTask({ ...allTasksMap[taskId], isExpanded: !allTasksMap[taskId]?.isExpanded });
                                }
                              }}
                              hideCompleted={true}
                              inMeeting={true}
                              meetingItems={meeting.items}
                              onUpdateMeetingItems={(updatedItems: any[]) => {
                                const updatedMeeting = { ...meeting, items: updatedItems };
                                onUpdateMeetings(meetings.map((m: any) => m.id === meeting.id ? updatedMeeting : m));
                              }}
                              onDelete={onDeleteTask}
                            />
                            {/* Nota inline editable */}
                            <div className="px-4 pb-3 border-t dark:border-border-main/30 border-border-main-light/30 pt-2">
                              <textarea
                                value={item.note || ''}
                                onChange={e => {
                                  const updatedItems = meeting.items.map((i: any) =>
                                    i.taskId === item.taskId ? { ...i, note: e.target.value } : i
                                  );
                                  const updatedMeeting = { ...meeting, items: updatedItems };
                                  onUpdateMeetings(meetings.map((m: any) => m.id === meeting.id ? updatedMeeting : m));
                                }}
                                placeholder="Nota sobre esta tarea..."
                                rows={1}
                                onInput={(e: any) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                                className="w-full dark:bg-transparent bg-transparent border-none text-sm dark:text-text-secondary text-text-secondary-light dark:placeholder:text-text-secondary/30 placeholder:text-text-secondary-light/40 outline-none resize-none overflow-hidden"
                              />
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

                  return items
                    .filter(({ task, subtitleIds }: any) => {
                      // Excluir tareas huérfanas completadas
                      if (!subtitleIds.length && task.status === 'completed') return false;
                      // Excluir contenedores donde TODAS las subtareas delegadas están completadas
                      if (subtitleIds.length > 0) {
                        const pendingSubs = subtitleIds.filter((sid: string) => allTasksMap[sid]?.status !== 'completed');
                        if (pendingSubs.length === 0 && task.status === 'completed') return false;
                      }
                      return true;
                    })
                    .map(({ task, subtitleIds }: any) => {
                    const isSelected = meetingSelectedIds.has(task.id);
                    const isCompleted = task.status === 'completed';
                    // Solo mostrar subtareas pendientes en la descripción
                    const pendingSubIds = subtitleIds.filter((sid: string) => allTasksMap[sid]?.status !== 'completed');
                    const subNames = pendingSubIds.map((sid: string) => allTasksMap[sid]?.title).filter(Boolean);
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
              {newMeeting.personId === '' && (
                <div className="mb-4 space-y-2">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block">Persona</label>
                  <div className="flex flex-wrap gap-2">
                    {people.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          // Usar el mismo flujo que desde bloque
                          setShowNewMeeting(false);
                          setNewMeeting(null);
                          // Calcular IDs igual que handleOpenMeetingSelector
                          const seen = new Set<string>();
                          const parentIds: string[] = [];
                          const personDelegatedTasks = delegatedTasks.filter((t: any) => t.delegation?.personId === p.id);
                          personDelegatedTasks.forEach((t: any) => {
                            const parentId = t.parentTaskId || t.id;
                            const parent = allTasksMap[parentId];
                            if (parent && !parent.isDeleted && !seen.has(parentId)) {
                              seen.add(parentId);
                              parentIds.push(parentId);
                            }
                          });
                          const pendingIds = new Set<string>(
                            parentIds.filter(id => allTasksMap[id]?.status !== 'completed')
                          );
                          setSelectorPersonId(p.id);
                          setMeetingSelectedIds(pendingIds);
                          setShowTaskSelector(true);
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

              {/* Task list with notes - TaskCard COMPACT format */}
              {newMeeting.personId && newMeeting.items.length > 0 && (
                <div className="mb-4 space-y-2">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block">Tareas ({newMeeting.items.length})</label>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {newMeeting.items.map((item: any, idx: number) => {
                      const task = allTasksMap[item.taskId];
                      if (!task) return null;
                      return (
                        <div key={item.taskId} className="dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl overflow-hidden">
                          <TaskCard
                            task={task}
                            variant="FULL"
                            allTasksMap={allTasksMap}
                            people={people}
                            blocks={blocks}
                            timeEntries={timeEntries}
                            onToggleStatus={onUpdateTask}
                            onUpdateTask={onUpdateTask}
                            onEditTask={onEditTask}
                            onAddTask={onAddTask}
                            onReorderSubtasks={() => {}}
                            onGoToTemplate={onGoToTemplate}
                            onToggleExpand={(taskId: string) => onUpdateTask({ ...allTasksMap[taskId], isExpanded: !allTasksMap[taskId]?.isExpanded })}
                            hideCompleted={true}
                            inMeeting={true}
                            meetingItems={newMeeting.items}
                            onUpdateMeetingItems={(updatedItems: any[]) => setNewMeeting({ ...newMeeting, items: updatedItems })}
                            onDelete={() => setNewMeeting({ ...newMeeting, items: newMeeting.items.filter((_: any, i: number) => i !== idx) })}
                          />
                          {/* Note textarea */}
                          <div className="px-3 pb-3 border-t dark:border-border-main/30 border-border-main-light/30 pt-2">
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
                              className="w-full dark:bg-bg-card bg-white border dark:border-border-main/50 border-border-main-light rounded-lg px-3 py-2 text-sm dark:text-white text-text-main-light dark:placeholder:text-text-secondary/30 placeholder:text-text-secondary-light/50 outline-none focus:border-morado/40 resize-none overflow-hidden"
                            />
                          </div>
                        </div>
                      );
                    })}
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

      {/* Modal editar reunión */}
      <AnimatePresence>
        {editingMeeting && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingMeeting(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-3xl p-6 shadow-2xl w-full max-w-lg z-10 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-black dark:text-white text-text-main-light uppercase tracking-widest">Editar Reunión</h3>
                  <p className="text-[11px] text-morado font-black mt-0.5">{getPersonName(editingMeeting.personId)}</p>
                </div>
                <button onClick={() => setEditingMeeting(null)} className="w-8 h-8 flex items-center justify-center dark:text-text-secondary text-text-secondary-light dark:bg-bg-main bg-gray-100 rounded-xl border dark:border-border-main border-border-main-light">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block mb-2">Fecha</label>
                  <input
                    type="date"
                    value={editingMeeting.date}
                    onChange={e => setEditingMeeting({ ...editingMeeting, date: e.target.value })}
                    className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2.5 text-sm dark:text-white text-text-main-light outline-none focus:border-morado/50"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block mb-2">Nota general</label>
                  <textarea
                    value={editingMeeting.notes}
                    onChange={e => setEditingMeeting({ ...editingMeeting, notes: e.target.value })}
                    rows={3}
                    className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2.5 text-sm dark:text-white text-text-main-light outline-none focus:border-morado/50 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setEditingMeeting(null)}
                  className="flex-1 py-3 rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light transition-all font-black text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const updated = meetings.map((m: any) => m.id === editingMeeting.id ? editingMeeting : m);
                    onUpdateMeetings(updated);
                    setEditingMeeting(null);
                  }}
                  className="flex-1 py-3 rounded-2xl bg-morado text-white font-black text-sm hover:bg-morado/80 transition-all"
                >
                  Guardar cambios
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
