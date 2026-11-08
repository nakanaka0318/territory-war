'use strict';
// 吟遊詩人の詩: 名場面を短い詩にする
TW.Poems = (function () {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const T = {
    battle: [
      { title: '{place}の戦い', lines: ['{place}の野に 風は哭き', '{loser}の旗は 泥に伏す', '{winner}の鬨の声 高らかに', '散りし兵の名を 誰が知る'] },
      { title: '{place}の血戦', lines: ['剣と剣 火花を散らし', '{place}の空は 紅に染む', '勝ちて{winner} 歌えども', '野辺の花のみ 黙して咲く'] },
      { title: '{place}の会戦', lines: ['角笛は 丘を越えて響き', '{winner}の騎馬 雪崩のごとし', '{loser}の陣 ついに崩れ', '夕日のみぞ 戦を見届けし'] },
    ],
    capital: [
      { title: '{city}陥落の歌', lines: ['{city}の 白き城壁 崩れ落ち', '{loser}の王は 炎を背に去る', '塔の上 {winner}の旗翻り', '古き都は 新たな主を迎う'] },
      { title: '王都の落日', lines: ['鐘は鳴らず 門は開かれ', '{city}に{winner}の軍 満ちる', '玉座は冷たく 主を待たず', '{loser}の栄華 今は昔'] },
    ],
    destroy: [
      { title: '{loser}哀歌', lines: ['かつて栄えし {loser}の名も', '今は風のみ 知るところ', '{years}年の夢の跡', '石碑に苔が 静かに生す'] },
      { title: '滅びの詩', lines: ['{loser}の民よ いずこへ', '城は焼け 旗は裂かれ', '{winner}の世に 名は消えても', '歌だけは 千年を渡る'] },
    ],
    rebel: [
      { title: '{city}の蜂起', lines: ['{city}の民 鎖を断ちて', '{nation}の名を 高く掲ぐ', '{parent}の軛 今ぞ外れ', '若き旗に 朝日が射す'] },
      { title: '自由の歌', lines: ['麦を刈る手に 槍を取り', '{city}の広場に 民は集う', '「我らは{nation}」と叫ぶ声', '古き王国を 揺るがせり'] },
    ],
    wonder: [
      { title: '{wonder}讃歌', lines: ['{city}に {wonder}そびえ立つ', '{nation}の誇り 雲を突く', '石工の汗と 王の夢', '千年先まで 語り継がれん'] },
      { title: '驚異の誕生', lines: ['見よ旅人 {city}の空を', '{wonder}は 星に届かんとす', '{nation}の名は これより後', '世界の果てまで 鳴り響かん'] },
    ],
    ruin: [
      { title: '崩れし{wonder}', lines: ['{wonder} 今は崩れて 石の山', '{city}の空に 鳥のみ舞う', '築きし者も 壊せし者も', 'やがて等しく 土に還る'] },
    ],
    wonderTaken: [
      { title: '奪われし{wonder}', lines: ['{city}の門を {winner}が破り', '{wonder}は 新たな主を得る', '{loser}の嘆きは 風となり', '驚異は黙して ただ立つ'] },
    ],
    threat: [
      { title: '{name}来たる', lines: ['空は裂け 大地は震え', '{lair}より 闇が溢れる', '争いし王たちよ 剣を収めよ', '今は肩を並べ 共に立て'] },
      { title: '災厄の予言', lines: ['古き書に記されし災い', '{name}の名が 再び響く', '国境の線は 意味を失い', '諸国の旗は ひとつに並ぶ'] },
    ],
    threatEnd: [
      { title: '{name}討伐の歌', lines: ['{gen}の剣は 闇を裂き', '{name}は ついに地に伏す', '{hero}の名は 救世の証', '千年先まで 讃えられん'] },
      { title: '夜明けの歌', lines: ['長き夜は 明けたり', '{hero}の旗が 朝日に輝く', '倒れし勇士に 花を手向け', '人々は また明日を歌う'] },
    ],
    era: [
      { title: '{nation}の{era}', lines: ['{nation}に {era}の光満ち', '学び舎に 若き声響く', '詩と歌の 花ひらき', '都は夜も 灯を絶やさず'] },
    ],
  };
  function fill(s, v) { return s.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : '')); }
  return {
    make(type, vars) {
      const list = T[type];
      if (!list) return null;
      const t = pick(list);
      return { title: fill(t.title, vars), lines: t.lines.map(l => fill(l, vars)) };
    },
  };
})();
