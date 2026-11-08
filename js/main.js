'use strict';
// UI・入力・ゲームループ
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32];
  const SPEED_LABELS = ['½', '1', '2', '4', '8', '16', '32'];
  const TPS = 2.5; // x1 のときの1秒あたりティック数 (x4 で年4.8秒、x32 で年0.6秒)
  const ICON = { war: '⚔️', peace: '🕊️', alliance: '🤝', capture: '🏰', capital: '👑', destroy: '💀', rebel: '🔥', battle: '🗡️', god: '✨', betray: '🐍', era: '📜', culture: '🎭', develop: '🏗️', wonder: '🏛️', poem: '🪕', op: '🎯', army: '🚩', siege: '🔥', fort: '🏯', general: '🎖️', nature: '🌿' };
  const MAJOR_TYPES = new Set(['war', 'peace', 'alliance', 'rebel', 'destroy', 'capital', 'betray', 'god', 'era', 'culture', 'poem', 'op', 'general', 'nature']);

  const canvas = $('#map');
  const R = new TW.Renderer(canvas);
  const editor = new TW.Editor();
  const comm = new TW.Commentary(R, document.querySelector('#ticker'));
  const app = {
    sim: null, world: null, editing: false, paused: false, speed: 1, acc: 0,
    tool: 'look', settings: { type: 'random', seed: '', nations: 8, saved: '' },
  };
  window.app = app; // デバッグ用
  app.R = R; app.comm = comm;

  // ---------- 世界の生成 ----------
  function randomSeedText() {
    const syl = ['ka', 'ri', 'to', 'mu', 'sa', 'ne', 'ro', 'vi', 'la', 'do', 'zen', 'ar', 'el', 'ko', 'mi', 'ta'];
    let s = '';
    for (let i = 0; i < 3; i++) s += syl[Math.floor(Math.random() * syl.length)];
    return s + Math.floor(Math.random() * 100);
  }

  function startWorld(cfg) {
    $('#loading').hidden = false;
    setTimeout(() => {
      try {
        let W, H, land, opts = { kind: cfg.type };
        const seedText = cfg.seed || randomSeedText();
        const seed = TW.hashString(seedText);
        opts.seed = seed;
        if (cfg.type === 'earth') {
          const e = TW.earthLand();
          W = e.W; H = e.H; land = e.land; opts.latTop = e.latTop; opts.latBottom = e.latBottom;
        } else if (cfg.type === 'custom' || cfg.type === 'saved') {
          W = cfg.W; H = cfg.H; land = TW.cleanLand(W, H, new Uint8Array(cfg.mask), 3, 4);
          opts.latTop = cfg.latTop ?? 70; opts.latBottom = cfg.latBottom ?? -70;
        } else {
          W = 240; H = 150;
          land = TW.generateRandomLand(W, H, TW.mulberry32(seed));
        }
        if (!land.some(v => v)) throw new Error('陸地がありません');
        const world = TW.buildWorld(W, H, land, opts);
        const sim = new TW.Sim(world, { nations: cfg.nations, capitals: cfg.capitals && cfg.capitals.length >= 2 ? cfg.capitals : null });
        sim.onEvent = onEvent;
        app.world = world; app.sim = sim; app.acc = 0;
        app.settings.seed = seedText;
        app.selected = null;
        R.selectedUid = null;
        updateFitPadding();
        R.setWorld(world);
        R.setSim(sim);
        $('#chronicle').innerHTML = '';
        for (const e of sim.log) onEvent(e, true);
        comm.reset();
        app.worldName = cfg.type === 'earth' ? '地球' : cfg.type === 'random' ? TW.Names.root(TW.mulberry32(seed)) + '大陸' : (cfg.name || '新大陸');
        $('#detail').innerHTML = '<p class="hint">地図上の国をクリックすると詳細が表示されます。</p>';
        if (cfg.type === 'random') history.replaceState(null, '', `#map=random&seed=${encodeURIComponent(seedText)}&n=${cfg.nations}`);
        else if (cfg.type === 'earth') history.replaceState(null, '', `#map=earth&seed=${encodeURIComponent(seedText)}&n=${cfg.nations}`);
        else history.replaceState(null, '', location.pathname + location.search);
        updatePanels(true);
      } catch (err) {
        console.error(err);
        toast('世界の創造に失敗しました: ' + err.message);
      }
      $('#loading').hidden = true;
    }, 40);
  }

  // ---------- イベント ----------
  function onEvent(e, silent) {
    const majorish = e.major || MAJOR_TYPES.has(e.type) || (e.type === 'wonder' && /完成|奪取|崩れ/.test(e.text));
    if (!silent) {
      comm.onEvent(e, app.sim);
      if (e.type === 'wonder' && e.major) { TW.Audio.play('culture'); toast(`${ICON.wonder} ${e.text}`, e); }
      const snd = { war: 'war', peace: 'peace', alliance: 'alliance', capture: 'capture', capital: 'capital', destroy: 'destroy', rebel: 'rebel', betray: 'betray', culture: 'culture', develop: 'develop' }[e.type];
      if (snd && (e.type !== 'war' || e.major || Math.random() < 0.5) && (e.type !== 'develop' || e.major)) TW.Audio.play(snd);
      if (e.type === 'battle' && e.major) TW.Audio.play('battle');
      if (['capital', 'destroy', 'rebel', 'betray', 'war'].includes(e.type) && (e.type !== 'war' || e.major || app.sim.aliveNations().length <= 12)) toast(`${ICON[e.type] || ''} ${e.text}`, e);
      else if ((e.type === 'culture' || e.type === 'develop') && e.major) toast(`${ICON[e.type]} ${e.text}`, e);
    }
    if ($('#log-major').checked && !majorish) return;
    addChronicle(e);
  }

  function addChronicle(e) {
    const ul = $('#chronicle');
    const li = document.createElement('li');
    if (e.major) li.className = 'major';
    li.innerHTML = `<span class="ic">${ICON[e.type] || '・'}</span><span><span class="yr">${e.year}年</span> ${escapeHtml(e.text)}</span>`;
    li.dataset.seq = e.seq;
    if (e.x != null) li.addEventListener('click', () => gotoEvent(e));
    ul.prepend(li);
    while (ul.children.length > 300) ul.lastChild.remove();
  }
  $('#log-major').addEventListener('change', () => {
    $('#chronicle').innerHTML = '';
    if (!app.sim) return;
    const major = $('#log-major').checked;
    const list = app.sim.log.filter(e => !major || e.major || MAJOR_TYPES.has(e.type)).slice(-300);
    for (const e of list) addChronicle(e);
  });

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function gotoEvent(e) {
    R.centerOn(e.x, e.y, 7);
    if (e.ns && e.ns.length) select(e.ns[0]);
  }
  function toast(text, ev) {
    const box = $('#toasts');
    const d = document.createElement('div');
    d.className = 'toast';
    const span = document.createElement('span');
    span.className = 'msg';
    span.textContent = text;
    d.appendChild(span);
    if (ev && ev.x != null) {
      const b = document.createElement('button');
      b.className = 'goto';
      b.innerHTML = '📍<span class="t"> 移動</span>';
      b.title = 'その場所へ移動';
      b.addEventListener('click', () => { gotoEvent(ev); d.classList.add('out'); setTimeout(() => d.remove(), 600); });
      d.appendChild(b);
    }
    box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    // マウスを乗せている間は消さない
    let hover = false;
    d.addEventListener('pointerenter', () => { hover = true; });
    d.addEventListener('pointerleave', () => { hover = false; });
    const close = () => { if (hover) { setTimeout(close, 800); return; } d.classList.add('out'); setTimeout(() => d.remove(), 700); };
    setTimeout(close, ev && ev.x != null ? 6500 : 4200);
  }
  app.toast = toast;

  // ---------- パネル ----------
  let activeTab = 'rank';
  const COMPACT_MQ = window.matchMedia('(max-width: 760px) and (orientation: portrait), (max-height: 520px) and (orientation: landscape)');
  const PORTRAIT_MQ = window.matchMedia('(max-width: 760px) and (orientation: portrait)');
  const isCompact = () => COMPACT_MQ.matches;
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    // スマホ縦画面: 開いているタブをもう一度押すとシートを閉じる
    if (PORTRAIT_MQ.matches && b.dataset.tab === activeTab && !document.body.classList.contains('panel-hidden')) {
      document.body.classList.add('panel-hidden');
      return;
    }
    setTab(b.dataset.tab);
  }));
  function setTab(tab) {
    activeTab = tab;
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $$('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
    if (document.body.classList.contains('panel-hidden')) document.body.classList.remove('panel-hidden');
    updatePanels(true);
  }

  function select(uid) {
    app.selected = uid;
    R.selectedUid = uid;
    if (uid != null) setTab('detail');
    updatePanels(true);
  }

  let lastPanel = 0;
  // パネルに隠れない位置に地図を合わせる
  // 画面上のパネル類の位置から、地図が隠れない余白を計算する
  function updateFitPadding() {
    const st = $('#stage').getBoundingClientRect();
    let pl = 0, pr = 0, pt = 0, pb = 0;
    for (const el of [$('#panel'), $('#editorbar'), $('#godbar')]) {
      if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cx = (r.left + r.right) / 2 - st.left, cy = (r.top + r.bottom) / 2 - st.top;
      if (r.width > st.width * 0.6) {
        if (cy > st.height / 2) pb = Math.max(pb, st.bottom - r.top); else pt = Math.max(pt, r.bottom - st.top);
      } else if (r.height > st.height * 0.45) {
        if (cx > st.width / 2) pr = Math.max(pr, st.right - r.left + 4); else pl = Math.max(pl, r.right - st.left + 4);
      }
    }
    // 縦画面で閉じたシート(タブだけ)の上に神の手があるので、その分も下に空ける
    if (PORTRAIT_MQ.matches && !app.editing) pb = Math.max(pb, st.bottom - $('#godbar').getBoundingClientRect().top + 4);
    R.padLeft = pl; R.padRight = pr; R.padTop = pt; R.padBottom = pb;
  }
  function refit() { updateFitPadding(); R.fit(); }

  function updatePanels(force) {
    const now = performance.now();
    if (!force && now - lastPanel < 450) return;
    lastPanel = now;
    const sim = app.sim;
    if (!sim) return;
    if (activeTab === 'rank') { renderRanking(); renderWonders(); renderGenerals(); renderNaturals(); }
    else if (activeTab === 'graph') renderGraph();
    else if (activeTab === 'detail') renderDetail();
  }

  function natLink(n) {
    return `<span class="chip" data-uid="${n.uid}"><span class="sw" style="background:${n.css}"></span>${escapeHtml(n.name)}</span>`;
  }

  function renderRanking() {
    const sim = app.sim;
    const alive = sim.aliveNations().sort((a, b) => b.cells - a.cells);
    let wars = 0, allies = 0;
    for (const n of alive) { wars += n.wars; allies += n.allies; }
    const owned = alive.reduce((s, n) => s + n.cells, 0);
    $('#summary').innerHTML = `現存する国: <b>${alive.length}</b>　戦争: <b>${wars / 2}</b>　同盟: <b>${allies / 2}</b><br>` +
      `未開の地: <b>${Math.max(0, 100 - owned / sim.landCount * 100).toFixed(0)}%</b>　建国された国: <b>${sim.uidSeq}</b>`;
    const max = alive.length ? alive[0].cells : 1;
    $('#ranking').innerHTML = alive.map((n, k) => {
      const pct = (n.cells / sim.landCount * 100).toFixed(1);
      const tags = (n.wars ? `<span class="tag war">交戦${n.wars}</span>` : '') + (n.allies ? `<span class="tag ally">同盟${n.allies}</span>` : '');
      return `<li data-uid="${n.uid}" class="${n.uid === app.selected ? 'sel' : ''}"><span class="rk">${k + 1}</span>` +
        `<span class="nm"><span class="sw" style="background:${n.css}"></span><span class="t">${escapeHtml(n.name)}</span>${tags}</span>` +
        `<span class="pc">${pct}%</span>` +
        `<span class="bar"><i style="width:${n.cells / max * 100}%;background:${n.css}"></i></span>` +
        `<span class="sub">都市 ${n.cityCount}　兵 ${TW.fmtTroops(n.manpower + n.armyStr)}　軍団 ${n.armyCount}　🎭${TW.ERAS[n.era].name}</span></li>`;
    }).join('');
  }
  function renderGenerals() {
    const sim = app.sim;
    const active = sim.generals.filter(g => g.fate === 'active' && g.wins + g.cities > 0)
      .sort((a, b) => (b.wins + b.cities * 2) - (a.wins + a.cities * 2)).slice(0, 8);
    const armyOf = new Map(sim.armies.filter(a => a.gen).map(a => [a.gen.id, a]));
    $('#generals').innerHTML = active.length ? active.map(g => {
      const a = armyOf.get(g.id);
      const loc = a ? ` data-army="${a.id}"` : '';
      return `<li${loc}><span class="wi">🎖️</span><div><b>${escapeHtml(sim.genName(g))}</b> <small><span class="sw" style="background:${g.css}"></span>${escapeHtml(g.nation)}</small><br>` +
        `<small>${g.wins}勝${g.losses}敗・攻略${g.cities}都市${g.forts ? '・' + g.forts + '砦' : ''}${a ? '・出陣中 ' + TW.fmtTroops(a.str) : '・待機中'}</small></div></li>`;
    }).join('') : '<li class="dim">まだ名を上げた将軍はいない</li>';
  }
  $('#generals').addEventListener('click', ev => {
    const li = ev.target.closest('li[data-army]');
    if (!li) return;
    const a = app.sim.armies.find(x => x.id === +li.dataset.army);
    if (a) { comm.userMoved(); R.centerOn(a.x, a.y, 8); }
  });
  function renderNaturals() {
    const sim = app.sim;
    $('#naturals').innerHTML = sim.cities.filter(c => c.nat).map(c => {
      const o = c.owner >= 0 ? sim.nations[c.owner] : null;
      return `<li data-city="${c.id}" title="${escapeHtml(c.natDesc)}"><span class="wi">${c.icon}</span><div><b>${escapeHtml(c.name)}</b><br><small>${o ? `<span class="sw" style="background:${o.css}"></span>${escapeHtml(o.name)}` : '<span class="dim">未開の地</span>'}　${escapeHtml(c.natDesc)}</small></div></li>`;
    }).join('') || '<li class="dim">この世界にはない</li>';
  }
  $('#naturals').addEventListener('click', ev => {
    const li = ev.target.closest('li[data-city]');
    if (!li) return;
    const c = app.sim.cities[+li.dataset.city];
    comm.userMoved(); R.centerOn(c.x, c.y, 7);
  });
  function renderWonders() {
    const sim = app.sim;
    $('#wonders').innerHTML = sim.wonders.map(w => {
      let st = '<span class="dim">未建設</span>';
      if (w.state === 'built') {
        const c = sim.cities[w.city], o = c.owner >= 0 ? sim.nations[c.owner] : null;
        st = o ? `<span class="sw" style="background:${o.css}"></span>${escapeHtml(o.name)}・${escapeHtml(c.name)}` : escapeHtml(c.name);
      } else if (w.state === 'ruin') st = `<span class="dim">遺跡（${escapeHtml(sim.cities[w.city].name)}）</span>`;
      const builders = sim.aliveNations().filter(n => n.project && n.project.key === w.key)
        .map(n => `🏗️${escapeHtml(n.name)} ${Math.min(99, Math.round(n.project.progress / n.project.need * 100))}%`).join(' ');
      const loc = w.state !== 'none' ? ` data-city="${w.city}"` : '';
      return `<li${loc} title="${escapeHtml(w.desc)}"><span class="wi">${w.state === 'ruin' ? '🏚️' : w.icon}</span><div><b>${escapeHtml(w.name)}</b><br><small>${st}${builders ? '　' + builders : ''}</small></div></li>`;
    }).join('');
  }
  $('#wonders').addEventListener('click', ev => {
    const li = ev.target.closest('li[data-city]');
    if (!li) return;
    const c = app.sim.cities[+li.dataset.city];
    R.centerOn(c.x, c.y, 7);
  });
  $('#ranking').addEventListener('click', ev => {
    const li = ev.target.closest('li[data-uid]');
    if (!li) return;
    const uid = +li.dataset.uid;
    const n = app.sim.nationByUid(uid);
    if (n && n.alive) { const c = app.sim.cities[n.capital]; R.centerOn(c.x, c.y); }
    select(uid);
  });

  function renderGraph() {
    const sim = app.sim, cv = $('#graph');
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const Wd = cv.clientWidth || 300, Hd = 240;
    if (cv.width !== Math.round(Wd * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr); cv.style.height = Hd + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wd, Hd);
    const hist = sim.history.slice(-240);
    if (hist.length < 2) { ctx.fillStyle = '#6b5238'; ctx.font = '12px serif'; ctx.fillText('データ収集中…', 10, 20); return; }
    const L = sim.landCount;
    const uids = new Set(); const meta = new Map();
    for (const h of hist) for (const d of h.data) { uids.add(d.uid); meta.set(d.uid, d); }
    const order = [...uids].sort((a, b) => a - b);
    const top = 6, bottom = Hd - 18, left = 4, right = Wd - 4;
    const xs = k => left + (right - left) * k / (hist.length - 1);
    const maps = hist.map(h => new Map(h.data.map(d => [d.uid, d.cells / L])));
    const cum = hist.map(() => 0);
    for (const uid of order) {
      ctx.beginPath();
      const lower = cum.slice();
      for (let k = 0; k < hist.length; k++) cum[k] += maps[k].get(uid) || 0;
      for (let k = 0; k < hist.length; k++) ctx.lineTo(xs(k), bottom - (bottom - top) * cum[k]);
      for (let k = hist.length - 1; k >= 0; k--) ctx.lineTo(xs(k), bottom - (bottom - top) * lower[k]);
      ctx.closePath();
      ctx.fillStyle = meta.get(uid).css; ctx.fill();
      ctx.strokeStyle = 'rgba(62,44,28,0.35)'; ctx.lineWidth = 0.5; ctx.stroke();
    }
    ctx.fillStyle = '#6b5238'; ctx.font = '11px serif';
    ctx.fillText(`${hist[0].year}年`, left, Hd - 4);
    ctx.textAlign = 'right'; ctx.fillText(`${hist[hist.length - 1].year}年`, right, Hd - 4); ctx.textAlign = 'left';
    const last = hist[hist.length - 1].data.slice().sort((a, b) => b.cells - a.cells).slice(0, 8);
    $('#graph-legend').innerHTML = last.map(d => `<div><span class="sw" style="background:${d.css}"></span>${escapeHtml(d.name)}　${(d.cells / L * 100).toFixed(1)}%</div>`).join('');
  }

  function renderDetail() {
    const sim = app.sim, el = $('#detail');
    if (app.selected == null) { el.innerHTML = '<p class="hint">地図上の国をクリックすると詳細が表示されます。</p>'; return; }
    const n = sim.nationByUid(app.selected);
    if (!n) { el.innerHTML = '<p class="hint">情報がありません。</p>'; return; }
    const evs = sim.log.filter(e => e.ns.includes(n.uid)).slice(-40).reverse();
    const evHtml = evs.map(e => `<li>${ICON[e.type] || '・'} <b>${e.year}年</b> ${escapeHtml(e.text)}</li>`).join('');
    const foundedYear = Math.floor(n.founded / TW.TPY) + 1;
    if (!n.alive) {
      el.innerHTML = `<h3><span class="sw" style="background:${n.css}"></span>${escapeHtml(n.name)}</h3>` +
        `<div class="sub">${foundedYear}年建国 — ${Math.floor(n.deadAt / TW.TPY) + 1}年滅亡</div>` +
        `<table><tr><td>最大版図</td><td>${(n.peakCells / sim.landCount * 100).toFixed(1)}%</td></tr>` +
        `<tr><td>攻略した都市</td><td>${n.citiesTaken}</td></tr><tr><td>会戦 勝/敗</td><td>${n.battlesWon} / ${n.battlesLost}</td></tr></table>` +
        `<div class="rel"><div class="h">歴史</div><ul class="ev">${evHtml}</ul></div>`;
      return;
    }
    const cap = sim.cities[n.capital];
    const rows = [];
    const lists = { war: [], ally: [], truce: [] };
    for (const m of sim.aliveNations()) {
      if (m === n) continue;
      if (sim.atWar(n.id, m.id)) lists.war.push(m);
      else if (sim.allied(n.id, m.id)) lists.ally.push(m);
      else if (sim.hasTruce(n.id, m.id)) lists.truce.push(m);
    }
    const neighbors = sim.aliveNations().filter(m => m !== n && sim.border[n.id * TW.MAXN + m.id] > 0)
      .map(m => ({ m, op: sim.op(n.id, m.id) })).sort((a, b) => a.op - b.op);
    rows.push(['首都', escapeHtml(cap.name)]);
    rows.push(['領土', `${(n.cells / sim.landCount * 100).toFixed(1)}% (${n.cells}区画)`]);
    rows.push(['都市 / 人口', `${n.cityCount} / ${(n.cityPop).toFixed(1)}万`]);
    rows.push(['予備兵力', TW.fmtTroops(n.manpower)]);
    rows.push(['野戦軍', `${n.armyCount}軍団 / ${TW.fmtTroops(n.armyStr)}`]);
    rows.push(['兵の質', `×${sim.quality(n.id).toFixed(2)}`]);
    rows.push(['好戦性', '⚔'.repeat(1 + Math.round(n.aggression * 4))]);
    rows.push(['会戦 勝/敗', `${n.battlesWon} / ${n.battlesLost}`]);
    rows.push(['攻略した都市', n.citiesTaken]);
    rows.push(['最大版図', `${(n.peakCells / sim.landCount * 100).toFixed(1)}%`]);
    const relBlock = (title, arr) => arr.length ? `<div class="rel"><div class="h">${title}</div>${arr.map(natLink).join('')}</div>` : '';
    el.innerHTML = `<h3><span class="sw" style="background:${n.css}"></span>${escapeHtml(n.name)}</h3>` +
      `<div class="sub">${foundedYear}年建国${n.parentName ? `（${escapeHtml(n.parentName)}から独立）` : ''}・建国${sim.year() - foundedYear}年目</div>` +
      `<table>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>` +
      `<div class="rel"><div class="h">安定度 ${(n.stability * 100).toFixed(0)}%</div><div class="meter"><i style="width:${n.stability * 100}%"></i></div></div>` +
      cultureBlock(sim, n) + wonderBlock(sim, n) + militaryBlock(sim, n) +
      relBlock('⚔️ 交戦中', lists.war) + relBlock('🤝 同盟国', lists.ally) + relBlock('🕊️ 停戦中', lists.truce) +
      (neighbors.length ? `<div class="rel"><div class="h">隣国との関係</div>${neighbors.map(({ m, op }) => natLink(m).replace('</span>', '</span>') + `<small>${op > 0 ? '+' : ''}${op.toFixed(0)}</small>`).join(' ')}</div>` : '') +
      `<div class="rel"><button class="btn" id="goto-cap">首都へ移動</button></div>` +
      `<div class="rel"><div class="h">歴史</div><ul class="ev">${evHtml || '<li>まだ記録はない</li>'}</ul></div>`;
    $('#goto-cap').onclick = () => R.centerOn(cap.x, cap.y, 4);
  }
  function militaryBlock(sim, n) {
    const armies = sim.armies.filter(a => a.n === n.id && a.gen);
    const forts = sim.forts.filter(f => f.owner === n.id);
    const nats = sim.cities.filter(c => c.nat && c.owner === n.id);
    let h = '';
    if (nats.length) h += `<div class="rel"><div class="h">🌿 世界自然遺産</div>${nats.map(c => `<div class="wown">${c.icon} <b>${escapeHtml(c.name)}</b><br><small>${escapeHtml(c.natDesc)}</small></div>`).join('')}</div>`;
    if (armies.length) {
      h += `<div class="rel"><div class="h">🎖️ 出陣中の将軍</div>${armies.sort((a, b) => b.str - a.str).slice(0, 8).map(a =>
        `<div class="wown">${escapeHtml(sim.genName(a.gen))} <small>${TW.fmtTroops(a.str)}・${a.gen.wins}勝${a.gen.losses}敗</small></div>`).join('')}</div>`;
    }
    if (forts.length) h += `<div class="rel"><div class="h">🏯 砦</div>${forts.map(f => escapeHtml(f.name)).join('、')}</div>`;
    const ops = sim.ops.filter(op => op.status === 'active' && op.n === n.id);
    if (ops.length) h += `<div class="rel"><div class="h">🎯 発動中の作戦</div>${ops.map(op => `${escapeHtml(op.name)}（目標: ${escapeHtml(sim.cities[op.target].name)}）`).join('<br>')}</div>`;
    return h;
  }
  function wonderBlock(sim, n) {
    const own = sim.wonders.filter(w => w.state === 'built' && sim.cities[w.city].owner === n.id);
    let h = '';
    if (own.length) h += `<div class="rel"><div class="h">🏛️ 保有する世界の驚異</div>${own.map(w => `<div class="wown">${w.icon} <b>${escapeHtml(w.name)}</b>（${escapeHtml(sim.cities[w.city].name)}）<br><small>${escapeHtml(w.desc)}</small></div>`).join('')}</div>`;
    if (n.project) {
      const w = sim.wonders.find(x => x.key === n.project.key);
      h += `<div class="rel"><div class="h">🏗️ 建設中: ${escapeHtml(w.name)}（${escapeHtml(sim.cities[n.project.city].name)}）</div><div class="meter culture"><i style="width:${Math.min(100, n.project.progress / n.project.need * 100)}%"></i></div></div>`;
    }
    return h;
  }
  function cultureBlock(sim, n) {
    const era = TW.ERAS[n.era], next = TW.ERAS[n.era + 1];
    const prog = next ? TW.clamp((n.culture - era.need) / (next.need - era.need), 0, 1) : 1;
    const cities = sim.cities.filter(c => c.owner === n.id).sort((a, b) => b.dev - a.dev);
    const avg = cities.length ? cities.reduce((s, c) => s + c.dev, 0) / cities.length : 0;
    const counts = TW.BUILDINGS.map(b => ({ b, k: cities.filter(c => c.dev >= b.dev).length })).filter(x => x.k > 0);
    return `<div class="rel culture"><div class="h">🎭 文化: ${era.name}　<small>${Math.round(n.culture)}${next ? ` / ${next.need} (次: ${next.name})` : ' (最高位)'}　+${n.cultureGain.toFixed(0)}/年</small></div>` +
      `<div class="meter culture"><i style="width:${prog * 100}%"></i></div>` +
      `<div class="hint">時代が進むほど兵の質・収入・安定度が上がり、文化の劣る隣国の国境を少しずつ同化します。</div>` +
      `<div class="h" style="margin-top:6px">🏗️ 発展度 平均 ${avg.toFixed(1)} / 10</div>` +
      `<div class="blds">${counts.map(({ b, k }) => `<span class="chip" title="${b.desc}">${b.icon} ${b.name} ×${k}</span>`).join('') || '<span class="hint">施設はまだない</span>'}</div>` +
      `<div class="devlist">${cities.slice(0, 5).map(c => `<div><span>${c.capital ? '👑' : '🏘'} ${escapeHtml(c.name)}</span><span class="devbar"><i style="width:${c.dev * 10}%"></i></span><b>${c.dev.toFixed(1)}</b></div>`).join('')}</div></div>`;
  }
  $('#detail').addEventListener('click', ev => {
    const c = ev.target.closest('.chip[data-uid]');
    if (c) select(+c.dataset.uid);
  });

  // ---------- トップバー ----------
  function setPaused(p) {
    app.paused = p;
    $('#btn-play').textContent = p ? '▶' : '⏸';
    $('#btn-play').classList.toggle('on', p);
  }
  function setSpeed(k) {
    app.speed = k;
    $$('#speed [data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === k));
    $('#btn-speed').textContent = 'x' + SPEED_LABELS[k];
    setPaused(false);
  }
  $('#btn-speed').addEventListener('click', () => setSpeed((app.speed + 1) % SPEEDS.length));
  $('#z-in').addEventListener('click', () => { comm.userMoved(); R.zoomAt(R.cw / 2, R.ch / 2, 1.4); });
  $('#z-out').addEventListener('click', () => { comm.userMoved(); R.zoomAt(R.cw / 2, R.ch / 2, 1 / 1.4); });
  $('#z-fit').addEventListener('click', () => { comm.userMoved(); refit(); });
  // 実況・自動カメラ
  function syncComm() {
    $('#btn-comm').classList.toggle('on', comm.enabled);
    $('#btn-cam').classList.toggle('on', comm.autoCam);
  }
  $('#btn-comm').addEventListener('click', () => { comm.setEnabled(!comm.enabled); syncComm(); toast(comm.enabled ? '🎙 実況 ON' : '🎙 実況 OFF'); });
  $('#btn-cam').addEventListener('click', () => { comm.setAutoCam(!comm.autoCam); syncComm(); toast(comm.autoCam ? '🎥 自動カメラ ON — 注目の場所へ自動で移動します' : '🎥 自動カメラ OFF'); });
  syncComm();
  // 歴史書
  function openBook() {
    if (!app.sim) return;
    $('#book-body').innerHTML = TW.HistoryBook.build(app.sim, app.worldName || '世界');
    $('#modal-book').hidden = false;
    $('#book-body').parentElement.scrollTop = 0;
  }
  $('#btn-book').addEventListener('click', openBook);
  $('#btn-book2').addEventListener('click', openBook);
  $('#book-close').addEventListener('click', () => { $('#modal-book').hidden = true; });
  $('#modal-book').addEventListener('click', ev => {
    if (ev.target.id === 'modal-book') $('#modal-book').hidden = true;
    const a = ev.target.closest('a[href^="#"]');
    if (a) { ev.preventDefault(); const t = $('#book-body').querySelector(a.getAttribute('href')); if (t) t.scrollIntoView({ behavior: 'smooth' }); }
  });
  $('#btn-play').addEventListener('click', () => setPaused(!app.paused));
  $$('#speed [data-speed]').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  $('#btn-panel').addEventListener('click', () => { document.body.classList.toggle('panel-hidden'); });
  // サウンド設定
  function syncSound() {
    const A = TW.Audio;
    $('#btn-sound').textContent = A.enabled ? '🔊' : '🔇';
    $('#bgm-on').checked = A.bgm; $('#sfx-on').checked = A.sfx;
    $('#bgm-vol').value = Math.round(A.bgmVol * 100); $('#sfx-vol').value = Math.round(A.sfxVol * 100);
    $('#bgm-vol').disabled = !A.bgm; $('#sfx-vol').disabled = !A.sfx;
    $('#sound-hint').textContent = !A.enabled ? '' : A.running ? '再生中' : '画面を一度タップ/クリックすると音が鳴り始めます。iPhoneで聞こえない場合はマナーモードを解除してください。';
  }
  TW.Audio.onChange(syncSound);
  $('#btn-sound').addEventListener('click', ev => {
    ev.stopPropagation();
    const pop = $('#sound-pop');
    pop.hidden = !pop.hidden;
    syncSound();
    setTimeout(syncSound, 300);
  });
  document.addEventListener('pointerdown', ev => {
    const pop = $('#sound-pop');
    if (!pop.hidden && !pop.contains(ev.target) && ev.target !== $('#btn-sound')) pop.hidden = true;
  });
  $('#bgm-on').addEventListener('change', () => TW.Audio.setBgm($('#bgm-on').checked));
  $('#sfx-on').addEventListener('change', () => { TW.Audio.setSfx($('#sfx-on').checked); TW.Audio.play('click'); });
  $('#bgm-vol').addEventListener('input', () => TW.Audio.setBgmVol($('#bgm-vol').value / 100));
  $('#sfx-vol').addEventListener('input', () => TW.Audio.setSfxVol($('#sfx-vol').value / 100));
  $('#sfx-vol').addEventListener('change', () => TW.Audio.play('alliance'));
  syncSound();
  $('#btn-help').addEventListener('click', () => { $('#modal-help').hidden = false; });
  $('#help-close').addEventListener('click', () => { $('#modal-help').hidden = true; });

  // 新しい世界
  function openNewModal() {
    const saved = TW.MapStore.list();
    $('#saved-select').innerHTML = saved.length ? saved.map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}${m.capitals && m.capitals.length >= 2 ? ` (首都${m.capitals.length})` : ''}</option>`).join('') : '<option value="">(保存した地図はありません)</option>';
    $('input[name=maptype][value=saved]').disabled = !saved.length;
    $('#saved-select').disabled = !saved.length;
    $('#seed').value = randomSeedText();
    $('#nations').value = app.settings.nations;
    $('#nations-v').textContent = app.settings.nations;
    syncModal();
    $('#modal-new').hidden = false;
  }
  function syncModal() {
    const type = $('input[name=maptype]:checked').value;
    $('#seed-field').style.opacity = type === 'saved' ? 0.6 : 1;
    let hint = '';
    if (type === 'saved') {
      const m = TW.MapStore.get($('#saved-select').value);
      if (m && m.capitals && m.capitals.length >= 2) hint = `この地図には首都が${m.capitals.length}つ指定されているため、国の数は${m.capitals.length}になります。`;
    }
    $('#nations-hint').textContent = hint;
  }
  $$('input[name=maptype]').forEach(r => r.addEventListener('change', syncModal));
  $('#saved-select').addEventListener('change', () => { $('input[name=maptype][value=saved]').checked = true; syncModal(); });
  $('#nations').addEventListener('input', () => { $('#nations-v').textContent = $('#nations').value; });
  $('#seed-rand').addEventListener('click', () => { $('#seed').value = randomSeedText(); });
  $('#btn-new').addEventListener('click', () => { if (app.editing) closeEditor(); openNewModal(); });
  $('#new-cancel').addEventListener('click', () => { $('#modal-new').hidden = true; });
  $('#new-start').addEventListener('click', () => {
    const type = $('input[name=maptype]:checked').value;
    const nations = +$('#nations').value;
    app.settings.nations = nations;
    $('#modal-new').hidden = true;
    if (type === 'saved') {
      const m = TW.MapStore.get($('#saved-select').value);
      if (!m) { toast('地図が見つかりません'); return; }
      startWorld({ type: 'saved', W: m.W, H: m.H, mask: TW.decodeRLE(m.rle, m.W * m.H), capitals: m.capitals, nations, seed: $('#seed').value.trim(), name: m.name });
    } else startWorld({ type, seed: $('#seed').value.trim(), nations });
    setPaused(false);
  });
  $('#new-editor').addEventListener('click', () => { $('#modal-new').hidden = true; openEditor(); });

  // ---------- エディタ ----------
  function openEditor(fromCurrent = true) {
    app.editing = true;
    document.body.classList.add('editing');
    $('#editorbar').hidden = false;
    $('#tooltip').hidden = true;
    if (!editor.mask || !fromCurrent) {
      if (app.world) editor.load(app.world.W, app.world.H, app.world.land, []);
      else editor.load(240, 150, null, []);
    } else if (app.world && editor.sourceWorld !== app.world) {
      editor.load(app.world.W, app.world.H, app.world.land, []);
    }
    editor.sourceWorld = app.world;
    R.setDims(editor.W, editor.H);
    refit();
    syncEditorUI();
  }
  function closeEditor() {
    app.editing = false;
    document.body.classList.remove('editing');
    $('#editorbar').hidden = true;
    if (app.world) { R.setDims(app.world.W, app.world.H); refit(); }
  }
  function syncEditorUI() {
    $$('#editorbar [data-etool]').forEach(b => b.classList.toggle('on', b.dataset.etool === editor.tool));
    const lc = editor.landCount();
    $('#e-info').textContent = `陸地 ${(lc / (editor.W * editor.H) * 100).toFixed(0)}%　首都 ${editor.capitals.length}/30` +
      (editor.capitals.length >= 2 ? `（${editor.capitals.length}か国で開始）` : '（首都が2つ未満なら下の国数でランダム配置）');
  }
  $('#btn-editor').addEventListener('click', () => { if (app.editing) closeEditor(); else openEditor(); });
  $$('#editorbar [data-etool]').forEach(b => b.addEventListener('click', () => { editor.tool = b.dataset.etool; syncEditorUI(); }));
  $('#brush').addEventListener('input', () => { editor.brush = +$('#brush').value; $('#brush-v').textContent = editor.brush; });
  $('#e-nations').addEventListener('input', () => { $('#e-nations-v').textContent = $('#e-nations').value; });
  $('#e-undo').addEventListener('click', () => { editor.doUndo(); syncEditorUI(); });
  $('#e-random').addEventListener('click', () => {
    editor.pushUndo();
    const W = 240, H = 150;
    const m = TW.generateRandomLand(W, H, TW.mulberry32(TW.hashString(randomSeedText())));
    editor.load(W, H, m, []);
    R.setDims(W, H); refit(); syncEditorUI();
  });
  $('#e-earth').addEventListener('click', () => {
    const e = TW.earthLand();
    editor.load(e.W, e.H, e.land, []);
    editor.latTop = e.latTop; editor.latBottom = e.latBottom;
    R.setDims(e.W, e.H); refit(); syncEditorUI();
  });
  $('#e-clear').addEventListener('click', () => { editor.pushUndo(); editor.mask.fill(0); editor.capitals = []; editor.dirty = true; syncEditorUI(); });
  $('#e-fill').addEventListener('click', () => {
    editor.pushUndo();
    const { W, H } = editor;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) editor.mask[y * W + x] = (x > 2 && y > 2 && x < W - 3 && y < H - 3) ? 1 : 0;
    editor.dirty = true; syncEditorUI();
  });
  $('#e-save').addEventListener('click', () => {
    const name = prompt('地図の名前を入力してください', editor.name || `私の大陸 ${new Date().toLocaleDateString('ja-JP')}`);
    if (!name) return;
    try {
      TW.MapStore.save(editor.toEntry(name.slice(0, 40)));
      editor.name = name;
      toast(`💾「${name}」を保存しました`);
    } catch (e) { toast('保存に失敗しました: ' + e.message); }
  });
  $('#e-load').addEventListener('click', openLoadModal);
  function openLoadModal() {
    const list = TW.MapStore.list();
    $('#load-list').innerHTML = list.length ? list.map(m =>
      `<li><span class="nm">${escapeHtml(m.name)}<small>${m.W}×${m.H}${m.capitals && m.capitals.length ? ` 首都${m.capitals.length}` : ''}</small></span>` +
      `<button data-load="${escapeHtml(m.name)}">開く</button><button data-del="${escapeHtml(m.name)}">削除</button></li>`).join('')
      : '<li class="hint">保存した地図はまだありません。</li>';
    $('#modal-load').hidden = false;
  }
  $('#load-list').addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.load) {
      const m = TW.MapStore.get(b.dataset.load);
      if (!m) return;
      editor.load(m.W, m.H, TW.decodeRLE(m.rle, m.W * m.H), m.capitals);
      editor.name = m.name;
      R.setDims(m.W, m.H); refit(); syncEditorUI();
      $('#modal-load').hidden = true;
    } else if (b.dataset.del) {
      if (confirm(`「${b.dataset.del}」を削除しますか？`)) { TW.MapStore.remove(b.dataset.del); openLoadModal(); }
    }
  });
  $('#load-close').addEventListener('click', () => { $('#modal-load').hidden = true; });
  $('#e-export').addEventListener('click', () => {
    const entry = editor.toEntry(editor.name || 'territory-war-map');
    const blob = new Blob([JSON.stringify(entry)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (entry.name.replace(/[\\/:*?"<>|\s]+/g, '_') || 'map') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('#e-import').addEventListener('click', () => $('#e-file').click());
  $('#e-file').addEventListener('change', async () => {
    const f = $('#e-file').files[0];
    $('#e-file').value = '';
    if (!f) return;
    try {
      const m = TW.validateMap(JSON.parse(await f.text()));
      const mask = TW.decodeRLE(m.rle, m.W * m.H);
      editor.load(m.W, m.H, mask, m.capitals.filter(([x, y]) => x >= 0 && y >= 0 && x < m.W && y < m.H && mask[y * m.W + x]));
      editor.name = m.name;
      R.setDims(m.W, m.H); refit(); syncEditorUI();
      toast(`⬆「${m.name}」を読み込みました`);
    } catch (e) { toast('読み込みに失敗しました: ' + e.message); }
  });
  $('#e-start').addEventListener('click', () => {
    const lc = editor.landCount();
    if (lc < 60) { toast('陸地が少なすぎます。もう少し大陸を描いてください'); return; }
    const caps = editor.capitals.slice();
    const nations = caps.length >= 2 ? caps.length : +$('#e-nations').value;
    const isEarth = editor.W === window.EARTH_MAP.W && editor.H === window.EARTH_MAP.H;
    closeEditor();
    startWorld({
      type: 'custom', W: editor.W, H: editor.H, mask: editor.mask.slice(), capitals: caps, nations, name: editor.name,
      latTop: isEarth ? window.EARTH_MAP.latTop : 70, latBottom: isEarth ? window.EARTH_MAP.latBottom : -70,
    });
    setPaused(false);
  });
  $('#e-close').addEventListener('click', closeEditor);

  // ---------- 神の手 ----------
  $$('#godbar [data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  function setTool(t) {
    app.tool = t; R.tool = t;
    $$('#godbar [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    canvas.classList.toggle('tool', t !== 'look');
  }

  function handleClick(sx, sy) {
    TW.Audio.unlock();
    const c = R.screenToCell(sx, sy);
    if (app.editing) {
      if (editor.tool === 'capital' || editor.tool === 'erase') {
        const err = editor.clickCapital(c.cx, c.cy);
        if (err) toast(err);
        syncEditorUI();
      }
      return;
    }
    const sim = app.sim;
    if (!sim || c.i < 0) { if (app.tool === 'look') select(null); return; }
    const o = sim.w.land[c.i] ? sim.owner[c.i] : -1;
    switch (app.tool) {
      case 'look':
        if (o >= 0) select(sim.nations[o].uid); else select(null);
        break;
      case 'plague': sim.godPlague(c.fx - 0.5, c.fy - 0.5); TW.Audio.play('plague'); break;
      case 'disaster': sim.godDisaster(c.fx - 0.5, c.fy - 0.5); TW.Audio.play('disaster'); break;
      case 'bless':
        if (o >= 0 && sim.godBless(o)) TW.Audio.play('bless'); else toast('祝福する国の領土をクリックしてください');
        break;
      case 'incite': {
        const err = sim.godIncite(c.fx - 0.5, c.fy - 0.5);
        if (err) toast(err);
        break;
      }
    }
    updatePanels(true);
  }

  // ---------- 入力 ----------
  const pointers = new Map();
  let drag = null, pinch = null, spaceHeld = false;

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    TW.Audio.unlock();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      if (drag && drag.paint) editor.endStroke();
      drag = null;
      return;
    }
    const paintTool = app.editing && (editor.tool === 'land' || editor.tool === 'sea') && e.button === 0 && !spaceHeld;
    drag = { sx: e.offsetX, sy: e.offsetY, lx: e.offsetX, ly: e.offsetY, moved: false, paint: paintTool, touch: e.pointerType !== 'mouse' };
    if (paintTool) {
      editor.pushUndo();
      const c = R.screenToCell(e.offsetX, e.offsetY);
      editor.strokeTo(c.fx, c.fy);
    }
  });
  canvas.addEventListener('pointermove', e => {
    R.mouse = { x: e.offsetX, y: e.offsetY };
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      R.cam.x -= (mx - pinch.mx) / R.cam.z; R.cam.y -= (my - pinch.my) / R.cam.z;
      R.zoomAt(mx, my, d / Math.max(1, pinch.d));
      comm.userMoved();
      pinch = { d, mx, my };
      return;
    }
    if (drag) {
      const dx = e.offsetX - drag.lx, dy = e.offsetY - drag.ly;
      if (Math.abs(e.offsetX - drag.sx) + Math.abs(e.offsetY - drag.sy) > 5) drag.moved = true;
      if (drag.paint) {
        const c = R.screenToCell(e.offsetX, e.offsetY);
        editor.strokeTo(c.fx, c.fy);
      } else if (drag.moved) {
        R.cam.x -= dx / R.cam.z; R.cam.y -= dy / R.cam.z; R.clampCam();
        canvas.classList.add('dragging');
        comm.userMoved();
      }
      drag.lx = e.offsetX; drag.ly = e.offsetY;
    } else if (!app.editing) updateTooltip(e.offsetX, e.offsetY);
  });
  const endPointer = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && pointers.size === 0) {
      if (drag.paint) { editor.endStroke(); syncEditorUI(); }
      else if (!drag.moved && e.type === 'pointerup') {
        handleClick(e.offsetX, e.offsetY);
        // タッチ操作ではタップした場所の情報を数秒表示
        if (drag.touch && !app.editing && app.tool === 'look') {
          updateTooltip(e.offsetX, e.offsetY);
          clearTimeout(app.tipTimer);
          app.tipTimer = setTimeout(() => { $('#tooltip').hidden = true; }, 3000);
        }
      } else if (drag.moved && drag.touch) $('#tooltip').hidden = true;
      drag = null;
      canvas.classList.remove('dragging');
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', e => { R.mouse = null; if (e.pointerType === 'mouse') $('#tooltip').hidden = true; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    R.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    comm.userMoved();
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); if (app.editing) spaceHeld = true; else setPaused(!app.paused); }
    else if (/^Digit[1-7]$/.test(e.code) && !app.editing) setSpeed(+e.code.slice(5) - 1);
    else if (e.key === '+' || e.key === '=') R.zoomAt(R.cw / 2, R.ch / 2, 1.25);
    else if (e.key === '-') R.zoomAt(R.cw / 2, R.ch / 2, 0.8);
    else if (e.key === 'Escape') { setTool('look'); $$('.modal').forEach(m => m.hidden = true); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && app.editing) { e.preventDefault(); editor.doUndo(); syncEditorUI(); }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') spaceHeld = false; });

  function updateTooltip(sx, sy) {
    const tip = $('#tooltip');
    const sim = app.sim;
    if (!sim) { tip.hidden = true; return; }
    const c = R.screenToCell(sx, sy);
    if (c.i < 0) { tip.hidden = true; return; }
    const w = sim.w;
    const t = TW.TERRAIN[w.terrain[c.i]];
    let html = '';
    if (w.land[c.i]) {
      const o = sim.owner[c.i];
      if (o >= 0) { const n = sim.nations[o]; html += `<b><span class="sw" style="background:${n.css}"></span>${escapeHtml(n.name)}</b><br>`; }
      else html += '<b>未開の地</b><br>';
      const ft = sim.forts.find(f => Math.abs(f.x - c.cx) <= 1 && Math.abs(f.y - c.cy) <= 1);
      if (ft) html += `🏯 ${escapeHtml(ft.name)}（守備 ${Math.round(ft.hp / ft.maxHp * 100)}%）<br>`;
      const bf = sim.battlefields.find(b => Math.abs(b.x - c.cx) <= 1 && Math.abs(b.y - c.cy) <= 1);
      if (bf) html += `⚔ 古戦場: ${escapeHtml(bf.name)}（${bf.year}年）<br>`;
      const rl = TW.roadLevel(sim.road[c.i]);
      html += `${t.name}${w.river[c.i] ? '・川' : ''}${rl ? '・' + TW.ROAD_NAMES[rl] : ''}`;
      // 近くの都市
      let city = null, bd = 2.3;
      for (const ct of sim.cities) { const d = Math.hypot(ct.x - c.fx + 0.5, ct.y - c.fy + 0.5); if (d < bd) { bd = d; city = ct; } }
      if (city) {
        html += `<br>${city.capital ? '👑 首都' : '🏘 都市'} <b>${escapeHtml(city.name)}</b> 人口${city.pop.toFixed(1)}万`;
        const bl = TW.buildingsOf(city.dev);
        html += `<br>発展度 ${city.dev.toFixed(1)} ${bl.map(b => b.icon).join('')}`;
        if (city.nat) html += `<br>🌿 世界自然遺産 — ${escapeHtml(city.natDesc)}`;
        const wd = sim.wonders.find(x => x.city === city.id && x.state !== 'none');
        if (wd) html += `<br>${wd.state === 'built' ? wd.icon + ' 世界の驚異「' + escapeHtml(wd.name) + '」' : '🏚️ ' + escapeHtml(wd.name) + 'の遺跡'}`;
        if (city.besieged >= sim.t - 3) html += `<br><span style="color:#a51c12">攻囲中 — 守備 ${Math.max(0, city.defense / sim.maxDefense(city) * 100).toFixed(0)}%</span>`;
      }
    } else html = t.name;
    for (const a of sim.armies) {
      const [ax, ay] = R.armyPos(a);
      if (Math.hypot(ax / R.S - c.fx, ay / R.S - c.fy) < 1.3) {
        const n = sim.nations[a.n];
        const mode = { attack: '進軍中', chase: '追撃中', siege: '攻囲中', home: '帰還中', idle: '待機' }[a.mode] || '';
        html += `<br>🚩 ${escapeHtml(n.name)}軍 ${TW.fmtTroops(a.str)}${a.gen ? '（' + escapeHtml(sim.genName(a.gen)) + ' ' + a.gen.wins + '勝）' : ''} 質×${sim.quality(a.n).toFixed(2)} ${a.fighting ? '<b style="color:#a51c12">交戦中</b>' : mode}`;
      }
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const r = canvas.getBoundingClientRect();
    tip.style.left = Math.min(sx + 14, r.width - tip.offsetWidth - 6) + 'px';
    tip.style.top = Math.min(sy + 14, r.height - tip.offsetHeight - 6) + 'px';
  }

  let lastLayout = '';
  const layoutKey = () => (isCompact() ? 'c' : 'd') + (window.innerWidth > window.innerHeight ? 'L' : 'P');
  function onResize() {
    const z = R.cam.z;
    R.resize();
    if (!R.WW) return;
    const key = layoutKey();
    if (key !== lastLayout) {
      // 画面の向きやレイアウトが変わったら地図を合わせ直す
      if (lastLayout && isCompact()) document.body.classList.add('panel-hidden');
      lastLayout = key;
      requestAnimationFrame(() => { R.resize(); refit(); });
    } else { R.minZ = Math.min(R.cw / R.WW, R.ch / R.WH) * 0.6; R.cam.z = z; R.clampCam(); }
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));

  // ---------- ループ ----------
  let lastT = performance.now();
  function loop(now) {
    const dt = Math.min(0.25, (now - lastT) / 1000);
    lastT = now;
    const sim = app.sim;
    if (sim && !app.paused && !app.editing) {
      app.acc += dt * TPS * SPEEDS[app.speed];
      const t0 = performance.now();
      while (app.acc >= 1) {
        sim.step();
        app.acc -= 1;
        if (performance.now() - t0 > 22) { app.acc = Math.min(app.acc, 2); break; }
      }
      if (now - (app.moodAt || 0) > 2000) {
        // 戦争中の国の割合でBGMの雰囲気を変える
        app.moodAt = now;
        const al = sim.aliveNations();
        TW.Audio.setMood(al.length ? al.filter(n => n.wars > 0).length / al.length : 0);
      }
      updatePanels(false);
    }
    if (sim) $('#date').textContent = `暦 ${sim.year()}年 ${sim.month()}月`;
    if (sim && !app.editing) comm.update(sim, now, !app.paused);
    R.draw(now, app.editing ? editor : null);
    requestAnimationFrame(loop);
  }

  // ---------- 起動 ----------
  function parseHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const map = p.get('map');
    const n = TW.clamp(parseInt(p.get('n') || '8', 10) || 8, 2, 30);
    return { type: map === 'earth' ? 'earth' : 'random', seed: p.get('seed') || '', nations: n };
  }
  const init = parseHash();
  app.settings.nations = init.nations;
  if (isCompact()) document.body.classList.add('panel-hidden');
  lastLayout = layoutKey();
  const go = () => { startWorld(init); requestAnimationFrame(loop); };
  if (document.fonts && document.fonts.ready) {
    Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]).then(go);
  } else go();
})();
