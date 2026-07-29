import React, { useState } from 'react';

/**
 * TitleField — campo de título de la fila (y reutilizable).
 *
 * Encapsula el BORRADOR LOCAL: mientras se escribe NO se guarda; el guardado se hace UNA sola vez,
 * en Enter o al salir del campo (blur), vía `onCommit(title)`. Escape descarta el borrador.
 *
 * Regresión que evita (sesión 15): antes el título se guardaba en cada pulsación y el guardado
 * apagaba el estado de edición → el <input> se desmontaba con cada letra y el foco se perdía.
 * Aquí el <input> vive en `EditingInput`, que se monta al entrar en edición (su borrador arranca
 * del valor real) y se desmonta al salir; teclear solo toca el borrador local, jamás re-guarda.
 */

function EditingInput({
  initial,
  onCommit,
  onCancel,
  className,
  placeholder,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(initial ?? '');
  return (
    <input
      autoFocus
      className={className}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onCommit(draft); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      placeholder={placeholder}
    />
  );
}

export function TitleField({
  value,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
  spanClassName,
  inputClassName,
  placeholder = 'Título de la tarea...',
}: {
  value: string;
  editing: boolean;
  onStartEdit: (e: React.MouseEvent) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  spanClassName?: string;
  inputClassName?: string;
  placeholder?: string;
}) {
  if (editing) {
    return (
      <EditingInput
        initial={value || ''}
        onCommit={onCommit}
        onCancel={onCancel}
        className={inputClassName}
        placeholder={placeholder}
      />
    );
  }
  return (
    <span onClick={onStartEdit} title={value || undefined} className={spanClassName}>
      {value || placeholder}
    </span>
  );
}
