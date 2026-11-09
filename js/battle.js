'use strict';
// 本格的な会戦: 布陣 → 射撃戦 → 白兵戦 → 決着(潰走・追撃)
// 兵種と相性・特色兵・ファンタジー兵種・援軍・奇襲・海戦・戦記
(function () {
  const T = TW.T, MAXN = TW.MAXN, TPY = TW.TPY;
  const P = TW.Sim.prototype;

  const UNITS = TW.UNITS = {
    inf: { name: '歩兵', missile: 0, melee: 1.0 },
    cav: { name: '騎兵', missile: 0, melee: 1.2, charge: 1.9 },
    arc: { name: '弓兵', missile: 1.0, melee: 0.45 },
    sie: { name: '攻城兵器', missile: 0.55, melee: 0.15 },
    spc: { name: '特色兵' },
    mag: { name: '魔導兵', missile: 1.7, melee: 0.6 },
    drg: { name: '竜騎士', missile: 0.3, melee: 1.9, charge: 2.1 },
  };
  const UKEYS = TW.UKEYS = ['inf', 'cav', 'arc', 'sie', 'spc', 'mag', 'drg'];
  const SPECIALS = TW.SPECIALS = {
    camel: { name: '駱駝騎兵', base: 'cav', desc: '砂漠でも疲れずに突撃する' },
    longbow: { name: '長弓兵', base: 'arc', desc: '遠くから雨のように矢を降らせる' },
    heavy: { name: '重装歩兵', base: 'inf', desc: '分厚い鎧で敵の突撃にも崩れない' },
    wolf: { name: '狼騎兵', base: 'cav', desc: '雪原や森でも速さが落ちない' },
    marine: { name: '海兵', base: 'inf', desc: '海戦と上陸戦に強い' },
    knight: { name: '重騎兵', base: 'cav', desc: '平原での突撃は無敵' },
  };
  // 地形ごとの騎兵の強さ (外洋, 近海, 平原, 森林, 丘陵, 山岳, 砂漠, ツンドラ, 氷雪)
  const CAV_TERRAIN = [1, 1, 1.2, 0.7, 0.8, 0.55, 1.15, 0.95, 0.6];
  const PHASE = TW.BATTLE_PHASES = { deploy: '布陣', missile: '射撃戦', melee: '白兵戦', rout: '追撃' };
  const THREAT_COMP = {
    demon: { inf: 0.55, cav: 0.2, arc: 0.15, mag: 0.1 },
    undead: { inf: 0.75, arc: 0.25 },
    dragon: { drg: 1 },
    frost: { inf: 0.45, cav: 0.55 },
    deep: { inf: 0.6, arc: 0.25, mag: 0.15 },
    cult: { inf: 0.65, arc: 0.1, mag: 0.25 },
  };

  // 特色兵の元になる兵種 (特色兵を持たない国の特色兵枠は歩兵として扱う)
  const spBase = n => (n && n.special && SPECIALS[n.special] ? SPECIALS[n.special].base : 'inf');
  TW.spBase = spBase;
  function norm(c) {
    let s = 0;
    for (const k of UKEYS) { c[k] = Math.max(0, c[k] || 0); s += c[k]; }
    for (const k of UKEYS) c[k] = s > 0 ? c[k] / s : (k === 'inf' ? 1 : 0);
    return c;
  }
  TW.normComp = norm;

  // ---------- 国の軍制と特色兵 ----------
  const origCreate = P.createNation;
  P.createNation = function (city, opts = {}) {
    const n = origCreate.call(this, city, opts);
    if (!n || opts.isThreat) return n;
    const r = this.rand;
    n.doctrine = norm({ inf: 0.4 + r() * 0.2, cav: 0.1 + r() * 0.2, arc: 0.15 + r() * 0.15, sie: 0.05 + r() * 0.08 });
    // 首都周辺の地形で特色兵が決まる
    const w = this.w, W = w.W, cnt = new Array(9).fill(0);
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const x = city.x + dx, y = city.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= w.H) continue;
      cnt[w.terrain[y * W + x]]++;
    }
    const coastal = w.landDist[city.i] <= 2 || !w.land[city.i];
    let sp;
    if (cnt[T.DESERT] > 18) sp = 'camel';
    else if (cnt[T.SNOW] + cnt[T.TUNDRA] > 25) sp = 'wolf';
    else if (cnt[T.MOUNTAIN] + cnt[T.HILLS] > 30) sp = 'heavy';
    else if (cnt[T.FOREST] > 35) sp = 'longbow';
    else if (coastal && r() < 0.6) sp = 'marine';
    else sp = r() < 0.5 ? 'knight' : ['heavy', 'longbow', 'marine'][Math.floor(r() * 3)];
    n.special = sp;
    return n;
  };

  P.makeComp = function (n) {
    if (n.isThreat) return norm({ ...(THREAT_COMP[n.threat] || { inf: 1 }) });
    const d = n.doctrine || { inf: 0.5, cav: 0.2, arc: 0.2, sie: 0.1 };
    const c = { inf: d.inf, cav: d.cav, arc: d.arc, sie: d.sie, spc: 0, mag: 0, drg: 0 };
    if (n.special) {
      const b = SPECIALS[n.special].base;
      const take = Math.min(c[b] * 0.5, 0.15);
      c[b] -= take; c.spc = take;
    }
    if (n.era >= 6) { c.mag = 0.08; c.inf = Math.max(0.05, c.inf - 0.08); }
    if (n.era >= 7) { c.drg = 0.06; c.cav = Math.max(0.02, c.cav - 0.06); }
    return norm(c);
  };
  P.mixComp = function (big, small) {
    const a = big.comp || this.makeComp(this.nations[big.n]), b = small.comp || a;
    const s = big.str + small.str || 1;
    const c = {};
    for (const k of UKEYS) c[k] = ((a[k] || 0) * big.str + (b[k] || 0) * small.str) / s;
    big.comp = norm(c);
  };
  const origSpawn = P.spawnArmy;
  P.spawnArmy = function (n, city, str) {
    const a = origSpawn.call(this, n, city, str);
    a.comp = this.makeComp(n);
    return a;
  };

  P.battleById = function (id) { return (this.battles || []).find(b => b.id === id) || null; };

  // ---------- 会戦の開始と参加 ----------
  P.battleSide = function (a, b) {
    const l0 = this.nations[b.sides[0].lead], l1 = this.nations[b.sides[1].lead];
    const ok0 = l0 && l0.uid === b.sides[0].luid, ok1 = l1 && l1.uid === b.sides[1].luid;
    const w0 = ok0 && (a.n === l0.id ? false : this.atWar(a.n, l0.id));
    const w1 = ok1 && (a.n === l1.id ? false : this.atWar(a.n, l1.id));
    if (ok0 && (a.n === l0.id || (!w0 && w1 && this.allied(a.n, l0.id)) || (w1 && !w0))) return 0;
    if (ok1 && (a.n === l1.id || (!w1 && w0 && this.allied(a.n, l1.id)) || (w0 && !w1))) return 1;
    // 両方と戦争中なら、強い方を相手に弱い方へ加わる
    if (w0 && w1) return this.sideStr(b.sides[0]) >= this.sideStr(b.sides[1]) ? 1 : 0;
    return -1;
  };

  function mkSide(sim, a) {
    const n = sim.nations[a.n];
    return { lead: a.n, luid: n.uid, armies: [], str0: 0, morale: 100, losses: 0, dmgType: {}, nations: new Map(), gens: [], late: 0, lateSwing: false };
  }

  P.addBattleLog = function (b, text) {
    b.log.push({ t: this.t, year: this.year(), month: this.month(), text });
    if (b.log.length > 30) b.log.splice(1, 1);
  };

  P.joinBattle = function (a, b, si, late) {
    const s = b.sides[si];
    a.battle = b.id; a.battleSide = si;
    const vp = this.visualPos(a);
    a.joinX = vp[0]; a.joinY = vp[1]; a.joinT = this.t;
    if (s.cx0 == null) { s.cx0 = vp[0]; s.cy0 = vp[1]; }
    a.bStr = a.str;
    if (!a.comp) a.comp = this.makeComp(this.nations[a.n]);
    s.armies.push(a);
    s.str0 += a.str;
    const n = this.nations[a.n];
    s.nations.set(n.uid, { name: n.name, css: n.css });
    if (a.gen && !s.gens.includes(a.gen)) s.gens.push(a.gen);
    if (late && b.phase !== 'deploy') {
      const o = b.sides[1 - si];
      if (s.morale < o.morale) s.lateSwing = true;
      s.morale = Math.min(110, s.morale + 12);
      s.late += a.str;
      this.addBattleLog(b, `援軍到着: ${n.name}軍${a.gen ? '(' + this.genName(a.gen) + ')' : ''} ${TW.fmtTroops(a.str)}が${si === 0 ? '左' : '右'}翼に加わった`);
      if (b.sides[0].str0 + b.sides[1].str0 > 400) this.addLog('reinforce', `${b.name}に${n.name}の援軍${TW.fmtTroops(a.str)}が到着`, b, false, [n]);
    }
  };

  P.startBattle = function (a, e) {
    const w = this.w, W = w.W;
    const x = Math.round((a.x + e.x) / 2), y = Math.round((a.y + e.y) / 2);
    const i = y * W + x;
    const naval = !w.land[a.i] && !w.land[e.i];
    const place = this.nearestCity(x, y, 30);
    const b = {
      id: ++this.battleSeq, x, y, i, naval, start: this.t, phase: 'deploy', phaseT: this.t,
      sides: [mkSide(this, a), mkSide(this, e)], log: [], ambush: -1, angle: Math.atan2(e.y - a.y, e.x - a.x) || 0,
      name: naval ? `${place ? place.name + '沖' : '外洋'}の海戦` : `${place ? place.name + '近郊' : '荒野'}の戦い`,
      chargeT: -1, defender: -1,
    };
    this.battles.push(b);
    this.joinBattle(a, b, 0, false);
    this.joinBattle(e, b, 1, false);
    const o = this.owner[i];
    if (!naval && o >= 0) { if (o === a.n) b.defender = 0; else if (o === e.n) b.defender = 1; }
    this.addBattleLog(b, `${b.naval ? '両艦隊が会敵' : '両軍が布陣'}: ${this.nations[a.n].name} ${TW.fmtTroops(a.str)} 対 ${this.nations[e.n].name} ${TW.fmtTroops(e.str)}`);
    // 待ち伏せ・奇襲: 森や丘で待ち構えた側が先手を取る
    if (!naval) {
      const amb = (army, other) => {
        const t = w.terrain[army.i];
        if (this.owner[army.i] !== army.n) return false;
        if (t !== T.FOREST && t !== T.HILLS && t !== T.MOUNTAIN) return false;
        const still = !army.path || army.mode === 'idle' || army.mode === 'siege';
        return (still ? 0.5 : 0.22) > this.rand() && !!other.path;
      };
      let s = -1;
      if (amb(e, a)) s = 1; else if (amb(a, e)) s = 0;
      if (s >= 0) {
        b.ambush = s;
        const v = b.sides[1 - s];
        v.morale -= 25;
        for (const va of v.armies) { const d = va.str * 0.08; va.str -= d; v.losses += d; }
        const an = this.nations[b.sides[s].lead];
        this.addBattleLog(b, `伏兵の奇襲! ${an.name}軍が${TW.TERRAIN[w.terrain[(s ? e : a).i]].name}から襲いかかった`);
        if (a.str + e.str > 200) this.addLog('ambush', `${b.name}: ${an.name}軍が伏兵で奇襲!`, b, false, [an, this.nations[b.sides[1 - s].lead]]);
      }
    }
    if (a.str + e.str > 500) this.addLog('battlestart', `${b.name}が始まった — ${this.nations[a.n].name} ${TW.fmtTroops(a.str)} 対 ${this.nations[e.n].name} ${TW.fmtTroops(e.str)}`, b, false, [this.nations[a.n], this.nations[e.n]]);
    return b;
  };

  P.sideStr = function (s) { let t = 0; for (const a of s.armies) t += a.str; return t; };
  P.sideComp = function (s) {
    const c = {}; let tot = 0;
    for (const k of UKEYS) c[k] = 0;
    for (const a of s.armies) { tot += a.str; for (const k of UKEYS) c[k] += (a.comp[k] || 0) * a.str; }
    for (const k of UKEYS) c[k] = tot ? c[k] / tot : 0;
    return c;
  };

  // 一方の側が与える損害
  P.battleDamage = function (b, si, mode) {
    const att = b.sides[si], def = b.sides[1 - si];
    const dc = this.sideComp(def);
    const ter = this.w.terrain[b.i];
    let total = 0;
    const by = {};
    for (const a of att.armies) {
      const n = this.nations[a.n];
      const q = a.str * this.quality(a.n) * this.genSkill(a.gen);
      for (const k of UKEYS) {
        const f = a.comp[k];
        if (!f) continue;
        const spc = k === 'spc' && n.special ? SPECIALS[n.special] : null;
        const bt = k === 'spc' ? spBase(n) : k;
        const U = UNITS[bt];
        let p = (mode === 'missile' ? U.missile : U.melee) * (spc ? 1.35 : 1);
        if (mode === 'melee' && (bt === 'arc' || bt === 'mag' || bt === 'sie')) p += (UNITS[bt].missile || 0) * 0.25; // 白兵戦中も射撃は続く
        if (!p) continue;
        // 兵種の相性
        if (mode === 'melee') {
          if (bt === 'cav') {
            p *= 1 + 0.6 * dc.arc + 0.3 * dc.sie + 0.3 * dc.mag - 0.5 * dc.inf;
            if (b.chargeT === this.t) p *= U.charge || 1;
          }
          if (bt === 'drg' && b.chargeT === this.t) p *= U.charge;
          if (bt === 'inf') p *= 1 + 0.45 * dc.cav;
          if (spc && n.special === 'heavy') p *= 1.1;
        } else if (bt === 'arc') {
          p *= 1 + 0.3 * dc.inf - 0.25 * dc.cav;
          if (spc && n.special === 'longbow') p *= 1.15;
        }
        // 地形
        if (!b.naval && bt === 'cav') {
          let tf = CAV_TERRAIN[ter];
          if (spc && n.special === 'camel' && ter === T.DESERT) tf = 1.45;
          if (spc && n.special === 'wolf' && (ter === T.SNOW || ter === T.TUNDRA || ter === T.FOREST)) tf = 1.25;
          if (spc && n.special === 'knight' && ter === T.PLAINS) tf = 1.5;
          p *= tf;
        }
        if (b.naval) {
          if (bt === 'cav') p *= 0.3;
          if (bt === 'sie') p *= 0.5;
          if (spc && n.special === 'marine') p *= 1.6;
        }
        const d = q * f * p;
        total += d; by[k] = (by[k] || 0) + d;
      }
    }
    const K = mode === 'missile' ? 0.013 : 0.019;
    let dm = 1;
    if (!b.naval && b.defender === 1 - si) {
      dm = 1 + (TW.TERRAIN[ter].def - 1) * 0.6;
      if (this.fortZone[b.i] >= 0) dm *= 1.3;
      if (this.w.river[b.i]) dm *= 1.1;
    }
    const roll = 0.75 + this.rand() * 0.5;
    for (const k in by) att.dmgType[k] = (att.dmgType[k] || 0) + by[k] * K * roll / dm;
    return total * K * roll / dm;
  };

  P.applyBattleDamage = function (b, si, dmg) {
    if (!isFinite(dmg) || dmg < 0) dmg = 0;
    const s = b.sides[si];
    const tot = this.sideStr(s) || 1;
    for (const a of s.armies) a.str -= dmg * a.str / tot;
    s.losses += dmg;
    let resolve = 1;
    for (const g of s.gens) resolve = Math.max(resolve, this.genSkill(g));
    if (this.sideComp(s).spc && s.armies.some(a => this.nations[a.n].special === 'heavy')) resolve += 0.05;
    s.morale -= (dmg / Math.max(1, s.str0)) * 200 / resolve + 0.35;
  };

  // ---------- 会戦の進行 ----------
  P.tickBattle = function (b) {
    for (const s of b.sides) s.armies = s.armies.filter(a => a.str > 0 && a.battle === b.id);
    if (!b.sides[0].armies.length || !b.sides[1].armies.length) {
      this.endBattle(b, b.sides[0].armies.length ? 0 : b.sides[1].armies.length ? 1 : -1);
      return;
    }
    const age = this.t - b.phaseT;
    if (b.phase === 'deploy' && age >= (b.naval ? 2 : 4)) {
      b.phase = 'missile'; b.phaseT = this.t;
      this.addBattleLog(b, b.naval ? '砲撃と矢の応酬が始まった' : '射撃戦: 弓兵と投石が敵陣に降り注ぐ');
    } else if (b.phase === 'missile' && age >= (b.naval ? 3 : 6)) {
      b.phase = 'melee'; b.phaseT = this.t; b.chargeT = this.t;
      this.addBattleLog(b, b.naval ? '接舷戦: 両艦隊が乗り込みあう' : '白兵戦: 騎兵の突撃を合図に両軍が激突');
    }
    if (b.phase === 'missile' || b.phase === 'melee') {
      const mode = b.phase;
      const d0 = this.battleDamage(b, 0, mode), d1 = this.battleDamage(b, 1, mode);
      this.applyBattleDamage(b, 1, d0);
      this.applyBattleDamage(b, 0, d1);
      if (this.sideStr(b.sides[0]) < this.sideStr(b.sides[1]) * 0.5) b.sides[0].morale -= 1.5;
      if (this.sideStr(b.sides[1]) < this.sideStr(b.sides[0]) * 0.5) b.sides[1].morale -= 1.5;
    }
    // 交戦相手 (描画用)
    for (let si = 0; si < 2; si++) {
      let foe = null;
      for (const e of b.sides[1 - si].armies) if (!foe || e.str > foe.str) foe = e;
      for (const a of b.sides[si].armies) a.fighting = foe ? foe.id : null;
    }
    const s0 = b.sides[0], s1 = b.sides[1];
    const br0 = s0.morale <= 0 || this.sideStr(s0) < s0.str0 * 0.25;
    const br1 = s1.morale <= 0 || this.sideStr(s1) < s1.str0 * 0.25;
    if (br0 || br1) {
      let w;
      if (br0 && br1) w = s0.morale + this.sideStr(s0) / Math.max(1, s0.str0) * 50 >= s1.morale + this.sideStr(s1) / Math.max(1, s1.str0) * 50 ? 0 : 1;
      else w = br0 ? 1 : 0;
      this.endBattle(b, w);
    } else if (this.t - b.start > 60) this.endBattle(b, -1);
  };

  P.endBattle = function (b, wi) {
    this.battles = this.battles.filter(x => x !== b);
    const all = b.sides[0].armies.concat(b.sides[1].armies);
    for (const a of all) {
      a.battle = null; a.fighting = null;
      // 戦場の隊列から元の位置へなめらかに戻す (描画用)
      const f = a.battleSide === 0 ? -1 : 1;
      a.exitX = b.x + Math.cos(b.angle) * f * 1.3; a.exitY = b.y + Math.sin(b.angle) * f * 1.3; a.exitT = performance.now();
      if (a.mode !== 'home' && a.mode !== 'siege') { a.path = null; a.lastPath = -1e9; } // 次のAIで最優先に経路を探す
    }
    const total0 = b.sides[0].str0 + b.sides[1].str0;
    if (wi < 0) {
      this.addBattleLog(b, '決着つかず、両軍は兵を引いた');
      if (total0 > 120) this.saveBattleReport(b, -1, []);
      for (const s of b.sides) for (const a of s.armies) { a.routed = this.t + 8; }
      return;
    }
    const ws = b.sides[wi], ls = b.sides[1 - wi];
    const wc = this.sideComp(ws);
    const cavShare = wc.cav + wc.drg + (wc.spc && ws.armies.some(a => spBase(this.nations[a.n]) === 'cav') ? wc.spc : 0);
    let strongestWin = null;
    for (const a of ws.armies) if (!strongestWin || a.str > strongestWin.str) strongestWin = a;
    const killedGens = [];
    this.addBattleLog(b, b.naval ? `${this.nations[ls.lead] ? this.nations[ls.lead].name : ''}の艦隊は壊滅し海に沈んだ` : `${this.nations[ls.lead] ? this.nations[ls.lead].name : ''}軍が潰走、${cavShare > 0.25 ? '騎兵が追撃する' : '勝者が戦場を制した'}`);
    for (const a of ls.armies.slice()) {
      const extra = b.naval ? a.str : a.str * (0.15 + 0.35 * cavShare);
      a.str -= extra; ls.losses += extra;
      const ln = this.nations[a.n];
      if (a.str < 4 || b.naval) {
        a.str = 0;
        this.effect(b.naval ? 'sink' : 'flagfall', a.x, a.y, 1, { color: ln.css });
        const g = a.gen;
        if (strongestWin) this.loseGeneral(a, strongestWin);
        if (g && g.fate === 'dead') killedGens.push(g);
        if (this.threat && this.threat.type === 'undead' && strongestWin && strongestWin.n === this.threat.nId && !ln.isThreat && a.bStr > 10) {
          const ua = this.spawnArmy(this.nations[strongestWin.n], { i: a.i, x: a.x, y: a.y }, a.bStr * 0.4);
          ua.mode = 'idle';
          this.effect('rebel', a.x, a.y, 2, { color: this.nations[strongestWin.n].css });
        }
        if (a.flying && this.threat && a.n === this.threat.nId && strongestWin) this.pendingSlay = { by: strongestWin.n, gen: strongestWin.gen };
      } else {
        a.routed = this.t + 12; a.retreat = this.t + 30;
        if (a.gen) a.gen.losses++;
        if (!ln.isThreat) this.sendHome(a);
        else a.path = null;
      }
    }
    for (const g of killedGens) this.addBattleLog(b, `${this.genName(g)}、乱戦の中で討ち取られる`);
    // 勝者
    const credited = new Set();
    for (const a of ws.armies) {
      if (a.gen && !credited.has(a.gen)) {
        credited.add(a.gen);
        a.gen.wins++;
        if (total0 > a.gen.bestSize) { a.gen.bestSize = total0; a.gen.best = b.name; }
      }
    }
    const wn = this.nations[ws.lead], ln0 = this.nations[ls.lead];
    if (wn && wn.uid === ws.luid) wn.battlesWon++;
    if (ln0 && ln0.uid === ls.luid) {
      ln0.battlesLost++;
      if (wn && wn.uid === ws.luid) this.warScore[wn.id * MAXN + ln0.id] += ls.losses / 15;
    }
    // 戦場の確保
    if (!b.naval && wn) {
      const W = this.w.W;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = b.x + dx, y = b.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= this.w.H || dx * dx + dy * dy > 5) continue;
        const i = y * W + x;
        const o = this.owner[i];
        if (this.w.land[i] && o >= 0 && o !== wn.id && this.atWar(wn.id, o) && this.cityAt[i] < 0 && this.fortZone[i] < 0) this.setOwner(i, wn.id);
      }
    }
    const factors = this.battleFactors(b, wi);
    const rep = this.saveBattleReport(b, wi, factors);
    // 記録
    if (total0 > 120 && wn && ln0) {
      const wnames = [...ws.nations.values()].map(v => v.name).join('・');
      const lnames = [...ls.nations.values()].map(v => v.name).join('・');
      const gname = ws.gens[0] ? `${this.genName(ws.gens[0])}率いる` : '';
      const text = `${b.name}: ${gname}${wnames}軍が${lnames}軍を破る — ${factors[0] || '激戦の末'}`;
      const e = this.addLog('battle', text, b, total0 > 700, [wn, ln0]);
      e.battleId = rep ? rep.id : null;
      if (total0 > 700) this.addBattlefield(b.x, b.y, b.name.replace(/近郊/, ''), total0, rep ? rep.id : null);
      if (total0 > 2600 && this.rand() < 0.5) {
        const place = b.name.replace(/(近郊の戦い|の海戦)$/, '');
        this.addPoem('battle', { place, winner: wn.name, loser: ln0.name }, b, [wn, ln0]);
      }
      this.effect('victory', b.x, b.y, 3, { color: wn.css });
    }
  };

  // 勝敗の決め手
  P.battleFactors = function (b, wi) {
    const ws = b.sides[wi], ls = b.sides[1 - wi];
    const f = [];
    const ter = this.w.terrain[b.i];
    if (b.naval) f.push(`${this.nations[ls.lead] ? this.nations[ls.lead].name : '敵'}の艦隊は海の藻屑と消えた`);
    if (b.ambush === wi) f.push('森や丘に潜んだ伏兵の奇襲');
    if (ws.late > 0 && ws.lateSwing) f.push('援軍の到着で形勢逆転');
    else if (ws.late > ws.str0 * 0.25) f.push('後詰めの援軍が勝負を決めた');
    const dt = ws.dmgType, sum = Object.values(dt).reduce((x, y) => x + y, 0) || 1;
    const share = k => (dt[k] || 0) / sum;
    const spName = (() => { for (const a of ws.armies.concat()) { const n = this.nations[a.n]; if (n && n.special) return SPECIALS[n.special].name; } return '特色兵'; })();
    if (share('drg') > 0.2) f.push('竜騎士が空から敵陣を蹂躙した');
    if (share('mag') > 0.2) f.push('魔導兵の大魔法が敵陣を焼いた');
    if (share('cav') > 0.35) f.push('騎兵の突撃が敵陣を崩した');
    if (share('arc') > 0.35) f.push('弓兵の射撃が敵を削り続けた');
    if (share('spc') > 0.2) f.push(`${spName}の奮戦`);
    if (share('sie') > 0.2) f.push('攻城兵器の砲撃');
    if (!b.naval && b.defender === wi && TW.TERRAIN[ter].def >= 1.3) f.push(`${TW.TERRAIN[ter].name}の地の利を活かした守り`);
    const lc = this.sideComp(ls);
    if (!b.naval && lc.cav > 0.3 && CAV_TERRAIN[ter] < 0.85) f.push(`${TW.TERRAIN[ter].name}で敵騎兵の動きを封じた`);
    if (ws.str0 > ls.str0 * 1.6) f.push('数で圧倒した');
    else if (ws.str0 < ls.str0 * 0.8) f.push('寡兵で大軍を破った');
    const g = ws.gens.slice().sort((a, b2) => b2.wins - a.wins)[0];
    if (g && g.wins >= 6) f.push(`${this.genName(g)}の采配`);
    const qw = ws.armies.length ? this.quality(ws.armies[0].n) : 1, ql = ls.armies.length ? this.quality(ls.armies[0].n) : 1;
    if (qw - ql >= 0.15) f.push('兵の質の差');
    if (!f.length) f.push(ws.morale > 50 ? '士気の高さで押し切った' : '消耗戦の末、紙一重で勝利');
    return f;
  };

  P.battleSnapshot = function (b, wi, factors) {
    const sideRep = s => ({
      nations: [...s.nations.values()],
      gens: s.gens.map(g => ({ name: this.genName(g), wins: g.wins, fate: g.fate })),
      str0: s.str0, losses: s.losses, end: Math.max(0, this.sideStr(s)), morale: Math.max(0, Math.round(s.morale)),
      comp: this.sideComp(s), late: s.late,
      specials: [...new Set(s.armies.map(a => this.nations[a.n] && this.nations[a.n].special).filter(Boolean))],
    });
    const rep = {
      id: b.id, name: b.name, year: Math.floor(b.start / TPY) + 1, month: Math.floor((b.start % TPY) / (TPY / 12)) + 1,
      x: b.x, y: b.y, naval: b.naval, terrain: b.naval ? '海上' : TW.TERRAIN[this.w.terrain[b.i]].name,
      ambush: b.ambush, winner: wi, factors, sides: [sideRep(b.sides[0]), sideRep(b.sides[1])],
      duration: this.t - b.start, log: b.log.slice(), live: wi === undefined, phase: b.phase,
    };
    return rep;
  };
  P.saveBattleReport = function (b, wi, factors) {
    this.battleReports = this.battleReports || [];
    const rep = this.battleSnapshot(b, wi, factors);
    rep.live = false;
    this.battleReports.push(rep);
    if (this.battleReports.length > 120) {
      this.battleReports.sort((a, c) => (c.sides[0].str0 + c.sides[1].str0) - (a.sides[0].str0 + a.sides[1].str0));
      this.battleReports.length = 90;
      this.battleReports.sort((a, c) => a.id - c.id);
    }
    return rep;
  };
  P.battleReport = function (id) { return (this.battleReports || []).find(r => r.id === id) || null; };

  // ---------- 毎ティックの会戦処理 (旧来の小競り合いを置き換え) ----------
  P.resolveBattles = function () {
    this.battles = this.battles || [];
    if (this.battleSeq == null) this.battleSeq = 0;
    const A = this.armies;
    for (const a of A) {
      if (a.str <= 0 || a.battle) continue;
      if (a.routed && a.routed > this.t) continue;
      let joined = false;
      for (const b of this.battles) {
        const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (d2 > (b.naval ? 6 : 10)) continue;
        const si = this.battleSide(a, b);
        if (si >= 0) { this.joinBattle(a, b, si, true); joined = true; break; }
      }
      if (joined) continue;
      for (const e of A) {
        if (e === a || e.str <= 0 || this.rel[a.n * MAXN + e.n] !== 1) continue;
        if (e.routed && e.routed > this.t) continue;
        const dx = a.x - e.x, dy = a.y - e.y;
        if (dx * dx + dy * dy > 2.6) continue;
        if (e.battle) {
          const b = this.battleById(e.battle);
          const si = b ? this.battleSide(a, b) : -1;
          if (si >= 0) this.joinBattle(a, b, si, true);
        } else this.startBattle(a, e);
        break;
      }
    }
    for (const b of this.battles.slice()) this.tickBattle(b);
    if (this.pendingSlay) this.checkSlay();
  };
})();
