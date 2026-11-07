'use strict';
// WebAudio による簡単な合成効果音
TW.Audio = (function () {
  let ctx = null, master = null;
  let enabled = true;
  const last = {};
  const minGap = { battle: 1500, capture: 900, war: 1200, peace: 1200, alliance: 1200, capital: 1500, destroy: 1500, rebel: 1200, betray: 1500, develop: 2500, culture: 1500 };
  const PRIORITY = { destroy: 5, capital: 5, rebel: 4, betray: 4, war: 3, culture: 3, peace: 2, alliance: 2, capture: 1, battle: 1, develop: 0 };
  let lastAny = 0;
  try { const v = localStorage.getItem('tw-sound'); if (v === '0') enabled = false; } catch (e) { /* noop */ }

  function ensure() {
    if (!enabled) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  function tone(freq, dur, { type = 'sine', gain = 0.5, attack = 0.01, freqEnd = null, delay = 0, filter = null } = {}) {
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter;
      o.connect(f); node = f;
    }
    node.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, { gain = 0.4, type = 'lowpass', freq = 800, delay = 0, attack = 0.005 } = {}) {
    const t0 = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  // 協和する音だけで構成 (ハ長調ペンタトニック: ド レ ミ ソ ラ)
  const N = { C2: 65.41, G2: 98, C3: 130.81, E3: 164.81, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5 };
  // 柔らかいベル/木琴風の音 (基音 + 弱い倍音)
  function bell(f, dur, gain, delay = 0) {
    tone(f, dur, { type: 'sine', gain, attack: 0.008, delay });
    tone(f * 2, dur * 0.5, { type: 'sine', gain: gain * 0.25, attack: 0.008, delay });
  }
  function pad(f, dur, gain, delay = 0) {
    tone(f, dur, { type: 'triangle', gain, attack: Math.min(0.25, dur * 0.3), delay, filter: 1400 });
  }
  const sounds = {
    // 宣戦: ソ→ド の角笛風 (完全4度)
    war() { pad(N.G3, 0.5, 0.16); pad(N.C4, 0.9, 0.16, 0.22); pad(N.G3, 0.9, 0.08, 0.22); },
    // 停戦: ミ→ソ→ド の上行
    peace() { bell(N.E5, 0.7, 0.08); bell(N.G5, 0.7, 0.07, 0.15); bell(N.C6, 1.1, 0.06, 0.3); },
    // 同盟: ド・ミ・ソ の和音
    alliance() { bell(N.C5, 1.0, 0.06); bell(N.E5, 1.0, 0.05, 0.04); bell(N.G5, 1.0, 0.045, 0.08); },
    // 占領: 低い太鼓 + ソ
    capture() { tone(N.C3, 0.28, { gain: 0.22, freqEnd: N.C2 }); noise(0.08, { gain: 0.05, freq: 400 }); bell(N.G4, 0.35, 0.05, 0.05); },
    // 首都陥落: 低いド+ソ+ド の鐘 (オクターブと5度)
    capital() { bell(N.C3, 2.0, 0.16); bell(N.G3, 1.8, 0.09, 0.02); bell(N.C4, 1.5, 0.06, 0.04); },
    // 滅亡: さらに低い鐘をゆっくり2回
    destroy() { bell(N.C3, 2.2, 0.15); bell(N.G2, 2.6, 0.13, 0.55); },
    // 会戦: 木を打つような短い音
    battle() { tone(N.A4, 0.09, { type: 'triangle', gain: 0.08 }); noise(0.05, { gain: 0.04, type: 'bandpass', freq: 1500 }); tone(N.E4, 0.12, { type: 'triangle', gain: 0.06, delay: 0.09 }); },
    // 反乱: ソ→ド→ミ の上行アルペジオ
    rebel() { pad(N.G3, 0.35, 0.12); pad(N.C4, 0.35, 0.12, 0.12); pad(N.E4, 0.7, 0.12, 0.24); },
    // 裏切り: ラ→ミ の下行 (完全5度)
    betray() { pad(N.A3 * 2, 0.4, 0.1); pad(N.E4, 0.9, 0.1, 0.25); },
    // 文化の発展: ド・レ・ミ・ソ・ラ の軽い上行
    culture() { [N.C5, N.D5, N.E5, N.G5, N.A5].forEach((f, k) => bell(f, 0.6, 0.045, k * 0.07)); },
    develop() { bell(N.G5, 0.5, 0.035); bell(N.C6, 0.6, 0.03, 0.08); },
    plague() { pad(N.C3, 1.6, 0.12); pad(N.G3, 1.6, 0.06, 0.1); noise(1.2, { gain: 0.04, freq: 300, attack: 0.5 }); },
    disaster() { noise(1.4, { gain: 0.18, freq: 120, attack: 0.05 }); tone(N.C2, 1.4, { gain: 0.2 }); },
    bless() { [N.C5, N.E5, N.G5, N.C6].forEach((f, k) => bell(f, 0.9, 0.06, k * 0.09)); },
    click() { tone(N.G5, 0.05, { gain: 0.04 }); },
  };
  return {
    get enabled() { return enabled; },
    setEnabled(v) {
      enabled = v;
      try { localStorage.setItem('tw-sound', v ? '1' : '0'); } catch (e) { /* noop */ }
      if (v) ensure();
    },
    unlock() { if (enabled) ensure(); },
    play(name) {
      if (!enabled || !ctx || ctx.state !== 'running' || !sounds[name]) return;
      const now = performance.now();
      if (last[name] && now - last[name] < (minGap[name] || 150)) return;
      // 音が重なって濁らないよう、直前の音から間隔を空ける (重要な音は優先)
      const pr = PRIORITY[name] ?? 6;
      if (now - lastAny < (pr >= 4 ? 250 : 600)) return;
      last[name] = now; lastAny = now;
      try { sounds[name](); } catch (e) { /* noop */ }
    },
  };
})();
