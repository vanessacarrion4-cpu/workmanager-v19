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
import { motion, AnimatePresence } from 'framer-motion';
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

export function DelegadasView({ tasks, allTasksMap, blocks, people, meetings, timeEntries, onUpdateTask, onUpdatePeople, onUpdateMeetings, onAddTask, onEditTask, onDeleteTask, onRenamePerson, onDeletePerson, onRecurrenceDateChange = null, selectionMode = false, selectedTaskIds = new Set(), onToggleTaskSelection = null, onToggleSelectionMode = null, bulkUpdateTasks = null, bulkDeleteTasks = null, bulkDuplicateTasks = null, setBulkDelegateModal = null, setBulkDateModal = null, setBulkTimeModal = null }: any) {
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
      notes: newMeeting.notes, // Solo lo que escribió el usuario
      items: newMeeting.items,
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
                      {meeting.items.map((item: any) => {
                        const task = allTasksMap[item.taskId];
                        if (!task) return null;
                        const hasNote = item.note && item.note.trim().length > 0;
                        return (
                          <div key={item.taskId} className={`rounded-xl border transition-all ${hasNote ? 'dark:border-border-main border-border-main-light' : 'dark:border-border-main/30 border-border-main-light/30 opacity-60'}`}>
                            <TaskCard
                              task={task}
                              variant="COMPACT"
                              allTasksMap={allTasksMap}
                              people={people}
                              blocks={blocks}
                              timeEntries={timeEntries}
                              onToggleStatus={() => {}}
                              onUpdateTask={onUpdateTask}
                              onEditTask={onEditTask}
                              onAddTask={onAddTask}
                              onDelete={onDeleteTask}
                            />
                            {hasNote && (
                              <div className="px-4 pb-3 border-t dark:border-border-main/30 border-border-main-light/30 mt-1 pt-2">
                                <p className="text-sm dark:text-text-secondary text-text-secondary-light">{item.note}</p>
                              </div>
                            )}
                            {!hasNote && (
                              <div className="px-4 pb-2">
                                <p className="text-[10px] dark:text-text-secondary/30 text-text-secondary-light/30 italic">Sin nota</p>
                              </div>
                            )}
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
                          const allItems = personTasks.map((t: any) => ({ taskId: t.id, note: '', isSubtask: false }));
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

              {/* Task selector - show after person is selected */}
              {newMeeting.personId && (
                <div className="mb-4 space-y-2">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block">Tareas a tratar</label>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {delegatedTasks.filter((t: any) => t.delegation?.personId === newMeeting.personId).map((t: any) => {
                      const isSelected = newMeeting.items.some((i: any) => i.taskId === t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            if (isSelected) {
                              setNewMeeting({ ...newMeeting, items: newMeeting.items.filter((i: any) => i.taskId !== t.id) });
                            } else {
                              setNewMeeting({ ...newMeeting, items: [...newMeeting.items, { taskId: t.id, note: '', isSubtask: false }] });
                            }
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all border ${
                            isSelected
                              ? 'bg-morado/10 border-morado/40 text-morado'
                              : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light dark:text-white text-text-main-light hover:border-morado/30'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-morado border-morado' : 'dark:border-border-main border-border-main-light'}`}>
                            {isSelected && <Check size={10} className="text-white" />}
                          </div>
                          <span className="text-[11px] font-bold truncate">{t.title}</span>
                        </button>
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
                                  {tag && <span className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light">{TAG_LABELS[tag as TagType]?.label || tag}</span>}
                                  {task.estimatedMinutes > 0 && (
                                    <span className="text-[8px] font-black text-azul flex items-center gap-0.5"><Clock size={8} />{formatMinutes(task.estimatedMinutes)}</span>
                                  )}
                                  {task.recurrence && (() => {
                                    const rec = task.recurrence;
                                    const freq = rec.frequency || rec.type;
                                    const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
                                    let label = '';
                                    if (freq === 'daily') label = 'Diaria';
                                    else if (freq === 'weekdays') label = 'L-V';
                                    else if (freq === 'weekly') label = (rec.weekDays || []).map((d: number) => dayNames[d]).join(' ') || 'Sem';
                                    else if (freq === 'monthly') label = `Mes ${rec.monthDay || ''}`;
                                    else if (freq === 'yearly') {
                                      if (rec.startDate) {
                                        const d = new Date(rec.startDate + 'T12:00:00');
                                        label = `Año ${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}`;
                                      } else label = 'Año';
                                    }
                                    return label ? (
                                      <span className="text-[8px] font-black text-turquesa px-1 py-0.5 bg-turquesa/10 rounded-md flex items-center gap-0.5">
                                        <RefreshCw size={7} />{label}
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                              </div>
                              <button
                                onClick={() => onEditTask && onEditTask(task.id)}
                                className="w-6 h-6 flex items-center justify-center text-turquesa/50 hover:text-turquesa hover:bg-turquesa/10 rounded-lg transition-all flex-shrink-0"
                                title="Editar tarea"
                              >
                                <Edit size={11} />
                              </button>
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

                {editingMeeting.items.length > 0 && (
                  <div>
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest block mb-2">Notas por tarea</label>
                    <div className="space-y-2">
                      {editingMeeting.items.map((item: any, idx: number) => {
                        const task = allTasksMap[item.taskId];
                        if (!task) return null;
                        return (
                          <div key={item.taskId} className="dark:bg-bg-main bg-gray-50 rounded-xl p-3 border dark:border-border-main border-border-main-light">
                            <p className="text-[10px] font-black text-morado uppercase tracking-wider mb-1.5">{task.title}</p>
                            <textarea
                              value={item.note}
                              onChange={e => {
                                const newItems = [...editingMeeting.items];
                                newItems[idx] = { ...item, note: e.target.value };
                                setEditingMeeting({ ...editingMeeting, items: newItems });
                              }}
                              placeholder="Nota sobre esta tarea..."
                              rows={2}
                              className="w-full dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-lg px-2.5 py-2 text-sm dark:text-white text-text-main-light dark:placeholder:text-text-secondary/40 placeholder:text-text-secondary-light/40 outline-none focus:border-morado/50 resize-none"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
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
