'use strict';
// 世界(地形)生成: 陸地マスク → 標高・気候・地形・川・都市候補地
(function () {
  const T = TW.T = { DEEP: 0, SEA: 1, PLAINS: 2, FOREST: 3, HILLS: 4, MOUNTAIN: 5, DESERT: 6, TUNDRA: 7, SNOW: 8 };
  // move: 移動コスト / def: 防御補正 / ease: 入植しやすさ / val: 国力への寄与
  TW.TERRAIN = [
    { name: '外洋', move: 3.8, def: 1, ease: 0, val: 0, color: [190, 198, 178] },
    { name: '近海', move: 2.6, def: 1, ease: 0, val: 0, color: [160, 186, 178] },
    { name: '平原', move: 1.0, def: 1.0, ease: 1.0, val: 1.0, color: [226, 208, 160] },
    { name: '森林', move: 1.7, def: 1.3, ease: 0.55, val: 0.7, color: [190, 196, 142] },
    { name: '丘陵', move: 1.9, def: 1.45, ease: 0.5, val: 0.65, color: [214, 190, 142] },
    { name: '山岳', move: 3.6, def: 2.1, ease: 0.15, val: 0.25, color: [190, 166, 128] },
    { name: '砂漠', move: 1.6, def: 1.0, ease: 0.3, val: 0.2, color: [238, 218, 168] },
    { name: 'ツンドラ', move: 1.7, def: 1.1, ease: 0.3, val: 0.25, color: [212, 210, 188] },
    { name: '氷雪', move: 4.0, def: 1.3, ease: 0.06, val: 0.03, color: [242, 240, 232] },
  ];

  function bfsDistance(W, H, isSource, passable) {
    const N = W * H;
    const dist = new Int16Array(N).fill(-1);
    const q = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (isSource(i)) { dist[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0, d = dist[i] + 1;
      if (x > 0 && dist[i - 1] < 0 && passable(i - 1)) { dist[i - 1] = d; q[qt++] = i - 1; }
      if (x < W - 1 && dist[i + 1] < 0 && passable(i + 1)) { dist[i + 1] = d; q[qt++] = i + 1; }
      if (y > 0 && dist[i - W] < 0 && passable(i - W)) { dist[i - W] = d; q[qt++] = i - W; }
      if (y < H - 1 && dist[i + W] < 0 && passable(i + W)) { dist[i + W] = d; q[qt++] = i + W; }
    }
    return dist;
  }

  function components(W, H, mask, val) {
    const N = W * H;
    const comp = new Int32Array(N).fill(-1);
    const sizes = [];
    const q = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (mask[s] !== val || comp[s] >= 0) continue;
      const id = sizes.length;
      let qh = 0, qt = 0; q[qt++] = s; comp[s] = id;
      let touchesEdge = false;
      while (qh < qt) {
        const i = q[qh++], x = i % W, y = (i / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        for (const j of nb) if (j >= 0 && mask[j] === val && comp[j] < 0) { comp[j] = id; q[qt++] = j; }
      }
      sizes.push({ size: qt, edge: touchesEdge });
    }
    return { comp, sizes };
  }

  // 小島の除去・小さな湖を埋める
  TW.cleanLand = function (W, H, land, minIsland = 5, minLake = 8) {
    let c = components(W, H, land, 1);
    for (let i = 0; i < land.length; i++) if (land[i] && c.sizes[c.comp[i]].size < minIsland) land[i] = 0;
    c = components(W, H, land, 0);
    for (let i = 0; i < land.length; i++) {
      if (!land[i]) { const s = c.sizes[c.comp[i]]; if (!s.edge && s.size < minLake) land[i] = 1; }
    }
    return land;
  };

  // ランダム大陸
  TW.generateRandomLand = function (W, H, rand) {
    const n1 = new TW.Noise(rand), n2 = new TW.Noise(rand);
    const blobs = [];
    const nb = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < nb; k++) {
      blobs.push({
        x: W * (0.12 + rand() * 0.76), y: H * (0.18 + rand() * 0.64),
        r: W * (0.09 + rand() * 0.17), w: 0.55 + rand() * 0.55,
      });
    }
    const vals = new Float32Array(W * H);
    const sc = 120 / Math.max(W, 120);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let h = n1.fbm(x * 0.022 * sc * 2, y * 0.022 * sc * 2, 5) * 0.95;
      h += n2.fbm(x * 0.07, y * 0.07, 3) * 0.22;
      let b = 0;
      for (const bl of blobs) {
        const dx = x - bl.x, dy = (y - bl.y) * 1.25;
        b = Math.max(b, Math.exp(-(dx * dx + dy * dy) / (bl.r * bl.r)) * bl.w);
      }
      h += b * 1.1;
      const edge = Math.min(x, W - 1 - x, (y) * 1.4, (H - 1 - y) * 1.4) / (W * 0.07);
      h -= (1 - Math.min(1, edge)) * 1.3;
      vals[y * W + x] = h;
    }
    const sorted = Array.from(vals).sort((a, b) => b - a);
    const frac = 0.32 + rand() * 0.12;
    const thr = sorted[Math.floor(sorted.length * frac)];
    const land = new Uint8Array(W * H);
    for (let i = 0; i < land.length; i++) land[i] = vals[i] > thr ? 1 : 0;
    return TW.cleanLand(W, H, land);
  };

  TW.earthLand = function () {
    const m = window.EARTH_MAP;
    return { W: m.W, H: m.H, land: TW.decodeRLE(m.rle, m.W * m.H), latTop: m.latTop, latBottom: m.latBottom };
  };

  // 世界自然遺産: 地形に合った場所へランダムに配置 (都市と同じように奪い合える)
  const NATURAL = TW.NATURAL = [
    { key: 'waterfall', name: '大瀑布', icon: '💧', desc: '都市の発展 +20%・人口増加 +25%' },
    { key: 'peak', name: '天を衝く霊峰', icon: '🏔️', desc: '兵の質 +0.05・安定度 +' },
    { key: 'tree', name: '千年の神木', icon: '🌲', desc: '安定度 +・反乱が起きにくい' },
    { key: 'lake', name: '鏡の湖', icon: '🌈', desc: '文化点 +15/年' },
    { key: 'crystal', name: '水晶の大洞窟', icon: '💎', desc: '兵力収入 +15%' },
    { key: 'dunes', name: '黄金の砂丘', icon: '🏜️', desc: '兵力収入 +10%' },
    { key: 'volcano', name: '火の山', icon: '🌋', desc: '兵の質 +0.06 (名工の鍛冶場)' },
    { key: 'aurora', name: '極光の氷原', icon: '❄️', desc: '文化点 +12/年' },
  ];
  function placeNatural(w, rand) {
    const { W, H, terrain, land, elev, river } = w;
    const cells = w.landCells;
    const out = [];
    const far = i => {
      const x = i % W, y = (i / W) | 0;
      for (const c of w.citySites) if ((c.x - x) ** 2 + (c.y - y) ** 2 < 9) return false;
      for (const o of out) if ((o.x - x) ** 2 + (o.y - y) ** 2 < 144) return false;
      return true;
    };
    const around = (i, r, t) => {
      const x = i % W, y = (i / W) | 0; let n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && terrain[yy * W + xx] === t) n++;
      }
      return n;
    };
    // 内陸の湖に面した陸地
    const seaComp = components(W, H, land, 0);
    const lakeShore = i => {
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !land[j] && !seaComp.sizes[seaComp.comp[j]].edge) return true;
      }
      return false;
    };
    const lat = y => Math.abs(w.lat(y));
    const scorers = {
      waterfall: i => (river[i] && terrain[i] !== T.MOUNTAIN && elev[i] > 0.5 ? elev[i] + rand() * 0.2 : -1),
      peak: i => (terrain[i] === T.MOUNTAIN ? elev[i] : -1),
      tree: i => (terrain[i] === T.FOREST ? around(i, 3, T.FOREST) + rand() * 3 : -1),
      lake: i => (lakeShore(i) ? 1 + rand() : -1),
      crystal: i => (terrain[i] === T.HILLS ? around(i, 2, T.HILLS) + rand() * 4 : -1),
      dunes: i => (terrain[i] === T.DESERT ? around(i, 3, T.DESERT) + rand() * 3 : -1),
      volcano: i => (terrain[i] === T.MOUNTAIN ? elev[i] * 0.5 + rand() : -1),
      aurora: i => ((terrain[i] === T.TUNDRA || terrain[i] === T.SNOW) ? lat((i / W) | 0) / 90 + rand() * 0.3 : -1),
    };
    const order = NATURAL.slice().sort(() => rand() - 0.5);
    const maxN = TW.clamp(Math.round(cells.length / 1600), 4, 8);
    for (const def of order) {
      if (out.length >= maxN) break;
      let best = -1, bs = 0;
      for (const i of cells) {
        const s = scorers[def.key](i);
        if (s > bs && far(i)) { bs = s; best = i; }
      }
      if (best < 0) continue;
      out.push({ ...def, i: best, x: best % W, y: (best / W) | 0 });
    }
    return out;
  }

  // 陸地マスクから世界を構築
  TW.buildWorld = function (W, H, landIn, opts = {}) {
    const seed = opts.seed >>> 0;
    const rand = TW.mulberry32(seed ^ 0x9e3779b9);
    const N = W * H;
    const land = new Uint8Array(landIn);
    const w = {
      W, H, N, land, seed, kind: opts.kind || 'random',
      latTop: opts.latTop ?? 70, latBottom: opts.latBottom ?? -70,
    };
    const lat = y => w.latTop + ((y + 0.5) / H) * (w.latBottom - w.latTop);
    w.lat = lat;

    // 海岸からの距離
    const landDist = bfsDistance(W, H, i => !land[i], () => true); // 陸セル: 最寄りの海までの距離
    const seaDist = bfsDistance(W, H, i => land[i] === 1, () => true);
    const hasSea = land.some(v => !v), hasLand = land.some(v => v);
    w.landDist = landDist; w.seaDist = seaDist;
    for (let i = 0; i < N; i++) {
      if (!hasSea && land[i]) landDist[i] = 30;
      if (!hasLand && !land[i]) seaDist[i] = 30;
    }

    const nE = new TW.Noise(rand), nR = new TW.Noise(rand), nM = new TW.Noise(rand), nT = new TW.Noise(rand);
    const elev = new Float32Array(N), moist = new Float32Array(N), temp = new Float32Array(N);
    const terrain = new Uint8Array(N);
    const sc = 240 / W; // マップ大きさに対するノイズ倍率
    for (let y = 0; y < H; y++) {
      const la = Math.abs(lat(y));
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!land[i]) {
          terrain[i] = seaDist[i] <= 2 ? T.SEA : T.DEEP;
          elev[i] = -Math.min(1, seaDist[i] / 10);
          continue;
        }
        const d = landDist[i];
        const base = 1 - Math.exp(-d / 7);
        const ridge = 1 - Math.abs(nR.fbm(x * 0.045 * sc, y * 0.045 * sc, 4));
        let e = 0.1 + base * 0.32 + base * Math.pow(ridge, 5) * 0.75 + nE.fbm(x * 0.05 * sc, y * 0.05 * sc, 4) * 0.2;
        elev[i] = e;
        let t = 1 - la / 78 - Math.max(0, e - 0.5) * 0.45 + nT.fbm(x * 0.04, y * 0.04, 3) * 0.08;
        temp[i] = t;
        let m = 0.62 * Math.exp(-d / 11) + 0.42 * (nM.fbm(x * 0.035 * sc, y * 0.035 * sc, 4) + 0.5);
        if (la > 14 && la < 36) m -= 0.24 * (1 - Math.abs(la - 25) / 11);
        if (la < 12) m += 0.14;
        moist[i] = m;
        let tt;
        if (t < 0.13) tt = T.SNOW;
        else if (t < 0.27) tt = T.TUNDRA;
        else if (e > 0.86 && d >= 2) tt = T.MOUNTAIN;
        else if (e > 0.7 && d >= 1) tt = T.HILLS;
        else if (m < 0.3 && t > 0.45) tt = T.DESERT;
        else if (m > 0.62) tt = T.FOREST;
        else tt = T.PLAINS;
        terrain[i] = tt;
      }
    }
    w.elev = elev; w.moist = moist; w.temp = temp; w.terrain = terrain;

    // 川: 高地から海岸距離が減る方向へ流す
    const river = new Uint8Array(N);
    const flow = new Uint16Array(N);
    const rivers = [];
    const landCells = [];
    for (let i = 0; i < N; i++) if (land[i]) landCells.push(i);
    w.landCells = Int32Array.from(landCells);
    const cand = landCells.filter(i => elev[i] > 0.5 && moist[i] > 0.32 && terrain[i] !== T.SNOW && landDist[i] >= 4);
    const nRivers = Math.min(cand.length, Math.round(landCells.length / 230));
    for (let k = 0; k < nRivers; k++) {
      let i = cand[Math.floor(rand() * cand.length)];
      if (river[i]) continue;
      const path = [i];
      let guard = 0;
      while (land[i] && guard++ < 400) {
        const x = i % W, y = (i / W) | 0;
        let best = -1, bestE = 1e9;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        for (const j of nb) {
          if (j < 0) continue;
          const dj = land[j] ? landDist[j] : 0;
          if (dj < landDist[i]) {
            const e2 = (land[j] ? elev[j] : -1) + rand() * 0.12;
            if (e2 < bestE) { bestE = e2; best = j; }
          }
        }
        if (best < 0) break;
        i = best;
        path.push(i);
        if (river[i]) break; // 合流
      }
      if (path.length >= 6) {
        rivers.push(path);
        for (let p = 0; p < path.length; p++) {
          const c = path[p];
          if (land[c]) { river[c] = 1; flow[c] = Math.min(65000, flow[c] + p + 1); }
        }
      }
    }
    w.river = river; w.flow = flow; w.rivers = rivers;

    // 陸塊ラベル
    const lc = components(W, H, land, 1);
    w.landmass = lc.comp; w.landmassSize = lc.sizes.map(s => s.size);

    // 都市候補地
    const tScore = [0, 0, 1, 0.6, 0.5, 0.06, 0.15, 0.2, 0];
    const scored = [];
    for (const i of landCells) {
      let s = tScore[terrain[i]];
      if (s <= 0) continue;
      if (river[i]) s += 0.6;
      if (landDist[i] === 1) s += 0.45;
      s += rand() * 0.6;
      scored.push([s, i]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const target = TW.clamp(Math.round(landCells.length / 105), 10, 260);
    const minD = Math.max(4, Math.sqrt(landCells.length / target) * 0.82);
    const chosen = [];
    const bucket = new Map();
    const bs = Math.ceil(minD);
    const key = (bx, by) => bx * 10007 + by;
    for (const [s, i] of scored) {
      if (chosen.length >= target) break;
      const x = i % W, y = (i / W) | 0;
      const bx = Math.floor(x / bs), by = Math.floor(y / bs);
      let ok = true;
      for (let ox = -1; ox <= 1 && ok; ox++) for (let oy = -1; oy <= 1 && ok; oy++) {
        const arr = bucket.get(key(bx + ox, by + oy));
        if (!arr) continue;
        for (const c of arr) { const dx = c.x - x, dy = c.y - y; if (dx * dx + dy * dy < minD * minD) { ok = false; break; } }
      }
      if (!ok) continue;
      const c = { x, y, i, base: 0.6 + s };
      chosen.push(c);
      const k = key(bx, by);
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k).push(c);
    }
    const used = new Set();
    for (const c of chosen) c.name = TW.Names.city(rand, used);
    w.citySites = chosen;
    w.usedNames = used;
    w.natSites = placeNatural(w, rand);
    return w;
  };
})();
