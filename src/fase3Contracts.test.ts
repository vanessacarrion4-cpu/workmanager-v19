// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 — contratos del modelo (§16.16). La mayoría YA están implementados y cableados;
// `reconcileDay` sigue en STUB (rojo a propósito) hasta (c). Estos tests fijan el
// comportamiento correcto y se ponen ROJOS si alguien regresa (p.ej. si el código vuelve a
// leer el status/estimado/etiquetas propios de un contenedor).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Task } from './types';
import {
  containerEstimatedForDay,
  containerRegisteredForDay,
  isContainerCompleteOnDay,
  childrenToToggleOnDay,
  reconcileDay,
  validateTemplate,
  writesOwnStatusOnToggle,
  isCompletedForDay,
  containerDayToggle,
  childrenToMoveWithContainer,
} from './fase3Contracts';
import { groupTasksByTag } from './filters';
import { isTaskCompleted } from './utils';

// 2026-07-13 Lun · 07-15 Mié · 07-16 Jue
const WED = '2026-07-15';
const THU = '2026-07-16';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    blockId: 'b1', title: partial.id, status: 'pending', dueDate: null,
    estimatedMinutes: 0, tags: [], order: 0, subtasks: [],
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Task;
}
const byId = (ts: Task[]) => Object.fromEntries(ts.map(t => [t.id, t]));

// =========================================================================
// Principio (a): el tiempo/estimado del contenedor = suma de sus hijas DEL DÍA;
// nunca cuenta tiempo registrado sobre el propio contenedor.
// =========================================================================
describe('FASE 3 · principio (a) — totales del contenedor por día', () => {
  it('estimado del contenedor = suma SOLO de las hijas del día (no de otros días)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, estimatedMinutes: 15 }),
      task({ id: 'B', parentTaskId: 'C', dueDate: THU, estimatedMinutes: 20 }),
    ]);
    // Mié: solo A (15). Hoy el stub suma A+B = 35.
    expect(containerEstimatedForDay('C', tasks, WED)).toBe(15);
  });

  it('registrado del contenedor NO cuenta el tiempo registrado sobre el propio contenedor', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED }),
    ]);
    const entries = [
      { taskId: 'C', subtaskId: null, date: WED, duration: 90 }, // sobre el contenedor: NO debe contar
      { taskId: 'A', subtaskId: null, date: WED, duration: 10 }, // sobre la hija: sí
    ];
    expect(containerRegisteredForDay('C', tasks, entries, WED)).toBe(10);
  });
});

// =========================================================================
// Principio (b): completado DERIVADO de las hijas del día; el status guardado NO se lee.
// =========================================================================
describe('FASE 3 · principio (b) — completado derivado del contenedor', () => {
  it('completo cuando TODAS las hijas del día están completas', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }), // sin status guardado
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'B', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
    ]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(true);
  });

  it('TRAMPA: status guardado "completed" pero una hija del día pendiente → NO completo (no se lee el campo)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'], status: 'completed' }), // guardado engañoso
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'B', parentTaskId: 'C', dueDate: WED, status: 'pending' }),
    ]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(false);
  });

  it('solo cuentan las hijas DEL DÍA: hija de otro día pendiente no impide completar hoy', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'B', parentTaskId: 'C', dueDate: THU, status: 'pending' }), // otro día
    ]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(true);
  });

  it('CASO REAL 30-jul: 8 hijas del día completas + 2 pendientes → NO completo (aunque status guardado engañe)', () => {
    const subs: Task[] = [];
    for (let i = 0; i < 8; i++) subs.push(task({ id: `done${i}`, parentTaskId: 'C', dueDate: WED, status: 'completed' }));
    subs.push(task({ id: 'ngd', parentTaskId: 'C', dueDate: WED, status: 'pending' }));
    subs.push(task({ id: 'ngdbot', parentTaskId: 'C', dueDate: WED, status: 'pending' }));
    const tasks = byId([
      task({ id: 'C', subtasks: subs.map(s => s.id), status: 'completed' }), // status guardado engañoso
      ...subs,
    ]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(false);
  });

  it('sin NINGUNA hija del día → NO completo (no "verdadero por vacío")', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: THU, status: 'completed' }), // otro día
      task({ id: 'B', parentTaskId: 'C', dueDate: THU, status: 'completed' }), // otro día
    ]);
    // Miércoles no tiene ninguna hija → aunque todas las de otros días estén hechas, NO completo hoy.
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(false);
  });

  it('contenedor sin subtareas → NO completo (no cuenta como derivado-completo)', () => {
    const tasks = byId([task({ id: 'C', subtasks: [] })]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(false);
  });

  it('clicar el contenedor completa SOLO las hijas del día', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED }),
      task({ id: 'B', parentTaskId: 'C', dueDate: THU }),
    ]);
    expect(childrenToToggleOnDay('C', tasks, WED)).toEqual(['A']);
  });
});

// =========================================================================
// (C3, opción B) reconcileDay SIN FUGA — FORMA REAL (contenedores isTemplate:FALSE, 75 de 98).
// Conserva: día + contenedores (sin fecha) + plantillas; descarta solo hojas datadas de otro día.
// NO cableado en activeDayMap (pendiente §16.12).
// =========================================================================
describe('FASE 3 · reconcileDay sin fuga (C3, §16.12)', () => {
  it('excluye una HOJA datada de otro día (isTemplate:false, sin hijas) — la fuga inerte', () => {
    const tasks = byId([
      task({ id: 'X', dueDate: WED }),
      task({ id: 'Y', dueDate: THU }),
    ]);
    const map = reconcileDay(WED, tasks);
    expect(map['X']).toBeDefined();   // del día → se queda
    expect(map['Y']).toBeUndefined(); // otro día, hoja sin hijas → fuera
  });

  it('CONSERVA un contenedor isTemplate:FALSE SIN fecha propia con hija de hoy (un filtro por belongsToDay lo borraría)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'] }),                    // contenedor sin fecha, SIN isTemplate (forma real)
      task({ id: 'A', parentTaskId: 'C', dueDate: WED }),
    ]);
    const map = reconcileDay(WED, tasks);
    expect(map['C']).toBeDefined(); // contenedor conservado aunque belongsToDay(C)=false
    expect(map['A']).toBeDefined(); // hija del día
  });

  it('contenedor isTemplate:false cuyas hijas son de OTRO día: el contenedor se conserva, la hoja de otro día NO', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: THU }),    // hija de otro día
    ]);
    const map = reconcileDay(WED, tasks);
    expect(map['C']).toBeDefined();   // tiene hijas → se conserva (candidato estructural)
    expect(map['A']).toBeUndefined(); // hoja de otro día → fuera
  });

  it('conserva las PLANTILLAS (isTemplate) aunque no sean del día — filterTasksForDay hace allTasksMap[templateId]', () => {
    const tasks = byId([
      task({ id: 'R', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
    ]);
    const map = reconcileDay(WED, tasks);
    expect(map['R']).toBeDefined();
  });

  it('un contenedor vacío (0 hijas vivas), isTemplate:false y sin fecha → NO se conserva (ya no es contenedor)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C', isDeleted: true }),  // única hija borrada
    ]);
    const map = reconcileDay(WED, tasks);
    expect(map['C']).toBeUndefined(); // sin hija viva, sin fecha, no plantilla → fuera
  });
});

// =========================================================================
// (b3) Coherencia de la marca isTemplate (§16.16, modelo corregido): la marca es REGLA recurrente o
// LLAVE del motor para un contenedor que aloja reglas. Un contenedor que aloja reglas es VÁLIDO;
// `hasOwnPauta` mira la pauta PROPIA de la tarea, no la de sus hijas. Solo son inválidas: pauta propia
// + hijas (ambiguo) y plantilla inerte (ni pauta propia ni hijas).
// =========================================================================
describe('FASE 3 · coherencia de la marca isTemplate (§16.16)', () => {
  it('regla (pauta propia, sin hijas) → válido', () => {
    const tasks = byId([task({ id: 'R', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } })]);
    expect(validateTemplate(tasks['R'], tasks)).toBeNull();
  });

  it('contenedor (hijas, sin pauta propia) → válido', () => {
    const tasks = byId([
      task({ id: 'C', isTemplate: true, subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C' }),
    ]);
    expect(validateTemplate(tasks['C'], tasks)).toBeNull();
  });

  it('pauta PROPIA Y hijas a la vez → INVÁLIDO', () => {
    const tasks = byId([
      task({ id: 'X', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' }, subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'X' }),
    ]);
    expect(validateTemplate(tasks['X'], tasks)).not.toBeNull();
  });

  it('ni pauta ni hijas → INVÁLIDO (plantilla inerte)', () => {
    const tasks = byId([task({ id: 'Z', isTemplate: true })]);
    expect(validateTemplate(tasks['Z'], tasks)).not.toBeNull();
  });

  it('tarea normal (no template) → null (no aplica)', () => {
    const tasks = byId([task({ id: 'N' })]);
    expect(validateTemplate(tasks['N'], tasks)).toBeNull();
  });
});

// =========================================================================
// (b4) Campos MUERTOS del contenedor (§16.16): se guardan pero se IGNORAN.
// Rojo si alguien vuelve a leer el estimado/registrado/etiquetas PROPIOS del contenedor.
// =========================================================================
describe('FASE 3 · campos muertos del contenedor (§16.16)', () => {
  it('estimado: se IGNORA el estimado propio del contenedor (se usa la suma de hijas)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'], estimatedMinutes: 999 }), // estimado propio engañoso
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, estimatedMinutes: 15 }),
    ]);
    expect(containerEstimatedForDay('C', tasks, WED)).toBe(15); // 15, NO 999 ni 1014
  });

  it('registrado: se IGNORA el tiempo registrado sobre el propio contenedor', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED }),
    ]);
    const entries = [
      { taskId: 'C', subtaskId: null, date: WED, duration: 999 }, // sobre el contenedor
      { taskId: 'A', subtaskId: null, date: WED, duration: 10 },  // sobre la hija
    ];
    expect(containerRegisteredForDay('C', tasks, entries, WED)).toBe(10); // 10, NO 999 ni 1009
  });

  it('etiquetas: el contenedor se agrupa por las etiquetas de las HIJAS, no por las suyas', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'], tags: ['espera'] as any }),         // etiqueta propia engañosa
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, tags: ['focus'] as any }),
    ]);
    const groups = groupTasksByTag([tasks['C']], tasks, WED, { hideCompleted: false, hideDelegatedNoTag: false });
    expect(groups.focus.some((g: any) => g.task.id === 'C')).toBe(true);   // aparece por la hija (focus)
    expect(groups.espera.some((g: any) => g.task.id === 'C')).toBe(false); // NO por la suya (espera)
  });
});

// =========================================================================
// (caso a, sesión 18) — el CONTENEDOR no escribe su status propio + transición vaciado → hoja → status.
// FORMA REAL: contenedores isTemplate:FALSE (75 de 98), la que nunca se probó y la que fallaba en pantalla.
// =========================================================================
describe('FASE 3 · el contenedor no escribe su status propio (§16.16, caso a)', () => {
  it('contenedor (isTemplate:FALSE, con hijas) → NO escribe su status propio al togglear', () => {
    const c = task({ id: 'C', subtasks: ['A'] }); // SIN isTemplate: la forma real (mayoría)
    expect(writesOwnStatusOnToggle(c)).toBe(false);
  });

  it('hoja → SÍ escribe su status propio (es su única fuente de completado)', () => {
    expect(writesOwnStatusOnToggle(task({ id: 'A', parentTaskId: 'C' }))).toBe(true);
  });

  it('solo instancias generadas (inst-…) NO cuentan como hijas reales → hoja', () => {
    expect(writesOwnStatusOnToggle(task({ id: 'C', subtasks: ['inst-x-2026-07-15'] }))).toBe(true);
  });

  it('TRANSICIÓN caso (a): con hijas el completado se DERIVA (status propio ignorado); al VACIARSE cae a hoja y se lee el status → por eso nadie debe escribirlo', () => {
    // CON hijas: status propio 'completed' engañoso, pero completa DERIVA (hija pendiente → no completo).
    const conHijas = byId([
      task({ id: 'C', subtasks: ['A'], status: 'completed' }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'pending' }),
    ]);
    expect(writesOwnStatusOnToggle(conHijas['C'])).toBe(false); // no escribe → no siembra la mina
    expect(isTaskCompleted('C', conHijas)).toBe(false);         // derivado: hija pendiente

    // VACIADO con status viejo 'completed' → HOJA: isTaskCompleted cae al status propio = EL SÍNTOMA.
    const vaciadoSucio = byId([task({ id: 'C', subtasks: [], status: 'completed' })]);
    expect(writesOwnStatusOnToggle(vaciadoSucio['C'])).toBe(true); // ya es tarea normal
    expect(isTaskCompleted('C', vaciadoSucio)).toBe(true);         // ← lee el status viejo → salía tachado

    // ARREGLO: como el contenedor nunca escribe 'completed', al vaciarlo su status es 'pending' → no tachado
    // (el dato legado se normaliza aparte, bloque 2).
    const vaciadoLimpio = byId([task({ id: 'C', subtasks: [], status: 'pending' })]);
    expect(isTaskCompleted('C', vaciadoLimpio)).toBe(false);
  });
});

// =========================================================================
// (b3) Completado POR DÍA para filtros/contadores (§16.16). FORMA REAL: contenedores isTemplate:FALSE.
// El caso que cambia en pantalla: "ocultar completadas" en Mi Día ahora mira el día, no todas las hijas.
// =========================================================================
describe('FASE 3 · (b3) completado por día para "ocultar completadas" (§16.16)', () => {
  it('hijas de HOY hechas + una hija de OTRO día pendiente → completo HOY (antes NO se ocultaba)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'B', parentTaskId: 'C', dueDate: THU, status: 'pending' }), // otro día
    ]);
    expect(isCompletedForDay('C', tasks, WED)).toBe(true);  // por día → se oculta
    expect(isTaskCompleted('C', tasks)).toBe(false);        // criterio viejo (todas) → NO se ocultaba
  });

  it('una hija de HOY pendiente → NO completo HOY (se muestra)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'pending' }),
    ]);
    expect(isCompletedForDay('C', tasks, WED)).toBe(false);
  });

  it('sin ninguna hija HOY → NO completo (no cuenta como completo por vacío)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: THU, status: 'completed' }),
    ]);
    expect(isCompletedForDay('C', tasks, WED)).toBe(false);
  });

  it('hoja → por su propio status', () => {
    expect(isCompletedForDay('L', byId([task({ id: 'L', dueDate: WED, status: 'completed' })]), WED)).toBe(true);
  });
});

// =========================================================================
// (C1) selección día-scoped para contenedor MANUAL (isTemplate:false): el clic togglea SOLO las hijas del día.
// Para el contenedor con hijas recurrentes (isTemplate:true) la selección va por materializeDay (ver instanceEngine.test).
// =========================================================================
describe('FASE 3 · (C1) contenedor manual: togglear solo las hijas del día (§16.16)', () => {
  it('childrenToToggleOnDay da SOLO la hija del día, no la de otro día', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),                       // contenedor manual (isTemplate:false)
      task({ id: 'A', parentTaskId: 'C', dueDate: WED }),           // hija de hoy
      task({ id: 'B', parentTaskId: 'C', dueDate: THU }),           // hija de otro día
    ]);
    expect(childrenToToggleOnDay('C', tasks, WED)).toEqual(['A']);  // marcar/desmarcar en WED → solo A
    expect(childrenToToggleOnDay('C', tasks, THU)).toEqual(['B']);  // en THU → solo B
  });
});

// =========================================================================
// (C1) containerDayToggle — EL CAMINO REAL del clic (handleToggleStatus lo LLAMA). Los 2 bugs de C1 vivían
// en esta selección. Cubre los dos tipos de contenedor + el mixto, marcar/desmarcar, y que no toque otro día.
// =========================================================================
describe('FASE 3 · (C1) containerDayToggle: selección real del clic (§16.16)', () => {
  const idsOf = (r: any) => (r ? r.children.map((c: any) => c.id).sort() : null);

  it('contenedor MANUAL (isTemplate:false): togglea solo la hija del día; dirección=completar si hay pendiente', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'pending' }),
      task({ id: 'B', parentTaskId: 'C', dueDate: THU, status: 'pending' }), // otro día
    ]);
    const r = containerDayToggle(tasks['C'], tasks, WED)!;
    expect(idsOf(r)).toEqual(['A']);        // solo la de WED, no B
    expect(r.status).toBe('completed');     // hay pendiente → marcar
  });

  it('contenedor MANUAL: si la hija del día ya está completa → dirección=desmarcar (pending)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
    ]);
    expect(containerDayToggle(tasks['C'], tasks, WED)!.status).toBe('pending');
  });

  it('contenedor TEMPLATE (isTemplate:true) con hija recurrente + manual de otro día: solo la recurrente del día', () => {
    const tasks = byId([
      task({ id: 'C', isTemplate: true, subtasks: ['rec', 'man-thu'] }),
      task({ id: 'rec', parentTaskId: 'C', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({ id: 'man-thu', parentTaskId: 'C', isTemplate: false, dueDate: THU }),
    ]);
    const r = containerDayToggle(tasks['C'], tasks, WED)!;
    expect(idsOf(r)).toEqual(['inst-rec-2026-07-15']); // instancia recurrente de WED, NO man-thu
  });

  it('contenedor MIXTO (template): manual del día + recurrente del día + manual de OTRO día → solo las 2 de WED', () => {
    const tasks = byId([
      task({ id: 'C', isTemplate: true, subtasks: ['man-wed', 'rec', 'man-thu'] }),
      task({ id: 'man-wed', parentTaskId: 'C', isTemplate: false, dueDate: WED }),
      task({ id: 'rec', parentTaskId: 'C', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({ id: 'man-thu', parentTaskId: 'C', isTemplate: false, dueDate: THU }),
    ]);
    const r = containerDayToggle(tasks['C'], tasks, WED)!;
    expect(idsOf(r)).toEqual(['inst-rec-2026-07-15', 'man-wed']); // WED manual + WED recurrente; NO man-thu
  });

  it('DESMARCAR mixto: si TODAS las del día están completas → pending; y sigue sin tocar otro día', () => {
    const tasks = byId([
      task({ id: 'C', isTemplate: true, subtasks: ['man-wed', 'rec', 'man-thu'] }),
      task({ id: 'man-wed', parentTaskId: 'C', isTemplate: false, dueDate: WED, status: 'completed' }),
      task({ id: 'rec', parentTaskId: 'C', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      // excepción persistida COMPLETADA de la recurrente en WED (para que "todas las del día" estén completas)
      task({ id: 'inst-rec-2026-07-15', templateId: 'rec', parentTaskId: null, dueDate: WED, instanceDate: WED, status: 'completed', isException: true }),
      task({ id: 'man-thu', parentTaskId: 'C', isTemplate: false, dueDate: THU, status: 'completed' }),
    ]);
    const r = containerDayToggle(tasks['C'], tasks, WED)!;
    expect(idsOf(r)).toEqual(['inst-rec-2026-07-15', 'man-wed']); // solo WED
    expect(r.status).toBe('pending');                              // todas WED completas → desmarcar
  });

  it('sin día (Bloques) → null (el hook usa el camino de todas las hijas)', () => {
    const tasks = byId([task({ id: 'C', subtasks: ['A'] }), task({ id: 'A', parentTaskId: 'C', dueDate: WED })]);
    expect(containerDayToggle(tasks['C'], tasks, null)).toBeNull();
  });

  it('hoja (sin hijas) → null', () => {
    const tasks = byId([task({ id: 'L', dueDate: WED })]);
    expect(containerDayToggle(tasks['L'], tasks, WED)).toBeNull();
  });
});

// =========================================================================
// b2 — al mover un contenedor MANUAL, sus hijas de fila real viajan con él
// (childrenToMoveWithContainer). Las recurrentes no actuadas NO (se regeneran).
// =========================================================================
describe('childrenToMoveWithContainer (arrastre al mover contenedor)', () => {
  it('contenedor manual con 2 hijas manuales del día → arrastra las 2', () => {
    const tasks = byId([
      task({ id: 'C', dueDate: WED, subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED }),
      task({ id: 'b', parentTaskId: 'C', dueDate: WED }),
    ]);
    expect(childrenToMoveWithContainer(tasks['C'], tasks, WED).sort()).toEqual(['a', 'b']);
  });

  it('no arrastra hijas de OTRO día', () => {
    const tasks = byId([
      task({ id: 'C', dueDate: WED, subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED }),
      task({ id: 'b', parentTaskId: 'C', dueDate: THU }), // otro día → se queda
    ]);
    expect(childrenToMoveWithContainer(tasks['C'], tasks, WED)).toEqual(['a']);
  });

  it('no arrastra hijas borradas', () => {
    const tasks = byId([
      task({ id: 'C', dueDate: WED, subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED }),
      task({ id: 'b', parentTaskId: 'C', dueDate: WED, isDeleted: true }),
    ]);
    expect(childrenToMoveWithContainer(tasks['C'], tasks, WED)).toEqual(['a']);
  });

  it('excepción recurrente ACTUADA (fila real) del día → viaja; la no actuada no está (no es fila real)', () => {
    const tasks = byId([
      task({ id: 'C', dueDate: WED, subtasks: ['man'] }),
      task({ id: 'man', parentTaskId: 'C', dueDate: WED }), // manual
      task({ id: 'rule', isTemplate: true, parentTaskId: 'C', recurrence: { frequency: 'daily', startDate: WED } as any }),
      // excepción actuada de esa regla, con fila real ese día:
      task({ id: 'inst-rule-' + WED, templateId: 'rule', isException: true, dueDate: WED, instanceDate: WED }),
    ]);
    const ids = childrenToMoveWithContainer(tasks['C'], tasks, WED).sort();
    expect(ids).toEqual(['inst-rule-' + WED, 'man']);
  });

  it('sin oldDate o sin contenedor → []', () => {
    const tasks = byId([task({ id: 'C', dueDate: WED, subtasks: [] })]);
    expect(childrenToMoveWithContainer(tasks['C'], tasks, null)).toEqual([]);
    expect(childrenToMoveWithContainer(null, tasks, WED)).toEqual([]);
  });
});
