# ✅ FIX COLORES - Calendario

## 🎨 PROBLEMA

Los colores no se mostraban correctamente en:
1. **Carga diaria**: Solo aparecía morado y rosa (faltaban verde y naranja en <3h y 3-5h)
2. **Barra semanal**: No mostraba los colores correctos

**Causa raíz:** Las clases dinámicas de Tailwind (`bg-lima`, `bg-naranja`, etc.) no se incluyen en el bundle cuando se generan dinámicamente.

---

## ✅ SOLUCIÓN APLICADA

Usar **estilos inline con colores hex** en vez de clases Tailwind dinámicas:

### Carga diaria (barrita debajo de cada día)
```javascript
backgroundColor: getLoadColorHex(load)
boxShadow: 0 0 10px ${color}33
```

### Carga semanal (barra de progreso horizontal)
```javascript
backgroundColor: getWeekColor()
boxShadow: 0 0 10px ${color}33
```

---

## 🎨 COLORES DEFINITIVOS

### Verde Lima/Turquesa bonito
**Hex:** `#84CC16`
- Carga diaria: < 3h (< 180m)
- Carga semanal: < 15h (< 900m)

### Naranja
**Hex:** `#F59E0B`
- Carga diaria: 3-5h (180-300m)
- Carga semanal: 15-25h (900-1500m)

### Morado
**Hex:** `#A855F7`
- Carga diaria: 5-7h (300-420m)
- Carga semanal: 25-35h (1500-2100m)

### Rosa
**Hex:** `#EC4899`
- Carga diaria: > 7h (> 420m)
- Carga semanal: > 35h (> 2100m)

---

## 🚀 DEPLOY

```bash
git add src/App.tsx
git commit -m "fix: colores calendario con estilos inline"
git push origin master
```

---

## ✅ TESTING

### Carga diaria
1. Ve a Calendario → Mayo 2026
2. Verifica que los días muestren colores:
   - ✅ Verde: días con < 3h (ej: día 8 con 2h)
   - ✅ Naranja: días con 3-5h
   - ✅ Morado: días con 5-7h (ej: día 7 con 6h15m)
   - ✅ Rosa: días con > 7h

### Carga semanal
1. Ve a Calendario → Mayo 2026
2. Mira las barras de la columna de la derecha
3. Verifica que muestren colores según carga total:
   - ✅ Verde: semanas con < 15h total
   - ✅ Naranja: 15-25h
   - ✅ Morado: 25-35h
   - ✅ Rosa: > 35h

---

**Ahora todos los colores se mostrarán correctamente** 🎨✨
