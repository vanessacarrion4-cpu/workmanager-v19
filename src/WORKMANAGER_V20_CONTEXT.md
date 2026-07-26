# WorkManager v20 — Documento de Contexto Completo

> Usar este documento al inicio de cada sesión de desarrollo para dar contexto completo al asistente.
> Última actualización: 26/07/2026 (sesión 11 — #1 promote/demote cerrado; plan del PASO FINAL fijado)
>
> **ESTADO**: V19 en producción. V20 en curso en la rama `refactor-v20`.
> Las secciones marcadas 🔴 describen el estado actual (a corregir); las marcadas 🟢 el objetivo.
>
> 👉 **¿RETOMANDO? EMPIEZA POR LA §13** — ahí está el estado exacto, el plan del paso final
> (retirar `useGeneration` + reactivar interacción + bug #20) y cómo arrancar.

---

## 1. Stack y Repositorio

- **Framework**: React + TypeScript + Vite + Tailwind CSS + Framer Motion + lucide-react
- **Base de datos**: Supabase (PostgreSQL via PostgREST)
- **Repo**: `vanessacarrion4-cpu/workmanager-v19` (GitHub)
- **Deploy**: Vercel CI/CD automático desde rama `master`
- **URL producción**: `workmanager-v19.vercel.app`
- **Supabase URL**: `yewfmfoljidvrxvbrsdv.supabase.co`
- **Puerto desarrollo local**: `http://localhost:3001` (CMD como administrador, no PowerShell)
- **Escala real**: ~49 tareas/día, jerarquía padre→hija en la mayoría

---

## 2. Estructura de Archivos (src/)

Igual que V19, con estos cambios previstos:

```
NUEVOS:
├── instanceEngine.ts            # 🟢 occursOn() + materializeDay() — motor único
├── Toast.tsx                    # 🟢 Avisos no bloqueantes + deshacer

ELIMINAR:
├── generation.worker.ts         # 🟢 innecesario (materializeDay es instantáneo)
├── useGeneration.ts             # 🟢 innecesario (no hay pre-generación)
├── useSupabaseData.ts           # 🔴 legacy, duplica useSupabase, mapea Block sin
                                 #    pastelColor ni isActive → BORRAR
```

---

## 3. Tablas Supabase

Sin cambios respecto a V19. Recordatorios críticos:

- `tasks` NO tiene columna `subtasks` → se reconstruye en memoria desde `parent_task_id`
- ⚠️ **REVISAR**: existe una tabla `task_subtasks` en Supabase. Aclarar en la 1ª sesión de Code si la jerarquía se guarda ahí (además de/en vez de `parent_task_id`). Afecta directamente a cómo `materializeDay` reconstruye contenedores.
- Tablas reales en Supabase (9): `tasks`, `work_blocks`, `time_entries`, `persons`, `task_subtasks`, `attachments`, `meetings`, `delegation_meetings`, `delegation_meeting_items`
- ⚠️ **SEGURIDAD**: `tasks` y `work_blocks` están marcadas `UNRESTRICTED` (sin RLS). OK para uso personal actual; **imprescindible activar RLS antes de cualquier publicación o multiusuario**.
- `tasks` NO tiene `updated_at`, solo `created_at` y `modified_at`
- `time_entries.task_id` NO tiene FK activa contra `tasks`
- `order` es palabra reservada en Postgres — verificar que la columna esté entrecomillada

**Campos nuevos en `tasks` para V20:**

| BD | Código | Uso |
|----|--------|-----|
| `blocked_by` | `blockedBy?: string[]` | IDs de tareas que bloquean a esta |
| `deadline` | `deadline?: string` | Fecha límite propia (YYYY-MM-DD) |

---

## 4. Modelo de Datos — Tipo Task (V20)

Igual que V19 con estos cambios:

```typescript
Task {
  // ... campos V19 ...

  // AÑADIR:
  blockedBy?: string[]        // 🟢 IDs de tareas bloqueantes
  deadline?: string           // 🟢 fecha límite propia YYYY-MM-DD
  existsInSupabase?: boolean  // 🔴 se usa en 4 archivos pero NO está en el tipo

  // ELIMINAR:
  priority: 'alta'|'media'|'baja'  // 🟢 no aporta, compite con los tags
}
```

**Jerarquía: máximo 2 niveles.** Contenedor + subtareas. Se retira el nivel 3
(promote/demote a nivel 3 concentra la mitad de los bugs para un valor dudoso).

---

## 5. Arquitectura de Recurrencia

### 🔴 Problema actual

`generateInstances` es **O(días × templates × hijos × TODAS_las_tareas)**. Dentro del
bucle de días, por cada template y cada hijo, hace `Object.values(allTasks).find(...)`
tres veces. Con la ventana anual (430 días):

```
430 días × 20 templates × 5 hijos × 3 escaneos × 3000 tareas ≈ 387 MILLONES de ops
```

**Esta es la causa de la lentitud, no Supabase.**

Agravantes:
1. `generation.worker.ts` duplica el mismo escaneo dos veces
   (`hasMovedExceptionsToday` y `hasExceptionMovedToThisDay` son idénticos)
2. **El worker y `utils.ts` han DIVERGIDO** — son dos copias que ya no hacen lo mismo:

   | | `utils.ts` | `generation.worker.ts` |
   |---|---|---|
   | `if (!childTemplate.isTemplate) return` | ✅ | ❌ |
   | subtarea manual → push del id real | ✅ | ❌ |
   | `exceptionForThisDay` busca instanceDate OR dueDate | ✅ | ❌ solo instanceDate |
   | `movedAwayException` | ❌ | ✅ |

   El worker es el que se ejecuta (useGeneration). `utils.ts::generateInstances` solo
   lo usa `Modals.tsx` → **el modal de instancias muestra cosas distintas del Dashboard**.
3. Un solo template anual → `DAYS_FUTURE_YEARLY = 400` para toda la app (×7 de trabajo)

### 🟢 Arquitectura V20: dos motores

**Motor A — `occursOn(template, fecha) → boolean`** (función pura, no genera nada)

Para **Semana, Carga y Calendario**. No hacen falta instancias para computar tiempos:
solo saber *si toca* y *cuánto estima*.

```
carga(día) = Σ templates que ocurren ese día × minutos estimados
           + tareas manuales de ese día
           ± excepciones de ese día
```

Cero objetos creados. Permite proyección ilimitada (recurrencia sin límite temporal).

**Motor B — `materializeDay(fecha) → instancias`**

Solo para el **día activo** del Dashboard. Genera las instancias reales de **1 día**,
que es lo que se necesita para marcar completado y asignar tiempo. Persiste en Supabase
solo cuando se toca algo (ahí nace la excepción).

Con caché por día:
```ts
const dayCache = useRef(new Map<string, Task[]>());
```
Opcionalmente pre-generar ±3 días en `requestIdleCallback`.

**Optimización obligatoria en ambos**: indexar excepciones **una vez antes del bucle**:
```ts
const exceptionsByTemplate = new Map<string, Task[]>();
Object.values(allTasks).forEach(t => {
  if (t.templateId && t.isException && !t.isDeleted) {
    if (!exceptionsByTemplate.has(t.templateId)) exceptionsByTemplate.set(t.templateId, []);
    exceptionsByTemplate.get(t.templateId)!.push(t);
  }
});
```
De 387M a ~40K operaciones. Mejora ~10.000×.

### Qué desaparece con V20

| V19 | V20 |
|---|---|
| 430 días en memoria | 1 día |
| Web Worker | innecesario (instantáneo) |
| `MAX_GENERATION_CYCLES = 20` | innecesario (no hay bucle) |
| 3 pasadas de reconstrucción | innecesarias |
| `existsInSupabase` | innecesario |
| Reparaciones en cada F5 | script único, una vez |
| Dos `generateInstances` divergentes | un `occursOn` + un `materializeDay` |

### Reglas que se mantienen

1. Los **contenedores** NUNCA tienen `recurrence`, `dueDate`, `dueTime`, `tags`, ni `delegation`
2. La **recurrencia va solo en las subtareas** (nivel 2)
3. Las **instancias normales NO se guardan** en Supabase
4. Solo se guardan si `isException: true`
5. **Recurrencia anual**: usa `yearDay` + `yearMonth`
6. IDs de instancia: `inst-{templateId}-{YYYY-MM-DD}`
   Extraer templateId: `id.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')`
   ⚠️ El regex `/^inst-(t-\d+)/` es INCORRECTO (los templateId llevan letras)

---

## 6. Bugs conocidos a corregir

### 🔴 Críticos

| # | Archivo | Problema |
|---|---|---|
| 1 | `useTaskOrdering.ts` | ✅ **RESUELTO** (commit `83a7301`, validado en vivo). `handlePromoteTask`/`handleDemoteTask` ahora persisten `parent_task_id` en Supabase tras el `setTasks`. Ver §5B "PLAN CERRADO #1". |
| 2 | `useBlockHandlers.ts` | `handleDeleteBlock` **NO persiste**. El bloque reaparece al recargar. |
| 3 | `useTaskOrdering.ts` | `handleExpandAllInBlock` **muta el estado** (`t.isExpanded = expand` sobre objetos compartidos) → React no re-renderiza. |
| 4 | `useTaskOrdering.ts` | `handleToggleExpandTask` escribe con `.eq('id', taskId)` donde taskId puede ser `inst-...` (fila inexistente). **Causa del bug "despliega la de arriba"**. |
| 5 | `useSupabase.ts` | `reconstructInstanceHierarchy` empareja por ID construido → cuando `dueDate ≠ instanceDate` engancha al contenedor equivocado. Segunda causa del bug de desplegar. |
| 6 | `useBulkActions.ts` | `bulkDuplicateTasks` hace `duplicates.push()` **dentro** del updater de `setTasks`. Con StrictMode se ejecuta 2× → **inserts duplicados en Supabase**. |
| 7 | `useBulkActions.ts` | `bulkUpdateTasks` usa `activeDate` pero **no está en las deps** del useCallback → closure stale al cambiar de día. |
| 8 | `useTimerHandlers.ts` | `handleStartTimer` llama a `handleStopTimer` **antes de definirlo** (TDZ) → `ReferenceError`. |
| 9 | `useTimerHandlers.ts` | `resolveId` hace `parts.pop()` 3× a ciegas → rompe con templateId que contengan guiones. Usar regex. |
| 10 | `useGeneration.ts` | Effect depende de `[isDataLoaded, templateKey]` pero lee `tasks` → closure stale. Y `setTasks(cleaned)` corre en paralelo con `postMessage(tasksForWorker)` → datos divergentes. El bloque `preserved` es código muerto. |

### 🟡 Funcionales

| # | Descripción |
|---|---|
| 11 | `isTaskCompleted` recibe `instanceDate` y **nunca lo usa** → un contenedor se marca completo según subtareas de TODOS los días. |
| 12 | `filters.ts::getStatsForDay` suma `registered` de todos los timeEntries sin filtrar por bloque activo → descuadre con los estimados. |
| 13 | `useSupabase.ts::repairRecurringContainers` **escribe en Supabase en cada carga** sin comprobar si hace falta. Riesgo de bucle de escrituras. |
| 14 | `handleResetData` está bajo el icono ⚙️ "Configuración" y **borra todo** con un `confirm()`. Trampa mortal. |
| 15 | `useTaskOrdering::handleUpdateTasksOrder` escribe el `order` en el **template** al reordenar instancias → reordenar un día cambia **todos** los días. |
| 16 | Tiempos registrados descuadran tras F5: `handleTimerStopConfirm` guarda `taskId` de instancia en memoria y resuelto en BD. |
| 17 | `handleUploadAttachment` (useTimerHandlers) sube el fichero al storage y actualiza `task.attachments`, pero **el adjunto no persiste** — al recargar desaparece. Detectado por la usuaria al usar la app, NO por lectura de código. Verificar si escribe en la tabla `attachments`. |

---

## 7. Especificación de UI V20

### 7.1 Densidad de fila

**Problema**: cada fila lleva 9 chips con `border-2` + `bg-color/10` + `font-black` +
`uppercase` + `tracking-widest`, en dos líneas (título arriba, chips abajo).
Con 49 tareas → 12 caben en pantalla.

**Solución**: una sola línea horizontal, chips sin borde ni fondo (solo color de texto).

| | V19 | V20 |
|---|---|---|
| Alto de fila | 52px | **29px** |
| Tareas en pantalla | 12 | **21** |
| Chips perdidos | — | **0** |

### 7.2 Chips por tipo de fila

**Fila de subtarea (hija):**
`checkbox · tipo · [fecha*] · hora · recurrencia · etiqueta · delegación · estimado · registrado · bloque · ↗`
+ en hover: `▶ ✎ 🗑 +`

\* La fecha NO se muestra en el Dashboard del día (redundante). SÍ en las demás vistas.

**Fila de contenedor (padre):** solo 4 chips
`checkbox · tipo · título + nº hijas · estimado (suma) · registrado (suma) · bloque · + (fijo) · ↗`

Los tiempos del padre son **suma de las hijas, no editables**.
El padre NO lleva: hora, recurrencia, etiqueta, fecha, delegación.

**Fila completada:** una línea gris tachada con `30m → 22m` (estimado → real).

### 7.3 Estado de los chips

- **Con valor**: color pleno, sin borde. `15m` en azul, `11:30` en turquesa, `L-V` en morado.
- **Vacío**: borde **punteado** finísimo, icono en gris. Visible, clicable, silencioso.
  Permite detectar de un vistazo qué tareas están a medio definir.
- **Registrado**: SIEMPRE visible (es la puerta de entrada para registrar tiempo).
  `0m` en morado tenue, `8m` en morado pleno.
- **Borde izquierdo de color del bloque**: se mantiene (ancla visual).

### 7.4 Zona de diagnóstico superior (VERSIÓN FINAL acordada)

Reemplaza las 3 tarjetas de stats actuales. **Con aire, no apelotonada.**
Navegación de fecha arriba (‹ Miércoles 15 julio › + 📅 salto a fecha).

**Visible siempre — 4 cifras:**
```
Faltan 34                                    Pendiente
15 hechas de 49                                6h 58m
████████░░░░░░░░░░░░░░░░░░░░░░

Completado 1h 45m estimado    Registrado hoy 1h 10m  [✓ 35m mejor]
```

- `Faltan 34` grande (34px, font-black) — lo único que grita
- `Pendiente 6h 58m` (azul #3B82F6) — trabajo estimado que queda
- `Completado 1h 45m estimado` — estimado de lo ya hecho
- `Registrado hoy 1h 10m` (morado) con el `✓ 35m mejor` al lado (compara registrado vs estimado de lo completado)
- **NO** poner jornada configurable, "me quedan Xh", ni semáforo "cabe/no cabe" → la usuaria los descartó
- **NO** duplicar el registrado (aparece una sola vez)
- Sin porcentajes de progreso salvo la barra

**Desplegable (botón "Desglose ⌄"):**
- **Por tipo**: Puesto (core, esmeralda #10B981) vs Puntual (ad-hoc, ámbar #F59E0B), con barra y %
- **Por bloque**: cada bloque con su color, barra y minutos
- Superreducido, informativo

El punto de tipo de cada fila usa estos colores (core esmeralda / adhoc ámbar),
NO el rosa de prioridad (priority se elimina).

### 7.5 Orden de grupos en Mi Día

**con hora → focus → dirección → en espera → resto**

- `dirección` **sin hora** (es una etiqueta, la hora la sabe el usuario y cambia)
- `en espera` con antigüedad del más antiguo: `la más antigua 12d`
- `resto` con `sin reasignar` (recuerda que es bandeja de entrada, no categoría)
- Cada cabecera con: icono, nombre, `X TAREAS`, `🕐 tiempo estimado pendiente`

### 7.6 Lo que se mantiene intacto

- Contraer/expandir cada grupo de etiqueta
- Ver / no ver completadas (por defecto ocultas; sirven para repasar o reabrir)
- Contraer/expandir padres e hijas (individual y global)
- Por etiqueta: total de tareas + tiempo estimado pendiente
- Ir al bloque desde cualquier tarea (`↗`)
- Editar entrando al modal **o** desde fuera con los chips
- Registrar tiempo desde la tarjeta
- Arrastre para reordenar
- Todo esto en **todas** las vistas

### 7.7 Decisiones descartadas (no reabrir)

| Descartado | Motivo |
|---|---|
| Bloque "Ahora" | Con 49 tareas agrupadas por etiqueta+padre, la estructura ya hace ese trabajo |
| Modo Planificar / Modo Trabajar | Misma capacidad en ambos → el toggle solo obliga a recordar en cuál estás |
| Ver mañana junto a hoy | No aporta |
| Carga por persona (delegadas) | Los tiempos estimados son de control, no de ejecución del delegado |
| Bandeja "esperando respuesta" | Lo que se espera se gestiona activo, no queda como delegado |
| `espera` como estado en vez de etiqueta | Como etiqueta no genera ruido en el día a día |
| Herencia de datos padre→hija al convertir en contenedor | Cada hija hace cosas distintas |

### 7.8 Tipografía

**Problema**: `font-black` (900) en todas partes → cuando todo grita, nada destaca.

| Nivel | Uso | Peso | Tamaño |
|---|---|---|---|
| Display | `Faltan 8`, cabeceras de grupo | 900 | 20-30px |
| Título | Títulos de tarea | 600 | 13-14px |
| Cuerpo | Chips, metadatos | 500 | 11-12px |

- **Mínimo 11px** (hay `text-[9px]` y `text-[10px]` — ilegibles)
- `tracking-[0.2em]` solo en Display (en texto pequeño **reduce** legibilidad)
- Uppercase solo en cabeceras de sección
- `font-variant-numeric: tabular-nums` en todos los tiempos y contadores

### 7.9 Paleta

Se mantiene. Referencia:

| Uso | Color |
|---|---|
| Fondo (dark / light) | `#0B1120` / `#F8FAFC` |
| Tarjeta (dark / light) | `#131C31` / `#FFFFFF` |
| Borde (dark / light) | `#1E293B` / `#E2E8F0` |
| Marca / turquesa | `#14B8A6` |
| Estimado / azul | `#0EA5E9` — `#3B82F6` |
| Registrado / morado | `#A855F7` |
| Completado / lima | `#84CC16` |
| Alerta / naranja | `#F97316` |
| Deadline / ámbar | `#F59E0B` |
| Delegación / rosa | `#EC4899` |

### 7.10 Accesibilidad

- `text-text-secondary/40` sobre fondo oscuro está por debajo de WCAG AA → subir
- Sustituir los 4 `confirm()` nativos por modales propios o toasts
- Iconos de bloque: emojis → SVG lucide (renderizan distinto por SO)
- Densidad compacta como toggle (36px vs 56px de fila)

---

## 8. Funcionalidades nuevas V20

### 8.1 Dependencias entre tareas 🟢

**Caso de uso**: "Resolver contrato" bloquea a "presentar baja", "devolver fianza", etc.
Sin dependencias hay que arrastrar ese bloque a mano sin saber cuándo tocará.

**Datos:**
```ts
blockedBy?: string[];   // ids de tareas que me bloquean
deadline?: string;      // fecha límite propia
```

**Regla**: una tarea está bloqueada si alguna de sus `blockedBy` no está completada.
Se calcula al vuelo, no se persiste.

**Bloqueada = invisible.** No aparece en ningún sitio, no cuenta en carga ni en tiempos.
No son tareas del usuario todavía.

**Visualización**: el aviso va **en la tarea bloqueante**, no en un pie de página.
Chip de candado con 3 estados según urgencia:
- `🔒 1` gris — bloquea 1, sin fecha límite
- `🔒 2 · 30-9` ámbar — hay fecha límite con margen (formato corto DD-M)
- `🔒 3 · ⚠ 15-8` rojo — fecha límite cerca y sigue bloqueada (con ⚠)

**Al completar la bloqueante** → modal de desbloqueo:
```
✓ Resolver contrato Sabadell completada

Se han desbloqueado 3 tareas:

  Devolver fianza        ⚠ 15 ago    [16 jul] [45m] [🎯 focus]
  Presentar baja censal              [16 jul] [30m] [📋 resto]
  Notificar a gestoría   · Marta     [16 jul] [15m] [⏳ espera]

                              [Aceptar]
```
Fecha, tiempo estimado y etiqueta **editables ahí mismo**. No hay que entrar al modal.
Defaults: fecha = hoy; tiempo y etiqueta = lo que tuvieran definido.

**Deadline vigilado aunque siga bloqueada**: si `deadline` se acerca y la bloqueante
sigue sin resolverse, aviso en ámbar. Es el único caso donde el sistema avisa sin
que se le pregunte.

**Delegadas**: funcionan igual, sin caso especial.

### 8.2 Toast + Deshacer 🟢

Sustituye avisos bloqueantes. Aparece abajo, 5s, se va solo.

```
Accidente Moussa es ahora un contenedor · fecha, etiqueta y tiempo eliminados  [Deshacer]
```

**Casos:**
- Convertir tarea en contenedor (avisa, NO confirma — el borrado es correcto y querido)
- Borrado masivo (deshacer da confianza)
- Cualquier acción destructiva

### 8.3 Arrastre de tareas sin completar 🟢

Banner al abrir el día: *"3 tareas de ayer sin completar. ¿Traer? / ¿Reprogramar? / ¿Descartar?"*
Un clic. Sin culpa.

**Contador de aplazamientos**: si una tarea lleva 5 días arrastrándose, badge.
No para castigar: para distinguir "no importa" de "la estoy evitando".

### 8.4 Explotar `taskType` (core/adhoc) 🟢

El campo existe, está en BD, **no se usa**. Es la pregunta más importante:
*¿cuánto de mi tiempo va a lo que decidí y cuánto a lo que me cayó encima?*

Gráfico de ratio core/adhoc por semana. Si empeora 3 semanas seguidas, es una señal.

### 8.5 Delegación: fecha de seguimiento 🟢

`followUpDate` en la delegación. Delegar sin fecha de revisión es tirar la tarea al vacío.

La agenda de reunión ya existe y funciona (selección manual de temas — correcto:
se envía lo que se va a tratar, no todo lo que hay).

### 8.6 Búsqueda con filtros reales 🟢

SearchView busca texto. Añadir: por bloque, por persona, por rango de fechas,
por estado, "sin estimar", "sin tocar en 30 días".

### 8.7 Vista de reflexión 🟢

Mi Día (ejecutar), Semana (planificar), Carga (proyectar) — **falta reflexionar**.
Vista mensual/trimestral: dónde se fue el tiempo por bloque, core vs adhoc,
qué se arrastra eternamente.

### 8.8 Sincronización real 🟢

Ahora todos los `.then(({error}) => console.error(...))` fallan en silencio.
El usuario nunca se entera. Cola de escrituras + indicador real de sync.

### 8.9 Celebración de día completado 🟢

Estado vacío que celebre, no una lista vacía.

---

## 9. Rutina de trabajo real de la usuaria

Importante para entender las decisiones de diseño. **Dos pasadas:**

**Pasada 1 — vista de pájaro (rápida):** resto → espera → dirección → focus.
Solo mirar. Calibrar el día: ¿qué me ha caído? ¿qué se me está pudriendo?
¿qué me van a preguntar? ¿cuánto hay de trabajo real?

**Pasada 2 — ejecutar:** primera hora → gestionar resto → gestionar espera →
gestionar dirección → ordenar focus → trabajar.

**Según lo que ve en la pasada 1, decide**: si resto está tranquilo, vista de pájaro
y a trabajar. Si hay follón, gestiona antes.

La **rutina de mañana es una tarea suya**, en sus bloques, priorizada.

`dirección` se despliega ~13:00 cuando llegan los jefes; el resto del día está muerto
para no generar ruido.

**Implicación de diseño**: no puede decidir con contadores — necesita ver las tareas
reales con sus tiempos. Por eso todo desplegado y editable inline.

---

## 10. Plan de implementación

Orden deliberado: primero lo que no rompe nada.

| # | Tarea | Riesgo | Notas |
|---|---|---|---|
| 1 | `occursOn` + `materializeDay` + tests | Ninguno | Funciones puras nuevas |
| 2 | Migrar WorkloadView + WeekView | Bajo | Solo lectura — si falla, se ve y no rompe |
| 3 | Migrar CalendarView | Bajo | Solo lectura |
| 4 | `TaskCard` + `Chips` (fila nueva) | Medio | Afecta a las 7 vistas a la vez |
| 5 | Migrar Dashboard + retirar worker | **Alto** | ⚠️ EXPORTAR TABLA `tasks` ANTES |
| 6 | Fixes de persistencia (#1-#10) | Medio | |
| 7 | Toast + deshacer | Bajo | |
| 8 | Dependencias + deadline | Medio | |
| 9 | Resto de mejoras (8.3-8.9) | Bajo | Ya sobre terreno firme |

**Estimación**: ~7-9 sesiones para base sólida + fila nueva. +5-6 para las mejoras.

**El cuello de botella es la verificación, no la escritura.** Una cosa cada vez, se
prueba, y si está bien se sigue.

⚠️ **Antes del paso 5: exportar la tabla `tasks` de Supabase.**

### Estado de implementación (rama `refactor-v20`)

> ⏭️ **PRÓXIMO Y ÚLTIMO PASO DEL REFACTOR DE DATOS → detalle completo en §13.**
> Lo de abajo es el registro histórico de lo hecho; §13 es el plan operativo de retoma.

- **Paso 1 ✅** — `instanceEngine.ts` (`occursOn` + `materializeDay`) con 16 tests.
- **Paso 2A ✅** — `WorkloadView` usa `occursOn` (eliminada la copia 2 del switch).
- **Paso 2B ✅ (solo lectura)** — `WeekView` migrada a `materializeDay`: sin dependencia
  de instancias pre-generadas, unificada en `occursOn`, y **bug #19 cerrado** (la copia 3
  `occursOnDate` ya no existe → la recurrencia anual solo-con-`startDate` se calcula bien).
- **Paso 3 ✅ (solo lectura)** — `CalendarView` migrada a `materializeDay` inyectado en un
  mapa del mes (`monthMap`), reutilizando `filterTasksForDay` / `groupTasksByTag` /
  `getStatsForDay`. Sin dependencia de instancias pre-generadas; **no tenía copia del switch**
  (nada que unificar). Números idénticos en meses cercanos; **meses lejanos ahora muestran
  carga real** (antes salían vacíos).
- **Paso 5A ✅ (Dashboard — mitad LECTURA)** — `App.tsx` deriva `dashboardTasks`/
  `dashboardTasksMap` desde un `activeDayMap` = `{ ...materializeDay(activeDate), ...tasks }`
  con **ESTADO GANANDO**. `useGeneration`, `DashboardView` y TODOS los handlers quedan
  **intactos**. Reading idéntico en el día activo (cercano); un día lejano navegado a mano
  (p.ej. "Ver en Dashboard" del Calendario) ahora muestra tareas (antes vacío).
  - Fusión estado-gana deliberada: si `materializeDay` sobrescribiera el estado, resetearía
    `isExpanded` desde la plantilla → regresión del desplegar. Con estado-gana, el bug del
    desplegar (#3/#4/#5) queda **IGUAL** en el día activo (no es regresión), a corregir en 5B.
  - ⏸️ **PENDIENTE — Paso 5B (Dashboard — mitad INTERACCIÓN)**: hacer los handlers
    instance-aware (materializar/persistir excepción al tocar), **luego retirar `useGeneration`**,
    y reactivar la interacción de recurrentes en Dashboard + Semana + Calendario (una vez).
    Corrige de paso #3/#4/#5 (desplegar) y #1/#2 (persistencia promote/demote). ⚠️ **EXPORTAR
    la tabla `tasks` de Supabase ANTES de 5B** (es donde se toca persistencia/escritura).
    - Progreso 5B: paso 1 ✅ `resolveTaskId` (8 tests). paso 2 ✅ `handleToggleStatus`.
      paso 3 ✅ `handleEditTaskRequest`. paso 4 ✅ `handleDeleteTaskRequest` (los tres, fallback
      guardado, sin cambiar escrituras). **3A ✅** desplegar por-render (mata "se abre otra",
      combina con expandir/colapsar-todo; solo UI). **3B ✅** el desplegar de contenedores ya
      NO escribe `is_expanded` (verificado con spy de `fetch`: contenedor = 0 peticiones a
      `tasks`, marcar = sí escribe). `handleToggleExpandTask` intacto para subtareas/otras vistas.
    - **`useBulkActions`** (conectar `resolveTaskId`, un handler cada vez, sin cambiar escrituras):
      - `bulkDeleteTasks` ✅ (fallback excepción-only, patrón uniforme). Nota: para ESTE handler
        el fallback es prácticamente inerte — las excepciones son filas de la BD (en el estado),
        así que borrar en bloque excepciones funciona con o sin `resolveTaskId`; las normales
        virtuales se saltan igual. Su flujo real (borrar recurrentes de días trabajados = 100%
        excepciones) queda cubierto.
      - `bulkUpdateTasks` ✅ (SOLO bug #7 — `activeDate` en las deps; sin filtrar por día stale al
        cambiar de día). **`resolveTaskId` NO conectado aquí a propósito**: es inerte Y choca con
        el propósito del handler (que ya materializa por su cuenta, Camino 1). Su instancia-
        awareness real = materializar normales virtuales → Fase 3 (ver abajo).
      - `bulkDuplicateTasks` (bug #6 + #18) ✅ **HECHO y commiteado** (`be9eed1`). Cálculo de
        duplicados FUERA del updater de `setTasks` (lee de `tasks`, no de `prev`); updater = merge
        puro de `newById` + `parentSubtaskPatches` → StrictMode ya no duplica los inserts (el bucle
        de insert itera `duplicates`, poblado una sola vez). Quitada la línea muerta
        `update({ subtasks })` (#18; la jerarquía se persiste por `parent_task_id`). `resolveTaskId`
        NO conectado (inerte aquí, como en `bulkUpdate`). **24 tests ✅, build ✅.**
        **Validado EN VIVO** (spy `fetch`, 26/07): duplicar 1 hoja manual = **1 POST insert (no 2)**,
        0 residuales "(copia)", copia de prueba borrada por id → **cambio neto cero**.
    - ⚠️ **PENDIENTE IMPORTANTE Fase 3 — materializar NORMALES VIRTUALES en las acciones en bloque
      (misma familia, tras quitar `useGeneration`).** Solo persisten las excepciones (filas
      reales); las ocurrencias recurrentes NORMALES (sin tocar) no tienen fila → hoy las bulk
      actions hacen no-op sobre ellas. Dos caras del mismo problema:
      - `bulkDeleteTasks`: crear fila de excepción con `isDeleted:true` (materialize-on-delete),
        en vez del `UPDATE .eq('id', inst-…)` que es no-op.
      - `bulkUpdateTasks`: obtener el objeto de la instancia virtual con `materializeInstanceById`
        y meterlo por el **Camino 1** (upsert de excepción), en vez de saltarla.
      **NO es hueco menor**: medido 25/07 — días trabajados/pasados = ~100% excepciones; hoy/
      futuro = mezcla (hoy 6 exc / 4 normales). La usuaria subirá VOLÚMENES y planificará sobre
      días FUTUROS, donde las normales (sin tocar) serán MAYORÍA → este caso crece mucho.
    - ✅ **PLAN CERRADO #1 — persistir promote/demote — IMPLEMENTADO (commit `83a7301`, validado en vivo 26/07)**:
      - **HECHO**: ambos handlers calculan el nuevo padre FUERA del updater (patrón anti-#6) y,
        tras el `setTasks`, escriben `update({ parent_task_id, modified_at }).eq('id', taskId)`
        (promover → `grandParentId`/`null`; degradar → `aboveTaskId`). NO se escribe `subtasks`
        (#18). `.eq('id', taskId)` sin resolver → instancia virgen (`inst-…`) = no-op a propósito
        (Fase 3). Validación en vivo: degradar tarea + **recargar** → persiste en el nuevo nivel.
        Dead code `currentLevel >= 3` eliminado en el mismo commit. Lo de abajo queda como registro
        del razonamiento y de los datos que respaldaron el alcance.
      - **Hoy** (estado previo, ya corregido): `handlePromoteTask` ([useTaskOrdering.ts:128](useTaskOrdering.ts)) y
        `handleDemoteTask` ([useTaskOrdering.ts:167](useTaskOrdering.ts)) **solo hacen `setTasks`**
        (memoria). Ninguno llama a `supabase` → al recargar, `reconstructHierarchy` rehace los
        `subtasks` desde `parent_task_id` de la BD (sin cambiar) → **revierte**.
      - **Fix mínimo**: tras el `setTasks`, escribir el nuevo padre de la fila movida:
        `supabase.from('tasks').update({ parent_task_id: nuevoPadre, modified_at }).eq('id', taskId)`
        (promover → `grandParentId`/`null`; degradar → `aboveTaskId`). **NO escribir `subtasks`**
        (columna inexistente = #18; se reconstruye). Posible refinamiento posterior: renumerar
        `order` de los hermanos para fijar la posición exacta (el mínimo persiste el **padre**, no
        necesariamente la posición).
      - **Por qué es seguro y suficiente (verificado con datos reales 25/07, 2327 filas, 865 hijos
        activos con `parent_task_id`)**: la relación padre-hijo vive **mayoritariamente a nivel de
        día**, y **todas son filas reales** → el `UPDATE parent_task_id` las persiste:
        - EXCEPCIÓN→PLANTILLA 421 · MANUAL→MANUAL 295 · PLANTILLA→PLANTILLA 93 · MANUAL→PLANTILLA 55
          · EXCEPCIÓN→EXCEPCIÓN 1 · padre ausente 0.
        - Solo **11% (93)** es estructura recurrente pura (plantilla→plantilla, reorganizar en
          Bloques) — también fila real, también persiste. El **89% (772)** tiene el hijo anclado a
          un día (excepción/manual) — filas reales → persisten con el mismo `UPDATE`.
      - **Único caso fuera** = instancia recurrente **normal virgen** (sin fila): NO aparece en el
        recuento (es memoria) → `UPDATE` sería no-op. Es **el mismo pendiente de Fase 3** que las
        bulk actions (materializar excepción), con la **misma nota de volumen** (crece en días
        futuros). NO bloquea el uso actual.
      - **Es un CAMBIO DE ESCRITURA** (hoy no escribe nada) → primer write real de este handler →
        **exportar `tasks` antes** (backup). Validación: promover/degradar → **recargar** →
        confirma que persiste el padre correcto (con spy `fetch` = 1 `UPDATE parent_task_id`, sin
        escrituras raras a `subtasks`) → **restaurar** (degradar/promover de vuelta) = cambio neto 0.
      - **Decisión de alcance para implementar**: empezar por el **`UPDATE parent_task_id` mínimo**
        (cubre el ~89% real + el 11% plantilla). `order` exacto y las instancias vírgenes → después
        (Fase 3). NO conectar promote/demote a lógica de materialización todavía.
    - ✅ **LIMPIEZA (código muerto) — HECHA (commit `83a7301`)**: retirado el residuo de nivel 3 en
      `handleDemoteTask` (`useTaskOrdering.ts`, `currentLevel >= 3`). Confirmado por SELECT
      directo a la BD (25/07): **0 tareas de nivel 3** (activas: 862 en nivel 1, 865 en nivel 2).
      Trabajamos en 2 niveles de hecho; el 3er nivel de promote/demote era dead code. Cambio de
      comportamiento cero (el guard solo disparaba en tareas nivel 3, de las que hay 0).
  - ⏸️ **PENDIENTE tras el Dashboard (Semana + Calendario, misma maquinaria)**: reactivar la
    **interacción de recurrentes** — completar / editar / mover / **reordenar** — que ahora
    queda en pausa porque las instancias son virtuales (no están en el estado `tasks`) y
    `handleToggleStatus` / `handleEditTaskRequest` / `handleUpdateTasksOrder` no las resuelven.
    En el Calendario esto afecta al **drawer del día** (TaskCard completo). Se activará junto
    al Dashboard (pasos 5–6) haciendo esos handlers instance-aware **una sola vez** para las
    tres vistas. Mientras tanto, recurrentes se gestionan desde **Mi Día**; las tareas
    **manuales** siguen siendo interactivas en Semana y en el drawer del Calendario.
- **Bugs nuevos detectados** (no arreglar aún): **#18** columna `tasks.subtasks` inexistente
  (escritura en silencio en `useTaskOrdering.ts:62`; la de `useBulkActions` ya eliminada en
  `be9eed1`) → resto arreglar en paso 6.
- **#20 — Selección/duplicación de CONTENEDORES fuera del estado (instancias virtuales)**
  (detectado por la usuaria 26/07). Reportado: (1) seleccionar un contenedor no selecciona sus
  hijas; (2) seleccionar solo el padre no duplica; (3) padre+hijas → solo duplica las hijas.
  - **Dónde**: la selección se cablea en `TaskCard.tsx` (onClick de card :298-305 y de checkbox
    :334-343) → `onToggleTaskSelection(task.id, isContainer)` con `isContainer =
    task.subtasks.length>0`. El handler `toggleTaskSelection` (`App.tsx:131`) **relee
    `tasks[taskId]` del ESTADO CRUDO** y añade `task.subtasks` que existan en `tasks`.
    `bulkDuplicateTasks` (`useBulkActions.ts`) también calcula `rootIds` y lee originales desde
    `tasks` (estado crudo).
  - **Causa raíz**: los handlers leen el **estado crudo `tasks`**, no el mapa **materializado/
    renderizado** (`activeDayMap`/`dashboardTasksMap`). Mientras `useGeneration` puebla el estado
    (hoy: rango 2026-04-29 → **2027-08-29**, 8386 instancias), los contenedores/hijas de días
    cercanos SÍ están en `tasks` → **la auto-selección FUNCIONA** (reproducido en vivo 27/07:
    clicar "Rutinas mañana" seleccionó sus 4 hijas). **Falla** para contenedores/hijas **fuera
    de esa ventana** (solo-`materializeDay`, sin fila en estado) → `tasks[id]` undefined →
    (1) sin hijas, (2) `rootIds` vacío = no duplica, (3) desajuste plantilla/instancia = hijas
    sueltas. **Y fallará para TODAS las recurrentes al quitar `useGeneration`** (serán virtuales).
  - **Bug latente extra**: `duplicateTaskRecursive` (`useBulkActions.ts:202`) copia `{...original}`
    y solo limpia id/title/status/fechas/subtasks — **NO limpia `templateId`, `instanceDate`,
    `isException`, `recurrence`** → la copia de una instancia hereda recurrencia/vínculo de
    plantilla (copia malformada, no un one-off limpio).
  - **Tipo de fix**:
    - **Auto-selección hija (seleccionar padre → seleccionar hijas)** = **SOLO UI/estado de
      selección, sin escritura**. Fix robusto: que el handler use las `subtasks` del objeto
      RENDERIZADO (que `TaskCard` ya tiene) en vez de releer `tasks[taskId]`. Cubre también los
      virtuales y el futuro post-`useGeneration`.
    - **Duplicar el conjunto de un contenedor virtual + limpiar metadatos** = **TOCA ESCRITURA**
      (crea filas; necesita origen materializado y limpiar `templateId`/`recurrence`/…) → **solo
      analizado**, hacer con backup, ligado a Fase 3 / retirada de `useGeneration`.

---

## 11. Aplazado

| Qué | Cuándo |
|---|---|
| Calibración estimado vs real (factor por tarea/bloque, estimación sugerida, carga corregida) | Más adelante, con agente. Los datos ya están en BD — es la mejora de mayor valor y menor coste técnico. |
| Atajos de teclado (`N` nueva, `Espacio` completar, `←/→` día, `⌘K` buscar) | Más adelante |
| Pantalla de análisis previsto vs real | Más adelante |

### 11.1 Backlog UX/diseño (detectado sesión 11 — para la fase de diseño, NO ahora)
- **(a) Dashboard no muestra el mes al desplazarse**: al hacer scroll en Mi Día no se ve el mes.
  **Diagnóstico primero**: averiguar si NO se pinta o si se pinta en **BLANCO** (posible color heredado del
  modo oscuro sobre fondo claro). Según cuál sea, el fix es distinto. Barato, pero no ahora.
- **(b) Navegación de fechas del Calendario más operativa**: **salto directo a mes/año** (selector / "ir a
  fecha") en vez de mes a mes. El `window.__goToDate` dev-only es el parche temporal; la versión de USUARIO
  va aquí. Relacionado con la lentitud del mes (§13.11): menos navegación = menos materializaciones.
- **(c) Añadir recurrencia desde la fila NO existe** (verificado sesión 11): el `RecurrencePickerChip` de la fila
  solo se renderiza si `task.recurrence` YA existe ([TaskCard.tsx:485,526](TaskCard.tsx)); una tarea sin
  recurrencia no muestra chip → hay que entrar al modal. **Falta el camino, no está roto** (cambiarla en una que
  ya la tiene sí funciona desde la fila). Encaja con la fila V20 §7.3 (chips vacíos clicables) = paso 4.

---

## 12. Diagnóstico de fondo

> No hay un problema de rendimiento. Hay un problema de **arquitectura de datos**,
> y el rendimiento es su síntoma.

Se generan ~430 días × N templates de instancias en memoria, en cada carga, para luego
filtrar y mostrar **un día**. Es como imprimir el calendario entero para mirar el martes.

De ahí sale todo lo demás:
- El worker existe porque la generación es lenta
- `MAX_GENERATION_CYCLES` existe porque hay riesgo de bucle infinito
- Las tres pasadas de `reconstructHierarchy` existen porque los IDs se construyen por string
- Las reparaciones automáticas existen porque los datos derivan
- `existsInSupabase` existe para proteger instancias de la regeneración

**Cada una es un parche sobre el mismo agujero.** Capas defensivas contra un modelo
que genera datos que no necesita.

**Lo que está bien y hay que preservar:**
- La arquitectura template → instancia → excepción es la correcta (es como lo resuelven
  Google Calendar y Todoist)
- `filters.ts` como fuente única de verdad es la mejor decisión del proyecto
- La separación en hooks está bien pensada
- El diseño visual es coherente y cuidado

---

## 13. PASO FINAL — Retirar `useGeneration` + reactivar interacción de recurrentes + bug #20

> **ESTE ES EL PUNTO DE RETOMA (sesión 11, 26/07/2026).** El #1 está cerrado; este es el
> siguiente y ÚLTIMO paso del refactor de datos. Plan acordado y detallado abajo.
> **Alcance DECIDIDO: (A)** (ver §13.7). Se empieza por la Fase A. NO empezado en código aún.

### 13.0 Estado exacto al retomar
- Rama `refactor-v20`, árbol limpio. Últimos commits: `83a7301` (#1 código),
  `d4cfb9b` (#1 doc). Arranque: `npm run dev` → Vite en `http://localhost:5173/`.
- **Verde**: `npm run build` (Vite) ✅ ~6s; `npm test` ✅ 24/24.
- ⚠️ `npx tsc --noEmit` escupe MUCHOS errores **pre-existentes y conocidos** (`existsInSupabase`
  fuera del tipo, `import.meta.env`, imports de iconos…). **NO están en el pipeline** (build =
  `vite build`, sin `tsc`). No confundir con rotura; no es regresión.
- **Hecho**: Pasos 1, 2A, 2B, 3, 5A (lectura), 5B parcial (`resolveTaskId` + toggle/edit/delete
  con fallback + desplegar 3A/3B + bulkDelete/Update/Duplicate) y **#1 promote/demote
  persistencia + limpieza dead code nivel 3** (`83a7301`, validado en vivo con recarga).

### 13.1 Diagnóstico (de dónde sale cada decisión) — verificado por lectura de código
- **El *reading* ya está migrado**: [`activeDayMap` (App.tsx:167)](App.tsx) = `materializeDay(activeDate, tasks)`
  + estado (estado gana). Semana/Calendario/Carga materializan internamente sobre `allTasksMap={tasks}`
  ([WeekView.tsx:186](WeekView.tsx)). `materializeDay` solo necesita plantillas + excepciones (filas
  reales) → **no depende de `useGeneration`**. Quitar el hook NO rompe la lectura.
- **Lo que se rompe = handlers que leen `tasks[id]` crudo.** Hoy funcionan porque `useGeneration`
  mete las instancias virtuales en el estado (ventana ≈ −30 a +400 días). Al quitarlo,
  `tasks[inst-…]` = `undefined` para toda recurrente NO tocada (virgen).
- **`resolveTaskId` solo resuelve a excepción YA existente**, no materializa vírgenes. Prueba:
  `handleToggleStatus` cae en `console.error('Tarea no encontrada')` para virgen ([useTaskCRUD.ts:125-128](useTaskCRUD.ts)).
  → **Falta `materializeInstanceById` (no existe aún)** para obtener el objeto de la instancia virgen.
- **Todas las vistas comparten los mismos handlers** ([App.tsx:499-529, 651-659, 728](App.tsx)) →
  hacerlos instance-aware **una vez** reactiva Dashboard + Semana + Calendario a la vez.
- **Inconsistencia de *edit*:** Dashboard/Calendario/Bloques usan `handleEditTaskRequest` (resuelve);
  **Semana/Search/Delegadas usan `setEditingTaskId(id)` crudo** ([App.tsx:727,745,692](App.tsx))
  → editar una virtual desde Semana se rompe post-flip.
- **Bug #20**: `toggleTaskSelection` ([App.tsx:131](App.tsx)) y `rootIds` de `bulkDuplicateTasks`
  ([useBulkActions.ts:224](useBulkActions.ts)) leen `tasks[id]` crudo; `duplicateTaskRecursive`
  ([useBulkActions.ts:202](useBulkActions.ts)) copia `{...original}` sin limpiar
  `templateId/instanceDate/isException/recurrence` (bug latente: copia atada a la serie, ver
  `recurrence` propagado en el insert [useBulkActions.ts:307](useBulkActions.ts)).
- **Hallazgo (sesión 11) — regex INCORRECTO en add-subtask, ACTIVO post-flip (no solo teórico)**:
  `handleAddTask`/`doAddTask` ([useTaskCRUD.ts:229,258](useTaskCRUD.ts)) resuelven el padre virgen con
  `/^inst-(t-\d+)/`, el regex MALO de §5 (exige `t-` + SOLO dígitos). **Formato REAL de los ids
  (Q4, verificado en los generadores del código)**: manuales `t-<dígitos>` ([useTaskCRUD.ts:248](useTaskCRUD.ts));
  **plantillas/reglas recurrentes `tmpl-<dígitos>`** ([useTaskCRUD.ts:761](useTaskCRUD.ts)); duplicados
  `t-<dígitos>-<base36 con LETRAS>` ([useBulkActions.ts:204](useBulkActions.ts)); NO hay UUID.
  → El regex **falla para `inst-tmpl-…`** (tras `inst-` viene `tmpl`, no `t-`) y para duplicados. Como los
  CONTENEDORES recurrentes son `tmpl-…`, es el **caso COMÚN, no un borde**. HOY está enmascarado por
  `useGeneration` (`tasks[inst-tmpl-…-fecha]` existe → [useTaskCRUD.ts:227,262](useTaskCRUD.ts) acierta sin
  usar el regex); **post-flip se rompe** → añadir subtarea a un contenedor recurrente virgen no encuentra el
  padre → `parent_task_id` acaba en un `inst-…` inexistente = **subtarea huérfana**.
  - **Corolario Q4**: la preocupación guiones/UUID de B4 es **LATENTE** (no se generan UUID) → baja prioridad.
    Pero este regex es **ACTIVO** y hay que arreglarlo en la reactivación: sustituir `/^inst-(t-\d+)/` por el
    strip de `resolveTaskId` (`.replace(/^inst-/,'').replace(/-\d{4}-\d{2}-\d{2}$/,'')`) o llamar a
    `resolveTaskId`/`materializeInstanceById`. Solo 2 sitios: [useTaskCRUD.ts:229,258](useTaskCRUD.ts).
    Afecta a "añadir subtarea a un día" (Semana, §13.6) y a B4. **→ Es la Fase B0 (antes de B1, §13.3).**

### 13.2 Commit-red (red de seguridad — revertir en un comando)
- **Backup DB #1**: re-exportar la tabla `tasks` de Supabase ANTES de la primera fase que escribe
  (Fase B). (El backup del #1 es previo; hacer uno fresco.)
- **Backup DB #2**: re-exportar `tasks` OTRA VEZ justo ANTES de la Fase E — la validación post-flip
  ESCRIBE (crea excepciones al completar/borrar/mover), así que se quiere un punto de restauración
  limpio inmediatamente anterior.
- **Código**: el flip NO borra archivos de golpe. Se parte en **D1** (desactivar `useGeneration` con
  flag/ventana 0, sin borrar) y **D2** (borrar `useGeneration.ts`, `generation.worker.ts` y
  `useTemplateKey`, SOLO tras validar la Fase E). Ambos en commits atómicos, precedidos de tag:
  - `git tag v20-pre-flip` (antes de D1).
  - Volver atrás en SEGUNDOS durante la validación: reactivar el flag / restaurar la ventana (sin git).
  - Revertir por git (quirúrgico): `git revert <hash-de-D1>` (y `<hash-de-D2>` si ya se dio).
  - Vuelta total: `git reset --hard v20-pre-flip`.

### 13.3 Orden exacto (Fases 0–F)
**Principio rector**: `useGeneration` ENMASCARA la rotura. Se construyen TODOS los caminos
instance-aware **con `useGeneration` aún vivo** (app sigue funcionando; el camino nuevo se prueba
navegando a un día **más allá de +400** de hoy — ahí la instancia ya es virtual). El flip es lo ÚLTIMO.
- **Fase 0** — Backup DB + árbol limpio + `git tag`.
- **Fase A** — Helper puro `materializeInstanceById(instanceId, allTasks)` en `instanceEngine.ts`
  + tests. Extrae `templateId`+fecha, corre la lógica de `materializeDay` de ese día, devuelve el
  objeto de esa instancia o `null`. Cero cambio de comportamiento (nadie lo llama aún).
- **Fase B** — Handlers de una tarea instance-aware (cada uno su commit, validado en día lejano):
  - **B0 (PRIMERO, antes de B1) — arreglar el regex de add-subtask**: en `handleAddTask` y `doAddTask`
    ([useTaskCRUD.ts:229,258](useTaskCRUD.ts)) sustituir `parentTaskId.match(/^inst-(t-\d+)/)` por el strip de
    `resolveTaskId` (`inst-<templateId>` → `templateId` vía `.replace(/^inst-/,'').replace(/-\d{4}-\d{2}-\d{2}$/,'')`),
    o llamar directamente a `resolveTaskId(parentTaskId, tasks)`. Sin dependencia de B1 (solo corrige la
    resolución del padre; no toca el materializado de B1). **Test propio**: instancia de contenedor `tmpl-…`
    (con letras) → resuelve al `tmpl-…` correcto, no a `null`/parcial. Se sube a B0 porque "añadir subtarea a
    un contenedor recurrente" es acción de USO DIARIO y su fallo NO debe confundirse con B1 durante la validación.
  - **B1** `handleToggleStatus` — **materializar la RAMA, no solo el nodo**: si `!task` y `resolveTaskId`
    no da excepción, materializar el DÍA UNA vez (`materializeDay(fecha, tasks)` → `dayMap`) y sacar de ahí
    el objetivo (`dayMap[taskId]`) **y sus hijas**. Cambiar el lookup de hijas de `toggleRecursive`
    ([useTaskCRUD.ts:163-166](useTaskCRUD.ts)) de `tasks[sid]` a `tasks[sid] || dayMap[sid]` — si no, un
    CONTENEDOR virgen upserta SOLO el padre y las hijas se quedan sin tocar, y **la recarga NO lo delata**
    (el padre persiste bien). Mantener anti-#6 (upserts fuera del updater, ya es así). Guard
    `if (task?.isDeleted) return;`. Validación: contenedor virgen a día lejano → **N upserts (padre+hijas)**
    → recarga: TODAS completas; hoja virgen → 1 upsert; `isDeleted` → no reaparece; idempotencia
    (completar/reabrir/completar = 1 fila, upsert `onConflict:'id'`).
    - ✅ **HECHO (commits `eefa2f6` B0, `df0a2f2` B1) y VALIDADO EN VIVO (sesión 11, 2028-01-15, fixture
      `t-1785089440019`)**: completar el contenedor virgen → **4 upserts** (contenedor + 3 hijas), 4 ids
      `inst-…-2028-01-15` únicos, `is_exception:true`, **ningún id de plantilla pelado**; recarga → las 4
      persisten `completed` y las 4 plantillas siguen `pending`/intactas (antes de B1 habría persistido solo
      el padre). **Idempotencia**: reabrir = 4 upserts (pending) / completar = 4 upserts (completed), SIEMPRE
      los mismos 4 ids → recarga = **4 filas, no 8**. Matiz del conteo RESUELTO: el spy antiguo (wrap de
      `window.fetch`) no veía a supabase-js; ahora se instrumenta el `fetch` del cliente (`global.fetch`,
      commit `2609be0`) y se lee `window.__spy` (poblado tras un tick — leer en llamada aparte, no síncrona).
    - ✅ **CASO MIXTO Q2 VALIDADO EN VIVO (2028-01-17)**: estado de partida = `c1` con excepción real *pending*
      (completada + reabierta con la app) + `c2`/`c3` vírgenes. Completar el contenedor → **4 upserts**, `c1`
      **1 sola vez (update in-place, mismo id)**, `c2`/`c3` inserts nuevos, todos `completed`. Recarga →
      **4 filas** en 2028-01-17, `c1RowCount:1` (NO duplicada), todas `isException/completed`. El orden
      `tasks[sid]` (fila real) antes de `dayMap[sid]` funciona como se predijo.
    - **Q1 CONFIRMADO — por qué `tasks[sid] || dayMap[sid]` es seguro (leído en `materializeDay`)**: el array
      `subtasks` del contenedor materializado guarda `resolved.id` ([instanceEngine.ts:245](instanceEngine.ts)),
      y `resolved.id` es: hija virgen (caso 5) `inst-<hija>-<fecha>`; hija con excepción (caso 2) el id **REAL**
      de la excepción; hija manual (caso 4) el id real. **NUNCA un id de plantilla pelado** → el `||` jamás
      acierta una plantilla → completar un contenedor **NO** escribe `status` en la serie de las hijas. (La
      trampa "el `||` acierta la plantilla" NO puede ocurrir.)
    - **Q2 CASO MIXTO (validación OBLIGATORIA)**: contenedor con 1 hija que YA tiene excepción real + 2
      vírgenes. El orden `tasks[sid]` primero da prioridad a la fila real (la excepción manda sobre el
      materializado). Esperado: las **3** acaban completas, **1 fila por hija**, la preexistente se actualiza
      in-place (upsert `onConflict:'id'`, **sin duplicar**). Spy: 3 upserts, ninguno con id de plantilla.
  - **B2** ✅ **HECHO y VALIDADO EN VIVO (commit `052510a`)**. Matiz real (distinto de lo previsto): el borrado
    de recurrentes NO usa `handleDeleteTask` (ese es el camino directo, que sí lee `tasks[sid]` crudo y hace
    no-op en virgen). Va por el **modal de recurrencia** → handler `onConfirm('instance')` ([App.tsx:974](App.tsx)),
    que crea **UNA** excepción `isDeleted` **sin recorrer hijas** (container-only, model-correct). `materializeDay`
    suprime el bloque entero del contenedor (`findDeletedForDay(containerExceptions) → continue`), así que basta
    la del contenedor y las hijas NO pueden orfanar (nunca son nivel-1). **Gap encontrado**: el contenedor se
    resolvía por `dashboardTasks.find` (top-level) y funcionaba, pero **borrar una HIJA suelta virgen era no-op**
    (las hijas NO están en el array flat `dashboardTasks`). **Fix**: fallback `materializeInstanceById` en los dos
    sitios que resuelven el objetivo (`handleDeleteTaskRequest` + el handler de App.tsx). Validación: contenedor
    virgen (2028-02-01) → 1 upsert `isDeleted`, recarga = fixture AUSENTE (ni padre ni hijas). Hija suelta
    (2028-02-08) → 1 upsert, recarga = `c2` desaparece, contenedor+`c1`+`c3` siguen. Respuestas Q1 (basta la del
    contenedor) y Q2 (no orfanan) confirmadas.
  - **B3** *Edit routing*: enrutar Semana/Search/Delegadas por `handleEditTaskRequest` (no `setEditingTaskId` crudo).
    - **Verificado (sesión 11) — abrir el modal NO escribe**: el `adhoc→core` al abrir es solo el DEFAULT del
      formulario ([TaskModal.tsx:281](TaskModal.tsx): `hasActiveRecurrence && !localTask.taskType` resalta 'core'),
      estado local `localTask`; `handleEditTaskRequest` solo hace `setTasks` en memoria, sin Supabase. → Abrir la
      edición de una instancia virtual **NO crea fila** silenciosa. (No es camino de escritura; era la duda de B3.)
    - **B3 son 3 partes (barrido §13.12)**: (1) routing Semana/Search/Delegadas → `handleEditTaskRequest`;
      (2) `handleEditTaskRequest` ([useTaskCRUD.ts:59](useTaskCRUD.ts)) resuelve por `dashboardTasks.find` (día
      activo, top-level) → para virgen no-activa/hija cae a `resolveTaskId`→PLANTILLA y **edita la SERIE sin
      preguntar** → fix: fallback `materializeInstanceById` para que abra el modal de recurrencia; (3) el path
      `onConfirm('instance','edit')` ([App.tsx:971](App.tsx)) hace `{...prev[taskId], isException:true}` sobre
      `undefined` → **fantasma parcial + editor VACÍO** → fix: materializar ahí también.
    - ⚠️ **CAMBIO DE COMPORTAMIENTO VISIBLE (no es regresión en Fase E)**: hoy editar una recurrente desde Semana
      va DIRECTA a la serie; tras B3 saldrá el modal "¿este día o toda la serie?". No es cosmético: el actual es
      **silenciosamente destructivo** (editas lo que parece un día y cambias toda la serie sin aviso). El modal es
      el arreglo. Desde Semana = un clic más para quien edita series.
    - **Fantasma de edición (parte 3) — PUEDE escribir, verificado sesión 11**: `TaskModal.handleSave`
      ([TaskModal.tsx:120](TaskModal.tsx)) **no tiene guard de título vacío** → guardar el modal vacío llama
      `onSave`→`handleUpdateTask` (escribe). Diagnóstico de la BD (10729 filas / 1548 excepciones cargadas):
      **3 excepciones con título `""`** — `templateId:null`, `blockId:b1`, `dueDate` 2026-04-29/30, **`isDeleted:true`**
      (ya borradas, inertes). Ids `t-1777493420378 / t-1777492627525 / t-1777490985341`. Encajan con la firma del
      fantasma. **NO borradas — decisión de la usuaria.** B3 (parte 3) cierra el origen (materializar → editor con
      datos reales, no vacío).
    - ✅ **B3 HECHO y VALIDADO (commit `8d4f782`)**. Validado en vivo **desde Semana, día ≠ activo** (requisito
      §13.13): `activeDate`=2028-06-01, semana marzo 2028, editar la **HIJA** "Test hija1" en 2028-03-13 → abre el
      **modal de elección** (no salta a serie) → "Solo esta tarea" → editor con **datos reales** ("Test hija1", no
      vacío) → cambiar título → **1 upsert excepción** → recarga: persiste **solo** ese día
      (`editedExceptionsCount:1`), plantilla y demás días intactos. Cubre parte 2 (modal), parte 3 (editor real),
      caso HIJA y día no-activo. Routing (parte 1): las 3 vistas ahora comparten `handleEditTaskRequest` (Semana
      validada end-to-end; Search/Delegadas = mismo handler, mismas real-rows → mismo camino).
  - **B4** Mover (`onRecurrenceDateChange` → `pendingDateChange`): confirmar/ajustar que una virgen
    se materialice como excepción con el nuevo `dueDate` (el flujo "FIX sesión 10" ya toca
    `parent_task_id` en excepciones; verificar que cubre la virgen).
    - ⚠️ **PUNTO A RESOLVER EN B4 — dos escritores con criterios DISTINTOS sobre `parent_task_id` de las
      excepciones** (visto en la validación de B1, sesión 11): `handleToggleStatus` escribe
      `parent_task_id: null` en el upsert de instancias ([useTaskCRUD.ts:~182](useTaskCRUD.ts)) y la jerarquía
      se **reconstruye desde las plantillas** al cargar (verificado: tras recarga las hijas quedan bien
      anidadas bajo el contenedor). PERO el "FIX sesión 10" **sí escribe un `parent_task_id` real** en las
      excepciones. Dos convenciones sobre la MISMA columna. B4 (mover) y B5 (promote/demote) escriben justo
      ahí → **unificar el criterio al llegar a B4** (¿null + reconstruir, o parent real siempre?) para que
      completar/mover/promover no se pisen ni dejen la columna incoherente.
  - **B5** Promote/Demote virgen: extender el #1 (hoy no-op en virgen) con `materializeInstanceById`
    → upsert excepción ANTES del `UPDATE parent_task_id`.
- **Fase C** — Bug #20:
  - **C1** `toggleTaskSelection`: leer del **objeto renderizado** (las `subtasks` que `TaskCard` ya
    tiene), no de `tasks[id]`. **SOLO UI, sin escritura.**
  - **C2** `bulkDuplicateTasks`: `rootIds`/originales desde el mapa materializado; **limpiar
    metadatos** en `duplicateTaskRecursive` (`templateId`, `instanceDate`, `isException`,
    `recurrence`) → duplicado = one-off limpio. Mantener patrón anti-#6 (cálculo fuera del updater).
  - **C3** `bulkDeleteTasks`/`bulkUpdateTasks`: materializar normales vírgenes (misma familia que B1/B2 = Fase 3).
    **Perf**: `materializeInstanceById` materializa el día ENTERO por id; sobre una selección de N tareas en
    varios días serían N materializaciones completas. **Agrupar la selección por fecha y materializar cada día
    UNA vez** (reusar el `dayMap`, como en B1). Anotado ahora para no redescubrirlo en la Fase C.
- **Fase R** — Reordenar (bug #15): **DIFERIDO por decisión (A)** → sub-paso inmediato SIGUIENTE al
  paso final. Reordenar sigue OK para filas reales (Bloques). Comportamiento con recurrente virgen
  tras el flip documentado en §13.9 (esperado, NO regresión).
- **Fase D0 — Ensayo general (pre-flip, sin tocar el flip; solo overrides dev-only)**: con `useGeneration`
  AÚN vivo, correr la tabla ENTERA de §13.6 en un día **>+400 días** (ahí las instancias ya son virtuales).
  Da confianza de que toda la maquinaria instance-aware (B+C) funciona sobre virtuales ANTES de tocar el flip.
  **SÍ cubre — Mi Día (Dashboard)**: ensayable en día lejano vía `window.__goToDate('2028-01-15')` (verificado:
  salta y `materializeDay` renderiza). Ejercita los MISMOS handlers/materialización que post-flip. Salvedad: es
  vía override dev-only, NO el camino real de "hoy".
  **Lo que NO cubre** (exige validación propia en Fase E, post-flip):
    - **Transición "hoy pasa a virtual"**: hasta D1, hoy sigue en estado; que un día CERCANO se vuelva virtual
      solo ocurre en el flip → validar en Fase E (no lo simula el override).
    - **Bloques**: opera sobre filas reales (plantillas/manuales), no sobre virtuales → intacto en el ensayo.
    - **Delegadas**: su propia vista/filtrado no se ejercita desde un Dashboard de día lejano.
- **Fase D1 — Desactivar `useGeneration` SIN borrar** (commit atómico, tras `git tag v20-pre-flip`):
  neutralizar el hook con un flag (p.ej. `GENERATION_ENABLED = false` + early-return) o la ventana a 0
  días. Archivos y `useTemplateKey` intactos → volver atrás = flip del flag, en segundos, sin git.
  Ahora TODO (incluido hoy) es virtual.
- **Fase E** — **Backup DB #2** + Validación vista por vista (§13.6). **Aquí se cazan las regresiones
  del flip** (incl. lo que el ensayo D0 no cubría: Mi Día, Bloques, Delegadas).
- **Fase D2 — Borrado definitivo** (commit atómico, SOLO tras Fase E en verde): quitar la llamada
  [`useGeneration(...)` (App.tsx:156)](App.tsx) y el flag, borrar `useGeneration.ts` y
  `generation.worker.ts`; `useTemplateKey` cae con el archivo (confirmar 0 consumidores con grep).
- **Fase F** — Limpieza diferida (NO crítica, orthogonal): `existsInSupabase` (§4), bug #13
  `repairRecurringContainers` (escribe en cada carga), `MAX_GENERATION_CYCLES`.

### 13.4 Qué se rompe temporalmente y cómo se detecta
| Fase | Riesgo temporal | Detección |
|---|---|---|
| A | Ninguno (nadie llama al helper) | Tests helper verde; build |
| B1–B5 | Día **cercano** no cambia (instancia sigue en estado); el camino nuevo solo corre en día **>+400d** | Spy `fetch`: acción en día lejano = **1 upsert excepción** con `is_exception:true` + id/`due_date` correctos. Cercano = mismo nº de escrituras |
| B3 | Editar desde Semana podría abrir el modal equivocado | El modal abre la tarea correcta (título coincide) |
| C1 | Solo selección (marca de más/menos). **Sin escritura** | Seleccionar contenedor → marca sus hijas (incl. virtuales) |
| C2 | **Escritura**: copia malformada o insert duplicado (regresión #6) | Spy `fetch`: duplicar 1 contenedor = N inserts, **0** con `recurrence`/`template_id`; StrictMode no duplica |
| D0 (ensayo) | Ninguno (no cambia código) | Tabla §13.6 en día >+400d en verde ANTES de tocar el flip |
| D1 (desactivar) | **MÁXIMO**: todo lo cercano pasa a virtual de golpe | Consola: **0** logs `[GENERATION]`. Regresión total §13.6. Recarga persiste. Volver atrás = flip del flag |
| Reorder virgen | Escribe `order` en la PLANTILLA (#15) — **ESPERADO, NO regresión** (ver §13.9) | Arrastrar-reordenar una recurrente virgen escribe en `template_id`, no en el día; se arregla en el sub-paso siguiente |
| Reorder virgen — fantasma | Objeto parcial `{order,modifiedAt}` bajo `tasks['inst-…']`, TRANSITORIO (§13.9) | Tras reordenar una virgen: valor sin `.id`/`templateId`; NO lo resuelve `resolveTaskId` ni lo renderiza `materializeDay`; **desaparece al recargar** |
| D2 (borrado) | Bajo (ya validado en E) | Build ✅; grep sin consumidores de `useGeneration`/`useTemplateKey` |
| Reading | Bajo (ya migrado) | Comparar el día de hoy antes/después del flip: mismas tareas, mismo orden |

### 13.5 Bug #20 — dos arreglos de naturaleza distinta
- **(a) Auto-selección de hijas** = SOLO UI (Fase C1). `toggleTaskSelection` usa las `subtasks` del
  objeto renderizado que `TaskCard` ya conoce (pasar el objeto/subtasks al handler), no relee
  `tasks[id]`. Cubre virtuales y el post-flip. Cierra "seleccionar padre no marca hijas".
- **(b) Duplicar contenedor virtual** = TOCA ESCRITURA (Fase C2). `rootIds`/originales desde el mapa
  materializado; `duplicateTaskRecursive` limpia `templateId/instanceDate/isException/recurrence`
  (y no los propaga al insert). Cierra "solo-padre no duplica", "padre+hijas duplica solo hijas" y el
  bug latente de copia atada a la serie.

### 13.6 Validación final vista por vista (con `useGeneration` fuera, spy `fetch`, y RECARGA como prueba real)
- **Dashboard (Mi Día)**: completar/reabrir recurrente virgen → 1 upsert excepción → recarga persiste.
  Editar → modal correcto. Borrar → excepción `isDeleted` → recarga no reaparece. Mover a otro día →
  aparece en el nuevo, no en el viejo. Seleccionar contenedor → marca hijas (#20a). Duplicar
  contenedor → copia limpia sin `recurrence` (#20b). Promote/Demote → persiste (#1 + virgen).
  - **Setup del test (importante)**: usar un **CONTENEDOR con 2-3 hijas** (es el caso que arregla B1), con
    recurrencia **diaria** para que ocurra en CUALQUIER día lejano elegido (evita el falso fallo "no toca ese
    día" de una semanal). Incluir el **caso mixto Q2**: una hija con excepción real + dos vírgenes → completar
    el contenedor → las 3 completas, 1 fila por hija, sin duplicar la preexistente.
- **Semana**: completar y **editar** recurrente desde la rejilla (edit ruteado por `handleEditTaskRequest`).
  Añadir subtarea a un día. Recarga conserva.
- **Calendario**: meses cercanos y lejanos con carga real; abrir el **drawer del día** y
  completar/editar/borrar dentro (TaskCard completo, mismos handlers). Recarga conserva.
- **Reordenar (arrastre) recurrente virgen = comportamiento ESPERADO, NO validar como fallo**: escribe
  `order` en la plantilla (#15). Detalle en §13.9. Se corrige en el sub-paso siguiente (decisión A).
- **Regresión (no deben cambiar)**: Bloques (tareas reales, promote/demote del #1), Delegadas, Search,
  Carga. Consola sin `[GENERATION]`, sin bucles de escritura.
- **Señal OBJETIVA del flip (perf)**: materializar un mes (31 días) sobre el mapa `tasks` con
  `window.__materializeDay` (exposición dev temporal, 3 muestras tras warm-up). **Baseline sesión 11 @ 2324
  claves = ~63 ms** (60/63/66). Post-flip el mapa baja a **~830 claves** (desaparecen las instancias
  generadas) → repetir la MISMA medición en Fase E; si baja notablemente, es prueba objetiva de que el flip
  aligeró el motor (menos claves → `indexExceptionsByTemplate` más corto). Snippet en §13.11.
  - ⚠️ **La medida es RUIDOSA (no fiarse de comparaciones finas)**: el tamaño del mapa `tasks` fluctúa entre
    recargas según lo que el WORKER de `useGeneration` haya generado en ese momento (asíncrono/incompleto) —
    medido en vivo el mismo día: 2324, 2332 claves con muestras de 48–66 ms, sin correlación limpia. Además el
    **fixture de prueba** (`startDate` HOY) añade un nº VARIABLE de instancias cercanas. **Para Fase E, medición
    limpia**: (1) **BORRAR el fixture antes de medir** (es artefacto de test, no existe en producción); (2) el
    número FIABLE es el **post-flip** (~830 claves, SIN worker → estable y reproducible); (3) comparar contra un
    baseline pre-flip **fixture-free** tomado tras dejar asentar la generación, no contra el ~63 ms suelto.

### 13.7 ✅ DECISIÓN DE ALCANCE — DECIDIDA: (A) (26/07, sesión 11)
Reordenar recurrentes virtuales es lo más espinoso: hoy `handleUpdateTasksOrder` escribe `order` en
la **plantilla** ([useTaskOrdering.ts:33-34](useTaskOrdering.ts)) → reordenar un día cambia TODOS los
días (**bug #15**). Hacerlo bien exige materializar excepción con `order` por-día.
- **(A) ELEGIDA** — Flip ahora + reactivar completar/editar/borrar/mover/duplicar/seleccionar;
  dejar el *reorder* de virtuales (con #15) como sub-paso inmediato siguiente. Menos superficie por
  commit. Reordenar sigue OK para tareas reales (Bloques).
- **(B) descartada** — Incluir la materialización-al-reordenar (#15) en este mismo paso. Más completo,
  commit más grande y arriesgado.
- **Razón de (A)**: minimizar el diff del **commit de flip (D1)**, que es el **ÚNICO punto NO validable
  incrementalmente** (todo lo cercano pasa a virtual de golpe). Cuanto más pequeño y aislado sea ese
  commit, más limpio se caza cualquier regresión. El **reorder de virtuales (#15) va como sub-paso
  inmediato siguiente** al paso final. Comportamiento del reorder virgen mientras tanto: §13.9.

### 13.8 Cómo retomar en un chat nuevo
1. Leer este documento entero (sobre todo §13, §5/§5B en §10, §5 arquitectura, §6 bugs).
2. Confirmar sin tocar: `git branch --show-current` = `refactor-v20`, árbol limpio; `npm run build` ✅
   y `npm test` ✅ (24). Arrancar `npm run dev`.
3. **Antes de la Fase B: exportar backup de `tasks`** (Supabase, backup #1) — primer write nuevo.
4. Alcance YA decidido: **(A)** (§13.7). No re-preguntar.
5. Ejecutar en orden: 0 → A → **B0 (regex add-subtask)** → B1…B5 → C → R(diferida) → **D0 (ensayo)** → **D1 (desactivar, flag)** →
   **E (con backup #2 antes)** → **D2 (borrar archivos)** → F. Un commit por sub-fase; validar en día
   lejano (>+400d) antes del flip y con recarga en cada caso. `git tag v20-pre-flip` justo antes de D1.
6. Al terminar, actualizar §13 (marcar hecho) y la tabla de bugs de §6 (#20, #15 en el sub-paso
   siguiente, #3/#4/#5).

### 13.9 Comportamiento esperado de `handleUpdateTasksOrder` con recurrente virgen tras el flip (NO es regresión)
Verificado por lectura de [`useTaskOrdering.ts:26-38`](useTaskOrdering.ts). Al **arrastrar-reordenar**
una instancia recurrente **virgen** (id `inst-…`, sin fila en BD) después del flip, `handleUpdateTasksOrder`:
- **NO es no-op y NO lanza error.** Hace dos cosas:
  1. **BD**: `dbId = t.id.startsWith('inst-') ? (t.templateId || t.id) : t.id` → como la instancia virgen
     trae `templateId`, `dbId` = **la PLANTILLA** → `update({ order }).eq('id', templateId)`.
     **Escribe el `order` en la plantilla → cambia el orden en TODOS los días de la serie (bug #15).**
  2. **Estado (memoria)**: `updated[t.id] = { ...updated[t.id], order, modifiedAt }`; como `updated[t.id]`
     es `undefined`, crea un **objeto parcial fantasma** (solo `order`+`modifiedAt`) bajo el id `inst-…`,
     transitorio hasta recargar.
- **Es EXACTAMENTE el bug #15 preexistente, ahora alcanzable también en día cercano.** Es el motivo de
  diferir el reorder de virtuales (decisión A). En la Fase E **NO marcar esto como regresión del flip**:
  completar/editar/borrar/mover funcionan; solo el *arrastre-reordenar* de una recurrente virgen escribe
  en la plantilla.
- **Sub-paso siguiente (#15)**: materializar excepción con `order` por-día. Si se quiere blindar la
  ventana entre D1 y ese fix, un guard mínimo que haga *no-op* el write cuando `t.id` es virtual. **Ojo**:
  para tapar TAMBIÉN el fantasma (abajo), el guard debe saltar tanto el `supabase.update` como la
  escritura en memoria `updated[t.id] = …` cuando `t.id.startsWith('inst-')`. (Opcional; decidir en #15.)

**Riesgo SEPARADO del #15 — objeto parcial "fantasma" en estado (TRANSITORIO, NO persiste).**
Además del write a la plantilla, `handleUpdateTasksOrder` hace `updated[t.id] = { ...updated[t.id],
order, modifiedAt }`. Para una virgen, `updated[t.id]` es `undefined` → crea el valor parcial
`{ order, modifiedAt }` bajo la clave `tasks['inst-…']`. Caracterización (verificada por lectura):
- **¿Indexado como `tasks['inst-…']`?** Sí, pero el VALOR **no tiene `.id`, ni `templateId`, ni
  `isException`, ni `dueDate`** (solo `order` + `modifiedAt`).
- **¿`resolveTaskId` puede resolver a él?** NO: filtra por `isException && templateId && dueDate`, que
  el fantasma no tiene → lo salta; sigue devolviendo la plantilla.
- **¿`materializeDay` lo trata como excepción / lo renderiza?** NO: `indexExceptionsByTemplate` exige
  `templateId && isException`; no es contenedor (`isTemplate !== true`) ni está referenciado en los
  `subtasks` de ningún contenedor. En `activeDayMap` el "estado gana" indexa por `t.id`, que aquí es
  `undefined` → cae en `map[undefined]` (basura inerte) y **NO pisa** la instancia bien materializada.
- **¿Desaparece al recargar o contamina?** DESAPARECE: es solo memoria; nunca se escribe a Supabase (el
  write va al id de la PLANTILLA, no al `inst-…`). Al recargar, `tasks` se reconstruye de la BD sin esa
  clave. Efecto máximo realista en sesión: una entrada basura `map[undefined]`; sin persistencia, sin
  corrupción.
- **Clasificación**: distinto del #15. El #15 es un write ERRÓNEO y PERSISTENTE a la plantilla (corrompe
  el orden de la serie). El fantasma es basura TRANSITORIA en memoria (bajo riesgo, se limpia al
  recargar). Ambos se eliminan con el mismo guard (saltar virtuales en memoria + BD) o, definitivo,
  materializando la excepción por-día en #15.
- **¿Puede colarse en una barrida que ESCRIBE (repairRecurringContainers / autosave)? Investigado
  (sesión 11) → riesgo NIL.** `repairRecurringContainers` ([useSupabase.ts:172](useSupabase.ts)) corre en el
  LOAD sobre `mappedTasks` (recién construido de la BD), NO sobre el estado en memoria → el fantasma (memoria,
  desaparece al recargar) nunca está presente cuando corre; además salta todo objeto sin `subtasks` (línea
  174). **No existe autosave que barra `Object.values(tasks)` y escriba en sesión**: los únicos bucles de
  escritura son las bulk actions (operan sobre la SELECCIÓN, y el fantasma no se renderiza → no se puede
  seleccionar) y el repair (en load). La única barrida en-sesión que toca el fantasma es `activeDayMap`
  ([App.tsx:170](App.tsx)), de LECTURA, que lo manda a `map[undefined]` (inerte). → No puede acabar como fila
  malformada ni romper un insert. Aun así, el guard de #15 lo elimina de raíz (barato, recomendado en #15).

### 13.10 Prueba de que el día de test es VIRGEN (fundamento de la validación de B/C y del ensayo D0)
La validación en "día lejano" solo vale si la instancia NO está en el estado. Constantes reales de la ventana
de `useGeneration` ([useGeneration.ts:24-26](useGeneration.ts)):
- `DAYS_PAST = 30`, `DAYS_FUTURE_DEFAULT = 60`, `DAYS_FUTURE_YEARLY = 400`.
- Ventana futura = hoy + (¿hay algún template anual? **400** : 60). **NO hay extensión dinámica** más allá de
  eso: `daysFuture` es una de esas dos constantes; el effect solo recalcula a los MISMOS límites.
- Elegir un día **cómodamente > hoy+400** (no en el borde). Con hoy = 2026-07-26 → hoy+400 ≈ 2027-08-30 →
  usar p.ej. **2028-01-15** (~hoy+538).
- **Prueba definitiva por instancia** (belt-and-suspenders sobre la constante): `window.__tasks` YA está
  expuesto (commit `d92bfc8`, dev-only, RETIRAR en D2). Comprobar en consola ANTES de tocar la tarea:
  - **Techo REAL de la generación** (mejor que fiarse de la constante — caza una ventana mayor de lo esperado):
    `Object.keys(window.__tasks).filter(k=>k.startsWith('inst-')).map(k=>k.slice(-10)).sort().at(-1)`
    → última fecha de instancia generada en estado. El día de test debe ser CLARAMENTE posterior.
  - **Virginidad de la instancia concreta**: `window.__tasks['inst-<templateId>-2028-01-15'] === undefined`
    → `true` = virgen. (O barrer: `Object.keys(window.__tasks).filter(k=>k.includes('2028-01-15'))` → `[]`.)
  - Alternativa sin código: React DevTools → App → hook `tasks` → buscar el id.
- **MEDIDO EN VIVO (sesión 11, con `window.__tasks`)**: log de la ventana = `30 pasado + 400 futuro (yearly
  detectado)` → techo TEÓRICO ≈ 2027-08-30. Pero el techo **EMPÍRICO real = 2026-12-31** (0 instancias después,
  reproducible tras recargar; 1494 instancias en estado, de las cuales 1093 son excepciones/supabase
  preservadas). Solo 4/119 plantillas tienen `endDate` (mediados 2026) → no es la causa. **Es el síntoma "el
  futuro lejano sale vacío" del worker viejo** (el mismo que arregla `materializeDay` — cf. migración de
  Calendar). Consecuencias: (a) la zona virgen empieza ~**2027-01-01**, no en 2027-08-31 → **2028-01-15 es
  virgen con margen de sobra** (confirmado: 0 claves `2028-01-15`); (b) **fiarse del techo EMPÍRICO, no de la
  constante**; (c) re-medir el techo por sesión (varía con los datos). **Caveat del fixture**: la plantilla de
  test debe NO tener `endDate` (o uno > día de test) para que la recurrencia ocurra ese día.

### 13.11 Fixture de validación B1 (creado desde la app, forma real; NO tocar tareas reales de la usuaria)
Contenedor "Test Recurrent B1" + 3 hijas diarias, **creado desde la propia app** (no SQL) → forma real.
Verificado en vivo (sesión 11) con `window.__tasks` + `materializeDay`. (Se descartó el INSERT SQL artesanal.)
- **Ids REALES**: contenedor **`t-1785089440019`** ("Test Recurrent B1"); hijas **`t-1785089472309`** ("Test hija1"),
  **`t-1785089481020`** ("Test Hija2"), **`t-1785089493867`** ("Test Hija 3"). Forma confirmada: contenedor
  `recurrence:null`, `dueDate:null`; hijas `daily` (`startDate 2026-07-26`), sin `dueDate`, `taskType:null`.
  `materializeDay('2028-01-15')` produce contenedor + 3 hijas ANIDADAS (parent = id de instancia del contenedor).
  - **Ojo B0**: el id del contenedor es **`t-…`, NO `tmpl-…`** (la app lo creó por `doAddTask`, no por el flujo de
    regla). Por eso este fixture **NO ejercita el bug del regex de B0** (`/^inst-(t-\d+)/` SÍ acierta
    `inst-t-1785089440019-…`). **B0 se valida con su TEST UNITARIO** (`tmpl-` con letras), no con este contenedor.
  - **Creado HOY (startDate 2026-07-26)** → SALE en Mi Día a diario y genera instancias en la ventana del motor
    viejo (hasta ~2026-12-31). Asumido; **borrar al terminar B1**. 2028-01-15 sigue VIRGEN (fuera de ventana):
    `window.__tasks['inst-t-1785089440019-2028-01-15'] === undefined` ✓ (confirmado).
- **Días** (la virginidad se CONSUME al completar → una excepción por día): **2028-01-15** = B1 básico
  (contenedor virgen). **2028-01-16** = caso mixto Q2 (excepción de `c1` generada con la app, §Q2). **2028-01-17/18**
  = repuesto para re-ejecutar. Verificar virginidad con `window.__tasks` antes de cada prueba.
- **Los días de prueba NO son recurso escaso**: TODO 2028 (y más allá) es virgen — cualquier fecha por encima
  del techo del motor viejo (~2026-12-31) sirve. La idea de "días de repuesto" venía del fixture-por-SQL; ya no
  aplica. **Convención de UNA fecha por fase** (para no pisar estados entre validaciones):
  B1 → 2028-01-15 (hecho) · Q2 → 2028-01-17 (hecho) · **B2 → 2028-02-01** · B4 → 2028-02-02 · B5 → 2028-02-03 ·
  C1 → 2028-02-04 · C2 → 2028-02-05 · C3 → 2028-02-06 (siguientes: 2028-02-07…). Verificar virginidad con
  `window.__tasks` antes de cada una. (Nota: 2028-01-16 quedó todo-completado por un clic erróneo; inerte.)
- **Clic en DOM (gotcha para C1/C2/C3)**: (a) leer/clicar SIEMPRE en una llamada aparte del `__goToDate` (React
  re-renderiza async; si no, se lee el DOM viejo). (b) Las HIJAS no están en `<li>` propios → `closest('li')`
  de una hija devuelve el `<li>` del CONTENEDOR (su 1er checkbox = el del contenedor → **cascada**). Para clicar
  una hija concreta: subir desde su `<input>` de título al MENOR ancestro que tenga checkbox y contenga SOLO su
  título. Para el CONTENEDOR: `closest('li')` + primer checkbox (ese sí es el suyo). (c) `window.__spy` se lee en
  llamada aparte (poblado tras un tick).
- **Llegar al día de test**: usar `window.__goToDate('2028-01-15')` (dev, commit `6daae1d`), NO el Calendario.
  El Calendario va lento navegando a 2028 porque su `monthMap` materializa CADA día del mes visible
  (`materializeDay` ×~30 por cambio de mes) — motor **NUEVO**, no `useGeneration` (verificado en consola:
  **0 ciclos `[GENERATION]` al cambiar de mes**). Coste PRE-EXISTENTE del mes (Calendar ya migrado en paso 3); el
  flip NI lo introduce NI lo empeora. Optimización futura (fuera de este paso): indexar excepciones una vez por
  mes, no por día, dentro de `materializeDay`.
- **Q2 (mixto) — SIN SQL a mano, la excepción se genera CON LA APP (forma real)**: tras validar B1 en 2028-01-15,
  ir a **2028-01-16** y con la app **completar solo `c1`** y luego **reabrirla** → queda una excepción `pending`
  con la forma EXACTA que produce la app (evita inventar `parent_task_id`; el "FIX sesión 10" puede escribir ahí el
  id de la instancia del padre, no el de la plantilla). Con `c1` así y `c2`/`c3` vírgenes, completar el contenedor:
  `c1` = update in-place (misma fila), `c2`/`c3` = inserts nuevos → 3 completas, 1 fila/hija, sin duplicar `c1`.
  (DESCARTADO el INSERT artesanal de excepción: probaría una forma que la app quizá nunca produce.)
- **Limpieza antes de D0 — IDS REALES** (borra SOLO las excepciones de prueba; deja las plantillas por si re-validas):
  `delete from tasks where template_id in ('t-1785089440019','t-1785089472309','t-1785089481020','t-1785089493867');`
- **Teardown final** (quita el fixture ENTERO — plantillas + excepciones):
  `delete from tasks where id in ('t-1785089440019','t-1785089472309','t-1785089481020','t-1785089493867') or template_id in ('t-1785089440019','t-1785089472309','t-1785089481020','t-1785089493867');`
  (O más simple desde la app: borrar el contenedor "Test Recurrent B1" con su árbol.)

### 13.12 Barrido de `dashboardTasks.find` — SEGUNDA familia de bug (≠ `tasks[sid]` crudo)
`dashboardTasks` es un array PLANO, del **DÍA ACTIVO** y SOLO de **nivel superior** (las hijas van anidadas, no
como entradas). Resolver el objetivo por `dashboardTasks.find(t=>t.id===id)` falla en DOS ejes: (a) **HIJAS**
(no están en el array) y (b) instancias de un día **≠ activo**. Sitios (sesión 11):
- [useTaskCRUD.ts:59](useTaskCRUD.ts) `handleEditTaskRequest` → **B3** (sin fallback aún; añadir `materializeInstanceById`).
- [useTaskCRUD.ts:86](useTaskCRUD.ts) `handleDeleteTaskRequest` → **B2 ✅ arreglado**.
- [useTaskCRUD.ts:106](useTaskCRUD.ts) `handleDeleteTaskRequest` (inyección del PADRE en memoria) → mismo agujero
  para el padre; hoy inocuo (solo estado, no escritura), revisar al tocar B3/B4.
- [App.tsx:977](App.tsx) handler delete-occurrence → **B2 ✅ arreglado**.
- (`handleToggleStatus` NO usa `dashboardTasks.find`: resuelve por `Object.values(tasks).find` + dayMap
  date-from-id → ya es cross-day por construcción.)
**Patrón de arreglo (uniforme)**: fallback `materializeInstanceById(id, tasks)` — usa la fecha **DEL ID**, no
`activeDate` → cubre hijas y días no-activos. Aplica en B3/B4/B5 y Fase C dondequiera que se resuelva el objetivo
por `dashboardTasks`/estado del día activo.

### 13.13 ⚠️ PUNTO CIEGO DE VALIDACIÓN — "probar desde un día ≠ activo" (requisito FIJO)
`dashboardTasks` = día activo, y `window.__goToDate(D)` convierte D en el día activo → **validar con `__goToDate`
siempre ejercita el camino que funciona** (dashboardTasks lo encuentra). Es el MISMO enmascaramiento que hacía
`useGeneration`, ahora vía `__goToDate`. Un bug que dependa de `dashboardTasks` (§13.12) NO saldrá así.
- **Requisito fijo para CADA fase (B/C) y para el ensayo D0**: validar al menos una acción **desde un día que NO
  sea el activo**. Vía práctica: **Semana** (`WeekView` muestra 7 días; su `weekStart` es independiente de
  `activeDate` — [WeekView.tsx:158,408](WeekView.tsx) tiene input de salto de fecha). Poner `activeDate` en un día
  lejano (p.ej. `__goToDate('2028-06-01')`), ir a Semana, saltar a una semana de 2028 y tocar una recurrente en un
  día del grid (todos no-activos). Si el fallback `materializeInstanceById` (date-from-id) se alcanza → funciona;
  si algún camino aún depende de `dashboardTasks` → sale ahí.
- **Resultado del test (sesión 11) ✅**: `activeDate`=2028-06-01; en Semana, salto a la semana de marzo 2028 y
  completo el contenedor del fixture en **LUN 6 Mar** (día ≠ activo). Spy: **4 upserts, TODOS para `2028-03-06`**
  (no para 2028-06-01). → el fallback date-from-id (B1 dayMap / B2 `materializeInstanceById`) **se alcanza y
  funciona en día no-activo**; toggle NO depende de `activeDate`/`dashboardTasks`. Enmascaramiento de `__goToDate`
  descartado para toggle. (Delete no es probable desde WeekView: no cablea `onDelete`; y las subtareas en WeekView
  solo EDITAN al clic, no togglean sueltas — el toggle del contenedor cascadea.) **Aplicar este test (día ≠ activo)
  a cada fase B/C y al ensayo D0.**
