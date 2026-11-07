'use strict';
// 大陸エディタ: 陸と海の境界を描くだけ。地形は開始時に自動生成。
(function () {
  const KEY = 'territory-war-maps';
  TW.MapStore = {
    list() {
      try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
    },
    save(entry) {
      const l = this.list().filter(m => m.name !== entry.name);
      l.unshift(entry);
      localStorage.setItem(KEY, JSON.stringify(l));
    },
    remove(name) {
      localStorage.setItem(KEY, JSON.stringify(this.list().filter(m => m.name !== name)));
    },
    get(name) { return this.list().find(m => m.name === name) || null; },
  };

  TW.validateMap = function (m) {
    if (!m || typeof m !== 'object') throw new Error('形式が正しくありません');
    const W = m.W | 0, H = m.H | 0;
    if (W < 40 || H < 30 || W > 400 || H > 260) throw new Error('マップサイズが不正です');
    if (typeof m.rle !== 'string') throw new Error('陸地データがありません');
    const caps = Array.isArray(m.capitals) ? m.capitals.filter(c => Array.isArray(c) && c.length === 2).slice(0, 30).map(([x, y]) => [x | 0, y | 0]) : [];
    return { name: String(m.name || '無題の地図').slice(0, 40), W, H, rle: m.rle, capitals: caps, created: m.created || Date.now() };
  };

  class Editor {
    constructor() {
      this.tool = 'land';
      this.brush = 4;
      this.capitals = [];
      this.cv = document.createElement('canvas');
      this.dirty = true;
      this.last = null;
      this.undo = [];
    }
    load(W, H, mask, capitals) {
      this.W = W; this.H = H;
      this.mask = new Uint8Array(mask || W * H);
      this.capitals = (capitals || []).map(c => [c[0], c[1]]);
      this.cv.width = W; this.cv.height = H;
      this.img = this.cv.getContext('2d').createImageData(W, H);
      this.undo = [];
      this.dirty = true;
    }
    pushUndo() {
      this.undo.push({ mask: this.mask.slice(), capitals: this.capitals.map(c => c.slice()) });
      if (this.undo.length > 30) this.undo.shift();
    }
    doUndo() {
      const u = this.undo.pop();
      if (!u) return;
      this.mask = u.mask; this.capitals = u.capitals; this.dirty = true;
    }
    rebuild() {
      const { W, H, mask } = this, d = this.img.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, k = i * 4;
        let r, g, b;
        if (mask[i]) {
          const coast = (x > 0 && !mask[i - 1]) || (x < W - 1 && !mask[i + 1]) || (y > 0 && !mask[i - W]) || (y < H - 1 && !mask[i + W]);
          if (coast) { r = 150; g = 120; b = 82; } else { r = 226; g = 208; b = 164; if ((x + y) & 1) { r -= 4; g -= 4; b -= 4; } }
        } else {
          r = 156; g = 186; b = 180; if ((x + y) & 1) { r -= 3; g -= 3; b -= 3; }
        }
        d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
      }
      this.cv.getContext('2d').putImageData(this.img, 0, 0);
      this.dirty = false;
    }
    paintAt(fx, fy, v) {
      const r = this.brush, W = this.W, H = this.H;
      for (let y = Math.floor(fy - r); y <= Math.ceil(fy + r); y++) {
        if (y < 0 || y >= H) continue;
        for (let x = Math.floor(fx - r); x <= Math.ceil(fx + r); x++) {
          if (x < 0 || x >= W) continue;
          const dx = x + 0.5 - fx, dy = y + 0.5 - fy;
          if (dx * dx + dy * dy <= r * r) this.mask[y * W + x] = v;
        }
      }
      this.dirty = true;
    }
    strokeTo(fx, fy) {
      const v = this.tool === 'land' ? 1 : 0;
      if (this.last) {
        const [lx, ly] = this.last;
        const dist = Math.hypot(fx - lx, fy - ly);
        const steps = Math.max(1, Math.ceil(dist / Math.max(0.5, this.brush * 0.4)));
        for (let s = 1; s <= steps; s++) this.paintAt(lx + (fx - lx) * s / steps, ly + (fy - ly) * s / steps, v);
      } else this.paintAt(fx, fy, v);
      this.last = [fx, fy];
    }
    endStroke() {
      this.last = null;
      // 首都が海になったら除去
      this.capitals = this.capitals.filter(([x, y]) => this.mask[y * this.W + x]);
    }
    clickCapital(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return '地図の外です';
      if (this.tool === 'capital') {
        if (!this.mask[cy * this.W + cx]) return '首都は陸地に置いてください';
        if (this.capitals.length >= 30) return '首都は最大30個までです';
        if (this.capitals.some(([x, y]) => Math.hypot(x - cx, y - cy) < 4)) return '他の首都に近すぎます';
        this.pushUndo();
        this.capitals.push([cx, cy]);
      } else if (this.tool === 'erase') {
        let best = -1, bd = 36;
        this.capitals.forEach(([x, y], k) => { const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = k; } });
        if (best >= 0) { this.pushUndo(); this.capitals.splice(best, 1); }
      }
      return null;
    }
    landCount() { let n = 0; for (const v of this.mask) n += v; return n; }
    toEntry(name) {
      return { name, W: this.W, H: this.H, rle: TW.encodeRLE(this.mask), capitals: this.capitals.map(c => c.slice()), created: Date.now() };
    }
  }
  TW.Editor = Editor;
})();
