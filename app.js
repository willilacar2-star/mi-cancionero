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

  var state = { filtro: 'todas' };
  var cur = null, editingId = null, listY = 0;

  function saveSongs() { store.set('cc_songs', songs); }
  function savePrefs() { store.set('cc_prefs', prefs); }
  function findSong(id) { for (var i = 0; i < songs.length; i++) if (songs[i].id === id) return songs[i]; return null; }
  function nextId() { return songs.reduce(function (m, s) { return Math.max(m, s.id); }, 0) + 1; }

  /* ---------- Toast ---------- */
  var toastT;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.hidden = true; }, 2600);
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

  function itemHTML(s, numero) {
    var sub = [];
    if (s.artista) sub.push(esc(s.artista));
    if (isMedley(s) && state.filtro !== 'medleys') sub.push(esc(s.seccion));
    return '<a class="item" href="#/c/' + s.id + '">' +
      (numero ? '<span class="num">' + numero + '.</span>' : '') +
      '<span class="txt"><div class="tit">' + esc(s.titulo) +
      (favs.indexOf(s.id) > -1 ? ' <span class="star" aria-label="Favorito">★</span>' : '') + '</div>' +
      (sub.length ? '<div class="sub">' + sub.join(' · ') + '</div>' : '') + '</span>' +
      '<span class="keytile' + (s.tono ? '' : ' empty') + '">' + (s.tono ? esc(s.tono) : '–') + '</span></a>';
  }

  function renderList() {
    renderChips();
    var q = norm($('q').value.trim()), f = state.filtro;
    var arr = songs.filter(function (s) {
      if (f === 'favoritos' && favs.indexOf(s.id) < 0) return false;
      if (f === 'medleys' && !isMedley(s)) return false;
      if ((f === 'Alabanza' || f === 'Adoración') && s.categoria !== f) return false;
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
      grupos.forEach(function (g) {
        html += '<div class="mhead">🎵 ' + esc(g) + '</div>';
        mapa[g].forEach(function (s, i) { html += itemHTML(s, i + 1); });
      });
    } else {
      arr.slice().sort(function (a, b) { return norm(a.titulo).localeCompare(norm(b.titulo), 'es'); })
        .forEach(function (s) { html += itemHTML(s); });
    }
    $('lista').innerHTML = html;
  }

  $('q').addEventListener('input', renderList);
  $('chips').addEventListener('click', function (e) {
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    state.filtro = f; renderList();
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
      return { ver: (d && d.version) || 1, lista: lista };
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

  $('mAct').addEventListener('click', function () {
    descargarRepo().then(function (r) {
      if (!confirm('El repositorio tiene ' + r.lista.length + ' canciones. Las que ya tienes con el mismo título y artista se reemplazan por la versión del repositorio (se pierden tus ediciones locales de esas). ¿Continuar?')) return;
      var x = fusionar(r.lista, true);
      store.set('cc_ver', r.ver); saveSongs(); renderList();
      toast(x.add + ' nuevas, ' + x.upd + ' actualizadas');
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
        if (data && !Array.isArray(data) && Array.isArray(data.canciones)) data = data.canciones;
        if (!Array.isArray(data)) throw new Error('formato');
        var nuevas = data.map(normSong).filter(Boolean);
        if (!nuevas.length) throw new Error('vacío');
        if (!confirm('Se importarán ' + nuevas.length + ' canciones. Si ya tienes una con el mismo título y artista, se reemplaza. ¿Continuar?')) return;
        var x = fusionar(nuevas, true), add = x.add, upd = x.upd;
        saveSongs(); renderList();
        toast(add + ' nuevas, ' + upd + ' actualizadas');
      } catch (err) {
        toast('El archivo no es un JSON de canciones válido.');
      }
    };
    rd.readAsText(file);
    input.value = '';
  });

  $('mExp').addEventListener('click', function () {
    var limpio = songs.map(function (x) { var c = Object.assign({}, x); delete c.id; return c; });
    var salida = { version: store.get('cc_ver', 0) + 1, canciones: limpio };
    var blob = new Blob([JSON.stringify(salida, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'canciones.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 600);
    toast('canciones.json exportado');
  });

  $('mRes').addEventListener('click', function () {
    if (!confirm('Se borrarán todas tus canciones y ediciones y se volverá a la lista del repositorio. ¿Continuar?')) return;
    descargarRepo().then(function (r) {
      songs = []; fusionar(r.lista, false); store.set('cc_ver', r.ver);
    }).catch(function () {
      songs = iniciales();
    }).then(function () { saveSongs(); renderList(); toast('Lista restaurada'); });
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

  function secRows(sec, n, flat, modo) {
    var rows = '';
    (sec.lineas || []).forEach(function (l) {
      var ch = l.acordes ? Music.transposeLine(l.acordes, n, flat) : '';
      var ly = l.letra || '', r = '';
      if (modo === 'letra') { if (ly) r = '<div class="ly">' + esc(ly) + '</div>'; }
      else if (modo === 'acordes') { if (ch) r = '<div class="ch">' + esc(ch) + '</div>'; }
      else {
        if (ch) r += '<div class="ch">' + esc(ch) + '</div>';
        if (ly) r += '<div class="ly">' + esc(ly) + '</div>';
      }
      if (r) rows += '<div class="ln">' + r + '</div>';
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
    var lim = $('struct').getBoundingClientRect().bottom + 12, act = -1;
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

  function showSong(id) {
    var s = findSong(id);
    if (!s) { location.hash = '#/'; return; }
    cur = s;
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
        stopAuto(); toast('Fin de la canción'); return;
      }
    }
    auto.raf = requestAnimationFrame(tick);
  }
  function startAuto() {
    if (auto.on) return;
    auto.on = true; auto.acc = 0; auto.last = performance.now();
    $('bAuto').textContent = '⏸ Pausar';
    auto.raf = requestAnimationFrame(tick);
  }
  function stopAuto() {
    auto.on = false; cancelAnimationFrame(auto.raf);
    $('bAuto').textContent = '▶ Auto-scroll';
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
    var base = ['Alabanza', 'Adoración', 'Medley', 'Otra'];
    if (sel && base.indexOf(sel) < 0) base.push(sel);
    $('eCat').innerHTML = base.map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }

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
    $('eVolver').setAttribute('href', s ? '#/c/' + s.id : '#/');
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
    location.hash = '#/c/' + editingId;
  });

  $('eBorrar').addEventListener('click', function () {
    var s = findSong(editingId);
    if (!s || !confirm('¿Eliminar “' + s.titulo + '”? No se puede deshacer.')) return;
    songs = songs.filter(function (x) { return x.id !== s.id; });
    favs = favs.filter(function (x) { return x !== s.id; });
    delete shifts[s.id];
    saveSongs(); store.set('cc_favs', favs); store.set('cc_shifts', shifts);
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
    if (!(m = h.match(/^#\/c\/(\d+)$/))) wakeOff();

    if (m) { view('cancion'); showSong(+m[1]); window.scrollTo(0, 0); }
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
      }).catch(function () {
        songs = iniciales();
      }).then(function () { saveSongs(); route(); });
    } else {
      route();
      // Si el repositorio tiene una versión más nueva, agrega solo las canciones que no tengas.
      descargarRepo().then(function (r) {
        if (r.ver > store.get('cc_ver', 0)) {
          var x = fusionar(r.lista, false);
          store.set('cc_ver', r.ver);
          if (x.add) { saveSongs(); renderList(); toast(x.add + ' canciones nuevas del repositorio'); }
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
