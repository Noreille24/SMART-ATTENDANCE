/* Minimal QR Code generator: byte mode, error-correction level M, versions 1-10 (up to ~213 bytes).
   No dependencies. Usage: QR.toSvg("https://example.com", { border: 4 }) -> SVG markup string. */
(function (global) {
  'use strict';
  var ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];  // ECC codewords per block (level M), by version
  var BLK = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];            // number of blocks (level M), by version

  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  }
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function rsDivisor(deg) {
    var r = new Array(deg).fill(0); r[deg - 1] = 1; var root = 1;
    for (var i = 0; i < deg; i++) {
      for (var j = 0; j < deg; j++) { r[j] = gfMul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = new Array(div.length).fill(0);
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= gfMul(c, f); });
    });
    return r;
  }
  var bit = function (x, i) { return ((x >>> i) & 1) !== 0; };

  function alignPositions(v) {
    if (v === 1) return [];
    var n = Math.floor(v / 7) + 2, size = v * 4 + 17;
    var step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    var res = [6];
    for (var pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  function encode(str) {
    var bytes = Array.from(new TextEncoder().encode(str));
    var v, dataCw;
    for (v = 1; v <= 10; v++) {
      dataCw = Math.floor(rawModules(v) / 8) - ECC[v] * BLK[v];
      if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCw * 8) break;
    }
    if (v > 10) throw new Error('QR text too long');
    var bits = [];
    var push = function (val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });
    push(0, Math.min(4, dataCw * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    for (var pad = 0xEC; bits.length < dataCw * 8; pad ^= 0xEC ^ 0x11) push(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0; for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k]; data.push(byte);
    }
    // split into blocks, add error correction, interleave
    var nb = BLK[v], eccLen = ECC[v], raw = Math.floor(rawModules(v) / 8);
    var shortBlocks = nb - (raw % nb), shortLen = Math.floor(raw / nb);
    var div = rsDivisor(eccLen), blocks = [], k2 = 0;
    for (var b = 0; b < nb; b++) {
      var len = shortLen - eccLen + (b < shortBlocks ? 0 : 1);
      var dat = data.slice(k2, k2 + len); k2 += len;
      var ecc = rsRemainder(dat, div);
      if (b < shortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (var x = 0; x < blocks[0].length; x++) {
      blocks.forEach(function (blk, j) { if (x !== shortLen - eccLen || j >= shortBlocks) out.push(blk[x]); });
    }
    return { version: v, codewords: out };
  }

  function build(str) {
    var enc = encode(str), v = enc.version, size = v * 4 + 17;
    var m = [], fn = [];
    for (var y = 0; y < size; y++) { m.push(new Array(size).fill(0)); fn.push(new Array(size).fill(false)); }
    function setFn(x, y, dark) { m[y][x] = dark ? 1 : 0; fn[y][x] = true; }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
    function formatBits(mask) {
      var data = mask, rem = data; // error level M = 00
      for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412;
      for (i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
      setFn(8, 7, bit(bits, 6)); setFn(8, 8, bit(bits, 7)); setFn(7, 8, bit(bits, 8));
      for (i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
      for (i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
      for (i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
      setFn(8, size - 8, true);
    }
    // function patterns
    for (var i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = alignPositions(v), n = ap.length;
    for (i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setFn(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    formatBits(0);
    if (v >= 7) {
      var rem = v;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (v << 12) | rem;
      for (i = 0; i < 18; i++) { var a = size - 11 + (i % 3), b = Math.floor(i / 3); setFn(a, b, bit(vb, i)); setFn(b, a, bit(vb, i)); }
    }
    // place data bits in zigzag order
    var cw = enc.codewords, k = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && k < cw.length * 8) { m[y][x] = bit(cw[k >>> 3], 7 - (k & 7)) ? 1 : 0; k++; }
      }
    }
    function applyMask(mask) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
        }
        if (!fn[y][x] && inv) m[y][x] ^= 1;
      }
    }
    function count(s, pat) { var c = 0, p = s.indexOf(pat); while (p >= 0) { c++; p = s.indexOf(pat, p + 1); } return c; }
    function penalty() {
      var p = 0, dark = 0;
      for (var pass = 0; pass < 2; pass++) for (var a = 0; a < size; a++) {
        var run = 1, s = '';
        for (var b = 0; b < size; b++) {
          var c = pass ? m[b][a] : m[a][b];
          s += c;
          if (b > 0) {
            var prev = pass ? m[b - 1][a] : m[a][b - 1];
            if (c === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
          }
        }
        p += 40 * (count(s, '10111010000') + count(s, '00001011101'));
      }
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        dark += m[y][x];
        if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
      var total = size * size, kk = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      return p + Math.max(0, kk) * 10;
    }
    var best = 0, bestP = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(mask); formatBits(mask);
      var pen = penalty();
      if (pen < bestP) { bestP = pen; best = mask; }
      applyMask(mask);
    }
    applyMask(best); formatBits(best);
    return { size: size, modules: m };
  }

  function toSvg(str, opts) {
    opts = opts || {};
    var border = opts.border == null ? 4 : opts.border, q = build(str), s = q.size, d = [];
    for (var y = 0; y < s; y++) for (var x = 0; x < s; x++) if (q.modules[y][x]) d.push('M' + (x + border) + ',' + (y + border) + 'h1v1h-1z');
    var dim = s + border * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges" role="img" aria-label="' + (opts.label || 'QR code') + '">' +
      '<rect width="100%" height="100%" fill="#fff"/><path d="' + d.join('') + '" fill="#000"/></svg>';
  }
  global.QR = { toSvg: toSvg, build: build };
})(typeof window !== 'undefined' ? window : globalThis);
