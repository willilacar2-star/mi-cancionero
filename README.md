# Mi Cancionero

Cancionero con acordes, transposición y estructura de cada canción. Funciona en el celular, sin base de datos, y sin conexión después de la primera vez.

## Archivos (todos en la raíz del repositorio)

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Pantallas de la app |
| `styles.css` | Diseño y modo oscuro |
| `app.js` | Lógica de la app |
| `music.js` | Acordes, transposición y lectura de letras |
| `canciones.json` | **Tus canciones** (el archivo que más vas a editar) |
| `manifest.json` | Datos para instalarla como app |
| `sw.js` | Hace que funcione sin conexión |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | Iconos |

## Publicar en GitHub Pages

1. Crea un repositorio público llamado `mi-cancionero`.
2. **Add file → Upload files** y sube todos los archivos de arriba (no hace falta carpeta).
3. **Commit changes**.
4. **Settings → Pages → Build and deployment → Deploy from a branch**, rama `main`, carpeta `/ (root)`, **Save**.
5. Espera uno o dos minutos. Tu dirección será `https://TU-USUARIO.github.io/mi-cancionero/`.
6. Ábrela en el celular. Chrome (Android): menú ⋮ → **Instalar app** o **Agregar a pantalla de inicio**. Safari (iPhone): Compartir → **Agregar a pantalla de inicio**.

## Cómo agregar o cambiar canciones

**Opción A: desde la app**
1. Agrega y edita canciones con ➕ y ✎.
2. Menú ⋯ → **📤 Exportar JSON**. Se descarga `canciones.json`.
3. En GitHub abre `canciones.json` → ✎ editar (o **Add file → Upload files** y súbelo con el mismo nombre) → **Commit changes**.

**Opción B: editando el JSON en GitHub**
Abre `canciones.json`, edita y confirma el cambio. Cada canción tiene esta forma:

```json
{
  "titulo": "Nombre",
  "artista": "Artista",
  "tono": "G",
  "categoria": "Alabanza",
  "seccion": "General",
  "estructura": ["Intro", "Verso 1", "Coro", "Verso 2", "Coro"],
  "contenido": [
    { "tipo": "verso", "titulo": "Verso 1",
      "lineas": [ { "acordes": "G        D", "letra": "Primera línea" } ] }
  ]
}
```

- `titulo` es lo único obligatorio. `estructura` es opcional.
- En `estructura` puedes repetir partes y agregar notas entre paréntesis: `"Coro (x4)"`, `"Verso (voz de hombre)"`. Un nombre que no existe en `contenido` (por ejemplo `"Instrumental"`) se muestra como parte sin letra.
- No pongas `id`: la app lo asigna.
- Para un medley, pon en `seccion` algo como `"Medley Dante Gebel"`.
- Los espacios dentro de `acordes` alinean cada acorde con la letra.

**Siempre que cambies `canciones.json`, sube el número de `"version"`** (de 1 a 2, etc.). Así los teléfonos se enteran de que hay cambios.

## Cómo llegan los cambios al teléfono

- **Primera vez:** la app baja `canciones.json` y lo guarda en el teléfono.
- **Después:** si `version` es mayor que la que ya tiene el teléfono, agrega **solo las canciones nuevas**. No pisa lo que editaste en el teléfono.
- **Menú ⋯ → 🔄 Actualizar desde GitHub:** además reemplaza las canciones que tengan el mismo título y artista por la versión del repositorio. Hazlo cuando quieras que el repositorio mande.
- **Menú ⋯ → ↺ Restaurar lista del repositorio:** borra todo lo local y vuelve a la lista del repositorio.

## Cuando cambies el código

Si cambias `index.html`, `styles.css`, `app.js` o `music.js`, sube el número de `VERSION` en `sw.js` (por ejemplo `cancionero-v2`). Si no, los teléfonos seguirán usando la copia vieja guardada.

## Nota sobre derechos de autor

`canciones.json` viene solo con título, artista y tono. Agrega letras y acordes de canciones que tengas derecho a usar, o tus propios arreglos, sobre todo si el repositorio es público.
