/* 精簡離線 QR Code 產生器（ISO/IEC 18004 Byte 模式，Version 1–20，容錯等級 M）
   無外部相依，直接輸出高對比 SVG，供「換機 QR Code」使用（不發任何外部網路請求）。 */
(function (root) {
  'use strict';

  // EC Level M（15% 容錯，適合手機翻拍電腦螢幕）：Version 1..20
  const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
  const NUM_BLOCKS    = [0,  1,  1,  1,  2,  2,  4,  4,  4,  5,  5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16];

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    const s = unescape(encodeURIComponent(str));
    const out = [];
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsGenerator(deg) {
    const res = new Array(deg).fill(0);
    res[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) {
        res[j] = gfMul(res[j], root);
        if (j + 1 < deg) res[j] ^= res[j + 1];
      }
      root = gfMul(root, 2);
    }
    return res;
  }

  function rsRemainder(data, gen) {
    const res = new Array(gen.length).fill(0);
    for (let i = 0; i < data.length; i++) {
      const f = data[i] ^ res.shift();
      res.push(0);
      for (let j = 0; j < gen.length; j++) res[j] ^= gfMul(gen[j], f);
    }
    return res;
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    const num = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
    const res = [6];
    for (let p = ver * 4 + 10; res.length < num; p -= step) res.splice(1, 0, p);
    return res;
  }

  function rawDataModules(ver) {
    let res = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      res -= (25 * n - 10) * n - 55;
      if (ver >= 7) res -= 36;
    }
    return res;
  }

  function dataCapacity(ver) {
    return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }

  function chooseVersion(byteLen) {
    for (let v = 1; v <= 20; v++) {
      const ccBits = v <= 9 ? 8 : 16;
      const needBytes = Math.ceil((4 + ccBits + byteLen * 8) / 8);
      if (needBytes <= dataCapacity(v)) return v;
    }
    throw new Error('資料過長，無法產生 QR Code');
  }

  function encodeData(bytes, ver) {
    const cap = dataCapacity(ver);
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4); // Byte 模式
    push(bytes.length, ver <= 9 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);
    // 結束符（最多 4 bit）與位元組對齊
    const capBits = cap * 8;
    const term = Math.min(4, capBits - bits.length);
    for (let i = 0; i < term; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    // 填補碼字 0xEC / 0x11
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      out.push(b);
    }
    return out;
  }

  function addEccAndInterleave(data, ver) {
    const rawCw = Math.floor(rawDataModules(ver) / 8);
    const nb = NUM_BLOCKS[ver];
    const ecLen = ECC_PER_BLOCK[ver];
    const numShort = nb - (rawCw % nb);
    const shortLen = Math.floor(rawCw / nb);
    const gen = rsGenerator(ecLen);
    const blocks = [];
    let k = 0;
    for (let i = 0; i < nb; i++) {
      const datLen = shortLen - ecLen + (i < numShort ? 0 : 1);
      const dat = data.slice(k, k + datLen);
      k += datLen;
      const ecc = rsRemainder(dat, gen);
      blocks.push({ dat, ecc });
    }
    const res = [];
    const maxDat = shortLen - ecLen + 1;
    for (let i = 0; i < maxDat; i++) {
      for (let j = 0; j < nb; j++) if (i < blocks[j].dat.length) res.push(blocks[j].dat[i]);
    }
    for (let i = 0; i < ecLen; i++) {
      for (let j = 0; j < nb; j++) res.push(blocks[j].ecc[i]);
    }
    return res;
  }

  function makeMatrix(size) {
    return Array.from({ length: size }, () => new Uint8Array(size));
  }

  function drawFunctionPatterns(ver, mod, isFunc) {
    const size = ver * 4 + 17;
    const set = (x, y, dark) => { mod[y][x] = dark ? 1 : 0; isFunc[y][x] = 1; };

    // 時序圖樣
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

    // 三個定位圖樣（含 1 格白邊）
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            const d = Math.max(Math.abs(dx), Math.abs(dy));
            set(x, y, d !== 2 && d !== 4);
          }
        }
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    // 校正圖樣
    const ap = alignPositions(ver);
    for (let i = 0; i < ap.length; i++) {
      for (let j = 0; j < ap.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
        const cx = ap[i], cy = ap[j];
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    // 先保留格式資訊與版本資訊位置
    drawFormatBits(ver, 0, mod, isFunc);
    if (ver >= 7) drawVersionBits(ver, mod, isFunc);
  }

  function drawFormatBits(ver, mask, mod, isFunc) {
    const size = ver * 4 + 17;
    const set = (x, y, dark) => { mod[y][x] = dark ? 1 : 0; isFunc[y][x] = 1; };
    // EC Level M 的格式位元是 0b00
    const data = (0 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = i => ((bits >>> i) & 1) !== 0;

    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // 固定黑點
  }

  function drawVersionBits(ver, mod, isFunc) {
    const size = ver * 4 + 17;
    const set = (x, y, dark) => { mod[y][x] = dark ? 1 : 0; isFunc[y][x] = 1; };
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  function drawCodewords(codewords, mod, isFunc) {
    const size = mod.length;
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (!isFunc[y][x]) {
            let dark = 0;
            if (bitIdx < totalBits) dark = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            mod[y][x] = dark;
            bitIdx++;
          }
        }
      }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function applyMask(mask, mod, isFunc) {
    const size = mod.length, fn = MASKS[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFunc[y][x] && fn(x, y)) mod[y][x] ^= 1;
      }
    }
  }

  function penalty(mod) {
    const size = mod.length;
    let score = 0;
    // 規則 1：同色連續 ≥ 5
    for (let y = 0; y < size; y++) {
      let runC = mod[y][0], runL = 1;
      for (let x = 1; x < size; x++) {
        if (mod[y][x] === runC) { runL++; if (runL === 5) score += 3; else if (runL > 5) score++; }
        else { runC = mod[y][x]; runL = 1; }
      }
    }
    for (let x = 0; x < size; x++) {
      let runC = mod[0][x], runL = 1;
      for (let y = 1; y < size; y++) {
        if (mod[y][x] === runC) { runL++; if (runL === 5) score += 3; else if (runL > 5) score++; }
        else { runC = mod[y][x]; runL = 1; }
      }
    }
    // 規則 2：2x2 同色方塊
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
      }
    }
    // 規則 3：類定位圖樣 1:1:3:1:1（含 4 格白邊）
    const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x <= size - 11; x++) {
        let m1 = true, m2 = true;
        for (let k = 0; k < 11; k++) {
          if (mod[y][x + k] !== p1[k]) m1 = false;
          if (mod[y][x + k] !== p2[k]) m2 = false;
        }
        if (m1 || m2) score += 40;
      }
    }
    for (let x = 0; x < size; x++) {
      for (let y = 0; y <= size - 11; y++) {
        let m1 = true, m2 = true;
        for (let k = 0; k < 11; k++) {
          if (mod[y + k][x] !== p1[k]) m1 = false;
          if (mod[y + k][x] !== p2[k]) m2 = false;
        }
        if (m1 || m2) score += 40;
      }
    }
    // 規則 4：黑格比例偏離 50%
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += mod[y][x];
    const k = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1;
    score += Math.max(0, k) * 10;
    return score;
  }

  function encode(text) {
    const bytes = utf8Bytes(String(text || ''));
    const ver = chooseVersion(bytes.length);
    const size = ver * 4 + 17;
    const data = encodeData(bytes, ver);
    const codewords = addEccAndInterleave(data, ver);

    const mod = makeMatrix(size);
    const isFunc = makeMatrix(size);
    drawFunctionPatterns(ver, mod, isFunc);
    drawCodewords(codewords, mod, isFunc);

    let bestMask = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m, mod, isFunc);
      drawFormatBits(ver, m, mod, isFunc);
      const s = penalty(mod);
      if (s < bestScore) { bestScore = s; bestMask = m; }
      applyMask(m, mod, isFunc);
    }
    applyMask(bestMask, mod, isFunc);
    drawFormatBits(ver, bestMask, mod, isFunc);

    return { version: ver, size, mask: bestMask, modules: mod, codewords };
  }

  function toSvg(text, quiet = 4) {
    const qr = encode(text);
    const full = qr.size + quiet * 2;
    const parts = [];
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) parts.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" role="img" aria-label="雲端同步設定 QR Code" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#ffffff"/><path d="${parts.join('')}" fill="#111111"/></svg>`;
  }

  const api = { encode, toSvg, _internal: { gfMul, rsGenerator, rsRemainder, dataCapacity } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QRCode = api;
})(typeof window !== 'undefined' ? window : globalThis);
