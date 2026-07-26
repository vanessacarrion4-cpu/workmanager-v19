# WorkManager v20 — Documento de Contexto Completo

> Usar este documento al inicio de cada sesión de desarrollo para dar contexto completo al asistente.
> Última actualización: 17/07/2026 (sesión 10 — auditoría completa + especificación V20)
>
> **ESTADO**: V19 en producción. V20 es la especificación acordada, pendiente de implementar.
> Las secciones marcadas 🔴 describen el estado actual (a corregir); las marcadas 🟢 el objetivo.

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
| 1 | `useTaskOrdering.ts` | `handlePromoteTask`/`handleDemoteTask` **NO persisten** en Supabase (solo `setTasks`). Al recargar se pierde el cambio. **Plan cerrado** → ver §5B "PLAN CERRADO #1". |
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
    - ✅ **PLAN CERRADO #1 — persistir promote/demote (planeado, NO implementado aún)**:
      - **Hoy**: `handlePromoteTask` ([useTaskOrdering.ts:128](useTaskOrdering.ts)) y
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
    - **LIMPIEZA pendiente (código muerto)**: retirar el residuo de nivel 3 en
      `handleDemoteTask` (`useTaskOrdering.ts`, `currentLevel >= 3`). Confirmado por SELECT
      directo a la BD (25/07): **0 tareas de nivel 3** (activas: 862 en nivel 1, 865 en nivel 2).
      Trabajamos en 2 niveles de hecho; el 3er nivel de promote/demote es dead code a quitar.
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
