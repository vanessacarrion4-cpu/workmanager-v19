/**
 * TaskCard.tsx
 * Componente principal de tarjeta de tarea.
 * Soporta variantes COMPACT y FULL, selección, timer, recurrencia, etc.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  Edit, Trash2, Check, X, Clock, RefreshCw, GripVertical,
  Paperclip, Maximize2, Minimize2, ArrowUpLeft, ArrowDownRight,
  ChevronsUp, ChevronsDown, Copy, Play, Pause, MoreVertical,
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
import {
  TaskTypeChip, TimePickerChip, DatePickerChip, RecurrencePickerChip,
  TagPickerChip, EstimatedTimeChip, RegisteredTimeChip, BlockPickerChip,
  DelegationChip
} from './Chips';
import { MonthDatePicker } from './TimeComponents';

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
        if (child) onUpdateTask({ ...child, onHold: next });
      });
    } else {
      onUpdateTask({ ...task, onHold: !task.onHold });
    }
  };

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
            ${task.status === 'completed' ? 'opacity-50' : ''}
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
          <div className={`group/row relative flex items-center gap-1.5 px-3 min-h-[29px] ${rowOnHold ? "after:absolute after:inset-0 after:content-[''] after:pointer-events-none after:rounded-lg dark:after:bg-bg-main/45 after:bg-bg-main-light/55" : ''}`}>

            {/* Flechas de reordenar retiradas: el arrastre reordena en todas las vistas
                (Mi Día/Bloques/Calendario ya; Delegadas con Reorder.Group; Búsqueda no reordena). */}

            {/* Barra color bloque */}
            <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: block.color }} />

            {/* Checkbox — en modo selección muestra selección, en modo normal completa */}
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

            {/* Tipo (punto de color) — §7.2: checkbox · tipo · título · chips */}
            <div className="shrink-0">
              <TaskTypeChip
                value={task.taskType || (isTaskRepetitive(task.id, allTasksMap) ? 'core' : 'adhoc')}
                onChange={(val: string) => onUpdateTask({ ...task, taskType: val })}
                isCompact={true}
              />
            </div>

            {/* Título + badges. En hijas el grupo es flex-1 (empuja el resto de chips a la
                derecha, alineados en columna). En padre/sueltas ancho natural (máx. mitad):
                los chips arrancan justo tras el texto, no en el extremo. */}
            <div className={`flex items-center gap-1.5 min-w-0 ${task.parentTaskId ? 'flex-1' : 'max-w-[55%]'}`}>
              <input
                autoFocus={editingTaskId === task.id || inlineEditingTaskId === task.id}
                className={`text-[13px] font-black dark:text-white text-text-main-light bg-transparent outline-none min-w-0 truncate dark:placeholder:text-text-secondary/20 placeholder:text-text-secondary-light/20 capitalize tracking-normal ${task.status === 'completed' ? 'line-through' : ''}`}
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
              {/* Marca "en suspenso" (esperando algo) — solo visual, no reagrupa. En contenedor, derivada. */}
              {rowOnHold && (
                <span title="En suspenso (esperando algo)" className="shrink-0 flex items-center">
                  <Hourglass size={12} className="dark:text-text-secondary text-text-secondary-light" />
                </span>
              )}
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
              {/* Hora junto al título en HIJAS: es el dato que ordena el grupo "CON HORA". */}
              {task.parentTaskId && task.dueTime && !hasSubtasks && !inMeeting && (
                <div className="shrink-0">
                  <TimePickerChip
                    value={task.dueTime}
                    onChange={(time: string) => onUpdateTask({ ...task, dueTime: time })}
                  />
                </div>
              )}
            </div>

            {/* Chips en línea (o resumen estimado→real si completada) */}
            {task.status === 'completed' ? (
              <span className="shrink-0 text-[11px] font-bold dark:text-text-secondary text-text-secondary-light tabular-nums line-through">
                {formatMinutes(getTaskEstimatedCombo(task.id, allTasksMap))} → {formatMinutes(totalRegistered)}
              </span>
            ) : (
              <div className="flex items-center gap-1 shrink-0">
                  {/* Fecha — en Mi Día solo el ICONO de calendario (el texto de fecha es
                      redundante, pero el chip ES el control para mover a otro día; §7.2).
                      En el resto de vistas, con la fecha visible. */}
                  {!hasSubtasks && (
                    <DatePickerChip
                      value={task.dueDate}
                      iconOnly={variant === 'DASHBOARD'}
                      onChange={(date: string) => {
                        if (task.templateId) {
                          onRecurrenceDateChange && onRecurrenceDateChange(task, date);
                        } else {
                          onUpdateTask({ ...task, dueDate: date });
                        }
                      }}
                    />
                  )}
                  {/* Hora en el grupo derecho, salvo que ya se muestre junto al título (hija con hora) */}
                  {!hasSubtasks && !inMeeting && !(task.parentTaskId && task.dueTime) && (
                    <TimePickerChip
                      value={task.dueTime || ''}
                      onChange={(time: string) => onUpdateTask({ ...task, dueTime: time })}
                    />
                  )}
                  {/* Chip recurrencia informativo para instancias */}
                  {task.templateId && !hasSubtasks && (() => {
                    const tmpl = allTasksMap[task.templateId];
                    const rec = tmpl?.recurrence;
                    if (!rec) return null;
                    const freq = rec.frequency || rec.type;
                    const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
                    let label = '';
                    if (freq === 'daily') label = 'Diaria';
                    else if (freq === 'weekdays') label = 'L-V';
                    else if (freq === 'weekly') {
                      const days = (rec.weekDays || []).map((d: number) => dayNames[d]).join(' ');
                      label = days || 'Sem';
                    }
                    else if (freq === 'monthly') {
                      const day = rec.monthDay || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getDate() : '');
                      label = `Mes ${day || ''}`;
                    }
                    else if (freq === 'yearly') {
                      const yd = rec.yearDay || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getDate() : null);
                      const ym = rec.yearMonth || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getMonth() + 1 : null);
                      if (yd && ym) {
                        const dd = String(yd).padStart(2, '0');
                        const mm = String(ym).padStart(2, '0');
                        label = `Año ${dd}-${mm}`;
                      } else label = 'Año';
                    }
                    else label = freq;
                    return (
                      <div className="flex items-center gap-1 shrink-0" title="Tarea recurrente">
                        <RefreshCw size={11} className="dark:text-turquesa text-turquesa-light shrink-0" />
                        <span className="text-[11px] font-medium dark:text-turquesa text-turquesa-light">{label}</span>
                      </div>
                    );
                  })()}
                  {/* Chip recurrencia para templates (Delegadas, Vista Bloques) */}
                  {task.isTemplate && task.recurrence && !task.templateId && (() => {
                    const rec = task.recurrence;
                    const freq = rec.frequency || rec.type;
                    const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
                    let label = '';
                    if (freq === 'daily') label = 'Diaria';
                    else if (freq === 'weekdays') label = 'L-V';
                    else if (freq === 'weekly') {
                      const days = (rec.weekDays || []).map((d: number) => dayNames[d]).join(' ');
                      label = days || 'Sem';
                    }
                    else if (freq === 'monthly') {
                      const day = rec.monthDay || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getDate() : '');
                      label = `Mes ${day || ''}`;
                    }
                    else if (freq === 'yearly') {
                      const yd = rec.yearDay || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getDate() : null);
                      const ym = rec.yearMonth || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getMonth() + 1 : null);
                      if (yd && ym) {
                        const dd = String(yd).padStart(2, '0');
                        const mm = String(ym).padStart(2, '0');
                        label = `Año ${dd}-${mm}`;
                      } else label = 'Año';
                    }
                    else label = freq;
                    return (
                      <div className="flex items-center gap-1 shrink-0">

                        {onViewInstances && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onViewInstances(task); }}
                            className="flex items-center justify-center w-5 h-5 rounded border dark:border-azul/30 border-azul/40 dark:bg-azul/10 bg-azul/5 hover:bg-azul/20 transition-colors"
                            title="Ver instancias generadas"
                          >
                            <Info size={10} className="text-azul" />
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  {!hasSubtasks && !task.templateId && !task.isTemplate && (
                    <RecurrencePickerChip 
                      value={task.recurrence}
                      onChange={(rec: any) => onUpdateTask({ 
                        ...task, 
                        recurrence: rec || undefined,
                        isTemplate: !!rec,
                        dueDate: rec ? null : (task.dueDate || formatLocalISO(new Date())),
                        dueTime: task.dueTime
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
                  {!inMeeting && <EstimatedTimeChip 
                    value={hasSubtasks ? totalEstimated : task.estimatedMinutes} 
                    onChange={(val: number) => { if (!hasSubtasks) onUpdateTask({ ...task, estimatedMinutes: val }); }} 
                    readonly={hasSubtasks}
                    variant={level > 1 ? 'mini' : 'default'}
                  />}
                  {!inMeeting && <RegisteredTimeChip 
                    value={totalRegistered} 
                    estimated={totalEstimated}
                    onAddEntry={onAddTimeEntry}
                    taskId={currentRootId}
                    subtaskId={level === 1 ? null : task.id}
                    date={task.dueDate || task.instanceDate || formatLocalISO(new Date())}
                    onMoreOptions={() => onOpenTimePanel(currentRootId, level === 1 ? null : task.id)}
                    onClick={() => onOpenTimePanel(currentRootId, level === 1 ? null : task.id)} 
                  />}
                  {!inMeeting && <button 
                    onClick={() => isTimerRunning ? onStopTimer() : onStartTimer(currentRootId, level === 1 ? null : task.id)}
                    className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${isTimerRunning ? 'bg-rosa text-white' : 'dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light text-turquesa hover:bg-turquesa/10'}`}
                  >
                    {isTimerRunning ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                  </button>}

                  {/* Bloque — en una hija solo si difiere del bloque del padre (la barra de la
                      izquierda ya ancla el bloque; se muestra la excepción, no la herencia). §7.2 */}
                  {/* Es HIJA si la recursión le pasó parentBlockId (una instancia recurrente tiene
                      parentTaskId=null, así que no sirve para detectar hija). Chip solo si difiere del padre. */}
                  {((parentBlockId == null && !task.parentTaskId)
                    || (parentBlockId ?? allTasksMap[task.parentTaskId]?.blockId) !== task.blockId) && (
                    <BlockPickerChip
                      value={task.blockId}
                      blocks={blocks}
                      onChange={(blockId: string) => onUpdateTask({ ...task, blockId })}
                    />
                  )}
                  {/* Ir a Bloques (↗) — hover. El chip de bloque CAMBIA de bloque; esto NAVEGA a él. */}
                  {onGoToTemplate && variant !== 'FULL' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onGoToTemplate(task.templateId || task.id); }}
                      className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-all opacity-0 group-hover/row:opacity-100 dark:text-turquesa text-turquesa-light hover:opacity-80"
                      title="Ir a Bloques"
                    >
                      <ArrowUpRight size={12} />
                    </button>
                  )}
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

            {/* Botones acción — TODO en hover (§7.2). El play del timer va aparte, siempre visible. */}
            <div className="flex items-center gap-1 shrink-0 ml-auto opacity-0 group-hover/row:opacity-100 transition-opacity">
              {/* En suspenso — marca visual (no reagrupa, el tiempo sigue contando) */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleOnHold(); }}
                title={rowOnHold ? 'Quitar en suspenso' : 'Marcar en suspenso (esperando algo)'}
                className={`w-6 h-6 flex items-center justify-center rounded-lg transition-all border ${rowOnHold ? 'dark:text-naranja text-naranja-light dark:bg-naranja/10 bg-naranja-light/10 dark:border-naranja/30 border-naranja-light/30' : 'dark:text-text-secondary text-text-secondary-light bg-transparent border-transparent dark:hover:text-naranja hover:text-naranja-light'}`}
              >
                <Hourglass size={12} />
              </button>
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
                  onClick={(e) => { e.stopPropagation(); if (onAddTask) onAddTask(task.id, task.blockId); }}
                  className="w-6 h-6 flex items-center justify-center text-turquesa bg-turquesa/5 hover:bg-turquesa/10 rounded-lg transition-all border border-turquesa/20"
                  title="Añadir subtarea"
                >
                  <Plus size={14} />
                </button>
              )}
              {/* Promover / degradar - hover */}
              <span className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
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
              </span>
            </div>

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
              className={`border-l-2 dark:border-border-main/20 border-border-main-light/20 space-y-0 ${level === 1 ? "ml-5 pl-3" : "ml-7 pl-4"}`}
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
