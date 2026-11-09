'use strict';
// 実況モード: 状況をわかりやすく解説するテロップと自動カメラ
TW.Commentary = (function () {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const KEY = 'tw-commentary';

  class Commentary {
    constructor(R, el) {
      this.R = R;
      this.el = el;
      this.txt = el.querySelector('.txt');
      this.who = el.querySelector('.who');
      const st = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })();
      this.enabled = st.enabled ?? true;
      this.autoCam = st.autoCam ?? false;
      this.queue = [];
      this.current = null;
      this.until = 0;
      this.lastLine = 0;
      this.lastLocated = 0;
      this.lastAnalyze = 0;
      this.holdUntil = 0;
      this.seen = new Map();
      this.reset();
    }
    save() { try { localStorage.setItem(KEY, JSON.stringify({ enabled: this.enabled, autoCam: this.autoCam })); } catch (e) { /* noop */ } }
    setEnabled(v) { this.enabled = v; this.save(); if (!v) { this.el.hidden = true; this.queue = []; this.current = null; } }
    setAutoCam(v) { this.autoCam = v; this.save(); if (!v) this.R.camTarget = null; else this.holdUntil = 0; }
    // ユーザーが地図を操作したらしばらく自動カメラを止める
    userMoved() { this.holdUntil = performance.now() + 15000; this.R.camTarget = null; }
    reset() {
      this.queue = []; this.current = null; this.until = 0;
      this.lastSummaryYear = 0; this.trend = new Map(); this.trendYear = 0;
      this.seen.clear();
      this.el.hidden = true;
    }

    push(text, pri, pos, who = '🎙 実況') {
      if (!this.enabled) return;
      this.queue.push({ text, pri, x: pos && pos.x != null ? pos.x : null, y: pos && pos.y != null ? pos.y : null, at: performance.now(), who });
      if (this.queue.length > 12) {
        this.queue.sort((a, b) => b.pri - a.pri || b.at - a.at);
        this.queue.length = 8;
      }
    }

    names(sim, e) { return (e.ns || []).map(u => sim.nationByUid(u)).filter(Boolean); }

    // ---------- 出来事への実況 ----------
    onEvent(e, sim) {
      if (!this.enabled) return;
      const ns = this.names(sim, e);
      const a = ns[0] ? ns[0].name : '', b = ns[1] ? ns[1].name : '';
      const pos = e.x != null ? { x: e.x, y: e.y } : null;
      switch (e.type) {
        case 'war': {
          if (!e.major && Math.random() < 0.5 && !/宣戦布告/.test(e.text)) return;
          const A = ns[0], B = ns[1];
          let tail = '';
          if (A && B) {
            const ra = (A.strength + 1) / (B.strength + 1);
            tail = ra > 1.8 ? `兵力では${a}が約${ra.toFixed(1)}倍と圧倒的、短期決戦になるか？`
              : ra < 0.6 ? `なんと兵力では${b}の方が上！${a}、大胆な賭けに出ました！`
                : '戦力はほぼ互角、長い戦いになりそうです！';
          }
          if (/参戦/.test(e.text)) this.push(`${a}が同盟に応えて参戦！戦火が広がっていきます！`, 2, pos);
          else if (/海を越えて/.test(e.text)) this.push(`なんと${a}が海を越えて${b}に宣戦布告！大艦隊による遠征が始まります！`, 4, pos);
          else this.push(pick([`おっと！${a}が${b}に宣戦布告！`, `${a}、ついに動いた！標的は${b}です！`, `戦争です！${a}対${b}！`]) + ' ' + tail, e.major ? 4 : 3, pos);
          break;
        }
        case 'capital': {
          const m = e.text.match(/首都(.+?)が/);
          const city = m ? m[1] : '首都';
          this.push(pick([`${city}陥落！${b}の首都が${a}の手に落ちました！これは大きい！`, `首都${city}に${a}の旗が翻る！${b}は遷都を余儀なくされました！`]), 5, pos);
          break;
        }
        case 'destroy':
          this.push(pick([`${a}、滅亡…！一つの国の歴史がここに幕を下ろしました。`, `ああっと、${a}が地図から消えました！${b ? b + 'の勝利です！' : ''}`]), 5, pos);
          break;
        case 'rebel':
          this.push(pick([`反乱発生！${b}の地方で民衆が立ち上がりました！新国家${a}の誕生です！`, `${b}に激震！${a}が独立を宣言しました！`]), 4, pos);
          break;
        case 'betray':
          this.push(`なんと裏切り！${a}が同盟国${b}に刃を向けました！これは誰も予想できない！`, 5, pos);
          break;
        case 'peace':
          this.push(pick([`${a}と${b}が停戦。束の間の平和が訪れます。`, `戦いに疲れた${a}と${b}、ここで矛を収めました。`]), 2, pos);
          break;
        case 'alliance':
          if (/締結/.test(e.text)) this.push(`${a}と${b}が手を結びました！周辺国は警戒を強めるでしょう。`, 2, pos);
          else this.push(`${a}と${b}の同盟が解消。関係が冷え込んでいます。`, 1, pos);
          break;
        case 'battle':
          if (e.major) this.push(`決着！${e.text.replace(/:.*/, '')}は${a}の勝利！決め手は「${(e.text.split(' — ')[1] || '激戦の末')}」！`, 3, pos);
          break;
        case 'culture':
          if (e.major) this.push(`${a}が文化の新時代へ！兵の質も上がり、ますます手強くなります。`, 2, pos);
          break;
        case 'wonder':
          if (/完成/.test(e.text)) this.push(`歴史的瞬間です！${e.text.replace(/!$/, '')}！世界にただ一つの驚異です！`, 4, pos);
          else if (/奪取/.test(e.text)) this.push(`${a}が世界の驚異を奪い取った！${b}にとっては痛恨の極み！`, 4, pos);
          else if (/崩れ/.test(e.text)) this.push(`なんということだ…世界の驚異が崩れ落ちました。`, 4, pos);
          else if (/建設を始めた|再建を始めた/.test(e.text)) this.push(`${a}が大事業に着手！世界の驚異の建設が始まりました。`, 1, pos);
          else if (/先を越され/.test(e.text)) this.push(`惜しい！${a}は驚異の建設競争に敗れました。`, 1, pos);
          break;
        case 'god':
          this.push(`神の御業か！${e.text}！`, 4, pos);
          break;
        case 'op':
          if (/成功/.test(e.text)) this.push(`作戦成功！${e.text.replace(/ — .*/, '')}、見事に目標を攻略しました！`, 4, pos);
          else this.push(`${a}が作戦を発動！${e.text.replace(/^.*?が/, '')}。地図上の赤い矢印に注目です！`, 3, pos);
          break;
        case 'general':
          this.push(`ああっと…${e.text}。一つの伝説が終わりました。`, 4, pos);
          break;
        case 'army':
          if (/合流/.test(e.text)) this.push(`${e.text}！これは手強い！`, 2, pos);
          else this.push(`${e.text}。二方面から攻め立てる構えです！`, 2, pos);
          break;
        case 'siege':
          if (/降伏/.test(e.text)) this.push(`${e.text}！長い包囲の末、ついに兵糧が尽きました！`, 3, pos);
          else if (Math.random() < 0.5) this.push(`${e.text}！城内で激しい戦いです！`, 3, pos);
          break;
        case 'battlestart':
          this.push(`さあ大会戦です！${e.text.replace(/が始まった — /, '、')}！両軍が布陣を終え、まもなく矢の応酬が始まります！`, 3, pos);
          break;
        case 'ambush':
          this.push(`伏兵だ！${e.text.replace(/^.*?: /, '')}　待ち構えていた軍が一斉に襲いかかります！`, 3, pos);
          break;
        case 'reinforce':
          this.push(`${e.text}！援軍の到着で戦況が変わるか！`, 2, pos);
          break;
        case 'fort':
          if (/陥落/.test(e.text)) this.push(`${e.text}！これで道が開けました！`, 3, pos);
          else if (Math.random() < 0.3) this.push(`${e.text}。容易には突破できない要衝です。`, 1, pos);
          break;
        case 'nature':
          this.push(`${e.text}！大自然の恵みが国を潤します。`, 2, pos);
          break;
        case 'threat':
          if (/出現/.test(e.text)) this.push(`緊急事態です！${e.text.replace(/^.*?— /, '').replace(/!.*$/, '')}！各国は互いに争いながらも、この脅威に立ち向かいます！`, 6, pos);
          else if (/討たる/.test(e.text)) this.push(`やりました！${e.text.replace(/^\S+ /, '')}！世界に平和が戻ります！`, 6, pos);
          else if (e.major) this.push(`${e.text}！なんという惨状でしょう！`, 4, pos);
          else if (Math.random() < 0.4) this.push(`${e.text}…被害が広がっています！`, 3, pos);
          break;
        case 'coalition':
          if (/結成/.test(e.text)) this.push(`包囲網です！${e.text}`, 5, pos);
          else this.push(e.text, 3, pos);
          break;
        case 'poem':
          if (e.poem) this.push(`「${e.poem.lines[0]}／${e.poem.lines[1]}」— ${e.poem.title}`, 2, pos, '🪕 吟遊詩人');
          break;
      }
    }

    // ---------- 定期的な状況分析 ----------
    analyze(sim, now) {
      const yr = sim.year();
      const alive = sim.aliveNations();
      // 首都の攻囲
      for (const c of sim.cities) {
        if (!c.capital || c.besieged < sim.t - 3 || c.owner < 0) continue;
        const key = 'siege' + c.id;
        if (now - (this.seen.get(key) || -1e9) < 60000) continue;
        this.seen.set(key, now);
        const n = sim.nations[c.owner];
        const pct = Math.max(0, Math.round(c.defense / sim.maxDefense(c) * 100));
        this.push(`${n.name}の首都${c.name}が包囲されています！守備は残り${pct}%、持ちこたえられるか！`, 3, c);
      }
      // 大軍の集結
      const groups = new Map();
      for (const a of sim.armies) {
        if (!a.target || a.target.type !== 'city' || (a.mode !== 'attack' && a.mode !== 'siege')) continue;
        const k = a.n + ':' + a.target.id;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(a);
      }
      for (const [k, list] of groups) {
        if (list.length < 3) continue;
        if (now - (this.seen.get('mass' + k) || -1e9) < 45000) continue;
        this.seen.set('mass' + k, now);
        const n = sim.nations[list[0].n], c = sim.cities[list[0].target.id];
        const total = list.reduce((s, a) => s + a.str, 0);
        this.push(`${n.name}の${list.length}個軍団、総勢${TW.fmtTroops(total)}が${c.name}を目指して進軍中！`, 3, c);
      }
      // 勢力の増減
      if (yr - this.trendYear >= 10) {
        if (this.trendYear) {
          let up = null, down = null;
          for (const n of alive) {
            const before = this.trend.get(n.uid);
            if (!before || before < 30) continue;
            const r = n.cells / before;
            if (r > 1.6 && n.cells > sim.landCount * 0.04 && (!up || r > up.r)) up = { n, r };
            if (r < 0.6 && (!down || r < down.r)) down = { n, r };
          }
          if (down) this.push(`${down.n.name}、苦境です！この10年で領土の${Math.round((1 - down.r) * 100)}%を失いました！`, 2, sim.cities[down.n.capital]);
          if (up) this.push(`${up.n.name}が急拡大中！この10年で領土を${up.r.toFixed(1)}倍に広げています！`, 2, sim.cities[up.n.capital]);
        }
        this.trend = new Map(alive.map(n => [n.uid, n.cells]));
        this.trendYear = yr;
      }
      // 勢力図のまとめ
      if (yr - this.lastSummaryYear >= 15 && yr > 3) {
        this.lastSummaryYear = yr;
        const s = alive.slice().sort((a, b) => b.cells - a.cells);
        if (s.length >= 2) {
          const p1 = s[0].cells / sim.landCount * 100, p2 = s[1].cells / sim.landCount * 100;
          const wars = alive.filter(n => n.wars > 0).length;
          const lead = p1 - p2 > 10 ? `頭一つ抜けています。` : `激しく競り合っています！`;
          this.push(`暦${yr}年の勢力図です。首位は${s[0].name}（${p1.toFixed(0)}%）、2位${s[1].name}（${p2.toFixed(0)}%）が${lead}現在${alive.length}か国、うち${wars}か国が交戦中。`, 1, null);
        }
      }
      // 静かなとき
      if (now - this.lastLine > 14000 && !this.queue.length) {
        const opts = [];
        for (const n of alive) {
          if (n.project) {
            const w = sim.wonders.find(x => x.key === n.project.key);
            opts.push([`${n.name}では「${w.name}」の建設が進んでいます（${Math.min(99, Math.round(n.project.progress / n.project.need * 100))}%）。完成すれば世界の驚異です。`, sim.cities[n.project.city]]);
          }
        }
        const rich = alive.slice().sort((a, b) => b.era - a.era || b.culture - a.culture)[0];
        if (rich) opts.push([`文化の最先端は${rich.name}、${TW.ERAS[rich.era].name}を迎えています。兵の質は×${sim.quality(rich.id).toFixed(2)}！`, sim.cities[rich.capital]]);
        const peace = alive.filter(n => n.wars === 0).length;
        if (peace === alive.length) opts.push([`現在、世界に戦火はありません。各国は内政に励んでいます。嵐の前の静けさか…？`, null]);
        let best = -1, bi = -1;
        for (const i of sim.w.landCells) if (sim.road[i] > best) { best = sim.road[i]; bi = i; }
        if (best >= TW.ROAD_LV[2]) {
          const W = sim.w.W, c = sim.nearestCity(bi % W, (bi / W) | 0, 30);
          if (c) opts.push([`${c.name}付近の街道は、軍勢が行き交ううちに石畳の大街道になりました。進軍も交易も速くなります。`, c]);
        }
        if (opts.length) { const [t, pos] = pick(opts); this.push(t, 0, pos); }
      }
    }

    // ---------- 毎フレーム ----------
    update(sim, now, running) {
      if (!this.enabled && !this.autoCam) return;
      if (this.enabled && running && now - this.lastAnalyze > 2500) { this.lastAnalyze = now; this.analyze(sim, now); }
      if (this.enabled) {
        if (this.current && now > this.until) { this.el.classList.add('out'); this.current = null; }
        if (!this.current && this.queue.length && now > this.until + 350) {
          this.queue = this.queue.filter(q => now - q.at < (q.pri >= 4 ? 16000 : 9000));
          this.queue.sort((a, b) => b.pri - a.pri || b.at - a.at);
          const q = this.queue.shift();
          if (q) this.show(q, now);
        }
      }
      // 自動カメラ
      if (this.autoCam && now > this.holdUntil && running) {
        if (now - this.lastLocated > 16000 && !this.R.camTarget) {
          this.lastLocated = now;
          let hot = null;
          for (const a of sim.armies) if (a.fighting && (!hot || a.str > hot.str)) hot = a;
          if (!hot) for (const c of sim.cities) if (c.besieged >= sim.t - 3 && (!hot || c.capital)) hot = c;
          if (hot) this.R.flyTo(hot.x, hot.y, 7);
          else this.R.flyOverview();
        }
      }
    }

    show(q, now) {
      this.current = q;
      this.lastLine = now;
      this.until = now + TW.clamp(2600 + q.text.length * 75, 3800, 9000);
      this.who.textContent = q.who;
      this.txt.textContent = q.text;
      this.el.hidden = false;
      this.el.classList.remove('out');
      this.el.classList.toggle('bard', q.who !== '🎙 実況');
      void this.el.offsetWidth;
      this.el.classList.add('in');
      if (this.autoCam && q.x != null && now > this.holdUntil) {
        this.lastLocated = now;
        this.R.flyTo(q.x, q.y, q.pri >= 4 ? 8 : 6);
      }
    }
  }
  return Commentary;
})();
