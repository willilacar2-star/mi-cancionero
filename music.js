var Music = (function () {
  var SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  var FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  var IDX = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
  var CHORD_RE = /^([A-G][#b]?)((?:m(?!aj)|maj|min|M|dim|aug|sus|add|º|°|ø|\+|-|\d|\(|\)|#|b)*)(?:\/([A-G][#b]?))?$/;
  var EXTRA_RE = /^(?:\|\||\||-|–|—|\/|\.|…|%|\(?x\d+\)?|N\.?C\.?)$/i;

  function isChord(t) { return CHORD_RE.test(t); }

  // Partes de un token compuesto: "(Ab-G", "//Cm", "D//", "C-D-Eb"
  function piezas(t) { return t.split(/[-()\/|]+/).filter(Boolean); }

  function tokenOk(t) {
    if (isChord(t) || EXTRA_RE.test(t)) return true;
    if (/^[-()\/|.]+$/.test(t)) return true; // solo separadores, p. ej. ")" o "//"
    if (/^\([^()]*\)$/.test(t)) return true; // notas como (CORTE) o (x2)
    var p = piezas(t);
    return p.length > 0 && p.every(function (x) { return isChord(x) || /^x\d+$/i.test(x); });
  }
  function tieneAcorde(t) { return isChord(t) || piezas(t).some(isChord); }

  function isChordLine(s) {
    var t = String(s).trim();
    if (!t) return false;
    var toks = t.split(/\s+/), c = 0;
    for (var i = 0; i < toks.length; i++) {
      if (!tokenOk(toks[i])) return false;
      if (tieneAcorde(toks[i])) c++;
    }
    return c > 0;
  }

  function mod12(n) { return ((n % 12) + 12) % 12; }

  function shiftChord(tok, n, flat) {
    var m = CHORD_RE.exec(tok);
    if (!m) return tok;
    var r = IDX[m[1]];
    if (r === undefined) return tok;
    var names = flat ? FLAT : SHARP;
    var out = names[mod12(r + n)] + m[2];
    if (m[3]) {
      var b = IDX[m[3]];
      out += '/' + (b === undefined ? m[3] : names[mod12(b + n)]);
    }
    return out;
  }

  // Transpone una línea de acordes conservando la alineación con la letra.
  function transposeLine(line, n, flat) {
    if (!n) return line;
    var parts = [], re = /(\s*)(\S+)/g, m;
    while ((m = re.exec(line))) parts.push({ sp: m[1], tk: m[2] });
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var nt = isChord(p.tk) ? shiftChord(p.tk, n, flat)
        : p.tk.replace(/[^-()\/|]+/g, function (x) { return isChord(x) ? shiftChord(x, n, flat) : x; });
      out += p.sp + nt;
      var diff = nt.length - p.tk.length;
      if (diff && i + 1 < parts.length) {
        var len = Math.max(1, parts[i + 1].sp.length - diff);
        parts[i + 1].sp = new Array(len + 1).join(' ');
      }
    }
    return out;
  }

  function useFlats(tono, n) {
    var m = /^([A-G][#b]?)(m?)/.exec(tono || '');
    if (!m || IDX[m[1]] === undefined) return false;
    var idx = mod12(IDX[m[1]] + n);
    var majFlat = [5, 10, 3, 8], minFlat = [2, 7, 0, 5, 10, 3];
    return (m[2] === 'm' ? minFlat : majFlat).indexOf(idx) > -1;
  }

  function tipoDe(titulo) {
    var t = String(titulo).toLowerCase();
    if (t.indexOf('coro') > -1) return 'coro';
    if (t.indexOf('puente') > -1) return 'puente';
    if (t.indexOf('intro') > -1) return 'intro';
    if (t.indexOf('interludio') > -1) return 'interludio';
    if (t.indexOf('final') > -1) return 'final';
    return 'verso';
  }

  // Texto  ->  contenido[]
  function parseTexto(txt) {
    var lines = String(txt || '').replace(/\r/g, '').replace(/\t/g, '    ').split('\n');
    var out = [], sec = null, pending = null;
    function ensure() {
      if (!sec) { sec = { tipo: 'verso', titulo: 'Letra', lineas: [] }; out.push(sec); }
    }
    function flush() {
      if (pending !== null) { ensure(); sec.lineas.push({ acordes: pending, letra: '' }); pending = null; }
    }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      var h = /^\s*\[(.+)\]\s*$/.exec(line);
      if (h) {
        flush();
        sec = { tipo: tipoDe(h[1]), titulo: h[1].trim(), lineas: [] };
        out.push(sec);
        return;
      }
      if (!line.trim()) { flush(); return; }
      if (isChordLine(line)) {
        flush();
        pending = line;
        return;
      }
      ensure();
      sec.lineas.push({ acordes: pending !== null ? pending : '', letra: line });
      pending = null;
    });
    flush();
    return out.filter(function (s) { return s.lineas.length; });
  }

  // contenido[]  ->  Texto
  function toTexto(cont) {
    return (cont || []).map(function (sec) {
      var rows = [];
      (sec.lineas || []).forEach(function (l, i, arr) {
        if (l.acordes) rows.push(l.acordes);
        if (l.letra) rows.push(l.letra);
        else if (l.acordes && arr[i + 1] && !arr[i + 1].acordes && arr[i + 1].letra) rows.push('');
      });
      return '[' + sec.titulo + ']\n' + rows.join('\n');
    }).join('\n\n');
  }

  return {
    isChord: isChord, isChordLine: isChordLine, shiftChord: shiftChord,
    transposeLine: transposeLine, useFlats: useFlats,
    parseTexto: parseTexto, toTexto: toTexto
  };
})();
