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
    }
  };

  /* ---------- Canciones iniciales (sin letras: las agregas tú) ---------- */
  var DEMO = [
    '[Intro]', 'C   G   Am   F', '',
    '[Verso 1]', 'C              G', 'Esta es una línea de ejemplo',
    'Am               F', 'para ver cómo se alinean los acordes', '',
    '[Coro]', 'F          C', 'Escribe aquí tu propia letra',
    'G            Am', 'y toca Editar para cambiarla'
  ].join('\n');

  var IND = [
    ['Bienvenido Espíritu Santo', 'Miel San Marcos', 'C', 'Adoración'],
    ['Antorcha Encendida', 'Lema retiro', 'G', 'Adoración'],
    ['Quiero Arder por Ti', 'Franco Figueroa', 'A', 'Adoración'],
    ['Jeshua', 'Generación 12', 'A', 'Adoración'],
    ['Nuestro Dios', 'Generación 12', 'A', 'Alabanza'],
    ['Tú Eres Rey', 'Barak', 'Bm', 'Alabanza'],
    ['Remolineando', '', 'C#m', 'Alabanza'],
    ['Tus Cuerdas de Amor', '', 'Dm', 'Adoración'],
    ['Cantaré de Tu Amor', '', 'C', 'Adoración'],
    ['Con Mis Manos Levantadas', '', 'G', 'Alabanza'],
    ['Libre Soy', 'David Scarpeta', 'D', 'Alabanza'],
    ['Mi Plenitud', 'Marcos Brunet', 'A', 'Adoración'],
    ['Unción en el Aire', 'Cales Louima', 'Cm', 'Adoración'],
    ['Espíritu Santo Ven', 'Barak', 'C#m', 'Adoración'],
    ['Yo Navegaré', 'Dahaira', 'C#m', 'Alabanza'],
    ['Aquí Estás / Way Maker', '', 'A', 'Adoración'],
    ['Cuando Pienso en lo Mucho', 'Miel San Marcos', 'Cm', 'Adoración'],
    ['Creo en Ti', '', 'Bm', 'Adoración'],
    ['A Tus Pies', "Christine D'Clario", 'A', 'Adoración'],
    ['Digno', 'Marcos Brunet', 'A', 'Adoración'],
    ['Espíritu Santo Te Necesito', '', 'G', 'Adoración'],
    ['Hay una Unción', '', 'G', 'Adoración'],
    ['Algo Está Cayendo Aquí', '', 'G', 'Adoración'],
    ['Ven Espíritu Ven', 'Marcos Barrientos', 'G', 'Adoración']
  ];
  var MED = {
    'Medley Dante Gebel': [
      ['Los Enemigos de Jehová', 'Dm'], ['Libre Yo Soy Libre', 'A'], ['Resplandece', 'D'],
      ['Fiesta', 'Cm'], ['Viene Ya', 'Am'], ['Fiesta en el Desierto', 'C#m']
    ],
    'Medley Juan Carlos Alvarado': [
      ['Pues Tú Glorioso', 'Gm'], ['Cristo Vive', 'Em'], ['Cristo No Está Muerto', 'C'],
      ['La Tengo', 'C'], ['Danza Hija de Sión', 'C']
    ]
  };

  function iniciales() {
    var out = [], id = 0;
    IND.forEach(function (r) {
      out.push({ id: ++id, titulo: r[0], artista: r[1], tono: r[2], categoria: r[3], seccion: 'General', contenido: [] });
    });
    Object.keys(MED).forEach(function (sec) {
      MED[sec].forEach(function (r) {
        out.push({ id: ++id, titulo: r[0], artista: '', tono: r[1], categoria: 'Medley', seccion: sec, contenido: [] });
      });
    });
    out.push({
      id: ++id, titulo: 'Canción de ejemplo', artista: 'Bórrala o edítala', tono: 'C',
      categoria: 'Alabanza', seccion: 'General', contenido: Music.parseTexto(DEMO),
      estructura: ['Intro', 'Verso 1', 'Coro', 'Instrumental', 'Coro']
    });
    return out;
  }

  /* ---------- Estado ---------- */
  var songs = store.get('cc_songs', null);
  var necesitaSemilla = !Array.isArray(songs) || !songs.length;
  if (necesitaSemilla) songs = [];
  var favs = store.get('cc_favs', []);
  var shifts = store.get('cc_shifts', {});
  var prefs = store.get('cc_prefs', {});
  prefs.fs = prefs.fs || 15;
  prefs.modo = prefs.modo || 'ambos';
  prefs.vel = prefs.vel || 4;
  songs.forEach(function (x) {
    if (x.titulo === 'Canción de ejemplo' && x.artista === 'Bórrala o edítala' && !x.estructura) x.estructura = ['Intro', 'Verso 1', 'Coro', 'Instrumental', 'Coro'];
  });
  if (!prefs.theme) prefs.theme = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';

  // Listas para tocar en orden: [{ id, nombre, items: [idCanción, …] }]
  var listas = store.get('cc_listas', []);
  if (!Array.isArray(listas)) listas = [];

  var state = { filtro: 'todas' };
  var cur = null, editingId = null, listY = 0;
  var plCtx = null, curHash = '';

  function saveSongs() { store.set('cc_songs', songs); }
  function savePrefs() { store.set('cc_prefs', prefs); }
  function findSong(id) { for (var i = 0; i < songs.length; i++) if (songs[i].id === id) return songs[i]; return null; }
  function nextId() { return songs.reduce(function (m, s) { return Math.max(m, s.id); }, 0) + 1; }
  function saveListas() { store.set('cc_listas', listas); }
  function findLista(id) { for (var i = 0; i < listas.length; i++) if (listas[i].id === id) return listas[i]; return null; }
  function songKey(s) { return norm(s.titulo) + '|' + norm(s.artista); }

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
      var puedeOrdenar = !q;
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
  // Mueve una canción dentro de su medley (intercambia su lugar con la vecina).
  function moverCancion(id, d) {
    var s = findSong(id); if (!s) return;
    var g = grupoDe(s.seccion), i = g.indexOf(s), o = g[i + d];
    if (!o) return;
    var a = songs.indexOf(s), b = songs.indexOf(o);
    songs[a] = o; songs[b] = s;
  }
  // Mueve un medley completo antes o después del medley vecino.
  function moverGrupo(g, d) {
    var gs = gruposMedley(), i = gs.indexOf(g), otro = gs[i + d];
    if (!otro) return;
    var bloque = grupoDe(g);
    songs = songs.filter(function (s) { return bloque.indexOf(s) < 0; });
    var ref = grupoDe(otro);
    var pos = d < 0 ? songs.indexOf(ref[0]) : songs.indexOf(ref[ref.length - 1]) + 1;
    Array.prototype.splice.apply(songs, [pos, 0].concat(bloque));
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
    var n = 0;
    songs.forEach(function (s) { if (isMedley(s) && s.seccion === g) { s.seccion = v; n++; } });
    ordenMed = v; saveSongs(); renderList();
    toast('Medley renombrado (' + n + (n === 1 ? ' canción' : ' canciones') + ')');
  }
  // Deshace el medley: sus canciones quedan en el cancionero, en la sección General.
  function eliminarMedley(g) {
    var n = grupoDe(g).length;
    if (!confirm('¿Eliminar el medley “' + g + '”?\n\nSus ' + n + (n === 1 ? ' canción no se borra: pasa' : ' canciones no se borran: pasan') +
        ' a la sección General y las sigues encontrando en Todas.')) return;
    songs.forEach(function (s) { if (isMedley(s) && s.seccion === g) s.seccion = 'General'; });
    ordenMed = null; saveSongs(); renderList();
    toast('Medley eliminado');
  }

  $('lista').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-mo')) { ordenMed = b.getAttribute('data-mo'); }
    else if (b.hasAttribute('data-mlisto')) { ordenMed = null; }
    else if (b.hasAttribute('data-mv')) { moverCancion(+b.getAttribute('data-id'), +b.getAttribute('data-mv')); saveSongs(); }
    else if (b.hasAttribute('data-gmv')) { moverGrupo(b.getAttribute('data-g'), +b.getAttribute('data-gmv')); saveSongs(); }
    else if (b.hasAttribute('data-mren')) { e.preventDefault(); renombrarMedley(b.getAttribute('data-mren')); return; }
    else if (b.hasAttribute('data-mdel')) { e.preventDefault(); eliminarMedley(b.getAttribute('data-mdel')); return; }
    else return;
    e.preventDefault();
    renderList();
  });

  $('chips').addEventListener('click', function (e) {
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    state.filtro = f; renderList();
  });

  /* ---------- Listas: canciones en el orden en que se van a tocar ---------- */
  var plEdit = null, plQuery = '';
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

  function renderListas() {
    listas.forEach(limpiarLista);
    $('count').textContent = listas.length + (listas.length === 1 ? ' lista' : ' listas');
    var html = '<div class="mactions"><button class="btn pri" data-pl="nueva">➕ Nueva lista</button></div>';
    if (!listas.length) html += '<div class="empty-msg">Aún no tienes listas. Crea una, agrega canciones en el orden en que las vas a tocar y toca ▶ Tocar para irlas pasando una tras otra.</div>';

    listas.forEach(function (L, li) {
      if (plEdit !== L.id) {
        html += '<div class="mhead"><span class="mtit">📋 ' + esc(L.nombre) + '</span>' +
          (L.items.length ? '<a class="btn mini pri" href="#/l/' + L.id + '/0">▶ Tocar</a>' : '') +
          '<button class="btn mini" data-pl="edit" data-l="' + L.id + '">✎ Editar</button></div>';
        cancionesDe(L).forEach(function (s, i) { html += itemHTML(s, i + 1, '#/l/' + L.id + '/' + i); });
        if (!L.items.length) html += '<p class="help">Lista vacía. Toca ✎ Editar para agregar canciones.</p>';
        return;
      }
      html += '<div class="mhead"><span class="mtit">✎ Editando lista</span></div>' +
        '<div class="morden plform">' +
        '<label class="pllbl" for="plNombre">Nombre</label>' +
        '<input id="plNombre" class="plinput" value="' + esc(L.nombre) + '" autocomplete="off" placeholder="Ej. Domingo 19 de octubre">' +
        '<div class="pllbl">Orden</div><div id="plRows">' + plRowsHTML(L) + '</div>' +
        '<label class="pllbl" for="plBuscar">Agregar canciones</label>' +
        '<input id="plBuscar" class="plinput" type="search" value="' + esc(plQuery) + '" autocomplete="off" placeholder="🔎 Buscar canción…" enterkeyhint="search">' +
        '<div id="plRes">' + plResHTML(L) + '</div>' +
        '<div class="mactions">' +
        '<button class="btn" data-pl="lup"' + (li === 0 ? ' disabled' : '') + '>▲ Subir lista</button>' +
        '<button class="btn" data-pl="ldown"' + (li === listas.length - 1 ? ' disabled' : '') + '>▼ Bajar lista</button></div>' +
        '<div class="mactions"><button class="btn danger" data-pl="borrar">Eliminar lista</button>' +
        '<button class="btn pri" data-pl="listo">Listo</button></div></div>';
    });
    $('lista').innerHTML = html;
  }

  function plAccion(act, b) {
    var L = findLista(plEdit), i = +b.getAttribute('data-i'), x;
    if (act === 'nueva') {
      var id = listas.reduce(function (m, l) { return Math.max(m, l.id); }, 0) + 1;
      listas.push({ id: id, nombre: 'Lista ' + id, items: [] });
      plEdit = id; plQuery = ''; saveListas(); renderList();
      var inp = $('plNombre'); if (inp) { inp.focus(); inp.select(); }
      return;
    }
    if (act === 'edit') { plEdit = +b.getAttribute('data-l'); plQuery = ''; renderList(); return; }
    if (!L) return;
    if (act === 'listo') { plEdit = null; renderList(); return; }
    if (act === 'borrar') {
      if (!confirm('¿Eliminar la lista “' + L.nombre + '”? Las canciones no se borran.')) return;
      listas = listas.filter(function (l) { return l !== L; });
      plEdit = null; saveListas(); renderList(); toast('Lista eliminada'); return;
    }
    if (act === 'lup' || act === 'ldown') {
      var li = listas.indexOf(L), lj = li + (act === 'lup' ? -1 : 1);
      if (!listas[lj]) return;
      listas[li] = listas[lj]; listas[lj] = L;
      saveListas(); renderList(); return;
    }
    if (act === 'up' && i > 0) { x = L.items[i - 1]; L.items[i - 1] = L.items[i]; L.items[i] = x; }
    else if (act === 'down' && i < L.items.length - 1) { x = L.items[i + 1]; L.items[i + 1] = L.items[i]; L.items[i] = x; }
    else if (act === 'del') { L.items.splice(i, 1); }
    else if (act === 'add') {
      var s = findSong(+b.getAttribute('data-id'));
      if (!s) return;
      L.items.push(s.id); toast('“' + s.titulo + '” agregada (' + L.items.length + ')');
    } else return;
    saveListas();
    // Solo se redibuja el orden y los resultados, para no cerrar el teclado.
    $('plRows').innerHTML = plRowsHTML(L);
    $('plRes').innerHTML = plResHTML(L);
  }

  $('lista').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pl]');
    if (!b || b.disabled) return;
    e.preventDefault();
    plAccion(b.getAttribute('data-pl'), b);
  });
  $('lista').addEventListener('input', function (e) {
    var L = findLista(plEdit);
    if (!L) return;
    if (e.target.id === 'plBuscar') { plQuery = e.target.value; $('plRes').innerHTML = plResHTML(L); }
    else if (e.target.id === 'plNombre') { L.nombre = e.target.value.trim() || 'Sin nombre'; saveListas(); }
  });

  /* Agregar la canción abierta a una lista */
  function renderPlAdd() {
    var h = '<b>Agregar “' + esc(cur.titulo) + '” a…</b><div class="stadd">';
    listas.forEach(function (L) {
      var n = L.items.filter(function (id) { return id === cur.id; }).length;
      h += '<button class="chip" data-pa="' + L.id + '">📋 ' + esc(L.nombre) + (n ? ' ✓' : '') + '</button>';
    });
    h += '<button class="chip" data-pa="nueva">➕ Nueva lista</button></div>';
    if (!listas.length) h += '<p class="help">Aún no tienes listas. Crea la primera con esta canción.</p>';
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
    var v = b.getAttribute('data-pa'), L;
    if (v === 'nueva') {
      var id = listas.reduce(function (m, l) { return Math.max(m, l.id); }, 0) + 1;
      L = { id: id, nombre: 'Lista ' + id, items: [] };
      listas.push(L);
    } else L = findLista(+v);
    if (!L) return;
    if (L.items.indexOf(cur.id) > -1 && !confirm('“' + cur.titulo + '” ya está en “' + L.nombre + '”. ¿Agregarla otra vez?')) return;
    L.items.push(cur.id); saveListas();
    $('plAdd').hidden = true; $('bLista').setAttribute('aria-expanded', 'false');
    toast('Agregada a “' + L.nombre + '” (' + L.items.length + ')');
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

  /* ---------- Repositorio: canciones.json publicado junto a la app ---------- */
  function descargarRepo() {
    return fetch('canciones.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (d) {
      var arr = Array.isArray(d) ? d : (d && d.canciones);
      if (!Array.isArray(arr)) throw new Error('formato');
      var lista = arr.map(normSong).filter(Boolean);
      if (!lista.length) throw new Error('vacío');
      return { ver: (d && d.version) || 1, lista: lista, listas: (d && Array.isArray(d.listas)) ? d.listas : [] };
    });
  }

  // Mezcla una lista con las canciones locales (clave: título + artista).
  function fusionar(lista, reemplazar) {
    var add = 0, upd = 0;
    lista.forEach(function (n) {
      var k = norm(n.titulo) + '|' + norm(n.artista), ex = null;
      for (var i = 0; i < songs.length; i++) {
        if (norm(songs[i].titulo) + '|' + norm(songs[i].artista) === k) { ex = songs[i]; break; }
      }
      if (ex) { if (reemplazar) { n.id = ex.id; Object.assign(ex, n); upd++; } }
      else { n.id = nextId(); songs.push(n); add++; }
    });
    return { add: add, upd: upd };
  }

  // Mezcla listas que vienen del repositorio o de un archivo.
  // Cada canción se busca por título + artista, porque los id cambian de un teléfono a otro.
  // reemplazar = true: una lista con el mismo nombre toma el contenido de la que llega.
  // Las listas que solo existen en este teléfono no se tocan.
  function fusionarListas(remotas, reemplazar) {
    var add = 0, upd = 0, faltan = 0, porClave = {};
    songs.forEach(function (s) { if (!porClave[songKey(s)]) porClave[songKey(s)] = s.id; });
    (remotas || []).forEach(function (R) {
      if (!R || typeof R.nombre !== 'string' || !R.nombre.trim()) return;
      var items = [];
      (Array.isArray(R.canciones) ? R.canciones : []).forEach(function (c) {
        var id = c && porClave[norm(c.titulo) + '|' + norm(c.artista)];
        if (id) items.push(id); else faltan++;
      });
      var ex = null;
      for (var i = 0; i < listas.length; i++) if (norm(listas[i].nombre) === norm(R.nombre)) { ex = listas[i]; break; }
      if (ex) {
        if (reemplazar && JSON.stringify(ex.items) !== JSON.stringify(items)) { ex.items = items; upd++; }
      } else {
        var id = listas.reduce(function (m, l) { return Math.max(m, l.id); }, 0) + 1;
        listas.push({ id: id, nombre: R.nombre.trim(), items: items });
        add++;
      }
    });
    if (add || upd) saveListas();
    return { add: add, upd: upd, faltan: faltan };
  }
  function textoListas(y) {
    var p = [];
    if (y.add) p.push(y.add + (y.add === 1 ? ' lista nueva' : ' listas nuevas'));
    if (y.upd) p.push(y.upd + (y.upd === 1 ? ' lista actualizada' : ' listas actualizadas'));
    return p.length ? ' · ' + p.join(', ') : '';
  }

  $('mAct').addEventListener('click', function () {
    descargarRepo().then(function (r) {
      if (!confirm('El repositorio tiene ' + r.lista.length + ' canciones. Las que ya tienes con el mismo título y artista se reemplazan por la versión del repositorio (se pierden tus ediciones locales de esas). ¿Continuar?')) return;
      var x = fusionar(r.lista, true);
      saveSongs();
      var y = fusionarListas(r.listas, true);
      store.set('cc_ver', r.ver); renderList();
      toast(x.add + ' nuevas, ' + x.upd + ' actualizadas' + textoListas(y));
    }).catch(function () {
      toast('No se pudo leer canciones.json. Revisa la conexión y que la página esté publicada.');
    });
  });

  $('mImp').addEventListener('click', function () { $('fileImp').click(); });
  $('fileImp').addEventListener('change', function () {
    var file = this.files[0], input = this;
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var data = JSON.parse(rd.result);
        var lsImp = (data && !Array.isArray(data) && Array.isArray(data.listas)) ? data.listas : [];
        if (data && !Array.isArray(data) && Array.isArray(data.canciones)) data = data.canciones;
        if (!Array.isArray(data)) throw new Error('formato');
        var nuevas = data.map(normSong).filter(Boolean);
        if (!nuevas.length) throw new Error('vacío');
        if (!confirm('Se importarán ' + nuevas.length + ' canciones. Si ya tienes una con el mismo título y artista, se reemplaza. ¿Continuar?')) return;
        var x = fusionar(nuevas, true), add = x.add, upd = x.upd;
        saveSongs();
        var y = fusionarListas(lsImp, true);
        renderList();
        toast(add + ' nuevas, ' + upd + ' actualizadas' + textoListas(y));
      } catch (err) {
        toast('El archivo no es un JSON de canciones válido.');
      }
    };
    rd.readAsText(file);
    input.value = '';
  });

  // El mismo formato que canciones.json del repositorio (sin los id internos).
  function jsonCanciones(version) {
    var limpio = songs.map(function (x) { var c = Object.assign({}, x); delete c.id; return c; });
    var ls = listas.map(function (L) {
      return {
        nombre: L.nombre,
        canciones: L.items.map(findSong).filter(Boolean).map(function (s) { return { titulo: s.titulo, artista: s.artista || '' }; })
      };
    });
    return JSON.stringify({ version: version, canciones: limpio, listas: ls }, null, 2);
  }

  $('mExp').addEventListener('click', function () {
    var blob = new Blob([jsonCanciones(store.get('cc_ver', 0) + 1)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'canciones.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 600);
    toast('canciones.json exportado');
  });

  /* ---------- Publicar en GitHub (API de contenidos con un token fine-grained) ---------- */
  // Repositorio por defecto: el de la página publicada (usuario.github.io/repo).
  function repoPorDefecto() {
    var h = location.hostname.match(/^([^.]+)\.github\.io$/i), p = location.pathname.split('/')[1];
    return h && p ? h[1] + '/' + p : 'willilacar2-star/mi-cancionero';
  }
  function ghConf() {
    var c = store.get('cc_gh', {}) || {};
    return { token: c.token || '', repo: c.repo || repoPorDefecto() };
  }
  function b64aTexto(b) { return decodeURIComponent(escape(atob(b.replace(/\s/g, '')))); }
  function textoAb64(t) { return btoa(unescape(encodeURIComponent(t))); }

  function ghApi(conf, metodo, ruta, cuerpo) {
    return fetch('https://api.github.com/repos/' + conf.repo + ruta, {
      method: metodo,
      cache: 'no-store',
      headers: {
        'Authorization': 'Bearer ' + conf.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.ok) return d;
        var e = new Error(d.message || ('http ' + r.status)); e.status = r.status; throw e;
      });
    });
  }
  function ghMsgError(e) {
    if (e.status === 401) return 'El token no es válido o ya venció. Revisa 🔑 Conexión con GitHub.';
    if (e.status === 403) return 'El token no tiene permiso de escritura (Contents: Read and write) en este repositorio.';
    if (e.status === 404) return 'No se encontró el repositorio o el token no tiene acceso a él.';
    if (e.status === 409 || e.status === 422) return 'El archivo cambió en GitHub mientras publicabas. Vuelve a intentarlo.';
    if (!e.status) return 'Sin conexión con GitHub. Revisa internet e inténtalo de nuevo.';
    return 'GitHub respondió: ' + e.message;
  }

  /* Ventana de conexión */
  function ghEstado(txt, cls) { var el = $('ghEstado'); el.textContent = txt; el.className = 'ghestado' + (cls ? ' ' + cls : ''); }
  function ghLeerForm() {
    return { token: $('ghTok').value.trim(), repo: $('ghRepo').value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '') || repoPorDefecto() };
  }
  function abrirGh() {
    var c = ghConf();
    $('ghTok').value = c.token; $('ghRepo').value = c.repo;
    $('ghRepoTxt').textContent = c.repo;
    ghEstado(c.token ? 'Hay un token guardado en este teléfono.' : 'Aún no hay token guardado.');
    var d = $('ghDlg');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  $('mTok').addEventListener('click', abrirGh);
  $('ghRepo').addEventListener('input', function () { $('ghRepoTxt').textContent = ghLeerForm().repo; });
  $('ghGuardar').addEventListener('click', function () {
    var c = ghLeerForm();
    if (!c.token) { ghEstado('Pega el token primero.', 'mal'); $('ghTok').focus(); return; }
    if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo)) { ghEstado('El repositorio debe verse así: usuario/mi-cancionero', 'mal'); return; }
    store.set('cc_gh', c);
    ghEstado('Guardado. Toca Probar para revisar que funcione.', 'ok');
  });
  $('ghProbar').addEventListener('click', function () {
    var c = ghLeerForm();
    if (!c.token) { ghEstado('Pega el token primero.', 'mal'); return; }
    ghEstado('Probando…');
    ghApi(c, 'GET', '').then(function (d) {
      if (d.permissions && !d.permissions.push) throw Object.assign(new Error('sin escritura'), { status: 403 });
      return ghApi(c, 'GET', '/contents/canciones.json');
    }).then(function () {
      ghEstado('✓ Conectado a ' + c.repo + '. Ya puedes publicar.', 'ok');
    }).catch(function (e) { ghEstado(ghMsgError(e), 'mal'); });
  });
  $('ghBorrar').addEventListener('click', function () {
    if (!confirm('¿Borrar el token de este teléfono? (Para anularlo del todo, bórralo también en GitHub.)')) return;
    store.set('cc_gh', { repo: ghLeerForm().repo });
    $('ghTok').value = '';
    ghEstado('Token borrado de este teléfono.');
  });

  /* Publicar */
  var publicando = false;
  $('mPub').addEventListener('click', function () {
    var c = ghConf();
    if (!c.token) { toast('Primero conecta tu cuenta en 🔑 Conexión con GitHub'); abrirGh(); return; }
    if (publicando) return;
    publicando = true;
    toast('Revisando GitHub…');
    ghApi(c, 'GET', '/contents/canciones.json').then(function (f) {
      var remoto = {};
      try { remoto = JSON.parse(b64aTexto(f.content || '')); } catch (e) {}
      var lista = Array.isArray(remoto) ? remoto : (remoto.canciones || []);
      var ver = Math.max(+remoto.version || 0, store.get('cc_ver', 0)) + 1;
      // Avisar si en GitHub hay canciones que este teléfono no tiene (se perderían).
      var mias = {};
      songs.forEach(function (s) { mias[songKey(s)] = 1; });
      var faltan = lista.filter(function (s) { return s && s.titulo && !mias[songKey(s)]; }).map(function (s) { return s.titulo; });
      var msg = 'Se publicarán ' + songs.length + ' canciones en GitHub como versión ' + ver + '.';
      if (faltan.length) {
        msg += '\n\n⚠️ GitHub tiene ' + faltan.length + (faltan.length === 1 ? ' canción que no está' : ' canciones que no están') +
          ' en este teléfono y se quitarían:\n• ' + faltan.slice(0, 8).join('\n• ') + (faltan.length > 8 ? '\n• …' : '') +
          '\n\nSi no quieres perderlas, cancela y usa primero 🔄 Actualizar desde GitHub.';
      }
      if (!confirm(msg + '\n\n¿Publicar?')) return null;
      toast('Publicando…');
      return ghApi(c, 'PUT', '/contents/canciones.json', {
        message: 'Actualizar canciones desde la app (versión ' + ver + ')',
        content: textoAb64(jsonCanciones(ver)),
        sha: f.sha
      }).then(function () {
        store.set('cc_ver', ver);
        toast('✓ Publicado (versión ' + ver + '). GitHub Pages lo actualiza en 1–2 minutos.');
      });
    }).catch(function (e) { toast(ghMsgError(e)); })
      .then(function () { publicando = false; });
  });

  $('mRes').addEventListener('click', function () {
    if (!confirm('Se borrarán todas tus canciones y ediciones y se volverá a la lista del repositorio. ¿Continuar?')) return;
    // Las listas guardan ids; se recuerdan por título + artista para volver a enlazarlas.
    var claves = listas.map(function (L) {
      return L.items.map(function (id) { var s = findSong(id); return s ? songKey(s) : ''; });
    });
    var lsRepo = [];
    descargarRepo().then(function (r) {
      songs = []; fusionar(r.lista, false); store.set('cc_ver', r.ver); lsRepo = r.listas;
    }).catch(function () {
      songs = iniciales();
    }).then(function () {
      var porClave = {};
      songs.forEach(function (s) { if (!porClave[songKey(s)]) porClave[songKey(s)] = s.id; });
      listas.forEach(function (L, i) {
        L.items = claves[i].map(function (k) { return porClave[k]; }).filter(Boolean);
      });
      saveSongs(); saveListas();
      fusionarListas(lsRepo, true);
      renderList(); toast('Lista restaurada');
    });
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
        : '<div class="noletra">Esta canción aún no tiene letra ni acordes.<br><br><a class="btn pri" href="#/e/' + s.id + '">✎ Agregar letra y acordes</a></div>';
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

  function stAccion(act, i, t) {
    var arr = estructuraDe(cur).slice();
    if (act === 'close') { stOpen = false; renderSong(); return; }
    if (act === 'reset') { delete cur.estructura; saveSongs(); renderSong(); toast('Se usa el orden original'); return; }
    if (act === 'up' && i > 0) { var a = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = a; }
    else if (act === 'down' && i < arr.length - 1) { var b = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = b; }
    else if (act === 'del') { arr.splice(i, 1); }
    else if (act === 'add') { arr.push(t); }
    else if (act === 'custom') {
      var v = ($('stCustom').value || '').trim();
      if (!v) { $('stCustom').focus(); return; }
      arr.push(v);
    } else return;
    if (arr.length) cur.estructura = arr; else delete cur.estructura;
    saveSongs(); renderSong();
  }

  $('stEdit').addEventListener('click', function () { stOpen = !stOpen; renderStruct(); });
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
    if (editingId) {
      var ex = findSong(editingId);
      Object.assign(ex, obj);
      if (est.length) ex.estructura = est; else delete ex.estructura;
    } else {
      obj.id = nextId();
      if (est.length) obj.estructura = est;
      songs.push(obj); editingId = obj.id;
    }
    saveSongs();
    toast('Canción guardada');
    location.hash = volverA(editingId);
  });

  $('eBorrar').addEventListener('click', function () {
    var s = findSong(editingId);
    if (!s || !confirm('¿Eliminar “' + s.titulo + '”? No se puede deshacer.')) return;
    songs = songs.filter(function (x) { return x.id !== s.id; });
    favs = favs.filter(function (x) { return x !== s.id; });
    delete shifts[s.id];
    listas.forEach(function (L) { L.items = L.items.filter(function (x) { return x !== s.id; }); });
    saveSongs(); store.set('cc_favs', favs); store.set('cc_shifts', shifts); saveListas();
    toast('Canción eliminada');
    location.hash = '#/';
  });

  /* ---------- Rutas ---------- */
  function view(name) {
    $('vLista').hidden = name !== 'lista';
    $('vCancion').hidden = name !== 'cancion';
    $('vEditor').hidden = name !== 'editor';
  }

  function route() {
    var h = location.hash || '#/', m;
    if (!$('vLista').hidden) listY = window.scrollY;
    stopAuto();
    if (!/^#\/(c|l)\//.test(h)) wakeOff();
    m = h.match(/^#\/c\/(\d+)$/);

    if (!m && (m = h.match(/^#\/l\/(\d+)\/(\d+)$/))) {
      // Canción dentro de una lista: se navega con Anterior / Siguiente como en un medley.
      var L = findLista(+m[1]), k = +m[2];
      if (L) limpiarLista(L);
      if (!L || k >= L.items.length) { state.filtro = 'listas'; location.hash = '#/'; return; }
      state.filtro = 'listas'; plEdit = null; curHash = h;
      view('cancion'); showSong(L.items[k], { lista: L, i: k }); window.scrollTo(0, 0);
      return;
    }
    if (m) { curHash = h; view('cancion'); showSong(+m[1]); window.scrollTo(0, 0); }
    else if (h === '#/nueva') { view('editor'); showEditor(null); window.scrollTo(0, 0); }
    else if ((m = h.match(/^#\/e\/(\d+)$/))) { view('editor'); showEditor(+m[1]); window.scrollTo(0, 0); }
    else { view('lista'); renderList(); window.scrollTo(0, listY); }
  }
  window.addEventListener('hashchange', route);

  /* ---------- Arranque ---------- */
  function iniciar() {
    if (necesitaSemilla) {
      // Primera vez: se baja canciones.json; si no hay conexión, se usa la lista incluida en la app.
      descargarRepo().then(function (r) {
        fusionar(r.lista, false); store.set('cc_ver', r.ver);
        fusionarListas(r.listas, false);
      }).catch(function () {
        songs = iniciales();
      }).then(function () { saveSongs(); route(); });
    } else {
      route();
      // Si el repositorio tiene una versión más nueva, agrega solo las canciones que no tengas.
      descargarRepo().then(function (r) {
        if (r.ver > store.get('cc_ver', 0)) {
          var x = fusionar(r.lista, false);
          if (x.add) saveSongs();
          var y = fusionarListas(r.listas, false);
          store.set('cc_ver', r.ver);
          if (x.add || y.add) {
            renderList();
            toast((x.add ? x.add + ' canciones nuevas del repositorio' : 'Del repositorio') + textoListas(y));
          }
        }
      }).catch(function () {});
    }
  }

  applyTheme();
  iniciar();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
