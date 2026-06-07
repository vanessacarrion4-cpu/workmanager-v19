/**
 * StickyActionBar.tsx
 *
 * Barra de acciones sticky compartida entre todas las vistas.
 * Modo normal: [Seleccionar] | [Completadas · Subtareas · Grupos] | [+ Tarea]
 * Modo selección activa: acciones masivas sobre las tareas seleccionadas.
 */

import React from 'react';
import {
  Plus, Eye, EyeOff, CheckSquare,
  Users, Calendar, Clock, Copy, Trash2, X, Check,
  ChevronsDown, ChevronsUp, Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface StickyActionBarProps {
  selectionMode: boolean;
  selectedCount: number;
  onToggleSelectionMode: () => void;
  onAddTask?: () => void;
  hideCompleted?: boolean;
  onToggleHideCompleted?: () => void;
  // expandir subtareas (Dashboard)
  expandAll?: boolean | null;
  onToggleExpandAll?: () => void;
  // expandir grupos/tags (Dashboard)
  expandedBlocksCount?: number;
  expandedBlocksTotal?: number;
  onToggleExpandBlocks?: () => void;
  // expandir genérico (BlocksView, etc.)
  expanded?: boolean;
  onToggleExpand?: () => void;
  // acciones bulk
  onDelegate?: () => void;
  onChangeDate?: () => void;
  onComplete?: () => void;
  onChangeTime?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

export function StickyActionBar({
  selectionMode,
  selectedCount,
  onToggleSelectionMode,
  onAddTask,
  hideCompleted,
  onToggleHideCompleted,
  expandAll,
  onToggleExpandAll,
  expandedBlocksCount,
  expandedBlocksTotal,
  onToggleExpandBlocks,
  expanded,
  onToggleExpand,
  onDelegate,
  onChangeDate,
  onComplete,
  onChangeTime,
  onDuplicate,
  onDelete,
}: StickyActionBarProps) {

  const isSelectionActive = selectionMode && selectedCount > 0;
  const allBlocksExpanded = expandedBlocksCount !== undefined && expandedBlocksTotal !== undefined
    ? expandedBlocksCount === expandedBlocksTotal
    : false;

  return (
    <div className="sticky top-0 z-20 dark:bg-bg-secondary/95 bg-bg-secondary-light/95 backdrop-blur-md sticky-action-bar-border">
      <AnimatePresence mode="wait">

        {isSelectionActive ? (
          /* ── MODO SELECCIÓN ACTIVA ── */
          <motion.div
            key="selection"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex items-center gap-2 px-3 py-2"
          >
            {/* Contador */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-azul text-white shrink-0 shadow-md shadow-azul/25">
              <Check size={11} strokeWidth={3} />
              <span className="text-[11px] font-black tabular-nums">{selectedCount}</span>
            </div>

            <div className="w-px h-4 dark:bg-border-main bg-border-main-light shrink-0" />

            {/* Acciones masivas */}
            <div className="flex items-center gap-1 flex-1 flex-wrap">
              {onDelegate && (
                <BulkBtn onClick={onDelegate} color="morado" icon={<Users size={13} />} label="Delegar" />
              )}
              {onChangeDate && (
                <BulkBtn onClick={onChangeDate} color="turquesa" icon={<Calendar size={13} />} label="Fecha" />
              )}
              {onComplete && (
                <BulkBtn onClick={onComplete} color="verde" icon={<Check size={13} />} label="Completar" />
              )}
              {onChangeTime && (
                <BulkBtn onClick={onChangeTime} color="neutral" icon={<Clock size={13} />} label="Tiempo" />
              )}
              {onDuplicate && (
                <BulkBtn onClick={onDuplicate} color="neutral" icon={<Copy size={13} />} label="Duplicar" />
              )}
              {onDelete && (
                <BulkBtn onClick={onDelete} color="rosa" icon={<Trash2 size={13} />} label="Eliminar" />
              )}
            </div>

            {/* Cancelar selección */}
            <button
              onClick={onToggleSelectionMode}
              className="w-7 h-7 flex items-center justify-center rounded-lg dark:text-text-secondary text-text-secondary-light hover:text-rosa hover:dark:bg-rosa/10 hover:bg-rosa/10 transition-all shrink-0"
              title="Cancelar selección"
            >
              <X size={14} />
            </button>
          </motion.div>

        ) : (
          /* ── MODO NORMAL ── */
          <motion.div
            key="normal"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex items-center gap-1.5 px-3 py-2"
          >

            {/* ── Zona izquierda: Seleccionar ── */}
            <button
              onClick={onToggleSelectionMode}
              className={`
                flex items-center gap-1.5 h-8 px-3 rounded-xl border transition-all text-[11px] font-bold shrink-0
                ${selectionMode
                  ? 'bg-azul border-azul text-white shadow-md shadow-azul/25'
                  : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul dark:hover:bg-azul/10 hover:bg-azul/5'
                }
              `}
              title="Selección múltiple"
            >
              <CheckSquare size={13} />
              <span className="hidden sm:inline">Seleccionar</span>
            </button>

            <Divider />

            {/* ── Zona centro: controles de vista ── */}
            <div className="flex items-center gap-1 flex-1">

              {/* Ocultar/mostrar completadas */}
              {onToggleHideCompleted && (
                <ViewToggle
                  onClick={onToggleHideCompleted}
                  active={!!hideCompleted}
                  activeColor="turquesa"
                  activeIcon={<EyeOff size={13} />}
                  inactiveIcon={<Eye size={13} />}
                  activeLabel="Ocultar completadas"
                  inactiveLabel="Ver completadas"
                />
              )}

              {/* Expandir/contraer subtareas (Dashboard) */}
              {onToggleExpandAll && (
                <ViewToggle
                  onClick={onToggleExpandAll}
                  active={expandAll === true}
                  activeColor="azul"
                  activeIcon={<ChevronsUp size={13} />}
                  inactiveIcon={<ChevronsDown size={13} />}
                  activeLabel="Contraer subtareas"
                  inactiveLabel="Expandir subtareas"
                />
              )}

              {/* Expandir/contraer grupos por tag (Dashboard) */}
              {onToggleExpandBlocks && (
                <ViewToggle
                  onClick={onToggleExpandBlocks}
                  active={allBlocksExpanded}
                  activeColor="turquesa"
                  activeIcon={<Layers size={13} />}
                  inactiveIcon={<Layers size={13} />}
                  activeLabel="Contraer grupos"
                  inactiveLabel="Expandir grupos"
                />
              )}

              {/* Expandir/contraer genérico (BlocksView) */}
              {onToggleExpand && (
                <ViewToggle
                  onClick={onToggleExpand}
                  active={!!expanded}
                  activeColor="azul"
                  activeIcon={<ChevronsUp size={13} />}
                  inactiveIcon={<ChevronsDown size={13} />}
                  activeLabel="Contraer todo"
                  inactiveLabel="Expandir todo"
                />
              )}

            </div>

            <Divider />

            {/* ── Zona derecha: añadir tarea ── */}
            {onAddTask && (
              <button
                onClick={onAddTask}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl bg-turquesa text-white hover:bg-turquesa/85 active:scale-95 transition-all text-[11px] font-bold shadow-md shadow-turquesa/25 shrink-0"
                title="Añadir tarea"
              >
                <Plus size={13} strokeWidth={2.5} />
                <span className="hidden sm:inline">Tarea</span>
              </button>
            )}

          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────

function Divider() {
  return <div className="w-px h-4 dark:bg-border-main bg-border-main-light mx-0.5 shrink-0" />;
}

/** Botón de acción masiva (modo selección activa) */
function BulkBtn({ onClick, color, icon, label }: {
  onClick: () => void;
  color: 'morado' | 'turquesa' | 'verde' | 'rosa' | 'neutral';
  icon: React.ReactNode;
  label: string;
}) {
  const styles: Record<string, string> = {
    morado:   'border-morado/40 dark:bg-morado/10 bg-morado/5 text-morado hover:dark:bg-morado/20 hover:bg-morado/10',
    turquesa: 'border-turquesa/40 dark:bg-turquesa/10 bg-turquesa/5 text-turquesa hover:dark:bg-turquesa/20 hover:bg-turquesa/10',
    verde:    'dark:border-green-500/40 border-green-500/30 dark:bg-green-500/10 bg-green-500/5 text-green-500 hover:dark:bg-green-500/20 hover:bg-green-500/10',
    rosa:     'border-rosa/40 dark:bg-rosa/10 bg-rosa/5 text-rosa hover:dark:bg-rosa/20 hover:bg-rosa/10',
    neutral:  'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:dark:bg-bg-card hover:bg-gray-100 dark:hover:text-white hover:text-text-main-light',
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 h-7 px-2.5 rounded-xl border transition-all text-[11px] font-bold active:scale-95 ${styles[color]}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** Botón de toggle de vista (ocultar completadas, expandir, etc.) */
function ViewToggle({
  onClick, active, activeColor, activeIcon, inactiveIcon, activeLabel, inactiveLabel,
}: {
  onClick: () => void;
  active: boolean;
  activeColor: 'turquesa' | 'azul' | 'morado';
  activeIcon: React.ReactNode;
  inactiveIcon: React.ReactNode;
  activeLabel: string;
  inactiveLabel: string;
}) {
  const activeStyles: Record<string, string> = {
    turquesa: 'bg-turquesa text-white border-turquesa shadow-md shadow-turquesa/25',
    azul:     'bg-azul text-white border-azul shadow-md shadow-azul/25',
    morado:   'bg-morado text-white border-morado shadow-md shadow-morado/25',
  };
  return (
    <button
      onClick={onClick}
      title={active ? activeLabel : inactiveLabel}
      className={`
        w-8 h-8 flex items-center justify-center rounded-xl border transition-all active:scale-95
        ${active
          ? activeStyles[activeColor]
          : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-current hover:dark:text-white hover:text-text-main-light dark:hover:bg-bg-card hover:bg-gray-100'
        }
      `}
    >
      <motion.span
        key={active ? 'active' : 'inactive'}
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.12 }}
        className="flex items-center justify-center"
      >
        {active ? activeIcon : inactiveIcon}
      </motion.span>
    </button>
  );
}
