'use strict';
// 領土戦シミュレーション
(function () {
  const T = TW.T;
  const TPY = TW.TPY = 48;          // 1年あたりのティック数
  const MAXN = TW.MAXN = 64;        // 同時に存在できる国の最大数(ID)
  const MAX_ALIVE = 44;
  // 文化の時代と到達に必要な文化点
  const ERAS = TW.ERAS = [
    { name: '草創期', need: 0 }, { name: '部族期', need: 60 }, { name: '王権期', need: 180 }, { name: '古典期', need: 400 },
    { name: '黄金期', need: 750 }, { name: '学芸期', need: 1250 }, { name: '啓蒙期', need: 1950 }, { name: '栄華期', need: 2900 },
  ];
  // 都市の発展度で建つ施設
  const BUILDINGS = TW.BUILDINGS = [
    { dev: 1, name: '農地', icon: '🌾', desc: '人口増加' },
    { dev: 2, name: '市場', icon: '⚖️', desc: '兵力収入' },
    { dev: 4, name: '城壁', icon: '🧱', desc: '守備力+40%' },
    { dev: 6, name: '学院', icon: '📜', desc: '文化点' },
    { dev: 8, name: '大聖堂', icon: '⛪', desc: '安定・反乱抑止' },
    { dev: 10, name: '大図書館', icon: '🏛️', desc: '大きな文化点' },
  ];
  // 世界に一つだけの驚異
  const WONDERS = TW.WONDERS = [
    { key: 'lighthouse', name: '天空の大灯台', icon: '🗼', desc: '海上の移動が速くなり、収入+10%', coastal: true },
    { key: 'temple', name: '黄金の大神殿', icon: '🛕', desc: '安定度が上がり、反乱が起きにくい' },
    { key: 'library', name: '叡智の大図書院', icon: '📚', desc: '文化点 +25/年' },
    { key: 'fortress', name: '不落の大城塞', icon: '🏯', desc: 'この都市の守備力×2、全都市の守備力+10%' },
    { key: 'garden', name: '天空の庭園', icon: '🌳', desc: '都市の人口増加 +50%' },
    { key: 'colossus', name: '巨神像', icon: '🗿', desc: '兵の質 +0.10' },
    { key: 'observatory', name: '星詠みの塔', icon: '🔭', desc: '都市の発展速度 +30%' },
    { key: 'bazaar', name: '千夜の大市場', icon: '🏺', desc: '兵力収入 +20%' },
  ];
  // 道: 軍の通行量で育つ
  const ROAD_LV = TW.ROAD_LV = [4, 14, 35];          // 小道 / 街道 / 大街道
  const ROAD_MULT = [1, 0.8, 0.6, 0.45];
  TW.ROAD_NAMES = ['', '小道', '街道', '大街道'];
  TW.roadLevel = v => (v >= ROAD_LV[2] ? 3 : v >= ROAD_LV[1] ? 2 : v >= ROAD_LV[0] ? 1 : 0);
  TW.buildingsOf = dev => BUILDINGS.filter(b => dev >= b.dev);
  TW.eraOf = culture => { let e = 0; for (let k = 0; k < ERAS.length; k++) if (culture >= ERAS[k].need) e = k; return e; };

  class Sim {
    constructor(world, opts = {}) {
      this.w = world;
      const N = world.N;
      this.rand = Math.random;
      this.t = 0;
      this.owner = new Int16Array(N).fill(-1);
      this.cityAt = new Int16Array(N).fill(-1);
      this.nations = [];
      this.armies = [];
      this.log = [];
      this.logSeq = 0;
      this.history = [];
      this.effects = [];
      this.labels = [];
      this.uidSeq = 0;
      this.armySeq = 0;
      this.dirty = true;
      this.onEvent = null;
      this.landCount = world.landCells.length;
      this.opinion = new Float32Array(MAXN * MAXN);
      this.rel = new Uint8Array(MAXN * MAXN);          // 0 平和 / 1 戦争 / 2 同盟
      this.truce = new Int32Array(MAXN * MAXN);
      this.warStart = new Int32Array(MAXN * MAXN);
      this.warScore = new Float32Array(MAXN * MAXN);
      this.border = new Int32Array(MAXN * MAXN);
      this.usedRoots = new Set();
      // A* 用作業領域
      this.g = new Float32Array(N);
      this.came = new Int32Array(N);
      this.stamp = new Uint32Array(N);
      this.closed = new Uint32Array(N);
      this.gen = 1;
      this.mark = new Uint32Array(N);
      this.markGen = 1;
      this.queue = new Int32Array(N);
      this.label = new Int32Array(N);
      this.road = new Float32Array(N);       // 道の通行量
      this.roadDirty = true;
      this.wonders = WONDERS.map(w => ({ ...w, state: 'none', city: -1, builtYear: 0, builder: null }));
      this.poems = [];
      this.annals = [];                       // 歴史書用の永続記録
      this.eraSnaps = [];                     // 5年ごとの勢力記録
      this.allNations = [];

      this.cities = world.citySites.map((s, k) => ({
        id: k, x: s.x, y: s.y, i: s.i, name: s.name,
        pop: Math.min(4, s.base * (0.8 + this.rand() * 0.8)), owner: -1,
        originRoot: null, defense: 0, unrest: 0, conqueredAt: -99999, besieged: -99, capital: false,
        dev: 0.3 + this.rand() * 0.8, built: 0,
      }));
      for (const c of this.cities) { this.cityAt[c.i] = c.id; c.defense = this.maxDefense(c); }
      this.initNations(opts.nations || 8, opts.capitals);
      this.initialCount = Math.max(2, this.aliveNations().length);
      this.computeBorders();
      this.computeLabels();
      this.snapshot();
      this.addLog('era', `暦1年、${this.aliveNations().length}つの国が歴史の幕を開けた`, null, true);
    }

    // ---------- 基本 ----------
    k(a, b) { return a * MAXN + b; }
    atWar(a, b) { return a !== b && a >= 0 && b >= 0 && this.rel[a * MAXN + b] === 1; }
    allied(a, b) { return a >= 0 && b >= 0 && this.rel[a * MAXN + b] === 2; }
    hasTruce(a, b) { return this.truce[a * MAXN + b] > this.t; }
    setRel(a, b, v) { this.rel[a * MAXN + b] = v; this.rel[b * MAXN + a] = v; }
    setOp(a, b, v) { v = TW.clamp(v, -100, 100); this.opinion[a * MAXN + b] = v; this.opinion[b * MAXN + a] = v; }
    op(a, b) { return this.opinion[a * MAXN + b]; }
    year() { return Math.floor(this.t / TPY) + 1; }
    month() { return Math.floor((this.t % TPY) / (TPY / 12)) + 1; }
    aliveNations() { return this.nations.filter(n => n && n.alive); }
    nationByUid(uid) { return this.nations.find(n => n && n.uid === uid) || this.graveyard?.get(uid) || null; }

    maxDefense(c) {
      const tdef = TW.TERRAIN[this.w.terrain[c.i]].def;
      const q = c.owner >= 0 && this.nations[c.owner] ? this.quality(c.owner) : 1;
      let wm = 1;
      if (c.owner >= 0 && this.wonders) {
        const own = this.nations[c.owner];
        if (this.hasWonder(own, 'fortress')) wm = 1.1;
        const wd = this.wonderAt(c.id);
        if (wd && wd.key === 'fortress') wm = 2;
      }
      return (8 + c.pop * 5) * (c.capital ? 1.7 : 1) * tdef * (this.w.river[c.i] ? 1.1 : 1) * (c.dev >= 4 ? 1.4 : 1) * q * wm;
    }
    // 文化の時代による兵の質
    quality(id) { const n = this.nations[id]; return n ? 1 + n.era * 0.08 + (n.wonders && n.wonders.includes('colossus') ? 0.1 : 0) : 1; }
    hasWonder(n, key) { return !!(n && n.wonders && n.wonders.includes(key)); }
    wonderAt(cityId) { return (this.wonderByCity && this.wonderByCity.get(cityId)) || null; }

    addLog(type, text, pos, major = false, nations = []) {
      const e = {
        seq: ++this.logSeq, t: this.t, year: this.year(), type, text, major,
        x: pos ? pos.x : null, y: pos ? pos.y : null, ns: nations.map(n => n.uid),
      };
      this.log.push(e);
      if (this.log.length > 1500) this.log.splice(0, this.log.length - 1200);
      if (major || type === 'wonder' || type === 'poem') {
        this.annals.push(e);
        if (this.annals.length > 5000) this.annals.splice(0, 1000);
      }
      if (this.onEvent) this.onEvent(e);
      return e;
    }
    effect(type, x, y, r = 3, extra = {}) {
      this.effects.push(Object.assign({ type, x, y, r, born: performance.now() }, extra));
      if (this.effects.length > 200) this.effects.splice(0, this.effects.length - 200);
    }

    setOwner(i, n) {
      const o = this.owner[i];
      if (o === n) return;
      const v = TW.TERRAIN[this.w.terrain[i]].val;
      if (o >= 0) { const no = this.nations[o]; no.cells--; no.value -= v; }
      if (n >= 0) { const nn = this.nations[n]; nn.cells++; nn.value += v; }
      this.owner[i] = n;
      this.dirty = true;
    }

    // ---------- 国の生成 ----------
    freeId() {
      for (let id = 0; id < this.nations.length; id++) {
        const n = this.nations[id];
        if (!n || (!n.alive && n.cells === 0 && this.t - n.deadAt > TPY * 2)) return id;
      }
      return this.nations.length < MAXN ? this.nations.length : -1;
    }

    createNation(city, opts = {}) {
      const id = this.freeId();
      if (id < 0) return null;
      const old = this.nations[id];
      if (old) { this.graveyard = this.graveyard || new Map(); this.graveyard.set(old.uid, old); }
      const r = this.rand;
      let root = opts.root;
      if (!root || [...this.nations].some(n => n && n.alive && n.root === root)) root = TW.Names.uniqueRoot(r, this.usedRoots);
      const gov = opts.gov || TW.Names.gov(r);
      const others = this.aliveNations().map(n => n.color);
      const strong = opts.avoid || [];
      const color = TW.pickColor(others, r, strong);
      for (let j = 0; j < MAXN; j++) {
        this.rel[id * MAXN + j] = 0; this.rel[j * MAXN + id] = 0;
        this.opinion[id * MAXN + j] = 0; this.opinion[j * MAXN + id] = 0;
        this.truce[id * MAXN + j] = 0; this.truce[j * MAXN + id] = 0;
        this.warScore[id * MAXN + j] = 0; this.warScore[j * MAXN + id] = 0;
      }
      const n = {
        id, uid: ++this.uidSeq, root, gov, name: root + gov, color,
        css: TW.rgbCss(color), dark: TW.rgbCss(TW.darken(color, 0.55)),
        alive: true, capital: city.id, cells: 0, value: 0,
        manpower: opts.manpower ?? 40, armyStr: 0, armyCount: 0, cityCount: 0, cityPop: 0,
        culture: opts.culture || 0, era: TW.eraOf(opts.culture || 0), devSum: 0, cultureGain: 0,
        aggression: 0.15 + r() * 0.85, stability: 0.85, founded: this.t, deadAt: -1,
        wars: 0, allies: 0, strength: 0, expand: 0.8 + r() * 0.4, frontierFree: 0,
        parentName: opts.parentName || null, peakCells: 0, capitalLostAt: -99999,
        battlesWon: 0, battlesLost: 0, citiesTaken: 0,
        wonders: [], seaFast: false, project: null, maxEra: TW.eraOf(opts.culture || 0),
      };
      this.nations[id] = n;
      this.allNations.push(n);
      return n;
    }

    giveCity(c, n, conquered) {
      const prev = c.owner;
      if (prev >= 0 && this.nations[prev] && this.nations[prev].capital === c.id) c.capital = false;
      c.owner = n;
      if (n >= 0 && !c.originRoot) c.originRoot = this.nations[n].root;
      if (conquered) { c.conqueredAt = this.t; c.unrest = Math.min(1, c.unrest + 0.3); }
      this.setOwner(c.i, n);
    }

    initNations(count, capitals) {
      const w = this.w, W = w.W;
      let caps = [];
      if (capitals && capitals.length) {
        for (const [cx, cy] of capitals) {
          let best = null, bd = 1e9;
          for (const c of this.cities) {
            const d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
            if (d < bd && !caps.includes(c)) { bd = d; best = c; }
          }
          if (best && bd <= 9) { caps.push(best); continue; }
          // 近くに都市が無ければ新しく作る
          let li = -1, ld = 1e9;
          for (const i of w.landCells) {
            const d = (i % W - cx) ** 2 + (((i / W) | 0) - cy) ** 2;
            if (d < ld && this.cityAt[i] < 0) { ld = d; li = i; }
          }
          if (li < 0) continue;
          const c = {
            id: this.cities.length, x: li % W, y: (li / W) | 0, i: li,
            name: TW.Names.city(this.rand, w.usedNames), pop: 3, owner: -1, originRoot: null,
            defense: 0, unrest: 0, conqueredAt: -99999, besieged: -99, capital: false, dev: 1, built: 0,
          };
          this.cities.push(c); this.cityAt[li] = c.id;
          caps.push(c);
        }
      } else {
        const big = this.cities.filter(c => w.landmassSize[w.landmass[c.i]] >= 40);
        const pool = big.length >= count ? big : this.cities.slice();
        if (pool.length) caps.push(pool[Math.floor(this.rand() * pool.length)]);
        while (caps.length < Math.min(count, pool.length)) {
          const scored = [];
          for (const c of pool) {
            if (caps.includes(c)) continue;
            let md = 1e9;
            for (const k of caps) md = Math.min(md, (c.x - k.x) ** 2 + (c.y - k.y) ** 2);
            scored.push([md * (0.7 + this.rand() * 0.6), c]);
          }
          scored.sort((a, b) => b[0] - a[0]);
          caps.push(scored[Math.floor(this.rand() * Math.min(3, scored.length))][1]);
        }
      }
      for (const c of caps) {
        const n = this.createNation(c);
        if (!n) break;
        c.pop = Math.max(c.pop, 4.5);
        c.capital = true;
        this.giveCity(c, n.id, false);
        c.defense = this.maxDefense(c);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = c.x + dx, y = c.y + dy;
          if (x < 0 || y < 0 || x >= W || y >= w.H || dx * dx + dy * dy > 5) continue;
          const i = y * W + x;
          if (w.land[i] && this.owner[i] < 0 && this.cityAt[i] < 0) this.setOwner(i, n.id);
        }
      }
    }

    // ---------- メインループ ----------
    step() {
      this.t++;
      this.updateStats();
      this.economy();
      this.borderCreep();
      if (this.t % 4 === 0) this.armyAI();
      this.moveArmies();
      this.resolveBattles();
      this.sieges();
      if (this.t % 12 === 0) { this.cleanupPockets(); this.computeLabels(); }
      if (this.t % TPY === 0) this.yearly();
      if (this.t % (TPY / 2) === 0) this.snapshot();
    }

    updateStats() {
      for (const n of this.nations) {
        if (!n) continue;
        n.cityCount = 0; n.cityPop = 0; n.devSum = 0; n.armyStr = 0; n.armyCount = 0; n.wars = 0; n.allies = 0;
      }
      for (const c of this.cities) {
        if (c.owner >= 0) { const n = this.nations[c.owner]; n.cityCount++; n.cityPop += c.pop; n.devSum += c.dev; }
        if (c.besieged < this.t - 2) { const md = this.maxDefense(c); if (c.defense < md) c.defense = Math.min(md, c.defense + md * 0.012); }
      }
      for (const a of this.armies) { const n = this.nations[a.n]; n.armyStr += a.str; n.armyCount++; }
      for (const n of this.nations) if (n) n.wonders = [];
      this.wonderByCity = new Map();
      for (const w of this.wonders) {
        if (w.state !== 'built') continue;
        this.wonderByCity.set(w.city, w);
        const o = this.cities[w.city].owner;
        if (o >= 0 && this.nations[o]) this.nations[o].wonders.push(w.key);
      }
      for (const n of this.nations) if (n) n.seaFast = n.wonders.includes('lighthouse');
      for (const n of this.nations) {
        if (!n || !n.alive) continue;
        const row = n.id * MAXN;
        for (let j = 0; j < this.nations.length; j++) {
          const v = this.rel[row + j];
          if (v === 1) n.wars++; else if (v === 2) n.allies++;
        }
        n.strength = n.manpower + n.armyStr;
        if (n.cells > n.peakCells) n.peakCells = n.cells;
      }
    }

    economy() {
      for (const n of this.nations) {
        if (!n || !n.alive) continue;
        const wb = 1 + (n.wonders.includes('bazaar') ? 0.2 : 0) + (n.wonders.includes('lighthouse') ? 0.1 : 0);
        const inc = (n.value * 0.0035 + n.cityPop * 0.03 + n.devSum * 0.006) * (0.45 + 0.55 * n.stability) * (1 + n.era * 0.05) * wb;
        n.manpower += inc;
        const cap = 40 + n.value * 0.45 + n.cityPop * 4;
        if (n.manpower > cap) n.manpower -= (n.manpower - cap) * 0.1;
      }
    }

    borderCreep() {
      const w = this.w, W = w.W, H = w.H, land = w.land, terr = w.terrain, owner = this.owner;
      const cells = w.landCells, L = cells.length, r = this.rand;
      const samples = Math.floor(L * 0.14);
      for (let s = 0; s < samples; s++) {
        const i = cells[(r() * L) | 0];
        const o = owner[i];
        if (o < 0) continue;
        const x = i % W, y = (i / W) | 0;
        const d = (r() * 4) | 0;
        let j;
        if (d === 0) { if (x === 0) continue; j = i - 1; }
        else if (d === 1) { if (x === W - 1) continue; j = i + 1; }
        else if (d === 2) { if (y === 0) continue; j = i - W; }
        else { if (y === H - 1) continue; j = i + W; }
        const n = this.nations[o];
        if (!land[j]) {
          // 海を越えた入植
          if (r() < 0.02) {
            const dx = d === 0 ? -1 : d === 1 ? 1 : 0, dy = d === 2 ? -1 : d === 3 ? 1 : 0;
            let cx = x + dx, cy = y + dy;
            for (let k = 0; k < 9; k++) {
              cx += dx; cy += dy;
              if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
              const q = cy * W + cx;
              if (land[q]) {
                if (owner[q] < 0 && r() < 0.5 * TW.TERRAIN[terr[q]].ease) this.colonize(q, o);
                break;
              }
            }
          }
          continue;
        }
        const p = owner[j];
        if (p === o) continue;
        if (p < 0) {
          const ease = TW.TERRAIN[terr[j]].ease;
          if (r() < 0.75 * ease * n.expand * (0.5 + n.stability * 0.5)) this.colonize(j, o);
        } else if (this.rel[o * MAXN + p] === 0) {
          // 文化的同化: 文化の時代が2つ以上離れた隣国の国境がゆっくり塗り替わる
          const diff = n.era - this.nations[p].era;
          if (diff >= 2 && this.cityAt[j] < 0 && r() < 0.004 * diff) this.setOwner(j, o);
        } else if (this.rel[o * MAXN + p] === 1) {
          if (this.cityAt[j] >= 0) continue;
          const m = this.nations[p];
          const ratio = (n.strength + 1) / (n.strength + m.strength + 2);
          let pr = 0.05 * ratio * ratio * 1.6 / TW.TERRAIN[terr[j]].def;
          if (w.river[j] && !w.river[i]) pr *= 0.6;
          if (r() < pr) this.setOwner(j, o);
        }
      }
    }

    colonize(j, o) {
      const ci = this.cityAt[j];
      if (ci >= 0) {
        const c = this.cities[ci];
        if (c.owner >= 0) return;
        this.giveCity(c, o, false);
        c.defense = this.maxDefense(c);
      } else this.setOwner(j, o);
    }

    // ---------- 軍隊 ----------
    cellCost(i, j, n) {
      const w = this.w;
      let c;
      if (w.land[j]) {
        const rl = TW.roadLevel(this.road[j]);
        c = TW.TERRAIN[w.terrain[j]].move * ROAD_MULT[rl];
        const o = this.owner[j];
        if (o >= 0 && o !== n && this.rel[n * MAXN + o] !== 1 && this.rel[n * MAXN + o] !== 2) c += 40;
        if (w.river[j] && !w.river[i]) c += rl >= 2 ? 0.3 : 1.2; // 街道には橋が架かる
        if (!w.land[i]) c += 3; // 上陸
      } else {
        c = w.terrain[j] === T.SEA ? 2.4 : 3.4;
        if (n >= 0 && this.nations[n] && this.nations[n].seaFast) c *= 0.7;
        if (w.land[i]) c += 3; // 乗船
      }
      return c;
    }

    findPath(start, goal, n, maxExp = 16000) {
      if (start === goal) return [goal];
      const w = this.w, W = w.W, H = w.H;
      const gen = ++this.gen;
      const g = this.g, came = this.came, stamp = this.stamp, closed = this.closed;
      const gx = goal % W, gy = (goal / W) | 0;
      const heap = []; // [f, i]
      const push = (f, i) => {
        heap.push([f, i]);
        let k = heap.length - 1;
        while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
      };
      const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
          heap[0] = last; let k = 0;
          for (;;) {
            const l = 2 * k + 1, r = l + 1; let m = k;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === k) break;
            [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
          }
        }
        return top;
      };
      const hfun = i => { const dx = (i % W) - gx, dy = ((i / W) | 0) - gy; return Math.sqrt(dx * dx + dy * dy); };
      stamp[start] = gen; g[start] = 0; came[start] = -1;
      push(hfun(start), start);
      let exp = 0;
      while (heap.length) {
        const [, i] = pop();
        if (closed[i] === gen) continue;
        closed[i] = gen;
        if (i === goal) {
          const path = [];
          let c = goal;
          while (c !== start && c >= 0) { path.push(c); c = came[c]; }
          return path.reverse();
        }
        if (++exp > maxExp) return null;
        const x = i % W, y = (i / W) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx; if (nx < 0 || nx >= W) continue;
            const j = ny * W + nx;
            if (closed[j] === gen) continue;
            let c = this.cellCost(i, j, n);
            if (dx && dy) {
              // 斜め移動で海岸の角をすり抜けない
              if (w.land[y * W + nx] !== w.land[i] || w.land[ny * W + x] !== w.land[i]) continue;
              c *= 1.414;
            }
            const ng = g[i] + c;
            if (stamp[j] !== gen || ng < g[j]) {
              stamp[j] = gen; g[j] = ng; came[j] = i;
              push(ng + hfun(j), j);
            }
          }
        }
      }
      return null;
    }

    spawnArmy(n, city, str) {
      const a = {
        id: ++this.armySeq, n: n.id, i: city.i, x: city.x, y: city.y, px: city.x, py: city.y,
        path: null, pi: 0, prog: 0, str, maxStr: str, mode: 'idle', target: null,
        fighting: null, bStr: 0, lastPath: -99,
      };
      this.armies.push(a);
      return a;
    }

    targetCountMap() {
      const m = new Map();
      for (const a of this.armies) if (a.target) {
        const k = a.target.type + a.target.id;
        m.set(k, (m.get(k) || 0) + 1);
      }
      return m;
    }

    pickTarget(n, fx, fy, fromI, tcount) {
      const w = this.w;
      const lm = w.land[fromI] ? w.landmass[fromI] : -1;
      let best = null, bs = 0;
      for (const c of this.cities) {
        if (c.owner < 0 || this.rel[n.id * MAXN + c.owner] !== 1) continue;
        const d = Math.hypot(c.x - fx, c.y - fy);
        const same = lm >= 0 && w.landmass[c.i] === lm;
        let s = (1 + c.pop * 0.25 + (c.capital ? 1.5 : 0)) / (d + 6) * (same ? 1 : 0.3);
        s /= 1 + (tcount.get('city' + c.id) || 0) * 0.7;
        if (c.besieged >= this.t - 4) s *= 1.3;
        if (s > bs) { bs = s; best = { type: 'city', id: c.id }; }
      }
      // 自国領内の敵軍を迎撃
      for (const e of this.armies) {
        if (this.rel[n.id * MAXN + e.n] !== 1) continue;
        if (!w.land[e.i] || this.owner[e.i] !== n.id) continue;
        const d = Math.hypot(e.x - fx, e.y - fy);
        if (d > 30) continue;
        let s = 2.2 / (d + 4);
        s /= 1 + (tcount.get('army' + e.id) || 0) * 0.8;
        if (s > bs) { bs = s; best = { type: 'army', id: e.id }; }
      }
      return best;
    }

    targetCell(t) {
      if (!t) return -1;
      if (t.type === 'city') return this.cities[t.id].i;
      const e = this.armies.find(a => a.id === t.id);
      return e ? e.i : -1;
    }

    targetValid(a) {
      const t = a.target;
      if (!t) return false;
      if (t.type === 'city') { const c = this.cities[t.id]; return c.owner >= 0 && this.atWar(a.n, c.owner); }
      if (t.type === 'army') { const e = this.armies.find(x => x.id === t.id); return !!e && this.atWar(a.n, e.n); }
      if (t.type === 'home') { const c = this.cities[t.id]; return c.owner === a.n; }
      return false;
    }

    armyAI() {
      let budget = 9;
      const tcount = this.targetCountMap();
      const byNation = new Map();
      for (const a of this.armies) {
        if (!byNation.has(a.n)) byNation.set(a.n, []);
        byNation.get(a.n).push(a);
      }
      for (const n of this.nations) {
        if (!n || !n.alive) continue;
        const list = byNation.get(n.id) || [];
        // 新規編成
        if (n.wars > 0 && budget > 0) {
          const max = Math.min(10, 1 + Math.ceil(n.cityCount / 2));
          if (list.length < max && n.manpower >= 22) {
            const cap = this.cities[n.capital];
            const tgt = this.pickTarget(n, cap.x, cap.y, cap.i, tcount);
            if (tgt) {
              const tc = this.targetCell(tgt), tx = tc % this.w.W, ty = (tc / this.w.W) | 0;
              let sc = null, sd = 1e9;
              for (const c of this.cities) {
                if (c.owner !== n.id) continue;
                const d = Math.hypot(c.x - tx, c.y - ty) * (this.w.landmass[c.i] === this.w.landmass[tc] ? 1 : 2.5);
                if (d < sd) { sd = d; sc = c; }
              }
              if (sc) {
                const str = Math.max(15, n.manpower * 0.6);
                n.manpower -= str;
                const a = this.spawnArmy(n, sc, str);
                a.target = tgt; a.mode = tgt.type === 'army' ? 'chase' : 'attack';
                tcount.set(tgt.type + tgt.id, (tcount.get(tgt.type + tgt.id) || 0) + 1);
                a.path = this.findPath(a.i, tc, n.id); a.pi = 0; a.lastPath = this.t;
                budget--;
                if (!a.path) { a.target = null; a.mode = 'idle'; }
              }
            }
          }
        }
        for (const a of list) {
          if (a.mode === 'siege' && this.targetValid(a)) continue;
          const retreating = a.mode === 'home' && a.retreat && a.retreat > this.t;
          if (retreating) continue;
          let need = false;
          if (n.wars === 0) {
            if (a.mode !== 'home' || !this.targetValid(a)) need = true;
          } else if (!this.targetValid(a) || a.mode === 'home' || a.mode === 'idle') need = true;
          else if (a.mode === 'chase' && this.t - a.lastPath > 16) need = true;
          else if (!a.path) need = true;
          if (!need || budget <= 0) continue;
          budget--;
          if (n.wars > 0) {
            const tgt = this.pickTarget(n, a.x, a.y, a.i, tcount);
            if (tgt) {
              a.target = tgt; a.mode = tgt.type === 'army' ? 'chase' : 'attack';
              tcount.set(tgt.type + tgt.id, (tcount.get(tgt.type + tgt.id) || 0) + 1);
              a.path = this.findPath(a.i, this.targetCell(tgt), n.id); a.pi = 0; a.prog = 0; a.lastPath = this.t;
              if (a.path) continue;
            }
          }
          this.sendHome(a);
        }
      }
    }

    sendHome(a) {
      let best = null, bd = 1e9;
      const lm = this.w.land[a.i] ? this.w.landmass[a.i] : -1;
      for (const c of this.cities) {
        if (c.owner !== a.n) continue;
        const d = Math.hypot(c.x - a.x, c.y - a.y) * (this.w.landmass[c.i] === lm ? 1 : 2);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) { a.str = 0; return; }
      a.target = { type: 'home', id: best.id }; a.mode = 'home';
      a.path = this.findPath(a.i, best.i, a.n); a.pi = 0; a.prog = 0; a.lastPath = this.t;
      if (!a.path) { this.nations[a.n].manpower += a.str * 0.5; a.str = 0; }
    }

    moveArmies() {
      const w = this.w, W = w.W;
      for (const a of this.armies) {
        a.px = a.x; a.py = a.y;
        if (a.str <= 0) continue;
        if (a.fighting && !(a.mode === 'home' && a.retreat > this.t)) continue;
        if (a.mode === 'siege') continue;
        if (!a.path || a.pi >= a.path.length) {
          if (a.path) this.arrive(a);
          continue;
        }
        const next = a.path[a.pi];
        const cost = this.cellCost(a.i, next, a.n);
        a.prog += 0.5 / cost;
        if (a.prog >= 1) {
          a.prog = 0;
          a.i = next; a.x = next % W; a.y = (next / W) | 0; a.pi++;
          if (this.w.land[next]) {
            const before = TW.roadLevel(this.road[next]);
            this.road[next] = Math.min(80, this.road[next] + 1.6);
            if (TW.roadLevel(this.road[next]) !== before) this.roadDirty = true;
          }
          this.occupy(a);
          if (a.pi >= a.path.length) this.arrive(a);
        }
      }
      // 消滅した軍を除去
      if (this.armies.some(a => a.str <= 0)) this.armies = this.armies.filter(a => a.str > 0);
    }

    occupy(a) {
      const w = this.w, W = w.W, H = w.H, i = a.i;
      if (!w.land[i]) return;
      const tryCell = (j, p) => {
        const o = this.owner[j];
        if (o >= 0 && o !== a.n && this.rel[a.n * MAXN + o] === 1 && this.cityAt[j] < 0 && w.land[j] && this.rand() < p) this.setOwner(j, a.n);
      };
      tryCell(i, 1);
      const x = a.x, y = a.y;
      if (x > 0) tryCell(i - 1, 0.6);
      if (x < W - 1) tryCell(i + 1, 0.6);
      if (y > 0) tryCell(i - W, 0.6);
      if (y < H - 1) tryCell(i + W, 0.6);
    }

    arrive(a) {
      const t = a.target;
      a.path = null;
      if (!t) return;
      if (t.type === 'home') {
        const c = this.cities[t.id];
        if (c.owner === a.n && a.i === c.i) {
          const n = this.nations[a.n];
          if (n.wars === 0 || a.retreat) { n.manpower += a.str * 0.9; a.str = 0; }
          else { a.mode = 'idle'; a.target = null; a.retreat = 0; }
        }
        return;
      }
      if (t.type === 'city') {
        const c = this.cities[t.id];
        if (a.i === c.i && this.atWar(a.n, c.owner)) { a.mode = 'siege'; return; }
      }
      a.mode = 'idle'; a.target = null;
    }

    resolveBattles() {
      const A = this.armies;
      for (const a of A) { a.dmg = 0; a.foe = null; }
      for (let p = 0; p < A.length; p++) {
        const a = A[p];
        for (let q = p + 1; q < A.length; q++) {
          const b = A[q];
          if (this.rel[a.n * MAXN + b.n] !== 1) continue;
          const dx = a.x - b.x, dy = a.y - b.y;
          if (dx * dx + dy * dy > 2.6) continue;
          const da = this.defMod(a), db = this.defMod(b);
          b.dmg += a.str * 0.032 * (0.6 + this.rand() * 0.8) * this.quality(a.n) / db;
          a.dmg += b.str * 0.032 * (0.6 + this.rand() * 0.8) * this.quality(b.n) / da;
          if (!a.foe || a.foe.str < b.str) a.foe = b;
          if (!b.foe || b.foe.str < a.str) b.foe = a;
        }
      }
      for (const a of A) {
        if (a.foe) {
          if (!a.fighting) { a.bStr = a.str; a.bFoeStr = a.foe.str; a.bFoeN = a.foe.n; }
          a.fighting = a.foe.id;
          a.str -= a.dmg;
          // 劣勢なら撤退
          if (a.str > 2 && a.str < a.foe.str * 0.3 && a.mode !== 'home') { a.retreat = this.t + 30; this.sendHome(a); }
        } else if (a.fighting) {
          a.fighting = null;
          if (a.bStr + (a.bFoeStr || 0) > 350 && a.str > 2 && a.bStr > a.str) {
            // 勝利側が戦闘記録を残す
            const loser = this.nations[a.bFoeN];
            if (!(a.battleLogged >= this.t - 1)) this.recordBattle(a, loser, a.bFoeStr || 0, false);
          }
        }
      }
      for (const a of A) {
        if (a.str <= 2 && a.foe) {
          const win = a.foe;
          const wn = this.nations[win.n], ln = this.nations[a.n];
          wn.battlesWon++; ln.battlesLost++;
          this.warScore[win.n * MAXN + a.n] += a.bStr / 15;
          if (a.bStr + (a.bFoeStr || 0) > 220 && !(win.battleLogged >= this.t - 1)) { this.recordBattle(win, ln, a.bStr, true); win.battleLogged = this.t; }
          a.str = 0;
        } else if (a.str <= 2) a.str = 0;
      }
    }

    recordBattle(win, loserNation, loserStr, destroyed) {
      if (!loserNation) return;
      const wn = this.nations[win.n];
      const place = this.nearestCity(win.x, win.y);
      const total = (win.bStr || win.str) + loserStr;
      const text = destroyed
        ? `${place ? place.name + '近郊の戦い' : '海戦'}: ${wn.name}軍が${loserNation.name}軍(${TW.fmtTroops(loserStr)})を撃滅`
        : `${place ? place.name + '近郊の戦い' : '海戦'}: ${wn.name}軍が${loserNation.name}軍を退けた`;
      this.addLog('battle', text, { x: win.x, y: win.y }, total > 700, [wn, loserNation]);
      if (total > 2600 && place && this.rand() < 0.5) this.addPoem('battle', { place: place.name, winner: wn.name, loser: loserNation.name }, { x: win.x, y: win.y }, [wn, loserNation]);
      this.effect('victory', win.x, win.y, 2.5, { color: wn.css });
    }

    defMod(a) {
      const w = this.w;
      if (!w.land[a.i]) return 1;
      let d = 1;
      if (this.owner[a.i] === a.n) {
        d = TW.TERRAIN[w.terrain[a.i]].def;
        if (w.river[a.i]) d *= 1.15;
        const ci = this.cityAt[a.i];
        if (ci >= 0 && this.cities[ci].capital) d *= 1.3;
      } else d = 1 + (TW.TERRAIN[w.terrain[a.i]].def - 1) * 0.4;
      return d;
    }

    nearestCity(x, y, maxD = 25) {
      let best = null, bd = maxD * maxD;
      for (const c of this.cities) {
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    }

    sieges() {
      for (const a of this.armies) {
        if (a.mode !== 'siege' || a.str <= 0) continue;
        if (!this.targetValid(a)) { a.mode = 'idle'; a.target = null; continue; }
        if (a.fighting) continue;
        const c = this.cities[a.target.id];
        c.besieged = this.t;
        c.defense -= a.str * 0.025 * (0.5 + this.rand()) * this.quality(a.n);
        a.str -= 0.0035 * c.defense;
        if (c.defense <= 0) {
          this.captureCity(c, a.n);
          a.str *= 0.92;
          a.mode = 'idle'; a.target = null;
        }
      }
    }

    captureCity(c, n) {
      const w = this.w, W = w.W;
      const old = c.owner;
      const wasCapital = c.capital;
      const on = old >= 0 ? this.nations[old] : null;
      const nn = this.nations[n];
      this.giveCity(c, n, true);
      c.capital = false;
      nn.culture += c.dev * 3;
      c.dev *= 0.7; c.built = TW.buildingsOf(c.dev).length;
      c.defense = this.maxDefense(c) * 0.3;
      nn.citiesTaken++;
      // 周辺を併合
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 10) continue;
        const x = c.x + dx, y = c.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= w.H) continue;
        const i = y * W + x;
        if (w.land[i] && this.owner[i] === old && this.cityAt[i] < 0) this.setOwner(i, n);
      }
      this.effect('capture', c.x, c.y, 4, { color: nn.css });
      const wd = this.wonderAt(c.id);
      if (wd && on) {
        if (this.rand() < 0.12) this.ruinWonder(wd, `${nn.name}の略奪で`);
        else {
          this.addLog('wonder', `${nn.name}が${on.name}から世界の驚異「${wd.name}」を奪取!`, c, true, [nn, on]);
          this.addPoem('wonderTaken', { city: c.name, wonder: wd.name, winner: nn.name, loser: on.name }, c, [nn, on]);
        }
      }
      if (!on) return;
      this.warScore[n * MAXN + old] += 3 + c.pop;
      on.cityCount--;
      const remaining = this.cities.filter(x => x.owner === old);
      if (remaining.length === 0) {
        this.addLog('capture', `${nn.name}が${on.name}の最後の都市${c.name}を陥落させた`, c, true, [nn, on]);
        this.destroyNation(on, nn);
        return;
      }
      if (wasCapital) {
        remaining.sort((a, b) => b.pop - a.pop);
        const nc = remaining[0];
        nc.capital = true; on.capital = nc.id;
        on.stability = Math.max(0, on.stability - 0.3);
        on.capitalLostAt = this.t;
        on.manpower *= 0.7;
        on.culture *= 0.9;
        for (const x of remaining) x.unrest = Math.min(1, x.unrest + 0.25);
        this.addLog('capital', `${on.name}の首都${c.name}が${nn.name}により陥落! ${nc.name}へ遷都`, c, true, [nn, on]);
        if (on.peakCells > this.landCount * 0.12) this.addPoem('capital', { city: c.name, winner: nn.name, loser: on.name }, c, [nn, on]);
        this.effect('capital', c.x, c.y, 6, { color: nn.css });
      } else {
        this.addLog('capture', `${nn.name}が${on.name}の${c.name}を占領`, c, c.pop > 4, [nn, on]);
      }
    }

    destroyNation(n, by) {
      n.alive = false; n.deadAt = this.t;
      this.armies = this.armies.filter(a => a.n !== n.id);
      const W = this.w.W;
      for (let i = 0; i < this.owner.length; i++) {
        if (this.owner[i] === n.id) this.setOwner(i, by ? by.id : -1);
      }
      for (const c of this.cities) if (c.owner === n.id) { c.owner = by ? by.id : -1; c.capital = false; }
      for (let j = 0; j < MAXN; j++) { this.setRel(n.id, j, 0); this.truce[n.id * MAXN + j] = 0; this.truce[j * MAXN + n.id] = 0; }
      if (by) by.culture += n.culture * 0.2;
      const cap = this.cities[n.capital];
      if (n.peakCells > this.landCount * 0.1) {
        this.addPoem('destroy', { loser: n.name, winner: by ? by.name : '誰か', years: this.year() - Math.floor(n.founded / TPY) - 1 }, cap, by ? [n, by] : [n]);
      }
      this.addLog('destroy', `${n.name}滅亡 (建国から${this.year() - Math.floor(n.founded / TPY) - 1}年)` + (by ? ` — ${by.name}に併合された` : ''), cap, true, by ? [n, by] : [n]);
      this.effect('destroy', cap.x, cap.y, 7, { color: n.css });
    }

    // 2国の国境付近の地点(なければ相手の首都)
    frontierPoint(a, b) {
      const w = this.w, W = w.W, H = w.H, owner = this.owner;
      let sx = 0, sy = 0, n = 0;
      const pts = [];
      for (const i of w.landCells) {
        if (owner[i] !== a.id) continue;
        const x = i % W, y = (i / W) | 0;
        if ((x > 0 && owner[i - 1] === b.id) || (x < W - 1 && owner[i + 1] === b.id) || (y > 0 && owner[i - W] === b.id) || (y < H - 1 && owner[i + W] === b.id)) {
          sx += x; sy += y; n++; pts.push(i);
        }
      }
      if (!n) return this.cities[b.capital];
      const mx = sx / n, my = sy / n;
      let best = pts[0], bd = 1e18;
      for (const i of pts) { const d = (i % W - mx) ** 2 + (((i / W) | 0) - my) ** 2; if (d < bd) { bd = d; best = i; } }
      return { x: best % W, y: (best / W) | 0 };
    }

    // ---------- 発展と文化 ----------
    develop() {
      const r = this.rand;
      for (const c of this.cities) {
        const n = c.owner >= 0 ? this.nations[c.owner] : null;
        if (!n) { c.dev = Math.min(3, c.dev + 0.02 * r()); continue; }
        let g = 0.018 + c.pop * 0.004 + n.stability * 0.025 + (this.w.river[c.i] ? 0.015 : 0) + (this.w.landDist[c.i] === 1 ? 0.015 : 0);
        if (c.capital) g *= 1.5;
        if (n.wars) g *= 0.5;
        if (this.t - c.besieged < TPY) g *= 0.2;
        g *= 1 + n.era * 0.05;
        if (this.road[c.i] >= ROAD_LV[1]) g *= 1.25;          // 街道の交易
        if (n.wonders.includes('observatory')) g *= 1.3;
        c.dev = Math.min(10, c.dev + g * (0.6 + r() * 0.8));
        const nb = TW.buildingsOf(c.dev).length;
        if (nb > c.built) {
          const b = BUILDINGS[nb - 1];
          if (nb >= 4) this.addLog('develop', `${n.name}の${c.name}に${b.name}が完成`, c, nb >= 6, [n]);
          c.built = nb;
        }
      }
      this.updateStats();
      for (const n of this.aliveNations()) {
        let libs = 0, academies = 0;
        for (const c of this.cities) {
          if (c.owner !== n.id) continue;
          if (c.dev >= 6) academies++;
          if (c.dev >= 10) libs++;
        }
        const avg = n.cityCount ? n.devSum / n.cityCount : 0;
        const gain = (Math.sqrt(n.cityCount) * avg * 1.2 + academies * 2 + libs * 8 + (n.wonders.includes('library') ? 25 : 0)) * (n.wars ? 0.75 : 1);
        n.cultureGain = gain;
        n.culture = n.culture * 0.97 + gain;
        const era = TW.eraOf(n.culture);
        if (era > n.era) {
          n.era = era;
          n.maxEra = Math.max(n.maxEra || 0, era);
          if (era === ERAS.length - 1) this.addPoem('era', { nation: n.name, era: ERAS[era].name }, this.cities[n.capital], [n]);
          this.addLog('culture', `${n.name}が文化の${ERAS[era].name}を迎えた (兵の質 ×${this.quality(n.id).toFixed(2)})`, this.cities[n.capital], era >= 3, [n]);
          this.effect('bless', this.cities[n.capital].x, this.cities[n.capital].y, 5);
        } else if (era < n.era) {
          n.era = era;
          this.addLog('culture', `${n.name}の文化が衰退し${ERAS[era].name}に戻った`, this.cities[n.capital], false, [n]);
        }
      }
    }

    // ---------- 世界の驚異 ----------
    buildWonders() {
      const r = this.rand;
      for (const n of this.aliveNations()) {
        const pj = n.project;
        if (pj) {
          const w = this.wonders.find(x => x.key === pj.key);
          const c = this.cities[pj.city];
          if (c.owner !== n.id || (w.state === 'built')) {
            this.addLog('wonder', `${n.name}の「${w.name}」建設は${c.owner !== n.id ? '都市を失い' : '他国に先を越され'}中止された`, c, false, [n]);
            n.project = null;
            continue;
          }
          pj.progress += (2 + c.dev * 0.8 + n.era * 0.9) * (n.wars ? 0.5 : 1) * (0.7 + r() * 0.6);
          if (pj.progress >= pj.need) {
            w.state = 'built'; w.city = c.id; w.builtYear = this.year(); w.builder = n.name;
            this.wonderByCity.set(c.id, w);
            n.project = null;
            n.culture += 60;
            this.addLog('wonder', `${n.name}の${c.name}に世界の驚異「${w.name}」が完成!`, c, true, [n]);
            this.effect('bless', c.x, c.y, 7);
            this.addPoem('wonder', { city: c.name, wonder: w.name, nation: n.name }, c, [n]);
            for (const m of this.aliveNations()) {
              if (m !== n && m.project && m.project.key === w.key) {
                this.addLog('wonder', `${m.name}は「${w.name}」の建設で${n.name}に先を越された`, this.cities[m.project.city], false, [m, n]);
                m.project = null;
              }
            }
          }
          continue;
        }
        if (n.era < 3 || r() > 0.012 + n.era * 0.006) continue;
        // 最も発展した都市で着工
        const cities = this.cities.filter(c => c.owner === n.id && c.dev >= 5 && !this.wonders.some(w => w.city === c.id && w.state === 'built'))
          .sort((a, b) => b.dev - a.dev);
        if (!cities.length) continue;
        const city = cities[0];
        const coastal = this.w.landDist[city.i] === 1;
        const avail = this.wonders.filter(w => (w.state === 'none' || (w.state === 'ruin' && this.cities[w.city].owner === n.id)) && (!w.coastal || coastal || w.state === 'ruin'));
        if (!avail.length) continue;
        const w = avail[Math.floor(r() * avail.length)];
        const site = w.state === 'ruin' ? this.cities[w.city] : city;
        n.project = { key: w.key, city: site.id, progress: 0, need: w.state === 'ruin' ? 70 : 100 };
        this.addLog('wonder', `${n.name}が${site.name}で「${w.name}」の${w.state === 'ruin' ? '再建' : '建設'}を始めた`, site, false, [n]);
      }
    }

    ruinWonder(w, cause) {
      const c = this.cities[w.city];
      const o = c.owner >= 0 ? this.nations[c.owner] : null;
      w.state = 'ruin';
      if (this.wonderByCity) this.wonderByCity.delete(w.city);
      this.addLog('wonder', `${cause}世界の驚異「${w.name}」が崩れ落ち、遺跡となった`, c, true, o ? [o] : []);
      this.addPoem('ruin', { wonder: w.name, city: c.name }, c, o ? [o] : []);
      this.roadDirty = true;
    }

    // ---------- 道 ----------
    decayRoads() {
      const road = this.road;
      for (const i of this.w.landCells) {
        const v = road[i];
        if (v <= 0) continue;
        const nv = v * 0.965 - 0.03;
        const nr = nv > 0 ? nv : 0;
        if (TW.roadLevel(nr) !== TW.roadLevel(v)) this.roadDirty = true;
        road[i] = nr;
      }
    }

    // ---------- 歴史書用の記録 ----------
    addPoem(type, vars, pos, nations = []) {
      const p = TW.Poems && TW.Poems.make(type, vars);
      if (!p) return;
      const poem = { year: this.year(), type, title: p.title, lines: p.lines, x: pos ? pos.x : null, y: pos ? pos.y : null };
      this.poems.push(poem);
      if (this.poems.length > 300) this.poems.shift();
      const e = this.addLog('poem', `吟遊詩人の歌「${p.title}」`, pos, false, nations);
      e.poem = poem;
    }

    recordEra() {
      const alive = this.aliveNations().sort((a, b) => b.cells - a.cells);
      const top = alive[0];
      let wars = 0;
      for (const n of alive) wars += n.wars;
      this.eraSnaps.push({
        year: this.year(), alive: alive.length, wars: wars / 2,
        top: top ? { uid: top.uid, name: top.name, share: top.cells / this.landCount, css: top.css } : null,
        second: alive[1] ? { uid: alive[1].uid, name: alive[1].name, share: alive[1].cells / this.landCount } : null,
      });
    }

    // ---------- 外交 ----------
    declareWar(a, b, reason) {
      if (this.allied(a.id, b.id)) {
        this.addLog('betray', `${a.name}が同盟国${b.name}を裏切った!`, this.cities[a.capital], true, [a, b]);
      }
      this.setRel(a.id, b.id, 1);
      this.warStart[a.id * MAXN + b.id] = this.warStart[b.id * MAXN + a.id] = this.t;
      this.warScore[a.id * MAXN + b.id] = this.warScore[b.id * MAXN + a.id] = 0;
      this.setOp(a.id, b.id, this.op(a.id, b.id) - 30);
      if (reason !== 'rebel' && reason !== 'join') {
        this.addLog('war', `${a.name}が${b.name}に宣戦布告`, this.frontierPoint(a, b), a.cells + b.cells > this.landCount * 0.15, [a, b]);
      }
      if (reason === 'join') return;
      // 同盟国の参戦
      for (const c of this.aliveNations()) {
        if (c === a || c === b) continue;
        if (this.allied(c.id, b.id) && !this.allied(c.id, a.id) && !this.atWar(c.id, a.id) && !this.hasTruce(c.id, a.id) && this.rand() < 0.75) {
          this.declareWar(c, a, 'join');
          this.addLog('war', `${c.name}が同盟に従い${b.name}側で参戦`, this.cities[c.capital], false, [c, a, b]);
        } else if (this.allied(c.id, a.id) && !this.allied(c.id, b.id) && !this.atWar(c.id, b.id) && !this.hasTruce(c.id, b.id) && this.rand() < 0.45) {
          this.declareWar(c, b, 'join');
          this.addLog('war', `${c.name}が同盟国${a.name}と共に${b.name}へ参戦`, this.cities[c.capital], false, [c, a, b]);
        }
      }
    }

    makePeace(a, b) {
      this.setRel(a.id, b.id, 0);
      const until = this.t + Math.round(TPY * (6 + this.rand() * 10));
      this.truce[a.id * MAXN + b.id] = this.truce[b.id * MAXN + a.id] = until;
      this.setOp(a.id, b.id, this.op(a.id, b.id) * 0.5 - 10);
      const sa = this.warScore[a.id * MAXN + b.id], sb = this.warScore[b.id * MAXN + a.id];
      const yrs = Math.max(1, Math.round((this.t - this.warStart[a.id * MAXN + b.id]) / TPY));
      let text;
      if (Math.abs(sa - sb) < 4) text = `${a.name}と${b.name}が停戦 (${yrs}年の戦争は痛み分け)`;
      else if (sa > sb) text = `${b.name}が${a.name}に講和を請い停戦 (${yrs}年戦争)`;
      else text = `${a.name}が${b.name}に講和を請い停戦 (${yrs}年戦争)`;
      this.addLog('peace', text, this.cities[a.capital], a.cells + b.cells > this.landCount * 0.2, [a, b]);
    }

    computeBorders() {
      const w = this.w, W = w.W, H = w.H, owner = this.owner, land = w.land;
      this.border.fill(0);
      for (const n of this.nations) if (n) n.frontierFree = 0;
      for (const i of w.landCells) {
        const a = owner[i];
        const x = i % W, y = (i / W) | 0;
        const check = j => {
          if (!land[j]) return;
          const b = owner[j];
          if (a === b) return;
          if (a >= 0 && b >= 0) { this.border[a * MAXN + b]++; this.border[b * MAXN + a]++; }
          else if (a >= 0) this.nations[a].frontierFree++;
          else if (b >= 0) this.nations[b].frontierFree++;
        };
        if (x < W - 1) check(i + 1);
        if (y < H - 1) check(i + W);
      }
    }

    yearly() {
      const r = this.rand;
      this.computeBorders();
      this.updateStats();
      const alive = this.aliveNations();
      const L = this.landCount;
      // 関係変化
      for (let p = 0; p < alive.length; p++) {
        const a = alive[p];
        for (let q = p + 1; q < alive.length; q++) {
          const b = alive[q];
          const k = a.id * MAXN + b.id;
          const bc = this.border[k];
          let d = 0;
          if (bc > 0) d -= 2 + Math.min(8, bc / 15);
          const rel = this.rel[k];
          if (rel === 2) d += 4;
          if (rel === 1) d -= 6;
          for (const c of alive) {
            if (c !== a && c !== b && this.atWar(a.id, c.id) && this.atWar(b.id, c.id)) { d += 6; break; }
          }
          d += (r() - 0.5) * 9;
          const nv = this.op(a.id, b.id) * 0.94 + d;
          this.setOp(a.id, b.id, nv);
          if (rel === 2 && nv < -20) {
            this.setRel(a.id, b.id, 0);
            this.addLog('alliance', `${a.name}と${b.name}の同盟が破棄された`, this.cities[a.capital], false, [a, b]);
          } else if (rel === 1) {
            const yrs = (this.t - this.warStart[k]) / TPY;
            const sa = this.warScore[k], sb = this.warScore[b.id * MAXN + a.id];
            let pp = 0.04 + yrs * 0.03 + Math.abs(sa - sb) * 0.004;
            const ratio = Math.min(a.strength, b.strength) / Math.max(1, Math.max(a.strength, b.strength));
            if (ratio < 0.15) pp += 0.15;
            if (yrs < 1) pp *= 0.3;
            if (r() < pp) this.makePeace(a, b);
          } else if (rel === 0 && !this.hasTruce(a.id, b.id) && nv > 35 && a.allies < 2 && b.allies < 2 && r() < 0.12) {
            this.setRel(a.id, b.id, 2);
            a.allies++; b.allies++;
            this.addLog('alliance', `${a.name}と${b.name}が同盟を締結`, this.cities[a.capital], false, [a, b]);
          }
        }
      }
      this.updateStats();
      // 宣戦布告
      const capsOf = n => this.cities[n.capital];
      for (const a of alive) {
        if (!a.alive || a.wars >= 2 || this.t - a.founded < TPY * 2) continue;
        const ca = capsOf(a);
        for (const b of alive) {
          if (b === a || !b.alive) continue;
          const k = a.id * MAXN + b.id;
          const bc = this.border[k];
          let near = bc > 0;
          if (!near) {
            const cb = capsOf(b);
            if (Math.hypot(ca.x - cb.x, ca.y - cb.y) < 34 && r() < 0.3) near = true;
          }
          if (!near) continue;
          if (this.rel[k] === 1) continue;
          if (this.rel[k] === 2) {
            if (a.aggression > 0.75 && bc > 0 && a.strength > b.strength * 1.6 && r() < 0.012) { this.declareWar(a, b); break; }
            continue;
          }
          if (this.hasTruce(a.id, b.id)) continue;
          const ratio = TW.clamp((a.strength + 1) / (b.strength + 1), 0.2, 3);
          const hunger = a.frontierFree < 6 ? 1.5 : 0.55;
          const desire = a.aggression * ratio * (1 - this.op(a.id, b.id) / 100) * 0.5 * hunger * (bc > 0 ? 1 : 0.4);
          if (r() < desire * 0.12) { this.declareWar(a, b); break; }
        }
      }
      this.updateStats();
      // 安定度
      for (const n of alive) {
        if (!n.alive) continue;
        const share = n.cells / L;
        let target = 0.88 - share * 0.75 - n.wars * 0.06 - (this.t - n.capitalLostAt < TPY * 5 ? 0.2 : 0);
        if (n.wars === 0) target += 0.05;
        target += n.era * 0.015;
        if (n.wonders.includes('temple')) target += 0.08;
        n.stability = TW.clamp(n.stability + (target - n.stability) * 0.25 + (r() - 0.5) * 0.04, 0.05, 1);
      }
      // 反乱・独立
      this.rebellions();
      this.develop();
      this.buildWonders();
      this.decayRoads();
      if (this.year() % 5 === 0) this.recordEra();
      // 都市の成長
      for (const c of this.cities) {
        const n = c.owner >= 0 ? this.nations[c.owner] : null;
        const g = n ? (0.012 + r() * 0.02) * (n.wars ? 0.5 : 1) * (n.wonders.includes('garden') ? 1.5 : 1) : 0.006 * r();
        c.pop = Math.min(14, c.pop * (1 + g));
        c.unrest *= 0.82;
      }
    }

    rebellions() {
      const alive = this.aliveNations();
      const A = alive.length;
      const L = this.landCount, W = this.w.W, H = this.w.H;
      const diag = (W + H) / 2;
      for (const n of alive) {
        if (!n.alive || n.cityCount < 2) continue;
        if (A >= MAX_ALIVE) break;
        const share = n.cells / L;
        const cap = this.cities[n.capital];
        let best = null;
        for (const c of this.cities) {
          if (c.owner !== n.id || c.capital) continue;
          const dc = Math.hypot(c.x - cap.x, c.y - cap.y) / diag;
          let u = 0.002 + dc * 0.03 + share * 0.06 + Math.max(0, share - 0.3) * 0.9;
          if (this.t - c.conqueredAt < TPY * 15 && c.originRoot && c.originRoot !== n.root) u += 0.035;
          u += n.wars * 0.006 + (1 - n.stability) * 0.05 + c.unrest * 0.08;
          if (c.dev >= 8) u *= 0.5;
          if (n.wonders.includes('temple')) u *= 0.6;
          if (A <= 2) u += 0.06;
          if (A <= 1) u += 0.15;
          const crowd = A / this.initialCount;
          if (crowd > 1.4) u *= 0.35;
          if (crowd > 2.2) u *= 0.3;
          if (this.rand() < u * 0.5) { best = c; break; }
        }
        if (best) this.rebel(best, false);
      }
    }

    rebel(city, forced) {
      const parent = this.nations[city.owner];
      if (!parent || !parent.alive || parent.cityCount < 2 || city.capital) return null;
      const group = [city];
      for (const c of this.cities) {
        if (group.length >= 4) break;
        if (c.owner !== parent.id || c.capital || c === city) continue;
        if (Math.hypot(c.x - city.x, c.y - city.y) < 15 && this.rand() < 0.35) group.push(c);
      }
      // 親国の領土を都市ごとのボロノイ領域に分割
      const w = this.w, W = w.W, owner = this.owner, label = this.label, q = this.queue;
      const gen = ++this.markGen, mark = this.mark;
      let qh = 0, qt = 0;
      for (const c of this.cities) {
        if (c.owner !== parent.id) continue;
        mark[c.i] = gen; label[c.i] = c.id; q[qt++] = c.i;
      }
      while (qh < qt) {
        const i = q[qh++], x = i % W, y = (i / W) | 0;
        const L = label[i];
        if (x > 0) { const j = i - 1; if (mark[j] !== gen && owner[j] === parent.id) { mark[j] = gen; label[j] = L; q[qt++] = j; } }
        if (x < W - 1) { const j = i + 1; if (mark[j] !== gen && owner[j] === parent.id) { mark[j] = gen; label[j] = L; q[qt++] = j; } }
        if (y > 0) { const j = i - W; if (mark[j] !== gen && owner[j] === parent.id) { mark[j] = gen; label[j] = L; q[qt++] = j; } }
        if (y < w.H - 1) { const j = i + W; if (mark[j] !== gen && owner[j] === parent.id) { mark[j] = gen; label[j] = L; q[qt++] = j; } }
      }
      group.sort((a, b) => b.pop - a.pop);
      const capCity = group[0];
      let root = null;
      if (capCity.originRoot && capCity.originRoot !== parent.root && this.rand() < 0.7) root = capCity.originRoot;
      const n = this.createNation(capCity, {
        root, gov: TW.Names.rebelGov(this.rand), avoid: [parent.color],
        manpower: 30 + parent.manpower * 0.2 * group.length, parentName: parent.name, culture: parent.culture * 0.5,
      });
      if (!n) return null;
      parent.manpower *= 0.8;
      const gids = new Set(group.map(c => c.id));
      for (let k = 0; k < qt; k++) { const i = q[k]; if (gids.has(label[i])) this.setOwner(i, n.id); }
      for (const c of group) { c.owner = n.id; c.capital = false; c.unrest = 0; if (!c.originRoot) c.originRoot = n.root; }
      capCity.capital = true; n.capital = capCity.id;
      for (const a of this.armies) {
        if (a.n === parent.id && owner[a.i] === n.id && this.rand() < 0.5) { a.n = n.id; a.target = null; a.mode = 'idle'; a.path = null; }
      }
      this.spawnArmy(n, capCity, 20 + parent.armyStr * 0.08);
      this.declareWar(n, parent, 'rebel');
      const names = group.map(c => c.name).join('・');
      const revival = root && root === capCity.originRoot;
      const text = forced
        ? `扇動により${names}で反乱! ${n.name}が${parent.name}から独立を宣言`
        : revival ? `${names}で旧${root}の民が蜂起、${n.name}として${parent.name}から独立`
          : `${names}で反乱! ${n.name}が${parent.name}から独立を宣言`;
      this.addLog('rebel', text, capCity, true, [n, parent]);
      if (group.length >= 4 || forced) this.addPoem('rebel', { city: capCity.name, nation: n.name, parent: parent.name }, capCity, [n, parent]);
      this.effect('rebel', capCity.x, capCity.y, 6, { color: n.css });
      this.updateStats();
      return n;
    }

    // ---------- 補給線(飛び地処理) ----------
    cleanupPockets() {
      const w = this.w, W = w.W, H = w.H, owner = this.owner, land = w.land;
      const gen = ++this.markGen, mark = this.mark, q = this.queue;
      let qh = 0, qt = 0;
      const seed = i => { if (mark[i] !== gen) { mark[i] = gen; q[qt++] = i; } };
      for (const c of this.cities) if (c.owner >= 0 && owner[c.i] === c.owner) seed(c.i);
      for (const a of this.armies) if (land[a.i] && owner[a.i] === a.n) seed(a.i);
      while (qh < qt) {
        const i = q[qh++], o = owner[i], x = i % W, y = (i / W) | 0;
        if (x > 0 && owner[i - 1] === o) seed(i - 1);
        if (x < W - 1 && owner[i + 1] === o) seed(i + 1);
        if (y > 0 && owner[i - W] === o) seed(i - W);
        if (y < H - 1 && owner[i + W] === o) seed(i + W);
      }
      // 孤立した領土は周囲の国へ
      const comp = [];
      for (const s of w.landCells) {
        if (owner[s] < 0 || mark[s] === gen) continue;
        const o = owner[s];
        comp.length = 0;
        const counts = new Map();
        let h = qt;
        mark[s] = gen; q[qt++] = s;
        while (h < qt) {
          const i = q[h++]; comp.push(i);
          const x = i % W, y = (i / W) | 0;
          const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
          for (const j of nb) {
            if (j < 0 || !land[j]) continue;
            const p = owner[j];
            if (p === o) { if (mark[j] !== gen) { mark[j] = gen; q[qt++] = j; } }
            else if (p >= 0) counts.set(p, (counts.get(p) || 0) + 1);
          }
        }
        let best = -1, bc = 0;
        for (const [p, c] of counts) if (c > bc) { bc = c; best = p; }
        for (const i of comp) this.setOwner(i, best);
      }
    }

    computeLabels() {
      const W = this.w.W, owner = this.owner;
      const M = this.nations.length;
      const sx = new Float64Array(M), sy = new Float64Array(M), cnt = new Int32Array(M);
      const sxx = new Float64Array(M), syy = new Float64Array(M), sxy = new Float64Array(M);
      for (const i of this.w.landCells) {
        const o = owner[i]; if (o < 0) continue;
        const x = i % W, y = (i / W) | 0;
        sx[o] += x; sy[o] += y; cnt[o]++;
      }
      const bestD = new Float64Array(M).fill(1e18), bestI = new Int32Array(M).fill(-1);
      for (const i of this.w.landCells) {
        const o = owner[i]; if (o < 0) continue;
        const x = i % W, y = (i / W) | 0;
        const mx = sx[o] / cnt[o], my = sy[o] / cnt[o];
        const d = (x - mx) ** 2 + (y - my) ** 2;
        if (d < bestD[o]) { bestD[o] = d; bestI[o] = i; }
      }
      // 中心付近の主成分方向
      for (const i of this.w.landCells) {
        const o = owner[i]; if (o < 0 || bestI[o] < 0) continue;
        const cx = bestI[o] % W, cy = (bestI[o] / W) | 0;
        const dx = (i % W) - cx, dy = ((i / W) | 0) - cy;
        const r2 = dx * dx + dy * dy;
        if (r2 > cnt[o] * 0.5) continue;
        sxx[o] += dx * dx; syy[o] += dy * dy; sxy[o] += dx * dy;
      }
      const labels = [];
      for (let o = 0; o < M; o++) {
        const n = this.nations[o];
        if (!n || !n.alive || cnt[o] < 6 || bestI[o] < 0) continue;
        let ang = 0.5 * Math.atan2(2 * sxy[o], sxx[o] - syy[o]);
        ang = TW.clamp(ang, -0.45, 0.45);
        const ev = Math.sqrt(Math.max(1, (sxx[o] + syy[o])));
        labels.push({ n: o, uid: n.uid, x: bestI[o] % W + 0.5, y: ((bestI[o] / W) | 0) + 0.5, cells: cnt[o], ang, spread: ev });
      }
      this.labels = labels;
    }

    snapshot() {
      const data = [];
      for (const n of this.nations) if (n && n.alive && n.cells > 0) data.push({ uid: n.uid, cells: n.cells, css: n.css, name: n.name });
      this.history.push({ t: this.t, year: this.year(), data });
      if (this.history.length > 800) this.history.splice(0, this.history.length - 700);
    }

    // ---------- 神の介入 ----------
    godPlague(cx, cy, R = 10) {
      const hit = new Set();
      for (const c of this.cities) {
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (d > R) continue;
        c.pop *= 0.5; c.defense *= 0.5; c.dev *= 0.85; c.unrest = Math.min(1, c.unrest + 0.3);
        if (c.owner >= 0) hit.add(c.owner);
      }
      for (const a of this.armies) if (Math.hypot(a.x - cx, a.y - cy) <= R) a.str *= 0.4;
      for (const id of hit) { const n = this.nations[id]; n.manpower *= 0.7; n.stability = Math.max(0.05, n.stability - 0.15); }
      const place = this.nearestCity(cx, cy, R + 5);
      this.addLog('god', `疫病が${place ? place.name + '地方' : '大地'}を襲った`, { x: cx, y: cy }, true, [...hit].map(i => this.nations[i]));
      this.effect('plague', cx, cy, R);
    }
    godDisaster(cx, cy, R = 7) {
      const w = this.w, W = w.W;
      const hit = new Set();
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
        if (x < 0 || y < 0 || x >= W || y >= w.H) continue;
        const i = y * W + x;
        if (!w.land[i] || this.cityAt[i] >= 0) continue;
        if (this.owner[i] >= 0) hit.add(this.owner[i]);
        if (this.rand() < 0.85) this.setOwner(i, -1);
      }
      for (const c of this.cities) {
        if (Math.hypot(c.x - cx, c.y - cy) > R) continue;
        c.pop *= 0.45; c.defense = 0; c.dev *= 0.5; c.built = TW.buildingsOf(c.dev).length;
        const wd = this.wonderAt(c.id);
        if (wd && this.rand() < 0.6) this.ruinWonder(wd, '大地震で');
      }
      for (const a of this.armies) if (Math.hypot(a.x - cx, a.y - cy) <= R) a.str *= 0.5;
      for (const id of hit) this.nations[id].stability = Math.max(0.05, this.nations[id].stability - 0.1);
      const place = this.nearestCity(cx, cy, R + 5);
      this.addLog('god', `大地震が${place ? place.name + '一帯' : '大地'}を襲い、土地が荒廃した`, { x: cx, y: cy }, true, [...hit].map(i => this.nations[i]));
      this.effect('disaster', cx, cy, R);
    }
    godBless(nId) {
      const n = this.nations[nId];
      if (!n || !n.alive) return false;
      n.manpower += 80 + n.value * 0.25;
      n.stability = Math.min(1, n.stability + 0.3);
      for (const c of this.cities) if (c.owner === nId) { c.defense = this.maxDefense(c); c.pop *= 1.1; c.unrest = 0; c.dev = Math.min(10, c.dev + 0.8); }
      const cap = this.cities[n.capital];
      this.addLog('god', `${n.name}に天の恵みが降り注いだ`, cap, true, [n]);
      this.effect('bless', cap.x, cap.y, 8);
      return true;
    }
    godIncite(cx, cy) {
      let best = null, bd = 1e9;
      for (const c of this.cities) {
        if (c.owner < 0 || c.capital) continue;
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best || bd > 12) return '近くに反乱を起こせる都市がありません(首都は不可)';
      if (this.aliveNations().length >= MAX_ALIVE) return '国の数が上限です';
      const n = this.rebel(best, true);
      return n ? null : 'この都市では反乱を起こせません';
    }
  }

  TW.Sim = Sim;
})();
