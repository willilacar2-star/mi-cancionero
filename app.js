(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function isMedley(s) { return /^medley/i.test(s.seccion || ''); }

  /* ---------- Almacenamiento (localStorage con respaldo en memoria) ---------- */
  var mem = {}, warned = false;
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
      catch (e) { return (k in mem) ? mem[k] : d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (e) {
        mem[k] = v;
        if (!warned) { warned = true; toast('Este navegador no deja guardar datos. Exporta un respaldo seguido.'); }
        return false;
      }
    },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} delete mem[k]; }
  };

  /* ---------- Estado ---------- */
  // cc_songs y cc_listas son la caché local de lo que hay en Supabase (para usar sin conexión).
  // Favoritos, transposición y preferencias son solo de este teléfono.
  var songs = store.get('cc_songs', []);
  if (!Array.isArray(songs)) songs = [];
  var favs = store.get('cc_favs', []);
  var shifts = store.get('cc_shifts', {});
  var prefs = store.get('cc_prefs', {});
  prefs.fs = prefs.fs || 15;
  prefs.modo = prefs.modo || 'ambos';
  prefs.vel = prefs.vel || 4;
  if (!prefs.theme) prefs.theme = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  // Restos de la versión que publicaba en GitHub.
  store.del('cc_ver'); store.del('cc_gh');

  // Listas para tocar en orden: [{ id, nombre, items: [idCanción, …] }]
  var listas = store.get('cc_listas', []);
  if (!Array.isArray(listas)) listas = [];

  var state = { filtro: 'todas' };
  var cur = null, editingId = null, listY = 0;
  var plCtx = null, curHash = '';

  function saveSongs() { store.set('cc_songs', songs); }
  function savePrefs() { store.set('cc_prefs', prefs); }
  // Los id son uuid de Supabase (texto); se comparan como texto.
  function findSong(id) { for (var i = 0; i < songs.length; i++) if (String(songs[i].id) === String(id)) return songs[i]; return null; }
  function saveListas() { store.set('cc_listas', listas); }
  function findLista(id) { for (var i = 0; i < listas.length; i++) if (String(listas[i].id) === String(id)) return listas[i]; return null; }
  function songKey(s) { return norm(s.titulo) + '|' + norm(s.artista); }
  function maxOrden(arr) { return arr.reduce(function (m, x) { return Math.max(m, x.orden || 0); }, 0); }

  /* ---------- Supabase ---------- */
  var CFG = window.CANCIONERO_CONFIG || {};
  var sb = null;
  try {
    // Sin conexión y sin supabase-js guardado, la app funciona igual con la caché.
    if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        // implicit: el enlace del correo funciona aunque se abra en otro navegador.
        auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
  } catch (e) { sb = null; }

  var COLS = 'id,titulo,artista,tono,categoria,seccion,orden,estructura,contenido';
  function filaACancion(r) {
    var s = {
      id: r.id, titulo: r.titulo, artista: r.artista || '', tono: r.tono || '',
      categoria: r.categoria || 'Alabanza', seccion: r.seccion || 'General', orden: r.orden || 0,
      contenido: Array.isArray(r.contenido) ? r.contenido : []
    };
    if (Array.isArray(r.estructura) && r.estructura.length) s.estructura = r.estructura;
    return s;
  }
  function cancionAFila(s) {
    return {
      titulo: s.titulo, artista: s.artista || '', tono: s.tono || '',
      categoria: s.categoria || 'Alabanza', seccion: s.seccion || 'General',
      estructura: s.estructura && s.estructura.length ? s.estructura : null,
      contenido: s.contenido || []
    };
  }

  // Revisa la respuesta de supabase-js (o varias) y lanza el error si lo hay.
  function chk(r) {
    (Array.isArray(r) ? r : [r]).forEach(function (x) { if (x && x.error) throw x.error; });
    return Array.isArray(r) ? r.map(function (x) { return x && x.data; }) : r && r.data;
  }
  // Con RLS, un cambio no permitido no da error: simplemente no cambia ninguna fila.
  // Para update/delete se pide .select('id') y aquí se revisa que haya cambiado algo.
  function afecta(p) {
    return p.then(function (r) {
      if (r && !r.error && Array.isArray(r.data) && !r.data.length) r.error = { code: 'SIN_FILAS', message: '' };
      return r;
    });
  }
  function sinRed(e) {
    return navigator.onLine === false || (e && /fetch|network|load failed/i.test(e.message || ''));
  }
  function msgError(e) {
    if (sinRed(e)) return 'Sin conexión: no se guardó. Inténtalo cuando tengas internet.';
    if (e && (e.code === '42501' || e.status === 401 || e.status === 403)) return 'No tienes permiso para editar. Revisa tu sesión (menú ⋯ → 🔐).';
    if (e && e.code === 'SIN_FILAS') return 'No se guardó: no se encontró en Supabase o no tienes permiso. Toca menú ⋯ → 🔄 Recargar datos.';
    return 'No se pudo guardar: ' + ((e && e.message) || 'error desconocido');
  }

  // Todo cambio va primero a Supabase; la caché local cambia solo si Supabase lo confirma.
  var ocupado = false;
  function guardar(enviar, alConfirmar) {
    if (!sb || !puedeEditar) { toast('Inicia sesión como editor para guardar cambios (menú ⋯ → 🔐).'); return Promise.resolve(false); }
    if (sinRed()) { toast(msgError()); return Promise.resolve(false); }
    if (ocupado) return Promise.resolve(false);
    ocupado = true;
    return Promise.resolve().then(enviar).then(function (r) {
      var datos = chk(r);
      if (alConfirmar) alConfirmar(datos);
      return true;
    }).catch(function (e) {
      toast(msgError(e)); return false;
    }).then(function (ok) { ocupado = false; return ok; });
  }

  /* ---------- Sesión de editor ---------- */
  var sesion = null, puedeEditar = false;

  /* ---------- Toast ---------- */
  var toastT;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.hidden = true; }, Math.max(2600, msg.length * 55));
  }

  /* ---------- Tema ---------- */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', prefs.theme);
    $('metaTheme').setAttribute('content', prefs.theme === 'dark' ? '#0c1a19' : '#f1f5f4');
    var icon = prefs.theme === 'dark' ? '☀️' : '🌙';
    Array.prototype.forEach.call(document.querySelectorAll('.js-theme'), function (b) { b.textContent = icon; });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.js-theme'), function (b) {
    b.addEventListener('click', function () {
      prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
      savePrefs(); applyTheme();
    });
  });

  /* ---------- Lista ---------- */
  function renderChips() {
    Array.prototype.forEach.call($('chips').children, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-f') === state.filtro ? 'true' : 'false');
    });
  }

  function itemHTML(s, numero, href) {
    var sub = [];
    if (s.artista) sub.push(esc(s.artista));
    if (isMedley(s) && state.filtro !== 'medleys') sub.push(esc(s.seccion));
    return '<a class="item" href="' + (href || '#/c/' + s.id) + '">' +
      (numero ? '<span class="num">' + numero + '.</span>' : '') +
      '<span class="txt"><div class="tit">' + esc(s.titulo) +
      (favs.indexOf(s.id) > -1 ? ' <span class="star" aria-label="Favorito">★</span>' : '') + '</div>' +
      (sub.length ? '<div class="sub">' + sub.join(' · ') + '</div>' : '') + '</span>' +
      '<span class="keytile' + (s.tono ? '' : ' empty') + '">' + (s.tono ? esc(s.tono) : '–') + '</span></a>';
  }

  function renderList() {
    renderChips();
    $('q').parentNode.hidden = state.filtro === 'listas';
    if (state.filtro === 'listas') { renderListas(); return; }
    var q = norm($('q').value.trim()), f = state.filtro;
    var arr = songs.filter(function (s) {
      if (f === 'favoritos' && favs.indexOf(s.id) < 0) return false;
      if (f === 'medleys' && !isMedley(s)) return false;
      if (f !== 'todas' && f !== 'favoritos' && f !== 'medleys' && f !== 'listas' && s.categoria !== f) return false;
      if (q) {
        var hay = norm([s.titulo, s.artista, s.tono, s.categoria, s.seccion].concat((s.contenido || []).map(function (c) { return c.titulo; })).join(' '));
        return q.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
      }
      return true;
    });
    $('count').textContent = arr.length + (arr.length === 1 ? ' canción' : ' canciones');

    if (!arr.length) {
      $('lista').innerHTML = '<div class="empty-msg">' + (
        !songs.length ? (cargando ? 'Cargando canciones…' : 'No hay canciones guardadas en este teléfono. Conéctate a internet y toca menú ⋯ → 🔄 Recargar datos.') :
        f === 'favoritos' && !q ? 'Aún no tienes favoritos. Abre una canción y toca “☆ Favorito”.' : 'No hay canciones con esa búsqueda o filtro.'
      ) + '</div>';
      return;
    }

    var html = '';
    if (f === 'medleys') {
      var grupos = [], mapa = {};
      arr.forEach(function (s) {
        if (!mapa[s.seccion]) { mapa[s.seccion] = []; grupos.push(s.seccion); }
        mapa[s.seccion].push(s);
      });
      var puedeOrdenar = !q && puedeEditar;
      if (!puedeOrdenar) ordenMed = null;
      grupos.forEach(function (g, gi) {
        var editando = ordenMed === g;
        html += '<div class="mhead"><span class="mtit">🎵 ' + esc(g) + '</span>' +
          (puedeOrdenar && !editando ? '<button class="btn mini" data-mo="' + esc(g) + '">✎ Orden</button>' : '') + '</div>';
        if (!editando) {
          mapa[g].forEach(function (s, i) { html += itemHTML(s, i + 1); });
          return;
        }
        html += '<div class="morden">';
        mapa[g].forEach(function (s, i, lst) {
          html += '<div class="item"><span class="num">' + (i + 1) + '.</span>' +
            '<span class="txt"><div class="tit">' + esc(s.titulo) + '</div></span>' +
            '<button class="btn icon" data-mv="-1" data-id="' + s.id + '" aria-label="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="btn icon" data-mv="1" data-id="' + s.id + '" aria-label="Bajar"' + (i === lst.length - 1 ? ' disabled' : '') + '>↓</button></div>';
        });
        html += '<div class="mactions">' +
          '<button class="btn" data-gmv="-1" data-g="' + esc(g) + '"' + (gi === 0 ? ' disabled' : '') + '>▲ Subir medley</button>' +
          '<button class="btn" data-gmv="1" data-g="' + esc(g) + '"' + (gi === grupos.length - 1 ? ' disabled' : '') + '>▼ Bajar medley</button>' +
          '<button class="btn pri" data-mlisto="1">Listo</button></div>' +
          '<div class="mactions">' +
          '<button class="btn" data-mren="' + esc(g) + '">✎ Renombrar medley</button>' +
          '<button class="btn danger" data-mdel="' + esc(g) + '">Eliminar medley</button></div></div>';
      });
    } else {
      arr.slice().sort(function (a, b) { return norm(a.titulo).localeCompare(norm(b.titulo), 'es'); })
        .forEach(function (s) { html += itemHTML(s); });
    }
    $('lista').innerHTML = html;
  }

  $('q').addEventListener('input', renderList);
  /* ---------- Orden de los medleys ---------- */
  var ordenMed = null;
  function grupoDe(g) { return songs.filter(function (s) { return isMedley(s) && s.seccion === g; }); }
  function gruposMedley() {
    var gs = [];
    songs.forEach(function (s) { if (isMedley(s) && gs.indexOf(s.seccion) < 0) gs.push(s.seccion); });
    return gs;
  }
  // Guarda en Supabase el orden de todas las canciones (columna orden = 1, 2, 3…).
  function guardarOrden(nuevo) {
    if (!nuevo) return;
    guardar(function () {
      return sb.rpc('reordenar_canciones', { ids: nuevo.map(function (s) { return s.id; }) });
    }, function () {
      songs = nuevo;
      songs.forEach(function (s, i) { s.orden = i + 1; });
      saveSongs(); renderList();
    });
  }
  // Mueve una canción dentro de su medley (intercambia su lugar con la vecina). Devuelve el orden nuevo.
  function moverCancion(id, d) {
    var s = findSong(id); if (!s) return null;
    var g = grupoDe(s.seccion), i = g.indexOf(s), o = g[i + d];
    if (!o) return null;
    var arr = songs.slice(), a = arr.indexOf(s), b = arr.indexOf(o);
    arr[a] = o; arr[b] = s;
    return arr;
  }
  // Mueve un medley completo antes o después del medley vecino. Devuelve el orden nuevo.
  function moverGrupo(g, d) {
    var gs = gruposMedley(), i = gs.indexOf(g), otro = gs[i + d];
    if (!otro) return null;
    var bloque = grupoDe(g);
    var arr = songs.filter(function (s) { return bloque.indexOf(s) < 0; });
    var ref = grupoDe(otro);
    var pos = d < 0 ? arr.indexOf(ref[0]) : arr.indexOf(ref[ref.length - 1]) + 1;
    Array.prototype.splice.apply(arr, [pos, 0].concat(bloque));
    return arr;
  }
  // Cambia el nombre de un medley en todas sus canciones (siempre empieza con "Medley").
  function renombrarMedley(g) {
    var v = prompt('Nuevo nombre del medley', g);
    if (v === null) return;
    v = v.trim().replace(/\s+/g, ' ');
    if (!v) { toast('Escribe un nombre'); return; }
    if (!isMedley({ seccion: v })) v = 'Medley ' + v;
    if (v === g) return;
    if (gruposMedley().indexOf(v) > -1 &&
        !confirm('Ya existe “' + v + '”. Las canciones de “' + g + '” se unirán a ese medley. ¿Continuar?')) return;
    guardar(function () {
      return afecta(sb.from('canciones').update({ seccion: v }).eq('seccion', g).select('id'));
    }, function () {
      var n = 0;
      songs.forEach(function (s) { if (isMedley(s) && s.seccion === g) { s.seccion = v; n++; } });
      ordenMed = v; saveSongs(); renderList();
      toast('Medley renombrado (' + n + (n === 1 ? ' canción' : ' canciones') + ')');
    });
  }
  // Deshace el medley: sus canciones quedan en el cancionero, en la sección General.
  function eliminarMedley(g) {
    var n = grupoDe(g).length;
    if (!confirm('¿Eliminar el medley “' + g + '”?\n\nSus ' + n + (n === 1 ? ' canción no se borra: pasa' : ' canciones no se borran: pasan') +
        ' a la sección General y las sigues encontrando en Todas.')) return;
    guardar(function () {
      return afecta(sb.from('canciones').update({ seccion: 'General' }).eq('seccion', g).select('id'));
    }, function () {
      songs.forEach(function (s) { if (isMedley(s) && s.seccion === g) s.seccion = 'General'; });
      ordenMed = null; saveSongs(); renderList();
      toast('Medley eliminado');
    });
  }

  $('lista').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-mo')) { ordenMed = b.getAttribute('data-mo'); }
    else if (b.hasAttribute('data-mlisto')) { ordenMed = null; }
    else if (b.hasAttribute('data-mv')) { e.preventDefault(); guardarOrden(moverCancion(b.getAttribute('data-id'), +b.getAttribute('data-mv'))); return; }
    else if (b.hasAttribute('data-gmv')) { e.preventDefault(); guardarOrden(moverGrupo(b.getAttribute('data-g'), +b.getAttribute('data-gmv'))); return; }
    else if (b.hasAttribute('data-mren')) { e.preventDefault(); renombrarMedley(b.getAttribute('data-mren')); return; }
    else if (b.hasAttribute('data-mdel')) { e.preventDefault(); eliminarMedley(b.getAttribute('data-mdel')); return; }
    else return;
    e.preventDefault();
    renderList();
  });

  $('chips').addEventListener('click', function (e) {
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    state.filtro = f;
    if (plAbierta) { plAbierta = null; plEdit = null; history.replaceState(null, '', '#/'); }
    renderList();
  });

  /* ---------- Fechas de las listas (agenda) ---------- */
  // Las fechas se guardan como texto 'AAAA-MM-DD' (columna date de Supabase), sin hora ni zona horaria.
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); }
  function hoyISO() { return iso(new Date()); }
  function fechaValida(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null; }
  function aFecha(s) { var p = String(s || '').split('-'); return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null; }
  function fechaLarga(s) {
    var d = aFecha(s);
    return d ? DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear() : 'Sin fecha';
  }
  function fechaCorta(s) { var d = aFecha(s); return d ? d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3) : ''; }

  // Filtro de la agenda (solo de este teléfono): proximas, mes, pasadas, todas o rango.
  function rangoAgenda() {
    var a = prefs.agenda || {}, d = new Date();
    if (a.modo === 'mes') return { desde: iso(new Date(d.getFullYear(), d.getMonth(), 1)), hasta: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
    if (a.modo === 'pasadas') { d.setDate(d.getDate() - 1); return { desde: '', hasta: iso(d) }; }
    if (a.modo === 'todas') return { desde: '', hasta: '' };
    if (a.modo === 'rango') return { desde: a.desde || '', hasta: a.hasta || '' };
    return { desde: hoyISO(), hasta: '' };  // próximas: de hoy en adelante
  }
  function modoAgenda() { return (prefs.agenda && prefs.agenda.modo) || 'proximas'; }
  // Listas dentro del rango, ordenadas por fecha. Las que no tienen fecha van al final
  // y solo se ven en "Próximas" y "Todas". En "Pasadas", la más reciente primero.
  function listasEnRango() {
    var r = rangoAgenda(), modo = modoAgenda(), desc = modo === 'pasadas';
    return listas.filter(function (L) {
      if (!L.fecha) return modo === 'proximas' || modo === 'todas';
      return (!r.desde || L.fecha >= r.desde) && (!r.hasta || L.fecha <= r.hasta);
    }).sort(function (a, b) {
      if (!a.fecha !== !b.fecha) return a.fecha ? -1 : 1;
      if (a.fecha !== b.fecha) return (a.fecha < b.fecha ? -1 : 1) * (desc ? -1 : 1);
      return (a.orden || 0) - (b.orden || 0);
    });
  }

  /* ---------- Listas: canciones en el orden en que se van a tocar ---------- */
  var plEdit = null, plQuery = '', plAbierta = null;
  function cancionesDe(L) { return L.items.map(findSong).filter(Boolean); }
  function limpiarLista(L) { L.items = L.items.filter(function (id) { return !!findSong(id); }); }

  function plRowsHTML(L) {
    if (!L.items.length) return '<p class="help">La lista está vacía. Busca canciones abajo para agregarlas.</p>';
    return L.items.map(function (id, i, lst) {
      var s = findSong(id);
      return '<div class="item"><span class="num">' + (i + 1) + '.</span>' +
        '<span class="txt"><div class="tit">' + esc(s.titulo) + '</div>' +
        (s.tono ? '<div class="sub">' + esc(s.tono) + '</div>' : '') + '</span>' +
        '<button class="btn icon" data-pl="up" data-i="' + i + '" aria-label="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="btn icon" data-pl="down" data-i="' + i + '" aria-label="Bajar"' + (i === lst.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="btn icon" data-pl="del" data-i="' + i + '" aria-label="Quitar de la lista">✕</button></div>';
    }).join('');
  }

  function plResHTML(L) {
    var q = norm(plQuery.trim());
    if (!q) return '<p class="help">Escribe parte del título, artista o tono.</p>';
    var arr = songs.filter(function (s) {
      var hay = norm([s.titulo, s.artista, s.tono, s.seccion].join(' '));
      return q.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
    }).sort(function (a, b) { return norm(a.titulo).localeCompare(norm(b.titulo), 'es'); }).slice(0, 25);
    if (!arr.length) return '<p class="help">No hay canciones con esa búsqueda.</p>';
    return arr.map(function (s) {
      var ya = L.items.indexOf(s.id) > -1;
      return '<button class="item plres" data-pl="add" data-id="' + s.id + '">' +
        '<span class="txt"><div class="tit">' + esc(s.titulo) + '</div>' +
        '<div class="sub">' + [s.artista ? esc(s.artista) : '', ya ? '✓ Ya está en la lista' : ''].filter(Boolean).join(' · ') + '</div></span>' +
        '<span class="keytile' + (s.tono ? '' : ' empty') + '">' + (s.tono ? esc(s.tono) : '–') + '</span>' +
        '<span class="plus" aria-hidden="true">＋</span></button>';
    }).join('');
  }

  // Sección Listas: agenda (filtro de fechas + encabezados) o, si hay una abierta, sus canciones.
  function renderListas() {
    listas.forEach(limpiarLista);
    if (!puedeEditar) plEdit = null;
    if (plAbierta) { renderListaAbierta(findLista(plAbierta)); return; }

    var modo = modoAgenda(), r = rangoAgenda(), arr = listasEnRango();
    $('count').textContent = arr.length + (arr.length === 1 ? ' lista' : ' listas');
    var html = '<div class="agenda"><div class="chips" role="group" aria-label="Fechas">' +
      [['proximas', 'Próximas'], ['mes', 'Este mes'], ['pasadas', 'Pasadas'], ['todas', 'Todas']].map(function (c) {
        return '<button class="chip" data-ag="' + c[0] + '" aria-pressed="' + (modo === c[0]) + '">' + c[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="agrango"><label>Desde<input type="date" id="agDesde" value="' + r.desde + '"></label>' +
      '<label>Hasta<input type="date" id="agHasta" value="' + r.hasta + '"></label></div></div>';
    if (puedeEditar) html += '<div class="mactions"><button class="btn pri" data-pl="nueva">➕ Nueva lista</button></div>';

    if (!arr.length) {
      html += '<div class="empty-msg">' + (listas.length
        ? 'No hay listas en estas fechas.'
        : puedeEditar ? 'Aún no hay listas. Crea una con la fecha del evento y agrega las canciones en el orden en que se van a tocar.'
          : 'Aún no hay listas. Un editor puede crearlas después de iniciar sesión (menú ⋯ → 🔐).') + '</div>';
    }
    arr.forEach(function (L) {
      var d = aFecha(L.fecha), n = L.items.length;
      html += '<a class="item" href="#/l/' + L.id + '">' +
        '<span class="fechatile' + (d ? '' : ' empty') + '">' + (d ? '<b>' + d.getDate() + '</b><small>' + MESES[d.getMonth()].slice(0, 3) + '</small>' : '<small>sin<br>fecha</small>') + '</span>' +
        '<span class="txt"><div class="tit">' + esc(L.nombre) + '</div>' +
        '<div class="sub">' + (d ? DIAS[d.getDay()] + ' · ' : '') + n + (n === 1 ? ' canción' : ' canciones') + '</div></span>' +
        '<span class="chev" aria-hidden="true">›</span></a>';
    });
    $('lista').innerHTML = html;
  }

  // Una lista abierta: encabezado, fecha y canciones en orden (o el formulario si se está editando).
  function renderListaAbierta(L) {
    var html = '<div class="mactions"><a class="btn" href="#/">‹ Listas</a></div>';
    if (!L) {
      $('count').textContent = '';
      $('lista').innerHTML = html + '<div class="empty-msg">No se encontró esta lista. Puede que la hayan borrado.</div>';
      return;
    }
    $('count').textContent = L.items.length + (L.items.length === 1 ? ' canción' : ' canciones');
    if (String(plEdit) === String(L.id)) {
      html += '<div class="mhead"><span class="mtit">✎ Editando lista</span></div>' +
        '<div class="morden plform">' +
        '<label class="pllbl" for="plNombre">Encabezado</label>' +
        '<input id="plNombre" class="plinput" value="' + esc(L.nombre) + '" autocomplete="off" placeholder="Ej. Culto domingo 10 am">' +
        '<label class="pllbl" for="plFecha">Fecha del evento</label>' +
        '<input id="plFecha" class="plinput" type="date" value="' + (L.fecha || '') + '">' +
        '<div class="pllbl">Orden</div><div id="plRows">' + plRowsHTML(L) + '</div>' +
        '<label class="pllbl" for="plBuscar">Agregar canciones</label>' +
        '<input id="plBuscar" class="plinput" type="search" value="' + esc(plQuery) + '" autocomplete="off" placeholder="🔎 Buscar canción…" enterkeyhint="search">' +
        '<div id="plRes">' + plResHTML(L) + '</div>' +
        '<div class="mactions"><button class="btn danger" data-pl="borrar">Eliminar lista</button>' +
        '<button class="btn pri" data-pl="listo">Listo</button></div></div>';
      $('lista').innerHTML = html;
      return;
    }
    html += '<div class="lhead"><h2>📋 ' + esc(L.nombre) + '</h2><div class="muted">' + esc(fechaLarga(L.fecha)) + '</div></div>' +
      '<div class="mactions">' +
      (L.items.length ? '<a class="btn pri" href="#/l/' + L.id + '/0">▶ Tocar</a>' : '') +
      (puedeEditar ? '<button class="btn" data-pl="edit">✎ Editar</button>' : '') + '</div>';
    cancionesDe(L).forEach(function (s, i) { html += itemHTML(s, i + 1, '#/l/' + L.id + '/' + i); });
    if (!L.items.length) html += '<p class="help">Lista vacía.' + (puedeEditar ? ' Toca ✎ Editar para agregar canciones.' : '') + '</p>';
    $('lista').innerHTML = html;
  }

  // Crea una lista vacía en Supabase (con la fecha de hoy) y la agrega al final.
  function crearLista(alCrear) {
    return guardar(function () {
      return sb.from('listas').insert({ nombre: 'Lista ' + (listas.length + 1), fecha: hoyISO(), orden: maxOrden(listas) + 1 })
        .select('id,nombre,fecha,orden').single();
    }, function (r) {
      var L = { id: r.id, nombre: r.nombre, fecha: r.fecha || null, orden: r.orden, items: [] };
      listas.push(L); saveListas();
      if (alCrear) alCrear(L);
    });
  }
  // Guarda en Supabase las canciones de una lista en el orden nuevo.
  function guardarItems(L, items, alConfirmar) {
    return guardar(function () {
      return sb.rpc('guardar_lista', { p_lista: L.id, p_canciones: items });
    }, function () {
      L.items = items; saveListas();
      if (alConfirmar) alConfirmar();
    });
  }

  // El nombre se guarda mientras se escribe, un momento después de la última tecla.
  var nombreT = 0, nombrePend = null;
  function guardarNombre() {
    clearTimeout(nombreT);
    var p = nombrePend; nombrePend = null;
    if (!p || !sb || !puedeEditar) return;
    afecta(sb.from('listas').update({ nombre: p.nombre }).eq('id', p.L.id).select('id'))
      .then(chk).catch(function (e) { toast(msgError(e)); });
  }

  // La fecha se guarda al elegirla en el calendario.
  function guardarFecha(L, fecha) {
    if (!sb || !puedeEditar) return;
    afecta(sb.from('listas').update({ fecha: fecha }).eq('id', L.id).select('id'))
      .then(chk).then(function () {
        L.fecha = fecha; saveListas();
        toast(fecha ? 'Fecha: ' + fechaLarga(fecha) : 'Lista sin fecha');
      }).catch(function (e) {
        toast(msgError(e));
        var inp = $('plFecha'); if (inp) inp.value = L.fecha || '';
      });
  }

  function plAccion(act, b) {
    var L = findLista(plEdit), i = +b.getAttribute('data-i'), x;
    if (act === 'nueva') {
      crearLista(function (N) {
        plEdit = N.id; plQuery = '';
        // pushState + route() en vez de location.hash: así el formulario ya existe al poner el foco.
        history.pushState(null, '', '#/l/' + N.id); route();
        var inp = $('plNombre'); if (inp) { inp.focus(); inp.select(); }
      });
      return;
    }
    if (act === 'edit') { plEdit = plAbierta; plQuery = ''; renderList(); return; }
    if (!L) return;
    if (act === 'listo') { guardarNombre(); plEdit = null; renderList(); return; }
    if (act === 'borrar') {
      if (!confirm('¿Eliminar la lista “' + L.nombre + '”? Las canciones no se borran.')) return;
      nombrePend = null;
      guardar(function () {
        return afecta(sb.from('listas').delete().eq('id', L.id).select('id'));
      }, function () {
        listas = listas.filter(function (l) { return l !== L; });
        plEdit = null; saveListas(); toast('Lista eliminada');
        location.hash = '#/';
      });
      return;
    }
    var items = L.items.slice(), msg = '';
    if (act === 'up' && i > 0) { x = items[i - 1]; items[i - 1] = items[i]; items[i] = x; }
    else if (act === 'down' && i < items.length - 1) { x = items[i + 1]; items[i + 1] = items[i]; items[i] = x; }
    else if (act === 'del') { items.splice(i, 1); }
    else if (act === 'add') {
      var s = findSong(b.getAttribute('data-id'));
      if (!s) return;
      items.push(s.id); msg = '“' + s.titulo + '” agregada (' + items.length + ')';
    } else return;
    guardarItems(L, items, function () {
      if (msg) toast(msg);
      // Solo se redibuja el orden y los resultados, para no cerrar el teclado.
      if (String(plEdit) !== String(L.id) || !$('plRows')) return;
      $('plRows').innerHTML = plRowsHTML(L);
      $('plRes').innerHTML = plResHTML(L);
    });
  }

  $('lista').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pl]');
    if (!b || b.disabled) return;
    e.preventDefault();
    plAccion(b.getAttribute('data-pl'), b);
  });
  // Agenda: botones de rango rápido y fechas Desde / Hasta.
  $('lista').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ag]');
    if (!b) return;
    prefs.agenda = { modo: b.getAttribute('data-ag') }; savePrefs(); renderList();
  });
  $('lista').addEventListener('change', function (e) {
    if (e.target.id === 'agDesde' || e.target.id === 'agHasta') {
      prefs.agenda = { modo: 'rango', desde: $('agDesde').value, hasta: $('agHasta').value };
      savePrefs(); renderList();
    } else if (e.target.id === 'plFecha') {
      var L = findLista(plEdit);
      if (L) guardarFecha(L, fechaValida(e.target.value));
    }
  });
  $('lista').addEventListener('input', function (e) {
    var L = findLista(plEdit);
    if (!L) return;
    if (e.target.id === 'plBuscar') { plQuery = e.target.value; $('plRes').innerHTML = plResHTML(L); }
    else if (e.target.id === 'plNombre') {
      L.nombre = e.target.value.trim() || 'Sin nombre'; saveListas();
      nombrePend = { L: L, nombre: L.nombre };
      clearTimeout(nombreT); nombreT = setTimeout(guardarNombre, 800);
    }
  });

  /* Agregar la canción abierta a una lista */
  // Se ofrecen las listas de hoy en adelante (y las que no tienen fecha), la más próxima primero.
  function renderPlAdd() {
    var hoy = hoyISO(), prox = listas.filter(function (L) { return !L.fecha || L.fecha >= hoy; }).sort(function (a, b) {
      if (!a.fecha !== !b.fecha) return a.fecha ? -1 : 1;
      return a.fecha === b.fecha ? (a.orden || 0) - (b.orden || 0) : (a.fecha < b.fecha ? -1 : 1);
    });
    var h = '<b>Agregar “' + esc(cur.titulo) + '” a…</b><div class="stadd">';
    prox.forEach(function (L) {
      var n = L.items.filter(function (id) { return id === cur.id; }).length;
      h += '<button class="chip" data-pa="' + L.id + '">📋 ' + esc(L.nombre) + (L.fecha ? ' · ' + fechaCorta(L.fecha) : '') + (n ? ' ✓' : '') + '</button>';
    });
    h += '<button class="chip" data-pa="nueva">➕ Nueva lista</button></div>';
    if (!prox.length) h += '<p class="help">No hay listas de hoy en adelante. Crea una con esta canción.</p>';
    $('plAdd').innerHTML = h;
  }
  $('bLista').addEventListener('click', function () {
    var abrir = $('plAdd').hidden;
    $('plAdd').hidden = !abrir;
    this.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    if (abrir) renderPlAdd();
  });
  $('plAdd').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pa]');
    if (!b || !cur) return;
    var v = b.getAttribute('data-pa'), s = cur;
    function agregar(L) {
      return guardarItems(L, L.items.concat([s.id]), function () {
        $('plAdd').hidden = true; $('bLista').setAttribute('aria-expanded', 'false');
        toast('Agregada a “' + L.nombre + '” (' + L.items.length + ')');
      });
    }
    if (v === 'nueva') {
      // La lista se crea primero; agregar la canción es otro paso, por eso se libera "ocupado" antes.
      crearLista(function (N) { setTimeout(function () { agregar(N); }, 0); });
      return;
    }
    var L = findLista(v);
    if (!L) return;
    if (L.items.indexOf(s.id) > -1 && !confirm('“' + s.titulo + '” ya está en “' + L.nombre + '”. ¿Agregarla otra vez?')) return;
    agregar(L);
  });

  /* ---------- Menú ---------- */
  function closeMenu() { $('menu').hidden = true; $('bMenu').setAttribute('aria-expanded', 'false'); }
  $('bMenu').addEventListener('click', function (e) {
    e.stopPropagation();
    var open = $('menu').hidden;
    $('menu').hidden = !open;
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', function (e) {
    if (!$('menu').hidden && !$('menu').contains(e.target)) closeMenu();
  });
  $('menu').addEventListener('click', function (e) { if (e.target.closest('a,button')) closeMenu(); });

  /* ---------- Importar / exportar ---------- */
  function normSong(r) {
    if (!r || typeof r.titulo !== 'string' || !r.titulo.trim()) return null;
    var cont = Array.isArray(r.contenido) ? r.contenido.map(function (sec) {
      return {
        tipo: sec.tipo || 'verso',
        titulo: String(sec.titulo || 'Letra'),
        lineas: (Array.isArray(sec.lineas) ? sec.lineas : []).map(function (l) {
          return { acordes: String((l && l.acordes) || ''), letra: String((l && l.letra) || '') };
        })
      };
    }) : [];
    var est = Array.isArray(r.estructura) ? r.estructura.map(function (x) { return String(x).trim(); }).filter(Boolean) : [];
    var o = {
      id: 0, titulo: r.titulo.trim(), artista: String(r.artista || ''), tono: String(r.tono || ''),
      categoria: String(r.categoria || 'Alabanza'), seccion: String(r.seccion || 'General'), contenido: cont
    };
    if (est.length) o.estructura = est;
    return o;
  }

  /* ---------- Datos desde Supabase ---------- */
  // Trae canciones y listas y actualiza la caché. Si falla (sin conexión), la app sigue con la caché.
  var cargando = null;
  function cargarRemoto(avisar) {
    if (!sb) {
      if (avisar) toast('Sin conexión con Supabase. Se usan los datos guardados en este teléfono.');
      return Promise.resolve(false);
    }
    if (cargando) return cargando;
    // Si el teléfono ya sabe que no tiene red, no se espera a los reintentos de supabase-js.
    if (sinRed()) {
      if (avisar) toast('Sin conexión. Se usan los datos guardados en este teléfono.');
      return Promise.resolve(false);
    }
    cargando = Promise.all([
      sb.from('canciones').select(COLS).order('orden').order('titulo'),
      sb.from('listas').select('*,lista_canciones(cancion_id,posicion)').order('orden').order('nombre')
    ]).then(function (r) {
      cargando = null;
      var d = chk(r);
      var nuevas = d[0].map(filaACancion);
      var nuevasListas = d[1].map(function (l) {
        var it = (l.lista_canciones || []).slice().sort(function (a, b) { return a.posicion - b.posicion; });
        return { id: l.id, nombre: l.nombre, fecha: l.fecha || null, orden: l.orden, items: it.map(function (x) { return x.cancion_id; }) };
      });
      migrarIds(songs, nuevas);
      var cambio = JSON.stringify(nuevas) !== JSON.stringify(songs) || JSON.stringify(nuevasListas) !== JSON.stringify(listas);
      songs = nuevas; listas = nuevasListas;
      saveSongs(); saveListas();
      if (cambio || !songs.length) refrescarVista();  // sin canciones, también quita el "Cargando…"
      if (avisar) toast('Datos al día: ' + songs.length + ' canciones, ' + listas.length + (listas.length === 1 ? ' lista' : ' listas'));
      return true;
    }).catch(function (e) {
      cargando = null;
      var red = sinRed(e) || !(e && e.code);
      if (avisar || !red) {
        toast(red ? 'Sin conexión. Se usan los datos guardados en este teléfono.' : 'No se pudieron leer las canciones: ' + ((e && e.message) || 'error'));
      }
      if (!songs.length) refrescarVista();  // quita el "Cargando…"
      return false;
    });
    return cargando;
  }

  // La versión anterior usaba números como id. Pasa favoritos y transposición a los id nuevos (por título + artista).
  function migrarIds(viejas, nuevas) {
    var porId = {}, porClave = {}, hay = false;
    viejas.forEach(function (s) { if (typeof s.id === 'number') { porId[s.id] = songKey(s); hay = true; } });
    if (!hay) return;
    nuevas.forEach(function (s) { if (!porClave[songKey(s)]) porClave[songKey(s)] = s.id; });
    function nuevo(id) { return /^\d+$/.test(String(id)) ? porClave[porId[+id]] : id; }
    favs = favs.map(nuevo).filter(Boolean);
    var sh = {};
    Object.keys(shifts).forEach(function (k) { var n = nuevo(k); if (n) sh[n] = shifts[k]; });
    shifts = sh;
    store.set('cc_favs', favs); store.set('cc_shifts', shifts);
  }

  // Vuelve a dibujar la pantalla con los datos nuevos, sin tocar lo que se está editando.
  function refrescarVista() {
    if (!$('vEditor').hidden) return;
    if (!$('vLista').hidden) { if (!plEdit && !ordenMed) renderList(); return; }
    if (!$('vCancion').hidden && cur) {
      if (auto.on || stOpen) return;
      var s = findSong(cur.id), ctx = null;
      if (!s) { location.hash = '#/'; return; }
      if (plCtx) {
        ctx = { lista: findLista(plCtx.lista.id), i: plCtx.i };
        if (!ctx.lista || String(ctx.lista.items[ctx.i]) !== String(s.id)) { location.hash = '#/'; return; }
      }
      var y = window.scrollY;
      showSong(s.id, ctx); window.scrollTo(0, y);
    }
  }

  $('mRec').addEventListener('click', function () { cargarRemoto(true); });
  window.addEventListener('online', function () { cargarRemoto(); });

  /* ---------- Importar (a Supabase) ---------- */
  $('mImp').addEventListener('click', function () {
    if (!puedeEditar) { toast('Inicia sesión como editor para importar (menú ⋯ → 🔐).'); return; }
    $('fileImp').click();
  });
  $('fileImp').addEventListener('change', function () {
    var file = this.files[0], input = this;
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var nuevas, lsImp;
      try {
        var data = JSON.parse(rd.result);
        lsImp = (data && !Array.isArray(data) && Array.isArray(data.listas)) ? data.listas : [];
        if (data && !Array.isArray(data) && Array.isArray(data.canciones)) data = data.canciones;
        if (!Array.isArray(data)) throw new Error('formato');
        nuevas = data.map(normSong).filter(Boolean);
        if (!nuevas.length) throw new Error('vacío');
      } catch (err) {
        toast('El archivo no es un JSON de canciones válido.');
        return;
      }
      if (!confirm('Se importarán ' + nuevas.length + ' canciones a Supabase. Si ya existe una con el mismo título y artista, se reemplaza. ¿Continuar?')) return;
      importar(nuevas, lsImp);
    };
    rd.readAsText(file);
    input.value = '';
  });

  // Canciones: misma clave título + artista se reemplaza, las demás se agregan al final.
  // Listas: una con el mismo nombre toma las canciones del archivo; las demás se crean.
  function importar(nuevas, lsImp) {
    var porClave = {}, filas = {}, claves = [], orden = maxOrden(songs), add = 0, upd = 0, nLis = 0, faltan = 0;
    songs.forEach(function (s) { if (!porClave[songKey(s)]) porClave[songKey(s)] = s; });
    nuevas.forEach(function (n) {
      var k = songKey(n), f = cancionAFila(n);
      if (filas[k]) { f.id = filas[k].id; f.orden = filas[k].orden; filas[k] = f; return; }  // repetida en el archivo: vale la última
      var ex = porClave[k];
      if (ex) { f.id = ex.id; f.orden = ex.orden; upd++; }
      else { f.id = crypto.randomUUID(); f.orden = ++orden; add++; }
      filas[k] = f; claves.push(k);
    });
    guardar(function () {
      return sb.from('canciones').upsert(claves.map(function (k) { return filas[k]; }), { onConflict: 'id' }).then(function (r) {
        var cadena = Promise.resolve(r), ordenL = maxOrden(listas);
        (lsImp || []).forEach(function (R) {
          if (!R || typeof R.nombre !== 'string' || !R.nombre.trim()) return;
          var items = [], ex = null;
          (Array.isArray(R.canciones) ? R.canciones : []).forEach(function (c) {
            var f = c && (filas[songKey(c)] || porClave[songKey(c)]);
            if (f) items.push(f.id); else faltan++;
          });
          var fR = fechaValida(R.fecha);
          listas.forEach(function (L) { if (!ex && norm(L.nombre) === norm(R.nombre) && (L.fecha || null) === fR) ex = L; });
          var id = ex ? ex.id : crypto.randomUUID();
          cadena = cadena.then(function (prev) {
            if (prev && prev.error) return prev;
            var crear = ex ? Promise.resolve({}) : sb.from('listas').insert(Object.assign({ id: id, nombre: R.nombre.trim(), orden: ++ordenL }, fR ? { fecha: fR } : {}));
            return crear.then(function (c) {
              if (c.error) return c;
              nLis++;
              return sb.rpc('guardar_lista', { p_lista: id, p_canciones: items });
            });
          });
        });
        return cadena;
      });
    }, function () {
      cargarRemoto().then(function () {
        toast(add + ' nuevas, ' + upd + ' actualizadas' + (nLis ? ' · ' + nLis + (nLis === 1 ? ' lista' : ' listas') : '') +
          (faltan ? ' · ' + faltan + ' canciones de listas no se encontraron' : ''));
      });
    });
  }

  /* ---------- Exportar (respaldo) ---------- */
  // El mismo formato que usaba canciones.json (sin id ni orden internos). Se puede volver a cargar con Importar JSON.
  function jsonCanciones() {
    var limpio = songs.map(function (x) { var c = Object.assign({}, x); delete c.id; delete c.orden; return c; });
    var ls = listas.map(function (L) {
      return {
        nombre: L.nombre,
        fecha: L.fecha || null,
        canciones: L.items.map(findSong).filter(Boolean).map(function (s) { return { titulo: s.titulo, artista: s.artista || '' }; })
      };
    });
    return JSON.stringify({ canciones: limpio, listas: ls }, null, 2);
  }

  $('mExp').addEventListener('click', function () {
    var blob = new Blob([jsonCanciones()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'canciones-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 600);
    toast('Respaldo exportado');
  });

  /* ---------- Sesión de editor (enlace o código del correo) ---------- */
  function lgEstado(txt, cls) { var el = $('lgEstado'); el.textContent = txt || ''; el.className = 'dlgestado' + (cls ? ' ' + cls : ''); }
  function pintarSesion() {
    var email = sesion && sesion.user && sesion.user.email;
    document.body.classList.toggle('editor', puedeEditar);
    $('mSes').textContent = email ? '🔐 Sesión: ' + email : '🔐 Iniciar sesión';
    $('lgFuera').hidden = !!email; $('lgDentro').hidden = !email;
    $('lgEmail').textContent = email || '';
    $('lgRol').textContent = puedeEditar ? '✓ Puedes editar canciones y listas.' : 'Este correo no está autorizado como editor.';
  }
  // Con sesión, se pregunta a Supabase si el correo está en editores.
  function aplicarSesion(s) {
    sesion = s || null;
    var antes = puedeEditar;
    function fin(v) {
      puedeEditar = v; store.set('cc_editor', v); pintarSesion();
      if (antes === v) return;
      if (!v) { stOpen = false; plEdit = null; ordenMed = null; }
      if (!v && !$('vEditor').hidden) location.hash = '#/'; else refrescarVista();
    }
    if (!sesion) { fin(false); return; }
    sb.rpc('es_editor').then(function (r) { fin(!!chk(r)); })
      .catch(function () { fin(!!store.get('cc_editor', false)); });  // sin conexión: lo último que se supo
  }

  // Al volver del enlace del correo, la dirección trae #access_token=… (o #error=…).
  var hashAuth = /(^|[#&])(access_token|error_description)=/.test(location.hash) ? location.hash : '';
  if (sb) {
    sb.auth.onAuthStateChange(function (ev, s) {
      // supabase-js pide no llamar a Supabase dentro de este aviso: se hace justo después.
      setTimeout(function () {
        if (hashAuth) {
          var err = /error_description=([^&]*)/.exec(hashAuth);
          hashAuth = '';
          history.replaceState(null, '', location.pathname + location.search + '#/');
          if (err) toast('No se pudo iniciar sesión: ' + decodeURIComponent(err[1].replace(/\+/g, ' ')) + '. Pide un enlace nuevo.');
          else if (s) toast('Sesión iniciada: ' + s.user.email);
        }
        if (ev === 'TOKEN_REFRESHED') { sesion = s; return; }
        aplicarSesion(s);
      }, 0);
    });
  }

  function abrirLogin() {
    lgEstado(''); pintarSesion();
    var d = $('loginDlg');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  $('mSes').addEventListener('click', function () {
    if (!sb) { toast('Sin conexión con Supabase. Inténtalo cuando tengas internet.'); return; }
    abrirLogin();
  });
  $('lgEnviar').addEventListener('click', function () {
    var email = $('lgCorreo').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { lgEstado('Escribe un correo válido.', 'mal'); $('lgCorreo').focus(); return; }
    lgEstado('Enviando…');
    // shouldCreateUser: false → solo entran los usuarios que ya creaste en Supabase.
    sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } })
      .then(function (r) {
        if (r.error) throw r.error;
        $('lgCodigoBox').hidden = false;
        lgEstado('✓ Te enviamos un correo a ' + email + '.', 'ok');
      }).catch(function (e) {
        var m = (e && e.message) || '';
        lgEstado(sinRed(e) ? 'Sin conexión. Inténtalo cuando tengas internet.'
          : /signup|not allowed|not found/i.test(m) ? 'Ese correo no está registrado como editor.'
          : /rate|seconds|security purposes/i.test(m) ? 'Espera un momento antes de pedir otro correo.'
          : 'No se pudo enviar: ' + m, 'mal');
      });
  });
  $('lgVerificar').addEventListener('click', function () {
    var email = $('lgCorreo').value.trim().toLowerCase(), code = $('lgCodigo').value.replace(/\s/g, '');
    if (!code) { lgEstado('Escribe el código del correo.', 'mal'); $('lgCodigo').focus(); return; }
    lgEstado('Revisando…');
    sb.auth.verifyOtp({ email: email, token: code, type: 'email' }).then(function (r) {
      if (r.error) throw r.error;
      $('lgCodigo').value = ''; $('lgCodigoBox').hidden = true;
      lgEstado('✓ Sesión iniciada.', 'ok');
    }).catch(function (e) {
      lgEstado(sinRed(e) ? 'Sin conexión. Inténtalo cuando tengas internet.' : 'El código no es válido o ya venció. Pide otro correo.', 'mal');
    });
  });
  $('lgSalir').addEventListener('click', function () {
    sb.auth.signOut({ scope: 'local' }).then(function () { lgEstado('Sesión cerrada.'); });
  });

  /* ---------- Canción ---------- */
  function setFav(on) {
    var b = $('bFav');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = (on ? '★' : '☆') + ' Favorito';
  }
  $('bFav').addEventListener('click', function () {
    if (!cur) return;
    var i = favs.indexOf(cur.id);
    if (i > -1) favs.splice(i, 1); else favs.push(cur.id);
    store.set('cc_favs', favs); setFav(i < 0);
  });

  function medNavHTML() {
    if (plCtx) {
      var L = plCtx.lista, k = plCtx.i, n = L.items.length;
      var ant = k > 0 ? '#/l/' + L.id + '/' + (k - 1) : '', sig = k < n - 1 ? '#/l/' + L.id + '/' + (k + 1) : '';
      var prox = sig ? findSong(L.items[k + 1]) : null;
      return '<a class="btn" href="' + (ant || '#') + '"' + (ant ? '' : ' aria-disabled="true"') + '>‹ Anterior</a>' +
        '<span class="mid">📋 ' + esc(L.nombre) + ' · ' + (k + 1) + ' de ' + n +
        '<br>' + (prox ? 'Sigue: ' + esc(prox.titulo) + (prox.tono ? ' (' + esc(prox.tono) + ')' : '') : 'Última canción') + '</span>' +
        '<a class="btn' + (sig ? ' pri' : '') + '" href="' + (sig || '#') + '"' + (sig ? '' : ' aria-disabled="true"') + '>Siguiente ›</a>';
    }
    if (!isMedley(cur)) return '';
    var grupo = songs.filter(function (s) { return s.seccion === cur.seccion; });
    var i = grupo.indexOf(cur);
    var prev = grupo[i - 1], next = grupo[i + 1];
    return '<a class="btn" href="' + (prev ? '#/c/' + prev.id : '#') + '"' + (prev ? '' : ' aria-disabled="true"') + '>‹ Anterior</a>' +
      '<span class="mid">🎵 ' + esc(cur.seccion) + '<br>' + (i + 1) + ' de ' + grupo.length + '</span>' +
      '<a class="btn" href="' + (next ? '#/c/' + next.id : '#') + '"' + (next ? '' : ' aria-disabled="true"') + '>Siguiente ›</a>';
  }

  /* ---------- Estructura de la canción ---------- */
  var stOpen = false;
  function titulosDe(x) { return (x.contenido || []).map(function (c) { return c.titulo; }); }
  function tieneEst(x) { return !!(x.estructura && x.estructura.length); }
  function estructuraDe(x) { return tieneEst(x) ? x.estructura : titulosDe(x); }
  // "Coro (x4)", "Verso (voz de hombre)" o "Coro x2" usan la parte "Coro" / "Verso".
  function quitarNota(t) { return String(t).replace(/\s*(\([^()]*\)|[x×]\s*\d+)\s*$/i, '').trim(); }
  function buscarSec(x, t) {
    var c = x.contenido || [], k = norm(t), k2 = norm(quitarNota(t)), i;
    for (i = 0; i < c.length; i++) if (norm(c[i].titulo) === k) return c[i];
    if (k2 && k2 !== k) for (i = 0; i < c.length; i++) if (norm(c[i].titulo) === k2) return c[i];
    return null;
  }

  // Acordes y letra en bloques por palabra (cada acorde va con la palabra donde cae).
  // Así una línea larga baja al siguiente renglón sin perder la alineación ni pedir scroll horizontal.
  function lineaAmbos(ch, ly) {
    var toks = [], re = /\s+|\S+\s*/g, m;
    while ((m = re.exec(ly))) toks.push({ s: m.index, e: m.index + m[0].length, l: m[0], mk: [] });
    var cola = null;
    re = /\S+/g;
    while ((m = re.exec(ch))) {
      var t = null;
      for (var i = 0; i < toks.length; i++) if (m.index >= toks[i].s && m.index < toks[i].e) { t = toks[i]; break; }
      if (!t) { if (!cola) toks.push(cola = { s: ly.length, e: Infinity, l: '', mk: [] }); t = cola; }
      t.mk.push({ p: m.index, t: m[0] });
    }
    function fin(t) { return t.mk.reduce(function (x, k) { return Math.max(x, k.p + k.t.length); }, 0); }
    // Si un acorde se sale de su palabra y llega a la siguiente, se unen las dos
    // para que el acorde quede encima como en el original, sin abrir huecos en la letra.
    for (var k = 0; k < toks.length - 1; k++) {
      while (k < toks.length - 1 && (fin(toks[k]) > toks[k].e || (fin(toks[k]) === toks[k].e && toks[k + 1].mk.length))) {
        var nx = toks.splice(k + 1, 1)[0];
        toks[k].l += nx.l; toks[k].e = nx.e; toks[k].mk = toks[k].mk.concat(nx.mk);
      }
    }
    toks.forEach(function (t) {
      t.c = '';
      t.mk.forEach(function (x) {
        var off = x.p - t.s;
        t.c += t.c.length < off ? new Array(off - t.c.length + 1).join(' ') : (t.c ? ' ' : '');
        t.c += x.t;
      });
    });
    return toks.map(function (t) {
      // Si aún así el acorde es más largo, deja un espacio para que no se pegue al siguiente.
      if (t.c && t.c.length >= t.l.length) t.c += ' ';
      return '<span class="u"><span class="ch">' + (t.c ? esc(t.c) : '&nbsp;') + '</span>' +
        '<span class="ly">' + (t.l ? esc(t.l) : '&nbsp;') + '</span></span>';
    }).join('');
  }

  function secRows(sec, n, flat, modo) {
    var rows = '';
    (sec.lineas || []).forEach(function (l) {
      var ch = l.acordes ? Music.transposeLine(l.acordes, n, flat) : '';
      var ly = l.letra || '', r = '', cls = 'ln';
      if (modo === 'letra') { if (ly) r = '<div class="ly">' + esc(ly) + '</div>'; }
      else if (modo === 'acordes') { if (ch) r = '<div class="ch">' + esc(ch) + '</div>'; }
      else if (ch.trim() && ly.trim()) { r = lineaAmbos(ch, ly); cls = 'ln w'; }
      else {
        if (ch) r += '<div class="ch">' + esc(ch) + '</div>';
        if (ly) r += '<div class="ly">' + esc(ly) + '</div>';
      }
      if (r) rows += '<div class="' + cls + '">' + r + '</div>';
    });
    return rows;
  }

  function renderSong() {
    var s = cur, n = shifts[s.id] || 0;
    var flat = n ? Music.useFlats(s.tono, n) : false;
    var modo = prefs.modo, out = '';
    var chips = estructuraDe(s);
    var seguir = tieneEst(s) && prefs.seguir !== false;

    var bl = seguir
      ? s.estructura.map(function (t, i) { return { t: t, c: i, sec: buscarSec(s, t) }; })
      : (s.contenido || []).map(function (sec) {
          var c = -1, k = norm(sec.titulo);
          for (var j = 0; j < chips.length; j++) if (norm(chips[j]) === k) { c = j; break; }
          return { t: sec.titulo, c: c, sec: sec };
        });

    bl.forEach(function (b) {
      var attrs = ' data-c="' + b.c + '" data-t="' + esc(b.t) + '"';
      if (!b.sec) {
        out += '<section class="sec"' + attrs + '><h3>' + esc(b.t) + '</h3><div class="vacio">Parte sin letra (instrumental)</div></section>';
        return;
      }
      var rows = secRows(b.sec, n, flat, modo);
      if (rows) out += '<section class="sec"' + attrs + '><h3>' + esc(seguir ? b.t : b.sec.titulo) + '</h3>' + rows + '</section>';
    });

    if (!out) {
      out = (s.contenido && s.contenido.length)
        ? '<div class="noletra">No hay ' + (modo === 'acordes' ? 'acordes' : 'letra') + ' escritos para esta canción.</div>'
        : '<div class="noletra">Esta canción aún no tiene letra ni acordes.' +
          (puedeEditar ? '<br><br><a class="btn pri" href="#/e/' + s.id + '">✎ Agregar letra y acordes</a>' : '') + '</div>';
    }
    var body = $('songBody');
    body.className = 'song m-' + modo;
    body.style.setProperty('--fs', prefs.fs + 'px');
    body.innerHTML = out;

    $('tAct').textContent = s.tono ? (n ? Music.shiftChord(s.tono, n, flat) : s.tono) : '–';
    $('tReset').hidden = !n;
    Array.prototype.forEach.call($('modos').children, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-m') === modo ? 'true' : 'false');
    });
    renderStruct();
    requestAnimationFrame(marcarActivo);
  }

  function renderStruct() {
    var s = cur, list = estructuraDe(s);
    $('struct').hidden = !(list.length || stOpen);
    $('stChips').innerHTML = list.map(function (t, i) {
      return '<button class="stchip" data-i="' + i + '">' + esc(t) + '</button>';
    }).join('');

    $('ordenSeg').hidden = !tieneEst(s);
    var seg = prefs.seguir !== false;
    Array.prototype.forEach.call($('ordenSeg').children, function (b) {
      b.setAttribute('aria-pressed', ((b.getAttribute('data-o') === 'estructura') === seg) ? 'true' : 'false');
    });

    $('stEdit').setAttribute('aria-expanded', stOpen ? 'true' : 'false');
    var p = $('stPanel');
    p.hidden = !stOpen;
    if (!stOpen) return;

    var uniq = [], seen = {};
    titulosDe(s).forEach(function (t) { var k = norm(t); if (!seen[k]) { seen[k] = 1; uniq.push(t); } });
    var h = '<b>Estructura de la canción</b>' +
      '<p class="help">El orden en que se toca. Una parte se puede repetir las veces que quieras. Se guarda con la canción.</p>';
    list.forEach(function (t, i) {
      h += '<div class="strow"><span class="n">' + (i + 1) + '.</span>' +
        '<span class="nm' + (buscarSec(s, t) ? '' : ' sin') + '">' + esc(t) + (buscarSec(s, t) ? '' : ' (sin letra)') + '</span>' +
        '<button class="btn icon" data-act="up" data-i="' + i + '" aria-label="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="btn icon" data-act="down" data-i="' + i + '" aria-label="Bajar"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="btn icon" data-act="del" data-i="' + i + '" aria-label="Quitar">✕</button></div>';
    });
    if (!list.length) h += '<p class="help">Aún no hay partes. Agrega abajo.</p>';
    h += '<p class="help" style="margin-top:12px">Agregar al final</p><div class="stadd">';
    uniq.forEach(function (t) { h += '<button class="chip" data-act="add" data-t="' + esc(t) + '">+ ' + esc(t) + '</button>'; });
    h += '</div><div class="stcustom"><input id="stCustom" placeholder="Otra parte (Instrumental, Tag…)" autocomplete="off">' +
      '<button class="btn" data-act="custom">Agregar</button></div>' +
      '<div class="stactions"><button class="btn" data-act="reset">Orden original</button><button class="btn pri" data-act="close">Listo</button></div>';
    p.innerHTML = h;
  }

  // Guarda la estructura de la canción abierta en Supabase (null = orden original).
  function guardarEstructura(arr, msg) {
    var s = cur;
    guardar(function () {
      return afecta(sb.from('canciones').update({ estructura: arr && arr.length ? arr : null }).eq('id', s.id).select('id'));
    }, function () {
      if (arr && arr.length) s.estructura = arr; else delete s.estructura;
      saveSongs();
      if (cur === s) renderSong();
      if (msg) toast(msg);
    });
  }

  function stAccion(act, i, t) {
    var arr = estructuraDe(cur).slice();
    if (act === 'close') { stOpen = false; renderSong(); return; }
    if (act === 'reset') { guardarEstructura(null, 'Se usa el orden original'); return; }
    if (act === 'up' && i > 0) { var a = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = a; }
    else if (act === 'down' && i < arr.length - 1) { var b = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = b; }
    else if (act === 'del') { arr.splice(i, 1); }
    else if (act === 'add') { arr.push(t); }
    else if (act === 'custom') {
      var v = ($('stCustom').value || '').trim();
      if (!v) { $('stCustom').focus(); return; }
      arr.push(v);
    } else return;
    guardarEstructura(arr);
  }

  $('stEdit').addEventListener('click', function () { if (puedeEditar) { stOpen = !stOpen; renderStruct(); } });
  $('stPanel').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    stAccion(b.getAttribute('data-act'), +b.getAttribute('data-i'), b.getAttribute('data-t'));
  });
  $('stPanel').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'stCustom') { e.preventDefault(); stAccion('custom'); }
  });
  $('ordenSeg').addEventListener('click', function (e) {
    var o = e.target.getAttribute('data-o');
    if (!o) return;
    prefs.seguir = (o === 'estructura'); savePrefs(); renderSong();
  });

  // Tocar una parte de la estructura: saltar a ella
  $('stChips').addEventListener('click', function (e) {
    var b = e.target.closest('.stchip');
    if (!b) return;
    var i = +b.getAttribute('data-i'), t = norm(b.textContent);
    var els = $('songBody').querySelectorAll('.sec'), el = null, k;
    for (k = 0; k < els.length; k++) if (+els[k].getAttribute('data-c') === i) { el = els[k]; break; }
    if (!el) for (k = 0; k < els.length; k++) if (norm(els[k].getAttribute('data-t')) === t) { el = els[k]; break; }
    if (!el) { toast('Esa parte no se muestra en este modo'); return; }
    stLock = Date.now() + 900;
    Array.prototype.forEach.call($('stChips').children, function (c, j) { c.classList.toggle('act', j === i); });
    var calmo = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: calmo ? 'auto' : 'smooth', block: 'start' });
  });

  // Resaltar en la barra la parte que se está leyendo
  var scrollRaf = 0, stLock = 0;
  function marcarActivo() {
    if ($('vCancion').hidden || $('struct').hidden || Date.now() < stLock) return;
    var els = $('songBody').querySelectorAll('.sec');
    // En horizontal la barra de partes está abajo: la parte activa es la que llega arriba de la pantalla.
    var abajo = getComputedStyle($('struct')).position === 'fixed';
    var lim = abajo ? 40 : $('struct').getBoundingClientRect().bottom + 12, act = -1;
    for (var k = 0; k < els.length; k++) {
      if (els[k].getBoundingClientRect().top <= lim) act = +els[k].getAttribute('data-c');
      else break;
    }
    var chips = $('stChips').children;
    for (var j = 0; j < chips.length; j++) chips[j].classList.toggle('act', j === act);
    if (act > -1 && chips[act] && chips[act].scrollIntoView) {
      var box = $('stChips'), c = chips[act];
      if (c.offsetLeft < box.scrollLeft || c.offsetLeft + c.offsetWidth > box.scrollLeft + box.clientWidth) {
        box.scrollLeft = c.offsetLeft - 12;
      }
    }
  }
  window.addEventListener('scroll', function () {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () { scrollRaf = 0; marcarActivo(); });
  }, { passive: true });

  function shiftBy(d) {
    var n = ((shifts[cur.id] || 0) + d) % 12;
    if (n > 6) n -= 12; if (n < -6) n += 12;
    if (n) shifts[cur.id] = n; else delete shifts[cur.id];
    store.set('cc_shifts', shifts); renderSong();
  }
  $('tMas').addEventListener('click', function () { shiftBy(1); });
  $('tMenos').addEventListener('click', function () { shiftBy(-1); });
  $('tReset').addEventListener('click', function () { delete shifts[cur.id]; store.set('cc_shifts', shifts); renderSong(); });

  function setFs(v) { prefs.fs = Math.max(12, Math.min(34, v)); savePrefs(); renderSong(); }
  $('fMenos').addEventListener('click', function () { setFs(prefs.fs - 2); });
  $('fMas').addEventListener('click', function () { setFs(prefs.fs + 2); });
  $('fNorm').addEventListener('click', function () { setFs(15); });

  $('modos').addEventListener('click', function (e) {
    var m = e.target.getAttribute('data-m');
    if (!m) return;
    prefs.modo = m; savePrefs(); renderSong();
  });
  $('bEditar').addEventListener('click', function () { location.hash = '#/e/' + cur.id; });

  function showSong(id, ctx) {
    var s = findSong(id);
    if (!s) { location.hash = '#/'; return; }
    cur = s; plCtx = ctx || null;
    $('bVolver').setAttribute('href', plCtx ? '#/l/' + plCtx.lista.id : '#/');
    $('plAdd').hidden = true; $('bLista').setAttribute('aria-expanded', 'false');
    $('sTitulo').textContent = s.titulo;
    $('sArtista').textContent = s.artista || '';
    $('sArtista').hidden = !s.artista;
    $('sSeccion').textContent = isMedley(s) ? '🎵 ' + s.seccion : '';
    $('sSeccion').hidden = !isMedley(s);
    $('sTono').textContent = s.tono || '–';
    var mn = medNavHTML();
    ['medNav', 'medNav2'].forEach(function (k) { $(k).innerHTML = mn; $(k).hidden = !mn; });
    setFav(favs.indexOf(s.id) > -1);
    $('vel').value = prefs.vel;
    stOpen = false;
    renderSong();
    wakeOn();
  }

  /* ---------- Auto-scroll ---------- */
  var auto = { on: false, raf: 0, last: 0, acc: 0, touching: false, tt: 0 };
  function pxPorSeg() { return 8 + (prefs.vel - 1) * (112 / 9); }
  function tick(t) {
    if (!auto.on) return;
    var dt = (t - auto.last) / 1000; auto.last = t;
    if (dt > 0.2 || dt < 0) dt = 0.016;
    if (!auto.touching) {
      auto.acc += pxPorSeg() * dt;
      var px = Math.floor(auto.acc);
      if (px >= 1) { auto.acc -= px; window.scrollBy(0, px); }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        stopAuto();
        var sigL = plCtx && findSong(plCtx.lista.items[plCtx.i + 1]);
        toast(sigL ? 'Fin de la canción · Sigue: ' + sigL.titulo : 'Fin de la canción'); return;
      }
    }
    auto.raf = requestAnimationFrame(tick);
  }
  function startAuto() {
    if (auto.on) return;
    auto.on = true; auto.acc = 0; auto.last = performance.now();
    $('bAuto').innerHTML = '⏸<span class="lbl-auto"> Pausar</span>'; $('bAuto').setAttribute('aria-label', 'Pausar auto-scroll');
    auto.raf = requestAnimationFrame(tick);
  }
  function stopAuto() {
    auto.on = false; cancelAnimationFrame(auto.raf);
    $('bAuto').innerHTML = '▶<span class="lbl-auto"> Auto-scroll</span>'; $('bAuto').setAttribute('aria-label', 'Iniciar auto-scroll');
  }
  $('bAuto').addEventListener('click', function () { auto.on ? stopAuto() : startAuto(); });
  $('vel').addEventListener('input', function () { prefs.vel = +this.value; savePrefs(); });
  window.addEventListener('touchstart', function () { auto.touching = true; clearTimeout(auto.tt); }, { passive: true });
  ['touchend', 'touchcancel'].forEach(function (ev) {
    window.addEventListener(ev, function () { clearTimeout(auto.tt); auto.tt = setTimeout(function () { auto.touching = false; }, 700); }, { passive: true });
  });

  /* ---------- Pantalla encendida mientras se lee (si el navegador lo permite) ---------- */
  var wake = null;
  function wakeOn() {
    try {
      if (navigator.wakeLock && !wake) {
        navigator.wakeLock.request('screen').then(function (w) {
          wake = w; w.addEventListener('release', function () { wake = null; });
        }).catch(function () {});
      }
    } catch (e) {}
  }
  function wakeOff() { try { if (wake) { wake.release(); wake = null; } } catch (e) {} }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && cur && !$('vCancion').hidden) wakeOn(); });

  /* ---------- Editor ---------- */
  function fillCats(sel) {
    var base = ['Alabanza', 'Adoración', 'Himnos', 'Medley', 'Otra'];
    if (sel && base.indexOf(sel) < 0) base.push(sel);
    $('eCat').innerHTML = base.map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }

  // Al salir del editor se vuelve a donde estaba la canción (por ejemplo, dentro de una lista).
  function volverA(id) { return (cur && cur.id === id && curHash) ? curHash : '#/c/' + id; }

  function showEditor(id) {
    var s = id ? findSong(id) : null;
    if (id && !s) { location.hash = '#/'; return; }
    if (!puedeEditar) {
      toast('Inicia sesión como editor para editar (menú ⋯ → 🔐).');
      location.hash = s ? '#/c/' + s.id : '#/'; return;
    }
    editingId = s ? s.id : null;
    $('eHead').textContent = s ? 'Editar canción' : 'Nueva canción';
    $('eTitulo').value = s ? s.titulo : '';
    $('eArtista').value = s ? s.artista : '';
    $('eTono').value = s ? s.tono : '';
    fillCats(s ? s.categoria : 'Alabanza');
    $('eSec').value = s ? s.seccion : 'General';
    $('eEst').value = s && s.estructura ? s.estructura.join(', ') : '';
    var secs = {};
    songs.forEach(function (x) { if (x.seccion) secs[x.seccion] = 1; });
    $('secList').innerHTML = Object.keys(secs).map(function (k) { return '<option value="' + esc(k) + '">'; }).join('');
    $('eTexto').value = s ? Music.toTexto(s.contenido) : '[Verso 1]\n';
    $('eBorrar').hidden = !s;
    $('eVolver').setAttribute('href', s ? volverA(s.id) : '#/');
  }

  $('eGuardar').addEventListener('click', function () {
    var t = $('eTitulo').value.trim();
    if (!t) { toast('Escribe el título'); $('eTitulo').focus(); return; }
    var tono = $('eTono').value.trim();
    if (tono) tono = tono.charAt(0).toUpperCase() + tono.slice(1);
    var obj = {
      titulo: t, artista: $('eArtista').value.trim(), tono: tono,
      categoria: $('eCat').value, seccion: $('eSec').value.trim() || 'General',
      contenido: Music.parseTexto($('eTexto').value)
    };
    var est = $('eEst').value.split(/[,;\n→>]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (est.length) obj.estructura = est;
    var id = editingId, fila = cancionAFila(obj);
    guardar(function () {
      if (id) return afecta(sb.from('canciones').update(fila).eq('id', id).select(COLS));
      fila.orden = maxOrden(songs) + 1;  // una canción nueva va al final
      return sb.from('canciones').insert(fila).select(COLS);
    }, function (filas) {
      var s = filaACancion(filas[0]), ex = findSong(s.id);
      if (ex) { delete ex.estructura; Object.assign(ex, s); }
      else songs.push(s);
      editingId = s.id;
      saveSongs();
      toast('Canción guardada');
      location.hash = volverA(s.id);
    });
  });

  $('eBorrar').addEventListener('click', function () {
    var s = findSong(editingId);
    if (!s || !confirm('¿Eliminar “' + s.titulo + '”? No se puede deshacer.')) return;
    // En Supabase también se quita de las listas (ON DELETE CASCADE).
    guardar(function () {
      return afecta(sb.from('canciones').delete().eq('id', s.id).select('id'));
    }, function () {
      songs = songs.filter(function (x) { return x.id !== s.id; });
      favs = favs.filter(function (x) { return x !== s.id; });
      delete shifts[s.id];
      listas.forEach(function (L) { L.items = L.items.filter(function (x) { return x !== s.id; }); });
      saveSongs(); store.set('cc_favs', favs); store.set('cc_shifts', shifts); saveListas();
      toast('Canción eliminada');
      location.hash = '#/';
    });
  });

  /* ---------- Rutas ---------- */
  function view(name) {
    $('vLista').hidden = name !== 'lista';
    $('vCancion').hidden = name !== 'cancion';
    $('vEditor').hidden = name !== 'editor';
  }

  function route() {
    var h = location.hash || '#/', m;
    if (!$('vLista').hidden && !plAbierta) listY = window.scrollY;  // posición en la lista principal o la agenda
    stopAuto();
    if (!/^#\/(c\/|l\/[\w-]+\/\d)/.test(h)) wakeOff();
    // Los id son uuid (letras, números y guiones).
    m = h.match(/^#\/c\/([\w-]+)$/);

    if (!m && (m = h.match(/^#\/l\/([\w-]+)\/(\d+)$/))) {
      // Canción dentro de una lista: se navega con Anterior / Siguiente como en un medley.
      var L = findLista(m[1]), k = +m[2];
      if (L) limpiarLista(L);
      if (!L || k >= L.items.length) { state.filtro = 'listas'; location.hash = L ? '#/l/' + L.id : '#/'; return; }
      state.filtro = 'listas'; plEdit = null; curHash = h;
      view('cancion'); showSong(L.items[k], { lista: L, i: k }); window.scrollTo(0, 0);
      return;
    }
    if (!m && (m = h.match(/^#\/l\/([\w-]+)$/))) {
      // Una lista de la agenda: encabezado, fecha y canciones en orden.
      if (String(plEdit) !== m[1]) plEdit = null;
      state.filtro = 'listas'; plAbierta = m[1];
      view('lista'); renderList(); window.scrollTo(0, 0);
      return;
    }
    if (m) { curHash = h; view('cancion'); showSong(m[1]); window.scrollTo(0, 0); }
    else if (h === '#/nueva') { view('editor'); showEditor(null); window.scrollTo(0, 0); }
    else if ((m = h.match(/^#\/e\/([\w-]+)$/))) { view('editor'); showEditor(m[1]); window.scrollTo(0, 0); }
    else { plAbierta = null; plEdit = null; view('lista'); renderList(); window.scrollTo(0, listY); }
  }
  window.addEventListener('hashchange', route);

  /* ---------- Arranque ---------- */
  // Primero se muestra la caché del teléfono y después se traen los datos de Supabase.
  function iniciar() {
    cargarRemoto();  // empieza la descarga (la lista vacía muestra "Cargando…" mientras tanto)
    route();
  }

  applyTheme();
  pintarSesion();
  iniciar();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
