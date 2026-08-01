/**
 * TaskCard.tsx
 * Componente principal de tarjeta de tarea.
 * Soporta variantes COMPACT y FULL, selección, timer, recurrencia, etc.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  Edit, Trash2, Check, X, Clock, RefreshCw, GripVertical,
  Paperclip, Maximize2, Minimize2, ArrowUpLeft, ArrowDownRight,
  ChevronsUp, ChevronsDown, Copy, Play, Pause, MoreVertical, MoreHorizontal,
  Plus, ChevronDown, ChevronUp, ChevronLeft, ArrowUpRight, Calendar as CalendarIcon,
  Eye, EyeOff, CheckCircle2, Circle, Info, Tag, Hourglass
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { WorkBlock, Task, TagType, TimeEntry, Person } from './types';
import { TAG_LABELS } from './constants';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import {
  isTaskCompleted, isTaskRepetitive, getTaskEstimatedCombo,
  getTaskEstimatedPending, getTaskRegisteredCombo, formatMinutes
} from './utils';
import { getTagColor } from './helpers';
import { TitleField } from './TitleField';
import {
  TaskTypeChip, TimePickerChip, DatePickerChip, RecurrencePickerChip,
  TagPickerChip, EstimatedTimeChip, RegisteredTimeChip, BlockPickerChip,
  DelegationChip
} from './Chips';
import { MonthDatePicker } from './TimeComponents';

// Formato corto ÚNICO de recurrencia — mismo para todos los tipos (mismo tamaño/mayúsculas donde se pinta).
// refDate = fecha de la instancia/tarea, para rellenar el día del mes/año si la regla no lo trae.
function recurrenceLabel(rec: any, refDate?: string | null): string {
  if (!rec) return '';
  const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const freq = rec.frequency || rec.type;
  const dayOf = (iso?: string | null) => (iso ? new Date(iso + 'T12:00:00').getDate() : null);
  const monthOf = (iso?: string | null) => (iso ? new Date(iso + 'T12:00:00').getMonth() + 1 : null);
  if (freq === 'daily') return 'Diaria';
  if (freq === 'weekdays') return 'L-V';
  if (freq === 'weekly') {
    const days = (rec.weekDays || []).map((d: number) => dayNames[d]).join(' ');
    return days || 'Sem';
  }
  if (freq === 'monthly') {
    const day = rec.monthDay || dayOf(rec.startDate) || dayOf(refDate);
    return day ? `Mes ${day}` : 'Mes';
  }
  if (freq === 'yearly') {
    const yd = rec.yearDay || dayOf(rec.startDate) || dayOf(refDate);
    const ym = rec.yearMonth || monthOf(rec.startDate) || monthOf(refDate);
    if (yd && ym) {
      const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      return `Año ${yd} ${months[ym - 1] || ''}`.trim();
    }
    return 'Año';
  }
  return String(freq || '');
}

export function TaskCard({
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
  onViewInstances = null,
  onGoToTemplate = null,
  parentBlockId = null,
  highlightTaskId = null,
  onAddTimeEntry = null,
  taskIndex = null,
  taskCount = null,
  onMoveUp = null,
  onMoveDown = null,
  selectionMode = false,
  selectedTaskIds = new Set(),
  onToggleTaskSelection = null,
  inMeeting = false,
  showDelegationDates = false,
  meetingItems = null,
  onUpdateMeetingItems = null,
  searchQuery = '',
}: any) {
  if (!task || task.isDeleted) return null;
  const currentRootId = rootTaskId || task.id;
  const isHighlighted = highlightTaskId === task.id;
  const highlightRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isHighlighted && highlightRef.current) {
      // Esperar a que el layout esté completamente pintado
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 500);
    }
  }, [isHighlighted]);
  const block = blocks.find((b: any) => b.id === task.blockId) || blocks[0] || { color: '#14B8A6', icon: '📋', name: 'General' };
  // Ignorar instancias generadas (inst-...) al calcular hasSubtasks para chips de recurrencia
  const realSubtasks = (task.subtasks || []).filter((id: string) => !id.startsWith('inst-'));
  const hasSubtasks = (realSubtasks.length > 0) || (subtasksForGroup && subtasksForGroup.length > 0);
  const isExpanded = forceExpanded !== null ? forceExpanded : (task.isExpanded ?? true);

  // Highlight helper: resalta el texto coincidente con fondo amarillo
  const HighlightText = ({ text }: { text: string }) => {
    if (!searchQuery) return <>{text}</>;
    const q = searchQuery.toLowerCase();
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ backgroundColor: 'rgba(20,184,166,0.25)', color: 'inherit', borderRadius: '2px', padding: '0 1px' }}>
          {text.slice(idx, idx + searchQuery.length)}
        </mark>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  };
  
  // En Dashboard con subtasksForGroup: solo sumar las subtareas de ese grupo
  // En Bloques template: estimado fijo (sin filtrar completadas), registrado = 0
  // En Bloques o tarea normal: sumar PENDIENTES
  const totalEstimated = (() => {
    if (subtasksForGroup !== null) {
      // Dashboard: contenedor dividido por grupos - solo sumar subtareas PENDIENTES del grupo
      return subtasksForGroup.reduce((acc: number, subId: string) => {
        return acc + getTaskEstimatedPending(subId, allTasksMap);
      }, 0);
    } else if (task.isTemplate && !task.templateId) {
      // Template en BlocksView: mostrar estimado base (suma de subtemplates, sin filtrar por estado)
      return getTaskEstimatedCombo(task.id, allTasksMap);
    } else {
      // Instancia o tarea manual: sumar PENDIENTES
      return getTaskEstimatedPending(task.id, allTasksMap);
    }
  })();
  
  // Filtrar tiempo por fecha del día para instancias recurrentes
  const registeredFilterDate = (task.instanceDate || task.dueDate) || undefined;

  const totalRegistered = (() => {
    if (subtasksForGroup !== null) {
      // Dashboard: solo tiempo de subtareas del grupo, filtrado por fecha
      return subtasksForGroup.reduce((acc: number, subId: string) => {
        return acc + getTaskRegisteredCombo(subId, allTasksMap, timeEntries, new Set(), registeredFilterDate);
      }, 0);
    } else if (task.isTemplate && !task.templateId) {
      // Template en BlocksView: no acumular tiempo de instancias pasadas
      return 0;
    } else {
      // Instancia o tarea manual: filtrar por fecha si la tiene
      return getTaskRegisteredCombo(task.id, allTasksMap, timeEntries, new Set(), registeredFilterDate);
    }
  })();
  
  const isTimerRunning = activeTimer?.entityId === task.id;
  const [dragX, setDragX] = useState(0);
  // Tira de acciones "···": apertura por hover con retardo (150ms abrir / 250ms replegar).
  const [stripOpen, setStripOpen] = useState(false);
  const stripTimer = useRef<any>(null);
  const openStrip = () => { clearTimeout(stripTimer.current); stripTimer.current = setTimeout(() => setStripOpen(true), 150); };
  const closeStrip = () => { clearTimeout(stripTimer.current); stripTimer.current = setTimeout(() => setStripOpen(false), 250); };

  // "En suspenso": en un CONTENEDOR el estado se DERIVA de sus hijas del grupo (no se persiste
  // en el padre; la columna on_hold solo la escriben las hijas). subtasksForGroup = hijas de esta
  // etiqueta (Mi Día); fuera de Mi Día llega null → todas las hijas activas del objeto renderizado.
  const onHoldChildIds: string[] = hasSubtasks
    ? (subtasksForGroup || (task.subtasks || []).filter((id: string) => {
        const s = allTasksMap[id];
        return s && !s.isDeleted && s.status !== 'completed';
      }))
    : [];
  const rowOnHold = hasSubtasks
    ? (onHoldChildIds.length > 0 && onHoldChildIds.every((id: string) => allTasksMap[id]?.onHold))
    : !!task.onHold;
  const toggleOnHold = () => {
    if (hasSubtasks) {
      // Suspender/reactivar SOLO las hijas de este grupo → el padre queda suspendido solo aquí.
      const next = !rowOnHold;
      onHoldChildIds.forEach((id: string) => {
        const child = allTasksMap[id];
        if (child) onUpdateTask({ ...child, onHold: next }, { onHoldOnly: true });
      });
    } else {
      onUpdateTask({ ...task, onHold: !task.onHold }, { onHoldOnly: true });
    }
  };

  // Edición del título: <span> por defecto (mide su texto), <input> al editar.
  // SEPARADO (sesión 15): `editingTaskId` es SOLO la bandera del modal; la edición en la fila la
  // gobierna SOLO `inlineEditingTaskId`. Antes el `||` acoplaba las dos (abrir modal editaba también la fila).
  const isEditingTitle = inlineEditingTaskId === task.id;
  const enterTitleEdit = (e: React.MouseEvent) => {
    if (selectionMode) return;            // en modo selección, dejar que el clic seleccione
    e.stopPropagation();
    setInlineEditingTaskId && setInlineEditingTaskId(task.id);
  };
  // Guardar el título: un único onUpdateTask, solo si cambió. NO toca editingTaskId (la bandera del
  // modal), para que abrir el modal con el campo en edición no lo cierre. El borrador vive en TitleField.
  const commitTitle = (next: string) => {
    if ((next ?? '') !== (task.title || '')) onUpdateTask({ ...task, title: next });
    if (inlineEditingTaskId === task.id) setInlineEditingTaskId(null);
  };
  // Escape: salir sin guardar (TitleField ya descartó su borrador local).
  const cancelTitle = () => {
    if (inlineEditingTaskId === task.id) setInlineEditingTaskId(null);
  };

  // Una tarea COMPLETADA es un hecho cerrado: no se edita desde la fila (sesión 15). Las columnas de
  // datos se muestran pero NO son clicables (sin afordancia de hover, sin cursor de mano); las vacías
  // quedan en blanco. Vivos solo: tiempo registrado, casilla (reabrir), ··· (modal/borrar).
  const locked = task.status === 'completed';
  // Clase del envoltorio de una columna del raíl: lleno → visible (bloqueado si completada); vacío →
  // en blanco si completada, o punteado en hover si no.
  const railCol = (filled: boolean) =>
    locked
      ? (filled ? 'flex pointer-events-none' : 'hidden')
      : (filled ? 'flex' : 'hidden group-hover/row:flex has-[[data-open=true]]:flex');

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
      <div className="relative">
        <div className="flex items-center gap-2 p-2 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl transition-all group">
          <div className="w-1.5 h-6 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
          <span className="text-[11px] font-bold dark:text-white text-text-main-light truncate flex-1 uppercase tracking-tight"><HighlightText text={task.title} /></span>
          {(task.templateId || task.recurrence) && <RefreshCw size={10} className="text-turquesa shrink-0" />}
          {task.attachments && task.attachments.length > 0 && (
            <span title={`${task.attachments.length} adjunto${task.attachments.length > 1 ? 's' : ''}`} className="flex items-center gap-0.5 shrink-0">
              <Paperclip size={10} className="text-azul" />
              {task.attachments.length > 1 && <span className="text-[11px] font-bold text-azul tabular-nums">{task.attachments.length}</span>}
            </span>
          )}
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
                      className="fixed bottom-4 right-4 z-[220] dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 w-[220px]"
                    >
                      {!showMoveCalendar ? (
                        <div className="space-y-2">
                          {task.templateId && (
                            <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest text-center pb-1 border-b dark:border-border-main/50 border-border-main-light/50">
                              Solo esta instancia
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMoveTask(formatLocalISO(new Date())); }}
                              className="flex flex-col items-center gap-1 p-3 dark:bg-bg-main bg-bg-secondary-light rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                            >
                              <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Hoy</span>
                              <span className="text-[8px] dark:text-text-secondary text-text-secondary-light">{new Date().getDate()}</span>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); const m = new Date(); m.setDate(m.getDate() + 1); handleMoveTask(formatLocalISO(m)); }}
                              className="flex flex-col items-center gap-1 p-3 dark:bg-bg-main bg-bg-secondary-light rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                            >
                              <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Mañana</span>
                              <span className="text-[8px] dark:text-text-secondary text-text-secondary-light">{(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.getDate(); })()}</span>
                            </button>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowMoveCalendar(true); }}
                            className="w-full flex items-center justify-between p-3 dark:bg-bg-main bg-bg-secondary-light rounded-xl border dark:border-border-main border-border-main-light hover:border-azul transition-all group"
                          >
                            <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-azul">Elegir fecha</span>
                            <CalendarIcon size={14} className="dark:text-text-secondary text-text-secondary-light group-hover:text-azul" />
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
                            <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Mensual</span>
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
      </div>
    );
  }
 
  return (
    <div className="group relative" data-task-id={task.id} ref={highlightRef}>
      <div>
        <div
          className={`relative transition-all duration-150 rounded-2xl
            ${/* Completada: atenuada por scrim ::after en la FILA (abajo), NO por opacity — opacity en un
                 ancestro cascadea a los popups fixed y los deja translúcidos (mismo caso §14.1.1). */''}
            ${isHighlighted ? 'rounded-2xl' : ''}
            ${selectionMode
              ? selectedTaskIds.has(task.id)
                ? 'dark:bg-azul/10 bg-azul/8 cursor-pointer ring-2 ring-azul/60 ring-inset'
                : 'cursor-pointer hover:dark:bg-azul/5 hover:bg-azul/3'
              : 'hover:dark:bg-white/[0.02] hover:bg-black/[0.02]'
            }
            ${searchQuery && task.title.toLowerCase().includes(searchQuery.toLowerCase()) && !selectionMode ? 'dark:bg-turquesa/5 bg-turquesa/10' : ''}
          `}
          style={isHighlighted ? {
            outline: '3px solid #14B8A6',
            outlineOffset: '2px',
            borderRadius: '1rem',
            backgroundColor: 'rgba(20,184,166,0.15)',
            boxShadow: '0 0 0 6px rgba(20,184,166,0.12)'
          } : searchQuery && task.title.toLowerCase().includes(searchQuery.toLowerCase()) && !selectionMode ? {
            outline: '2px solid #14B8A6',
            outlineOffset: '-1px',
            borderRadius: '1rem'
          } : undefined}
          onClick={selectionMode && onToggleTaskSelection ? (e) => {
            const target = e.target as HTMLElement;
            // No interceptar clicks en botones, inputs — solo zona libre de la card
            if (target.closest('button') || target.closest('input') || target.closest('select') || target.closest('textarea') || target.closest('a')) return;
            e.stopPropagation();
            // C1: pasar las subtasks del objeto RENDERIZADO (materializado) — cubre contenedor virgen.
            onToggleTaskSelection(task.id, task.subtasks || []);
          } : undefined}
        >
          {/* Main Row — una sola línea, 29px. group/row: el hover se activa SOLO en esta fila
              (no en el bloque/sección entera). */}
          {/* Atenuado de "en suspenso" con ::after (NO opacity): el opacity cascadea a los popups
              fixed y los deja translúcidos; el pseudo-elemento se queda en la caja de la fila. */}
          <div className={`group/row relative flex items-center gap-1.5 px-3 min-h-[29px] ${(rowOnHold || locked) ? "after:absolute after:inset-0 after:content-[''] after:pointer-events-none after:rounded-lg dark:after:bg-bg-main/45 after:bg-bg-main-light/55" : ''}`}>

            {/* Flechas de reordenar retiradas: el arrastre reordena en todas las vistas
                (Mi Día/Bloques/Calendario ya; Delegadas con Reorder.Group; Búsqueda no reordena). */}

            {/* Barra color bloque — inset vertical (my-1) para que sus extremos no asomen por
                las esquinas redondeadas de la tarjeta (rounded-2xl). Sin overflow-hidden: así los
                popups fixed del raíl no se recortan. Conserva el marco redondeado. */}
            <div className="w-1 self-stretch my-1 rounded-full shrink-0" style={{ backgroundColor: block.color }} />

            {/* Checkbox — en modo selección muestra selección, en modo normal completa.
                PLANTILLAS (Bloques) en modo normal NO tienen casilla de completar: una definición no
                se completa (§16.6). En modo SELECCIÓN sí se pinta, para poder seleccionarlas. Hueco del
                mismo tamaño cuando no se pinta, para no desalinear la fila. */}
            {(selectionMode || !task.isTemplate) ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (selectionMode && onToggleTaskSelection) {
                  // C1: subtasks del objeto RENDERIZADO (materializado) — cubre contenedor virgen.
                  onToggleTaskSelection(task.id, task.subtasks || []);
                } else {
                  onToggleStatus(task.id);
                }
              }}
              className={`w-5 h-5 rounded-md flex items-center justify-center transition-all duration-150 shrink-0 ${
                selectionMode
                  ? selectedTaskIds.has(task.id)
                    ? 'bg-azul border-2 border-azul text-white shadow-md shadow-azul/30'
                    : 'dark:bg-bg-main bg-white border-2 border-azul/40 text-transparent hover:border-azul hover:bg-azul/10'
                  : task.status === 'completed'
                    ? 'bg-turquesa border-2 border-turquesa text-white shadow-sm'
                    : 'dark:bg-bg-main bg-white border-2 dark:border-border-main border-border-main-light text-transparent hover:border-turquesa'
              }`}
              title={selectionMode ? (selectedTaskIds.has(task.id) ? 'Deseleccionar' : 'Seleccionar') : (task.status === 'completed' ? 'Marcar pendiente' : 'Completar')}
            >
              {selectionMode
                ? selectedTaskIds.has(task.id)
                  ? <Check size={11} strokeWidth={3} />
                  : null
                : task.status === 'completed'
                  ? <Check size={11} strokeWidth={3} />
                  : null
              }
            </button>
            ) : (
              <div className="w-5 h-5 shrink-0" aria-hidden="true" />
            )}

            {/* Tipo (punto de color) — §7.2: checkbox · tipo · título · chips */}
            <div className="shrink-0">
              <TaskTypeChip
                value={task.taskType || (isTaskRepetitive(task.id, allTasksMap) ? 'core' : 'adhoc')}
                onChange={(val: string) => onUpdateTask({ ...task, taskType: val })}
                isCompact={true}
              />
            </div>

            {/* Hora — COLUMNA propia (40px) ANTES del título; reservada en todas las filas para que
                los títulos arranquen en el mismo punto. Gris del contexto. Contenedores: en blanco
                (no llevan hora). Vacía → punteado con reloj en hover, clic para poner. */}
            <div className="w-[40px] shrink-0 flex items-center justify-start overflow-hidden">
              {!hasSubtasks && !inMeeting && (
                <div className={railCol(!!task.dueTime)}>
                  <TimePickerChip
                    light
                    value={task.dueTime || ''}
                    onChange={(time: string) => onUpdateTask({ ...task, dueTime: time })}
                  />
                </div>
              )}
            </div>

            {/* Título: <span> mide su texto (los chips lo pegan; se trunca al chocar, min-w-0).
                <input> solo al editar. Clic → edita; Enter guarda, Escape cancela, salir guarda. */}
            <TitleField
              value={task.title}
              editing={isEditingTitle}
              onStartEdit={enterTitleEdit}
              onCommit={commitTitle}
              onCancel={cancelTitle}
              inputClassName={`text-[13px] font-black dark:text-white text-text-main-light bg-transparent outline-none flex-1 min-w-0 truncate dark:placeholder:text-text-secondary/20 placeholder:text-text-secondary-light/20 capitalize tracking-normal ${task.status === 'completed' ? 'line-through' : ''}`}
              spanClassName={`text-[13px] font-black min-w-0 truncate capitalize cursor-text ${task.status === 'completed' ? 'line-through dark:text-white/60 text-text-main-light/60' : (!task.title ? 'italic font-medium dark:text-text-secondary/40 text-text-secondary-light/40' : 'dark:text-white text-text-main-light')}`}
            />
              {/* Icono adjuntos */}
              {task.attachments && task.attachments.length > 0 && (
                <span title={`${task.attachments.length} adjunto${task.attachments.length > 1 ? 's' : ''}`} className="flex items-center gap-0.5 shrink-0">
                  <Paperclip size={10} className="text-azul opacity-70" />
                  {task.attachments.length > 1 && <span className="text-[11px] font-bold text-azul tabular-nums">{task.attachments.length}</span>}
                </span>
              )}
              {/* Badge circular subtareas pendientes */}
              {hasSubtasks && (() => {
                const subIds: string[] = subtasksForGroup || task.subtasks || [];
                const pendingCount = subIds.filter((sid: string) => {
                  const s = allTasksMap[sid];
                  return s && !s.isDeleted && s.status !== 'completed';
                }).length;
                return (
                  <button
                    data-testid="expand-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onToggleExpand(task.id);
                    }}
                    className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold flex items-center justify-center bg-rosa/20 border border-rosa/40 text-rosa transition-all hover:bg-rosa/30 cursor-pointer tabular-nums"
                  >
                    {String(pendingCount)}
                  </button>
                );
              })()}
            {/* Spacer: empuja el raíl a la derecha. El título (izquierda) mide su texto y cede
                este hueco; se trunca solo al chocar con el raíl. */}
            <div className="flex-1 min-w-0" />

            {/* ── RAÍL ── columnas de ancho fijo, misma posición horizontal en todas las filas.
                Anchos a ojo (primera pasada, para afinar). Columna vacía = en blanco; su punteado
                clicable aparece solo al pasar el ratón por la fila (o si su desplegable está
                abierto, vía :has(data-open)). */}
            {(
              /* Completadas usan el MISMO raíl §15 que el resto — columnas en su sitio, solo tachadas
                 (line-through) y atenuadas (opacity-50 de la tarjeta). Antes se pintaba un resumen
                 mínimo "estimado → registrado" empujado a la derecha (regresión §15). */
              <div className={`flex items-center shrink-0 ${task.status === 'completed' ? 'line-through' : ''}`}>
                {/* Suspender — PRIMERA columna del raíl (fija; la tira nunca la alcanza). Suspendida →
                    reloj gris; no suspendida → en blanco, reloj tenue en hover, clic alterna. */}
                <div className="w-[24px] shrink-0 flex items-center justify-center">
                  {!locked && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleOnHold(); }}
                    title={rowOnHold ? 'Quitar en suspenso' : 'Marcar en suspenso (esperando algo)'}
                    data-testid="hold-mark"
                    className={`w-5 h-5 flex items-center justify-center rounded transition-all ${rowOnHold
                      ? 'dark:text-text-secondary text-text-secondary-light'
                      : 'opacity-0 group-hover/row:opacity-100 dark:text-text-secondary/40 text-text-secondary-light/40 hover:dark:text-text-secondary hover:text-text-secondary-light hover:bg-black/[0.05] dark:hover:bg-white/10'}`}
                  >
                    <Hourglass size={12} />
                  </button>
                  )}
                </div>
                {/* TIEMPOS: estimado · registrado · play (pegados) */}
                <div className="flex items-center">
                  <div className="w-[42px] shrink-0 flex items-center justify-end overflow-hidden">
                    {!inMeeting && (() => {
                      const estVal = hasSubtasks ? totalEstimated : task.estimatedMinutes;
                      const estEmpty = !hasSubtasks && !(estVal > 0); // sin estimado → columna vacía (hover)
                      return (
                        <div className={railCol(!estEmpty)}>
                          <EstimatedTimeChip
                            value={estVal}
                            onChange={(val: number) => { if (!hasSubtasks) onUpdateTask({ ...task, estimatedMinutes: val }); }}
                            readonly={hasSubtasks}
                            variant={level > 1 ? 'mini' : 'default'}
                          />
                        </div>
                      );
                    })()}
                  </div>
                  <div className="w-[42px] shrink-0 flex items-center justify-end overflow-hidden">
                    {/* Principio (a) FASE 3: en un CONTENEDOR el registrado es SOLO-LECTURA (suma de
                        las hijas); no se registra tiempo sobre él → sin onAddEntry/onClick/onMoreOptions. */}
                    {!inMeeting && <RegisteredTimeChip
                      value={totalRegistered}
                      estimated={totalEstimated}
                      onAddEntry={hasSubtasks ? undefined : onAddTimeEntry}
                      taskId={currentRootId}
                      subtaskId={level === 1 ? null : task.id}
                      date={task.dueDate || task.instanceDate || formatLocalISO(new Date())}
                      onMoreOptions={hasSubtasks ? undefined : () => onOpenTimePanel(currentRootId, level === 1 ? null : task.id)}
                      onClick={hasSubtasks ? undefined : () => onOpenTimePanel(currentRootId, level === 1 ? null : task.id)}
                    />}
                  </div>
                  {/* play — temporizador. Principio (a) FASE 3: un CONTENEDOR no lleva cronómetro
                      (su tiempo = suma de hijas) → oculto en filas con hijas. */}
                  <div className="w-[26px] shrink-0 flex items-center justify-center">
                    {!inMeeting && !locked && !hasSubtasks && (
                      <button
                        onClick={() => isTimerRunning ? onStopTimer() : onStartTimer(currentRootId, level === 1 ? null : task.id)}
                        title={isTimerRunning ? 'Parar temporizador' : 'Iniciar temporizador'}
                        className={isTimerRunning
                          ? 'w-6 h-6 rounded-md flex items-center justify-center bg-rosa text-white shadow-md shadow-rosa/40 ring-2 ring-rosa/30 animate-pulse'
                          : 'w-5 h-5 rounded-full flex items-center justify-center dark:text-turquesa text-turquesa-light hover:bg-turquesa/10 transition-all'}
                      >
                        {isTimerRunning ? <Pause size={12} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
                      </button>
                    )}
                  </div>
                  {/* Información — histórico de tiempos de la serie (estimado vs real, ocurrencia a
                      ocurrencia). Cierra el grupo de tiempos. Solo en recurrentes; en el resto, en blanco.
                      La tira ··· nunca la alcanza (está en los tiempos). */}
                  <div className="w-[24px] shrink-0 flex items-center justify-center">
                    {onViewInstances && !locked && (task.templateId || (task.isTemplate && task.recurrence)) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewInstances(task.isTemplate ? task : (allTasksMap[task.templateId] || task)); }}
                        title="Historial de la serie (estimado vs real por ocurrencia)"
                        className="w-5 h-5 flex items-center justify-center rounded dark:text-text-secondary text-text-secondary-light hover:text-azul hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all"
                      >
                        <Info size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Hueco de aire fijo entre tiempos y contexto */}
                <div className="w-[20px] shrink-0" aria-hidden="true" />

                {/* CONTEXTO (gris #64748B): fecha · recurrencia · delegación · etiqueta · bloque */}
                <div className="flex items-center">
                  {/* Fecha (en Mi Día = columna sin dato: punteado en hover, clic mueve el día) */}
                  <div className="w-[36px] shrink-0 flex items-center justify-start overflow-hidden">
                    {!hasSubtasks && (() => {
                      const railBlank = variant === 'DASHBOARD' || !task.dueDate;
                      return (
                        <div className={railCol(!railBlank)}>
                          <DatePickerChip
                            muted
                            value={railBlank ? null : task.dueDate}
                            onChange={(date: string) => {
                              if (task.templateId) { onRecurrenceDateChange && onRecurrenceDateChange(task, date); }
                              else { onUpdateTask({ ...task, dueDate: date }); }
                            }}
                          />
                        </div>
                      );
                    })()}
                  </div>
                  {/* Recurrencia (recurrente → etiqueta gris; manual sin recurrencia → picker para añadir) */}
                  <div className="w-[48px] shrink-0 flex items-center justify-start overflow-hidden">
                    {(() => {
                      if (task.templateId && !hasSubtasks) {
                        const rec = allTasksMap[task.templateId]?.recurrence;
                        return rec ? <span className="text-[11px] font-medium dark:text-text-secondary text-text-secondary-light whitespace-nowrap">{recurrenceLabel(rec, task.instanceDate || task.dueDate)}</span> : null;
                      }
                      if (task.isTemplate && task.recurrence && !task.templateId) {
                        return <span className="text-[11px] font-medium dark:text-text-secondary text-text-secondary-light whitespace-nowrap">{recurrenceLabel(task.recurrence, task.dueDate)}</span>;
                      }
                      if (!hasSubtasks && !task.templateId && !task.isTemplate) {
                        return (
                          <div className={railCol(!!task.recurrence)}>
                            <RecurrencePickerChip
                              muted
                              value={task.recurrence}
                              // Punto 1: NO pre-poner isTemplate ni anular dueDate aquí. Solo fijar la
                              // recurrencia y dejar que handleUpdateTask haga la conversión manual→plantilla
                              // completa (pone isTemplate, vacía dueDate del template y CREA la 1ª instancia
                              // del día). Antes, isTemplate:true saltaba esa conversión → template sin instancia
                              // → la tarea desaparecía del día. Igual que poner la recurrencia desde el modal.
                              onChange={(rec: any) => onUpdateTask({ ...task, recurrence: rec || undefined })}
                            />
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  {/* Delegación */}
                  <div className="w-[60px] shrink-0 flex items-center justify-start overflow-hidden">
                    {!hasSubtasks && (
                      <div className={railCol(!!task.delegation)}>
                        <DelegationChip
                          muted
                          delegation={task.delegation}
                          people={people || []}
                          onChange={(delegation: any) => onUpdateTask({ ...task, delegation })}
                          onAddPerson={onAddPerson}
                          onRenamePerson={onRenamePerson}
                          onDeletePerson={onDeletePerson}
                          onRecurrenceDateChange={onRecurrenceDateChange}
                        />
                      </div>
                    )}
                  </div>
                  {/* Etiqueta (a color pleno) */}
                  <div className="w-[28px] shrink-0 flex items-center justify-start">
                    {!hasSubtasks && (
                      <div className={railCol(!!(task.tags && task.tags.length > 0))}>
                        <TagPickerChip
                          muted
                          selectedTags={task.tags}
                          onChange={(tags: TagType[]) => onUpdateTask({ ...task, tags })}
                        />
                      </div>
                    )}
                  </div>
                  {/* Bloque (en hija: solo si difiere del padre renderizado) */}
                  <div className={`w-[80px] shrink-0 flex items-center justify-start overflow-hidden ${locked ? 'pointer-events-none' : ''}`}>
                    {((parentBlockId == null && !task.parentTaskId)
                      || (parentBlockId ?? allTasksMap[task.parentTaskId]?.blockId) !== task.blockId) && (
                      <BlockPickerChip
                        muted
                        value={task.blockId}
                        blocks={blocks}
                        onChange={(blockId: string) => onUpdateTask({ ...task, blockId })}
                      />
                    )}
                  </div>
                </div>

                {/* ··· acciones — botón (solo en hover); la tira se despliega a su IZQUIERDA sobre el raíl.
                    Va ANTES del "+": así, por GEOMETRÍA, la tira nunca alcanza el "+" (queda a su derecha).
                    (absolute, descendiente → onMouseLeave no salta al pasar de los puntos a la tira). */}
                <div
                  className="w-[26px] shrink-0 relative z-[10] flex items-center justify-center"
                  onMouseEnter={openStrip}
                  onMouseLeave={closeStrip}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); clearTimeout(stripTimer.current); setStripOpen(o => !o); }}
                    title="Más acciones"
                    className={`w-6 h-6 flex items-center justify-center rounded-lg transition-all dark:text-text-secondary text-text-secondary-light ${stripOpen ? 'opacity-100 dark:bg-white/10 bg-black/5' : 'opacity-0 group-hover/row:opacity-100'}`}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {stripOpen && (
                    <div className="absolute right-full top-0 h-full z-[10] flex items-center">
                      {/* remate: 20px de degradado a la IZQUIERDA del primer icono (sólido→transparente),
                          para que la transición no sea un corte seco. Ningún icono cae aquí. */}
                      <div className="w-5 h-full bg-gradient-to-l from-bg-card-light dark:from-bg-card to-transparent" />
                      {/* fondo SÓLIDO bajo toda la tira (color de la fila = tarjeta) */}
                      <div className="h-full flex items-center gap-1 pl-1 pr-1 bg-bg-card-light dark:bg-bg-card">
                      {onGoToTemplate && (
                        <button onClick={(e) => { e.stopPropagation(); setStripOpen(false); onGoToTemplate(task.templateId || task.id); }} title="Ir a Bloques" className="w-6 h-6 flex items-center justify-center rounded-lg dark:text-turquesa text-turquesa-light hover:bg-turquesa/10 transition-all"><ArrowUpRight size={13} /></button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setStripOpen(false); onEditTask(task.id); }} title="Editar" className="w-6 h-6 flex items-center justify-center rounded-lg text-turquesa hover:bg-turquesa/10 transition-all"><Edit size={13} /></button>
                      <button onClick={(e) => { e.stopPropagation(); setStripOpen(false); onDelete(task.id); }} title="Eliminar" className="w-6 h-6 flex items-center justify-center rounded-lg text-rosa hover:bg-rosa/10 transition-all"><Trash2 size={13} /></button>
                      {task.parentTaskId && !locked && (
                        <button onClick={(e) => { e.stopPropagation(); setStripOpen(false); onPromote(task.id); }} title="Subir un nivel" className="w-6 h-6 flex items-center justify-center rounded-lg dark:text-text-secondary text-text-secondary-light hover:text-turquesa transition-all"><ArrowUpLeft size={13} /></button>
                      )}
                      {/* Tope 2 niveles: solo una tarea de nivel-1 SIN hijas puede degradarse (pasaria a nivel-2).
                          Una hija (nivel-2) o un contenedor con hijas quedarian en nivel-3 → oculto. */}
                      {!task.parentTaskId && !hasSubtasks && !locked && (
                        <button onClick={(e) => { e.stopPropagation(); setStripOpen(false); onDemote(task.id); }} title="Bajar un nivel" className="w-6 h-6 flex items-center justify-center rounded-lg dark:text-text-secondary text-text-secondary-light hover:text-azul transition-all"><ArrowDownRight size={13} /></button>
                      )}
                      </div>
                    </div>
                  )}
                </div>
                {/* + añadir subtarea — EXTREMO DERECHO, siempre visible. Sin z-index: la tira ··· despliega a
                    la izquierda de los puntos (que están a su izquierda), así que por GEOMETRÍA nunca lo alcanza.
                    Solo contenedores y sueltas, nunca hijas. Color: #2DD4BF → #14B8A6 en hover de FILA. */}
                <div className="w-[26px] shrink-0 flex items-center justify-center">
                  {level < 2 && !locked && (hasSubtasks || (parentBlockId == null && !task.parentTaskId)) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); if (onAddTask) onAddTask(task.id, task.blockId); }}
                      title="Añadir subtarea"
                      className="w-5 h-5 flex items-center justify-center rounded text-[#2DD4BF] group-hover/row:text-[#14B8A6] hover:bg-turquesa/10 transition-all"
                    >
                      <Plus size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Fechas delegación - solo en vista Delegadas */}
            {showDelegationDates && (task.dueDate || task.delegation?.delegatedAt) && (() => {
              const fmtDate = (d: string | null | undefined) => {
                if (!d) return null;
                const dt = new Date(d + 'T12:00:00');
                if (isNaN(dt.getTime())) return null;
                return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }).format(dt);
              };
              const execStr = fmtDate(task.dueDate);
              const delegStr = fmtDate(task.delegation?.delegatedAt);
              if (!execStr && !delegStr) return null;
              return (
                <div className="flex flex-col items-end gap-0.5 shrink-0 mr-1">
                  {execStr && (
                    <div className="text-right">
                      <p className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light/40 uppercase">Ejec.</p>
                      <p className="text-[10px] font-bold text-turquesa">{execStr}</p>
                    </div>
                  )}
                  {delegStr && (
                    <div className="text-right">
                      <p className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light/40 uppercase">Deleg.</p>
                      <p className="text-[10px] font-bold text-morado">{delegStr}</p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Batería vieja RETIRADA. Las acciones (editar · borrar · ir-al-bloque · suspender) van
                a la tira '···' en B2, y el '+' a su columna. Reservadas ya en el raíl. */}

          </div>
        </div>

        {/* Subtasks */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div 
              key={`subtasks-${task.id}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={`border-l-2 dark:border-border-main/60 border-border-main-light/50 space-y-0 ml-5 pl-3`}
            >
              {hasSubtasks && (
                <Reorder.Group 
                  axis="y" 
                  values={(subtasksForGroup || task.subtasks).filter((sid: string) => {
                    if (!hideCompleted) return true;
                    const sub = allTasksMap[sid];
                    if (!sub) return true;
                    return sub.status !== 'completed';
                  })}
                  onReorder={(newIds: string[]) => onReorderSubtasks(task.id, newIds)}
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
                    <Reorder.Item key={subId} value={subId} as="div" whileDrag={{ scale: 1.01, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }} style={{ cursor: 'grab' }}>
                      <TaskCard
                        task={allTasksMap[subId]}
                        parentBlockId={task.blockId}
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
                        onAddTimeEntry={onAddTimeEntry}
                        onAddTask={onAddTask}
                        onDelete={onDelete}
                        onPromote={onPromote}
                        onDemote={onDemote}
                        onReorderSubtasks={onReorderSubtasks}
                        onViewInstances={onViewInstances}
                        onGoToTemplate={onGoToTemplate}
                        highlightTaskId={highlightTaskId}
                        showDelegationDates={showDelegationDates}
                        onToggleExpand={onToggleExpand}
                        onRecurrenceDateChange={onRecurrenceDateChange}
                        forceExpanded={forceExpanded !== null ? false : null}
                        level={level + 1}
                        rootTaskId={currentRootId}
                        hideCompleted={hideCompleted}
                        inMeeting={inMeeting}
                        meetingItems={meetingItems}
                        onUpdateMeetingItems={onUpdateMeetingItems}
                        selectionMode={selectionMode}
                        selectedTaskIds={selectedTaskIds}
                        onToggleTaskSelection={onToggleTaskSelection}
                        taskIndex={idx}
                        taskCount={visibleSubs.length}
                        onMoveUp={() => {
                          if (idx === 0) return;
                          const reordered = [...visibleSubs];
                          [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
                          onReorderSubtasks(task.id, reordered);
                        }}
                        onMoveDown={() => {
                          if (idx === visibleSubs.length - 1) return;
                          const reordered = [...visibleSubs];
                          [reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
                          onReorderSubtasks(task.id, reordered);
                        }}
                        searchQuery={searchQuery}
                      />
                      {/* Nota de subtarea en reunión */}
                      {inMeeting && meetingItems && onUpdateMeetingItems && (
                        <div className="px-4 pb-2 ml-5 border-t dark:border-border-main/20 border-border-main-light/20">
                          <textarea
                            value={meetingItems.find((i: any) => i.taskId === subId)?.note || ''}
                            onChange={e => {
                              const existing = meetingItems.find((i: any) => i.taskId === subId);
                              if (existing) {
                                onUpdateMeetingItems(meetingItems.map((i: any) => i.taskId === subId ? { ...i, note: e.target.value } : i));
                              } else {
                                onUpdateMeetingItems([...meetingItems, { taskId: subId, note: e.target.value, isSubtask: true }]);
                              }
                            }}
                            placeholder="Nota sobre esta subtarea..."
                            rows={1}
                            onInput={(e: any) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                            className="w-full dark:bg-transparent bg-transparent border-none text-sm dark:text-text-secondary text-text-secondary-light dark:placeholder:text-text-secondary/20 placeholder:text-text-secondary-light/30 outline-none resize-none overflow-hidden mt-1"
                          />
                        </div>
                      )}
                    </Reorder.Item>
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
