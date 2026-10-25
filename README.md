# Mi Cancionero

Cancionero con acordes, transposición y estructura de cada canción. Funciona en el celular, y sin conexión con los datos guardados de la última vez.

Las canciones y las listas viven en **Supabase**. Todos pueden leerlas; solo los **editores** (con sesión iniciada) pueden cambiarlas. Favoritos, transposición y preferencias se guardan solo en cada teléfono.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Pantallas de la app |
| `styles.css` | Diseño y modo oscuro |
| `app.js` | Lógica de la app (lee y guarda en Supabase, caché local) |
| `music.js` | Acordes, transposición y lectura de letras |
| `config.js` | Dirección de Supabase y la *anon key* (públicas) |
| `manifest.json` | Datos para instalarla como app |
| `sw.js` | Hace que funcione sin conexión |
| `supabase/migrations/` | SQL de las tablas, permisos (RLS) y funciones |
| `scripts/importar.mjs` | Importa un `canciones.json` a Supabase (una sola vez) |
| `icon-*.png`, `apple-touch-icon.png` | Iconos |

## Seguridad

- `config.js` tiene la *anon key*: es pública por diseño. Lo que protege los datos son las políticas RLS.
- La **service_role key** solo va en `.env` (que no se sube: está en `.gitignore`). Nunca la pongas en `config.js` ni en otro archivo del repositorio.
- Solo pueden escribir los correos que estén en la tabla `editores` **y** tengan usuario en Supabase Auth.

## Editores

- Menú ⋯ → **🔐 Iniciar sesión** → escribe tu correo → **Enviar enlace**.
- Abre el correo y toca el enlace. Si usas la app instalada en la pantalla de inicio (sobre todo en iPhone), escribe el **código** del correo en la app.
- Con sesión aparecen ➕ Nueva canción, ✎ Editar, ✎ Orden, 📋 Agregar a lista, Nueva lista / ✎ Editar e Importar JSON.
- Los cambios se guardan directo en Supabase. **Sin conexión no se puede editar**: la app avisa y no cambia nada.

Para agregar un editor (en Supabase): **Authentication → Users → Add user** con su correo, y en **SQL Editor**:

```sql
insert into public.editores (email) values ('correo@ejemplo.com');
```

## Cómo llegan los cambios al teléfono

- Al abrir, la app muestra lo guardado en el teléfono y enseguida trae lo nuevo de Supabase.
- Menú ⋯ → **🔄 Recargar datos** lo trae a mano.
- Sin conexión se usa lo último que se descargó.

## Respaldo

- Menú ⋯ → **📤 Exportar JSON** descarga todas las canciones y listas (mismo formato de siempre).
- Menú ⋯ → **📥 Importar JSON** (solo editores) sube un archivo así a Supabase. Una canción con el mismo título y artista se reemplaza; una lista con el mismo nombre toma las canciones del archivo.

Formato de cada canción:

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
- Para un medley, pon en `seccion` algo como `"Medley Dante Gebel"`. El orden de las canciones dentro del medley es el orden de la columna `orden`.
- En la app, filtro **Medleys → ✎ Orden** permite reordenar, **✎ Renombrar medley** y **Eliminar medley** (sus canciones no se borran: pasan a `General`).

## Listas (agenda para tocar en orden)

- Filtro **📋 Listas** muestra la agenda: cada lista tiene un **encabezado** y la **fecha del evento**.
- Arriba se elige el rango: **Próximas** (de hoy en adelante), **Este mes**, **Pasadas**, **Todas**, o fechas **Desde / Hasta**. El filtro se recuerda en cada teléfono.
- Las listas salen ordenadas por fecha. Las que no tienen fecha van al final y solo se ven en Próximas y Todas.
- Toca una lista para ver sus canciones en orden. **▶ Tocar** abre la primera; **Siguiente ›** pasa a la que sigue, y arriba se ve cuál viene y en qué tono. **← Volver** regresa a esa lista.
- Los editores crean listas (**➕ Nueva lista**, con la fecha de hoy), y en **✎ Editar** cambian el encabezado, la fecha, el orden (↑ ↓) y quitan canciones (✕). Una canción puede estar en varias listas o repetirse.
- **📋 Agregar a lista** (desde una canción) ofrece las listas de hoy en adelante.
- Las listas son compartidas: todos los teléfonos ven las mismas.

## Probar en la computadora

```bash
python -m http.server 8000
```

Abre `http://localhost:8000`. Para iniciar sesión en local, agrega `http://localhost:8000/**` en Supabase → Authentication → URL Configuration → Redirect URLs.

## Cuando cambies el código

Si cambias `index.html`, `styles.css`, `app.js`, `music.js` o `config.js`, sube el número de `VERSION` en `sw.js` (por ejemplo `cancionero-v13`). Si no, los teléfonos seguirán usando la copia vieja guardada.

Si cambias la versión de supabase-js, cámbiala en `index.html` (con su `integrity`) y en `sw.js`.

## Nota sobre derechos de autor

Agrega letras y acordes de canciones que tengas derecho a usar, o tus propios arreglos. Los datos de Supabase son de lectura pública.
