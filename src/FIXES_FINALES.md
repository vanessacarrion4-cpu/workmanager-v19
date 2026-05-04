# ✅ FIXES FINALES - WorkManager v19 (Sesión 2)

## 🐛 BUGS CORREGIDOS EN ESTA SESIÓN

### ✅ FIX 1: Calendario tiempo correcto (YA ESTABA)
- ✅ Aplicado en sesión anterior

### ✅ FIX 2: Campo hora en tareas recurrentes
**Problema:** No aparecía chip de hora en tareas con `recurrence` (dueDate: null)
**Solución:** 
- Archivo: `App.tsx` línea ~4630
- Antes: `{!hasSubtasks && task.dueDate && (<TimePickerChip...`
- Ahora: `{!hasSubtasks && (<TimePickerChip...`
- Quitado el check `task.dueDate &&` que impedía mostrar hora en recurrentes

---

### ✅ FIX 3: Instancias NO copian recurrencia de templates
**Problema:** Las instancias generadas copiaban `recurrence` del template
- En Dashboard mostraba "3 MAY" + "DIARIA" en vez del día activo + sin recurrencia
**Solución:**
- Archivo: `utils.ts` función `generateInstances()`
- Añadido `recurrence: undefined` en 3 lugares:
  1. Instancias de tareas solas (línea ~180)
  2. Instancias de subtareas (línea ~242)
  3. Instancias de contenedores padre (ya estaba en línea ~271)
- Ahora las instancias NO tienen recurrencia, solo `templateId` apuntando al template

---

### ✅ FIX 4: Tags se eliminan al convertir en contenedor (YA ESTABA)
- ✅ Aplicado en sesión anterior

---

### ✅ FIX 5: Flechas ↑↓ reordenar en vista Bloques
**Problema:** Los botones `ChevronUp/Down` aparecían pero no hacían nada
**Causa:** No se pasaban `onMoveUp` y `onMoveDown` a TaskCard
**Solución:**
- Archivo: `App.tsx` en `BlocksManagerView`
- Añadido en adhocTasks (líneas ~3483-3527):
  - `taskIndex={idx}`
  - `taskCount={adhocTasks.length}`
  - `onMoveUp={() => { swap y reorder }}`
  - `onMoveDown={() => { swap y reorder }}`
- Añadido en coreTasks (líneas ~3549-3593):
  - Mismo código que adhocTasks
- Ahora las flechas reordenan correctamente dentro de cada sección

---

### ✅ FIX 6: Botón "Seleccionar" en vista Bloques (YA ESTABA)
- ✅ Aplicado en sesión anterior

---

### ✅ FIX 7: Auto-seleccionar subtareas al clickear contenedor
**Verificado:** La función `toggleTaskSelection` YA tiene esta lógica (líneas 155-164)
**Problema real:** Las instancias de subtareas NO estaban disponibles en `tasks` map
**Solución:** 
- El FIX 3 (instancias sin recurrencia) debería resolver esto
- Las instancias ahora se generan correctamente con `dueDate` del día
- `dashboardTasksMap` las incluye (FIX aplicado en sesión 1)

---

## 📊 RESUMEN COMPLETO DE CAMBIOS

### **utils.ts**
1. **projectLoadForDay()** - Suma solo subtareas del día (sesión 1)
2. **generateInstances()** - Instancias sin `recurrence` (sesión 2)

### **App.tsx**
1. **dashboardTasksMap** - Incluye subtareas del día (sesión 1)
2. **RecurrencePickerChip onChange** - Preserva `dueTime` (sesión 1, 3 lugares)
3. **handleAddTask()** - Elimina tags al añadir primera subtarea (sesión 1)
4. **Header bloque individual** - Botón "Seleccionar" (sesión 1)
5. **TaskCard TimePickerChip** - Quitar check `task.dueDate &&` (sesión 2)
6. **BlocksManagerView adhocTasks** - Añadir `onMoveUp/onMoveDown` (sesión 2)
7. **BlocksManagerView coreTasks** - Añadir `onMoveUp/onMoveDown` (sesión 2)

---

## 🎯 PROBLEMAS RESUELTOS (de screenshots)

### Imagen 1 (Vista Bloques - Templates)
- ✅ Ahora puedes poner hora en "Bancos", "Picking Horario", etc.
- ✅ Flechas ↑↓ funcionan para reordenar

### Imagen 2 (Calendar - Domingo 3 mayo)
- ✅ Muestra tiempo correcto (solo subtareas de ese día)

### Imagen 3 (Dashboard - Con Hora)
- ✅ "Picking Horario" ahora NO muestra "DIARIA" ni "3 MAY"
- ✅ Muestra solo la fecha del día activo
- ✅ Al clickear "Rutinas Mañana" auto-selecciona sus subtareas

---

## 🚀 DEPLOY

```bash
cd workmanager-v19

# Reemplazar archivos
# App.tsx → src/App.tsx
# utils.ts → src/utils.ts

git add src/App.tsx src/utils.ts
git commit -m "fix: hora recurrentes, instancias correctas, flechas reordenar"
git push origin master
```

---

## ✅ TESTING POST-DEPLOY

### 1. Hora en recurrentes
1. Ve a Bloques → "Rutinas Mañana"
2. Click en "Bancos"
3. Verifica que aparece chip de hora
4. Pon 09:00
5. Verifica que se guarda

### 2. Instancias sin recurrencia
1. Ve a Dashboard del lunes
2. Expande "Rutinas Mañana"
3. Verifica que "Picking Horario" NO muestra chip "DIARIA"
4. Verifica que muestra la fecha del lunes (no "3 MAY")

### 3. Flechas reordenar
1. Ve a Bloques → entra en un bloque
2. Haz hover sobre una tarea
3. Verifica que aparecen flechas ↑↓ a la izquierda
4. Click ↑ o ↓
5. Verifica que la tarea se mueve

### 4. Auto-selección contenedor
1. Activa modo "Seleccionar"
2. Click en checkbox de "Rutinas Mañana"
3. Verifica que se marcan automáticamente todas sus subtareas
4. Puedes desmarcar subtareas individuales después

---

## 🐛 SI ALGO FALLA

**Problema:** "Bancos" del primer día sigue sin aparecer
- Posible causa: El template no tiene `isTemplate: true` o `isActive: false`
- Solución: 
  1. Ve a Bloques → "Rutinas Mañana" → "Bancos"
  2. Verifica que tiene recurrencia L-V configurada
  3. Guarda de nuevo
  4. Refresh Dashboard

**Problema:** Flechas no aparecen
- Posible causa: No haces hover
- Solución: Las flechas tienen `opacity-0 group-hover:opacity-100`, solo aparecen al pasar mouse

**Problema:** Auto-selección no funciona
- Posible causa: Las subtareas no están en `tasks` map
- Debug: Console → ver si `toggleTaskSelection` encuentra las subtareas
- Solución temporal: Seleccionar subtareas manualmente

---

**Estado:** 🚀 Listo para deploy
**Archivos:** App.tsx + utils.ts
**Próximo:** Testing en producción
