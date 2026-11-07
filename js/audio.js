'use strict';
// WebAudio による簡単な合成効果音
TW.Audio = (function () {
  let ctx = null, master = null;
  let enabled = true;
  const last = {};
  const minGap = { battle: 500, capture: 300, war: 600, peace: 600, alliance: 600, capital: 800, destroy: 800, rebel: 700, betray: 800 };
  try { const v = localStorage.getItem('tw-sound'); if (v === '0') enabled = false; } catch (e) { /* noop */ }

  function ensure() {
    if (!enabled) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.28; master.connect(ctx.destination);
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
  const sounds = {
    war() { tone(196, 0.8, { type: 'sawtooth', gain: 0.25, attack: 0.08, filter: 900 }); tone(294, 0.8, { type: 'sawtooth', gain: 0.18, attack: 0.1, filter: 900, delay: 0.05 }); noise(0.3, { gain: 0.2, freq: 300 }); },
    peace() { tone(660, 0.6, { gain: 0.2 }); tone(880, 0.9, { gain: 0.18, delay: 0.18 }); },
    alliance() { tone(523, 0.7, { gain: 0.18 }); tone(659, 0.7, { gain: 0.15 }); },
    capture() { noise(0.18, { gain: 0.45, freq: 500 }); tone(110, 0.3, { gain: 0.45, freqEnd: 50 }); },
    capital() { tone(98, 2.2, { gain: 0.45, attack: 0.005 }); tone(147, 1.8, { gain: 0.2 }); tone(233, 1.2, { gain: 0.1 }); noise(0.4, { gain: 0.25, freq: 250 }); },
    destroy() { tone(73, 2.6, { gain: 0.5 }); tone(110, 2.2, { gain: 0.2 }); tone(155, 1.5, { gain: 0.08 }); },
    battle() { noise(0.12, { gain: 0.35, type: 'highpass', freq: 2000 }); tone(1800, 0.15, { type: 'triangle', gain: 0.12, freqEnd: 1200 }); noise(0.1, { gain: 0.25, type: 'highpass', freq: 2500, delay: 0.12 }); },
    rebel() { tone(220, 0.5, { type: 'sawtooth', gain: 0.2, freqEnd: 440, filter: 1200 }); noise(0.4, { gain: 0.2, freq: 600 }); },
    betray() { tone(311, 0.6, { type: 'square', gain: 0.1, filter: 1000 }); tone(293, 0.8, { type: 'square', gain: 0.1, filter: 1000, delay: 0.2 }); },
    plague() { noise(1.4, { gain: 0.3, freq: 300, attack: 0.5 }); tone(70, 1.4, { gain: 0.2, attack: 0.4 }); },
    disaster() { noise(1.8, { gain: 0.55, freq: 140, attack: 0.05 }); tone(45, 1.6, { gain: 0.4, freqEnd: 30 }); },
    bless() { [523, 659, 784, 1046].forEach((f, k) => tone(f, 0.8, { gain: 0.15, delay: k * 0.09 })); },
    click() { tone(800, 0.06, { gain: 0.08 }); },
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
      last[name] = now;
      try { sounds[name](); } catch (e) { /* noop */ }
    },
  };
})();
