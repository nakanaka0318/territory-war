'use strict';
// WebAudio による効果音とBGM (すべてその場で合成)
TW.Audio = (function () {
  let ctx = null, master = null, sfxBus = null, bgmBus = null, reverb = null, unlocked = false;
  const KEY = 'tw-audio';
  const st = { sfx: true, bgm: true, sfxVol: 0.7, bgmVol: 0.55 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* noop */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* noop */ } };
  const listeners = [];
  const notify = () => listeners.forEach(f => f());

  // 残響 (減衰するノイズのインパルス応答)
  function makeReverb(seconds = 3.6) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const c = ctx.createConvolver();
    c.buffer = buf;
    return c;
  }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = st.sfxVol * 0.5; sfxBus.connect(master);
      bgmBus = ctx.createGain(); bgmBus.gain.value = 0; bgmBus.connect(master);
      reverb = makeReverb();
      const wet = ctx.createGain(); wet.gain.value = 0.55;
      reverb.connect(wet); wet.connect(bgmBus);
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return true;
  }

  // ユーザー操作(タップ/クリック/キー)のたびに音声を有効化する。
  // iOS では pointerdown では許可されず touchend/click が必要なため、複数のイベントで待つ。
  function unlock() {
    if (!ensure()) return;
    if (!unlocked) {
      unlocked = true;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* noop */ }
      // 無音を1回鳴らして iOS の音声出力を開始させる
      const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    }
    if (st.bgm) Music.start();
    notify();
  }
  ['pointerup', 'touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (unlocked) ctx.resume().catch(() => {});
  });

  // ---------- 効果音 ----------
  function tone(freq, dur, { type = 'sine', gain = 0.5, attack = 0.01, freqEnd = null, delay = 0, filter = null } = {}) {
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, { gain = 0.4, type = 'lowpass', freq = 800, delay = 0, attack = 0.005 } = {}) {
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  // 協和する音だけで構成 (ハ長調ペンタトニック中心)
  const N = { C2: 65.41, G2: 98, C3: 130.81, E3: 164.81, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5 };
  function bell(f, dur, gain, delay = 0) {
    tone(f, dur, { type: 'sine', gain, attack: 0.008, delay });
    tone(f * 2, dur * 0.5, { type: 'sine', gain: gain * 0.25, attack: 0.008, delay });
  }
  function pad(f, dur, gain, delay = 0) {
    tone(f, dur, { type: 'triangle', gain, attack: Math.min(0.25, dur * 0.3), delay, filter: 1400 });
  }
  const sounds = {
    war() { pad(N.G3, 0.5, 0.16); pad(N.C4, 0.9, 0.16, 0.22); pad(N.G3, 0.9, 0.08, 0.22); },
    peace() { bell(N.E5, 0.7, 0.08); bell(N.G5, 0.7, 0.07, 0.15); bell(N.C6, 1.1, 0.06, 0.3); },
    alliance() { bell(N.C5, 1.0, 0.06); bell(N.E5, 1.0, 0.05, 0.04); bell(N.G5, 1.0, 0.045, 0.08); },
    capture() { tone(N.C3, 0.28, { gain: 0.22, freqEnd: N.C2 }); noise(0.08, { gain: 0.05, freq: 400 }); bell(N.G4, 0.35, 0.05, 0.05); },
    capital() { bell(N.C3, 2.0, 0.16); bell(N.G3, 1.8, 0.09, 0.02); bell(N.C4, 1.5, 0.06, 0.04); },
    destroy() { bell(N.C3, 2.2, 0.15); bell(N.G2, 2.6, 0.13, 0.55); },
    battle() { tone(N.A4, 0.09, { type: 'triangle', gain: 0.08 }); noise(0.05, { gain: 0.04, type: 'bandpass', freq: 1500 }); tone(N.E4, 0.12, { type: 'triangle', gain: 0.06, delay: 0.09 }); },
    rebel() { pad(N.G3, 0.35, 0.12); pad(N.C4, 0.35, 0.12, 0.12); pad(N.E4, 0.7, 0.12, 0.24); },
    betray() { pad(N.A4, 0.4, 0.1); pad(N.E4, 0.9, 0.1, 0.25); },
    culture() { [N.C5, N.D5, N.E5, N.G5, N.A5].forEach((f, k) => bell(f, 0.6, 0.045, k * 0.07)); },
    develop() { bell(N.G5, 0.5, 0.035); bell(N.C6, 0.6, 0.03, 0.08); },
    plague() { pad(N.C3, 1.6, 0.12); pad(N.G3, 1.6, 0.06, 0.1); noise(1.2, { gain: 0.04, freq: 300, attack: 0.5 }); },
    disaster() { noise(1.4, { gain: 0.18, freq: 120, attack: 0.05 }); tone(N.C2, 1.4, { gain: 0.2 }); },
    bless() { [N.C5, N.E5, N.G5, N.C6].forEach((f, k) => bell(f, 0.9, 0.06, k * 0.09)); },
    click() { tone(N.G5, 0.05, { gain: 0.04 }); },
  };
  const last = {};
  const minGap = { battle: 1500, capture: 900, war: 1200, peace: 1200, alliance: 1200, capital: 1500, destroy: 1500, rebel: 1200, betray: 1500, develop: 2500, culture: 1500 };
  const PRIORITY = { destroy: 5, capital: 5, rebel: 4, betray: 4, war: 3, culture: 3, peace: 2, alliance: 2, capture: 1, battle: 1, develop: 0 };
  let lastAny = 0;

  // ---------- BGM: ゆったりした生成音楽 ----------
  const mf = m => 440 * Math.pow(2, (m - 69) / 12);
  // 和音: [ベース, パッドの音...] (MIDI番号) — 臨時記号なしの白鍵だけで濁りを避ける
  const PROG = {
    calmA: [[41, 57, 60, 64], [43, 59, 62, 67], [40, 55, 59, 62], [45, 55, 60, 64]],      // Fmaj7 G Em7 Am7
    calmB: [[48, 55, 60, 64], [45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62]],      // C Am F G
    calmC: [[38, 57, 62, 65], [43, 55, 59, 62], [48, 55, 60, 64], [45, 57, 60, 64]],      // Dm G C Am
    tense: [[45, 57, 60, 64], [41, 57, 60, 65], [38, 57, 62, 65], [40, 55, 59, 64]],      // Am F Dm Em
  };
  const MEL = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79]; // Aマイナー・ペンタトニック
  const Music = {
    on: false, timer: null, next: 0, step: 0, mood: 0, chord: null, prog: PROG.calmA, ci: 0,
    melIdx: 4, phrase: true, cycle: 0,
    bpm: 64,
    start() {
      if (this.on || !ctx) return;
      this.on = true;
      this.step = 0; this.ci = 0; this.cycle = 0;
      this.next = ctx.currentTime + 0.15;
      const g = bgmBus.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(st.bgmVol * 1.5, ctx.currentTime + 4);
      this.timer = setInterval(() => this.tick(), 60);
    },
    stop() {
      if (!this.on) return;
      this.on = false;
      clearInterval(this.timer);
      if (ctx) {
        const g = bgmBus.gain;
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(g.value, ctx.currentTime);
        g.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      }
    },
    tick() {
      if (!ctx || ctx.state !== 'running') return;
      const eighth = 60 / this.bpm / 2;
      if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05; // 停止後の追いつき防止
      while (this.next < ctx.currentTime + 0.4) {
        this.schedule(this.step, this.next, eighth);
        this.next += eighth; this.step++;
      }
    },
    out(node, dry = 0.6, wet = 0.8) {
      const d = ctx.createGain(); d.gain.value = dry; node.connect(d); d.connect(bgmBus);
      const w = ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(reverb);
    },
    voice(type, freq, t, dur, { gain = 0.05, attack = 0.02, release = 1, filter = 2000, detune = 0, vibrato = 0 } = {}) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = type; o.frequency.value = freq; o.detune.value = detune;
      f.type = 'lowpass'; f.frequency.value = filter;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
      if (vibrato) {
        const l = ctx.createOscillator(), lg = ctx.createGain();
        l.frequency.value = 4.6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * vibrato, t + 0.6);
        l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + release + 0.1);
      }
      o.connect(f); f.connect(g);
      o.start(t); o.stop(t + dur + release + 0.1);
      return g;
    },
    schedule(step, t, eighth) {
      const r = Math.random;
      const bar = 8, chordLen = bar * 2; // 1和音 = 2小節
      if (step % chordLen === 0) {
        if (this.ci % 4 === 0) {
          // 4和音ごとに進行を選び直す (戦乱の多さで暗い進行に)
          const calm = [PROG.calmA, PROG.calmB, PROG.calmC][this.cycle % 3];
          this.prog = this.mood > 0.55 && r() < 0.7 ? PROG.tense : calm;
          this.cycle++;
        }
        this.chord = this.prog[this.ci % 4];
        this.ci++;
        this.phrase = r() < 0.62;
        const dur = eighth * chordLen;
        // ベース
        this.out(this.voice('sine', mf(this.chord[0]), t, dur, { gain: 0.11, attack: 0.6, release: 2.5, filter: 400 }), 0.9, 0.3);
        // パッド (2つの少しずらした音で柔らかく)
        for (const m of this.chord.slice(1)) {
          this.out(this.voice('triangle', mf(m), t, dur, { gain: 0.022, attack: 2.4, release: 3.2, filter: 900, detune: -5 }), 0.5, 0.9);
          this.out(this.voice('sine', mf(m), t, dur, { gain: 0.02, attack: 2.8, release: 3.2, filter: 1200, detune: 6 }), 0.5, 0.9);
        }
      }
      if (!this.chord) return;
      const pos = step % 16;
      // ハープのアルペジオ (まばら)
      const tones = this.chord.slice(1).concat(this.chord.slice(1).map(m => m + 12));
      if ((pos % 2 === 0 && r() < 0.42) || (pos % 2 === 1 && r() < 0.12)) {
        const m = tones[(pos + (r() < 0.3 ? 1 : 0)) % tones.length];
        this.out(this.voice('triangle', mf(m), t, 0.05, { gain: 0.045, attack: 0.005, release: 1.8, filter: 2600 }), 0.6, 0.7);
        this.out(this.voice('sine', mf(m + 12), t, 0.03, { gain: 0.012, attack: 0.005, release: 1.0, filter: 4000 }), 0.5, 0.6);
      }
      // 笛のメロディ (休符多め)
      if (this.phrase && pos % 2 === 0 && r() < (this.mood > 0.55 ? 0.3 : 0.36)) {
        let k = this.melIdx + [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)];
        k = TW.clamp(k, 1, MEL.length - 2);
        // 小節頭では和音の音に寄せる
        if (pos === 0) {
          const pcs = this.chord.slice(1).map(m => m % 12);
          for (let d = 0; d < 3; d++) {
            if (pcs.includes(MEL[TW.clamp(k + d, 0, MEL.length - 1)] % 12)) { k = TW.clamp(k + d, 0, MEL.length - 1); break; }
            if (pcs.includes(MEL[TW.clamp(k - d, 0, MEL.length - 1)] % 12)) { k = TW.clamp(k - d, 0, MEL.length - 1); break; }
          }
        }
        this.melIdx = k;
        const beats = [2, 2, 3, 4, 4, 6][Math.floor(r() * 6)];
        this.out(this.voice('sine', mf(MEL[k] + 12), t, eighth * beats, { gain: 0.035, attack: 0.18, release: 0.9, filter: 2400, vibrato: 0.006 }), 0.55, 0.85);
        this.out(this.voice('triangle', mf(MEL[k] + 12), t, eighth * beats, { gain: 0.008, attack: 0.25, release: 0.8, filter: 1800 }), 0.4, 0.7);
      }
      // 遠くの鐘 (ごくまれ)
      if (pos === 0 && r() < 0.08) {
        const m = this.chord[1] + 24;
        this.out(this.voice('sine', mf(m), t, 0.05, { gain: 0.018, attack: 0.005, release: 4, filter: 5000 }), 0.3, 1);
      }
    },
  };

  return {
    get enabled() { return st.sfx || st.bgm; },
    get sfx() { return st.sfx; },
    get bgm() { return st.bgm; },
    get sfxVol() { return st.sfxVol; },
    get bgmVol() { return st.bgmVol; },
    get running() { return !!ctx && ctx.state === 'running'; },
    onChange(f) { listeners.push(f); },
    unlock,
    setSfx(v) { st.sfx = v; save(); if (v) unlock(); notify(); },
    setBgm(v) {
      st.bgm = v; save();
      if (v) { unlock(); Music.start(); } else Music.stop();
      notify();
    },
    setSfxVol(v) { st.sfxVol = v; save(); if (sfxBus) sfxBus.gain.value = v * 0.5; },
    setBgmVol(v) {
      st.bgmVol = v; save();
      if (bgmBus && Music.on) { bgmBus.gain.cancelScheduledValues(ctx.currentTime); bgmBus.gain.setTargetAtTime(v * 1.5, ctx.currentTime, 0.1); }
    },
    setMood(m) { Music.mood = m; },
    play(name) {
      if (!st.sfx || !ctx || ctx.state !== 'running' || !sounds[name]) return;
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
