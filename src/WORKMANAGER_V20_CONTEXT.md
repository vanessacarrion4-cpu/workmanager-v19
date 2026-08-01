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
| 6 | `useBulkActions.ts` | ✅ **RESUELTO** (anti-#6 `be9eed1` + reescrito en C2 `4e748e5`): cálculo fuera del updater, inserts idempotentes. |
| 7 | `useBulkActions.ts` | ✅ **RESUELTO** (C3 `4e748e5`): `activeDate` ya está en las deps de `bulkUpdateTasks`/`bulkDeleteTasks`. |
| 8 | `useTimerHandlers.ts` | `handleStartTimer` llama a `handleStopTimer` **antes de definirlo** (TDZ) → `ReferenceError`. |
| 9 | `useTimerHandlers.ts` | `resolveId` hace `parts.pop()` 3× a ciegas → rompe con templateId que contengan guiones. Usar regex. |
| 10 | ~~`useGeneration.ts`~~ | **N/A — archivo BORRADO en el flip (D2, `d159870`).** El motor viejo ya no existe. |

### 🟡 Funcionales

| # | Descripción |
|---|---|
| 11 | `isTaskCompleted` recibe `instanceDate` y **nunca lo usa** → un contenedor se marca completo según subtareas de TODOS los días. |
| 12 | `filters.ts::getStatsForDay` suma `registered` de todos los timeEntries sin filtrar por bloque activo → descuadre con los estimados. |
| 13 | `useSupabase.ts::repairRecurringContainers` **escribe en Supabase en cada carga** sin comprobar si hace falta. Riesgo de bucle de escrituras. |
| 14 | ✅ **RESUELTO — botón ELIMINADO (30/07)**, no solo blindado. **NO RE-AÑADIR.** Motivos verificados contra el código: (1) el ⚙️ "Configuración" **no abría ningún panel** — su único `onClick` era `handleResetData` (estaba **mal etiquetado**, era un reset disfrazado de ajustes); (2) el reset **no borraba nada real**: `localStorage.removeItem(STORAGE_KEY)` sobre una clave **muerta** (nunca se escribía) + `setTasks({})` + `reload()` → al recargar, `useSupabase` re-lee de **Supabase (la fuente)**, que no se tocaba. Era un susto (pantalla en blanco un instante), no una pérdida. Se quitó el `NavItem`, el handler y los orphans (`STORAGE_KEY`, `MOCK_TASKS`, `INITIAL_BLOCKS` en App, `Settings` de lucide). Si algún día se quiere un "empezar de cero" DE VERDAD, montar uno consciente de Supabase + type-to-confirm; no reponer este. |
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

\* **En Mi Día, la fecha se muestra SOLO como icono de calendario** (sin el texto de la fecha,
que es redundante), pero **clicable**: ese chip NO es solo información, **es el control de mover
la tarea a otro día**. Ocultarlo del todo (como se hizo primero) fue una regresión — se perdía el
mover desde la fila. En las demás vistas, la fecha va con su texto visible.

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

> ⚠️ **SUSTITUIDA (sesión 15).** Esta versión ya NO es la buena → ver la especificación vigente en **§16.8**.
> Contradice lo acordado en dos puntos: (1) lleva el `✓ 35m mejor` comparando **registrado contra estimado**,
> comparación que la usuaria **ya no quiere**; (2) usa los colores **viejos** de core/ad-hoc en vez de los
> definitivos de §15.4 (core `#22C68D`, ad-hoc `#F8AE17`). **No implementar desde aquí.**

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
- ~~Densidad compacta como toggle (36px vs 56px de fila)~~ **ANULADO** por §7.11.1: fila fija 29px, sin toggle.

### 7.11 Decisiones de la fase de diseño (sesión 12 — 27/07/2026)

Tomadas por la usuaria al abrir la fase de diseño. **Prevalecen sobre cualquier otra subsección** si hay contradicción.

1. **Fila fija a 29px, sin interruptor de densidad.** La §7.10 proponía un toggle 36/56px → queda anulado. Manda §7.1: altura única 29px.
2. **`priority` se elimina** de la interfaz y del tipo `Task`. Verificado que no se usa en ningún orden ni filtro ([filters.ts](filters.ts) no lo referencia; solo es campo de paso). El punto de color de la fila pasa a ser el **tipo**: Puesto/`core` esmeralda `#10B981`, Puntual/`adhoc` ámbar `#F59E0B` (coherente con §7.4). **La columna `priority` de Supabase NO se toca**: se sigue escribiendo su default (`'media'`). Cero riesgo de BD.
3. **Modo CLARO es la referencia.** La §7.10 está escrita para oscuro; el trabajo visual se valida en claro (el que usa la usuaria). Base de color: ~90% cableada con pares `dark:`/`-light`; gotea en overlays clavados a oscuro (p. ej. popup "mover tarea" de [TaskCard.tsx:210](TaskCard.tsx), arreglado al tocar la fila) → pulido puntual, no reconstrucción de la base.
4. **Marca "en suspenso" (nueva — parte de la fila V20).** Estado visual para una tarea que no se puede hacer porque **se espera algo**, sin moverla de su sitio ni alterar el orden. Solo marca visual: **sin nota, sin fecha**. Su tiempo **sigue contando** en el pendiente del día (no la excluye de carga). **Convive con la etiqueta "espera"** (§7.5), son cosas distintas: "espera" es etiqueta/grupo del día; "en suspenso" es un flag por fila que NO reagrupa. Persistencia: campo nuevo `onHold?: boolean` en `Task` → requiere columna `on_hold` (boolean) en la tabla `tasks` de Supabase.

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

### 8.10 Promover/degradar-serie de recurrentes 🔵 (sub-proyecto POST-FLIP)

**Funcionalidad nueva, no arreglo — hoy tampoco funciona y no bloquea el flip** (decisión sesión 13). Dos piezas:
- **Promover una instancia recurrente**: decidido **toda la serie con confirmación** (edita el `parentTaskId` de la
  plantilla hija; afecta todos los días). Modal con el tono de mover/borrar ("afecta a todos los días, no solo al que
  ves"). La variante **per-día** (que ese día quede suelta y la serie siga produciéndola en el contenedor el resto) es
  otro sub-proyecto de motor aún más adelante: `materializeDay`/`filters` no soportan un desanclaje por-día (el anidado de
  recurrentes lo manda la PLANTILLA, CASO 1; ver §13.17).
- **Degradar una hija recurrente bajo una hermana** = misma reestructura de serie (serie + modal). (B5a ya cubre el caso
  per-día de una tarea **one-off** dentro de un contenedor recurrente, `ffdad59`.)

Anotado como daño conocido en la tabla §13.4 (no leer como regresión del flip). Reusará el patrón de modal de
`pendingDateChange`/`recurrenceAction` + resolución a plantilla.

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
- **(f) Desde BLOQUES no se completan las tareas recurrentes** (las normales sí; PRE-EXISTENTE, NO del flip — sesión 13).
  Investigar cuando toque si `BlocksView` cablea otro handler de completar (o filtra las recurrentes) distinto al de Mi Día.
- **(g) En el CALENDARIO, al abrir un día, no está el icono de completar** (nunca ha estado; PRE-EXISTENTE, sesión 13).
  El drawer del día del Calendario no expone el toggle de estado. Añadir el control de completar dentro del día.
- **(e) Desde Semana NO se puede mover una tarea a otro día** (detectado sesión 13): `WeekView` recibe
  `onRecurrenceDateChange` pero **nunca lo llama**, y `WeekTaskCard` no tiene selector de fecha. Es justo la vista
  donde arrastrar de un día a otro sería lo más natural. Cablear el arrastre/selector de fecha en Semana →
  `onRecurrenceDateChange` (ya existe el flujo aguas abajo: modal "¿este día / serie?" → `handleUpdateTask`).
- **(a) Dashboard no muestra el mes al desplazarse**: al hacer scroll en Mi Día no se ve el mes.
  **Diagnóstico primero**: averiguar si NO se pinta o si se pinta en **BLANCO** (posible color heredado del
  modo oscuro sobre fondo claro). Según cuál sea, el fix es distinto. Barato, pero no ahora.
- **(b) Navegación de fechas del Calendario más operativa**: **salto directo a mes/año** (selector / "ir a
  fecha") en vez de mes a mes. El `window.__goToDate` dev-only es el parche temporal; la versión de USUARIO
  va aquí. Relacionado con la lentitud del mes (§13.11): menos navegación = menos materializaciones.
- **(d) `TaskModal.handleSave` sin guard de título vacío** ([TaskModal.tsx:120](TaskModal.tsx)): se puede guardar
  una tarea con título en blanco → crea una fila sin título. NO arreglar ahora; añadir un guard (no guardar / avisar
  si `!title.trim()`) en la fase de diseño.
- **(c) Añadir recurrencia desde la fila NO existe** (verificado sesión 11): el `RecurrencePickerChip` de la fila
  solo se renderiza si `task.recurrence` YA existe ([TaskCard.tsx:485,526](TaskCard.tsx)); una tarea sin
  recurrencia no muestra chip → hay que entrar al modal. **Falta el camino, no está roto** (cambiarla en una que
  ya la tiene sí funciona desde la fila). Encaja con la fila V20 §7.3 (chips vacíos clicables) = paso 4.
- **(h) Borrar la columna `priority` de Supabase (tabla `tasks`)** — no se usa. Orden OBLIGATORIO para no romper writes:
  1. ✅ **HECHO (sesión 12):** quitada del código de la app — `Priority`/`Task.priority`/`SubtaskTemplate.priority` fuera;
     ninguna lectura de `.priority` en código vivo (queda solo en `useSupabaseData.ts`, hook MUERTO no importado).
  2. **PENDIENTE:** los writes a `tasks` **todavía escriben `priority: 'media'`** (literal) para no violar la columna.
     Antes de dropear hay que quitar ese literal de TODOS los writers (`useTaskCRUD`, `useBulkActions`, `useTaskOrdering`,
     `App.tsx`) y confirmar por grep que **nadie** manda ya la clave `priority`.
  3. Solo entonces: **backup de `tasks`** → `alter table tasks drop column priority;`. Y de paso limpiar el hook muerto `useSupabaseData.ts`.
- **(i) Error de consola PRE-EXISTENTE en `RegisteredTimeChip`** (sesión 13, no de la fila V20 —
  verificado por `stash` contra `379d074`, aparece igual). Salta en el **montaje inicial** de Mi Día,
  dentro de la maquinaria de medición de framer-motion (`AnimatePresence`/`PopChild`/`PopChildMeasure`
  + `Reorder`); lo captura un error boundary y **la app funciona entera** (recupera). NO se reproduce al
  redimensionar ni al expandir. Investigar aparte: probable choque de `AnimatePresence` anidados
  (popup de RegisteredTimeChip dentro de las subtareas dentro del `Reorder.Group` del Dashboard). Bajo
  impacto (solo ruido de consola), pero conviene silenciarlo.

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
      (ya borradas, inertes). Ids `t-1777493420378 / t-1777492627525 / t-1777490985341`.
      **CORRECCIÓN DE ATRIBUCIÓN (NO son del fantasma)**: tienen `templateId:null` → NO son excepciones de ninguna
      serie; y el fantasma ni tiene `id` → no produciría ids normales `t-<dígitos>`. Explicación aburrida y mejor:
      3 tareas creadas sin título y borradas hace meses. **Se DEJAN** (inertes, del pasado; no se borran filas
      reales en mitad del paso de riesgo). El fantasma de B3 es un riesgo REAL (el path puede escribir) pero estas
      3 filas **no son su evidencia** — no atribuir mal para no contaminar diagnósticos siguientes. B3 (parte 3)
      cierra igualmente ese origen (materializar → editor con datos reales, no vacío).
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
| C1 ✅ hecho+validado (`fc1e734`, §13.18) | Solo selección (marca de más/menos). **Sin escritura** | Seleccionar contenedor → marca sus hijas (incl. virtuales) |
| C2 ✅ hecho+validado (`4e748e5`, §13.18) | **Escritura**: copia malformada o insert duplicado (regresión #6) | Spy `fetch`: duplicar 1 contenedor = N inserts, **0** con `recurrence`/`template_id`; StrictMode no duplica; **insert secuencial padre→hijo** (FK) |
| C3 ✅ hecho+validado (`4e748e5`, §13.18) | **Escritura**: bulk delete/update de virgen = no-op silencioso (PATCH sobre `inst-` inexistente) | Spy: delete virgen = upsert `is_deleted:true`; update = upsert excepción con cambios. Ojo `existsInSupabase` heredado (§13.18) |
| D0 (ensayo) | Ninguno (no cambia código) | Tabla §13.6 en día >+400d en verde ANTES de tocar el flip |
| D1 (desactivar) | **MÁXIMO**: todo lo cercano pasa a virtual de golpe | Consola: **0** logs `[GENERATION]`. Regresión total §13.6. Recarga persiste. Volver atrás = flip del flag |
| Reorder virgen | Escribe `order` en la PLANTILLA (#15) — **ESPERADO, NO regresión** (ver §13.9) | Arrastrar-reordenar una recurrente virgen escribe en `template_id`, no en el día; se arregla en el sub-paso siguiente |
| Reorder virgen — fantasma | Objeto parcial `{order,modifiedAt}` bajo `tasks['inst-…']`, TRANSITORIO (§13.9) | Tras reordenar una virgen: valor sin `.id`/`templateId`; NO lo resuelve `resolveTaskId` ni lo renderiza `materializeDay`; **desaparece al recargar** |
| Promover/degradar-serie de recurrente (B5b) | **NO funciona todavía — ESPERADO, NO regresión** (como el reorder #15). Promover una instancia recurrente, o degradar una hija recurrente bajo una hermana (= reestructura de serie), hoy es no-op y queda para **B5b** (serie + modal). B5a **SÍ** cubre degradar un **one-off** dentro de un contenedor recurrente (validado `ffdad59`). | Al validar el flip: promover/degradar sobre una **instancia recurrente** no persiste → NO leerlo como regresión del flip (nunca funcionó). Backlog en §8.10 |
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
- **DAÑO CONOCIDO (sesión 13) — al mover un CONTENEDOR, el estado por-día de las hijas NO viaja**: `materializeDay`
  recoloca las hijas en el día nuevo por `occursOn` (frescas, `pending`), no las mueve con su estado. Si 2 de 3
  estaban hechas, en el día nuevo aparecen las 3 pendientes. Es semántica de "mover la ocurrencia del contenedor",
  **NO regresión del flip** — no leerlo así en Fase E. (Además: mover contenedor ni siquiera es triggerable por
  chip hoy; §13.16.)
- **DAÑO CONOCIDO (condición 2) — series contaminadas se DUPLICAN post-flip, NO es regresión del flip**: las 4
  series reales ("Pago nóminas", "Pagos mensuales", "Cierre Propias", "Cierre Central Rec") y las otras
  contaminadas aparecerán 2-3 veces en Mi Día/Semana, porque sus plantillas tienen ids `inst-` en `subtasks`
  (64 filas anidadas persistidas, §13.14). **B4 detiene el CRECIMIENTO** (no escribe más `parent_task_id→plantilla`)
  pero NO limpia lo ya escrito → el síntoma persiste hasta la **fase de limpieza post-merge**. En Fase E: NO leerlo
  como regresión del flip (igual que el reorder #15). Se resuelve con el `UPDATE parent_task_id=null` de la limpieza.
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

### 13.14 B4 (mover) — decisiones del modelo antes de implementar (sesión 12)
**Q1 = `null` (decidido)**: en V20 la jerarquía la deriva `materializeDay` desde `template.subtasks` (ids de
plantilla) + `findLanded/findVacated` por `templateId`+día; NO lee el `parent_task_id` de la excepción. Meter
id de plantilla (FIX sesión 10) o inst- virtual corrompe/cuelga. → unificar TODOS los escritores de excepción a
`parent_task_id=null` y **retirar la contaminación de `template.subtasks`** (bloque reconexión-a-plantilla
[useTaskCRUD.ts:473-504](useTaskCRUD.ts)).
- **Condición #1 — CONTAMINACIÓN PERSISTIDA (medido sesión 12)**: la tabla no tiene columna `subtasks` (se
  reconstruye de `parent_task_id`), así que `template.subtasks` con ids `inst-` viene de excepciones con
  `parent_task_id = id de plantilla` (firma del FIX sesión 10; `useGeneration` solo añade a padres-instancia, no
  a plantillas → **sobrevive al flip**). Medido en memoria: **18 de 123 plantillas** contaminadas (hasta 46 hijas
  `inst-`; ids auto-amplificados `inst-inst-…`). Post-flip `materializeDay` las enumeraría como hijas-plantilla →
  **doble/triple render real**. → **B4 necesita LIMPIEZA además del código**. Confirmar conteo persistido con SQL
  (`is_exception AND parent_task_id → is_template`); si >0, `UPDATE ... parent_task_id=null` con backup. Atribución:
  el síntoma es en memoria; el mecanismo implica datos persistidos, pero el conteo exacto va por SQL (no se pudo
  leer el `parent_task_id` crudo desde el navegador).
- **Condición #2 — qué arreglaba el FIX sesión 10**: el HUÉRFANO al mover/editar subtarea recurrente (antes
  `parent_task_id=inst-…` colgante → `reconstructHierarchy` no re-enganchaba). En V20 `materializeDay` re-anida la
  subtarea movida en su día nuevo (`template.subtasks` + `findLanded`) sin `parent_task_id` → `null` lo cubre SIN
  reintroducir el huérfano, **siempre que B4 valide** "subtarea movida aparece bajo su padre en el día destino".
- **Q3 = (B) (decidido con datos)**: hay **3 contenedores movidos** en producción (`dueDate≠instanceDate`,
  templateId=contenedor: "Cierre Propias"/"Pagos del mes FINCA"/"Cierre Central Rec", 2026-07-22→23). El bug del
  `findVacated` (rama CON-hijas de `materializeDay` [instanceEngine.ts:239+](instanceEngine.ts) NO comprueba
  `findVacated` → el contenedor movido aparece en el día viejo Y el nuevo) **ya es visible hoy** → arreglarlo en
  B4: añadir `findVacated` a la rama con-hijas, con test.
- **DESCOMPOSICIÓN (decidida sesión 12) — 3 cosas distintas, NO mezclar**:
  1. **findVacated (bug de LECTURA del motor nuevo)** → **commit propio + test, ANTES de B4** (independiente de
     escritura). Fix: en `materializeDay`, mover el check `findVacated` para que aplique también a la rama
     CON-hijas: tras `containerLanded`, `if (!containerLanded && findVacated(containerExceptions, dateStr)) continue;`
     (y quitar el redundante de la rama sin-hijas). Test: contenedor-con-hijas movido → día viejo vacío, destino
     lo muestra. Q3=(B) por los 3 contenedores movidos reales.
  2. **B4 (arreglo de ESCRITURA)** = (a) unificar excepción→`null` + retirar reconexión-a-plantilla
     ([useTaskCRUD.ts:473-504](useTaskCRUD.ts)) + (d) handler de mover instance-aware (materializar virgen, gap
     `dashboardTasks`, `instanceDate`/`dueDate`, `parent_task_id=null`). Validar: mover hoja/subtarea Y contenedor
     desde **Semana, día ≠ activo** → día viejo vacío, destino la muestra, recarga; y **subtarea movida aparece
     bajo su padre en el destino** (que el `null` no reintroduzca el huérfano del FIX sesión 10).
     - **SCOPE del `null` (condición 1, verificado sesión 12) — NO indiscriminado**: solo `is_exception:true &&
       templateId` (excepción de instancia RECURRENTE). **FUERA (conservan `parent_task_id` real)**: (i) tareas
       manuales no-recurrentes y sus subtareas (sin `templateId`) — `materializeDay` NO las re-anida;
       `reconstructHierarchy` necesita su `parent_task_id` real; ponerlo a `null` las huérfanaría (el bug del FIX
       sesión 10 extendido a toda la app); (ii) plantillas hijas (`is_template:true`, `parent_task_id`=plantilla
       padre = jerarquía correcta). La contaminación a retirar/limpiar es específicamente
       **`is_exception && parent_task_id→plantilla`**; el `null` sustituye SOLO eso.
  3. **LIMPIEZA de datos** → **FASE PROPIA, DESPUÉS DE FUSIONAR B4 A MASTER** (NO antes, NO en la rama): primer
     write masivo e irreversible. **Por qué después del merge, no entre D1 y E**: B4 arregla la RAMA, no
     producción; mientras master tenga el bug, cada edición/mover de una serie contaminada **re-ensucia** → si
     limpio antes del merge, limpio algo que se vuelve a ensuciar. Post-merge el síntoma (contenedores duplicados)
     es VISIBLE y se verifica que la limpieza lo arregla; y aísla "¿fue el flip o la limpieza?". Contenido:
     backup fresco → `UPDATE tasks SET parent_task_id=null WHERE is_exception AND parent_task_id→is_template` →
     recargar y verificar que las series contaminadas dejan de mostrar hijas `inst-`/duplicadas.
- **⚠️ PRODUCCIÓN (mientras B4 no esté en master)**: el bucle es user-driven y las series contaminadas son TRABAJO
  REAL mensual — **"Pago nóminas", "Pagos mensuales", "Cierre Propias", "Cierre Central Rec"** (y las otras 14). La
  fila anidada más reciente es de 2026-07-22 (la generó la usuaria usando la app normal). **Acción**: EVITAR
  mover/editar esas series en producción hasta que el arreglo (B4) llegue a master; cada mover/editar añade filas
  anidadas nuevas que luego habrá que limpiar. NO es un incendio (64 filas en 2 meses), pero sí una restricción de
  uso hasta el merge. (Corrige el "no es emergencia": para validaciones sí, para el uso real de la usuaria no del todo.)
- **BUCLE `inst-inst-…` VIVO (medido sesión 12)**: **52 excepciones persistidas** doble-anidadas + **12 triple**
  (`is_exception:true`, `existsInSupabase:true`), creadas jun–jul, `modifiedAt` hasta 2026-07-22. Patrón
  `inst-inst-t-X-FECHA-FECHA` (misma fecha 2×) = instancia de 1er nivel metida en `template.subtasks` y
  re-instanciada. **Camino**: FIX sesión 10 escribe `parent_task_id=plantilla` al editar/mover subtarea recurrente
  → `reconstructHierarchy` la mete en `template.subtasks` → se genera `inst-{inst-…}` → si se toca, se persiste y
  FIX sesión 10 re-enlaza → triple. **El que lo mantiene vivo = el código que B4 retira** → "cerrarlo" ES
  B4-parte-1 (no hay paso separado). Tras B4, los writes van a `null` → no re-contamina → no amplifica. Crecimiento
  es **user-driven** (solo al editar/mover series contaminadas); no crece mientras se validan fixtures.

### 13.15 ⏸️ PUNTO DE RETOMA — retomar por B5 (B4 cerrada en sesión 13)

**Estado de fases (rama `refactor-v20`, árbol limpio):**
| Fase | Estado | Commits (código) |
|---|---|---|
| #1 promote/demote persistencia | ✅ hecho + validado en vivo | `83a7301` |
| Fase A (`materializeInstanceById` + tests) | ✅ hecho | `84d53e5`, `e61b415` |
| B0 (regex add-subtask → strip) | ✅ hecho + test | `eefa2f6` |
| B1 (toggle materializa la rama, `dayMap`) | ✅ hecho + validado (básico/idempotencia/Q2) | `df0a2f2` |
| B2 (borrar virgen: hija con `materializeInstanceById`) | ✅ hecho + validado (contenedor+hija) | `052510a` |
| B3 (editar virgen → modal, editor con datos reales) | ✅ hecho + validado (Semana, día≠activo) | `8d4f782` |
| `findVacated` (contenedor movido no duplica) | ✅ hecho + validado (43 tests + A/B en vivo) | `3fa2be0` |
| B4-cambio-1 (retirar contaminación edición + null) | ✅ hecho + validado (Semana, día≠activo) | `fb2a57b` |
| B4-cambio-2 (mover subtarea: `parent_task_id→null` + retira dead code) | ✅ hecho + validado en vivo (forma de fila + no-contaminación + recarga) | `66649e8` (+`cb6f4fd` dev) |
| **B5 (promote/demote de virgen)** | ⏸️ **SIGUIENTE** (turno aparte) | — |

**B4 — dos commits (plan detallado en §13.14):**
- **B4-cambio-1 (contaminación + null)**: en `handleUpdateTask` ([useTaskCRUD.ts:473-504](useTaskCRUD.ts)) quitar el
  `push` de la instancia a `template.subtasks` (482-487) y cambiar el `supabase.update` a `parent_task_id: null`
  (494-501); en el move-to-date ([:457](useTaskCRUD.ts)) `parentTaskId: null` en vez del inst- virtual. Scope: SOLO
  excepciones recurrentes (`is_exception && templateId`) — §13.14 condición 1. ⚠️ **RIESGO — bloque ENTRELAZADO**:
  esas líneas de contaminación conviven con la **propagación de `isTemplate` al padre (506-516)**, que NO es
  contaminación y **debe seguir funcionando**. Disecar solo las 3 líneas de contaminación; NO tocar la propagación.
  **Validación B4-cambio-1**: (a) spy — editar una subtarea recurrente ya NO escribe `parent_task_id→plantilla`;
  (b) la subtarea sigue bajo su padre; (c) **EXPLÍCITO: el contenedor sigue siendo `isTemplate` tras el edit**
  (la propagación 506-516 no se rompió), no solo "desapareció la contaminación".
- **B4-cambio-2 (mover instance-aware)**: materializar la virgen antes de mover (gap `dashboardTasks`, patrón
  B1/B2) + conservar `instanceDate`/`dueDate`. **Validación**: mover **hoja Y contenedor** desde **Semana, día ≠
  activo** → día viejo vacío, destino la muestra, recarga; y **subtarea movida bajo su padre en el destino**
  (que `null` no reintroduzca el huérfano del FIX sesión 10).

**Entorno vivo (recordatorio para retomar):**
- **Fixture de prueba** `t-1785089440019` "Test Recurrent B1" + 3 hijas (`t-1785089472309/481020/493867`), creado en
  la app; días ya consumidos: 2028-01-15/16/17, 02-01, 02-08, 03-06/13, 04-03, 05-10, 05-12; **Fase C**: 02-06 (C3 delete),
  02-09 (C3 update). 02-04/02-05/06-14 solo lectura/limpiados (C1/C2/B5a). **Convención**: una fecha nueva por fase
  (§13.11). **Cleanup del fixture** cuando ya no haga falta:
  `delete from tasks where id in ('t-1785089440019','t-1785089472309','t-1785089481020','t-1785089493867') or template_id in (los mismos 4);`
- **Código DEV-ONLY a RETIRAR en D2**: `window.__tasks` + `window.__goToDate` + `window.__materializeDay`
  ([App.tsx](App.tsx), este último en `cb6f4fd`) y el spy de escrituras (`devFetch`/`window.__spy` en
  [supabaseClient.ts](supabaseClient.ts), commit `2609be0`). Uso: leer `window.__spy` en llamada APARTE (se puebla
  tras un tick). `window.__materializeDay(dia, window.__tasks)` = materializa cualquier día sin cambiar el activo.
- **⚠️ PRODUCCIÓN hasta el merge de B4 a master**: NO mover/editar las 4 series contaminadas ("Pago nóminas",
  "Pagos mensuales", "Cierre Propias", "Cierre Central Rec") — cada edición añade filas anidadas (bucle vivo).
- **Limpieza de contaminación** = fase propia **DESPUÉS de fusionar B4 a master** (§13.14). El **conteo del SQL**
  (`is_exception && parent_task_id→is_template`) que la usuaria está corriendo **alimenta esa fase**, no B4.
- **Requisito de validación fijo** (§13.13): cada fase B/C y el ensayo D0 se prueban también desde un **día ≠ activo**
  (vía Semana), no solo con `__goToDate` (que hace activo el día probado → enmascara).

### 13.16 Estado B4 (sesión 13) — cambio-1 y cambio-2 HECHOS Y VALIDADOS ✅ (B4 CERRADA)
- **B4-cambio-1 ✅ HECHO Y COMMITEADO (`fb2a57b`)**: en `handleUpdateTask`, retiradas las 3 líneas de
  contaminación del bloque de reconexión-a-plantilla (push a `template.subtasks`; `parent_task_id` memoria + persist
  `realParentTemplateId` → `null`). La propagación de `isTemplate` al padre (506-516) INTACTA. Scope: entero dentro
  de `if (updatedTask.recurrence …)`.
  - **Part A validado en vivo** (Semana, día ≠ activo, 2028-04-03): 1 write `parent_task_id: null`,
    `template.subtasks` sin `inst-`, contenedor sigue `isTemplate`, hija bajo su padre en render inmediato Y tras
    recargar (sin huérfano).
  - **Part B (scope no-recurrente) CERRADA por garantía ESTRUCTURAL**: el cambio está entero dentro de
    `if (updatedTask.recurrence …)` (línea-guarda NO tocada) → una subtarea no-recurrente no entra, conserva su
    `parent_task_id` real. **Spot-check de la usuaria pendiente** (editar una subtarea manual en uso normal → sigue
    bajo su padre). No es inferencia difusa: es el control de flujo literal.
- **B4-cambio-2 (sesión 13) — CORRECCIÓN DEL PLAN: la parte "instance-aware" NO hacía falta**. Al investigar:
  mover pasa el **objeto renderizado** directo a `handleUpdateTask` (`...task` desde `onRecurrenceDateChange`/el
  modal de fecha), **NO lo relee de `tasks`/`dashboardTasks`** → mover una virgen **ya funcionaba** (persistía el
  upsert new-date). No hay gap de materialización aquí (a diferencia de toggle/delete que sí leen `tasks[id]`).
  → **cambio-2 se reduce a QUITAR LA CONTAMINACIÓN**: el write del move de subtarea recurrente escribía
  `parent_task_id = plantilla` (rama `_isSubtaskDateChange` de `handleUpdateTask`, vía `resolveParentIdForSupabase`,
  el "FIX Bug4") — 2º escritor de `parent→plantilla` además del de cambio-1. **Fix = una línea → `null`**.
  `instanceDate`/`dueDate` ya se escribían bien; `materializeDay` re-anida en el destino por `templateId`. (No
  reclamar trabajo instance-aware que no era necesario.)
  - **✅ HECHO (sesión 13, `66649e8`)**: `parent_task_id → null` + retirado `resolveParentIdForSupabase` (sin
    llamadas tras cambio-1+cambio-2). Instrumentación `window.__materializeDay` en `cb6f4fd` (dev-only, D2). build+43/43.
  - **✅ VALIDADO EN VIVO** (fixture, mover **Test hija1** `2028-05-10 → 05-12` desde Mi Día vía `DatePickerChip`→
    "Solo este día", +recarga). Forma de la fila UPSERT comprobada (no solo que persista): `id=inst-t-1785089472309-
    2028-05-12`, `parent_task_id=null`, `is_exception=true`, `template_id=t-1785089472309`, `instance_date=2028-05-10`,
    `due_date=2028-05-12`, título/block/status/order poblados (no "a medias"). Tras `reconstructHierarchy` al recargar:
    `template.subtasks=[Hija2,Hija3,hija1]` (los 3 ids de plantilla, **cero `inst-`** → sin contaminación). Render:
    05-10 vaciado (sin hija1), 05-12 anida hija1 bajo su contenedor. **Día 2028-05-10/05-12 CONSUMIDOS** (ver §13.11).
- **Disparo del move (sesión 13)**: solo desde el **`DatePickerChip`** de filas `!hasSubtasks` (hojas/subtareas)
  en Mi Día / drawer del Calendario / Bloques / Delegadas / Search. **NO desde Semana** (ver §11.1) ni sobre
  **contenedores** (no llevan chip de fecha). El contenedor-move (los 3 reales) vino de otro mecanismo; su
  read-side ya lo cubre `findVacated` (validado), y su write-side ya era `null` (path general).
- **⚠️ LIMITACIÓN DE TOOLING (afecta a validaciones futuras)**: con el panel del navegador sin mostrar, **NO puedo
  teclear de forma fiable en inputs** (`computer.type`/screenshot fallan); solo van clics vía `.click()` y
  `form_input` a nivel DOM. **C1 (selección) y C2 (duplicar) son casi todo clics → OK**. Pero si una validación
  necesita **CREAR algo** (una tarea/subtarea de prueba nueva), **lo crea la usuaria**, no intentarlo desde aquí.
  Y NUNCA editar tareas reales de trabajo para validar — usar fixtures/throwaways.

### 13.17 B5 (promote/demote de virgen) — decisiones + FK + evidencia de producción (sesión 13)
**Vistas que disparan promote/demote hoy**: Mi Día, Bloques, Calendario (botones en [TaskCard.tsx:664-679](src/TaskCard.tsx:664)).
**NO Semana** (`WeekTaskCard` no recibe `onPromote`/`onDemote`). Promover = solo filas con `parentTaskId`; degradar = siempre.
Ambos reciben el id materializado → para virgen (`inst-…`) hoy es **no-op silencioso** ([useTaskOrdering.ts:132,192](src/useTaskOrdering.ts:132)).

**Decisiones de modelo (tomadas por la usuaria):**
1. **Promover = TODA LA SERIE, con modal de confirmación** (opción 2). Editar el `parentTaskId` de la PLANTILLA hija
   (abuelo/`null`), afecta todos los días. Modal con el mismo tono que mover/borrar ("afecta a todos los días, no solo
   al que ves"). La opción 3 (**promover solo un día**) = sub-proyecto de motor **DESPUÉS del flip** (ver §11.1), NO aquí.
2. **Degradar = MATERIALIZAR PRIMERO** (patrón B1/B2/B4): crear la instancia del contenedor de ese día como **fila real
   (excepción)** y usar ese id real como `parent_task_id` → FK válida, anida solo ese día. Rechazados: `inst-` virtual
   (colgante) y plantilla (contaminación). Degradar una hija recurrente bajo otra = reestructura de serie → criterio de
   promover (serie + modal).

**⚠️ FK CONFIRMADA EN VIVO (contradice la suposición de "no hay FK")**: existe `tasks_parent_task_id_fkey` sobre
`tasks.parent_task_id → tasks.id`. Sondeo reversible (sesión 13, cliente expuesto temporalmente + revert): `UPDATE`
con parent inexistente → **error `23503`** ("violates foreign key constraint"), revert limpio. **Consecuencia**: hoy,
degradar bajo un contenedor virtual escribe `parent_task_id = inst-K-D` (fila inexistente) → **23503 → peta en silencio**
(el `.then(({error})=>console.error)` lo traga; la UI optimista queda, pero NO persiste → se pierde al recargar). Por eso
**materializar-primero es OBLIGATORIO, no una preferencia**. Es también la razón de toda la arquitectura "instancias con
`parent_task_id=null` + reconstruir por `templateId`" ([reconstructInstanceHierarchy](src/useSupabase.ts:60)) — es el workaround de la FK.

**Plan de dos commits (split acordado: degradar primero, promover-serie después):**
- **B5a — DEMOTE materializar-primero** (sin modal): en `handleDemoteTask`, cuando el nuevo padre es una instancia
  contenedor virtual, crear su fila-excepción del día (`inst-K-D` real: `is_exception`, `templateId=K`, `instance_date=due_date=D`,
  `parent_task_id=null`) y luego persistir `parent_task_id = inst-K-D`. Si el sujeto degradado es virgen, materializarlo también.
- **B5b — PROMOTE serie + DEMOTE-serie + MODAL**: `handlePromoteTask` (y demote-serie) resuelven a plantilla y editan
  `parentTaskId` de la plantilla, tras confirmación en un modal nuevo (reusar patrón de `pendingDateChange`/`recurrenceAction`).

**Qué se toca / qué queda intacto:**
- TOCA: `useTaskOrdering.ts` (ambos handlers); en B5b, App.tsx (modal nuevo) + su wiring.
- INTACTO: promover/degradar **no-recurrente** (path actual, persistencia #1 `83a7301`) — **única regresión posible, validar explícito**;
  `instanceEngine.ts` y `filters.ts` (la opción per-día queda para el sub-proyecto; degradar reusa el manejo existente de
  excepción-de-contenedor); patrón anti-#6/StrictMode (cálculo fuera del updater) intacto en ambos.

**Evidencia de producción del bug que quita el flip (sesión 13)**: la usuaria abrió la app y las recurrentes
**desaparecieron**, volviendo **al recargar** → `useGeneration` no terminó de generar antes del primer render (carrera
async del motor viejo). Es exactamente el fallo que elimina el flip: `materializeDay` es **puro y síncrono**, sin generación
diferida ni carrera. **Valoración del fixture como agravante**: el fixture (§13.11) tiene `startDate 2026-07-26` (NO 2028)
→ sus 3 hijas diarias **SÍ generan en-ventana** (2026-07-26 → techo ~2026-12-31 ≈ 158 días × 3 + contenedor ≈ **475–630
instancias**, ~20-25% del estado). Contribuye de forma plausible a la carrera. **Recomendación**: borrarlo (query en §13.15)
y **recrearlo con `startDate 2028-01-01`** (la intención original) → el generador no lo toca (fuera de ventana) → **carga
cero**, y sigue válido para validar B5 (materializeDay funciona en cualquier fecha; virginidad garantizada). Recrear cuando
toque validar B5a (la usuaria lo crea; yo no tecleo inputs de forma fiable).

**B5a NO es solo preparación — arregla un BUG REAL de producción**: con la FK confirmada, degradar hoy una tarea dentro de
un contenedor recurrente escribe `parent_task_id=inst-K-D` (fila inexistente) → **23503 → falla en silencio** (la usuaria
degrada, la UI lo muestra un instante, y al recargar vuelve a estar fuera). B5a lo convierte en persistente. Es fix, no andamiaje.

**El startDate de recurrencia NO es elegible desde la UI viva**: el `RecurrencePickerChip` ([Chips.tsx:300-570](src/Chips.tsx:300))
tiene frecuencia, días, día-del-mes y "Termina" (endDate), pero **ningún input de inicio** — se fija a `formatLocalISO(new Date())`
(hoy) al activar recurrencia (líneas 366/412/564). Los inputs de startDate solo están en ficheros NO vivos (`App-from-github.tsx`,
`App - copia.tsx`, `workmanager-v19/`). → **HECHO (sesión 13)**: en vez de recrear, se subió el `recurrence.startDate` de las 3
hijas del fixture a **2028-01-01** con un `update` puntual (técnica del sondeo FK). Resultado verificado: días 2026/2027 vacíos,
**0 instancias del fixture en estado** (carga del generador eliminada), `startDate 2028-01-01`, ids sin cambiar. **Excepciones 2028
ya creadas siguen 100% válidas**: para toda fecha ≥ 2028-01-01, `occursOn` es idéntico con inicio 2026 o 2028 → la salida de
`materializeDay` para todos los días 2028 es byte-idéntica antes/después (01-15/03-13/04-03/05-10 intactas; 02-01 vacío = excepción
de contenedor borrado pre-existente de B2, no del bump).

**Inventario de escrituras a `parent_task_id` (barrido preventivo del FK, para Fase C — file:line):**
- **BUG ACTIVO (lo arregla B5a)**: [useTaskOrdering.ts:260](src/useTaskOrdering.ts) `handleDemoteTask` → `aboveTaskId` puede ser
  `inst-…` virtual → 23503 silencioso. Interceptado en B5a (materializar-primero) para el caso one-off-en-contenedor.
- **⚠️ LANDMINE FASE C (NO tocar aún, arreglar en C)**: [useBulkActions.ts:285](src/useBulkActions.ts) `bulkDuplicateTasks` — el
  `insert` escribe `parent_task_id: task.parentTaskId` CRUDO. Un hijo-excepción real tiene su `parentTaskId` en memoria = `inst-…`
  (se lo pone [reconstructInstanceHierarchy](src/useSupabase.ts:78) al cargar) → duplicarlo inserta una FK colgante → **23503 silencioso**.
  Es justo el bug #20 (duplicar contenedores) de Fase C. Anotado para no descubrirlo en vivo allí.
- **B5b lo aborda**: [useTaskOrdering.ts:181](src/useTaskOrdering.ts) `handlePromoteTask` → `grandParentId`; hoy no-op para virgen,
  pasará a serie/plantilla (id real) en B5b.
- **SEGUROS (null o resueltos a templateId/null antes de escribir)**: [useTaskCRUD.ts:204/487/559/633/749](src/useTaskCRUD.ts) (null);
  [useTaskCRUD.ts:368](src/useTaskCRUD.ts) y [:647-650](src/useTaskCRUD.ts) (`supabaseParentId` resuelve `inst-`→templateId/null);
  [useBulkActions.ts:96](src/useBulkActions.ts) y [App.tsx:990](src/App.tsx) (null).
- **FUERA DEL PATH VIVO (no importados desde `src/`; anotar por si se reviven)**: [useSupabaseData.ts:162](src/useSupabaseData.ts)
  `saveTask` (código muerto — App usa `useSupabase`); [api/sync.ts:47](api/sync.ts), [api/tasks/[id].ts:12](api/tasks/[id].ts),
  [api/tasks/index.ts:36](api/tasks/index.ts) (endpoints serverless, escriben `parentTaskId` crudo — 23503 si se usan con parent virtual).

**Estado B5a (sesión 13) — ✅ HECHO Y VALIDADO EN VIVO** (`d24e120` intercept + `ffdad59` fix del filtro "solo del día",
encontrado al validar). Intercept en `handleDemoteTask`, cuerpo original **intacto** (cero regresión); `buildExceptionRow` reusa
el shape de cambio-2. **Validación en vivo** (día 2028-06-14, one-off throwaway bajo el contenedor fixture, con pre-check de
seguridad para NO tocar el contenedor real «Rutinas mañana»):
- Spy: **1 upsert del contenedor** (`inst-t-1785089440019-2028-06-14`, `is_exception=true`, **`parent_task_id=null`**,
  `template_id`, `instance_date=due_date=06-14`) **+ 1 PATCH del one-off** (`parent_task_id=inst-t-1785089440019-2028-06-14`),
  en orden padre→hijo, **sin 23503** (consola limpia).
- Tras recargar: el `parent_task_id` del one-off **PERSISTE** (el FK lo aceptó → fin del fallo silencioso); one-off **anida bajo el
  contenedor** en el DOM (getVisibleSubtasksForDay CASO 2); **plantilla sin contaminar** (`subtasks`=3 ids de plantilla, cero `inst-`).
- **NO-REGRESIÓN** (la que pidió la usuaria): degradar una tarea **normal bajo otra normal** → **1 solo PATCH** (parent real),
  **sin upsert de contenedor** → el intercept NO se activa, el path original corre igual. B bajo A persiste.
- Andamiaje (one-off + 2 planas + order del contenedor + excepción 06-14) **limpiado**; fixture **virgen** de nuevo (06-14 libre).
- **Cliente `__supabase` dev-expuesto durante el turno para las ops de fixture/validación → RETIRADO** (revertido en `supabaseClient.ts`).

### 13.18 Fase C (bug #20) — ✅ HECHA Y VALIDADA EN VIVO (sesión 13, método autónomo)
Los tres handlers instance-aware para selección + bulk. Días de validación ≠ activo vía `__goToDate`.
- **C1** (`fc1e734`) `toggleTaskSelection`: usa las `subtasks` del OBJETO RENDERIZADO (materializado) que `TaskCard`
  pasa, no `tasks[id]` crudo. **Validado** (2028-02-04): seleccionar contenedor **virgen** marca contenedor + 3 hijas;
  deseleccionar limpia las 4. Solo UI, sin escritura.
- **C2** (`4e748e5`) `bulkDuplicateTasks`: rootIds/subOriginals desde el día materializado; `duplicateTaskRecursive`
  limpia `templateId/instanceDate/isException/recurrence` → duplicado = **one-off suelto limpio**; `parent_task_id`
  **FK-safe** (raíz a `null` si el padre no es fila real; nunca `inst-` virtual/generado); **insert SECUENCIAL padre→hijo**
  (el `forEach` paralelo anterior podía insertar una hija antes que su contenedor → 23503). Anti-#6 intacto. **Validado**
  (2028-02-05): duplicar contenedor virgen → **4 inserts** (contenedor `parent=null` + 3 hijas `parent`=id fresco), metadatos
  limpios, `uniqueIds=4` (StrictMode no duplica), **sin 23503**, persiste, original intacto.
- **C3** (`4e748e5`) `bulkDeleteTasks`/`bulkUpdateTasks`: `createDayResolver` (materializa cada día implicado UNA vez).
  Delete virgen → **upsert fila-excepción `is_deleted:true`** (antes `UPDATE .eq(inst-…)` inexistente = **no-op**).
  Update virgen → upsert excepción con los cambios. **Validado**: delete (02-06) → 4 upsert `is_deleted:true`, día
  suprimido y persiste; completar (02-09) → 4 upsert `is_exception:true status:completed`, persiste. Plantilla sin contaminar.
- **⚠️ GOTCHA encontrado al validar C3** (útil a futuro): `materializeDay` **hereda `existsInSupabase:true`** de la plantilla
  (por el spread `{...childTemplate}`), así que ese flag **NO distingue** "instancia virgen" de "excepción persistida". La
  condición `!existsInSupabase` de `bulkUpdate` mandaba el update de una virgen al **PATCH no-op**. Fix: forzar upsert para
  vírgenes resueltos (`isVirgin = !!resolvedById[id]`), no fiarse de `existsInSupabase`. `bulkDelete` no usaba ese flag (upsert
  incondicional) → no le afectaba.
- **Bug #20 CERRADO**: selección (C1) y duplicación (C2) de contenedores virtuales funcionan; se cierra también el landmine
  del 23503 al duplicar ([useBulkActions.ts:285] inventariado en §13.17). Reorder de virgen (#15) sigue diferido (Fase R).
- **Dev-hooks de validación retirados** (`__selectedTaskIds`/`__setSelectionMode`/`__bulk*` en App.tsx; `__supabase` no se
  usó esta vez). Quedan solo los de siempre (`__tasks`/`__goToDate`/`__materializeDay`, a retirar en D2).
- **Con C hecha, el flip (Fase D) queda a tiro.**

### 13.19 Fase D — FLIP: D0 SALTADO, D1 HECHO (sesión 13)
- **D0 (ensayo general) SALTADO — decisión de la usuaria.** Razón: su valor era hacer el flip *aburrido* cuando el
  retroceso era caro; pero **D1 es un interruptor y volver atrás son segundos**, y **el ensayo ya está hecho repartido**:
  cada fase (#1, A, B0–B5a, C1–C3) se validó en días de **2028 con todo VIRTUAL** — que es exactamente el estado post-flip.
- **Backup**: el de hoy (`tasks_rows_27072026`) sirve — desde entonces solo se ha escrito sobre el fixture y días de 2028.
- **`git tag v20-pre-flip`** en `5a8b3a9`. **D1** (`9785812`): `GENERATION_ENABLED=false` en [useGeneration.ts](src/useGeneration.ts)
  (early-return; sin borrar). **Revertir el flag (una línea)**: poner `GENERATION_ENABLED = true` en `src/useGeneration.ts` (o `git revert 9785812`).
- **BASELINE pre-flip (motor viejo puesto)**: Mi Día de HOY (Lunes 27) = **20 TAREAS** (contador de la app). Es la cifra de comparación.

#### Lista de validación post-flip (la corre la usuaria; días 2028 = todo virtual)

> **⚠️ DAÑO CONOCIDO — NO es regresión del flip (esperado):**
> - Las **4 series contaminadas** ("Pago nóminas", "Pagos mensuales", "Cierre Propias", "Cierre Central Rec") se verán
>   **duplicadas/triplicadas** — es la contaminación histórica, se limpia post-merge (§13.14), no la introduce el flip.
> - **Reordenar** una recurrente cambia **todos los días** (#15, Fase R diferida).
> - **Promover** una recurrente **no hace nada** (B5b diferido, §8.10).

1. **CRÍTICO** — Mi Día de HOY: **mismo número (20) y orden** de tareas; **consola sin `[GENERATION]`** ni errores rojos;
   **recargar** y sigue igual.
2. **Las 7 vistas, un vistazo**: Mi Día · Semana · Calendario · Bloques · Delegadas · Search · Carga. **Foco en Bloques y
   Delegadas** (nunca ensayadas en modo virtual).
3. **Acciones, una vez cada una y recargando después**:
   - Completar una recurrente **con subtareas** (las hijas también se completan).
   - **Borrar** una ocurrencia (no vuelve al recargar).
   - **Editar desde Semana** (sale el modal, "solo este día").
   - **Mover** a otro día.
   - **Seleccionar contenedor** (marca las hijas).
   - **Duplicar contenedor** (copia limpia, sin recurrencia).
   - **Calendario** en un mes lejano: abrir el día y **completar dentro**.

- **Validación post-flip: ✅ VERDE, SIN REGRESIONES** (la usuaria, en producción comparada en paralelo). Mi Día de hoy = mismo
  contador (20) y orden; consola sin `[GENERATION]` ni errores; recarga OK. Las 7 vistas cargan. Acciones: completar con hijas ·
  borrar (no vuelve) · editar desde Semana (modal) · mover · seleccionar contenedor marca hijas (**bug #20 muerto**) · duplicar
  contenedor limpio · Bloques. **De los 3 fallos encontrados al desarrollar, ninguno lo causó el flip** (los 3 ya estaban).
- **Dos fallos PRE-EXISTENTES detectados (NO del flip, al backlog §11.1)**: (1) desde **Bloques** no se completan las recurrentes
  (las normales sí) — investigar si `BlocksView` usa otro handler; (2) en **Calendario**, al abrir un día, no está el icono de completar.
- **✅ D2 HECHO (`d159870`)**: borrados `useGeneration.ts` (+`useTemplateKey`) y `generation.worker.ts`; retirados el import/llamada
  en App.tsx y TODO el código dev-only (`__tasks`/`__goToDate`/`__materializeDay`, `devFetch`/`__spy`, y los `__*` de Fase C).
  Grep = 0 consumidores de código (solo comentarios históricos). build ✅ + 43/43. −629 líneas.
- **PERF post-flip** (medido antes de borrar los dev-hooks): materializar un **MES (30 días) = 42.86 ms @ 2410 claves** (media 10
  pasadas, en caliente; ~1.43 ms/día). Baseline sucio ~63 ms @ 2324 → **~1.5× más rápido y con más tareas**. Señal objetiva de que el flip aligeró la app.

### 13.20 Merge a master — PLAN (producción = app de trabajo de la usuaria; ir con calma)
**Contexto**: `master` (desplegado en Vercel) usa el motor VIEJO; `refactor-v20`, el nuevo. **Ambos leen la MISMA Supabase.**
Las excepciones creadas por el motor nuevo son filas `is_exception` que el motor viejo TAMBIÉN respeta (excepción persistida gana +
`resolveTaskId`) → **los datos son compatibles en ambos sentidos**, así que ir y volver es seguro (el rollback es solo de CÓDIGO).

**A. ANTES de fusionar (comprobar):**
1. `refactor-v20`: árbol limpio + `vite build` ✅ + `vitest` ✅ (confirmado tras D2). Grep sin dev-only (hecho).
2. **Backup fresco de `tasks`** justo antes (aunque `tasks_rows_27072026` vale; exportar uno nuevo por seguridad).
3. **Dimensionar la contaminación**: correr el conteo SQL (`is_exception` && `parent_task_id` → una fila `is_template`) para saber
   cuántas filas de las 4 series están contaminadas. **No bloquea el merge**, pero tener lista la limpieza (ver §13.14 / punto D).
4. (Opcional) `git tag v20-merge` en el commit de merge para referencia.

**B. CÓMO fusionar:**
1. `git checkout master && git pull` (master al día).
2. `git merge --no-ff refactor-v20` → **un solo commit de merge** (revertible de un tiro).
3. `git push origin master` → **Vercel auto-despliega**. Esperar el deploy verde.
4. **Verificación inmediata en producción** (lista corta de §13.19): Mi Día de hoy = contador/orden correcto; consola sin errores;
   completar una tarea + recarga. Si algo chirría → rollback (C).

**C. CÓMO REVERTIR si algo va mal en producción:**
- **Más rápido (segundos, sin git)**: en **Vercel → Deployments → el deployment ANTERIOR (pre-merge) → Promote to Production**
  (rollback instantáneo al motor viejo). Como la DB es la misma y los datos son compatibles, no se pierde nada.
- **Por git**: `git revert -m 1 <commit-de-merge>` en master + `git push` → Vercel redepliega el motor viejo.
- El `git tag v20-pre-flip` (en `refactor-v20`) marca el último estado con motor viejo aún vivo, por si hace falta comparar.

**D. Riesgos / qué vigilar (esperado, no bloqueante):**
- **Las 4 series contaminadas se verán duplicadas/triplicadas** hasta correr la **limpieza de contaminación** (fase propia
  post-merge, §13.14): `UPDATE tasks SET parent_task_id = NULL WHERE is_exception AND parent_task_id IN (<ids de plantillas>)`
  — validar el `WHERE` con el conteo del punto A.3 antes de ejecutar; hacer backup antes. Con eso, `reconstructHierarchy` deja de
  empujar el `inst-` a la plantilla y el doble-render desaparece.
- Reorder de recurrente cambia todos los días (#15, Fase R) y promover recurrente no hace nada (B5b) — daño conocido, no del merge.
- Nada más: reading validado idéntico (mismo contador 20) y perf mejor.

### 13.21 Limpieza de contaminación — ❌ CANCELADA (no aplazada)
**Conteo real** (la usuaria, post-merge en producción, con el SQL de §13.20): **446 filas** `is_exception && parent_task_id → plantilla`,
repartidas en **24 series** — NO las 4 previstas. Mayores: **Rutinas mañana (132), Gestión campaña (117), Verduras vivas (46),
Selecció RRHH (24)**. Ninguna de las 4 predichas (Pago nóminas / Pagos mensuales / Cierre Propias / Cierre Central Rec).
- **El síntoma predicho NO apareció**: esas 24 series se ven **NORMALES** en producción tras el flip — sin duplicar/triplicar.
- **Decisión: CANCELADA, no aplazada.** Con la predicción fallando no se aplica el tratamiento: no se modifican **446 filas de 24
  series** (incluida la rutina diaria de la usuaria) para arreglar algo que **no se manifiesta**. Empírico manda sobre el modelo.
- **Se reabre SOLO con síntoma nuevo**: si alguna vez se ve una tarea **REPETIDA en un día concreto** → diagnóstico nuevo primero,
  y solo entonces limpiar lo que corresponda (con su propio `WHERE` acotado).
- **Hipótesis a comprobar cuando toque**: ese `parent_task_id → plantilla` es probablemente **INERTE en V20**, porque `materializeDay`
  anida las hijas por **PLANTILLA** (reconstruye desde `container.subtasks` de la plantilla y matchea excepciones por `templateId`+día)
  e **ignora la columna `parent_task_id` de la instancia** para el anidado. Si se confirma, **no hay nada que limpiar nunca**. (El
  doble-render que sí vimos en B4 era el COMPOUNDING `inst-inst-`, un caso más específico; no se ha reproducido con estas 446 filas.)
- **No crece**: el código nuevo (cambio-1/2, C2, C3) ya escribe `parent_task_id = NULL` en toda excepción que crea → el conteo NO aumenta con el uso. (Esto SIGUE siendo cierto — es independiente de lo de abajo.)

> **⚠️ CORRECCIÓN (la usuaria, post-cierre): la hipótesis de INERCIA NO SE SOSTIENE, y la reapertura ESTÁ ACTIVA.**
> - **Síntoma nuevo CUMPLIDO**: **"Cierre Anual" sale DUPLICADA en Mi Día** en producción. La condición de reapertura que dejé escrita se ha dado → el caso vuelve a estar abierto.
> - **Por qué la inercia era un error**: mi argumento era "materializeDay ignora `parent_task_id`". Cierto para el ANIDADO, pero **incompleto**: justo después de materializar, el `activeDayMap` **vuelca ENCIMA todas las filas persistidas** — [App.tsx:164](src/App.tsx:164) `Object.values(tasks).forEach(t => map[t.id] = t)` ("estado gana"). Así que **toda excepción persistida entra al mapa** (línea 170: `candidates`), reintroduciendo lo que materializeDay había reducido a una-por-día. (Vía secundaria: `reconstructHierarchy` empuja el id contaminado a `template.subtasks`, que materializeDay sí lee; pero el mapa dedup por id, así que la vía visible es el "estado gana".)
> - **Mecanismo del doble render** (a confirmar con datos): una excepción persistida llega a `candidates` y se pinta bajo su contenedor vía `getVisibleSubtasksForDay` **CASO 1** (por `templateId`, no por `parent_task_id`). Un doble VISIBLE requiere **≥2 filas no-borradas con el mismo `templateId` en el mismo día** (materializeDay elige una; el "estado gana" reintroduce la(s) otra(s)). Es decir: el problema real puede ser **filas duplicadas**, no el `parent_task_id` en sí.
> - **A COMPROBAR cuando se hagan los conteos** (dos preguntas abiertas de la usuaria):
>   1. ¿Las filas duplicadas de "Cierre Anual" están **entre esas 446** (mismo mecanismo = contaminación) o son un **conjunto distinto** (duplicados de excepción, otro bug)? Localizar su plantilla + sus filas:
>   ```sql
>   SELECT id, title, is_template, parent_task_id, template_id, instance_date, due_date, is_exception, is_deleted
>   FROM tasks WHERE title ILIKE '%Cierre Anual%' ORDER BY is_template DESC, due_date;
>   ```
>   2. Fuente directa del doble = `templateId`+día con **>1 excepción viva**:
>   ```sql
>   SELECT template_id, coalesce(instance_date, due_date) AS dia, count(*) AS n, array_agg(id) AS ids
>   FROM tasks WHERE is_exception = true AND is_deleted = false
>   GROUP BY template_id, coalesce(instance_date, due_date) HAVING count(*) > 1 ORDER BY n DESC;
>   ```
> - **Según el resultado, la limpieza NO es necesariamente `parent_task_id=NULL`**: si el doble viene de filas duplicadas, la limpieza es **deduplicar** (quedarse con una por `templateId`+día), no anular padres. Decidir el tratamiento DESPUÉS del diagnóstico, no antes.

### 13.22 ✅ REFACTOR DE DATOS — COMPLETO Y CERRADO (sesión 13)
- **Fusionado a master** (`dd180a2`, merge `--no-ff` de 69 commits, sin conflictos), **en producción** (Vercel, push a `origin/master`),
  **verificado por la usuaria** (Mi Día carga, contador **20** coincide, recurrentes salen, completar + recarga persiste), **SIN REGRESIONES**
  (los 3 fallos hallados al desarrollar eran pre-existentes).
- **Resultado**: reading 100% por `materializeDay` (puro, síncrono); `useGeneration`/`generation.worker` **BORRADOS**. Se acabó "abrir la
  app y faltan las recurrentes". **Perf: de ~63 ms a ~43 ms** materializando un mes (y con más tareas). `git tag v20-pre-flip` en `5a8b3a9`
  (último estado con motor viejo). Rollback de producción en §13.20.

#### ⏭️ PUNTO DE RETOMA — FASE DE DISEÑO (backlog consolidado)
El refactor de datos está cerrado. Lo siguiente es la **fase de diseño/UI** (§7) + limpiar bugs de fondo. Backlog vivo:

- **§6 bugs conocidos (los que QUEDAN)** — resueltos: #1 (`83a7301`), #6 (anti-#6 + C2), #7 (deps `activeDate` en bulk); **#10 ya N/A**
  (`useGeneration` borrado). **Pendientes**: #2 (handleDeleteBlock no persiste), #3 (handleExpandAllInBlock muta estado), #4
  (handleToggleExpandTask `.eq(inst-)` → no persiste expand de virgen), #5 (reconstructInstanceHierarchy empareja mal si `dueDate≠instanceDate`),
  #8 (handleStartTimer TDZ), #9 (resolveId `pop()` 3× rompe con guiones), #11 (isTaskCompleted ignora `instanceDate`), #12 (getStatsForDay
  `registered` sin filtrar bloque), #13 (repairRecurringContainers escribe en cada carga), #14 (handleResetData trampa mortal bajo ⚙️),
  **#15 (reorder escribe `order` en la plantilla = Fase R, diferida)**, #16 (tiempos descuadran tras F5), #17 (adjuntos no persisten).
  Menor nuevo: `bulkDuplicateTasks` usa `activeDate` en su resolver pero no en deps (staleness teórica; el fallback casi nunca se alcanza).
- **§8 funcionalidades nuevas V20**: 8.1–8.9 🟢 hechas; **8.10** promover/degradar-**serie** de recurrentes (= B5b, con modal) 🔵; y la
  variante **per-día** de promover (feature de motor: desanclaje por-día en `materializeDay`/`filters`) aún más adelante.
- **§11.1 backlog UX/diseño**: (a) Dashboard no muestra el mes al hacer scroll; (b) navegación de fechas del Calendario (salto directo a
  mes/año — sustituye al `__goToDate` dev, ya borrado); (d) `TaskModal` sin guard de título vacío; (e) desde **Semana** no se puede mover;
  (f) desde **Bloques** no se completan recurrentes; (g) **Calendario** sin icono de completar en el día.
- **Diferidos de estos días**: reorder-#15 (Fase R) · B5b/per-día (§8.10) · **contaminación/duplicados: REABIERTO** (§13.21 corrección — "Cierre Anual" duplicada; hipótesis de inercia caída por el "estado gana"; pendiente diagnóstico con conteos antes de decidir tratamiento).
- **Entorno**: los dev-hooks (`__tasks`/`__goToDate`/`__materializeDay`/spy) están **borrados** (D2) → validar trabajo futuro requiere
  reinstrumentar si hace falta. El **fixture** "Test Recurrent B1" (`t-1785089440019` + 3 hijas, `startDate 2028-01-01`) sigue en la DB con
  días 2028 consumidos (excepciones de validación); **borrarlo cuando ya no haga falta** (query en §13.15). No estorba (carga cero: fuera de vista).

---

## 14. Backlog de diseño — fase post-fila (sesión 14)

La fila V20 está **EN PRODUCCIÓN** (master `574149a`, Vercel Ready, verificado por hash de bundle).
A partir de aquí la fase de diseño se ataca **por TANDAS**, en este orden acordado con la usuaria:

1. **Cosas rotas** (rápido — no funcionan).
2. **Retoques de la fila** — todo lo que salió probando la fila.
3. **Paneles flotantes** — registrar tiempo, tiempo estimado y los demás (comparten componente).
4. **Barrido de visibilidad** — el mes que no se ve (§11.1a), el título de Bloques, las islas oscuras (§7.11.3 / §11.1).
5. **Vistas**: Delegadas → Bloques → Carga.

> **Estado sesión 14 (cierre):** Tandas **1 y 2 HECHAS y EN PRODUCCIÓN** (master `e7e3bc6`).
> La estructura definitiva de la fila, el raíl editable, los colores finales, el filtro de Bloques y
> el fix de la fuga de ids están documentados en **§15**. Pendientes: Tandas 3/4/5 + limpieza de datos
> legados + dos decisiones abiertas (ver **§15.7**).

### 14.1 Tanda 1 — cosas rotas (✅ HECHA)

1. **Paneles flotantes heredan la transparencia de la fila.** Al abrir un panel (p. ej. registrar tiempo)
   sobre una tarea EN SUSPENSO, el panel sale **translúcido** (se ve la lista detrás → ilegible) porque el
   `opacity-60` de la fila cascadea a los popups (son descendientes DOM, aunque sean `fixed`). Regla: el
   atenuado de la fila **NO** debe heredarlo nada que se abra encima; los paneles flotantes llevan **fondo
   sólido SIEMPRE**. Fix: dejar de atenuar con la propiedad `opacity` en un ancestro de los popups.
2. **Devolver "ir al bloque" (↗) a la fila.** Se retiró (commit `379d074`) dando por hecho que el chip de
   bloque navegaba al bloque; NO: el chip abre el selector para **cambiar** de bloque, no lleva a él. El ↗
   (`onGoToTemplate`) es el que navega. Restaurar en la batería de hover.
3. **El chip de bloque se repite en las hijas RECURRENTES.** En hijas normales la regla funciona; en una
   instancia recurrente el padre NO está en `tasks` (mapa crudo) → `allTasksMap[parentTaskId]?.blockId` =
   undefined → "distinto" → pinta el chip. Ej. real: "Previsional" → "Previsional 1Q" (recurrente) repite
   "Contabilidad central"; en "JD Tancament + IS" (no recurrentes) va bien. Fix: comparar contra el objeto
   **RENDERIZADO** (bloque del padre pasado como prop), no contra `tasks`.

**Confirmado que YA funcionan** (NO son bugs, descartados): añadir subtarea desde la fila (`+`), crear tarea
desde el modal, y registrar tiempo en una tarea en suspenso. El único problema del suspenso es el translúcido (1).

### 14.2 Tanda 2 — retoques de la fila (✅ HECHA)
Todo lo que salió probando la fila → cristalizó en la **estructura definitiva de §15**.

### 14.3 Tanda 3 — paneles flotantes (comparten componente)
Registrar tiempo, tiempo estimado y demás popups → rediseño unificado. (El translúcido se resuelve ya en §14.1.1.)

### 14.4 Tanda 4 — barrido de visibilidad
- Mes que no se ve al hacer scroll en Mi Día (§11.1a).
- Título de Bloques.
- Islas oscuras restantes en modo claro (§7.11.3 / §11.1): overlays clavados a oscuro.

### 14.5 Tanda 5 — vistas
Delegadas (cositas menores ya vistas en localhost, nada que impidiera subir) → Bloques → Carga.

---

## 15. Fila V20 — estructura DEFINITIVA (sesión 14, EN PRODUCCIÓN, master `e7e3bc6`)

Estado como quedó tras Tandas 1 y 2. **Prevalece sobre §7.2/§7.3/§7.4** en todo lo relativo a colocación
de elementos de la fila. Trabajo en modo CLARO. Archivos: [TaskCard.tsx](TaskCard.tsx) (la fila),
[Chips.tsx](Chips.tsx) (chips/selectores compartidos).

### 15.1 Estructura — bloque izquierdo + raíl

**Bloque IZQUIERDO** (mide su contenido, el título se estira hasta el raíl y trunca con tooltip):
`barra color bloque` · `checkbox` · `icono de tipo` · `hora` (columna propia, 40px, ANTES del título) ·
`título` (span→input al click) · `contador de hijas` (rosa) **o** hora (mutuamente excluyentes: contenedores
llevan contador, tareas-hoja llevan hora) · spacer `flex-1`.

**RAÍL** (columnas de ancho fijo → misma posición horizontal en todas las filas). Anchos (px):

| suspenso | estimado | registrado | play | info | — hueco — | fecha | recurrencia | delegación | etiqueta | bloque | `+` | `···` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 24 | 42 | 42 | 26 | 24 | 20 | 36 | 48 | 60 | 28 | 80 | 26 | 26 |

Grupos: **tiempos** = suspenso·estimado·registrado·play·info · (hueco 20) · **contexto** = fecha·recurrencia·delegación·etiqueta·bloque · `+` · `···`. Columna de hora izquierda = 40px.

### 15.2 Raíl EDITABLE + regla "visible mientras su desplegable esté abierto"

- Todo el contexto (fecha·recurrencia·delegación·etiqueta·bloque) y los tiempos (estimado, hora) se **editan
  inline** desde la propia fila; cada chip abre su selector. Recurrencia editable **siempre**, incl. instancias
  (guarda excepción del día, no propaga a la serie).
- **Columnas vacías:** en blanco; **punteado al hacer hover de la fila**; clic para rellenar. Contenedor:
  `hidden group-hover/row:flex has-[[data-open=true]]:flex`.
- **Regla `:has([data-open=true])`:** cada picker pone `data-open="true"` en su raíz cuando su popup está
  abierto → el chip vacío **sigue visible mientras el desplegable esté abierto** (no desaparece al salir el
  ratón de la fila). Implementado en [Chips.tsx](Chips.tsx) para los 7 selectores.
- **Contexto en gris** `#64748B` (`text-secondary`/`-light`), editable; la **etiqueta emoji queda a COLOR
  PLENO** (el gris solo la vacía). Los tiempos conservan color (estimado `#2563EB`, registrado `#9333EA`).
- **Sin `overflow-hidden` en fila/tarjeta:** los popups son `fixed z-[220]` y, bajo un ancestro transformado
  (Reorder de framer), un `overflow-hidden` los recortaría. Las columnas de contexto sí usan `overflow-hidden`
  para truncar (seguro: sus popups escapan). Para que la **barra de color** no asome por las esquinas
  `rounded-2xl` de la tarjeta se usa **inset vertical `my-1`**, no recorte.

### 15.3 Colocación de suspenso, hora, play e información

- **Suspenso = la marca ES el botón** (un solo objeto). **Primera columna del raíl** (antes del estimado).
  Suspendido → reloj de arena gris; no suspendido → en blanco, reloj tenue al hover, clic alterna. Contenedor:
  `onHold` **DERIVADO por grupo** (`rowOnHold` = todas las hijas activas del grupo en suspenso); solo las
  **hijas** persisten `on_hold`, el padre no. NO va en la tira `···`.
- **Hora:** columna propia (40px) **antes del título**; azul claro `#60A5FA` (más claro que el estimado para no
  competir). Variante `light` de `TimePickerChip`.
- **Play:** su columna (26px) en el grupo de tiempos; rosa cuadrado + anillo + `animate-pulse` corriendo /
  turquesa redondo parado.
- **Información ("i"):** **última columna del grupo de tiempos** (tras el play), solo en recurrentes; clic abre
  el histórico de la serie (`onViewInstances`).
- **`+` añadir subtarea:** columna fija (26px), solo contenedores/sueltas, nunca hijas-hoja.
- **Tira `···`:** apertura por hover (150ms abre / 250ms cierra), **absolute descendiente del botón** de puntos
  (así `onMouseLeave` no salta al pasar a la tira), se despliega a la IZQUIERDA. **Fondo SÓLIDO** bajo los
  iconos (color de la fila) + **degradado de 20px solo como remate** a la izquierda del primer icono; `z-[10]`
  (por encima del `+` en `z-[7]` y de los chips del raíl). Acciones: ir al bloque · editar · borrar · subir
  nivel · bajar nivel.

### 15.4 Colores finales

| Elemento | Valor |
|---|---|
| Contexto (fecha/recurrencia/delegación/bloque) | gris `#64748B` |
| Etiqueta (emoji) | color pleno |
| Hora | `#60A5FA` (azul claro) |
| Estimado | `#2563EB` (claro) / `#3B82F6` (oscuro) |
| Registrado | `#9333EA` (claro) / `#A855F7` (oscuro) |
| Icono de tipo — core | `#22C68D` (solo el icono; título en negro) |
| Icono de tipo — ad-hoc | `#F8AE17` (solo el icono) |
| `+` (añadir subtarea) | reposo `#2DD4BF` → hover de FILA `#14B8A6` |
| Marca suspenso | gris `#64748B` |

### 15.5 Filtro de Bloques

[BlocksView.tsx](BlocksView.tsx): **ocultar completadas por DEFECTO** (`hideCompleted` init `true`) y el
interruptor se **persiste** en `localStorage` (`wm-blocks-hide-completed`). Razón: Bloques es vista de
**planificación**, no registro histórico; así no arrastra el histórico legado de completadas. El ojo
(Eye/EyeOff) las reabre.

### 15.6 Fix de la fuga de ids `inst-inst-`

[useTaskCRUD.ts](useTaskCRUD.ts) · `handleUpdateTask`. Al mover/reprogramar una recurrente **con hijas** se
construían ids de instancia **concatenando en crudo** (`inst-${oldParent.id}` / `${oldParent.templateId}` /
`${updatedTask.templateId}`). Si la base ya era una instancia (o su `template_id` apuntaba a otra instancia),
salía `inst-inst-…` y `template_id → instancia`, y era **autoalimentado**. **Fix:** todas las bases pasan por
`templateIdFromInstanceId(...)` (de [instanceEngine.ts](instanceEngine.ts)) antes de concatenar — **5 bases**
(bloque síncrono de estado + bloque **async que persiste a Supabase**, este último el que grababa la basura en
la BD) + 1 defensiva (convertir-manual→plantilla). **No queda ninguna concatenación de id en crudo** en el
archivo. Tapa solo la generación NUEVA; la limpieza de lo legado queda pendiente (§15.7).

### 15.7 Pendiente para la próxima sesión

1. **Limpieza de datos legados de Bloques** (con backup). Diagnóstico de la sesión 14: lo que inundaba Bloques
   son **tareas normales completadas hace meses, sin `template_id` ni `is_exception`** (ocurrencias anteriores
   al motor de recurrentes; el filtro no puede excluirlas porque nada las marca, y ya se ocultan por defecto con
   §15.5). Además hay filas corruptas: una con `template_id` apuntando a otra instancia e id `inst-inst-`, y una
   instancia sin `parent_task_id`. **Lanzar los 4 conteos SQL** y, según salgan, limpiar:
   ```sql
   select count(*) from tasks where id like 'inst-inst-%';            -- a) doble prefijo
   select count(*) from tasks where template_id like 'inst-%';        -- b) template_id -> instancia
   select count(*) from tasks where id like 'inst-%' and parent_task_id is null;  -- c) (ojo: B4 deja null legítimos)
   select count(*) from tasks t                                       -- d) sin template_id con titulo = plantilla
     where t.template_id is null and coalesce(t.is_template,false)=false and t.id not like 'inst-%'
       and exists (select 1 from tasks p where coalesce(p.is_template,false)=true and lower(p.title)=lower(t.title));
   ```
2. **Tanda 3 — rediseño de los paneles flotantes** (registrar/estimar tiempo y demás; comparten componente).
3. **Tanda 4 — barrido de visibilidad en las siete vistas** (mes que no se ve §11.1a, título de Bloques, islas
   oscuras en claro).
4. **Tanda 5 — Delegadas → Bloques → Carga.**
5. **Dos decisiones abiertas:**
   - **Qué cuenta el contador de tareas** (contador rosa de hijas): definir exactamente qué incluye.
   - **El hueco delante del título en Mi Día:** decidir si compensa para la alineación de la hora, o se quita.

---

## 16. Estado real y backlog (sesión 15)

El documento iba por detrás (al día hasta la sesión 14). Esta sección recoge el estado real y el backlog
ordenado por fases. **Todo lo de la sesión 15 está EN PRODUCCIÓN** (master, Vercel auto-deploy).

### 16.1 Qué se cerró en la sesión 15 (en producción)

- **Fila del título — borrador local** (`b667a85`+`2322dc4`): `TitleField` con borrador local; guardar solo en
  Enter/blur; escribir ya no expulsa del campo. Con test de regresión.
- **Fuga `inst-inst-`** (`3047e64`): normalización con `templateIdFromInstanceId` en las 5 bases de
  `handleUpdateTask` (síncrono + async/DB). Tapa la generación de basura nueva.
- **Suspenso = flag puro** (`bc9f20d`): `handleUpdateTask({onHoldOnly})` escribe solo `on_hold` conservando
  id/fecha; suspender ya no re-fecha ni descoloca al contenedor.
- **Bloque A — rescate centralizado** (`fdd774e`): `resolveActionTarget(id, tasks)` en `instanceEngine` (fila real
  → excepción persistida bajo otro id, **nunca la plantilla** → instancia virgen materializada). Aplicado a
  `handleManualTimeEntry`/`handleTimerStopConfirm`/`handleStartTimer`/adjuntos, y centralizados Edit/Delete. **Arregla
  el completado desde el panel de tiempo** (era no-op sobre instancias virtuales). +7 tests.
- **Filtro de Bloques** (`2dd03d8`): ocultar completadas por defecto + persistir el toggle.
- **Guard anti-doble-envío** (`f1ab001`): registrar tiempo y parar cronómetro no crean dos entradas.
- **Completadas** (`3fff45f`+`aaade80`+`6de87b6`+`5a2495f`+`2fe0135`): usan el raíl §15 (tachadas/atenuadas);
  regla "no editable" en fila **y modal** → ver **§16.2**.
- **Bloques — añadir al bloque abierto** (`d8b192e`): botón propio en BlocksView con `selectedBlock.id`.
- **Instrumentación DIAG-TEMP** (`e173067`+`4225207`+`30edc67`): traza de completar y de cronómetro, panel flotante
  copiable. **TEMPORAL — quitar con `git revert` cuando la usuaria lo diga; NO quitar todavía.**

### 16.2 Regla de las tareas COMPLETADAS (fila + modal)

**Principio: se bloquea ESCRIBIR VALORES, no interactuar.** Una tarea cerrada es precisamente la que se abre para
mirar cosas. Vale IGUAL en la fila y en el modal — **el modal obedece la misma regla que la fila** (antes era la
puerta de atrás; que no vuelva a serlo).

**Vivos en una completada:** abrir/descargar adjuntos · entrar en subtareas · desplegar la recurrencia (consultar
cuándo se repite, sin editar la regla) · **tiempo registrado** (editable) · casilla (reabrir) · editar/borrar del `···`.
**NOTAS = excepción explícita:** editables aunque la tarea esté completada — son un **cuaderno**, no un valor de la
tarea. (Dejado escrito en el código para que no se re-bloquee.)

**Bloqueado:** tipo · bloque · estimado · hora · fecha · etiquetas · delegación · recurrencia (la regla) · añadir/quitar
subtareas y adjuntos · editar subtareas · suspenso · play · `+` · subir/bajar nivel.

**Técnica (importante):** NO bloquear el contenedor entero (mata la consulta). Se bloquea **por elemento**. En la fila,
helper `railCol(filled)` (lleno → `pointer-events-none`; vacío → en blanco). El atenuado va por **scrim `::after`** en
la fila, NO por `opacity` en un ancestro (el opacity cascadea a los popups fixed y los deja translúcidos — mismo caso
§14.1.1). En el modal, `disabled`/`readOnly`/`pointer-events-none` por elemento; los de consulta (abrir/entrar) se hacen
**siempre visibles** en completadas (no ocultos en hover). El botón del visto **no cierra**: cambia el estado en el sitio
(reabrir → desbloquea; completar → bloquea) y su tooltip dice qué hará. Ficheros: `TaskCard.tsx`, `TaskModal.tsx`.

### 16.3 FASE 2 — enumeración con causas (lo que bloquea a diario)

Cada punto: causa localizada, si es no-op silencioso o error tragado, y ficheros. **✅ FASE 2 CERRADA (sesión 16).**
Lo que quedaba se resolvió casi todo **decidiendo, no programando**: dos puntos se movieron a diseño / al trabajo del
arrastre, uno se descartó (no debía existir) y solo quedó un borrado pequeño. Estado por punto abajo.

1. **Poner recurrencia desde la fila.** ✅ **HECHO** (`c0bb09d`, sesión 16). El `onChange` de la fila pre-ponía
   `isTemplate:true`, que **saltaba el bloque de conversión** manual→plantilla de `handleUpdateTask` (exige
   `!isTemplate` y crea la 1ª instancia) → la tarea se volvía plantilla sin instancia del día y **desaparecía**. Fix:
   el `onChange` ahora solo fija `recurrence`; `handleUpdateTask` hace la conversión completa y crea la instancia del
   día. Igual que ponerla desde el modal. Fichero: `TaskCard.tsx`.
2. **B1 — que nada falle en silencio.** No es un bug con causa única; es el trabajo del toast. Contexto: todas las
   escrituras son fire-and-forget con `.then(({error})=>console.error)` (tragado); los no-op (`resolveActionTarget`
   null) son mudos. Ficheros: componente/hook de toast + los puntos de escritura.
3. **Semana — mover/promover/degradar.** **DECIDIDO (sesión 16), NO se programa ahora:** *mover* tareas de un día a
   otro **espera al arrastre en profundidad** (después de FASE 3), no un botón aparte. *Promover/degradar en Semana* se
   **DESCARTA**: la jerarquía se cambia en Mi Día, no hace falta duplicarla en Semana. (Queda vivo el hallazgo de
   estructura §16.6: Semana usa un `WeekTaskCard` propio.)
4. **Calendario — icono de completar.** **MOVIDO a la FASE DE DISEÑO (sesión 16):** va con el **rediseño del
   Calendario**. No se le pega un botón de completar a la variante `COMPACT` ([CalendarView.tsx](CalendarView.tsx)) ahora,
   porque esa vista se va a rehacer (y COMPACT la comparten otras vistas). Motivo: no invertir en algo que se sustituye.
5. **Bloques — completar recurrentes.** ✅ **HECHO (`a8dde11`, sesión 16), por eliminación:** una plantilla es una
   **definición** — no se completa, y con la recurrencia teniendo fecha de fin tampoco hay que pausar/activar la regla.
   La casilla **sobraba** (iba a `onToggleRule`, que no hacía nada). Se **quitó la casilla de completar de las plantillas**
   en modo normal (en selección se mantiene, la selección múltiple sigue intacta) y se **borró `onToggleRule`** (variable
   muerta, resuelve §16.6). Ficheros: `TaskCard.tsx`, `BlocksView.tsx`, `App.tsx`.
6. **Bloques — añadir tarea.** ✅ HECHO (`d8b192e`, §16.1).
7. **Regresión visual — completadas sin raíl.** ✅ HECHO (`3fff45f`, §16.2).
8. **Delegadas — añadir tarea.** ✅ **HECHO** (`3889c28`, sesión 16). El "+" **por persona** ya pasaba `person.id`
   ([DelegadasView.tsx:530](DelegadasView.tsx)) → funcionaba. El roto era el "+" **GLOBAL** de la `StickyActionBar`, que
   en Delegadas llamaba a `handleAddTask()` sin persona → tarea sin delegación → invisible. Decisión de la usuaria
   (misma que en Bloques): **quitar el global, dejar el contextual**. Fix: `onAddTask` pasa a `undefined` en `delegadas`
   ([App.tsx:442](App.tsx)) → la barra no pinta el botón ([StickyActionBar.tsx:213](StickyActionBar.tsx)).

### 16.4 FAMILIA de bugs: "crear en una vista con filtro propio que no recibe su contexto"

**Delegadas y Bloques son el MISMO fallo, no dos sueltos.** En ambos: la tarea se crea, se persiste, y **no aparece**
porque la vista filtra por un dato que la tarea nueva no tiene — el **bloque** en Bloques, la **persona** en Delegadas.
**Regla general:** *cualquier vista futura con filtro propio tendrá el mismo problema si su botón de crear no le pasa su
contexto.* Al añadir una vista con filtro, el `onAddTask` debe inyectar ese contexto (bloque, persona, etiqueta…) en la
tarea nueva, o la creación será un no-op invisible.

### 16.5 `selectedBlockId` — código muerto + PREGUNTA ABIERTA (FASE 5)

**Hallazgo:** `selectedBlockId` ([App.tsx:50](App.tsx)) **nunca se setea** (`setSelectedBlockId` solo en la declaración)
→ siempre `null`. **Lo lee solo** `doAddTask` ([useTaskCRUD.ts:278](useTaskCRUD.ts)): `finalBlockId = selectedBlockId ||
blocks[0]`. Como es siempre null, **toda tarea de nivel-1 sin bloque explícito cae en `blocks[0]` (el primer bloque)**.

- **✅ HECHO (sesión 16, `6dce9a0`):** variable **borrada** de `App.tsx` y `useTaskCRUD` (interfaz, destructuring, deps).
  Comportamiento idéntico (ya era siempre `blocks[0]`). En `useTaskCRUD.ts:278` queda un comentario marcando el fallback
  a `blocks[0]` como **PROVISIONAL** — el borrado NO congela la decisión de FASE 5 (abajo), que sigue abierta.
- **⚠️ PREGUNTA ABIERTA (FASE 5), la decide la usuaria (SIGUE ABIERTA tras el borrado):** como esa variable siempre era nula, **toda
  tarea creada sin bloque explícito, Mi Día incluido, acaba en el primer bloque de la lista.** Eso **nadie lo ha
  decidido nunca**. Borrar la variable NO debe congelar ese comportamiento como "así es la app". Decisión pendiente:
  **una tarea creada en Mi Día, ¿debe caer en el primer bloque o quedarse sin bloque?**

### 16.6 Hallazgos separados (documentados como bug/decisión propia)

- **`onToggleRule` — ✅ RESUELTO (`a8dde11`, sesión 16): borrado.** Era un no-op (`isActive: prev[id].isActive !== false`
  devolvía el mismo valor). Al quitar la casilla de completar de las plantillas (punto 5) quedó sin usar y se eliminó.
- **Semana usa un `WeekTaskCard` propio** en vez del `TaskCard` normal ([WeekView.tsx:566](WeekView.tsx)): el rediseño de
  fila de §15 **nunca ha llegado a Semana**, y cualquier cambio futuro de fila hay que hacerlo **dos veces**. No es un
  bug: es una **decisión de estructura pendiente** (unificar Semana con el TaskCard normal, o asumir el doble mantenimiento).

### 16.7 Evidencia para FASE 3 — totales del contenedor (bug de reconciliación)

En Mi Día, el contenedor **"Rutinas Mañana"** muestra **0m de estimado y 40m de registrado**, mientras su hija
**"Ingresos Tiendas"** tiene **15m estimados y 5m registrados**. Un contenedor no puede sumar 0m de estimado con una
hija de 15m, y el registrado (40m) apunta a que **está sumando hijas de otros días**. Evidencia del **bug de totales del
contenedor** de FASE 3 (la reconciliación mal hecha entre el mapa materializado y `tasks` crudo — el "estado gana" leaky
de `activeDayMap`, [App.tsx:160-165](App.tsx)). **FASE 3 = tests primero** (el "estado gana" legítimo: una excepción
completada/movida/borrada de hoy debe ganar sobre la instancia regenerada).

**Misma familia "HOY real vs DÍA QUE MIRO" (sesión 16):** al poner una recurrencia desde la fila, el `startDate` de la
regla sale de `new Date()` (hoy real) en `RecurrencePickerChip` ([Chips.tsx:422-423,575](Chips.tsx)) → la serie arranca
hoy aunque estés mirando otro día. La tarea nueva SÍ nace con `dueDate = activeDate` ([useTaskCRUD.ts:285](useTaskCRUD.ts)),
pero el `startDate` de la recurrencia no. **Debería ser el día del dashboard que se está mirando** (cuando miras hoy,
coinciden, así que la regla cubre ambos casos). **No es one-liner:** `TaskCard` no recibe `activeDate` → hay que
enhebrarlo App→cada vista→TaskCard→chip, y cambiar SOLO los `new Date()` de defaults de recurrencia (no los botones
"hoy/mañana" del DatePicker). Por eso va a FASE 3 con el resto de la familia, no a un cierre rápido de FASE 2.

### 16.8 Especificación: ZONA DE DIAGNÓSTICO — cabecera de Mi Día (para FASE 6)

Sustituye por completo a las tres tarjetas actuales (Pendientes / Pendiente / Registrado): **desaparecen**. NO
implementar ahora, y **no antes de que la FASE 3 esté cerrada** (si el conjunto del día sigue contaminado, esta cabecera
mostraría los mismos números incorrectos con mejor tipografía). Sustituye a §7.4.

- **Sin caja.** No es una tarjeta, es el principio de la página: contenido directo sobre el fondo, al mismo margen que
  las filas de tarea. Sin borde, sin sombra, sin fondo blanco.
- **Fila principal (izq→der):** etiqueta pequeña **"FALTAN"** y debajo, en grande y negrita fuerte, el **nº de tareas
  pendientes** · a su lado **"19 hechas de 70"** en texto pequeño y, debajo, el **pendiente en horas** en azul · empujado
  a la derecha, **"Registrado hoy"** (todo el tiempo registrado del día, esté la tarea completada o no) y **"Completado"**
  (estimado solo de las tareas cerradas), con etiquetas que dejen claro que son **dos medidas distintas, no una
  comparación** · al final, enlace **"Desglose"** con su flecha.
- **Barra de progreso** a todo el ancho justo debajo, con el % del día completado en **turquesa**. Hace de separador con
  la lista (sin línea divisoria adicional).
- **Desglose plegable**, cerrado por defecto, que **recuerda entre recargas** si se dejó abierto (en `localStorage`, es
  preferencia de UI, no un campo nuevo): por **tipo** (core/ad-hoc, en tiempo, cada uno con su punto de color) y por
  **bloque** (en tiempo, de más a menos, cada uno con su barrita). Todo en una o dos líneas compactas, no en tarjetas.
- **Reglas de cálculo:**
  - El nº de **pendientes** cuenta **hojas** (sueltas + hijas). **Los contenedores NO cuentan** (son carpetas, no trabajo).
  - Las **horas pendientes** suman exactamente ese mismo conjunto de hojas.
  - **hechas, faltan, total** se calculan sobre ese mismo conjunto → **hechas + faltan = total, siempre**.
  - El pendiente **NO** descuenta el tiempo ya registrado en tareas abiertas.
  - **"Registrado hoy"** cuenta todo el tiempo registrado en el día **con independencia del estado** de la tarea, y es el
    **único** contador que se calcula **por fecha de registro**; todo lo demás se calcula sobre **las filas del día**.
- **Requisito de espacio:** debe ocupar **bastante menos alto** que las tres tarjetas actuales (~180px). Medio motivo del
  cambio es recuperar espacio vertical para ver más tareas.

### 16.9 Hueco en la cabecera del bloque (Bloques) → FASE 6

El espacio vacío en la cabecera del bloque **no** viene del botón global retirado (ese vivía en `StickyActionBar`, la
barra inferior, no en la cabecera). Es el **layout de la cabecera**: el div del nombre lleva `flex-1`
([BlocksView.tsx:243](BlocksView.tsx)) y se estira. Va con el **rediseño de Bloques de FASE 6**; no se toca ahora.

### 16.10 Orden de trabajo por fases

- **FASE 2 — ✅ CERRADA (sesión 16):** §16.3 (todos los puntos hechos/movidos/descartados) + B1 (avisos, §16.11).
  Siguiente fase activa = **FASE 3**.
- **FASE 3 — modelo de datos, TESTS PRIMERO:** la reconciliación en cuarentena (hijas de otros días, subtareas duplicadas
  con el tipo cambiado, totales que no cuadran entre vistas — §16.7); el contenedor que se marca completo mirando
  subtareas de otros días; el total registrado que no filtra por bloque activo; diagnóstico de los contadores de
  cabecera. Dos principios: (a) el tiempo nunca se registra sobre un contenedor (su tiempo = suma de hijas); (b) un
  contenedor no tiene estado de completado propio, está completo por derivación cuando sus hijas **del día** lo están, y
  clicar su casilla completa esas hijas — **solo las del día** (con el bug de otros días vivo, cerraría cosas de meses
  atrás). Tests del "estado gana" verdes antes de tocar.
- **FASE 4 — persistencia:** borrar bloque no persiste · adjuntos no persisten · tiempos descuadran al recargar ·
  reordenar recurrente cambia todos los días · escritura innecesaria en cada carga (§16.1 de la sesión 14 / repairs) ·
  desplegar todo no refresca · conteos SQL + limpieza legada (§15.7) · borrar la columna de prioridad.
- **FASE 5 — creación:** tarea vacía que se persiste + guard de título vacío · encadenado con Enter · ruido en consola al
  arrancar Mi Día · ~~borrar `selectedBlockId`~~ ✅ HECHO (`6dce9a0`, §16.5) + **pregunta abierta** Mi Día→primer bloque (§16.5, SIGUE ABIERTA).
- **FASE 6 — diseño:** zona de diagnóstico (§16.8, sustituye §7.4) · Tanda 3 paneles flotantes · Tanda 4 barrido de
  visibilidad · Tanda 5 Delegadas/Bloques/Carga · icono de calendario en la fila · avisos propios en vez de los del
  navegador · hueco cabecera Bloques (§16.9) · unificar Semana con el TaskCard normal (§16.6).
- **FASE 7 — mejoras:** calibración estimado/real · arrastrar lo no completado al día siguiente · deshacer · dependencias
  · búsqueda con filtros · seguimiento en Delegadas · gráfico elegido/impuesto · reflexión mensual · promover serie ·
  atajos · sincronización con cola.

### 16.11 Sesión 16 — B1 (avisos) cerrado · jerarquía a 2 niveles · arrastre lateral APARCADO

- **B1 "que nada falle en silencio" — CERRADO (FASE 2 punto 2).** Bus de avisos `toast.ts` (a nivel de módulo, como
  `diag`; **agrupación por `key`**: N fallos de un lote = 1 aviso con contador; error pegajoso, warn/no-op
  auto-desvanece) + `ToastContainer.tsx` (esquina inferior derecha, no pisa el raíl) + `persist.ts`
  (`persist(query, ctx)` / `reportPersistError(ctx)`: log + toast). Cableados TODOS los dominios de escritura:
  tareas (`a8e6c7e`), bloques (`719a04d`), lote (`b900e8d`), orden (`df84bfc`), personas/reuniones (`cae00c0`), y el
  **no-op mudo** (`fc9614d`: completar/borrar/play/marcar-completada-al-registrar/adjuntos/promover-degradar-sin-destino
  ahora avisan; guardas legítimas quedan mudas — auditoría en el mensaje del commit). Infra en `0f25cfe`, botones de
  prueba en DiagPanel `8e5385a` (DIAG-TEMP).
  - **⚠️ Mensaje PROVISIONAL:** "se ve pero puede no haberse guardado" — lo **reescribe el B2 de FASE 3** al revertir
    el estado local cuando la escritura falla.
  - **Cabos sueltos de B1 (en el mensaje de `fc9614d`):** (1) `DashboardView.tsx:427` persiste el `order` del
    reordenado sin pasar por `persist()` — migrar. (2) **Acciones SIN escritura a BD** (tercer agujero, NO arregladas):
    borrar bloque (`useBlockHandlers.ts:103`, ya FASE 4) · desplegar/plegar TODO un bloque
    (`useTaskOrdering` handleExpandAllInBlock) · añadir persona desde Delegadas (`DelegadasView` handleAddPerson: solo
    estado local). (3) Muda a propósito: escritura al array `subtasks` (bug #18, columna inexistente).
- **Jerarquía LIMITADA A 2 NIVELES** (`0c6baf6`, producción). Verificado en datos reales: 2001 activas → **505 nivel 1,
  1496 nivel 2, 0 en nivel 3**. El modelo es contenedor+hijas; el nivel 3 solo complicaba totales/completado por
  derivación de FASE 3. Tope: "+" solo en nivel 1; degradar solo una tarea de nivel-1 **sin hijas**. Guía de sangría
  subida a 60/50% + sangría uniforme (`6f7b42b`, producción).
- **Arrastre lateral para cambiar de nivel — APARCADO hasta después de FASE 3 (con plan ya escrito).** Idea: sustituir
  Framer `Reorder axis=y` por arrastre 2D propio solo en Mi Día; gesto binario (2 niveles); umbral ~40px y
  `|dx|>|dy|·1.2`; placeholder que resalta el futuro padre; persistir `parent_task_id` + `order`; flechas se quedan de
  red. **POR QUÉ SE APARCA:** el propio plan exige (a) **materializar las instancias vírgenes antes de escribir** el
  `parent_task_id` y (b) **renumerar el `order` entre grupos** — y **las dos cosas son justo lo que FASE 3 va a poner
  en orden** (reconciliación del día, "estado gana", totales). Hacerlo antes sería construir encima de lo torcido. Se
  retoma con el plan tal cual **cuando FASE 3 esté cerrada**.
- **FASE 2 — ✅ CERRADA (sesión 16).** Cierres finales: **1** recurrencia desde la fila (`c0bb09d`) · **8** Delegadas,
  quitar "+" global (`3889c28`) · **5** Bloques, quitar casilla de plantillas + borrar `onToggleRule` (`a8dde11`).
  Movidos/descartados: **3** Semana (mover → arrastre post-FASE 3; promover/degradar → descartado, se hace en Mi Día) ·
  **4** Calendario icono completar → FASE DE DISEÑO (rediseño del Calendario). Detalle por punto en §16.3.
