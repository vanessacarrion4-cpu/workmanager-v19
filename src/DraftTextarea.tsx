import React, { useState, useRef, useEffect } from 'react';

/**
 * DraftTextarea — campo de texto largo con BORRADOR LOCAL (§16.130).
 *
 * Mientras se escribe NO se guarda. El guardado (`onCommit`) ocurre al SALIR del campo, tras un
 * rato de inactividad, o al desmontarse el campo con cambios sin guardar. Mismo criterio que
 * TitleField (sesión 15): guardar en cada pulsación es siempre un error.
 *
 * Regresión que evita: la nota de una reunión llamaba a `onUpdateMeetings` en CADA TECLA, y esa
 * función escribía en Supabase. Cada letra era una escritura (y, hasta §16.130, también un barrido
 * que borraba filas). Con llamadas async solapadas, la última en llegar pisaba a la anterior y el
 * texto se perdía.
 *
 * El borrador arranca del valor de montaje y no se resincroniza solo: si el padre re-renderiza
 * mientras se escribe, lo tecleado manda. Quien monte/desmonte el campo (abrir o cerrar la nota)
 * decide cuándo se relee el valor real.
 */
export function DraftTextarea({
  initial,
  onCommit,
  retardoMs = 1200,
  autoFocus,
  placeholder,
  className,
  rows = 1,
  autoGrow = true,
}: {
  initial: string;
  onCommit: (value: string) => void;
  retardoMs?: number;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  rows?: number;
  autoGrow?: boolean;
}) {
  const [draft, setDraft] = useState(initial ?? '');
  const timer = useRef<any>(null);
  const guardado = useRef(initial ?? '');   // último valor ya guardado
  const pendiente = useRef(initial ?? '');  // lo que hay escrito ahora mismo
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const commit = (v: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (v === guardado.current) return;     // nada que guardar
    guardado.current = v;
    commitRef.current(v);
  };

  // al desmontar (se pliega la nota, se cierra la reunión…) no se pierde lo escrito
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pendiente.current !== guardado.current) commitRef.current(pendiente.current);
  }, []);

  return (
    <textarea
      autoFocus={autoFocus}
      value={draft}
      rows={rows}
      placeholder={placeholder}
      className={className}
      onChange={e => {
        const v = e.target.value;
        setDraft(v);
        pendiente.current = v;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), retardoMs);
      }}
      onBlur={() => commit(pendiente.current)}
      onInput={autoGrow ? (e: any) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; } : undefined}
    />
  );
}
