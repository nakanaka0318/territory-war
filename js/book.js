'use strict';
// ゲーム内で読める歴史書
TW.HistoryBook = (function () {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const num = k => (k <= 10 ? KANJI[k - 1] : k < 20 ? '十' + KANJI[k - 11] : k < 100 ? KANJI[Math.floor(k / 10) - 1] + '十' + (k % 10 ? KANJI[k % 10 - 1] : '') : String(k));
  const ICON = { threat: '⚠️', coalition: '⚔', op: '🎯', general: '🎖️', nature: '🌿', war: '⚔️', peace: '🕊️', alliance: '🤝', capture: '🏰', capital: '👑', destroy: '💀', rebel: '🔥', battle: '🗡️', god: '✨', betray: '🐍', era: '📜', culture: '🎭', wonder: '🏛️', poem: '🪕' };
  const RANK = { threat: 7, coalition: 5, op: 3, general: 4, nature: 2, capital: 6, destroy: 6, wonder: 5, betray: 5, rebel: 4, culture: 3, god: 3, battle: 3, war: 2, peace: 1, alliance: 1 };

  function chapters(sim) {
    const now = sim.year();
    const BLOCK = 40;
    const blocks = [];
    for (let s = 1; s <= now; s += BLOCK) {
      const e = Math.min(now, s + BLOCK - 1);
      const snaps = sim.eraSnaps.filter(x => x.year >= s && x.year <= e);
      const ev = sim.annals.filter(x => x.year >= s && x.year <= e);
      const count = new Map();
      let shareSum = 0, warsSum = 0;
      for (const sn of snaps) {
        if (sn.top) count.set(sn.top.uid, (count.get(sn.top.uid) || 0) + 1);
        warsSum += sn.wars;
      }
      let dom = null, dc = 0;
      for (const [u, c] of count) if (c > dc) { dc = c; dom = u; }
      const domSnaps = snaps.filter(x => x.top && x.top.uid === dom);
      for (const sn of domSnaps) shareSum += sn.top.share;
      const domShare = domSnaps.length ? shareSum / domSnaps.length : 0;
      const domName = domSnaps.length ? domSnaps[domSnaps.length - 1].top.name : null;
      const turmoil = ev.filter(x => x.type === 'destroy' || x.type === 'rebel').length;
      const wars = snaps.length ? warsSum / snaps.length : 0;
      let title;
      const th = (sim.threatHistory || []).find(t => t.start >= s && t.start <= e);
      if (s === 1) title = '建国の時代';
      else if (th) title = `${th.name}の災厄`;
      else if (domName && domShare > 0.3 && dc >= snaps.length * 0.6) title = `${domName}の覇権`;
      else if (turmoil > 14) title = '動乱の時代';
      else if (wars < 1.5) title = '平和と繁栄の時代';
      else title = '群雄割拠の時代';
      blocks.push({ s, e, title, dom: domName, domShare, ev, turmoil, wars });
    }
    // 同じ題の連続する時代をまとめる
    const out = [];
    for (const b of blocks) {
      const last = out[out.length - 1];
      if (last && last.title === b.title) { last.e = b.e; last.ev = last.ev.concat(b.ev); last.turmoil += b.turmoil; }
      else out.push({ ...b });
    }
    return out;
  }

  function narrative(sim, ch) {
    const founded = sim.allNations.filter(n => { const y = Math.floor(n.founded / TW.TPY) + 1; return y >= ch.s && y <= ch.e; }).length;
    const fallen = ch.ev.filter(e => e.type === 'destroy').length;
    const wonders = ch.ev.filter(e => e.type === 'wonder' && /完成/.test(e.text)).map(e => (e.text.match(/「(.+?)」/) || [])[1]).filter(Boolean);
    const parts = [];
    if (ch.s === 1) parts.push('暦の始まり、未開の大地に国々が産声を上げ、我先にと領土を広げていった。');
    if (ch.dom && ch.domShare > 0.12) parts.push(`この時代、最大の勢力を誇ったのは${esc(ch.dom)}で、大地のおよそ${Math.round(ch.domShare * 100)}%を治めた。`);
    parts.push(`${founded}の国が興り、${fallen}の国が滅んだ。`);
    if (ch.wars >= 4) parts.push('戦火は絶えることがなく、各地で城が落ち、国境が塗り替えられた。');
    else if (ch.wars < 1.5) parts.push('大きな戦は少なく、都市は栄え、街道を人と物が行き交った。');
    if (wonders.length) parts.push(`この時代に${wonders.map(w => '「' + esc(w) + '」').join('、')}が築かれた。`);
    return parts.join('');
  }

  function poemHtml(p) {
    return `<figure class="poem"><figcaption>🪕 ${esc(p.title)} <small>(${p.year}年)</small></figcaption>${p.lines.map(l => `<div>${esc(l)}</div>`).join('')}</figure>`;
  }

  function build(sim, worldName) {
    const now = sim.year();
    const alive = sim.aliveNations().sort((a, b) => b.cells - a.cells);
    const chs = chapters(sim);
    let toc = '', body = '';
    chs.forEach((ch, k) => {
      const id = 'ch' + (k + 1);
      const current = k === chs.length - 1;
      toc += `<li><a href="#${id}">第${num(k + 1)}章 ${esc(ch.title)}</a> <small>${ch.s}〜${current ? '現在' : ch.e + '年'}</small></li>`;
      const evs = ch.ev.filter(e => RANK[e.type] && (e.type !== 'wonder' || /完成|奪取|崩れ/.test(e.text)))
        .sort((a, b) => (RANK[b.type] - RANK[a.type]) || a.year - b.year);
      const perType = {};
      const picked = [];
      for (const e of evs) {
        perType[e.type] = (perType[e.type] || 0) + 1;
        if (perType[e.type] <= 4) picked.push(e);
        if (picked.length >= 14) break;
      }
      picked.sort((a, b) => a.seq - b.seq);
      const poems = sim.poems.filter(p => p.year >= ch.s && p.year <= ch.e).slice(-3);
      body += `<section id="${id}"><h2><span class="no">第${num(k + 1)}章</span>${esc(ch.title)}</h2>` +
        `<p class="span">暦${ch.s}年〜${current ? `${now}年（現在）` : ch.e + '年'}</p>` +
        `<p class="nar">${narrative(sim, ch)}</p>` +
        (picked.length ? `<ul class="ev">${picked.map(e => `<li><b>${e.year}年</b> ${ICON[e.type] || ''} ${esc(e.text)}</li>`).join('')}</ul>` : '') +
        poems.map(poemHtml).join('') + '</section>';
    });
    // 大国の興亡
    const greats = sim.allNations.slice().sort((a, b) => b.peakCells - a.peakCells).slice(0, 12);
    const greatHtml = greats.map(n => {
      const fy = Math.floor(n.founded / TW.TPY) + 1;
      const end = n.alive ? '存続中' : `${Math.floor(n.deadAt / TW.TPY) + 1}年 滅亡`;
      const maxEra = TW.ERAS[n.maxEra || n.era || 0].name;
      return `<tr><td><span class="sw" style="background:${n.css}"></span>${esc(n.name)}${n.parentName ? `<small>（${esc(n.parentName)}より独立）</small>` : ''}</td>` +
        `<td>${fy}年〜${end}</td><td>${(n.peakCells / sim.landCount * 100).toFixed(1)}%</td><td>${n.citiesTaken}</td><td>${maxEra}</td></tr>`;
    }).join('');
    // 驚異
    const wonderHtml = sim.wonders.map(w => {
      let st;
      if (w.state === 'none') st = '<span class="dim">まだ誰も築いていない</span>';
      else {
        const c = sim.cities[w.city];
        const o = c.owner >= 0 ? sim.nations[c.owner] : null;
        st = w.state === 'built'
          ? `${w.builtYear}年、${esc(w.builder)}が${esc(c.name)}に建立。現在の所有: ${o ? esc(o.name) : 'なし'}`
          : `${esc(c.name)}に遺跡が残る（${w.builtYear}年に${esc(w.builder)}が建立）`;
      }
      return `<li><span class="wi">${w.state === 'ruin' ? '🏚️' : w.icon}</span><div><b>${esc(w.name)}</b> <small>${esc(w.desc)}</small><br>${st}</div></li>`;
    }).join('');
    const gens = sim.generals.slice().sort((a, b) => (b.wins + b.cities * 2 + b.forts) - (a.wins + a.cities * 2 + a.forts)).slice(0, 12);
    const fateText = g => g.fate === 'active' ? '現役' : g.fate === 'dead' ? `${g.died}年 ${esc(g.deathPlace || '')}にて戦死` : g.fate === 'retired' ? `${g.died}年 引退` : `${g.died}年 祖国滅亡`;
    const genHtml = gens.length ? gens.map(g => `<tr><td><b>${esc(sim.genName(g))}</b><br><small><span class="sw" style="background:${g.css}"></span>${esc(g.nation)}</small></td>` +
      `<td>${g.wins}勝${g.losses}敗</td><td>${g.cities}都市・${g.forts}砦</td><td>${g.best ? esc(g.best) : '—'}</td><td>${g.born}年〜 ${fateText(g)}</td></tr>`).join('') : '';
    const natHtml = sim.cities.filter(c => c.nat).map(c => {
      const o = c.owner >= 0 ? sim.nations[c.owner] : null;
      return `<li><span class="wi">${c.icon}</span><div><b>${esc(c.name)}</b> <small>${esc(c.natDesc)}</small><br>${o ? '現在の所有: ' + esc(o.name) : '<span class="dim">いまだ人の手の及ばぬ地</span>'}</div></li>`;
    }).join('');
    const bfs = sim.battlefields.slice().sort((a, b) => b.total - a.total).slice(0, 10);
    const bfHtml = bfs.map(b => {
      const rep = b.reportId && sim.battleReport ? sim.battleReport(b.reportId) : null;
      const how = rep && rep.winner >= 0 ? `。${rep.sides[rep.winner].nations.map(v => esc(v.name)).join('・')}が勝利 —「${esc(rep.factors[0] || '')}」` : '';
      return `<li><b>${esc(b.name)}</b>（${b.year}年）— 両軍あわせて${TW.fmtTroops(b.total)}が激突${how}${b.count > 1 ? `、その後も${b.count - 1}度の戦いの舞台に` : ''}</li>`;
    }).join('');
    const nowHtml = alive.slice(0, 6).map((n, k) => `<li>${k + 1}. <span class="sw" style="background:${n.css}"></span>${esc(n.name)} — 領土${(n.cells / sim.landCount * 100).toFixed(1)}%・都市${n.cityCount}・${TW.ERAS[n.era].name}</li>`).join('');
    const poemsAll = sim.poems.slice(-24).reverse().map(poemHtml).join('') || '<p class="dim">まだ歌は生まれていない。</p>';
    return `<div class="book-inner">
      <header class="bk-head"><div class="orn">❦</div><h1>${esc(worldName)}年代記</h1>
        <p>暦1年〜${now}年　興りし国 ${sim.allNations.length}・現存 ${alive.length}・吟遊詩 ${sim.poems.length}</p><div class="orn">❦</div></header>
      <nav class="toc"><h3>目次</h3><ol>${toc}<li><a href="#bk-greats">大国の興亡</a></li><li><a href="#bk-generals">名将列伝</a></li><li><a href="#bk-battles">古戦場</a></li><li><a href="#bk-nature">世界自然遺産</a></li><li><a href="#bk-wonders">世界の驚異</a></li><li><a href="#bk-poems">吟遊詩人の歌</a></li><li><a href="#bk-now">今の世界</a></li></ol></nav>
      ${body}
      <section id="bk-greats"><h2>大国の興亡</h2><table class="gt"><thead><tr><th>国</th><th>在位</th><th>最大版図</th><th>攻略都市</th><th>文化の頂点</th></tr></thead><tbody>${greatHtml}</tbody></table></section>
      ${(sim.threatHistory.length || sim.coalitionHistory.length) ? `<section id="bk-threats"><h2>世界の脅威と大同盟</h2><ul class="ev">${
        sim.threatHistory.map(t => `<li>${t.icon} <b>${esc(t.name)}</b>（${t.start}年〜${t.end}年）— ${t.hero ? esc(t.hero) + (t.gen ? 'の' + esc(t.gen) : '') + 'が討伐' : '討伐'}${t.kills ? `・焼かれた都市${t.kills}` : ''}</li>`).join('')}${
        sim.coalitionHistory.map(c => `<li>⚔ <b>${esc(c.name)}</b>（${c.start}年〜${c.end}年）— ${c.members.length}か国が${esc(c.target)}を包囲、${c.result === '成功' ? '覇権を抑え込んだ' : '覇権国は耐え抜いた'}</li>`).join('')}</ul></section>` : ''}
      <section id="bk-generals"><h2>名将列伝</h2>${genHtml ? `<table class="gt"><thead><tr><th>将軍</th><th>戦績</th><th>攻略</th><th>名高き戦い</th><th>生涯</th></tr></thead><tbody>${genHtml}</tbody></table>` : '<p class="dim">まだ名将は現れていない。</p>'}</section>
      <section id="bk-battles"><h2>古戦場</h2>${bfHtml ? `<ul class="ev">${bfHtml}</ul>` : '<p class="dim">まだ大会戦は起きていない。</p>'}</section>
      <section id="bk-nature"><h2>世界自然遺産</h2><ul class="wl">${natHtml}</ul></section>
      <section id="bk-wonders"><h2>世界の驚異</h2><ul class="wl">${wonderHtml}</ul></section>
      <section id="bk-poems"><h2>吟遊詩人の歌</h2>${poemsAll}</section>
      <section id="bk-now"><h2>今の世界</h2><p>暦${now}年、世界には${alive.length}の国がある。</p><ol class="nowl">${nowHtml}</ol></section>
      <p class="fin">— 歴史はなおも続く —</p>
    </div>`;
  }
  return { build };
})();
