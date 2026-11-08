'use strict';
// 共通ユーティリティ: 乱数・ノイズ・名前生成・配色
const TW = window.TW = window.TW || {};

TW.hashString = function (str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
};

TW.mulberry32 = function (a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

TW.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
TW.lerp = (a, b, t) => a + (b - a) * t;

// Perlin ノイズ
TW.Noise = class {
  constructor(rand) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.gx = new Float32Array(256);
    this.gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const a = rand() * Math.PI * 2;
      this.gx[i] = Math.cos(a); this.gy[i] = Math.sin(a);
    }
  }
  noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const P = this.perm, gx = this.gx, gy = this.gy;
    const aa = P[P[X] + Y], ab = P[P[X] + Y + 1], ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const n00 = gx[aa] * xf + gy[aa] * yf;
    const n10 = gx[ba] * (xf - 1) + gy[ba] * yf;
    const n01 = gx[ab] * xf + gy[ab] * (yf - 1);
    const n11 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
    const x1 = n00 + (n10 - n00) * u;
    const x2 = n01 + (n11 - n01) * u;
    return (x1 + (x2 - x1) * v) * 1.414;
  }
  fbm(x, y, oct = 5, lac = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += this.noise2(x * freq + o * 17.3, y * freq - o * 9.1) * amp;
      norm += amp; amp *= gain; freq *= lac;
    }
    return sum / norm;
  }
};

// ---------- 名前生成 ----------
TW.Names = (function () {
  const START = ['ア', 'ヴェ', 'カ', 'ザ', 'ル', 'ミ', 'オ', 'ガ', 'エ', 'セ', 'ノ', 'ハ', 'ベ', 'ド', 'フィ', 'グ', 'ラ', 'ティ', 'ソ', 'ヤ', 'イ', 'ク', 'マ', 'ヘ', 'ロ', 'ナ', 'ジ', 'ブ', 'ウ', 'ペ', 'シ', 'タ', 'ヴァ', 'ゼ', 'モ', 'キ', 'レ', 'ト', 'ビ', 'ファ', 'リ', 'ス', 'ディ', 'ゴ', 'ネ', 'バ', 'コ', 'ヨ', 'ユ', 'ホ'];
  const MID = ['ル', 'ラ', 'ン', 'ド', 'リ', 'ス', 'ガ', 'ロ', 'ネ', 'ト', 'ディ', 'ヴィ', 'ム', 'カ', 'レ', 'ザ', 'ニ', 'ベ', 'タ', 'シ', 'ミ', 'ゴ', 'ノ', 'ル', 'ラ', 'リ', 'セ', 'ヴォ', 'グ', 'ハ', 'ナ', 'テ', 'メ', 'ク'];
  const END = ['ア', 'ィア', 'ス', 'ン', 'ド', 'ル', 'リア', 'ニア', 'ラ', 'ム', 'ト', 'ガ', 'ール', 'ディア', 'スタン', 'ヴァ', 'オン', 'ニカ', 'ラント', 'ベル', 'ヤ', 'ロス', 'ネ', 'リス', 'ゴル', 'ーン', 'ティア', 'ドル', 'シア', 'マール'];
  const GOV = [['王国', 10], ['帝国', 4], ['公国', 5], ['共和国', 6], ['連邦', 3], ['大公国', 2], ['首長国', 3], ['神聖国', 2], ['侯国', 3], ['連合', 2], ['教国', 2], ['ハン国', 2], ['部族連合', 2], ['自由都市同盟', 1]];
  const REBEL_GOV = [['共和国', 6], ['自由国', 4], ['公国', 3], ['人民共和国', 2], ['首長国', 2], ['連邦', 2], ['王国', 3], ['侯国', 2], ['解放戦線', 1]];
  const CITY_SUF = ['', '', '', '', '', 'ブルク', 'ポリス', 'ハイム', 'グラード', 'ポート', 'ヴィル', 'ガルド', 'ホルム', 'ミナ', 'ヘイヴン'];
  const pick = (arr, r) => arr[Math.floor(r() * arr.length)];
  const wpick = (arr, r) => {
    let tot = 0; for (const a of arr) tot += a[1];
    let x = r() * tot;
    for (const a of arr) { x -= a[1]; if (x <= 0) return a[0]; }
    return arr[0][0];
  };
  function root(r, minLen = 2) {
    let s = pick(START, r);
    const mids = r() < 0.55 ? 1 : (r() < 0.6 ? 0 : 2);
    for (let i = 0; i < mids; i++) s += pick(MID, r);
    s += pick(END, r);
    if (s.length < minLen) s += pick(END, r);
    return s.replace(/ーー/g, 'ー').replace(/ンン/g, 'ン');
  }
  return {
    root,
    gov: r => wpick(GOV, r),
    rebelGov: r => wpick(REBEL_GOV, r),
    uniqueRoot(r, used) {
      for (let k = 0; k < 50; k++) {
        const s = root(r);
        if (s.length >= 2 && s.length <= 6 && !used.has(s)) { used.add(s); return s; }
      }
      const s = root(r) + root(r); used.add(s); return s;
    },
    general(r) {
      const n = root(r);
      return n.length > 5 ? n.slice(0, 4) : n;
    },
    city(r, used) {
      for (let k = 0; k < 60; k++) {
        let s = root(r);
        const suf = pick(CITY_SUF, r);
        if (suf && s.length <= 4) s += suf;
        if (!used.has(s) && s.length <= 8) { used.add(s); return s; }
      }
      const s = root(r) + '・' + root(r); used.add(s); return s;
    },
  };
})();

// ---------- 配色 ----------
TW.hslToRgb = function (h, s, l) {
  h = ((h % 1) + 1) % 1;
  const f = n => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
};
TW.colorDist = function (a, b) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
};
// 既存色からなるべく離れた古地図風の色を選ぶ
TW.pickColor = function (existing, rand, avoidStrong) {
  let best = null, bestD = -1;
  for (let k = 0; k < 48; k++) {
    const h = rand();
    const s = 0.38 + rand() * 0.32;
    const l = 0.46 + rand() * 0.2;
    const c = TW.hslToRgb(h, s, l);
    let d = 1e9;
    for (const e of existing) d = Math.min(d, TW.colorDist(c, e));
    for (const e of (avoidStrong || [])) d = Math.min(d, TW.colorDist(c, e) * 0.6);
    if (d > bestD) { bestD = d; best = c; }
  }
  return best;
};
TW.rgbCss = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
TW.darken = (c, f) => [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];

// 兵数表示 (内部値×100人)
TW.fmtTroops = function (str) {
  const n = Math.round(str * 100);
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万';
  return n.toLocaleString('ja-JP');
};

// RLE (0から開始、交互の連長を36進カンマ区切り)
TW.encodeRLE = function (arr) {
  const runs = []; let cur = 0, n = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] ? 1 : 0;
    if (v === cur) n++; else { runs.push(n); cur = v; n = 1; }
  }
  runs.push(n);
  return runs.map(r => r.toString(36)).join(',');
};
TW.decodeRLE = function (str, N) {
  const out = new Uint8Array(N);
  let p = 0, v = 0;
  for (const s of str.split(',')) {
    const n = parseInt(s, 36);
    if (v) out.fill(1, p, Math.min(N, p + n));
    p += n; v ^= 1;
  }
  return out;
};
