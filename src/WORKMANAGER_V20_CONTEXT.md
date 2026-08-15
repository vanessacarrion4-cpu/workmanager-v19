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
- **Bugs nuevos detectados:** ~~**#18** columna `tasks.subtasks` inexistente~~ ✅ **RESUELTO (sesión 19, `1342f36`):**
  la escritura muerta de `useTaskOrdering` eliminada (la de `useBulkActions` ya en `be9eed1`). Impacto real que tuvo:
  ninguno (el orden persiste por `order`). Ver §16.18.
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

1. **Poner recurrencia desde la fila.** ⚠️ **MATIZADO (sesión 18): el chip NO se puede usar desde la fila en la práctica
   —ni en Bloques ni en Mi Día—; hay que abrir el MODAL** (aparcado en FASE 5, §16.17). El fix `c0bb09d` de abajo arregló
   el `onChange` (no pre-poner `isTemplate`), pero eso NO es lo mismo que poder ponerla desde la fila. Contradice el
   "verificado sesión 11" de §5 (línea ~714, "no existe"). Texto histórico del fix, ya matizado:
   ✅ **HECHO** (`c0bb09d`, sesión 16). El `onChange` de la fila pre-ponía
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

**✅ (a2) CABLEADO (sesión 16):** los totales del contenedor en Mi Día ya se calculan sobre el
DÍA que se mira (`dayForTotals=activeDate` → `TaskCard` → `containerEstimatedForDay`/`containerRegisteredForDay` y, en
grupos, `registeredFilterDate=activeDate`). `getVisibleSubtasksForDay` unificado con `belongsToDay` (una sola
definición de "pertenece al día"). **Ningún dato borrado** (684 entradas de tiempo intactas antes y después); solo
cambia la agregación. Impacto medido: contenedores manuales con hijas recurrentes dejan de inflar (ej. "Rutinas mañana"
sumaba ~75.600m = 51 días en la fila de un día → ahora el día).

**Coherencia entre vistas (a2), medida:** **Semana** ya está acotada al día — muestra estimado vía
`getTaskMins(task, dayMap)` con el mapa materializado por día ([WeekView.tsx:60-71](WeekView.tsx)) y **no** muestra
registrado → sin histórico, sin cambio necesario. **Calendario** — VERIFICADO en el render (sesión 16): el **contenedor NO se pinta como `TaskCard` con total**, es una
cabecera de texto con título + `(nº)` **sin minutos** ([CalendarView.tsx:414-420](CalendarView.tsx)); solo las HOJAS
son `TaskCard` COMPACT y muestran su propio estimado (correcto). Los contenedores sin hijas del día ni aparecen (filtro).
→ **NO hay total de contenedor mal sumado en Calendario; no requiere cambio** (mi recomendación previa de "una línea"
era errónea: sería un no-op). **Bloques** es vista de DEFINICIÓN (plantillas → registrado 0, estimado base): semántica
distinta a un día; que no coincida con Mi Día es esperado (definición vs día), no el bug del histórico. **Conclusión:
tras (a2), ninguna de las otras vistas muestra el histórico inflado; solo Mi Día lo tenía y ya está corregido.**

**🔴 CASO REAL 30-jul (evidencia de oro, va a (b)/(c) como TEST — sale de datos reales):** en "Pago nóminas" el 30-jul
hay **10 hijas-excepción, todas con `parent_task_id=NULL`** (8 completadas + 2 pendientes: "Pago NGD" y "Pago NGD
Botigues"), y **NO existe instancia del contenedor ese día** (el contenedor no tiene recurrencia propia). El filtro
rechaza mostrar como raíz cualquier instancia cuya plantilla tiene padre ([filters.ts:154-157](filters.ts)) → esas 2
pendientes **solo pueden salir anidadas** bajo el contenedor; como no hay contenedor sintetizado ese día, **desaparecen
de la lista aunque el contador (que cuenta hojas) diga "2 pendientes".** Gravedad: la app **esconde tareas pendientes**
(no un número raro, sino una tarea que no está). **DOS tests a fijar:** (1) un contenedor con ≥1 hija PENDIENTE del día
NO se considera completo; (2) "ocultar completadas" / la reconciliación **no** debe hacer desaparecer un contenedor con
hijas pendientes del día (reproducir la forma huérfana exacta). El (1) es (b); el (2) es (c).
**⚠️ EXPECTATIVA: el SÍNTOMA (tareas pendientes escondidas) NO se arregla en (b) — se arregla en (c).** La causa es
huérfanas-sin-contenedor (reconciliación), no completado mal derivado. El orden b→c se mantiene (c es el más
peligroso, entrar con todo verificado), pero ese síntoma sigue VIVO hasta el último paso. No darlo por resuelto antes.

**🧵 HILO DE DATOS (mover-y-reconciliar, NO tocar aún):** al **mover** una tarea, su fila-excepción queda con
`parent_task_id=NULL` (patrón B4-cambio-2) y al leer se **re-anida por la plantilla** (`getVisibleSubtasksForDay` CASO 1).
Eso es lo que dejó esas 10 hijas huérfanas del 30-jul. Frágil: si el contenedor no está materializado ese día, las
huérfanas no tienen dónde anidar. Es trabajo del bloque de **mover + reconciliar** (dentro de FASE 3 (c) / move).

**✅ (b1)+(b2 visual) HECHOS (sesión 16):** `isContainerCompleteOnDay`/`childrenToToggleOnDay` implementadas
(`08472fe`, +test forma real 30-jul); el **visual** del contenedor en Mi Día (visto/tachado/lock) ya se **deriva por
día** vía `rowCompleted` (`cd45ee7`), no del status guardado. Impacto medido: **~21 contenedores cambian de aspecto**
— 1 tachado→pendiente ("Poner fechas varias laboral", le queda 1 hija) y 20 pendiente→tachado (proyectos manuales ya
terminados). **⚠️ TOGGLE "completar-solo-el-día" NO incluido en (b):** para contenedores recurrentes exige materializar
las hijas-instancia del día → es territorio de **(c)**; se hace allí, no a medias en (b).

**🔴🔴 CONTRADICCIÓN VIVA (desde b2 hasta que se cierre (c)) — CERRAR EN (c) SÍ O SÍ:** el **visto** del contenedor
ya se calcula **por el día** (b2, `isContainerCompleteOnDay`), pero **clicarlo sigue cerrando las hijas de CUALQUIER
fecha** (`handleToggleStatus`/`toggleRecursive` sin tocar). O sea: **la pantalla y la acción dicen cosas distintas** —
el visto refleja el día, el clic actúa sobre todos los días (podría cerrar cosas de meses atrás). No es un riesgo
nuevo (el toggle ya era así), pero b2 lo hace evidente. (c) debe alinear la acción con el visto: **clic = completar/
reabrir SOLO las hijas del día** (`childrenToToggleOnDay` ya existe; falta materializar las hijas-instancia del día). **Hallazgo:** `isTaskCompleted`
([utils.ts:24-28](utils.ts)) YA deriva el completado del contenedor de sus hijas (todas, sin filtrar por día) → el
trabajo de (b3)/(c) sobre filtros/contadores es hacer esa derivación **por día**, no crearla.

**🩹 FIX b2 (sesión 16): el contenedor NUNCA lee su propio `status` guardado en el render.** Bug detectado por la
usuaria en **Bloques**: "Poner fechas varias laboral" salía tachado (status guardado) con una hija pendiente, porque
`dayForTotals` solo se pasaba en Mi Día → sin día caía en `task.status`. **Decisiones (fijadas):** (1) contenedor CON
día → `isContainerCompleteOnDay(día)`; (2) contenedor SIN día (Bloques y vistas que no son un día concreto) → deriva de
**TODAS** sus hijas (`isTaskCompleted`), nunca del status guardado; (3) hoja → su propio status. **Vacío-verdadero
cubierto:** `isContainerCompleteOnDay` devuelve `hasDayChild` → **false** si no hay hijas del día (+ tests: sin hijas
del día → false; sin subtareas → false). Único read del status de contenedor era `rowCompleted` (centralizado); el
scrim/atenuado ya iba por `locked=rowCompleted`, checkbox/título/raíl también. Semana usa `WeekTaskCard` (no TaskCard);
Calendario pinta los contenedores como cabecera sin visto → no afectados.

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
  atrás). Tests del "estado gana" verdes antes de tocar. **(a) y (b) son APLICACIONES del MODELO → §16.16.**
  - **DATOS DE MIGRACIÓN (sesión 16, decidido por la usuaria):**
    - **Tiempo registrado sobre contenedores: NO se borra.** Son **4 entradas · 116 min (1h 56m)**, de meses atrás
      (la mayor 90m en "Lluis Corbera Bankinter"). Es **trabajo real**: cuando el principio (a) entre, **dejarán de
      contar** en los totales pero **se quedan en la base**. Anotado para que nadie las dé por perdidas.
    - **92 "completados" guardados sobre contenedores (5 directos + 87 instancias): NO se limpian.** Borrar 92 filas no
      tiene vuelta atrás y no hace falta si el código deja de leer ese campo. **En su lugar: TEST que garantice que el
      completado del contenedor se DERIVA de las hijas del día y que el `status` guardado del contenedor NO se lee** — si
      alguien vuelve a leerlo, el test se pone rojo. (Misma trampa que la variable muerta, resuelta sin tocar datos.)
- **FASE 4 — persistencia:** borrar bloque no persiste · adjuntos no persisten · tiempos descuadran al recargar ·
  reordenar recurrente cambia todos los días · escritura innecesaria en cada carga (§16.1 de la sesión 14 / repairs) ·
  desplegar todo no refresca · conteos SQL + limpieza legada (§15.7) · borrar la columna de prioridad.
- **FASE 5 — creación:** tarea vacía que se persiste + guard de título vacío **(EVIDENCIA REAL, sesión 16: la usuaria
  dejó una tarea de título vacío persistida `t-1785615179787` al validar el punto 1 — borrada; el bug NO es teórico)** ·
  encadenado con Enter · ruido en consola al arrancar Mi Día · ~~borrar `selectedBlockId`~~ ✅ HECHO (`6dce9a0`, §16.5)
  + **pregunta abierta** Mi Día→primer bloque (§16.5, SIGUE ABIERTA).
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
    estado local). (3) ~~Muda a propósito: escritura al array `subtasks` (bug #18)~~ → ELIMINADA (sesión 19, #18 resuelto).
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

### 16.12 PUNTO DE RETOMADA — ✅ FASE 3 CERRADA (sesión 18)

**✅ FASE 3 CERRADA (sesión 18). Todo en producción. Estado final:**
| Paso | Qué | Commit(s) |
|---|---|---|
| (a) | totales del contenedor por día; el tiempo nunca se registra sobre el contenedor | sesión 16 (§16.10) |
| (b1)+(b2) | completado DERIVADO de las hijas (nunca del status guardado); vaciado visual | sesión 16-18 |
| (b3) | "ocultar completadas" en Mi Día usa el completado POR DÍA (`isCompletedForDay`) | `ff4643b` |
| MODELO §16.16 | contenedor = tarea con hijas (DERIVADO, sin marca); degradación ELIMINADA; `validateTemplate` reescrito | `2dbada5`, `308a935` |
| C4 | la pauta de recurrencia arranca el día que se mira | `f707911` (validado en pantalla) |
| C3 | `reconcileDay` cableado en `activeDayMap` (mapa del día sin fuga) | `26d157e` (validado: 0 filas desaparecen) |
| C2 | tapón supresión de contenedor + reversión de 22 + completar 2 varadas; orfanato = no perdía trabajo | `e7724ee` + datos |
| C1 | clic en contenedor completa SOLO las hijas del día (rama por tipo) | `f073ed5` |

**⏳ ÚNICO pendiente de FASE 3 = validación en pantalla de la usuaria (mañana): el CLIC de C1** — marcar/desmarcar un
contenedor manual y uno recurrente con hijas de varios días; que solo se toquen las del día. Si algo de otro día se toca,
revertir `f073ed5`. (El clic no se pudo automatizar por el `confirm()` del tapón; render día-scoped + tests sí verificados.)

**ARRANCAR LA FASE SIGUIENTE POR:** decidir FASE 4 (limpieza de datos, plan en §16.17 listo para aprobar) o FASE 5/6
(creación/diseño). Nada de FASE 3 bloquea. Tests: **95 verdes, 0 rojos.**

**🩺 ¿CUÁNTO FALTA PARA DAR LA APP POR ESTABLE? (inventario honesto, criterio del asistente — cierre sesión 18):**
- **Lo que DOLÍA a diario (trabajo desapareciendo) — RESUELTO esta sesión:** completar/clicar un contenedor ya no esconde
  trabajo en silencio (se cerró el escritor del status propio; C1 día-scopea el clic; el tapón B rescata el contenedor
  borrado con hijas pendientes; el fallback-a-hoja se atajó normalizando datos). *Pendiente de tu validación: el clic de C1.*
- ~~**🔴 LO ÚNICO que aún DUELE a diario: MOVER un contenedor deja sus hijas atrás** (*vacated*)~~ ✅ **RESUELTO (sesión 19,
  `a8f23d6`, opción A):** al mover un contenedor MANUAL, sus hijas de fila real del día de origen viajan con él
  (`childrenToMoveWithContainer`, +tests). Ya no se esconden. *(El colapso masivo de fechas es OTRA cosa — el "mover a
  fecha" en lote, §16.19/§16.20 — y tiene su propio guard.)*
- **Molestias menores, NO dolor diario:** clic de contenedor en Semana/Calendario aún togglea todos los días (solo si
  completas ahí); contador "1 tarea/7 filas" en Bloques (cosmético); el chip de recurrencia solo desde el modal (FASE 5).
- **Higiene invisible, NO duele:** FASE 4 (7 rotas, 1 dup Soriano, 64 filas `inst-inst-` basura, 1 instancia suelta) —
  clutter que no se ve; conviene limpiar pero no urge. Optimización de desmarcado y purga de completadas: cosmético.
- **Diseño/pulido (FASE 6), NO funcional:** modal de papelera, renombrar "borrar la serie", calendario sin retroceso de
  mes, aviso de Carga, ancho máximo.
- **VEREDICTO:** tras validar el clic de C1, para el uso diario "no perder trabajo" la app está **casi estable** — con UN
  agujero real: **mover contenedores**. Ese es el trabajo que separa "casi" de "estable". Lo demás es limpieza y pulido.

---
*(Historia de sesión 17, ya superada por la 18 — ver inventario de desactualizado abajo):*
*(Nota: (a)/(b)/(c) son los PRINCIPIOS de FASE 3; los agujeros de recurrencia se renombraron a R1/R2/R3 en §16.15.)*
**La sesión 17 SÍ tocó la app** (7 commits): `4bfa51d` fix modal · `71f499f`+`5c019d1` degradar contenedor vaciado
(normal+lote) · `1456610` aviso al degradar · `4de1ca1` guard-aviso · `da8481e` tests campo muerto · `b1fbe7c`→`ced422a`
handleAddRule opción B. **Último commit de app: `ced422a`.** **Tests: 82 verdes, 1 rojo a propósito** (`reconcileDay`,
cierra en (c)). **Sigue pendiente la validación de la usuaria (Bloques/Mi Día, 25 contenedores) y esa validación SIGUE
bloqueando (b3).** Investigación/estado de recurrencia → §16.15 y §16.16.

**✅ CERRADO y en producción:**
- **(a) entera** — el tiempo nunca se registra sobre un contenedor + totales por día:
  - `belongsToDay` (única definición de "pertenece a un día", `instanceEngine`).
  - `containerEstimatedForDay`/`containerRegisteredForDay` (`fase3Contracts`), cableadas en Mi Día (`dayForTotals`).
  - Play oculto y registrado solo-lectura en contenedores; guard en `handleStartTimer`/`handleManualTimeEntry`.
  - `getVisibleSubtasksForDay` unificado con `belongsToDay`.
  - Impacto medido: contenedores manuales dejan de inflar (ej. "Rutinas mañana" ~75.600m → el día). 684 entradas de tiempo INTACTAS (no se borró nada).
- **(b1)+(b2 visual)** — completado del contenedor DERIVADO de las hijas, NUNCA de su `status` guardado:
  - Con día → hijas del día; sin día (Bloques) → todas las hijas (`isTaskCompleted`); hoja → su status.
  - Vacío-verdadero cubierto (`hasDayChild`). Fix del bug de Bloques incluido (`55a69df`).
- **MODELO (§16.16) — ⚠️ ACTUALIZADO sesión 18 (esto de la 17 quedó SUPERADO):** "contenedor vaciado → degrada" y
  "regla XOR contenedor" **YA NO valen**. La degradación (`71f499f`/`5c019d1`/`1456610`) se **ELIMINÓ** (`2dbada5`): ser
  contenedor se DERIVA de tener hijas, no había conversión que revertir. `validateTemplate` reescrito (`308a935`): un
  contenedor SÍ puede alojar reglas. Siguen válidos: fix del modal (`4bfa51d`), `handleAddRule` opción B (`ced422a`),
  tests de campo muerto (`da8481e`). Ver §16.16 (modelo corregido) y el censo real (98 contenedores).

**⚠️ INVENTARIO DE DESACTUALIZADO TRAS EL CAMBIO DE MODELO (repaso completo, bloque 5 sesión 18).** Lo que sigue en el
doc quedó SUPERADO por el modelo corregido (§16.16); no lo reescribo entero —es registro histórico— pero aquí está la
lista para que nadie se fíe de ello:
- **§16.12 "sesión 17 tocó la app" (~L2091):** lista `71f499f`+`5c019d1` "degradar contenedor vaciado" y `1456610` "aviso
  al degradar" como hechos. **SUPERADO:** esa maquinaria se ELIMINÓ (`2dbada5`). Quedan válidos `4bfa51d`, `ced422a`, `da8481e`.
- **§16.14 método, ejemplo del vaciado (~L2211):** cita `shouldDegradeToNormal`/`containerDegradeAfterDelete` (`7e52d88`)
  como el arreglo. **SUPERADO:** la lección ("test del camino real") SIGUE valiendo, pero el arreglo citado se borró; la
  causa real era la cascada del checkbox + el escritor del status propio (§16.16), no la degradación.
- **§16.15 R-section (~L2178-2269):** "133 plantillas → **23 contenedores manuales legítimos + 9 rotas**" y "`isTemplate`
  se usa TAMBIÉN como flag de contenedor" y "degradación (normal y lote) cerrada". **SUPERADO en 3 cosas:** (1) el nº real
  de contenedores es **98** (75 sin marca + 23 con marca por hijas recurrentes), el "23" medía los marcados; (2)
  `isTemplate` **NO** es flag de contenedor —contenedor se deriva de tener hijas—; (3) no hay degradación.
- **§16.4 pendiente #1 "recurrencia desde la fila ✅ HECHO" (~L1841) vs §5 "no existe" (~L714) vs FASE 5:** contradicción
  de tres sesiones. **Verdad actual (validada):** el chip NO se puede usar desde la fila (ni Bloques ni Mi Día); hay que
  abrir el modal (FASE 5, §16.17). Ya matizado inline en ambos.
- **§16.15 "R2/R3 + degradación cerrados" (~L2263):** R1/R2/R3 siguen, pero "degradación cerrada" **SUPERADO** (eliminada).
- **DUDOSO/HISTÓRICO — menciones de "(c)" como FUTURO, ahora que (c) está CERRADA (sesión 18); no tocadas, son narrativa
  vieja:** ~L1946 "el síntoma se arregla en (c)", ~L1967 "falta materializar las hijas del día", ~L2295 "1 rojo... se pone
  verde en (c) · 69 verdes", ~L2423 "se cierra en (c)". Léanse como historia: (c) = C1/C2/C3/C4, ya cerrada; el motor SÍ
  materializa el toggle del día (C1, `f073ed5`); tests **95 verdes, 0 rojos**. El síntoma-30-jul (huérfanas por mover)
  quedó tapado (tapón B) + su causa raíz aparcada en §16.17 ("mover no lleva hijas").

**✅ VALIDACIÓN DE LA USUARIA — HECHA:** los **25** contenedores que cambiaban de aspecto son **CORRECTOS** (tareas ya
completadas). Validado en pantalla. **(b3) DESBLOQUEADO.**

**❌ FALTA (lo siguiente):**
- **(b3) ✅ HECHO (`ff4643b`, sesión 18):** el filtro "ocultar completadas" de Mi Día usa el completado POR DÍA
  (`isCompletedForDay`: contenedor → `isContainerCompleteOnDay` del día; hoja → su status). Antes `DashboardView`
  re-aplicaba `hideCompleted` con `isTaskCompleted` (TODAS las hijas). `filterTasksForDay` y `getStatsForDay` ya eran
  día-scoped (sin cambio); Semana/Calendario no filtran completado de contenedor. **Cambio de aspecto (validar con
  calma):** SOLO en Mi Día y SOLO con "ocultar completadas" ACTIVO — un contenedor cuyas hijas de HOY están todas hechas
  ahora DESAPARECE aunque tenga hijas pendientes de otro día. Con el filtro apagado no cambia nada. **Techo del impacto:
  56 contenedores** (los que tienen hijas mixtas completa+pendiente); el número real por día es un subconjunto.
- **C3 — `reconcileDay` ✅ CABLEADO (corrige el "NO CABLEADO" de la sesión 18).** Ya es `activeDayMap = useMemo(() =>
  reconcileDay(activeDate, tasks), [tasks, activeDate])` en [App.tsx:166](App.tsx) (sustituyó al overlay
  `Object.values(tasks).forEach(t => map[t.id]=t)`). La función-contrato hace el mapa sin fuga (día + contenedores sin
  fecha + plantillas; descarta solo hojas datadas de otro día) y tiene test de la forma real `isTemplate:false`. **Los 2
  riesgos del paso-0 quedaron cubiertos** (plantillas conservadas; sin cambio de visibilidad observado). Histórico de por
  qué no se cabló a ciegas en su día:**
  1. **Plantillas:** `filterTasksForDay` hace `allTasksMap[t.templateId]` ([filters.ts:156](filters.ts)) para decidir si
     una instancia se muestra. `reconcileDay` YA conserva las plantillas, así que el cableado no debería romperlo — **pero
     verificar en pantalla** que ninguna instancia cambia de visibilidad.
  2. **Contenedores sin fecha:** `belongsToDay` da false para ellos; `reconcileDay` los conserva por "tiene hijas", así que
     no deberían desaparecer — **verificar en pantalla** que siguen saliendo con su hija del día.
  Al cablear, medir: filas en el mapa antes (~2071 / 1015 de otros días) vs después, y confirmar que **nada desaparece de
  la vista** (por construcción no debería, pero es display → lo valida la usuaria).

**🔴 EN (c) SE CIERRA, SÍ O SÍ:**
- **ESTADO (fin sesión 18): (c) CERRADA.** C4 ✅ (`f707911`) · C3 ✅ (`26d157e`) · C2 ✅ (`e7724ee`+datos) · **C1 ✅
  IMPLEMENTADO (`f073ed5`)** — clic en contenedor completa solo las hijas del día (rama por tipo). Único pendiente: la
  usuaria valida el CLIC en pantalla (no automatizable por el `confirm()`); render día-scoped + tests verificados.
- **Contradicción del clic (= C1) — ✅ CERRADA (`f073ed5`):** clicar un contenedor ya solo togglea las hijas del día
  (Mi Día; Bloques sin día → todas). Salvedad: **Semana/Calendario** aún NO enhebran su día de celda al toggle → ahí el
  clic sigue togglando todas las hijas (viewDay undefined → comportamiento previo). Menor; aparcado (ver §16.17).

**🗺️ MAPA DE C1 — ✅ YA IMPLEMENTADO (`f073ed5`); esto es la nota de diseño previa, histórica:** clic en contenedor = completar SOLO las hijas del día que se mira.
- **Archivos:** `useTaskCRUD.ts` (`handleToggleStatus`/`toggleRecursive`) + los sitios que llaman al toggle (la casilla en
  [TaskCard.tsx:445](TaskCard.tsx) y el `onToggle`/`onToggleStatus` por vista). Reutiliza la **fontanería de C4**:
  `dayForTotals` = "día de la vista" (activeDate en Mi Día, día de celda en Semana/Calendario, **null en Bloques**).
- **Qué falta, en concreto:**
  1. **Pasar el día-de-la-vista al toggle.** Hoy `handleToggleStatus` usa el `activeDate` global (uno solo), no el de la
     vista que clica. En **Bloques (sin día)** el clic debe seguir completando TODAS las hijas → el día llega como `null` y
     ahí se conserva el comportamiento actual. Es el mismo hilo que C4 (`dayForTotals`), ya montado.
  2. **`childrenToToggleOnDay` sirve para hijas MANUALES tal cual** (son filas reales, `belongsToDay` acierta). **NO sirve
     para hijas RECURRENTES:** para una hija recurrente `allTasks[sid]` es la PLANTILLA (sin fecha) → `belongsToDay`=false
     → la omite. Hay que **materializar** las instancias del día de esas hijas (`materializeDay`) y togglearlas como
     excepción. `handleToggleStatus` YA tiene un patrón de `dayMap` materializado (para instancias vírgenes,
     [useTaskCRUD.ts:117-124](useTaskCRUD.ts)) → reutilizable/extensible. Ésa es la única parte "dura".
- **¿Cuánta materialización?** Solo para contenedores con hijas recurrentes (≈23 de 98); los 75 manuales van con
  `childrenToToggleOnDay` sin materializar nada.
- **¿El modelo corregido lo simplifica? SÍ, mucho:** como el contenedor **ya no escribe su status propio** (cerrado
  sesión 18) y el completado se **deriva**, C1 se reduce a "togglear las hojas del día" — sin sincronizar estado del
  contenedor, sin dirección leída del campo muerto. `childrenToToggleOnDay` ya da el conjunto manual.
- **Depende de:** C3 cableado (mapa del día limpio) para que "el día" sea coherente. **El tapón de confirmación
  (`424d7ac`) se queda** hasta que C1 esté validado (y NO se retira sin la usuaria).
- **Síntoma del 30-jul (tareas pendientes ESCONDIDAS):** hijas huérfanas (`parent_task_id=null` al mover) sin contenedor materializado ese día. NO se arregla en (b); vive hasta (c). Es lo más grave (esconde trabajo).
- **Toggle "completar-solo-el-día"** (recurrentes necesitan materializar las hijas-instancia del día).
- **Fecha de inicio de recurrencia (C4) ✅ HECHO Y VALIDADO EN PANTALLA (`f707911`, sesión 18):** `RecurrencePickerChip`
  recibe `defaultDate` (el día que se mira) y los defaults de la pauta arrancan ahí, no en `new Date()`. Enhebrado desde
  TaskCard (`dayForTotals=activeDate`) y **desde el modal** (fecha de la tarea). **Validado por la usuaria:** creando la
  recurrencia **desde el modal**, arranca en el día de la tarea, no en hoy. *(Salvedad, no de C4: el chip NO se puede usar
  desde la FILA —hay que abrir el modal—; aparcado en FASE 5, ver §16.17.)*

**🧵 Hilo de datos (con (c)/mover):** al mover una tarea, su excepción queda `parent_task_id=null` y al leer se re-anida por plantilla; frágil si el contenedor no está materializado ese día. Es lo que dejó huérfanas las 10 hijas del 30-jul.

**📏 MEDICIÓN C2 (sesión 18, 2026-08-14; SOLO LECTURA, nada tocado):** huérfanas pendientes = **32** (no 25; ver anomalía
abajo). Son excepciones con `parent_task_id=null` + `template_id` cuya plantilla es hija de un contenedor. **Por qué no se
ven:** `filterTasksForDay` las RECHAZA como top-level ([filters.ts:155-157](filters.ts): "si su plantilla tiene padre →
return false") y, con `parent_task_id=null`, solo aparecen si se re-anidan bajo el contenedor **materializado ese día**; si
el contenedor no se materializa en su fecha o el anclaje no cuadra, caen entre dos sillas → invisibles. Reparto por
contenedor (todos tipo plantilla-que-materializa): **Cierre Central Rec 10 · Cierre Propias 8 · Verduras vivas 4 · Gestión
campaña 3 · Test Recurrent B1 3 (fixture 2028) · Pagos del mes FINCA 1 · Montse Vidal 1 · Cierre Anual 1 (inst-…-2026-08-24,
la "Ënviar documentos firmados a auditores")**. Lista completa (título/fecha/id) entregada a la usuaria en el informe.
- **🔴 CORREGIDO (mi consejo anterior estaba AL REVÉS; validado por la usuaria en pantalla, sesión 18): COMPLETAR también
  esconde, y es la causa dominante.** Censo de huérfanas (`parent_task_id=null`, hija-de-contenedor): **615 totales — 540
  las creó COMPLETAR, solo 75 mover.** 583 completadas / 32 pendientes (18 movidas / 14 en-sitio). Ritmo del uso normal:
  **11–30 excepciones-huérfanas nuevas AL DÍA** (hoy 13). Todo `parent_task_id=null` porque el upsert de
  `handleToggleStatus` lo escribe así ([useTaskCRUD.ts:188](useTaskCRUD.ts)).
  - **CAUSA EXACTA de la desaparición de "Verduras vivas" hoy (peor que orfanato simple):** existe una excepción a nivel de
    CONTENEDOR `inst-t-1780303315173-2026-08-14` con **`is_deleted=true`** (creada 08:21 hoy, junto a las 4 hijas pendientes).
    `materializeDay` línea 230 (`if (findDeletedForDay(...)) continue`) **salta el contenedor entero y sus 4 hijas**. Las
    hijas, al ser huérfanas (`parent_task_id=null`), tampoco salen como top-level (`filterTasksForDay:155-157` las rechaza).
    → el contenedor + 4 tareas reales pendientes **invisibles**.
  - **Sistémico HOY:** 2 contenedores suprimidos por excepción-borrada para 08-14 (**Verduras vivas**, **"rec cont sabado"**).
    **169 excepciones-borradas a nivel de contenedor** en total (todos los días). No se ha podido confirmar por datos QUÉ
    clic exacto crea la excepción-borrada del contenedor (completar todas las hijas, o un borrado); el resultado sí está claro.
  - **REGLA HONESTA: NO hay acción segura sobre subtareas recurrentes de un contenedor.** Completar (lo más frecuente),
    mover y editar pueden orfanizar/suprimir y esconder trabajo. **Consecuencia: C2 (+ este bug de supresión de contenedor)
    NO puede esperar detrás de C3.** Es pérdida de trabajo real en el uso diario.
- **3 de las 32 son el fixture de test "Test Recurrent B1" (2028)** — basura de pruebas, no trabajo real; van con la
  limpieza de FASE 4, no con C2.

**🔀 LOS DOS MECANISMOS DE OCULTACIÓN — SEPARADOS Y NOMBRADOS (llevábamos media sesión confundiéndolos, §16.16):**
1. **ORFANATO (`parent_task_id=null`).** Lo causa **completar, mover o editar** una hija recurrente (el upsert de
   `handleToggleStatus`/mover/editar escribe `parent_task_id: null`, [useTaskCRUD.ts:188](useTaskCRUD.ts)). **615 filas
   (540 de completar, 75 de mover), 11–30 nuevas/día.** Esconde la hija SOLO si falla el re-anclaje bajo su contenedor
   materializado. Es el mecanismo de **C2** (el arreglo entero).
2. **SUPRESIÓN DE CONTENEDOR (excepción-borrada).** La causa **SOLO** "borrar → este día" desde la **papelera de la fila**
   de un contenedor recurrente ([App.tsx:958-979](App.tsx)). Entierra el **contenedor entero + todas sus hijas** de ese
   día. **169 en total; 1 con trabajo vivo** (Verduras vivas, 4 pendientes hoy). **Tapado con el TAPÓN B** (abajo).

**✅ C2 CERRADO (sesión 18). Números finales: 615 huérfanas = 583 histórico (completadas, no trabajo) + 32 pendientes;
de las 32 → 26 se VEN (self-nest por plantilla) + 4 rescatadas por el TAPÓN B (Verduras, `e7724ee`) + 2 completadas
(«Publicar a coordinadores» y «Sacar copias» de julio, superadas por su ocurrencia de agosto que ya está a la vista;
opción 3, se completan para dejar rastro en el histórico, no se borran). Trabajo escondido restante: 0.**
**LO QUE PERDÍA TRABAJO NO ERA EL ORFANATO** (las instancias se re-anclan por plantilla; nada se perdía por el
`parent_task_id=null`) — **lo perdían la SUPRESIÓN de contenedor (borrar→este día) y el VACATED (mover el contenedor)**.
Medio día se creyó lo contrario; queda escrito para no volver a creerlo. El bug de fondo que genera *vacated* ("mover un
contenedor no se lleva sus hijas") queda aparcado en §16.17 (motor, tamaño MEDIO) para arreglarlo en (c).

**🔁 C2 REPLANTEADO tras medir (enfoque, sesión 18) — el orfanato NO es el problema que parecía:**
- **"Parar la fuga" (dejar de escribir `parent_task_id=null`) NO recupera nada y NO hay que hacerlo — pero OJO, el nulo NO
  es campo muerto (corrección sesión 18):** es **intencionado** (comentarios useTaskCRUD 198/405/683: "null; materializeDay
  re-anida por templateId") y es una **convención de DERIVAR-AL-CARGAR**, no un campo ignorado:
  - **AL RENDERIZAR:** el parent guardado de la instancia se ignora — `getVisibleSubtasksForDay` (CASO 1,
    [filters.ts:95](filters.ts)) ancla por la PLANTILLA; `materializeDay` fija el parent al vuelo.
  - **AL CARGAR (SÍ lo lee):** `reconstructInstanceHierarchy` ([useSupabase.ts:61-86](useSupabase.ts)) hace
    `if (task.parentTaskId) return` → usa la **nulidad como señal de "re-anclar por plantilla"**; y `reconstructHierarchy`
    (:34) arma los `subtasks[]` de los padres desde parents no-nulos.
  - **Por eso "dejar de escribir el nulo" NO es inocuo:** rompería el disparador del loader (`if (parentTaskId) return`
    saltaría el re-anclado → instancias con parent obsoleto → mal anidadas). **Es el tipo de cosa que muerde en 6 meses.**
    Cambiar el nulo no recupera trabajo (el escondido son 2, por *vacated*) y sí arriesga el re-anclado. NO tocar.
- **Mover NO "desancla":** TODAS las instancias recurrentes tienen `parent_task_id=null` (no solo las movidas); se anclan
  por plantilla. Mover solo cambia la fecha; el vínculo (template_id) persiste. No es deuda, es el modelo virtual.
- **Cuánto hay escondido DE VERDAD ahora (medido, post-tapón B):** de 615 huérfanas → 583 completadas (histórico, no
  trabajo) + 32 pendientes. De esas 32: **26 se VEN** (el propio orphan hace materializar su contenedor vía `findLanded` →
  se re-ancla), **4** eran Verduras (ya rescatadas por B), **2 siguen ESCONDIDAS** — contenedor *vacated* (movido) ese día,
  que B no cubre: "Publicar a coordinadores" y "Sacar copias…" bajo "Cierre Propias " el 07-22.
- **Conclusión: C2 es diminuto.** No es "615 perdidas". El orfanato en sí no pierde trabajo (las instancias se re-anclan
  por plantilla; test guarda `161959c`). La conclusión de la usuaria ("C2 es mucho más pequeño") es CORRECTA, pero no por
  "dejar de escribir el nulo" (ese nulo lo LEE el loader, ver arriba) sino porque casi todo ya se ve y B cubrió lo grande.
  Residual escondido de verdad: **2** ("Publicar a coordinadores", "Sacar copias…") bajo "Cierre Propias" el 07-22.
- **❌ B-vacated (extender el tapón al caso *vacated*) PROBADO Y DESCARTADO (sesión 18):** el sub-contenedor
  `t-1778694715714-n9oeas4sa` está *vacated* **07-22 → 07-23** y ATERRIZA en 07-23. Resucitarlo en 07-22 (por las 2
  huérfanas) lo dejaría en 07-22 **y** 07-23 → **DOBLE RENDER** (justo lo que el check de `findVacated` evitaba). La
  usuaria: "prefiero A-scoped feo a un contenedor duplicado". Código revertido, no comiteado. **DECISIÓN PENDIENTE para
  las 2:** (A-scoped) mostrar las huérfanas pendientes como fila suelta cuando su contenedor no se materializa ese día
  —toca `filterTasksForDay` (155-157), más invasivo de lo previsto—; o (data-fix FASE 4) re-apuntar/mover esas 2 al 07-23
  con su contenedor. Son de un día PASADO (07-22). No tocado hasta decidir.

**⚠️ CORRECCIÓN de mi consejo (importante):** dije "evita mover, completar es seguro" — **FALSO**. (a) Completar es la
causa dominante del orfanato (540/615). (b) Lo que enterró las 4 de Verduras hoy fue un **BORRADO de un día** (supresión
de contenedor), no completar ni mover. (c) **El gesto peligroso concreto es la papelera de una fila recurrente** (→ "este
día"): suprime todo el subárbol de ese día.

**🩹 TAPÓN B — APLICADO (`e7724ee`, sesión 18):** `materializeDay` ya NO entierra un contenedor con excepción-borrada del
día si ese día le queda ≥1 hija **pendiente persistida** (`allTasks[c.id]` existe); una ocurrencia recurrente
auto-generada no resucita un borrado deliberado. Render puro, reversible. Validado en pantalla: **Verduras vivas + sus 4
tareas reaparecen hoy** (grupo "En espera"), **nada más cambia** (Focus/Dirección/Resto idénticos; pendientes 17→21).
Tests 92 verdes (regla + control en forma real). **NO arregla el orfanato** — eso es C2. El tapón solo cubre la supresión
de contenedor.

**Reglas de datos ya decididas (NO tocar):** el tiempo sobre contenedores (4 entradas/116m) NO se borra (deja de contar, se queda). Los 92 "completados" guardados NO se limpian (el código deja de leerlos; el test lo garantiza).

**Tests:** 69 verdes, 1 ROJO a propósito (`reconcileDay`, se pone verde en (c)). DIAG-TEMP sigue puesto (no quitar aún).

### 16.13 Reglas y pendientes decididos (sesión 17) — aún no implementados salvo lo indicado

**REGLA DEFINITIVA DEL CONTENEDOR — vista CON día vs vista SIN día** *(aplicación del MODELO, §16.16):*
- **Con día (Mi Día, Semana, Calendario):** un contenedor **aparece solo si tiene ≥1 hija de ESE día**, y está **completo cuando todas sus hijas de ese día lo están**. **Manda el día siempre**, incluidos los contenedores que mezclan hijas recurrentes y sueltas. (Es lo que ya calcula `isContainerCompleteOnDay` + `belongsToDay`; falta terminar de cablearlo en b3/c y en Semana/Calendario si algún día muestran visto de contenedor.)
- **Sin día (Bloques):** no hay día → está **completo cuando no le queda ninguna hija pendiente**, sin mirar fechas (`isTaskCompleted` sobre todas las hijas). Nunca se lee el `status` guardado del contenedor.

**BLOQUES — REGLA CANÓNICA (fijada por la usuaria, sesión 19, 2026-08-15):**
- **Contenedores normales:** se ven las subtareas **PENDIENTES**; las **completadas ocultas** pero **accesibles a petición**
  (por contenedor, no global).
- **Contenedores recurrentes:** se ve la **plantilla/regla** y las **instancias modificadas que sigan PENDIENTES**. Las
  **ocurrencias completadas históricas NO** (se consultan por el icono de información).

> ~~**BLOQUES = LISTA DE DEFINICIÓN, una línea por regla:** solo la plantilla, NO sus ocurrencias; las ocurrencias por el
> icono de información.~~ **SUPERADA (2026-08-15).** Esta versión decía "ninguna ocurrencia inline"; la regla canónica de
> arriba SÍ muestra las instancias modificadas que sigan pendientes. Implementada en `getVisibleSubtasksForBloques`
> (§16.26). *(El nivel superior sigue siendo una fila por contenedor/regla; el cambio es solo qué HIJAS se pintan al abrirlo.)*

**PENDIENTES sueltos (asignar a su fase):**
- **Checkbox que falta en las filas completadas** — revisar por qué una fila completada no muestra su casilla en algún caso. *(FASE 6 diseño / o bug de fila.)*
- **Ancho máximo del contenido, centrado, ~1.200px** — el contenido no debe estirarse a todo el ancho en pantallas grandes. *(FASE 6 diseño.)*
- **Crear tarea dentro de un contenedor → el cursor se coloca en el título** (edición inline lista para escribir). *(FASE 5 creación.)*
- **Aviso "¿convertir en contenedor?" con el botón "Sí" enfocado** → confirmar con Enter. *(FASE 5 creación.)*

### 16.14 MÉTODO DE REPARTO DE TIEMPO (sesión 17) — cómo trabajar a partir de ahora

**El recurso escaso es el tiempo de la usuaria, no el del asistente.** Por tanto:
- **Encadenar todo lo que NO se ve:** tests, funciones internas, consultas, documentación, migraciones mecánicas. No parar entre ellas.
- **Parar solo cuando algo cambie la PANTALLA o los DATOS de la usuaria.**
- **Decidir el asistente** lo que tenga respuesta obvia y contarlo después. Si hay **dos caminos razonables**, **aparcarlo** y seguir con lo independiente.
- **Pararse de verdad SOLO si:** (1) habría que borrar/modificar datos de la usuaria de forma irreversible; (2) el cambio afecta a bastantes más elementos de los previstos; (3) la premisa del punto resulta falsa; (4) no se logra dejar los tests en verde; (5) el arreglo obliga a salir del alcance de la fase; (6) se rompe algo que funcionaba.
- **Al acabar cada FASE, informe con:** qué se hizo y con qué commit · qué decidió el asistente solo · qué aparcó · qué cambia de aspecto o de número y cuánto · la lista concreta de lo que la usuaria tiene que mirar.
- **Sigue vigente:** solo commitea el asistente, un commit por bloque, build+tests sí / navegador solo si lo pide, master=producción a la par y decir siempre commiteado-vs-producción, DIAG-TEMP no se quita.
- **AVISO AL MÓVIL al cerrar/parar fase:** usar `PushNotification` (herramienta INTEGRADA de Claude Code, sin cuenta ni
  instalación), disparada **a mano como último paso** al cerrar una fase o al pararse por uno de los 6 motivos.
  **Nunca** engancharla al hook de fin de turno (saltaría en cada respuesta). Requiere **Remote Control emparejado** para
  llegar al móvil; si no, la notificación llega solo al escritorio. Mensaje corto: qué fase, si acabó o se paró, y si
  algo espera respuesta de la usuaria.
- **TEST DEL CAMINO REAL, no solo del helper:** un arreglo que **cambia lo que se ve en pantalla** NO se da por cerrado
  con tests del helper puro; hace falta un test que ejerza el **camino real** (o el reducer compartido que ese camino
  usa). **Ejemplo:** el bug del vaciado — `shouldDegradeToNormal` estaba verde, pero **nadie lo llamaba** en el borrado
  real (instancia recurrente por otra ruta; y aun en la ruta buena faltaba `status:'pending'`) → en pantalla el
  contenedor salía tachado. Se cerró con `containerDegradeAfterDelete` (reducer compartido) + sus tests (`7e52d88`).

### 16.15 Recurrencia: ciclo de vida y estado de los datos (investigación sesión 17, NO arreglado)

**CICLO DE VIDA DE UNA RECURRENTE (en cristiano):**
- Al poner recurrencia, la tarea se convierte en **PLANTILLA = la regla** (`isTemplate:true`, `dueDate:null`). Guarda
  título, bloque, estimado, etiquetas y la **pauta** (`recurrence`). No es una tarea de un día.
- Las **ocurrencias** de cada día son **VIRTUALES**: no existen como fila; las genera al vuelo `materializeDay`/`occursOn`.
- Una ocurrencia pasa a **FILA REAL** (excepción, `inst-<plantilla>-<fecha>`) **solo cuando actúas sobre ella**:
  completar, mover, registrar tiempo o editar → `upsert`.
- **Mover** → excepción con `due_date`=día nuevo y `parent_task_id=null` (huérfana; se re-anida al leer por plantilla).
  **Completar** → excepción `status=completed` que "gana" sobre la regeneración.
- Relación: cada fila real se une a su regla por `template_id`; la **regla** tiene la `recurrence`, las **instancias**
  tienen `recurrence=null` + `template_id`.

**LOS TRES CAMINOS DE CREACIÓN:**

| Camino | Bloque donde acaba | Qué se ve en Bloques | Tipo |
|---|---|---|---|
| **Mi Día** (`doAddTask`) | `blocks[0]` (primer bloque, §16.5) | la plantilla | core por defecto |
| **Bloques** (`handleAddRule`) | el bloque donde pulsas | **NO nace como plantilla** (opción B, `ced422a`): tarea normal visible en Bloques; se vuelve regla al ponerle pauta | según su tipo |
| **Modal** (`TaskModal`) | el bloque de la tarea | la plantilla | core por defecto |

**NÚMEROS REALES (medición sesión 17, 2026-08-13):** 133 plantillas (`is_template`, no borradas):
- **101** con pauta válida (`recurrence.frequency`).
- **32** "RECURRENTE sin pauta" (`recurrence=null`). De esas: **23 son contenedores manuales legítimos** (tienen hijas por
  `parent_task_id` — `is_template` se usa TAMBIÉN como flag de "proyecto/contenedor", no solo recurrente) y **9 están de
  verdad ROTAS** (sin pauta y sin hijas por `parent_task_id` → salen como "RECURRENTE" y no generan nada). *(Corrige el
  21/11 anterior, que contaba `template_id` —ocurrencias de una regla— como hijas; lo correcto es `parent_task_id`.)*
- **Duplicados:** 5 grupos mismo título+bloque (10 filas: "Margenes", "Ingresos ", "Bancos ", "Gestión campaña",
  "Cierre Propias " — ojo espacios finales en varios) + 2 grupos mismo título+padre (4 filas). Poco volumen.
- **Origen (por `created_at`):** repartido abr–jul 2026, pico en mayo (19). De las 9 rotas, **solo 1** tiene `id` con
  forma `inst-…-fecha` (`is_template:true` = instancia "ascendida" por el bug del picker); **las otras 8 no** (§16.16).

**FIRMA EN DATOS DEL ESTADO ROTO:** `is_template:true` + `recurrence:null` + **sin hijas** = ninguna fila NO borrada con
`parent_task_id` = ella. **OJO: NO usar `template_id` para "hijas"** — `template_id` son las OCURRENCIAS de una regla, no
hijas de contenedor. Si tiene hijas por `parent_task_id`, NO es rotura: es un contenedor manual (proyecto).

**AGUJEROS DE RECURRENCIA — R1/R2/R3 (renombrados para NO chocar con los principios (a)/(b)/(c) de FASE 3):**
- **R1 ✅ CERRADO (`4bfa51d`):** `TaskModal` ya NO pre-pone `isTemplate:true` al activar recurrencia (mismo fix que la
  fila `c0bb09d`); ahora fija solo la pauta y `handleUpdateTask` hace la conversión (crea la 1ª instancia).
- **R2 ✅ CERRADO (`ced422a`, opción B):** `handleAddRule` (Bloques) ya **NO crea una plantilla**: crea una tarea NORMAL
  (visible en Bloques como "manual"); se vuelve regla al ponerle pauta en el editor. Se eligió B sobre A tras comprobar
  que Bloques SÍ muestra tareas normales (no las esconde) y que A dejaba una regla diaria que ensucia Mi Día cada día.
  *(Revierte el default-daily `b1fbe7c`.)*
- **R3 ✅ HECHO como AVISO (`4de1ca1`):** `validateTemplate` + `toast.warn` en `handleUpdateTask` avisan si una plantilla
  queda inválida (pauta+hijas, o ni pauta ni hijas). No bloquea (decisión de la usuaria). No es un guard duro.
- **Degradación al vaciar ✅ (`71f499f` normal + `5c019d1` en LOTE, aviso `1456610`):** un contenedor sin hijas pierde
  `isTemplate`. Es una **posible** fuente de las rotas por vaciado; **los datos no distinguen** vaciado-sin-degradar de
  regla-creada-sin-pauta (§16.16). Ahora también degrada al vaciar en lote.
- **CONCLUSIÓN (actualizada):** R1+R2+R3 + degradación (normal y lote) **cerrados**. El rellenado por modal, Bloques y
  vaciado está tapado. **Ahora limpiar las 9 rotas ya NO se vuelve a llenar** — pero **la limpieza sigue SIN hacer**
  (pendiente de la usuaria).
- **Verificación (solo lectura):** la conversión de recurrencia deja la **plantilla SIN fecha** (`isTemplate:true,
  dueDate:null`, useTaskCRUD:563-565) → el fix del modal NO viola el modelo. En datos había **5 plantillas con fecha
  pegada**, todas `recurrence:null` y entre las 9 rotas (preexistentes, NO del fix):
  - **2 RECUPERADAS** (degradadas a tarea normal + fecha de hoy 2026-08-13): "Ënviar documentos firmados a auditores"
    (`t-1785433862534`) y "Recoger la documentación encuadernada de los auditores" (`t-1785433874822`). **⚠️ "Ënviar"
    tiene además una instancia suelta `inst-t-1785433862534-2026-08-24` (no tocada) → aparecerá también el 24-ago.**
  - **3 sin tocar:** "Ver calificación de cuentas", "Veure situació Lucia per trucada", "verificar la presentación de las CCAA".
- **Recuento definitivo del cambio de aspecto (§0):** **25** contenedores (no ~21): 1 a pendiente ("Poner fechas varias
  laboral", confirmado), 24 a tachado (proyectos terminados). Lista completa por bloque entregada en el chat.

**✅ DECISIÓN TOMADA (sesión 17): "recurrencia ⇒ `task_type` core por defecto, pero EDITABLE".** El default implícito se
queda (repetitiva = core, `TaskModal.tsx:302` + `task_type || 'core'`), y el tipo **es editable** en fila y modal
(`TaskTypeChip` no tiene lógica de disabled/readonly) y **persiste** (`onUpdateTask({taskType})`; verificado: 4
contenedores con tipo≠core lo confirman). Ya NO es decisión abierta.

**VISTA DE CARGA (`WorkloadView`):** mira hacia atrás Y hacia delante. **Tres tramos:** pasado = `time_entries` reales;
presente = instancias materializadas (12 meses); futuro +12 meses = cálculo desde las plantillas. Filas = tareas,
columnas = meses (expandibles a semana/día). Capacidad **8h/día, 40h/semana** (solo laborables); color por % de carga.

### 16.16 MODELO: qué es un contenedor y qué es una regla — REGLA DEL MODELO, manda sobre las fases (CORREGIDO sesión 18)

**PREMISA CORREGIDA (dictado por la usuaria, sesión 18):** ser contenedor **NO es un estado guardado**: es una
**CONSECUENCIA de tener hijas**. Una tarea no *se crea* contenedor; se **hace** contenedor cuando se le pone una hija
debajo y **deja** de serlo cuando se le quita la última. No hay marca que guardar ni conversión que ejecutar —
**exactamente igual que el completado del contenedor se DERIVA y nunca se lee de su campo guardado.** Es el mismo
principio; en la sesión 17 se nos escapó y se construyó una "degradación" que revertía una conversión que nunca ocurría.

**Qué significa `isTemplate:true` (y qué NO):** marca una **REGLA recurrente** (genera instancias de sí misma) O, como
**LLAVE DEL MOTOR**, un **contenedor que ALOJA reglas recurrentes** (para que `materializeDay`/`generateInstances`
desciendan a generar las instancias de sus hijas — el motor solo procesa `isTemplate===true`, [utils.ts:85](utils.ts)).
**`isTemplate` NUNCA significa "esto es un contenedor".** "Contenedor" se deriva SIEMPRE de tener hijas
(`subtasks.length>0`): [filters.ts:217](filters.ts), [BlocksView.tsx:196](BlocksView.tsx),
`hasSubtasks` [TaskCard.tsx:129](TaskCard.tsx).

**Un CONTENEDOR NO tiene** (todo derivado o ignorado): recurrencia propia · fecha · tiempo propio (su tiempo = **suma de
las hijas**) · etiqueta propia · prioridad · play/registro manual · **estado de completado propio (su `status` guardado
NO se lee mientras tenga hijas)** · contenedores dentro (**jerarquía de 2 niveles**, `0c6baf6`).
**Un CONTENEDOR SÍ tiene:** título · bloque · tipo (core / no core) · hijas.

**Completado = DERIVADO:** con día → hijas de ESE día; sin día (Bloques) → todas. Clicar su casilla completa las
**hijas del día**, no al contenedor (hoy contradictorio: el visto va por día pero el clic cierra cualquier fecha; se
cierra en (c), §16.12).

**CICLO DE VIDA — no hay degradación (CORREGIDO sesión 18, `2dbada5`):** vaciar un contenedor **no dispara ninguna
conversión**. Al borrar la última hija, `parent.subtasks` se vacía y **la tarea deja de agruparse como contenedor sola**,
porque todas las vistas derivan de `subtasks.length`. Se **ELIMINÓ** la maquinaria de degradación de la sesión 17
(`shouldDegradeToNormal`, `containerOfChild`, `containerDegradeAfterDelete` + llamadas en `handleDeleteTask` y
`bulkDeleteTasks` + toast + 9 tests). **Por qué sobraba:** estaba bloqueada en `isTemplate:true`, así que **NUNCA se
disparaba para los 75 contenedores manuales (de 98)** — era estructuralmente incapaz de arreglar el bug reportado. Ese
fue el patrón de los "tres cerrados que no funcionaban" (`71f499f`, `7e52d88`): probaban una forma (`isTemplate:true`)
que casi no existe en los datos.

**🔑 CAUSA CONFIRMADA del síntoma reportado — caso (a), DATOS, validado en pantalla por la usuaria (sesión 18):** al
borrar la última hija, **el vaciado visual funciona bien** (subtasks se vacía, el render deriva). Lo que la usuaria vio
—"la tarea seguía tachada"— es el **fallback a HOJA con `status` viejo**: sin hijas, `hasSubtasks` pasa a `false`
([TaskCard.tsx:129](TaskCard.tsx)) → la fila se pinta **como HOJA** y una hoja usa `rowCompleted = status==='completed'`.
Si el contenedor tenía `status:'completed'` guardado → **tachado**. **No es bug de render; es DATO viejo.**

**🔑 QUIÉN ESCRIBE ese `status:'completed'` en un contenedor (reportado sesión 18, NO arreglado):**
- **`handleToggleStatus` (el checkbox):** `toggleRecursive` escribe el status **propio del contenedor** además de recorrer
  las hijas ([useTaskCRUD.ts:137-149](useTaskCRUD.ts) + persist :217). Es la fuente principal.
- **Bulk-complete:** `bulkUpdateTasks({status:'completed'})` ([App.tsx:461](App.tsx), [BlocksView.tsx:430](BlocksView.tsx)).
- Es **campo muerto mientras tenga hijas** (nadie lo lee), pero es la **mina** que estalla al vaciar. Si el completado se
  deriva y nunca se lee, **nadie debería escribirlo**. Pendiente de decisión de la usuaria (no arreglado).

**CAMINOS DE BORRADO (el vaciado visual ya lo resuelve la derivación; queda UN cabo):**

| Camino | Función | Vaciado visual |
|---|---|---|
| Tarea/subtarea normal o **regla-hija** (fila `···` / modal) | `handleDeleteTaskRequest → handleDeleteTask` | **OK** — `handleDeleteTask` vacía `parent.subtasks` ([useTaskCRUD.ts:739](useTaskCRUD.ts)); el render deriva |
| **Lote** | `bulkDeleteTasks` | **OK** — mismo, por derivación |
| **Instancia recurrente** (fila → "¿este día?") | handler de App ([App.tsx:958](App.tsx)) | **N/A** — borrar UNA ocurrencia no vacía (la regla-hija permanece) |
| **Serie recurrente** ("toda la serie") | handler de App | **⚠️ CABO** — el handler **NO toca `parent.subtasks`**; si esa era la última hija, el contenedor puede seguir mostrándose como contenedor. Afecta a los 23 con reglas. Abierto |

**BORRADO DE UNA SERIE = CORTARLA EN EL TIEMPO (dictado por la usuaria, sesión 17):** una regla recurrente **NO se
borra, se corta**. **Hacia delante:** deja de generar ocurrencias (pone fecha fin). **Hacia atrás:** las instancias ya
generadas **se mantienen ÍNTEGRAS**; son **hechos consumados y no se tocan NUNCA**. Si la regla se crea y se corta **el
mismo día**, no hay pasado que conservar → *parece* que se borra entera, pero es **la misma operación**. **Poner fecha
fin desde el editor es esa misma operación por otro camino.** El botón "borrar la serie" describe mal la acción (la
termina, no la borra) → renombrar, FASE 6 (§16.17).

**CIERRES DE MODELO:** invariante cableado como **aviso** en `handleUpdateTask` (`validateTemplate` + `toast.warn`,
`4de1ca1`); `validateTemplate` **reescrito** (`308a935`, sesión 18): un contenedor **SÍ puede alojar reglas** — solo son
incoherentes *pauta propia + hijas* y *plantilla inerte* (ni pauta propia ni hijas). Fix del **modal** (`4bfa51d`);
**tests de campo muerto** (`da8481e`). Tests del modelo tras sesión 18: **77 verdes, 1 rojo** (`reconcileDay` STUB, (c)).

**RECUENTO REAL DEL MODELO (medición sesión 18, 2026-08-13; paginado 2827 filas / 2071 vivas; SOLO LECTURA):**
- **98 CONTENEDORES REALES** (tarea con ≥1 hija viva por `parent_task_id`) = **75 sin marca** (`isTemplate:false`) +
  **23 con marca** (`isTemplate:true`, **todas alojan hijas recurrentes** → la marca es la llave del motor, no "estado").
- **101 reglas puras** (pauta propia, sin hijas).
- **6 contenedores con `status:'completed'` guardado** (la mina del fallback-a-hoja): "Lluis Corbera Bankinter",
  "Salmerón ver opciones", "Ivan Transporte", "Pagos Trimestrales", "Poner fechas varias laboral", "Tema De Anna
  Cardona". Normalizar a `pending` = bloque 2 (pendiente de OK de la usuaria).
- **⚠️ POR QUÉ EL "23 contenedores legítimos" DEL RECUENTO ANTERIOR ERA ENGAÑOSO:** medía las **plantillas marcadas**
  (`isTemplate:true` con hijas) — es decir, los contenedores-que-alojan-reglas — **NO los contenedores**. Coincide
  exactamente (23) porque es el mismo censo mal etiquetado. **El número real de contenedores es 98, no 23.** El criterio
  "plantilla = contenedor" era la premisa equivocada; el correcto es "tiene ≥1 hija viva", con o sin marca.
- **"9 ROTAS" (filas de datos) reclasificadas bajo el modelo corregido — bloque 4, sesión 18:** son filas
  `is_template:true` + sin pauta propia + sin hijas vivas. Quedan **7** (2 ya recuperadas en auditoría). Bajo el modelo
  corregido **todas son PLANTILLAS INERTES** (la marca no genera ni agrupa nada; `validateTemplate` las marca). **La
  "premisa mala" NO cambia que estén rotas — cambia su ETIQUETA:** el recuento anterior las llamó "contenedores vaciados
  sin degradar", concepto que ya no existe (no hay degradación; una tarea sin hijas simplemente no es contenedor). El
  arreglo real no es degradar: es **quitarles la marca** (vuelven a tarea normal y reaparecen en Mi Día). Clasificación:
  **1** es instancia ascendida por el bug del picker (`inst-t-1778162405700-2026-05-08` "Gestión campaña", `template_id`
  puesto); **6** son filas normales con marca espuria ("Possible reunió Candidata", "Publicar propias…", "Veure situació
  Lucia" [completed+fecha], "Veure feed Back clara…", "verificar la presentación de las CCAA", "Ver calificación de
  cuentas"). **Todas → limpieza FASE 4 (§16.17). No tocar ahora.**
- **Rojas de TEST (distinto de las rotas de datos):** la batería tiene **1 sola roja** (`reconcileDay` STUB, (c)). No hubo
  nunca 9 tests rojos; los 9 tests de degradación eran VERDES probando la forma minoritaria (`isTemplate:true`) y se
  quitaron en el bloque 1.

**Campos que el contenedor GUARDA pero IGNORA (comprobado en código + GARANTIZADO por test `da8481e`):**
- **Estimado propio:** WRITTEN pero IGNORADO — el chip es `readonly` para contenedores y su `onChange` solo escribe si
  `!hasSubtasks` ([TaskCard.tsx:569-576](TaskCard.tsx)); lo mostrado = suma de hijas. Los 2 con estimado propio = resto
  histórico invisible.
- **Etiquetas propias:** WRITTEN pero IGNORADAS — el chip de etiqueta no se pinta para contenedores
  ([TaskCard.tsx:699-701](TaskCard.tsx)); la agrupación por tag usa las etiquetas de las HIJAS.
- **Registrado propio:** IGNORADO — `containerRegisteredForDay` no cuenta el tiempo sobre el propio contenedor.
- **Status propio:** IGNORADO **mientras tenga hijas** (el completado se DERIVA, `isContainerCompleteOnDay`), pero
  `handleToggleStatus`/bulk-complete **sí lo escriben** → es la mina del fallback-a-hoja al vaciar (ver arriba). A
  diferencia de los otros 3, **NO está guardado por test** y **sí hay quien lo escribe**; pendiente de decisión.
- (Los 3 tests de campo muerto se ponen ROJOS si alguien vuelve a leer el estimado/registrado/etiquetas propios; los datos NO se borran.)

**COBERTURA DE TESTS — qué está PROBADO de verdad y qué se dio por probado (bloque 5, sesión 18; antes de (c)):**
- ✅ **PROBADO en la forma REAL** (`isTemplate:false`, la mayoría — 75 de 98): principio (a) totales por día (2 tests) ·
  principio (b) completado derivado, incl. la trampa "status:'completed' guardado CON hijas → no se lee" (7 tests) ·
  (b4) campos muertos estimado/registrado/etiquetas (3 tests). La DERIVACIÓN de (a) y (b) está bien cubierta.
- ❌ **NO probado, y es justo el caso (a):** la transición **contenedor vaciado → hoja → se lee su `status`**. **Ningún
  test** afirma "un contenedor vaciado NO sale tachado". Los tests (b4) cubren estimado/registrado/etiquetas pero **no el
  `status`** ni el caso sin hijas. Es el hueco que provocó lo que la usuaria vio.
- ❌ **Los 9 tests de degradación (ya quitados)** construían el contenedor como `isTemplate:true` (la forma minoritaria,
  23 de 98) → verdes probando algo que casi no existe, y mudos en la mayoría manual. Ejemplo de "dado por probado".
- ❌ **Sin cobertura:** un contenedor con hija RECURRENTE atravesando el vaciado / el borrado de serie por el handler de
  App (el "cabo" de la tabla de borrado). El camino real de recurrentes nunca se prueba aquí.
- **Recomendación antes de (c):** o se **normaliza el dato** (bloque 2) o se **arregla el fallback-a-hoja** (una ex-tarea
  sin hijas no debería leer un `status` viejo de cuando era contenedor) y se añade un test en la forma `isTemplate:false`.

**🎯 COBERTURA POST-FASE 3 — PRIORIZADA POR RIESGO (bloque 3, cierre sesión 18; 95 verdes / 0 rojos). Qué falta, de más a menos peligroso:**
- **🔴 ALTO — el camino real del toggle `handleToggleStatus` (el hook entero) NO tiene test.** Toda la lógica de C1/C2
  (rama por tipo de contenedor, dirección por día, selección de hijas del día → upsert) se prueba SOLO por los helpers
  puros (`materializeDay`, `childrenToToggleOnDay`, `writesOwnStatusOnToggle`, `isCompletedForDay`), NO por el hook. **Los
  2 bugs de C1 estaban justo en esa capa** (detección de contenedor + rama por plantilla en la instancia renderizada).
  Es el patrón §16.14 (helper verde, camino real sin probar) y es el WRITE path → un bug toca datos reales. La usuaria
  valida el clic a mano mañana, pero no hay guarda automática. **Recomendación: test del hook (renderHook o extraer la
  selección a un helper puro `containerDayChildrenToToggle` y testear los 2 tipos + dirección + desmarcado).**
- **🟠 MEDIO — `filterTasksForDay` sin test directo:** la rama de lookup de plantilla (155-157, el riesgo 1 de C3) y la de
  contenedor sin fecha (174-184). Solo se ejerce indirecto vía `groupTasksByTag`.
- **🟠 MEDIO — `bulkUpdateTasks` (cascada de status a hijas, `0bc1502`)** y el **cableado de C3** (`activeDayMap =
  reconcileDay`): `reconcileDay` tiene test como helper, pero el cableado solo se verificó en la app una vez (0 filas
  desaparecen), sin test automático. `bulkUpdateTasks` sin test.
- **🟡 BAJO — tapón de confirmación** (TaskCard onClick: nº de subtareas, mensaje "de este día" vs "todos", `confirm`),
  **C4** (`defaultDate` del picker), **cableado (b3) en DashboardView** — verificados en pantalla/uso, sin test unitario.
- **Nota:** lo bien cubierto (helpers, forma real `isTemplate:false`): (a) totales, (b) completado derivado, (b4) campos
  muertos, `isCompletedForDay`, `reconcileDay`, `writesOwnStatusOnToggle`, y la SELECCIÓN día-scoped de C1 (mixto vía
  materializeDay + manual vía childrenToToggleOnDay). El hueco es siempre el mismo: **la integración en hooks/componentes.**

**REPASO COMPLETO DE COBERTURA (bloque 4, sesión 18) — 4 ficheros, 90 verdes / 0 rojos. Qué NO se prueba:**
- **Forma MINORITARIA (`isTemplate:true`) — dónde es legítima y dónde no:**
  - `instanceEngine.test.ts` (occursOn/materializeDay/resolve*): fixtures `t-cont`/`t-child` con `isTemplate:true`. **Es
    CORRECTO** — el motor SOLO procesa `isTemplate:true`; testearlo con plantillas es su dominio, no la trampa minoritaria.
  - `validateTemplate` (b3): `isTemplate:true` por fuerza (va de la marca). Legítimo.
- **NO probado EN ABSOLUTO (los huecos reales):**
  1. **El camino real del toggle — `handleToggleStatus`/`toggleRecursive`.** Solo está probado el HELPER puro
     `writesOwnStatusOnToggle`; el hook que lo llama (que al clicar un contenedor escribe las HIJAS y no el contenedor, y
     que deriva la dirección) **no tiene test**. Es EXACTAMENTE el patrón "helper verde, camino real sin probar" (§16.14).
  2. **`bulkUpdateTasks`** (cascada de status a hijas, arreglada en `0bc1502`) — sin test.
  3. **El tapón de confirmación** (casilla de contenedor, nº de subtareas, `424d7ac`) — sin test (UI/`confirm`).
  4. **C4** (`defaultDate` del picker) — sin test unitario; validado en pantalla por la usuaria (modal).
  5. **`filterTasksForDay`** — sin test DIRECTO, incl. la rama de lookup de plantilla (155-157, el riesgo 1 de C3) y la
     rama de contenedor sin fecha (174-184). Solo se ejerce indirecto vía `groupTasksByTag`.
  6. **`getVisibleSubtasksForDay`** — sin test directo.
  7. **(b3) cableado en `DashboardView`** (`isCompletedForDay` en el filtro 147): el helper sí, el componente no.
  8. **C2 — hija huérfana ESCONDIDA** (movida, `parent_task_id=null`, contenedor no materializado ese día): el motor
     prueba "contenedor/instancia MOVIDA" pero **no** el caso de la hija que cae entre dos sillas. Sin cobertura.
  9. **`reconcileDay` cableado**: la función tiene test, pero **no está cableada** (opción B) → el comportamiento real
     (activeDayMap sin fuga) no se prueba hasta que se cablee.
- **Dado por CERRADO con hueco de test:**
  - **(a):** la derivación de totales está probada; el **cableado en TaskCard** (`dayForTotals`) no.
  - **(b1)/(b2):** la derivación del completado está probada; el **toggle que ESCRIBE** el completado (#1) y el **render**
    `rowCompleted` en la transición vaciado→hoja no.
  - **(b3):** `isCompletedForDay` probado; el filtro real de Mi Día (#7) no.

**🔴 CASCADA DE COMPLETADO — daño en datos, hallazgo sesión 18 (2026-08-13/14):** clicar el checkbox de un contenedor
marca **el contenedor Y TODAS sus hijas de TODOS los días** de golpe (`handleToggleStatus`→`toggleRecursive` recorre
`subtasks` sin filtrar por día). Conducta viva desde hace **meses**. Marca como completadas hijas que **no** estaban
hechas → **trabajo abierto que aparece como hecho**.
- **FIRMA EN DATOS:** las hijas de un mismo padre con `completed_at` **idéntico al milisegundo** = marcadas juntas por una
  cascada (una acción, un `timestamp`). Ejemplo de referencia: "Tema De Anna Cardona" (`t-1786466725521`), 6 hijas todas
  `2026-08-13T16:17:30.007`; 4 estaban pendientes de verdad, 2 hechas.
- **NO SE PUEDE DISTINGUIR LO FALSO DE LO REAL POR DATOS:** la cascada re-sella a todas por igual → `completed_at`
  idéntico; `actual_minutes=0`, sin time_entries, sin notas en las 6. **La única fuente de verdad es la usuaria.**
- **ALCANCE (medido, SUELO no techo):** **38 hijas en 7 contenedores** con la huella (Salmerón 10, Tema 6, Ivan 5, Cierre
  Propias 3, Selecció RRHH/Montse Vidal/Lineas de vida en grupos de 2, algunos **duplicados**). Fechas: **mayo→agosto
  2026**. Es SUELO: **una cascada de una sola hija NO deja huella** (no hay dos `completed_at` iguales que comparar), así
  que puede haber más falsos completados no detectables.
- **NO lo causó el código de la sesión 18** (la conducta es de meses). Pero **normalizar los 6 padres (bloque 2) SACÓ el
  daño a la luz**: un contenedor con status propio `completed` se ocultaba en Bloques (el contador usa el status propio);
  al ponerlo `pending` reapareció con sus hijas tachadas.
- **GRIFO — TAPÓN APLICADO (`424d7ac`, sesión 18):** clicar la casilla de un contenedor ahora **pide confirmación**
  mostrando cuántas subtareas va a completar/marcar-pendientes ([TaskCard.tsx:445](TaskCard.tsx)). No cambia la lógica ni
  materializa nada; corta el daño en el punto exacto (acción masiva sin aviso). El **"solo las hijas del día"** correcto
  sigue siendo **(c)**: `handleToggleStatus` es compartido con un único `activeDate` (no el día de la vista); el checkbox
  existe también en Bloques (día-less, ahí debe ser todas); Semana/Calendario tienen día por celda; y las hijas recurrentes
  del día hay que materializarlas. *(Se descartó el provisional "no cascar a futuras": no cubría el caso real de la usuaria
  —las 6 de Anna eran de hoy y pendientes— y metía una regla sutil.)*
- **REVERSIÓN HECHA (sesión 18) — 22 hijas a `pending`+`completed_at:null`, POR CRITERIO DE LA USUARIA, no por dato**
  (los datos no distinguían falso de real): Salmerón (10), Ivan (5), Cierre Propias (3), Tema De Anna (4 de 6 —se dejaron
  "Comentar con ella posibilidades" y "Hacer seguimiento despido de Veiga", hechas de verdad). **NO se tocaron** Selecció
  RRHH, Montse Vidal ni Lineas de vida (grupos pequeños de may-jun donde la cascada pudo coincidir con la realidad;
  además con duplicados). Padres implicados verificados coherentes (todos `pending`).
- **✅ RESUELTO (criterio de la usuaria, sin dato que lo respalde): Lluis Corbera y Pagos Trimestrales se DEJAN como
  están.** Cada uno tiene 1 sola hija completada —"Reunió Dilluns 11-5 Confirmada" (Lluis, fecha 2026-05-11) y "Autorizar
  traspasos para pagos de impuestos" (Pagos, fecha 2026-07-17)—; una cascada de 1 hija no deja huella detectable, así que
  el dato no distingue si fueron reales o falsas. La usuaria decide que **parecen hechas de verdad** → no se tocan. Queda
  cerrado por su criterio, no por evidencia en los datos.
- **🪤 TRAMPA (que volverá): el `completed_at` NO es criterio de pertenencia; el PADRE sí.** Al sacar las 3 de "Cierre
  Propias" por su `completed_at`, el filtro barrió **7 instancias recurrentes** (`inst-…`, `parent=null`) completadas en el
  mismo segundo pero de OTRA plantilla. Filtrar por timestamp mezcla cosas que solo comparten el momento. **Seleccionar
  siempre por `parent_task_id` (pertenencia), usar el timestamp solo como firma de "marcadas juntas".**

**⚠️ LECCIÓN DE MÉTODO (sesión 18):** normalizar los 6 padres fue **atacar la capa equivocada**. El `status` propio del
contenedor es **campo muerto mientras tenga hijas** (el completado se DERIVA de las hijas), así que tocarlo no cambió el
tachado —que sale de las hijas—. **Antes de limpiar un dato, comprobar en qué CAPA se lee de verdad** (aquí: se leía de
las hijas, no del campo del padre). Misma familia que el "status guardado que no se lee" del §16.10.

**ABIERTO — fase por asignar:**
- **🔑 MOVER UN CONTENEDOR NO SE LLEVA SUS HIJAS (hallazgo sesión 18, causa raíz de las huérfanas *vacated*):** al mover
  la instancia de un contenedor de día A→B (excepción `instanceDate=A, dueDate=B`), sus hijas de A **se quedan en A** como
  huérfanas (`parent_task_id=null`, su contenedor ya no se materializa en A) → invisibles. Es lo que creó el caso de
  "Cierre Propias" 07-22 y **volverá a pasar cada vez que se mueva un contenedor con hijas ese día**.
  **Impresión de tamaño: MEDIO.** No es un one-liner: el handler de mover (App recurrence / `handleUpdateTask`) tendría
  que, al mover un contenedor-día, **arrastrar las hijas resueltas de ese día al día destino** (crear/actualizar sus
  excepciones a `dueDate=B`). Está en la zona frágil del motor de recurrencia (excepciones/materialización), pero acotado
  (enumerar las hijas del día + re-datar). **Ubicación sugerida: junto a C1/C2 en FASE 3 (c)** o un mini-bloque de
  "mover recurrentes" propio; no es diseño (FASE 6), es motor.
- **Optimización del DESMARCADO (fuera de C1, decisión sesión 18):** al desmarcar una hija recurrente, en vez de dejar la
  excepción en `pending` (idéntica al default derivado → fila redundante), **borrar la excepción** y volver a virtual. No
  baja el volumen de completadas (esas son historial que la usuaria quiere conservar), pero evita acumular filas `pending`
  basura (parte de las 32 huérfanas pendientes salió de esto). Tamaño PEQUEÑO (rama en el path de uncomplete). Independiente
  de C1.
- **Limpieza periódica de completadas viejas (si algún día hace falta):** ~150 filas-excepción/mes de ocurrencias
  completadas (histórico, se conserva a propósito). Si el volumen molesta a largo plazo, una purga por antigüedad (p.ej.
  completadas > N meses) en FASE 4, NUNCA dejar de escribir el completado (se perdería el rastro). Sin prioridad.
- **Contador vs tachado con criterios distintos (hallazgo sesión 18):** en Bloques el contador de cabecera
  (`coreTasks+adhocTasks`, [BlocksView.tsx:250](BlocksView.tsx)) cuenta tareas top-level por su **status PROPIO**
  (`hideCompleted && status==='completed'`), sin contar hijas y sin derivar; el **tachado** de la fila se **DERIVA** de las
  hijas ([TaskCard.tsx:251](TaskCard.tsx)). Por eso se ve "1 tarea" con 7 filas todas tachadas. Unificar criterio. No es
  urgente; no tocar ahora.
- **Grifo "clic contenedor = solo hijas del día": ✅ CERRADO por C1 (`f073ed5`) en Mi Día.** El tapón de confirmación se
  MANTIENE (decisión de la usuaria: lo retira ella tras verlo funcionar). **Cabo pendiente:** Semana/Calendario no enhebran
  su día de celda al toggle → ahí el clic aún togglea todas las hijas (viewDay undefined). Menor; enhebrar `date` de la
  celda a `onToggle` cuando se retomen esas vistas. Sin prioridad.
- **Vista de Carga proyecta 12 meses desde plantillas.** Si el contenedor no tiene fecha ni estimado propio, en Carga
  solo puede entrar por la **suma de sus hijas**. **Comprobar que no se proyecta dos veces (contenedor + hijas) ni
  desaparece.** No tocar ahora.

**✅ DECISIÓN TOMADA (sesión 17):** el default "recurrencia ⇒ core" **también aplica al CONTENEDOR**, pero su tipo es
**EDITABLE y persiste** igual que cualquier tarea (4 contenedores con tipo≠core lo confirman). Ya NO es decisión abierta.

### 16.17 APARCADO POR FASE (origen: fin sesión 17)

> ⚠️ **NOTA (sesión 19): esta cabecera quedó STALE.** El "se acabó la excavación / no arreglar nada más / el siguiente
> bloque es (b3)" era el modo de la sesión 17. Desde entonces se cerró FASE 3 (b1/b2/b3/C1-C4), se ejecutó y CERRÓ FASE 4
> (§16.20), y se arreglaron varios bugs (mixto, mover contenedores, tapón, useBulkActions, #18, #21). El estado vigente y
> el punto de retomada están en **§16.19 (inventario), §16.20 (FASE 4 cerrada) y §16.21 (FASE 5/6)**. Lo de abajo se
> conserva como registro por fase; donde diga "pendiente/aparcado", contrástalo con esas tres secciones.

**Modo (histórico, sesión 17):** se terminó la excavación; cada cosa aparcada en su fase. *(El "siguiente bloque es (b3)"
ya se completó hace tiempo.)*

- **FASE 3 (c):** **(b3) YA HECHO** (`ff4643b`, filtro por día en Mi Día). Pendiente **(c)** reconciliación sin fuga
  (`reconcileDay`, test rojo) con la contradicción del clic, el síntoma del 30-jul, el toggle "solo el día" y la fecha de
  inicio de recurrencia (§16.12). *(La degradación de la sesión 17 se ELIMINÓ en la 18, `2dbada5`: no había conversión.)*
- **FASE 4 — EJECUCIÓN PARCIAL sesión 19 (2026-08-15, autónoma). Criterio: medido + REVERSIBLE = ejecuto;
  irreversible o pendiente-trabajo-real = APARCO. Toda escritura fue REVERSIBLE (nunca hard-delete): unmark o
  `is_deleted:true` (se deshace con `is_deleted:false`). Re-medido hoy: G1=7 rotas (mismos ids), G3=64 (41 completadas
  + 23 pendientes), G4 sigue viva y PENDIENTE.**
  - **HECHO (G1 · 6 unmarks):** `is_template=false` en las 6 rotas reales `t-…` (`t-1778163662763`, `t-1778695119129`,
    `t-1779785165667`, `t-1781110025441`, `t-1785430294429`, `t-1785430306417`) → reaparecen como tarea normal. Reversible.
    **HALLAZGO al ejecutar:** estas 6 NO eran plantillas inertes puras — eran **series recurrentes RETIRADAS** (sin
    `recurrence.frequency` viva, pero con **63 instancias legacy COMPLETADAS** apuntándolas por `template_id`: 21+2+20+19+1+0,
    **0 pendientes**). El criterio de "rota" (sin pauta + sin hijas por `parent_task_id`) tenía un punto ciego: no miraba
    instancias por `template_id`. Consecuencia inofensiva: al hacerlas normales, esas 63 completadas pasan a ser G3
    (`template_id→no-plantilla`) — por eso G3 subió 64→86. Todas completadas → se pintan una vez en días pasados, no
    regeneran, no molestan. Las 2 con fecha futura/reciente (`t-1785430294429` due 08-10, `t-1785430306417` due 08-24)
    reaparecen como pendientes = el trabajo real que se buscaba recuperar. **Reversible** (volver a `is_template=true`).
  - **HECHO (G1 · phantom):** `inst-t-1778162405700-2026-05-08` ("Gestión campaña", instancia ascendida) → `is_deleted:true`
    (soft-delete reversible, en vez del hard-delete del plan).
  - **HECHO (G3 · 41 completadas):** soft-delete (`is_deleted:true`) de las 41 filas `template_id→no-plantilla` con
    `status='completed'` que existían ANTES del unmark. Verificado antes: NINGUNA tenía hijas vivas pendientes (0) → no
    orfana nada. Reversible; el histórico se conserva (la fila existe, restaurable). Deflaciona conteos sin pérdida.
    (Las 63 nuevas G3-completadas que aparecieron por el unmark NO se tocaron; son la historia de las series retiradas —
    todas completadas, 0 pendientes. Si molestan en conteos, soft-delete reversible con el mismo criterio; lo dejo a tu
    decisión por ser historial.)
  - **HECHO (G3 · 23 pendientes → 16 soft-deleted) — decisión de la usuaria (2026-08-15 tarde).** Clasificadas por si
    tocaban una REGLA viva (ninguna: las 23 tenían `reglaViva=false`, así que borrar la fila nunca toca una serie):
    · **17 "huérfanas" (plantilla ausente)** = filas sueltas sin regla detrás, casi todas basura de test ("tarea repe
    sola", "fdad", "preuba de recurrente", "B Bancos/Ingressos/Margenes", "Sub T3", "Recibir pagos Bego") → **soft-delete
    directo** (reversible). De estas, **1 saltada** por seguridad: `inst-t-1778012355951-2026-05-05` ("Prueba recurrente…")
    tiene 1 hija viva → no la borro para no orfanarla (queda aparcada). Y otra ya estaba ausente. **Netas: 15 huérfanas.**
    · **G4** `inst-t-1785433862534-2026-08-24` → **soft-delete** (item 2 aprobado). **Total soft-deleted hoy: 16.**
  - **APARCADO (5 "inst→tarea-normal") — VERIFICADO (item 2, sesión 19). En las 5, borrar la ocurrencia NO toca su tarea
    real (son filas distintas).** Estado de cada tarea real (para que decidas):
    1. **"comentar Blai PPV"** `inst-inst-inst-t-1781192525690-…-2026-07-10` (due 08-10) → cadena de leak; queda VIVA una
       fila pendiente a 06-23 (`inst-inst-t-1781192525690-…-06-23`, bloque activo). Borrar la del 08-10 = seguro.
    2. **"Publicar a coordinadores"** `inst-inst-t-1778694774705-2026-07-10-2026-07-13` → su base `t-1778694774705` es una
       **PLANTILLA** viva (isTemplate:true, la maquinaria, no una tarea visible). Borrar la ocurrencia = seguro.
    3. **"Linia de vida"** `inst-inst-t-1780486425092-2026-06-15-2026-07-13` → su base `t-1780486425092` ya está **BORRADA**
       → es un huérfano de tarea muerta. Borrar = claramente seguro (no hay tarea real detrás).
    4. **"Hacer Renta Montse Barber"** `inst-t-1780559218671-2026-06-22` → tarea real `t-1780559218671` **VIVA y VISIBLE**
       (subtarea, bloque activo). Borrar la ocurrencia = seguro, la tarea real se queda.
    5. **"Hacer Renta Rosa Cambronero"** `inst-t-1780559279008-ekfud7gx1-2026-06-22` → tarea real **VIVA y VISIBLE**.
       Borrar la ocurrencia = seguro, la tarea real se queda.
    **Resumen: las 5 son borrables sin perder trabajo real.** ✅ **HECHO (soft-delete reversible de las 5, aprobado por la
    usuaria; `scratchpad/item2-cinco.mjs`).** Con esto G3 queda cerrada salvo lo que la usuaria decida sobre el colapso.
  - **CERRADO (G2 · Soriano) — decisión de la usuaria: las dos se quedan.** `t-1778161643849` y `t-1778576136973` NO son
    duplicados: cada una tiene su información. **LECCIÓN de criterio:** "mismo título + mismo bloque" **no basta** para
    detectar duplicados — la usuaria tiene tareas legítimas que se llaman igual. El detector de dups (G2, `fase4-plan.mjs`
    grupo 2a/2b) da falsos positivos por eso; cualquier futura búsqueda de duplicados necesita más señal (hijas, tiempo,
    notas), no solo título+bloque. G2 no se vuelve a mirar salvo que la usuaria lo pida.
  - **Estado FASE 4:** cerrada salvo lo que la usuaria dejó explícito → 5 "inst→tarea-normal" aparcadas + la huérfana con
    hija viva. G1/G3-completadas/G3-pendientes-huérfanas/G4 hechas; G2 cerrada por decisión.
  - *(Plan medido original abajo, intacto, como referencia.)*
- **FASE 4 — ⚠️ este PLAN ya se EJECUTÓ y CERRÓ (ver §16.20 y el bloque "EJECUCIÓN PARCIAL" arriba). Lo de abajo es el plan
  ORIGINAL de la sesión 18 (SOLO LECTURA entonces), conservado como referencia; NO refleja el estado actual.**
- **FASE 4 (persistencia y limpieza legada) — PLAN MEDIDO sesión 18, RE-CONFIRMADO al cierre (SOLO LECTURA, nada
  ejecutado; para aprobar de un vistazo). Números re-medidos hoy: IDÉNTICOS — G1=7 rotas (mismos ids), G2=1 grupo real
  (Soriano), G3=64 (`inst-inst-`=29), G4=la suelta sigue viva (`inst-t-1785433862534-2026-08-24`, pending, due 08-24).
  Los cambios de datos de la sesión (reversión 22 · normalización 6 · completar 2) NO afectaron a estos grupos.**

  **G1 · 7 plantillas rotas** (`is_template:true`, sin pauta propia, sin hijas vivas → invisibles en Mi Día por el filtro
  `!isTemplate`). IDs: `inst-t-1778162405700-2026-05-08` ("Gestión campaña", forma inst = ascendida por bug picker) ·
  `t-1778163662763` ("Possible reunió Candidata") · `t-1778695119129` ("Publicar propias…") · `t-1779785165667` ("Veure
  situació Lucia", due 06-23) · `t-1781110025441` ("Veure feed Back clara…") · `t-1785430294429` ("verificar CCAA", due
  08-10) · `t-1785430306417` ("Ver calificación de cuentas", due 08-24).
  - **Cambio propuesto:** `is_template=false` (quitar la marca espuria) → vuelven a tarea normal y REAPARECEN. La de forma
    `inst-…` ("Gestión campaña") mejor **borrarla** (es una instancia ascendida, no una tarea real).
  - **Riesgo:** bajo. Reaparecen tareas que estaban ocultas (las 3 con fecha son trabajo real perdido de vista).
  - **Si no se hace:** siguen invisibles = trabajo escondido; `validateTemplate` las marca como inertes.

  **G2 · Duplicados — SOLO 1 grupo real** (el doc decía "5+2"; medido: 2a=1, 2b=0). "Soriano" en bloque b3:
  `t-1778161643849` y `t-1778576136973`.
  - **Cambio propuesto:** decidir cuál es la buena y borrar/fusionar la otra. **Necesita tu criterio** (mirar cuál tiene
    hijas/tiempo). No propongo cuál sin que lo veas.
  - **Riesgo:** medio si se elige mal. **Si no se hace:** dos "Soriano" en b3, confuso.

  **G3 · `template_id` apunta a algo que NO es plantilla** — medido **64** (no 45; **29** son `inst-inst-…`, doble-leak).
  Son ocurrencias materializadas cuya "plantilla" es a su vez una instancia o ya no existe → basura del leak viejo, no
  regeneran.
  - **Cambio propuesto:** borrar, PERO **antes medir su `status`** — no borrar ninguna que sea pendiente y trabajo real.
    Empezar por las 29 `inst-inst-…` (las más claramente basura).
  - **Riesgo:** bajo si se filtra por completadas/borrables; **medio** si se borra a ciegas (podría haber alguna pendiente).
  - **Si no se hace:** inofensivas al render (se pintan una vez, sin regeneración) pero inflan conteos y consultas.

  **G4 · Instancia suelta `inst-t-1785433862534-2026-08-24`** ("Ënviar documentos firmados a auditores", **pending**,
  due 08-24). Su plantilla `t-1785433862534` ya es tarea normal (recuperada en auditoría). Es una ocurrencia huérfana.
  - **Cambio propuesto:** borrarla — el trabajo real vive en la tarea normal `t-1785433862534`. **Confirmar** que no es una
    ocurrencia que quieras conservar (está pendiente y con fecha futura).
  - **Riesgo:** bajo, pero es pendiente → si esa fecha 24-ago es trabajo real, no borrar. **Si no se hace:** una fila
    pendiente duplicada de la tarea recuperada.

  *(Todo por id arriba o con patrón medible; ninguna fila tocada. Números corregidos vs el doc viejo: dups 5+2 → 1+0;
  template_id-huérfano 45 → 64.)*
- **FASE 5 (creación) — el chip de recurrencia NO se puede usar desde la FILA (ni en Bloques NI en Mi Día); hay que abrir
  el MODAL** (corrige el alcance: estaba escrito como si fuera solo de Bloques). Surgió al pasar a la opción B (`ced422a`):
  la pauta se pone "en el editor". Desde la fila el chip se revela al pasar el ratón pero **no llega a poner la pauta**;
  desde el modal sí (y con C4 arranca en el día de la tarea). **Decidir** si en la fila debe poder ponerse (y, si sí, si
  en una regla recién creada el chip está siempre visible). **Es diseño, no bug — no cambia la prioridad, sigue el orden.**
- **FASE 6 (diseño):**
  - **Modal de la papelera de una fila recurrente (sin prioridad):** debe dejar CLARÍSIMO qué se borra ("este día" vs "la
    serie") y **avisar si hay hijas pendientes debajo** que se van a enterrar. Es el gesto que hoy suprime un contenedor
    entero sin avisar (§16.16, "supresión de contenedor"; el tapón B ya evita que entierre trabajo vivo, pero el modal
    sigue siendo confuso). Diseño, no bug.
  - El botón **"borrar la serie"** en realidad la **termina** (corta de ese día en adelante, conserva el histórico) →
    **el nombre no describe la acción**; renombrar. (Comportamiento en §16.16.)
  - **Aviso de la vista de Carga:** que un contenedor **no se proyecte dos veces** (contenedor + hijas) **ni desaparezca**
    (§16.16 abierto). Comprobar al rediseñar Carga.
  - **Calendario "Ir a fecha" de Mi Día no retrocede de mes (hallazgo sesión 18):** solo muestra el mes actual; para ir a
    julio hacen falta ~23 clics en la flecha de día anterior. Añadir navegación de mes (‹ mes ›). Sin prioridad.
  - **HALLAZGO DE PRODUCTO (sesión 19, item 5): "mover a fecha" en LOTE aplasta el `due_date` de TODO lo seleccionado.**
    No es un bug (la reprogramación en lote es útil y buscada), PERO si la selección incluye tareas **completadas de días
    distintos**, sobrescribe la fecha de cuándo se hicieron. Es la causa del colapso medido (§16.17: 116 filas, 76
    completadas; la historia real solo sobrevive porque `completed_at` la conserva en 75/76).
    - **Mi impresión / recomendación (para decidir):** más que un aviso, lo LIMPIO es que **"mover a fecha" NO toque el
      `due_date` de las tareas COMPLETADas** — mover al futuro algo ya hecho no tiene sentido y es justo lo que borra la
      historia; las PENDIENTES se mueven libremente (que es la intención real).
    - ✅ **IMPLEMENTADO (item 2, sesión 19, decisión de la usuaria):** guard en `bulkUpdateTasks` vía helper puro
      `bulkUpdatesForTask(updates, task)` (useBulkActions.ts): si la tarea está COMPLETADA y el update trae `dueDate`, se
      elimina `dueDate` del update (los demás campos sí se aplican). Aplicado en estado y en persistencia. +5 tests. Las
      pendientes se mueven libres. **Escape hatch (respuesta a "¿algún caso donde querría mover una completada?"):** mover
      UNA completada suelta desde su FILA (el move-picker → `handleUpdateTask`) **NO pasa por este guard** → sigue siendo
      posible a propósito; solo se bloquea el aplastamiento MASIVO. Si algún día quieres mover completadas en lote, habría
      que quitar el guard o añadir el aviso alternativo.
  - **MAPA — contenedor muestra hijas completadas "de otros días" (sesión 19, SOLO diagnóstico, NO tocado). TÚ DECIDES
    la política.**
    - **Dónde (la capa exacta):** `TaskCard.tsx:851` y `:860`. La lista de hijas que se pinta es
      `(subtasksForGroup || task.subtasks)` y el único filtro es el interruptor `hideCompleted` (líneas 852/862:
      `if (!hideCompleted) return true;` → con el interruptor APAGADO se pinta **toda** hija, completada incluida).
      · **Mi Día (Dashboard)** pasa `subtasksForGroup` = hijas DEL DÍA (`getVisibleSubtasksForDay` → `belongsToDay ===
      activeDate`, filtro por día en `filters.ts:89`). Por eso Mi Día **nunca** enseña hijas de otro día; solo las del día
      activo, y oculta completadas si el interruptor está encendido.
      · **Bloques (y cualquier vista con `subtasksForGroup=null`)** cae al fallback `task.subtasks` = **TODAS las hijas de
      TODOS los días**. Con el interruptor apagado, cada hija completada de cualquier día se pinta tachada. **Esta es la
      causa de "hijas completadas de otros días".** El contador (badge, `TaskCard:540-541`) cuenta pendientes de esa misma
      lista → en Bloques cuenta pendientes de todos los días.
    - **"Accidente Moussa" (`t-1783582412582`) — CORREGIDO (2026-08-15, mi diagnóstico de ayer estaba MAL).** Contenedor
      MANUAL, `due=null`, 12 hijas. Ayer dije "todas del mismo día, no es otros días" mirando solo `due_date`. La usuaria
      tenía razón: las hijas SÍ pertenecen a días distintos, pero el dato está **COLAPSADO** — las 12 tienen `due_date`
      idéntico (`2026-08-14`) mientras que su `completed_at` va del **22-jul al 14-ago** y su `created` del **9-jul al
      12-ago** (8 días de trabajo real distintos). Por eso "aparecen todas juntas": el render pinta cada hija en el día de
      su `due_date` (correcto), pero **todos los `due_date` son el mismo** → se apilan. **No es (solo) render: es DATO.**
    - **Patrón "due_date colapsado" (medido hoy):** **22 contenedores** tienen TODAS sus hijas con un `due_date` único pero
      trabajadas en varios días → **116 filas-hija**. **12 de esos 22 están colapsados al `2026-08-10`** (un evento masivo
      ese día — probablemente un re-fechado en bloque; a investigar por separado, no es este mapa). Ejemplos: "Accidente
      Moussa" (12 hijas/1 due/8 días), "Tarjeta transporte camión" (11/1/3), "Adrian Cross despido" (11/1/3), "Testamento
      Blas" (10/1/4). Este es un problema DISTINTO del multi-día de Bloques (41 contenedores, abajo): aquí el dato ya
      perdió el día de cada hija; allí el dato tiene los días pero Bloques no los respeta.
    - **CAUSA del colapso — INVESTIGADO (sesión 19, item 1). NO es el fix b2; es la acción "mover a fecha" en MASA.**
      Cluster de las 116 filas por `modified_at` exacto (mismo segundo = una sola escritura): `2026-07-31T18:12:37`→45
      filas (due 08-10) · `07-31T17:56:18`→11 (08-03) · `07-31T18:11:27`→11 (08-10) · `08-13T16:17:48`→11 (08-14) ·
      `07-31T07:51:14`→8 (08-10) · `08-14T05:06:31`→5 (07-29) · resto sueltas. **45 filas en un segundo = escritura por
      lote**, no 45 movimientos sueltos → es `bulkUpdateTasks({dueDate})` (el "mover a fecha" del modo selección). Al
      multiseleccionar y mover a una fecha, TODO lo seleccionado recibe ese `due_date`. Con HOJAS sueltas seleccionadas de
      varios días, sus días se aplastan al destino (bulkEffectiveIds no filtra por día una hoja seleccionada directamente);
      con un CONTENEDOR seleccionado, baja a sus hijas del día. **Mecanismo VIVO** (es la función de reprogramar en lote) y
      **de la usuaria, no automático**: descartado un re-fechador en carga — las dos reparaciones de `useSupabase`
      (`repairContainers*`) solo ponen `due_date:null` en plantillas, nunca sellan una fecha.
    - **DESCARGO del fix b2 (`a8f23d6`, "mover contenedor, opción A") — las dos preguntas de la usuaria:**
      · **(1) ¿b2 aplasta hijas de OTROS días?** NO. `childrenToMoveWithContainer` pasa CADA candidata por `onOldDay`
      (`(dueDate||instanceDate) === oldDate`, fase3Contracts.ts:220/227/231): solo viajan las hijas del día de ORIGEN; las
      de otros días no se tocan. No hay bug, no hay que revertir.
      · **(2) ¿Las filas del 10-ago son anteriores a b2?** SÍ, TODAS. b2 se publicó `2026-08-15 09:35:42`; todos los
      clusters de colapso son `07-31`/`08-11`/`08-13`/`08-14T05:06` → **anteriores**. El mecanismo es ANTIGUO (el "mover a
      fecha" en lote); b2 no lo causó. b2 solo REPITE, hacia delante y SOLO para el día de origen, que las hijas viajen con
      el padre (que es justo la opción A que pediste). *(Matiz honesto: `modified_at` marca la última escritura por
      cualquier motivo; el cluster `08-14T05:06`→due 07-29 huele a una escritura de status que solo tocó `modified_at`, no
      a un re-fechado; los re-fechados de verdad son los de 07-31.)*
    - **Para dejar de provocarlo:** al reprogramar en lote (modo selección → "mover a fecha"), ten en cuenta que aplasta el
      `due_date` de TODO lo seleccionado a esa fecha; si seleccionas hijas de días distintos, pierden su día. No es un bug
      del motor; es la acción haciendo lo que dice. (Aparte: valorar si seleccionar un CONTENEDOR debería arrastrar sus
      hijas del día al reprogramar — hoy sí lo hace.)
    - **¿Cuánta historia se perdió? — MEDIDO (item 2, sesión 19).** De las **116 filas colapsadas: 76 COMPLETADAS + 40
      PENDIENTES.** En las pendientes el colapso es inofensivo (reprogramar era la intención). En las completadas la fecha
      es historia — y **la historia se conserva en `completed_at`: 75 de las 76** tienen `completed_at` (66 con
      `completed_at` ≠ el sello colapsado → la fecha real de cuándo se hizo es RECUPERABLE). **Solo 1** completada no tiene
      `completed_at` (`t-1777366769600`, created 2026-04-28): ahí el día real se perdió sin remedio; único proxy = `created_at`.
      **Conclusión:** lo que "duele" (cuándo se hizo cada cosa) NO se perdió salvo en 1 fila; lo sobrescrito es el
      `due_date` planificado, menos valioso.
    - **DECIDIDO (usuaria, sesión 19): NO se descolapsa.** Razón: la historia real vive en `completed_at` (que es lo que
      importa); el `due_date` planificado de algo ya hecho no aporta. Re-fechar 75 filas sería riesgo sin premio. **Única
      fila irrecuperable (anotada por si algún día aparece):** `t-1777366769600` ("created 2026-04-28", due sellado
      2026-08-10) — completada SIN `completed_at`, su fecha real se perdió sin remedio; único proxy `created_at` (28-abr).
      Cerrado. Lo que evita que vuelva a pasar es el guard de "mover a fecha" (item 2, §16.18/abajo).
    - **La regla que quiere la usuaria:** "cada hija sale solo el día que le tocaba, completada o no". Alcanzarla NO es un
      cambio de render simple: el `due_date` por-hija ya está machacado (22 contenedores/116 filas) → habría que (a)
      recuperar el día real de cada hija (¿`completed_at`/`created`? decisión de la usuaria) y re-fechar, y ADEMÁS (b)
      día-scopear Bloques (opción b de abajo). Es DATO + RENDER. **Solo mapa; no lo toco.**
    - **Tamaño (medido hoy):** 75 contenedores vivos · **65** tienen ≥1 hija completada (**244** hijas completadas en
      total) · **41** tienen hijas repartidas en **varios días** (el caso "otros días" real en Bloques). Mayores:
      "cierre eam" (16 hijas/2 días/16 comp), "Guillem Tell" (18/5/15), "Marcos Ibáñez" (9/2/9), "Aragon contrato" (9/6/8).
    - **Qué cambiaría según decidas:** (a) *ocultar por defecto, ver a petición* → en `TaskCard:851/860` ocultar
      completadas aunque `hideCompleted` esté apagado, y añadir un "ver completadas (N)" por contenedor; (b) *día-scopear
      Bloques también* → pasar un `subtasksForGroup` filtrado por día en Bloques (cambia la semántica de Bloques, hoy
      atemporal); (c) *dejarlo* (es correcto si "mostrar completadas" significa "todas"). **No lo toco: es tu decisión de
      producto, y afecta a 65 contenedores.**

### 16.18 COBERTURA + AUDITORÍA DE CAMINOS DE ESCRITURA (sesión 19, bloques 4/6/7) — LISTA, sin arreglar

**Contexto:** el patrón que nos ha mordido 4 veces = escribir estado DERIVADO / de contenedor / de excepción recurrente
por un camino que **ningún test recorre de verdad**. Con el hook de selección ya extraído (`containerDayToggle`,
`childrenToMoveWithContainer`) se puede testear el camino real; el resto sigue sin cubrir.

**YA con test del camino real (esta sesión):** `containerDayToggle` (selección C1 de `handleToggleStatus`, incl. mixto),
`childrenToMoveWithContainer` (arrastre de `handleUpdateTask`), `filterTasksForDay` (ensamblado del día),
`reconcileDay`, `materializeDay`/`resolveChildForDay`, `isCompletedForDay`, `writesOwnStatusOnToggle`,
`childrenToToggleOnDay`. Total suite: 117 verdes.

**Caminos de escritura SIN test del camino real, priorizados por riesgo** (117 escrituras en 14 archivos; agrupadas por
handler lógico, no por llamada):

- **Actualización sesión 19 (items 4/6/7/8):** suite ahora en **127 verdes**. Cerrados de TIER 1: #2 (bulk, `item 6`,
  `bulkEffectiveIds` extraído+testeado+arreglado) y #4 (#18, `item 7`, escritura muerta eliminada). Cores puros de #1/#3
  ya testeados (`resolveTaskId`, `templateIdFromInstanceId`, `belongsToDay`, `materializeDay`, tapón B). Lo que queda de
  #1/#3 EXIGE extraer lógica inline del hook a helper puro (patrón b1/b2/item6) = **tocar el camino real** → APARCADO por
  regla del día (no autónomo). Cuando quieras, es un rato: son extracciones mecánicas + su test.
- **TIER 1 — alto (estado derivado / contenedor / recurrencia / borrado silencioso):**
  1. **PENDIENTE (exige extracción, ALTO riesgo) — item 4, aparcado por acuerdo con la usuaria (no tocar sin validación en
     pantalla).** `handleUpdateTask` — rama **excepción-move** (`inst-inst-`, `useTaskCRUD:~478-535` + async `~665-720`) y
     **detach recurrente** (parent→null, `~536-572`). Es el **origen histórico del leak `inst-inst-`**.
       - **PLAN:** extraer un reducer PURO `applyExceptionMove(prevMap, updatedTask) → nuevoMap` (o, más acotado,
         `planExceptionMove(...) → { oldParentId, newParentId, newSubtaskId, borra[], upserts[] }`) que capture: quitar la
         hija del padre viejo, crear/mergear la instancia del padre en el día nuevo, construir la fila-excepción de la hija,
         y detach recurrente (`parent_task_id: null`). El hook solo APLICA el resultado. Testear: (a) NUNCA produce
         `inst-inst-` (base normalizada con `templateIdFromInstanceId`); (b) no duplica padre si ya existe en el día nuevo;
         (c) detach deja `parentTaskId:null` (re-anida materializeDay).
       - **RIESGO: ALTO.** Reescribe la secuencia de escritura más delicada de la app; regresión = reaparece el leak, y NO
         es validable en navegador con un test unitario solo. Core puro (`templateIdFromInstanceId`) YA testeado; el
         arrastre de contenedor (b2) también. **Hacer CON la usuaria: mover una instancia recurrente en pantalla + diff de
         BD antes/después** (confirmar 0 filas `inst-inst-` nuevas) antes de dar por bueno. No autónomo.
  2. ✅ **HECHO (`item 6`).** `bulkUpdateTasks` — selección extraída a `bulkEffectiveIds` (puro), arreglado el bug de la
     hija manual perdida (mismo `templateId` que b1) y 5 tests. Sin regresión en el caso recurrente.
  3. ✅/◐ **PARCIAL (`item 4`).** `handleDeleteTask` — el CONJUNTO a borrar (recursivo + fan-out de plantilla) extraído a
     `collectDeletableTasks` (puro, +5 tests); la cirugía del mapa y el bucle de persistencia intactos (mismo set, sin
     cambio de comportamiento). **PENDIENTE (aparcado):** el handler "borrar → este día" de recurrentes (`App.tsx:~958`,
     escribe excepción `is_deleted` = supresión de contenedor) sigue inline; extraer `buildDeletedExceptionRow` es
     construcción de objeto (bajo riesgo) → se puede cerrar cuando toque.
  4. ~~`handleUpdateSubtasksOrder` (bug #18)~~ **RESUELTO (sesión 19, `item 7`).** El `update({ subtasks })` escribía a una
     columna inexistente (confirmado: 400 PGRST204) → fallo mudo, pero **redundante**: el orden ya persiste por el `order`
     de cada hija y `reconstructHierarchy` lo re-ordena en carga. Se eliminó la escritura muerta. **Impacto real que tenía
     #18: NINGUNO visible** — reordenar subtareas de un contenedor MANUAL siempre funcionó y persistió.
     · **GAP ADYACENTE — Bug #21. ✅ ARREGLADO (sesión 19), pendiente de tu validación en pantalla** (reordenar "Verduras
     vivas" → recargar → comprobar que el orden aguanta). Fix: `sortInstanceContainerSubtasks` (useSupabase.ts) ordena las
     subtareas de cada contenedor-instancia por el `order` de la **plantilla** de cada hija (o el propio si es manual),
     llamado tras las dos pasadas de reconstrucción. Solo lectura en carga → **0 escrituras a BD, reversible por código.**
     +4 tests (incl. la trampa: instancia order 0 vs plantilla order). Reordenar subtareas de un contenedor **RECURRENTE**
     ya sobrevive a la recarga.
       - **Exposición (item 3):** de 99 contenedores vivos, **24 recurrentes, 22 con ≥2 subtareas** (afectados). Grandes:
         "Pago nóminas" (26), "Verduras vivas" (51), "Cierre Central Rec" (16), "Cobros Finca" (10), "Previsional" (9). En
         manuales el reorden SÍ persiste (67 de 75 con ≥2).
       - **Causa exacta (item 3):** al reordenar, `handleUpdateSubtasksOrder` persiste el `order` de cada hija; para hijas
         `inst-` lo escribe en su **plantilla-hija** (`useTaskOrdering:112`, `dbId = sub.templateId`). En carga hay dos
         reconstrucciones: `reconstructExceptionContainerSubtasks` (useSupabase:94) sigue el orden de
         `parentTemplate.subtasks` (que `reconstructHierarchy` YA ordena por `order` de las reglas) → **ese path conserva
         el orden**; pero `reconstructInstanceHierarchy` (useSupabase:61) hace `push` en orden de iteración (línea ~82) sin
         ordenar → **ese path pierde el orden**. Es el único roto.
       - **QUÉ TOCAR:** solo `reconstructInstanceHierarchy` (useSupabase:61-86): tras poblar `parentInstance.subtasks`,
         ordenarlo por el `order` de la **plantilla** de cada hija (no por el `order` de la instancia, que suele venir 0/sin
         set — ESA es la trampa), o construirlo siguiendo el orden de `parentTemplate.subtasks` como hace el path de
         excepción. ~5-10 líneas, un punto.
       - **RIESGO: medio.** Es SOLO lectura/reconstrucción en carga → **0 escrituras a BD, reversible revirtiendo el
         código**. Riesgos reales: (a) usar la clave de orden equivocada (instancia vs plantilla) → no-op o desorden; (b)
         cambia el orden de carga de TODOS los recurrentes (24) → validar en pantalla reordenando Verduras/nóminas y
         recargando; (c) que los dos passes de reconstrucción no se pisen. **Filas escritas por el arreglo: 0.**
       - **TEST:** `reconstructInstanceHierarchy` no está exportada; exportarla (cambio mínimo) permite un test de carga del
         camino real. No autónomo — es reconstrucción en carga y quieres validarlo con calma.
- **TIER 2 — medio:**
  5. `bulkDeleteTasks` (materializa excepción-borrada de vírgenes, `useBulkActions:184`) y `bulkDuplicateTasks`
     (duplicar FK-safe, `:259`; ahí vivió el bug #20). Sin test.
  6. `handlePromoteTask` / `handleDemoteTask` (`useTaskOrdering:167/225`) — cambian `parent_task_id` → cambian la
     pertenencia a contenedor. Sin test.
  7. `handleTimerStopConfirm` (`useTimerHandlers:165`) — al parar el timer con "marcar completa" **escribe status** (toca
     el completado por otra puerta). Sin test.
  8. `handleAddTask` (`useTaskCRUD:249`) y `handleAddRule` (`:890`) — creación. Sin test.
- **TIER 3 — bajo:**
  9. `useBlockHandlers` (alta/edición/reorder/activar/borrar de `work_blocks`; "borrar bloque no persiste" ya en FASE 4).
  10. `handleUpdateTasksOrder` (reorder raíces), flags `is_expanded`, entradas de tiempo (`time_entries`), adjuntos
      (storage). Mecánicos, bajo acoplamiento con el modelo.

**Recomendación de orden (cuando toque, es trabajo de código real → no autónomo):** 1 → 2 → 3 → 4. Los cuatro comparten
el mismo gesto: extraer la lógica pura de selección/construcción-de-ids a un helper y testear ESE helper por el camino que
el hook llama de verdad (como se hizo con `containerDayToggle`). Del 2 y el 4 hay además fix pendiente (bug real).

### 16.19 INVENTARIO HONESTO — qué falla HOY si trabajas con normalidad (sesión 19, item 1)

Priorizado por lo que **duele a diario**, no por lo fácil de arreglar. "V" = verificado en código esta sesión; "H" = claim
heredado del §16, confianza media (no re-verificado hoy). Lo pendiente de TU validación en pantalla va marcado.

**TIER A — te muerde a diario / cada vez que usas la función:**
1. **Reorden de subtareas en contenedores RECURRENTES no persistía a la recarga** (#21). Afecta **22 de 24** recurrentes.
   **ARREGLADO (`36eea43`) y ✅ VALIDADO EN PANTALLA (sesión 19): el reorden aguanta la recarga.** *(Salvedad nueva: en
   "Rutinas mañana" el reorden a veces no agarra — es OTRO problema, mapeado en §16.25.)*
2. **En BLOQUES, un contenedor pinta sus hijas completadas de TODOS los días** (render "otros días"). Ruido visual diario
   en **65 contenedores** con completadas. En **Mi Día NO pasa** (es día-scoped). Sin arreglar — es tu decisión de
   producto (quieres verlo en pantalla). *(V: la causa es `TaskCard:851/860`, `subtasksForGroup=null` en Bloques.)*
3. **Borrar un bloque — ✅ REVERSIBLE (sesión 19, implementado).** Tras correr el SQL de 2 columnas
   (`work_blocks.is_deleted`, `tasks.deleted_with_block`), `handleDeleteBlock` ya NO hace `DELETE` físico (que disparaba el
   cascade y borraba el árbol entero sin vuelta). Ahora: **soft-delete** — `work_blocks.is_deleted=true` + `tasks` VIVAS del
   bloque a `is_deleted=true, deleted_with_block=id`. Recuperación: **`handleRestoreBlock`** restaura el bloque y SOLO las
   tareas con `deleted_with_block=id` (las ya borradas de antes NO resucitan → agujero cerrado). Carga filtra bloques por
   `is_deleted`. **Probe del ciclo completo verificado** (borrar→siguen en BD→restaurar→vuelven; una pre-borrada NO vuelve).
   +tests (`liveTasksInBlock`, `tasksToRestoreWithBlock`). *(Falta UI de "papelera de bloques" para invocar el restore desde
   pantalla; la función existe y el dato es recuperable ya.)*

**TIER B — molesto cuando tocas esa función:**
4. **Mover en LOTE aplasta las fechas** de todo lo seleccionado. **Guard añadido (`a5ed17e`) y ✅ VALIDADO EN PANTALLA
   (sesión 19):** seleccionando un contenedor con completadas y sin completar, las **completadas se quedan** (no se
   re-fechan); las pendientes se mueven.
5. **Poner pauta de recurrencia desde la FILA no funciona** (FASE 5): hay que abrir el modal. Fricción al crear recurrentes.
6. **Recurrentes desde otras vistas** (H, §11.1e/f/g): Semana no mueve recurrentes · Bloques no completa recurrentes ·
   Calendario sin icono de completar. Interacción incompleta según la vista.
7. **Clic en contenedor MIXTO** (manual + recurrente): el conteo del tapón y la selección real coinciden (`e481508`) y el
   toggle marca también las manuales (`fa6cc69`). **✅ VALIDADO EN PANTALLA (sesión 19): el clic marca las dos clases** (b1 OK).

**TIER C — cosmético / raro / sin pérdida de trabajo:**
8. **due_date colapsado** en 22 contenedores/116 filas: histórico, DECIDIDO no tocar (la historia real vive en
   `completed_at`, 75/76). No es un blocker.
9. **Calendario "Ir a fecha" no retrocede de mes**: para ir a julio, ~23 clics en la flecha. Molestia al navegar atrás.

**Persistencia — estado real (corrige el §16, que sonaba peor):**
- **Entradas de tiempo: SÍ persisten** (V: `useTimerHandlers` insert/update/delete escriben). El viejo "tiempos
  descuadran al recargar" es, si acaso, un tema de AGREGACIÓN/combo en el contenedor, no de guardado. Confianza media →
  a re-verificar en pantalla si lo notas.
- **Borrar bloque: NO persiste** (V, punto 3).
- **Adjuntos (H):** no re-verificado hoy; el §16 lo marcaba como no-persistente. Pendiente de comprobar.

**Lo que NO está roto (para tranquilidad):** el motor de instancias (materializeDay/reconcileDay), el completado por día
(toggle C1), mover un contenedor MANUAL con sus hijas (b2), las acciones masivas sobre contenedores (b1/item6), el leak
`inst-inst-` (contenido: **1 fila** en toda la BD). 141 tests verdes.

### 16.20 FASE 4 — CERRADA (sesión 19, item 2). Resumen y punto de retomada.

FASE 4 (persistencia y limpieza legada) queda **CERRADA**. Todo lo ejecutado fue REVERSIBLE (unmark o `is_deleted:true`,
nunca hard-delete). Detalle largo arriba (§16.17); esto es el cierre de un vistazo.

**EJECUTADO (datos, reversible):**
- **G1** — 6 plantillas rotas reales → `is_template=false` (reaparecen como tarea normal) + phantom "Gestión campaña"
  soft-deleted. *(Hallazgo: eran series recurrentes RETIRADAS con 63 instancias completadas → G3 subió 64→86, inofensivo.)*
- **G3** — 41 completadas (leak `template_id→no-plantilla`) soft-deleted + 15 huérfanas pendientes (basura de test) + G4
  + las 5 "inst→tarea-normal" (verificadas sin trabajo real) soft-deleted. Total ~62 filas soft-deleted, todas reversibles.
- **G4** — instancia suelta `inst-t-1785433862534-2026-08-24` soft-deleted (su tarea real vive en due 08-31).

**DECIDIDO NO HACER (con razón):**
- **G2 (Soriano)** `t-1778161643849` + `t-1778576136973`: **las dos se quedan, no son duplicados.** Lección: "mismo
  título + mismo bloque" NO basta como criterio de duplicado (hay homónimas legítimas). El detector de dups da falsos
  positivos por eso.
- **Descolapsar el due_date** (22 contenedores/116 filas): NO. La historia real vive en `completed_at` (75/76 recuperables);
  el `due_date` planificado de algo hecho no aporta. Re-fechar = riesgo sin premio. Única irrecuperable anotada:
  `t-1777366769600`.

**APARCADO CON FASE:**
- **Bug #21** (reorden recurrentes no persistía) → estaba en FASE 4; **ARREGLADO esta sesión** (`36eea43`), pendiente
  validación en pantalla.
- **Guard "mover a fecha"** (no aplastar completadas) → IMPLEMENTADO (`a5ed17e`), pendiente validación.
- **Borrar bloque no persiste** (§16.19 punto 3) → FASE 4 (persistencia), sin arreglar (escritura nueva, con la usuaria).
- **Adjuntos** (persistencia, sin re-verificar) → FASE 4.

**PUNTO DE RETOMADA LIMPIO (por dónde seguir):**
1. **Validar en pantalla** (bloqueante para cerrar del todo lo de esta sesión): #21 (reordenar Verduras vivas → recargar),
   guard de mover en lote, clic en contenedor mixto, render "otros días".
2. **Decidir producto:** render "otros días" (§16.17, 3 opciones) · aviso vs guard en mover-lote (ya guard).
3. **Siguiente arreglo de persistencia (con la usuaria):** borrar bloque (no persiste) + verificar adjuntos.
4. **FASE 5 / FASE 6:** tablas de decisión en §16.21 (abajo) — ordenar por valor.
5. **#1 (exception-move / leak):** solo con la usuaria (plan en §16.18).

### 16.21 LISTA MAESTRA PARA DECIDIR — todo lo aparcado, ordenado por VALOR (sesión 19, item 4)

Consolidado de todo lo pendiente estos días, para elegir de un vistazo si entramos en **FASE 5** o **FASE 6** (o técnico).
**Orden = mi criterio de VALOR** (dolor/beneficio diario), NO por facilidad. **Coste:** S = un rato · M = medio · L = grande.
**Pantalla:** ¿cambia lo que ves? (sí = necesita tu validación). **NO arranco ninguno sin que me lo digas.**

| # | Punto | Fase | Qué es | Coste | Qué gano | Pantalla |
|---|-------|------|--------|-------|----------|----------|
| 1 | **Recurrentes en otras vistas** (§11.1e/f/g) | FASE 6 | Semana no MUEVE recurrentes · Bloques no COMPLETA recurrentes · Calendario sin icono de completar. Interacción incoherente según la vista. | M | Coherencia diaria: la misma tarea se comporta igual en toda la app | Sí |
| 2 | **Modal de la papelera de fila recurrente** | FASE 6 | Que deje CLARÍSIMO "este día" vs "la serie" y avise si hay hijas pendientes que se entierran. Es el gesto que más miedo da. | M | Borrar recurrentes sin sustos; menos error | Sí |
| 3 | **Pauta de recurrencia desde la FILA** | FASE 5 | Hoy solo desde el modal; desde la fila el chip se ve pero no llega a poner la pauta. | M | Crear recurrentes sin abrir el modal (fricción si creas muchas) | Sí |
| 4 | **Calendario "Ir a fecha" no retrocede de mes** | FASE 6 | Solo muestra el mes actual; para ir a julio, ~23 clics. Añadir ‹ mes ›. | S | Navegar al pasado sin sufrir | Sí |
| 5 | **#1 exception-move: extraer + test** | Técnico | Origen del leak `inst-inst-`. Blindar con test el camino más frágil. **Solo CONTIGO** (mover instancia en pantalla + diff BD). | M | Menos riesgo de que vuelva el leak | No (refactor) + validación |
| 6 | **Renombrar "borrar la serie" → "terminar la serie"** | FASE 6 | El botón en realidad la termina (corta de ese día, conserva histórico). El nombre engaña. | S | Menos confusión | Sí (texto) |
| 7 | **Aviso vista de Carga** | FASE 6 | Que un contenedor no se proyecte dos veces ni desaparezca. Comprobar al rediseñar Carga. | M | Carga fiable | Sí |
| 8 | **Poda de instancias `inst-` antiguas** | Técnico | Archivar+borrar completadas > 6 meses (plan §16.22). Hoy NO urge (2537 filas). **Con la usuaria.** | M | Frena el crecimiento (arranque del cliente) | No |
| 9 | **Verificar adjuntos** | Técnico | Claim heredado "no persisten"; sin re-verificar. | S (medir) | Saber si es real y arreglarlo si lo es | No (medir) |
| 10 | **Tests TIER 2/3 de escritura** (§16.18) | Técnico | Extraer+test bulkDelete/bulkDuplicate/promote/demote/timerStopConfirm/addTask/addRule. | M | Blindar más caminos de escritura | No |
| 11 | **Limpieza: 29 prunables FK + 14 huérfanas CM11l** (§16.22/§16.23) | Técnico | Basura de test entrelazada por FK. Las 14 son caso de validación de (c) → no tocar aún. | S | Deflaciona conteos | No |

**YA RESUELTO estos días (fuera de la lista, pendiente solo tu validación en pantalla donde se indica):** render "otros
días" → **A implementado** (regla canónica, `getVisibleSubtasksForBloques`; valida Rutinas mañana/Verduras vivas) ·
reorden recurrentes #21 → **arreglado + validado** · reorden flaky "Rutinas mañana" → **A lo arregla** (de 136 a 4 filas +
`values` memoizado + merge; re-valida) · guard mover-lote → **validado** · clic mixto → **validado** · borrar bloque →
**reversible (soft-delete + papelera)** · aviso al borrar contenedor → **hecho** · aviso mover-lote mezcla-días → cubierto
por el guard (mi opinión: no hace falta un aviso extra).

### 16.22 SALUD INTERNA / VOLUMEN (sesión 19, item 6) — primera medición, nunca lo habíamos mirado

> 🔭 **NOTA DE VIGILANCIA (item 5) — revisar antes de que vaya lento, no cuando ya lo esté.**
> Crecimiento medido: **~700 filas `tasks`/mes** (dominado por `inst-`), +~220 `time_entries`/mes. Hoy (2026-08-15):
> **2537 filas vivas**, app SANA. El cuello, cuando llegue, será **el ARRANQUE del cliente** (carga + reconstrucción en
> memoria), **NO Postgres** — y aparecerá antes en el MÓVIL. **Disparador de revisión: cuando el censo pase de ~5.000
> filas vivas, o en la revisión trimestral (~2026-11).** Al revisar: re-correr el censo (§16.22), medir el tiempo de
> arranque (el `DIAG-TEMP` de `useSupabase` ya lo cronometra), y si molesta, activar la poda de `inst-` (plan abajo). El
> lever barato mientras tanto ya está aplicado (item 2: no cargar borradas inertes; item 3: −266 prunables).

**Snapshot (2026-08-15):**
- **`tasks`: 2803 filas** = 2030 vivas + 773 borradas (soft, 28%). De las borradas: **478 son marcadores funcionales**
  (`is_exception + template_id`, los lee `materializeDay` para suprimir ocurrencias → NO se pueden borrar sin más) y
  **295 son prunables** (basura muerta de verdad).
- **Instancias `inst-`: 1268 (62% de las vivas)**, de ellas **1210 completadas históricas.** Este es el motor del
  crecimiento: cada vez que actúas sobre una ocurrencia recurrente (completar/mover) se persiste una fila-excepción que
  **nunca se poda**.
- **Leak `inst-inst-`: 1 fila** (contenido). `template_id→no-plantilla`: 65. `parent→inexistente`: 14. Basura ~4%.
- **`time_entries`: 764 · `work_blocks`: 13 (todos activos).**
- **Contenedores: 99. Dos GIGANTES: 136 y 121 hijas** (luego 51, 33, 26, 24…).

**Crecimiento (altas de `tasks` por `created_at`):** abr 65 · may 1044 · jun 631 · jul 842 · ago 221 (parcial). Neto
**~600–800 filas/mes**, dominado por `inst-`. `time_entries` ~220/mes. → **Proyección: ~+8.000 filas/año** → del orden de
**10–12k filas vivas para mediados de 2027** si el uso sigue igual.

**Qué carga el cliente:** en el arranque trae **2797 de 2803 filas** (`template_id null OR is_exception`), **incluidas 769
borradas** (de las que 295 son prunables = puro lastre). No hay ventana por fecha: se carga TODO el histórico cada vez.

**Dónde va a doler (por orden de probabilidad), y por qué NO es Postgres:**
1. **El cuello es el CLIENTE, no la BD.** Postgres se ríe de 10–100k filas. Lo que crece es: (a) el payload de carga,
   (b) el mapa en memoria, (c) las pasadas de reconstrucción (`reconstructHierarchy` / `reconstructInstanceHierarchy` /
   `reconstructExceptionContainerSubtasks` / `sortInstanceContainerSubtasks`, varias `Object.values(mappedTasks).forEach`),
   (d) `useGeneration` materializando en memoria. Todo O(n) o O(n·hijas). A 2k va bien (hay `DIAG-TEMP` midiendo la carga);
   a 10–12k la carga + reconstrucción puede pasar de instantánea a notable (segundos).
2. **`inst-` sin poda = crecimiento ILIMITADO.** 1210 ocurrencias completadas históricas hoy, +cientos/mes. Es el lever
   número uno de volumen.
3. **Los 2 contenedores gigantes (136 / 121 hijas).** Render + reconstrucción + sort concentrados; el bug de render "otros
   días" en Bloques lo empeora (pinta también las completadas de todos los días).
4. **~28% de lastre cargado** (769 borradas), creciendo.

**Levers (NO ejecutados — para cuando decidas; varios exigen tu criterio):**
- **Podar/archivar `inst-` completadas antiguas — PLAN ESCRITO (item 4, sesión 19; NO ejecutar sin la usuaria).** Es el
  lever de mayor impacto (las `inst-` son el 62% y crecen ~700/mes). Principio innegociable: **nunca perder el rastro de
  completado** → archivar antes de borrar, jamás hard-delete a secas.
  - **Fecha de corte que propongo: `completed_at` anterior a HOY − 6 meses.** Deja medio año de histórico vivo (para el
    calendario y los informes) y se lleva la cola larga. *(Nota: la app tiene ~5 meses de datos (desde abr-2026), así que
    HOY el corte de 6 meses no poda casi nada — es correcto: aún no hay cola. El plan es para cuando la haya.)*
  - **Cuándo ejecutarlo:** cuando el censo (§16.22) pase de **~5.000 filas vivas**, o revisión trimestral (ver nota de
    vigilancia). Hoy: 2537 filas → no toca aún.
  - **Método (preserva historia, reversible hasta el borrado):** (1) seleccionar `inst-` con `status='completed'` y
    `completed_at < corte`; (2) **COPIAR esas filas a un archivo** (tabla `tasks_archive` o export JSON a Storage) —
    verificado que la copia existe; (3) re-verificar por fila: NO es marcador de borrado activo, NO está referenciada como
    `parent_task_id` por una fila viva (mismo chequeo FK del item 3), NO es pendiente; (4) hard-delete de `tasks` en lotes.
  - **Qué NO tocar:** `inst-` PENDIENTES (trabajo futuro), marcadores de borrado (`is_deleted`+`is_exception`), y las
    referenciadas por filas vivas. Reduce carga (menos filas `is_exception` que traer) y reconstrucción.
  - **Riesgo: medio** (irreversible tras el borrado; toca histórico). Mitigación: el archivo + validar una muestra en
    pantalla antes de borrar. **Con la usuaria.**
- ~~**Hard-delete de las 295 prunables**~~ ◐ **HECHO EN PARTE (item 3, sesión 19): 266 borradas de 295.** Verificado antes:
  0 son marcadores (marcador = `is_exception && template_id`). **PERO 29 estaban referenciadas como `parent_task_id` por
  otras filas** (`parent_task_id` tiene FK **ON DELETE CASCADE** — verificado, item 3) → hard-borrarlas habría
  **cascade-borrado sus 14 hijas VIVAS** (irreversible), no un simple error → aparcarlas fue aún más importante → **APARCADAS.** Hard-deleted
  solo las 266 sin referencias entrantes (tasks: 2803→2537). **HALLAZGO relacionado:** esas 29 son padres de **14 filas
  VIVAS** cuyo `parent_task_id` apunta a un padre BORRADO = **orfanas vivas** (detalle y causa en el bloque de abajo).
- ~~**Filtrar `is_deleted` en la carga salvo marcadores**~~ ✅ **HECHO (item 2, sesión 19, `useSupabase.ts`).** La carga
  pasó de `template_id.is.null,is_exception.eq.true` a `is_exception.eq.true OR and(template_id.is.null,is_deleted.eq.false)`.
  Deja de traer las borradas SIN `is_exception` (**~281 hoy, creciendo**): son inertes — `indexExceptionsByTemplate` solo
  indexa `templateId && isException`, así que una borrada sin `is_exception` nunca suprime nada (test que lo fija). Los 478
  marcadores (borrada + is_exception) se siguen cargando. Payload: **2797 → 2520 filas** (−10%, y el ahorro crece con el histórico).
- **Ventana por fecha en la carga** (traer reciente + plantillas, generar el resto on-demand) — el arreglo de fondo si el
  volumen molesta. L, refactor de carga → con validación.
- **Partir los 2 contenedores gigantes** (decisión de producto/organización, no técnica).

**Veredicto honesto:** hoy NO hay problema de volumen ni de lentitud. La app está sana. Pero la trayectoria es de
crecimiento ilimitado de `inst-` y carga-todo-el-histórico; **el primer síntoma será el tiempo de arranque**, no la BD, y
llegará antes en el móvil que en el escritorio. Hay margen de sobra para decidir con calma; el lever barato y sin riesgo
mientras tanto es el hard-delete de las 295 prunables.

### 16.23 Las 14 huérfanas vivas (item 2, sesión 19) — detalle, causa, decisión pendiente

**Qué son:** 14 filas VIVAS (pending, `due=null`) cuyo `parent_task_id` apunta a un contenedor **soft-deleted**. TODAS en
el bloque **`CM11l`**, creadas entre **2026-04-29 y 2026-05-08** (infancia de la app). Los títulos son claramente de
prueba:

| Título | Bloque | id | due | padre (borrado) |
|--------|--------|----|-----|-----------------|
| rec hija 2 | CM11l | t-1777834252690 | null | t-1777834209844 "Prueba rec con hijas" |
| Rec hija 1 | CM11l | t-1777834228705 | null | t-1777834209844 "Prueba rec con hijas" |
| tarea 3 | CM11l | t-1777492162833 | 2026-04-29 | t-1777492158105 "tarea 2" |
| Margenes | CM11l | t-1777827686522 | null | t-1777827632047 "Rutinas mañana" |
| Ingresos | CM11l | t-1777827753534 | null | t-1777827632047 "Rutinas mañana" |
| Bancos | CM11l | t-1777827722578 | null | t-1777827632047 "Rutinas mañana" |
| Horario picking | CM11l | t-1777827766238 | null | t-1777827632047 "Rutinas mañana" |
| Margenes | CM11l | t-1777828228288 | null | t-1777828189938 "Rutinas Mañana" |
| Ingresos | CM11l | t-1777828247976 | null | t-1777828189938 "Rutinas Mañana" |
| Bancoos | CM11l | t-1777835967786 | null | t-1777828189938 "Rutinas Mañana" |
| Picking horario | CM11l | t-1777828260465 | null | t-1777828189938 "Rutinas Mañana" |
| subhija bloque | CM11l | t-1777448113356 | null | t-1777448090561 "diarioa bloque" |
| Subhija bloque jueves | CM11l | t-1777448139699 | null | t-1777448090561 "diarioa bloque" |
| contenedor una vez a la semana | CM11l | t-1778280399992 | null | t-1778280339302 "rec cont sabado" |

**Cómo llegaron ahí (por qué "no deberían poder existir" pero existen):** el FK `parent_task_id` guarda filas FÍSICAS, y
un **soft-delete es un `UPDATE is_deleted=true`, NO un `DELETE`** → la fila del padre SIGUE existiendo físicamente, así que
el FK está satisfecho. Pero a nivel de APP la reconstrucción salta los `is_deleted`, así que la hija queda "colgando" de un
padre que no se pinta. Es decir: **no es una violación de integridad de la BD** (el padre existe, borrado); es una
**orfandad a nivel de app**, creada al soft-deletear un contenedor SIN propagar el `is_deleted` a sus hijas. Pasó en
abril/mayo (infancia), con un borrado que no bajaba a las hijas. **Hoy no se reproduce:** `handleDeleteTask` usa
`collectDeletableTasks` (recursivo) y soft-deletea el contenedor + TODAS sus descendientes juntas (item 3, abajo).

**DECISIÓN (usuaria, sesión 19): NO se tocan. SE QUEDAN como CASO REAL para validar (c)** (reconciliación sin fuga /
re-anclado por plantilla). Son el ejemplo vivo de "hija viva con padre soft-deleted" — perfectas para comprobar que (c)
las re-ancla o las trata bien. No soft-deletear, no borrar, no re-anclar a mano. Congeladas a propósito.

### 16.24 ¿Borrar un contenedor arrastra sus hijas? (item 3, sesión 19) — comprobado sin tocar nada

**Dos niveles, respuesta clara:**

1. **En la APP (el gesto normal "borrar contenedor" → `handleDeleteTask`): las hijas SE VAN CON ÉL, y es RECUPERABLE.**
   `handleDeleteTask` usa `collectDeletableTasks` (recursivo) y hace **soft-delete** (`is_deleted:true`) del contenedor
   **y de TODAS sus descendientes** a la vez. No quedan sueltas ni huérfanas, y como es soft-delete se pueden recuperar
   (`is_deleted:false`). O sea: **borrar un contenedor por error es reversible** (a diferencia de borrar un BLOQUE, que hoy
   es hard — eso es lo que arregla el item 1b).

2. **A nivel de BD, si una fila-contenedor se HARD-borra** (DELETE físico): el FK `parent_task_id` tiene **ON DELETE
   CASCADE** (verificado con probe temporal: borré un padre y su hija desapareció, 204). Es decir, un `DELETE` físico de un
   contenedor **arrastra en cascada a todas sus descendientes, irreversible.** PERO la app **nunca** hace hard-delete de
   tareas — solo soft (punto 1). El hard-cascade solo ocurre en un `DELETE` físico: hoy eso pasa al **borrar un BLOQUE**
   (cascade por `block_id`) o en un script de limpieza. Por eso el prune del item 3 aparcó las 29 referenciadas: borrarlas
   habría cascade-borrado 14 hijas vivas.

**Resumen para tu tranquilidad:** borrar un contenedor en la app = soft, recuperable, sin sueltas. El único borrado
irreversible hoy es el de BLOQUE (item 1b lo hará reversible en cuanto exista `work_blocks.is_deleted`).

> **RE-VERIFICADO con probe (sesión 19):** repliqué `handleDeleteTask` (UPDATE `is_deleted=true` en contenedor + hija) →
> las filas SIGUEN en la BD y `is_deleted=false` las RESTAURA → **soft, reversible**. Contraste: un `DELETE` físico del
> contenedor sí borra la hija por cascade (la app no lo hace). **AÑADIDO (item 2 de esta ronda, código):** borrar un
> contenedor ahora AVISA con el número de subtareas que se lleva (`handleDeleteTaskRequest`, igual que el tapón del
> checkbox): `«X» y sus N subtareas`; para una hoja (N=0) no pregunta. Cuenta = `collectDeletableTasks` (mismo conjunto que
> borra el hook).

> **DOS VERDADES DISTINTAS sobre `parent_task_id` (punto 5, sesión 19 — NO se sustituyen, conviven):**
> - **ESCRIBIR** un `parent_task_id` que apunta a una fila INEXISTENTE (INSERT/UPDATE) → **error `23503`** ("violates
>   foreign key constraint"), que en varios caminos petaba en silencio. Es el landmine de bug #20 (§13.16-13.17); sigue
>   VIGENTE para escrituras (materializar-primero lo evita en los caminos arreglados).
> - **BORRAR** físicamente una fila REFERENCIADA como padre (DELETE) → **ON DELETE CASCADE**: arrastra a las hijas. Es lo
>   verificado en el item 3.
> No es que una corrija a la otra: **23503 es al escribir un FK malo; CASCADE es al borrar el padre.** Operaciones
> distintas, ambas ciertas.

### 16.25 MAPA — "Rutinas mañana": a veces el reorden de subtareas no agarra (sesión 19, sin arreglar)

**Síntoma:** en "Rutinas mañana", arrastrar una subtarea a veces NO mueve. No siempre.

**Los datos (medido):** "Rutinas mañana" (`t-1778445069239`, contenedor recurrente) tiene **136 hijas** = **4 reglas
recurrentes pendientes** ("Ingresos tiendas", "Picking", "Márgenes", "Bancos") + **132 instancias completadas históricas**.
**TODAS con `order=0`** (una con 4). Es el contenedor MÁS GRANDE de la app (§16.22).

**Dónde:** el reorden en Bloques es `TaskCard.tsx:849-868` (Framer Motion `Reorder.Group` sobre
`(subtasksForGroup || task.subtasks).filter(hideCompleted)`; en Bloques `subtasksForGroup=null` → `task.subtasks`), con
handler `handleUpdateSubtasksOrder` (`useTaskOrdering.ts:80`).

**Causa probable del "a veces" — tres factores que se combinan:**
1. **`values` recalculado INLINE en cada render** (línea 851: `.filter(...)` crea un array NUEVO cada vez). `Reorder.Group`
   de Framer Motion es sensible: si el componente re-renderiza durante el gesto, el `values` cambia de identidad y el
   arrastre se **resetea** → "no agarra".
2. **`handleUpdateSubtasksOrder` REEMPLAZA `subtasks`** por los ids VISIBLES (líneas 88-90). Con "ocultar completadas" ON,
   `onReorder` manda solo las 4 reglas → `subtasks` pasa a `[4]`, **descartando las 132 completadas del estado** → un
   re-render gordo que descoloca el gesto (y pierde las completadas de memoria hasta recargar).
3. **136 hijas todas `order=0`:** el volumen (montar/filtrar 136 items) añade churn de render, y los empates a 0 hacen el
   orden ambiguo (relacionado con #21). Cuantas más hijas, más probable el reset → por eso pasa en "Rutinas mañana" (136)
   y no en contenedores pequeños → el "a veces".

**Distinto del #21:** #21 era "el reorden no sobrevive a la RECARGA" (ya arreglado y validado). Esto es "el GESTO no agarra
en el momento". Comparten el terreno (recurrentes grandes) pero son cosas distintas.

**Qué habría que tocar (sin arreglar aún):**
- (a) **`values` estable:** memoizar la lista filtrada (no `.filter` inline) para que Framer Motion no la vea cambiar salvo
  por el propio reorden.
- (b) **`handleUpdateSubtasksOrder` debe FUSIONAR**, no reemplazar: intercalar el nuevo orden de los VISIBLES dentro del
  array completo, conservando las ocultas (completadas) en su sitio.
- (c) **No montar 136 items:** en Bloques, un contenedor recurrente no debería listar sus 132 instancias completadas
  (enlaza directamente con la regla de render de §16.26). Con solo 4 reglas visibles, el reorden es trivial y estable.

### 16.26 MAPA — render de Bloques vs regla acordada (sesión 19, sin arreglar)

**Tu regla (dictada esta sesión):**
- **Contenedores normales:** se ven las subtareas PENDIENTES; las COMPLETADAS ocultas pero accesibles a petición.
- **Contenedores recurrentes:** se ve la PLANTILLA (regla) y las INSTANCIAS MODIFICADAS que sigan PENDIENTES.

**Lo que dice el DOCUMENTO (§16.13, línea 2332) — OJO, DIVERGE de tu regla:** *"BLOQUES = LISTA DE DEFINICIÓN, una línea
por regla: se muestra SOLO la plantilla, NO sus ocurrencias. Las ocurrencias se consultan por el icono de información."*
→ El doc dice **ninguna ocurrencia inline** (ni pendientes ni modificadas); tú dices **plantilla + instancias modificadas
pendientes**. **No coinciden.** O el doc está viejo/mal escrito, o cambiaste el criterio. **Decídelo** — dejo las dos
versiones a la vista; no sé cuál es la canónica.

**Lo que hace la APP hoy (medido en código):**
- **Nivel superior de Bloques** (`BlocksView.tsx:163-189`, `coreTasks`/`adhocTasks`): excluye `parentTaskId` y
  `templateId` → **una fila por contenedor/regla** ✓ (ninguna instancia sube a nivel raíz). Correcto.
- **Hijas del contenedor:** `TaskCard` en Bloques recibe `subtasksForGroup=null` → pinta **`task.subtasks` CRUDO**
  (todas las hijas reconstruidas), filtrado SOLO por el toggle global `hideCompleted` (`TaskCard:851/860`).
  - **Normal:** pendientes visibles; completadas ocultas con el toggle ON, visibles con OFF → "accesible a petición" SÍ
    existe, pero es un **toggle GLOBAL del bloque** (`BlocksView:256` "Ver/Ocultar completadas"), no por contenedor; y por
    el bug "otros días" (§16.17) arrastra completadas de todos los días. **≈ tu regla, con dos matices** (global + otros días).
  - **Recurrente:** `task.subtasks` = las reglas hijas **+ TODAS las instancias** (p.ej. "Rutinas mañana": 4 reglas + 132
    completadas). Con el toggle OFF se ven las 132 completadas; con ON se ocultan y quedan las reglas. **La app MUESTRA las
    ocurrencias** → viola el doc ("solo plantilla") **y** tu regla (no aísla "modificadas pendientes": enseña históricas
    completadas o nada según el toggle, sin el concepto de "modificada pendiente").

**Dónde diverge, resumen:**
| | Tu regla | Doc (2332) | App hoy |
|---|---|---|---|
| Normal | pendientes + completadas a petición | (no lo detalla) | pendientes; completadas por toggle GLOBAL (+bug otros días) |
| Recurrente | plantilla + instancias MODIFICADAS pendientes | SOLO plantilla, 0 ocurrencias | plantilla + TODAS las instancias (toggle oculta completadas) |

**Cuántos contenedores afecta:** **24 recurrentes** (donde se ven montañas de instancias: "Rutinas mañana" 136, "Verduras
vivas" 51, "Pago nóminas" 26…) — es la divergencia gorda. **65 normales** con completadas (para la parte normal; ahí la
app ya se acerca a tu regla vía el toggle).

**Qué habría que tocar (sin arreglar aún):** en Bloques, dejar de pintar `task.subtasks` CRUDO y construir la lista de
hijas con semántica de Bloques (un helper tipo `getVisibleSubtasksForBloques(container, allTasks)`):
- **Normal:** pendientes siempre; completadas solo si se piden (idealmente un "ver completadas (N)" POR contenedor, no el
  toggle global — enlaza con §16.17 render "otros días").
- **Recurrente:** las **reglas hijas** (plantillas) + las **excepciones que sigan pendientes**; **NO** las instancias
  completadas históricas. Esto además arregla de raíz el reorden flaky de §16.25 (de 136 items a ~4).
- **Antes de tocar: fija la regla canónica** (tu versión vs la del doc), porque cambian el resultado para los recurrentes.
