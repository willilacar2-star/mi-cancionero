// Importa canciones.json a Supabase (canciones, listas y lista_canciones).
//
// Uso (desde la carpeta del proyecto):
//   node --env-file=.env scripts/importar.mjs canciones.json
//   node --env-file=.env scripts/importar.mjs canciones.json --prueba   (solo revisa, no escribe)
//
// .env debe tener SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Nunca subas .env a GitHub.
// Si las tablas ya tienen canciones, el script se detiene para no duplicarlas.
// canciones.json ya no está en el repositorio: usa un respaldo de 📤 Exportar JSON
// (o recupéralo del historial: git show 942644b:canciones.json > canciones.json).

import { readFileSync } from 'node:fs';

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--')) || 'canciones.json';
const prueba = args.includes('--prueba');

function salir(msg) { console.error('✗ ' + msg); process.exit(1); }

if (!URL_BASE || !KEY) salir('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');

// La misma normalización que usa la app para comparar título + artista.
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function clave(titulo, artista) { return norm(titulo).trim() + '|' + norm(artista).trim(); }

// Igual que normSong() de app.js.
function normCancion(r, i) {
  if (!r || typeof r.titulo !== 'string' || !r.titulo.trim()) return null;
  const contenido = Array.isArray(r.contenido) ? r.contenido.map((sec) => ({
    tipo: sec.tipo || 'verso',
    titulo: String(sec.titulo || 'Letra'),
    lineas: (Array.isArray(sec.lineas) ? sec.lineas : []).map((l) => ({
      acordes: String((l && l.acordes) || ''), letra: String((l && l.letra) || '')
    }))
  })) : [];
  const est = Array.isArray(r.estructura) ? r.estructura.map((x) => String(x).trim()).filter(Boolean) : [];
  return {
    titulo: r.titulo.trim(), artista: String(r.artista || ''), tono: String(r.tono || ''),
    categoria: String(r.categoria || 'Alabanza'), seccion: String(r.seccion || 'General'),
    orden: i + 1, estructura: est.length ? est : null, contenido
  };
}

async function api(metodo, ruta, cuerpo) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  // Las claves antiguas (JWT) también van en Authorization; las nuevas sb_secret_ solo en apikey.
  if (KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + KEY;
  const r = await fetch(URL_BASE + '/rest/v1/' + ruta, {
    method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const txt = await r.text();
  if (!r.ok) salir(metodo + ' ' + ruta + ' → ' + r.status + ' ' + txt);
  return txt ? JSON.parse(txt) : null;
}

const datos = JSON.parse(readFileSync(archivo, 'utf8'));
const crudas = Array.isArray(datos) ? datos : (datos.canciones || []);
const canciones = crudas.map(normCancion).filter(Boolean);
const listas = (!Array.isArray(datos) && Array.isArray(datos.listas)) ? datos.listas : [];
if (!canciones.length) salir('El archivo no tiene canciones.');

const vistas = new Set();
for (const c of canciones) {
  const k = clave(c.titulo, c.artista);
  if (vistas.has(k)) console.warn('⚠ Repetida (mismo título y artista): ' + c.titulo);
  vistas.add(k);
}
console.log('Archivo: ' + canciones.length + ' canciones, ' + listas.length + ' listas.');

const existentes = await api('GET', 'canciones?select=id&limit=1');
if (existentes.length) salir('La tabla canciones ya tiene datos. No se importó nada para no duplicar.');
if (prueba) { console.log('Modo --prueba: la conexión funciona y las tablas están vacías. No se escribió nada.'); process.exit(0); }

// 1. Canciones (el orden del archivo pasa a la columna orden).
const insertadas = await api('POST', 'canciones?select=id,titulo,artista', canciones);
const porClave = new Map();
for (const c of insertadas) if (!porClave.has(clave(c.titulo, c.artista))) porClave.set(clave(c.titulo, c.artista), c.id);
console.log('✓ ' + insertadas.length + ' canciones importadas.');

// 2. Listas, enlazando cada canción por título + artista.
let n = 0;
for (const [i, L] of listas.entries()) {
  if (!L || typeof L.nombre !== 'string' || !L.nombre.trim()) continue;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(L.fecha || '')) ? L.fecha : null;
  const [lista] = await api('POST', 'listas?select=id', { nombre: L.nombre.trim(), orden: i + 1, ...(fecha ? { fecha } : {}) });
  const filas = [];
  for (const c of (Array.isArray(L.canciones) ? L.canciones : [])) {
    const id = c && porClave.get(clave(c.titulo, c.artista));
    if (id) filas.push({ lista_id: lista.id, cancion_id: id, posicion: filas.length + 1 });
    else console.warn('⚠ En la lista "' + L.nombre + '" no se encontró: ' + (c && c.titulo) + ' / ' + (c && c.artista));
  }
  if (filas.length) await api('POST', 'lista_canciones', filas);
  console.log('✓ Lista "' + L.nombre.trim() + '": ' + filas.length + ' canciones.');
  n++;
}
console.log('Listo: ' + insertadas.length + ' canciones y ' + n + ' listas en Supabase.');
