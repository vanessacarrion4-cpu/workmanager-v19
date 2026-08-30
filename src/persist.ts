// ─────────────────────────────────────────────────────────────────────────────
// Avisos (B1): helper de persistencia. Envuelve una escritura de Supabase para que,
// si falla, NO se quede muda: log a consola (para depurar) + aviso visible (toast).
//
// NO cambia el comportamiento optimista de la UI: el cambio ya se pintó en pantalla.
//
// ⚠️ PROVISIONAL: el mensaje reconoce que "el cambio se ve pero puede no haberse
// guardado". El B2 de la FASE 3 revertirá el estado local cuando la escritura falle,
// y entonces habrá que REESCRIBIR este mensaje (ya no se verá el cambio).
// ─────────────────────────────────────────────────────────────────────────────
import { toast } from './toast';

// ─────────────────────────────────────────────────────────────────────────────
// deletionStamp (§16.70) — ÚNICA fuente de verdad de los campos de un BORRADO DE CARA AL
// USUARIO (lo que debe poder recuperarse desde la PAPELERA). La papelera filtra por
// `deleted_at` (useDeletedTasks); un `is_deleted:true` SIN `deleted_at` es invisible ahí.
// Con ~7 caminos de borrado escribiendo por su cuenta, siempre había uno que se olvidaba
// del sello (el borrado en lote → 151 tareas perdidas). Centralizando SOLO el conjunto de
// campos (no la operación: unas hacen UPDATE .eq(id), otras UPSERT de fila-excepción, otras
// cascada — son distintas de verdad), un campo nuevo de borrado se añade UNA vez y lo heredan
// todos los caminos que sí sellan.
//
// ⚠️ Los caminos que a propósito NO sellan (dejan `is_deleted:true` PELADO, sin llamar a esto)
// son decisión documentada, no olvido — llevan comentario en su sitio:
//   · split de pauta F5-6 (useTaskCRUD): re-partición interna, no un borrado tuyo.
//   · "terminar la rutina" / _termIntact (App.tsx, useTaskCRUD): ocurrencias futuras que dejan
//     de existir, no algo que tiraste; sellarlas metería decenas por rutina en la papelera.
//     → Cómo lo notarías: si un día echas en falta una ocurrencia FUTURA de una rutina que
//       TERMINASTE, es esto (salió de la serie a propósito), no un fantasma ni un borrado.
//   · subtarea MOVIDA de fecha (useTaskCRUD): el id viejo se marca is_deleted para suprimirlo,
//     pero NO se sella → mover no es borrar (si sellara, un movido saldría en la papelera como
//     borrado y "recuperarlo" duplicaría la tarea).
export const deletionStamp = (ts: string) => ({ is_deleted: true, deleted_at: ts, modified_at: ts });

const DETALLE_PROVISIONAL =
  'El cambio se ve en pantalla, pero puede no haberse guardado. Recarga para comprobar.'; // ← PROVISIONAL (B2/FASE 3)

export interface PersistCtx {
  verbo: string;     // acción en infinitivo: "guardar", "crear", "borrar", "restaurar"...
  titulo?: string;   // nombre del elemento afectado, si se conoce
  singular?: string; // "la tarea" (por defecto)
  plural?: string;   // "tareas" (por defecto) — para el aviso agrupado por contador
  key?: string;      // clave de agrupación; por defecto `persist:${verbo}:${plural}`
}

// Dispara el aviso de error (agrupable). Úsalo suelto en los catch de escrituras await.
export function reportPersistError(ctx: PersistCtx) {
  const singular = ctx.singular ?? 'la tarea';
  const plural = ctx.plural ?? 'tareas';
  const label = ctx.titulo ? `«${ctx.titulo}»` : singular;
  const key = ctx.key ?? `persist:${ctx.verbo}:${plural}`;
  // Agrupa por `key`: si en una acción en lote fallan 20 filas, un solo aviso "×20".
  toast.error(
    (n: number) => (n === 1
      ? `No se pudo ${ctx.verbo} ${label}.`
      : `No se pudieron ${ctx.verbo} ${n} ${plural}.`),
    { key, detail: DETALLE_PROVISIONAL },
  );
}

// Envuelve una escritura fire-and-forget (el query builder de Supabase es un thenable
// que resuelve a `{ error }`). Sustituye a `.then(({error}) => console.error(...))`.
export function persist(query: PromiseLike<{ error: any }>, ctx: PersistCtx): void {
  Promise.resolve(query).then(
    ({ error }) => { if (error) { console.error('[PERSIST]', ctx.verbo, ctx.titulo ?? '', error); reportPersistError(ctx); } },
    (err) => { console.error('[PERSIST]', ctx.verbo, ctx.titulo ?? '', err); reportPersistError(ctx); },
  );
}
