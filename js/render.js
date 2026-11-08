'use strict';
// 古地図風レンダラー
(function () {
  const T = TW.T;
  const INK = [74, 56, 40];
  const FONT = '"Zen Old Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif';

  function cellScale(W) { return TW.clamp(Math.floor(2400 / W), 5, 8); }
  TW.cellScale = cellScale;

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, y: 0, z: 1 };
      this.dpr = 1;
      this.cw = 1; this.ch = 1;
      this.selectedUid = null;
      this.mouse = null;
      this.tool = 'look';
      this.lastTerr = 0;
      this.terrSel = null;
      this.showArrows = true;
      this.resize();
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.cw = Math.max(1, r.width); this.ch = Math.max(1, r.height);
      this.cv.width = Math.round(this.cw * this.dpr);
      this.cv.height = Math.round(this.ch * this.dpr);
      this.ui = Math.min(this.cw, this.ch) < 500 ? 0.75 : 1;
    }

    setDims(W, H) {
      this.W = W; this.H = H;
      this.S = cellScale(W);
      this.WW = W * this.S; this.WH = H * this.S;
    }

    fit() {
      const pr = this.padRight || 0, pb = this.padBottom || 0, pl = this.padLeft || 0, pt = this.padTop || 0;
      const aw = Math.max(160, this.cw - pr - pl), ah = Math.max(120, this.ch - pb - pt);
      let z = Math.min(aw / this.WW, ah / this.WH) * 0.98;
      if (ah > aw * 1.2) z = Math.max(z, Math.min(ah * 0.8 / this.WH, z * 2.2)); // 縦長画面では少し拡大
      this.cam = { x: this.WW / 2 + (pr - pl) / 2 / z, y: this.WH / 2 + (pb - pt) / 2 / z, z };
      this.minZ = Math.min(this.cw / this.WW, this.ch / this.WH) * 0.6; this.maxZ = 40 / this.S;
    }

    clampCam() {
      const c = this.cam;
      c.z = TW.clamp(c.z, this.minZ, this.maxZ);
      const hw = this.cw / 2 / c.z, hh = this.ch / 2 / c.z;
      const mx = Math.max(0, hw - this.WW / 2) + this.WW * 0.1, my = Math.max(0, hh - this.WH / 2) + this.WH * 0.1;
      c.x = TW.clamp(c.x, hw - mx, this.WW - hw + mx);
      c.y = TW.clamp(c.y, hh - my, this.WH - hh + my);
      if (hw * 2 > this.WW + 2 * mx) c.x = this.WW / 2;
      if (hh * 2 > this.WH + 2 * my) c.y = this.WH / 2;
    }

    screenToWorld(sx, sy) {
      return { x: (sx - this.cw / 2) / this.cam.z + this.cam.x, y: (sy - this.ch / 2) / this.cam.z + this.cam.y };
    }
    screenToCell(sx, sy) {
      const p = this.screenToWorld(sx, sy);
      const cx = Math.floor(p.x / this.S), cy = Math.floor(p.y / this.S);
      const inside = cx >= 0 && cy >= 0 && cx < this.W && cy < this.H;
      return { cx, cy, fx: p.x / this.S, fy: p.y / this.S, i: inside ? cy * this.W + cx : -1 };
    }
    zoomAt(sx, sy, f) {
      const before = this.screenToWorld(sx, sy);
      this.cam.z = TW.clamp(this.cam.z * f, this.minZ, this.maxZ);
      const after = this.screenToWorld(sx, sy);
      this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
      this.clampCam();
    }
    centerOn(cx, cy, z) {
      this.cam.x = (cx + 0.5) * this.S; this.cam.y = (cy + 0.5) * this.S;
      if (z) this.cam.z = Math.max(this.cam.z, z / this.S);
      this.clampCam();
    }

    // ---------- 地形ベース ----------
    setWorld(w) {
      this.w = w;
      this.setDims(w.W, w.H);
      this.buildBase();
      this.terr = document.createElement('canvas');
      this.terr.width = this.WW; this.terr.height = this.WH;
      this.fillCv = document.createElement('canvas');
      this.fillCv.width = w.W; this.fillCv.height = w.H;
      this.fillImg = this.fillCv.getContext('2d').createImageData(w.W, w.H);
      this.roadCv = document.createElement('canvas');
      this.roadCv.width = this.WW; this.roadCv.height = this.WH;
      this.lastRoad = 0;
      this.fit();
    }
    setSim(sim) { this.sim = sim; this.lastTerr = 0; this.lastRoad = 0; sim.dirty = true; sim.roadDirty = true; }

    // 自動カメラ: 目標へゆっくり移動 (zs = 1セルの画面px)
    flyTo(cx, cy, zs) {
      this.camTarget = { x: (cx + 0.5) * this.S, y: (cy + 0.5) * this.S, z: TW.clamp(zs / this.S, this.minZ, this.maxZ) };
    }
    flyOverview() {
      const keep = this.cam;
      this.fit();
      this.camTarget = { ...this.cam };
      this.cam = keep;
    }
    stepCamera() {
      const t = this.camTarget;
      if (!t) return;
      const c = this.cam, k = 0.04;
      c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k;
      c.z = Math.exp(Math.log(c.z) + (Math.log(t.z) - Math.log(c.z)) * k);
      this.clampCam();
      if (Math.abs(t.x - c.x) < 1 && Math.abs(t.y - c.y) < 1 && Math.abs(t.z - c.z) / t.z < 0.01) this.camTarget = null;
    }

    // ---------- 道 ----------
    buildRoads() {
      const sim = this.sim, w = this.w, W = w.W, H = w.H, S = this.S, road = sim.road;
      const lv = i => TW.roadLevel(road[i]);
      const jit = i => {
        const h = Math.imul(i ^ 0x5bd1e995, 2654435761) >>> 0;
        return [((h & 1023) / 1023 - 0.5) * 0.35, (((h >>> 10) & 1023) / 1023 - 0.5) * 0.35];
      };
      const pt = i => { const [jx, jy] = jit(i); return [((i % W) + 0.5 + jx) * S, (((i / W) | 0) + 0.5 + jy) * S]; };
      const paths = [null, new Path2D(), new Path2D(), new Path2D()];
      const seg = (a, b, l) => { const p = pt(a), q = pt(b); paths[l].moveTo(p[0], p[1]); paths[l].lineTo(q[0], q[1]); };
      for (const i of w.landCells) {
        const a = lv(i);
        if (!a) continue;
        const x = i % W, y = (i / W) | 0;
        const r = x < W - 1 && w.land[i + 1] ? lv(i + 1) : 0;
        const d = y < H - 1 && w.land[i + W] ? lv(i + W) : 0;
        const l = x > 0 && w.land[i - 1] ? lv(i - 1) : 0;
        if (r) seg(i, i + 1, Math.min(a, r));
        if (d) seg(i, i + W, Math.min(a, d));
        if (y < H - 1 && x < W - 1 && !r && !d && w.land[i + W + 1]) { const b = lv(i + W + 1); if (b) seg(i, i + W + 1, Math.min(a, b)); }
        if (y < H - 1 && x > 0 && !l && !d && w.land[i + W - 1]) { const b = lv(i + W - 1); if (b) seg(i, i + W - 1, Math.min(a, b)); }
      }
      const t = this.roadCv.getContext('2d');
      t.clearRect(0, 0, this.WW, this.WH);
      t.lineCap = 'round'; t.lineJoin = 'round';
      t.strokeStyle = 'rgba(100,68,40,0.75)'; t.lineWidth = Math.max(1, S * 0.17);
      t.setLineDash([S * 0.3, S * 0.25]); t.stroke(paths[1]); t.setLineDash([]);
      t.strokeStyle = 'rgba(246,234,204,0.6)'; t.lineWidth = Math.max(2, S * 0.42); t.stroke(paths[2]);
      t.strokeStyle = 'rgba(92,60,34,0.92)'; t.lineWidth = Math.max(1.5, S * 0.26); t.stroke(paths[2]);
      t.strokeStyle = 'rgba(70,46,28,0.97)'; t.lineWidth = Math.max(3, S * 0.56); t.stroke(paths[3]);
      t.strokeStyle = 'rgba(236,218,180,0.97)'; t.lineWidth = Math.max(1.5, S * 0.26); t.stroke(paths[3]);
      sim.roadDirty = false;
    }

    buildBase() {
      const w = this.w, W = w.W, H = w.H, N = w.N, S = this.S, WW = this.WW, WH = this.WH;
      const rand = TW.mulberry32(w.seed ^ 0x51ed27);
      const noise = new TW.Noise(rand), noise2 = new TW.Noise(rand);
      const sd = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N), shade = new Float32Array(N);
      const plains = TW.TERRAIN[T.PLAINS].color;
      for (let i = 0; i < N; i++) {
        if (w.land[i]) {
          sd[i] = w.landDist[i] - 0.5;
          const c = TW.TERRAIN[w.terrain[i]].color;
          cr[i] = c[0]; cg[i] = c[1]; cb[i] = c[2];
        } else {
          sd[i] = -(w.seaDist[i] - 0.5);
          cr[i] = plains[0]; cg[i] = plains[1]; cb[i] = plains[2];
        }
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!w.land[i]) continue;
        const e = k => (k >= 0 && k < N && w.land[k]) ? w.elev[k] : 0.1;
        const gx = (x > 0 ? e(i - 1) : e(i)) - (x < W - 1 ? e(i + 1) : e(i));
        const gy = (y > 0 ? e(i - W) : e(i)) - (y < H - 1 ? e(i + W) : e(i));
        shade[i] = TW.clamp((gx + gy) * 0.9, -0.25, 0.25);
      }
      const cv = document.createElement('canvas');
      cv.width = WW; cv.height = WH;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(WW, WH);
      const d = img.data;
      const mcv = document.createElement('canvas');
      mcv.width = WW; mcv.height = WH;
      const mctx = mcv.getContext('2d');
      const mimg = mctx.createImageData(WW, WH);
      const md = mimg.data;
      const lineW = 0.075 * (8 / S);
      for (let py = 0; py < WH; py++) {
        let v = (py + 0.5) / S - 0.5;
        let y0 = Math.floor(v); if (y0 < 0) y0 = 0; if (y0 > H - 2) y0 = H - 2;
        let fy = v - y0; if (fy < 0) fy = 0; if (fy > 1) fy = 1;
        const vy = Math.min(py, WH - 1 - py) / (WH * 0.12);
        for (let px = 0; px < WW; px++) {
          let u = (px + 0.5) / S - 0.5;
          let x0 = Math.floor(u); if (x0 < 0) x0 = 0; if (x0 > W - 2) x0 = W - 2;
          let fx = u - x0; if (fx < 0) fx = 0; if (fx > 1) fx = 1;
          const i00 = y0 * W + x0, i10 = i00 + 1, i01 = i00 + W, i11 = i01 + 1;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          let s = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
          if (s > -2.5 && s < 2.5) s += noise.noise2(px * 0.045, py * 0.045) * 0.33 + noise.noise2(px * 0.15, py * 0.15) * 0.08;
          let r, g, b;
          if (s > 0) {
            r = cr[i00] * w00 + cr[i10] * w10 + cr[i01] * w01 + cr[i11] * w11;
            g = cg[i00] * w00 + cg[i10] * w10 + cg[i01] * w01 + cg[i11] * w11;
            b = cb[i00] * w00 + cb[i10] * w10 + cb[i01] * w01 + cb[i11] * w11;
            const sh = 1 + (shade[i00] * w00 + shade[i10] * w10 + shade[i01] * w01 + shade[i11] * w11) * 0.7;
            r *= sh; g *= sh; b *= sh;
            if (s < 0.7) { const k = 1 - 0.13 * (1 - s / 0.7); r *= k; g *= k; b *= k; }
          } else {
            const dd = -s;
            const k = Math.exp(-dd / 2.4);
            r = 204 + (138 - 204) * k; g = 205 + (176 - 205) * k; b = 184 + (172 - 184) * k;
            if (dd > 0.3 && dd < 3.4) {
              const ph = dd * 1.5 - 0.2;
              const f = ph - Math.floor(ph);
              if (f < 0.1) { const a = 0.2 * (1 - dd / 3.4); r += (INK[0] - r) * a; g += (INK[1] - g) * a; b += (INK[2] - b) * a; }
            }
          }
          const as = s < 0 ? -s : s;
          if (as < lineW * 1.6) {
            const a = as < lineW ? 0.9 : 0.9 * (1 - (as - lineW) / (lineW * 0.6));
            r += (INK[0] - r) * a; g += (INK[1] - g) * a; b += (INK[2] - b) * a;
          }
          // 紙の質感
          const grain = ((Math.imul(px * 374761393 + py * 668265263, 1274126177) >>> 0) / 4294967296 - 0.5) * 10;
          const stain = noise2.noise2(px * 0.0045, py * 0.0045) * 0.06 + noise2.noise2(px * 0.02, py * 0.02) * 0.025;
          const vx = Math.min(px, WW - 1 - px) / (WW * 0.12);
          const vig = 1 - 0.16 * (1 - Math.min(1, Math.min(vx, vy)));
          const m = (1 - stain) * vig;
          const o = (py * WW + px) * 4;
          d[o] = r * m + grain; d[o + 1] = g * m + grain; d[o + 2] = b * m * 0.98 + grain; d[o + 3] = 255;
          md[o + 3] = s > -0.05 ? 255 : 0;
        }
      }
      ctx.putImageData(img, 0, 0);
      mctx.putImageData(mimg, 0, 0);
      this.landMask = mcv;

      // 経緯線
      ctx.save();
      ctx.strokeStyle = 'rgba(80,60,40,0.16)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      for (let lat = -80; lat <= 80; lat += 20) {
        const y = (lat - w.latTop) / (w.latBottom - w.latTop) * WH;
        if (y < 0 || y > WH) continue;
        ctx.globalAlpha = lat === 0 ? 1.8 : 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WW, y); ctx.stroke();
      }
      for (let k = 1; k < 12; k++) {
        const x = k / 12 * WW;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WH); ctx.stroke();
      }
      ctx.restore();

      // 川
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(62,100,128,0.85)';
      const jit = i => {
        const h = Math.imul(i, 2654435761) >>> 0;
        return [((h & 1023) / 1023 - 0.5) * 0.55, (((h >>> 10) & 1023) / 1023 - 0.5) * 0.55];
      };
      for (const path of w.rivers) {
        const pts = path.map(i => {
          const [jx, jy] = w.land[i] ? jit(i) : [0, 0];
          return [((i % W) + 0.5 + jx) * S, (((i / W) | 0) + 0.5 + jy) * S, w.flow[i] || w.flow[path[path.length - 2]] || 1];
        });
        for (let k = 0; k < pts.length - 1; k++) {
          const p0 = k > 0 ? [(pts[k - 1][0] + pts[k][0]) / 2, (pts[k - 1][1] + pts[k][1]) / 2] : pts[0];
          const p2 = [(pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2];
          ctx.lineWidth = (0.5 + Math.min(2.2, Math.sqrt(pts[k][2]) * 0.22)) * S / 8;
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]);
          ctx.quadraticCurveTo(pts[k][0], pts[k][1], p2[0], p2[1]);
          if (k === pts.length - 2) ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
          ctx.stroke();
        }
      }
      ctx.restore();

      // 地形記号
      const occ = new Uint8Array(N);
      const order = Array.from(w.landCells);
      for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
      const glyphs = [];
      for (const i of order) {
        if (occ[i] || w.river[i] && w.terrain[i] !== T.MOUNTAIN) continue;
        const t = w.terrain[i], x = i % W, y = (i / W) | 0;
        const jx = (rand() - 0.5) * 0.6, jy = (rand() - 0.5) * 0.6;
        const cx = (x + 0.5 + jx) * S, cy = (y + 0.5 + jy) * S;
        if (t === T.MOUNTAIN) {
          if (rand() < 0.2) continue;
          glyphs.push({ t, cx, cy, s: S * (1.45 + rand() * 0.7), snow: w.temp[i] < 0.42 });
          occ[i] = 1; if (x < W - 1) occ[i + 1] = 1; if (x > 0) occ[i - 1] = 1; if (y < H - 1) occ[i + W] = 1;
        } else if (t === T.HILLS && rand() < 0.55) {
          glyphs.push({ t, cx, cy, s: S * (1.0 + rand() * 0.4) }); occ[i] = 1;
        } else if (t === T.FOREST && rand() < 0.6) {
          glyphs.push({ t, cx, cy, s: S * (0.75 + rand() * 0.3), two: rand() < 0.5 }); occ[i] = 1;
        } else if (t === T.DESERT && rand() < 0.7) {
          glyphs.push({ t, cx, cy, s: S, dune: rand() < 0.18 });
        } else if (t === T.TUNDRA && rand() < 0.25) {
          glyphs.push({ t, cx, cy, s: S });
        } else if (t === T.SNOW && rand() < 0.22) {
          glyphs.push({ t, cx, cy, s: S });
        } else if (t === T.PLAINS && rand() < 0.05) {
          glyphs.push({ t, cx, cy, s: S });
        }
      }
      glyphs.sort((a, b) => a.cy - b.cy);
      const ink = 'rgba(74,56,40,0.85)';
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const g of glyphs) {
        const { cx, cy, s } = g;
        ctx.lineWidth = Math.max(0.8, S / 8);
        if (g.t === T.MOUNTAIN) {
          const l = cx - s * 0.55, r = cx + s * 0.55, by = cy + s * 0.32, px = cx - s * 0.06, py = cy - s * 0.5;
          ctx.beginPath(); ctx.moveTo(l, by); ctx.lineTo(px, py); ctx.lineTo(r, by); ctx.closePath();
          ctx.fillStyle = 'rgb(226,210,172)'; ctx.fill();
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(r, by); ctx.lineTo(cx + s * 0.08, by); ctx.closePath();
          ctx.fillStyle = 'rgba(96,74,52,0.42)'; ctx.fill();
          if (g.snow) {
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - s * 0.17, py + s * 0.25); ctx.lineTo(px + s * 0.18, py + s * 0.26); ctx.closePath();
            ctx.fillStyle = 'rgba(250,248,240,0.95)'; ctx.fill();
          }
          ctx.strokeStyle = ink;
          ctx.beginPath(); ctx.moveTo(l, by); ctx.lineTo(px, py); ctx.lineTo(r, by); ctx.stroke();
        } else if (g.t === T.HILLS) {
          ctx.strokeStyle = ink;
          ctx.beginPath(); ctx.arc(cx, cy + s * 0.35, s * 0.42, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
          ctx.lineWidth *= 0.7;
          ctx.beginPath(); ctx.moveTo(cx + s * 0.12, cy + s * 0.05); ctx.lineTo(cx + s * 0.2, cy + s * 0.25);
          ctx.moveTo(cx + s * 0.25, cy + s * 0.12); ctx.lineTo(cx + s * 0.3, cy + s * 0.28); ctx.stroke();
        } else if (g.t === T.FOREST) {
          const tree = (tx, ty, ts) => {
            ctx.strokeStyle = ink;
            ctx.beginPath(); ctx.moveTo(tx, ty + ts * 0.15); ctx.lineTo(tx, ty + ts * 0.5); ctx.stroke();
            ctx.beginPath(); ctx.arc(tx, ty - ts * 0.05, ts * 0.32, 0, Math.PI * 2);
            ctx.fillStyle = 'rgb(140,154,100)'; ctx.fill(); ctx.stroke();
          };
          if (g.two) { tree(cx - s * 0.28, cy, s * 0.85); tree(cx + s * 0.3, cy + s * 0.12, s * 0.85); }
          else tree(cx, cy, s);
        } else if (g.t === T.DESERT) {
          ctx.fillStyle = 'rgba(160,128,80,0.6)';
          for (let k = 0; k < 4; k++) ctx.fillRect(cx + (rand() - 0.5) * s, cy + (rand() - 0.5) * s, Math.max(1, S / 7), Math.max(1, S / 7));
          if (g.dune) {
            ctx.strokeStyle = 'rgba(140,110,70,0.6)';
            ctx.beginPath(); ctx.arc(cx, cy + s * 0.4, s * 0.5, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
          }
        } else if (g.t === T.TUNDRA) {
          ctx.strokeStyle = 'rgba(90,90,70,0.55)';
          ctx.beginPath(); ctx.moveTo(cx - s * 0.2, cy - s * 0.1); ctx.lineTo(cx - s * 0.1, cy + s * 0.15); ctx.lineTo(cx, cy - s * 0.15);
          ctx.lineTo(cx + s * 0.1, cy + s * 0.15); ctx.lineTo(cx + s * 0.2, cy - s * 0.1); ctx.stroke();
        } else if (g.t === T.SNOW) {
          ctx.strokeStyle = 'rgba(120,140,160,0.45)';
          ctx.beginPath(); ctx.moveTo(cx - s * 0.3, cy); ctx.lineTo(cx + s * 0.3, cy); ctx.stroke();
        } else if (g.t === T.PLAINS) {
          ctx.strokeStyle = 'rgba(110,100,60,0.4)';
          ctx.beginPath(); ctx.moveTo(cx - s * 0.15, cy); ctx.lineTo(cx - s * 0.05, cy - s * 0.25);
          ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - s * 0.3); ctx.moveTo(cx + s * 0.15, cy); ctx.lineTo(cx + s * 0.05, cy - s * 0.25); ctx.stroke();
        }
      }

      // 枠
      ctx.save();
      ctx.strokeStyle = 'rgba(60,44,30,0.95)';
      ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, WW - 3, WH - 3);
      ctx.lineWidth = 1; ctx.strokeRect(7.5, 7.5, WW - 15, WH - 15);
      ctx.fillStyle = 'rgba(60,44,30,0.85)';
      const step = WW / 48;
      for (let k = 0; k < 48; k += 2) { ctx.fillRect(3 + k * step, 3, step, 4); ctx.fillRect(3 + k * step, WH - 7, step, 4); }
      const stepY = WH / 30;
      for (let k = 0; k < 30; k += 2) { ctx.fillRect(3, 3 + k * stepY, 4, stepY); ctx.fillRect(WW - 7, 3 + k * stepY, 4, stepY); }
      ctx.restore();
      this.base = cv;
    }

    // ---------- 領土レイヤー ----------
    buildTerritory() {
      const sim = this.sim, w = this.w, W = w.W, H = w.H, S = this.S, owner = sim.owner, land = w.land;
      const d = this.fillImg.data;
      const nat = sim.nations;
      for (let i = 0; i < w.N; i++) {
        const o = owner[i], k = i * 4;
        if (o < 0 || !land[i]) { d[k + 3] = 0; continue; }
        const c = nat[o].color;
        const x = i % W, y = (i / W) | 0;
        const edge = (x > 0 && owner[i - 1] !== o) || (x < W - 1 && owner[i + 1] !== o) ||
          (y > 0 && owner[i - W] !== o) || (y < H - 1 && owner[i + W] !== o);
        d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = edge ? 185 : 105;
      }
      this.fillCv.getContext('2d').putImageData(this.fillImg, 0, 0);
      const t = this.terr.getContext('2d');
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, this.WW, this.WH);
      t.imageSmoothingEnabled = true;
      t.drawImage(this.fillCv, 0, 0, this.WW, this.WH);
      const normal = new Path2D(), war = new Path2D(), sel = new Path2D();
      const selN = this.selectedUid != null ? (nat.find(n => n && n.alive && n.uid === this.selectedUid) || null) : null;
      const sid = selN ? selN.id : -99;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const o = land[i] ? owner[i] : -2;
          if (x < W - 1) {
            const j = i + 1, p = land[j] ? owner[j] : -2;
            if (p !== o) {
              if ((o === sid) !== (p === sid)) { sel.moveTo((x + 1) * S, y * S); sel.lineTo((x + 1) * S, (y + 1) * S); }
              if (o !== -2 && p !== -2 && (o >= 0 || p >= 0)) {
                const path = (o >= 0 && p >= 0 && sim.rel[o * TW.MAXN + p] === 1) ? war : normal;
                path.moveTo((x + 1) * S, y * S); path.lineTo((x + 1) * S, (y + 1) * S);
              }
            }
          }
          if (y < H - 1) {
            const j = i + W, p = land[j] ? owner[j] : -2;
            if (p !== o) {
              if ((o === sid) !== (p === sid)) { sel.moveTo(x * S, (y + 1) * S); sel.lineTo((x + 1) * S, (y + 1) * S); }
              if (o !== -2 && p !== -2 && (o >= 0 || p >= 0)) {
                const path = (o >= 0 && p >= 0 && sim.rel[o * TW.MAXN + p] === 1) ? war : normal;
                path.moveTo(x * S, (y + 1) * S); path.lineTo((x + 1) * S, (y + 1) * S);
              }
            }
          }
        }
      }
      t.lineCap = 'round';
      t.strokeStyle = 'rgba(70,48,32,0.62)'; t.lineWidth = Math.max(1, S * 0.16);
      t.stroke(normal);
      t.strokeStyle = 'rgba(165,28,18,0.85)'; t.lineWidth = Math.max(1.5, S * 0.26);
      t.setLineDash([S * 0.6, S * 0.35]); t.stroke(war); t.setLineDash([]);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(this.landMask, 0, 0);
      t.globalCompositeOperation = 'source-over';
      if (selN) {
        t.strokeStyle = 'rgba(255,248,220,0.95)'; t.lineWidth = S * 0.55; t.stroke(sel);
        t.strokeStyle = 'rgba(40,25,10,0.95)'; t.lineWidth = S * 0.22; t.stroke(sel);
      }
      sim.dirty = false;
    }

    // ---------- 描画 ----------
    draw(now, editor) {
      const ctx = this.ctx, dpr = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#2a2018';
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      const z = this.cam.z * dpr;
      ctx.setTransform(z, 0, 0, z, dpr * this.cw / 2 - this.cam.x * z, dpr * this.ch / 2 - this.cam.y * z);
      if (editor) { this.drawEditor(editor); return; }
      if (!this.base) return;
      this.stepCamera();
      ctx.setTransform(this.cam.z * dpr, 0, 0, this.cam.z * dpr, dpr * this.cw / 2 - this.cam.x * this.cam.z * dpr, dpr * this.ch / 2 - this.cam.y * this.cam.z * dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.base, 0, 0);
      const sim = this.sim;
      if (!sim) return;
      if ((sim.dirty || this.terrSel !== this.selectedUid) && now - this.lastTerr > 110) {
        this.buildTerritory(); this.lastTerr = now; this.terrSel = this.selectedUid;
      }
      ctx.drawImage(this.terr, 0, 0);
      if (sim.roadDirty && now - this.lastRoad > 1000) { this.buildRoads(); this.lastRoad = now; }
      ctx.drawImage(this.roadCv, 0, 0);
      this.drawBattlefields();
      this.drawOps(now);
      this.drawArrows();
      this.drawForts();
      this.drawCities();
      this.drawLabels();
      this.drawArmies();
      this.drawEffects(now);
      this.drawCursor();
      if (sim.threat) {
        const c2 = this.ctx;
        c2.setTransform(1, 0, 0, 1, 0, 0);
        const W2 = this.cv.width, H2 = this.cv.height;
        const pulse = 0.16 + Math.sin(now / 900) * 0.04;
        const g = c2.createRadialGradient(W2 / 2, H2 / 2, Math.min(W2, H2) * 0.35, W2 / 2, H2 / 2, Math.max(W2, H2) * 0.75);
        g.addColorStop(0, 'rgba(40,0,30,0)'); g.addColorStop(1, `rgba(60,0,40,${pulse})`);
        c2.fillStyle = g; c2.fillRect(0, 0, W2, H2);
      }
    }

    // ティックの間を補間してなめらかに動かす (alpha: 次のティックまでの進み具合)
    armyPos(a) {
      const S = this.S;
      const v = this.sim.visualPos(a);
      let x = v[0], y = v[1];
      const al = this.alpha == null ? 1 : this.alpha;
      if (a.vx0 != null && al < 1) {
        const dx = x - a.vx0, dy = y - a.vy0;
        if (dx * dx + dy * dy < 9) { x = a.vx0 + dx * al; y = a.vy0 + dy * al; }
      }
      return [(x + 0.5) * S, (y + 0.5) * S];
    }

    drawArrows() {
      if (!this.showArrows) return;
      const ctx = this.ctx, sim = this.sim, S = this.S, W = this.w.W, px = this.ui / this.cam.z;
      ctx.save();
      ctx.lineWidth = 1.6 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.lineCap = 'round';
      for (const a of sim.armies) {
        if (!a.path || a.pi >= a.path.length || a.mode === 'home') continue;
        const n = sim.nations[a.n];
        const [sx, sy] = this.armyPos(a);
        const end = Math.min(a.path.length, a.pi + 16);
        ctx.strokeStyle = n.dark;
        ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        let lx = sx, ly = sy, ppx = sx, ppy = sy;
        for (let k = a.pi; k < end; k++) {
          const c = a.path[k];
          ppx = lx; ppy = ly;
          lx = ((c % W) + 0.5) * S; ly = (((c / W) | 0) + 0.5) * S;
          ctx.lineTo(lx, ly);
        }
        ctx.stroke();
        const ang = Math.atan2(ly - ppy, lx - ppx);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(lx + Math.cos(ang) * 4 * px, ly + Math.sin(ang) * 4 * px);
        ctx.lineTo(lx + Math.cos(ang + 2.5) * 6 * px, ly + Math.sin(ang + 2.5) * 6 * px);
        ctx.lineTo(lx + Math.cos(ang - 2.5) * 6 * px, ly + Math.sin(ang - 2.5) * 6 * px);
        ctx.closePath(); ctx.fillStyle = n.dark; ctx.fill();
        ctx.setLineDash([5 * px, 4 * px]);
      }
      ctx.restore();
    }

    drawCities() {
      const ctx = this.ctx, sim = this.sim, S = this.S, px = this.ui / this.cam.z;
      const zs = this.cam.z * S; // セル1つの画面px
      const showAll = zs >= 9, showCap = zs >= 3.5;
      const pulse = (performance.now() % 1000) / 1000;
      ctx.save();
      ctx.textBaseline = 'middle';
      for (const c of sim.cities) {
        const x = (c.x + 0.5) * S, y = (c.y + 0.5) * S;
        const n = c.owner >= 0 ? sim.nations[c.owner] : null;
        if (c.besieged >= sim.t - 3) this.drawSiege(c, x, y, px, n);
        if (c.besieged >= sim.t - 3) {
          ctx.beginPath(); ctx.arc(x, y, (7 + pulse * 6) * px, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(190,30,20,${0.9 - pulse * 0.8})`; ctx.lineWidth = 2 * px; ctx.stroke();
          // 攻囲の進捗
          const md = sim.maxDefense(c);
          ctx.fillStyle = 'rgba(40,25,15,0.7)'; ctx.fillRect(x - 8 * px, y + 7 * px, 16 * px, 3 * px);
          ctx.fillStyle = 'rgb(200,60,40)'; ctx.fillRect(x - 8 * px, y + 7 * px, 16 * px * TW.clamp(c.defense / md, 0, 1), 3 * px);
        }
        // 発展度: 城壁(4+)は外周の環、大図書館(10)は金の環
        if (n && c.dev >= 4) {
          const wr = (c.capital ? 8 : 5 + c.dev * 0.15) * px;
          ctx.beginPath(); ctx.arc(x, y, wr, 0, Math.PI * 2);
          ctx.lineWidth = (c.dev >= 10 ? 2.2 : 1.4) * px;
          ctx.strokeStyle = c.dev >= 10 ? 'rgba(200,150,30,0.95)' : 'rgba(50,34,22,0.75)';
          ctx.setLineDash(c.dev >= 10 ? [] : [2.2 * px, 1.4 * px]);
          ctx.stroke(); ctx.setLineDash([]);
        }
        if (c.lair && n && n.isThreat) {
          // 世界の脅威の拠点: 禍々しいオーラと結界
          const th = sim.threat;
          const def = TW.THREATS.find(d => d.key === c.lair);
          const tt = performance.now() / 1000;
          const R0 = (22 + Math.sin(tt * 2) * 3) * px;
          const g = ctx.createRadialGradient(x, y, 0, x, y, R0 * 1.6);
          g.addColorStop(0, `rgba(${n.color[0]},${n.color[1]},${n.color[2]},0.55)`); g.addColorStop(1, 'rgba(20,0,20,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R0 * 1.6, 0, Math.PI * 2); ctx.fill();
          if (th && sim.t - th.start < TW.TPY * 5) {
            ctx.strokeStyle = `rgba(190,140,255,${0.5 + Math.sin(tt * 4) * 0.25})`; ctx.lineWidth = 2 * px;
            ctx.setLineDash([4 * px, 3 * px]); ctx.beginPath(); ctx.arc(x, y, 16 * px, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          }
          ctx.save(); ctx.textAlign = 'center'; ctx.font = `${22 * px}px serif`; ctx.fillStyle = '#000';
          ctx.fillText(def ? def.icon : '☠', x, y + 1 * px);
          ctx.font = `900 ${11 * px}px ${FONT}`;
          ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(30,0,20,0.85)'; ctx.strokeText(c.name, x, y + 20 * px);
          ctx.fillStyle = 'rgb(255,210,230)'; ctx.fillText(c.name, x, y + 20 * px);
          ctx.restore();
          continue;
        }
        if (c.nat) {
          // 世界自然遺産
          ctx.beginPath(); ctx.arc(x, y, 8.5 * px, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(236,244,222,0.95)'; ctx.fill();
          ctx.lineWidth = 2 * px; ctx.strokeStyle = n ? n.css : 'rgb(80,120,60)'; ctx.stroke();
          ctx.lineWidth = 0.9 * px; ctx.strokeStyle = 'rgb(50,80,40)';
          ctx.beginPath(); ctx.arc(x, y, 9.8 * px, 0, Math.PI * 2); ctx.stroke();
          ctx.save(); ctx.textAlign = 'center'; ctx.font = `${11 * px}px serif`; ctx.fillStyle = '#000';
          ctx.fillText(c.icon, x, y + 0.5 * px); ctx.restore();
          if (showCap) {
            ctx.font = `700 ${10 * px}px ${FONT}`;
            const tx = x + 11 * px;
            ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(246,236,210,0.9)'; ctx.strokeText(c.name, tx, y);
            ctx.fillStyle = 'rgb(40,80,30)'; ctx.fillText(c.name, tx, y);
          }
          continue;
        }
        if (c.capital && n) {
          const r = 5.5 * px;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = n.css; ctx.fill();
          ctx.lineWidth = 1.6 * px; ctx.strokeStyle = 'rgb(50,34,22)'; ctx.stroke();
          ctx.beginPath();
          for (let k = 0; k < 10; k++) {
            const rr = (k % 2 ? 1.4 : 3.4) * px, a = -Math.PI / 2 + k * Math.PI / 5;
            ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.closePath(); ctx.fillStyle = 'rgb(255,246,215)'; ctx.fill();
        } else {
          const r = (2.3 + Math.min(10, c.dev) * 0.17 + (c.pop > 6 ? 0.5 : 0)) * px;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = n ? 'rgb(248,238,212)' : 'rgba(230,220,195,0.8)'; ctx.fill();
          ctx.lineWidth = 1.3 * px; ctx.strokeStyle = n ? 'rgb(50,34,22)' : 'rgba(80,65,50,0.6)'; ctx.stroke();
          if (n) { ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = n.dark; ctx.fill(); }
        }
        if ((c.capital && showCap) || (showAll && (c.pop > 3 || zs >= 16))) {
          const fs = (c.capital ? 12 : 10.5) * px;
          ctx.font = `${c.capital ? 700 : 500} ${fs}px ${FONT}`;
          const tx = x + 7.5 * px;
          ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(246,236,210,0.85)'; ctx.strokeText(c.name, tx, y);
          ctx.fillStyle = 'rgb(48,32,20)'; ctx.fillText(c.name, tx, y);
        }
      }
      this.drawWonders(px, zs);
      ctx.restore();
    }

    // 攻囲: 煙・炎・守備兵・投石
    drawSiege(c, x, y, px, n) {
      const ctx = this.ctx, sim = this.sim, t = performance.now() / 1000;
      const md = sim.maxDefense(c);
      const ratio = TW.clamp(c.defense / md, 0, 1);
      // 投石
      ctx.fillStyle = 'rgb(60,50,40)';
      for (const a of sim.armies) {
        if (a.mode !== 'siege' || !a.target || a.target.type !== 'city' || a.target.id !== c.id) continue;
        const [ax, ay] = this.armyPos(a);
        const ph = (t * 0.7 + a.id * 0.37) % 1;
        const sx = ax + (x - ax) * ph, sy = ay + (y - ay) * ph - Math.sin(ph * Math.PI) * 16 * px;
        ctx.beginPath(); ctx.arc(sx, sy, 1.4 * px, 0, Math.PI * 2); ctx.fill();
      }
      // 煙
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.35 + k / 3) % 1;
        const sx = x + Math.sin(t * 0.8 + k * 2) * 3 * px + (k - 1) * 3 * px, sy = y - 4 * px - ph * 22 * px;
        const r = (3 + ph * 7) * px;
        ctx.fillStyle = `rgba(90,85,80,${0.35 * (1 - ph)})`;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      }
      // 城壁が崩れると炎
      if (ratio < 0.5) {
        for (let k = 0; k < 4; k++) {
          const fl = 0.6 + 0.4 * Math.sin(t * 12 + k * 1.7);
          const fx = x + (k - 1.5) * 3 * px, fy = y - 2 * px;
          ctx.fillStyle = `rgba(240,${120 + k * 20},40,${0.75 * fl})`;
          ctx.beginPath(); ctx.ellipse(fx, fy - 3 * px * fl, 1.8 * px, 4 * px * fl, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
      // 守備兵 (城壁の周り)
      if (n) {
        const k = Math.round(ratio * 8);
        ctx.fillStyle = n.css;
        for (let i = 0; i < k; i++) {
          const an = i / 8 * Math.PI * 2 + 0.3;
          const sx = x + Math.cos(an) * 10 * px, sy = y + Math.sin(an) * 7 * px;
          ctx.fillRect(sx - 0.9 * px, sy - 2 * px, 1.8 * px, 3 * px);
        }
      }
      if (c.assault) {
        ctx.save(); ctx.font = `700 ${8 * px}px ${FONT}`; ctx.textAlign = 'center';
        ctx.lineWidth = 2.2 * px; ctx.strokeStyle = 'rgba(246,236,210,0.9)';
        ctx.strokeText('市街戦', x, y - 26 * px); ctx.fillStyle = 'rgb(170,30,20)'; ctx.fillText('市街戦', x, y - 26 * px);
        ctx.restore();
      }
    }

    drawWonders(px, zs) {
      const ctx = this.ctx, sim = this.sim, S = this.S;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const w of sim.wonders) {
        if (w.state === 'none') continue;
        const c = sim.cities[w.city];
        const x = (c.x + 0.5) * S, y = (c.y + 0.5) * S - 18 * px;
        if (w.state === 'built') {
          ctx.beginPath(); ctx.arc(x, y, 12 * px, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(250,240,210,0.95)'; ctx.fill();
          ctx.lineWidth = 2 * px; ctx.strokeStyle = 'rgb(196,150,40)'; ctx.stroke();
          ctx.font = `${15 * px}px serif`;
          ctx.fillText(w.icon, x, y + 1 * px);
        } else {
          // 遺跡: 折れた柱
          ctx.strokeStyle = 'rgba(70,52,36,0.85)'; ctx.lineWidth = 2 * px; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x - 7 * px, y + 6 * px); ctx.lineTo(x + 7 * px, y + 6 * px);
          ctx.moveTo(x - 4.5 * px, y + 6 * px); ctx.lineTo(x - 4.5 * px, y - 5 * px);
          ctx.moveTo(x, y + 6 * px); ctx.lineTo(x, y - 1 * px);
          ctx.moveTo(x + 4.5 * px, y + 6 * px); ctx.lineTo(x + 4.5 * px, y - 7 * px);
          ctx.stroke();
        }
        if (zs >= 6) {
          const label = w.state === 'built' ? w.name : `${w.name}の遺跡`;
          ctx.font = `700 ${9.5 * px}px ${FONT}`;
          ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(246,236,210,0.9)';
          ctx.strokeText(label, x, y - 18 * px);
          ctx.fillStyle = w.state === 'built' ? 'rgb(120,80,10)' : 'rgb(90,72,56)';
          ctx.fillText(label, x, y - 18 * px);
        }
      }
      // 建設中の驚異 (拡大時のみ)
      if (zs >= 8) {
        ctx.font = `${10 * px}px serif`;
        for (const n of sim.nations) {
          if (!n || !n.alive || !n.project) continue;
          const c = sim.cities[n.project.city];
          ctx.fillText('🏗️', (c.x + 0.5) * S + 10 * px, (c.y + 0.5) * S - 8 * px);
        }
      }
    }

    drawLabels() {
      const ctx = this.ctx, sim = this.sim, S = this.S, z = this.cam.z;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const l of sim.labels) {
        const n = sim.nations[l.n];
        if (!n || !n.alive) continue;
        let fs = TW.clamp(Math.sqrt(l.cells) * S * 0.32, S * 1.2, S * 7.5);
        const maxW = Math.max(l.spread * S * 2.4, S * 6);
        const chars = [...n.name];
        const spacing = 0.22;
        const totalW = fs * chars.length * (1 + spacing);
        if (totalW > maxW) fs *= maxW / totalW;
        if (fs * z < 9) { if (l.cells < 40 && fs * z < 6) continue; fs = 9 / z; }
        if (fs * z > 34) fs = 34 / z;
        const sel = n.uid === this.selectedUid;
        ctx.font = `700 ${fs}px ${FONT}`;
        ctx.save();
        ctx.translate(l.x * S, l.y * S);
        ctx.rotate(l.ang);
        const step = fs * (1 + spacing);
        let x = -step * (chars.length - 1) / 2;
        ctx.lineWidth = fs * 0.2; ctx.lineJoin = 'round';
        ctx.strokeStyle = sel ? 'rgba(255,250,230,0.95)' : 'rgba(246,236,210,0.55)';
        ctx.fillStyle = sel ? 'rgb(20,10,0)' : 'rgba(46,30,18,0.82)';
        for (const ch of chars) { ctx.strokeText(ch, x, 0); x += step; }
        x = -step * (chars.length - 1) / 2;
        for (const ch of chars) { ctx.fillText(ch, x, 0); x += step; }
        ctx.restore();
      }
      ctx.restore();
    }

    // 兵士の群れ・旗・将軍名・会戦の演出
    drawArmies() {
      const ctx = this.ctx, sim = this.sim, px = this.ui / this.cam.z, w = this.w, S = this.S, W = w.W;
      const zs = this.cam.z * S;
      const t = performance.now() / 1000;
      this.dirs = this.dirs || new Map();
      ctx.save();
      const byId = new Map(sim.armies.map(a => [a.id, a]));
      // --- 会戦の演出 ---
      for (const a of sim.armies) {
        if (!a.fighting) continue;
        const b = byId.get(a.fighting);
        if (!b || (b.id < a.id && b.fighting === a.id)) continue;
        const [ax, ay] = this.armyPos(a), [bx, by] = this.armyPos(b);
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const big = TW.clamp(Math.sqrt(a.str + b.str) / 6, 0.8, 2.2);
        // 土煙
        for (let k = 0; k < 4; k++) {
          const ph = (t * 0.6 + k * 0.25) % 1;
          const ox = Math.cos(k * 1.9 + t * 0.7) * 7 * px * big, oy = Math.sin(k * 2.3 + t * 0.5) * 4 * px * big - ph * 6 * px;
          const r = (6 + ph * 8) * px * big;
          const g = ctx.createRadialGradient(mx + ox, my + oy, 0, mx + ox, my + oy, r);
          g.addColorStop(0, `rgba(150,120,80,${0.32 * (1 - ph)})`); g.addColorStop(1, 'rgba(150,120,80,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx + ox, my + oy, r, 0, Math.PI * 2); ctx.fill();
        }
        // 飛び交う矢
        ctx.strokeStyle = 'rgba(60,40,20,0.8)'; ctx.lineWidth = 0.8 * px;
        ctx.beginPath();
        for (let k = 0; k < 5; k++) {
          const ph = (t * 1.6 + k * 0.21 + a.id * 0.13) % 1;
          const [sx, sy, ex, ey] = k % 2 ? [ax, ay, bx, by] : [bx, by, ax, ay];
          const xx = sx + (ex - sx) * ph, yy = sy + (ey - sy) * ph - Math.sin(ph * Math.PI) * 10 * px - 6 * px;
          const dx = (ex - sx), dy = (ey - sy), dl = Math.hypot(dx, dy) || 1;
          ctx.moveTo(xx, yy); ctx.lineTo(xx - dx / dl * 3 * px, yy - dy / dl * 3 * px);
        }
        ctx.stroke();
        // 火花
        ctx.strokeStyle = 'rgba(255,220,140,0.95)'; ctx.lineWidth = 1.1 * px;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          if (Math.sin(t * 23 + k * 7.1 + a.id) < 0.3) continue;
          const an = k * 1.05 + t * 2, rr = (3 + (k % 3) * 2) * px * big;
          const cx = mx + Math.cos(k * 2.7 + a.id) * 5 * px, cy = my - 2 * px + Math.sin(k * 1.3) * 3 * px;
          ctx.moveTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr);
          ctx.lineTo(cx + Math.cos(an) * (rr + 3 * px), cy + Math.sin(an) * (rr + 3 * px));
        }
        ctx.stroke();
        // 交差する剣
        const s2 = (5.5 + Math.sin(t * 10 + a.id) * 1.2) * px;
        const sy2 = my - 16 * px;
        ctx.strokeStyle = 'rgb(150,20,10)'; ctx.lineWidth = 2.4 * px;
        ctx.beginPath(); ctx.moveTo(mx - s2, sy2 - s2); ctx.lineTo(mx + s2, sy2 + s2); ctx.moveTo(mx + s2, sy2 - s2); ctx.lineTo(mx - s2, sy2 + s2); ctx.stroke();
      }
      // --- 軍団 ---
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const showSoldiers = zs >= 2.4;
      for (const a of sim.armies) {
        const n = sim.nations[a.n];
        if (!n) continue;
        const [x, y] = this.armyPos(a);
        const sea = !w.land[a.i];
        const sc = TW.clamp(0.85 + Math.sqrt(a.str) * 0.045, 0.85, 1.5) * px;
        // 向き
        let dir = this.dirs.get(a.id) || [1, 0];
        if (a.fighting && byId.get(a.fighting)) {
          const [fx, fy] = this.armyPos(byId.get(a.fighting));
          const d = Math.hypot(fx - x, fy - y) || 1; dir = [(fx - x) / d, (fy - y) / d];
        } else if (a.path && a.pi < a.path.length) {
          const nx = a.path[a.pi] % W, ny = (a.path[a.pi] / W) | 0;
          const d = Math.hypot(nx - a.x, ny - a.y) || 1; dir = [(nx - a.x) / d, (ny - a.y) / d];
        } else if (a.mode === 'siege' && a.target) {
          const tc = sim.targetCell(a.target);
          if (tc >= 0) { const d = Math.hypot(tc % W - a.x, ((tc / W) | 0) - a.y) || 1; dir = [(tc % W - a.x) / d, (((tc / W) | 0) - a.y) / d]; }
        }
        // 向きはなめらかに変える
        const od = this.dirs.get(a.id) || dir;
        const sm = [od[0] + (dir[0] - od[0]) * 0.15, od[1] + (dir[1] - od[1]) * 0.15];
        const sl = Math.hypot(sm[0], sm[1]) || 1;
        dir = [sm[0] / sl, sm[1] / sl];
        this.dirs.set(a.id, dir);
        const perp = [-dir[1], dir[0]];
        if (n.isThreat) {
          const def = TW.THREATS.find(d => d.key === n.threat);
          if (a.flying) {
            // 古竜: 大きな影と羽ばたき
            const flap = 1 + Math.sin(t * 7 + a.id) * 0.08;
            ctx.fillStyle = 'rgba(20,10,10,0.3)';
            ctx.beginPath(); ctx.ellipse(x, y + 8 * px, 16 * px * flap, 5 * px, 0, 0, Math.PI * 2); ctx.fill();
            ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.translate(x, y - 10 * px - Math.sin(t * 3) * 3 * px); ctx.scale(dir[0] < 0 ? 1 : -1, 1);
            ctx.fillStyle = '#000'; ctx.font = `${34 * px * flap}px serif`; ctx.fillText('🐉', 0, 0);
            ctx.restore();
            if (zs >= 2) {
              ctx.font = `700 ${9.5 * px}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
              const label = `${n.name} ${TW.fmtTroops(a.str)}`;
              ctx.lineWidth = 2.6 * px; ctx.strokeStyle = 'rgba(40,0,0,0.85)'; ctx.strokeText(label, x, y + 12 * px);
              ctx.fillStyle = 'rgb(255,200,170)'; ctx.fillText(label, x, y + 12 * px);
            }
            continue;
          }
          if (showSoldiers) {
            const count = TW.clamp(Math.round(Math.sqrt(a.str) * 2.2), 4, 26);
            ctx.font = `${8 * px * TW.clamp(zs / 10, 0.8, 1.3)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
            for (let k = 0; k < count; k++) {
              const row = Math.floor(k / 5), col = (k % 5) - 2;
              const f = a.fighting ? 1.4 + row * 0.7 + Math.sin(t * 9 + k) * 0.3 : -(row + 1) * 1.1;
              const sp = 4.6 * px * TW.clamp(zs / 10, 0.75, 1.25);
              const sx = x + (dir[0] * f + perp[0] * col * 1.05) * sp, sy = y + (dir[1] * f + perp[1] * col * 1.05) * sp + Math.sin(t * 8 + k) * 0.8 * px;
              ctx.fillText(def.unit, sx, sy);
            }
          }
          ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = '#000'; ctx.font = `${17 * px}px serif`; ctx.fillText(def.icon, x, y - 8 * px); ctx.restore();
          if (zs >= 3) {
            ctx.font = `700 ${9.5 * px}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            const label = TW.fmtTroops(a.str);
            ctx.lineWidth = 2.6 * px; ctx.strokeStyle = 'rgba(40,0,20,0.85)'; ctx.strokeText(label, x, y + 5 * px);
            ctx.fillStyle = 'rgb(255,200,230)'; ctx.fillText(label, x, y + 5 * px);
          }
          continue;
        }
        if (!sea && showSoldiers) {
          const count = TW.clamp(Math.round(Math.sqrt(a.str) * 2.4), 3, 28);
          const moving = a.path && a.pi < a.path.length && !a.fighting;
          const fighting = !!a.fighting || a.mode === 'siege';
          const sp = 4.3 * px * TW.clamp(zs / 10, 0.75, 1.25);
          const u = sp / 4.3;
          const spear = new Path2D();
          ctx.fillStyle = n.css;
          const heads = [];
          for (let k = 0; k < count; k++) {
            const row = Math.floor(k / 5), col = (k % 5) - 2;
            const h = Math.imul(a.id * 31 + k, 2654435761) >>> 0;
            const jx = ((h & 255) / 255 - 0.5) * 1.6, jy = (((h >> 8) & 255) / 255 - 0.5) * 1.6;
            let f, side = col * 1.05 + (row % 2) * 0.5 + jx * 0.3;
            if (fighting) f = 1.4 + row * 0.75 + Math.sin(t * 9 + k * 1.7) * 0.35;   // 前へ出てぶつかる
            else f = -(row + 1) * 1.1;                                              // 旗の後ろに隊列
            f += jy * 0.3;
            let sx = x + (dir[0] * f + perp[0] * side) * sp;
            let sy = y + (dir[1] * f + perp[1] * side) * sp;
            if (moving) sy += Math.sin(t * 10 + k * 1.3) * 0.7 * px;
            if (fighting) { sx += Math.sin(t * 17 + k) * 0.6 * px; }
            ctx.fillRect(sx - 1.4 * u, sy - 3.2 * u, 2.8 * u, 4.6 * u);
            heads.push(sx, sy);
            spear.moveTo(sx + 1.8 * u, sy + 1.2 * u);
            spear.lineTo(sx + 1.8 * u + dir[0] * 2.4 * u, sy - 6.5 * u + dir[1] * 2.4 * u);
          }
          ctx.fillStyle = 'rgb(232,204,166)';
          for (let k = 0; k < heads.length; k += 2) ctx.fillRect(heads[k] - 1.1 * u, heads[k + 1] - 5.4 * u, 2.2 * u, 2.2 * u);
          // 輪郭で見やすく
          ctx.strokeStyle = 'rgba(40,26,16,0.5)'; ctx.lineWidth = 0.5 * u;
          ctx.strokeStyle = 'rgba(40,26,16,0.85)'; ctx.lineWidth = 0.8 * u; ctx.stroke(spear);
        }
        ctx.lineWidth = 1.3 * px; ctx.strokeStyle = 'rgb(40,26,16)';
        if (sea) {
          ctx.beginPath();
          ctx.moveTo(x - 8 * sc, y); ctx.lineTo(x + 8 * sc, y); ctx.lineTo(x + 5 * sc, y + 4 * sc); ctx.lineTo(x - 5 * sc, y + 4 * sc); ctx.closePath();
          ctx.fillStyle = 'rgb(120,86,56)'; ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 12 * sc); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + 1 * sc, y - 11 * sc); ctx.lineTo(x + 7 * sc, y - 3 * sc); ctx.lineTo(x + 1 * sc, y - 2 * sc); ctx.closePath();
          ctx.fillStyle = n.css; ctx.fill(); ctx.stroke();
        } else {
          // 旗持ち
          const wave = a.path && !a.fighting ? Math.sin(t * 6 + a.id) * 1.2 : Math.sin(t * 3 + a.id) * 0.5;
          ctx.beginPath(); ctx.moveTo(x, y + 3 * sc); ctx.lineTo(x, y - 14 * sc); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x, y - 14 * sc); ctx.quadraticCurveTo(x + 5 * sc, y - 15 * sc + wave * sc, x + 11 * sc, y - 13 * sc + wave * sc);
          ctx.lineTo(x + 11 * sc, y - 7 * sc + wave * sc); ctx.quadraticCurveTo(x + 5 * sc, y - 9 * sc + wave * sc, x, y - 8 * sc); ctx.closePath();
          ctx.fillStyle = n.css; ctx.fill(); ctx.stroke();
          // 名将の旗には星
          if (a.gen && a.gen.wins >= 5) {
            ctx.fillStyle = 'rgb(255,236,150)'; ctx.font = `${6 * sc / px * px}px serif`;
            ctx.fillText('★', x + 5.5 * sc, y - 14 * sc + wave * sc);
          }
          ctx.beginPath(); ctx.ellipse(x, y + 3 * sc, 3.5 * sc, 1.5 * sc, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(40,26,16,0.35)'; ctx.fill();
        }
        if (zs >= 3) {
          ctx.font = `700 ${9.5 * px}px ${FONT}`;
          const label = TW.fmtTroops(a.str);
          ctx.lineWidth = 2.6 * px; ctx.strokeStyle = 'rgba(246,236,210,0.9)';
          ctx.strokeText(label, x, y + 5 * sc);
          ctx.fillStyle = a.mode === 'home' ? 'rgb(110,90,70)' : 'rgb(40,26,16)';
          ctx.fillText(label, x, y + 5 * sc);
        }
        // 将軍の名
        if (zs >= 6.5 && a.gen) {
          const gn = sim.genName(a.gen);
          ctx.font = `italic 700 ${8.5 * px}px ${FONT}`;
          ctx.lineWidth = 2.4 * px; ctx.strokeStyle = 'rgba(246,236,210,0.9)';
          ctx.strokeText(gn, x + 6 * sc, y - 25 * sc);
          ctx.fillStyle = a.gen.wins >= 5 ? 'rgb(140,60,10)' : 'rgb(60,40,24)';
          ctx.fillText(gn, x + 6 * sc, y - 25 * sc);
        }
      }
      ctx.restore();
    }

    // 古戦場
    drawBattlefields() {
      const ctx = this.ctx, sim = this.sim, S = this.S, px = this.ui / this.cam.z;
      const zs = this.cam.z * S;
      if (zs < 2.5 || !sim.battlefields.length) return;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const b of sim.battlefields) {
        const x = (b.x + 0.5) * S, y = (b.y + 0.5) * S;
        const r = (3.5 + Math.min(3, Math.sqrt(b.total) / 18)) * px;
        ctx.strokeStyle = 'rgba(70,30,20,0.55)'; ctx.lineWidth = 1.3 * px;
        ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
        ctx.moveTo(x - r * 0.6, y - r); ctx.lineTo(x - r, y - r * 0.6); ctx.moveTo(x + r * 0.6, y - r); ctx.lineTo(x + r, y - r * 0.6);
        ctx.stroke();
        if (zs >= 5) {
          ctx.font = `italic ${8.5 * px}px ${FONT}`;
          const label = `${b.name}（${b.year}年）`;
          ctx.lineWidth = 2.2 * px; ctx.strokeStyle = 'rgba(246,236,210,0.7)'; ctx.strokeText(label, x, y + r + 1 * px);
          ctx.fillStyle = 'rgba(90,40,30,0.8)'; ctx.fillText(label, x, y + r + 1 * px);
        }
      }
      ctx.restore();
    }

    // 作戦矢印
    drawOps(now) {
      const ctx = this.ctx, sim = this.sim, S = this.S, px = this.ui / this.cam.z;
      if (!sim.ops.length) return;
      ctx.save();
      for (const op of sim.ops) {
        if (op.status === 'ended') continue;
        const n = sim.nations[op.n];
        if (!n || !n.alive || n.uid !== op.nuid) continue;
        const c = sim.cities[op.target];
        const x0 = (op.fx + 0.5) * S, y0 = (op.fy + 0.5) * S;
        let x1 = (c.x + 0.5) * S, y1 = (c.y + 0.5) * S;
        const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
        if (L < S * 3) continue;
        // 矢の先は目標の手前で止める
        const cut = Math.min(S * 1.6, L * 0.2);
        x1 -= dx / L * cut; y1 -= dy / L * cut;
        const cx = (x0 + x1) / 2 - dy / L * L * 0.18, cy = (y0 + y1) / 2 + dx / L * L * 0.18;
        const wdt = Math.max(S * 0.8, 5 * px);
        const ok = op.status === 'success';
        const col = ok ? 'rgba(60,120,50,' : 'rgba(170,30,20,';
        const fade = ok ? Math.max(0, 1 - (sim.t - op.endT) / (TW.TPY * 2)) : 1;
        ctx.globalAlpha = fade;
        ctx.lineCap = 'round';
        ctx.strokeStyle = col + '0.28)'; ctx.lineWidth = wdt * 1.9;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke();
        ctx.strokeStyle = col + '0.75)'; ctx.lineWidth = Math.max(1.2 * px, wdt * 0.18);
        ctx.setLineDash([wdt * 0.9, wdt * 0.5]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke();
        ctx.setLineDash([]);
        // 矢じり
        const ang = Math.atan2(y1 - cy, x1 - cx), hl = wdt * 2.6;
        ctx.beginPath();
        ctx.moveTo(x1 + Math.cos(ang) * hl * 0.6, y1 + Math.sin(ang) * hl * 0.6);
        ctx.lineTo(x1 + Math.cos(ang + 2.4) * hl, y1 + Math.sin(ang + 2.4) * hl);
        ctx.lineTo(x1 + Math.cos(ang - 2.4) * hl, y1 + Math.sin(ang - 2.4) * hl);
        ctx.closePath(); ctx.fillStyle = col + '0.7)'; ctx.fill();
        // 作戦名
        const mx = 0.25 * x0 + 0.5 * cx + 0.25 * x1, my = 0.25 * y0 + 0.5 * cy + 0.25 * y1;
        const fs = Math.max(10 * px, S * 1.1);
        ctx.font = `italic 900 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const label = (ok ? '✓ ' : '') + op.name;
        ctx.lineWidth = fs * 0.28; ctx.strokeStyle = 'rgba(250,240,215,0.85)'; ctx.strokeText(label, mx, my);
        ctx.fillStyle = ok ? 'rgb(40,90,30)' : 'rgb(140,20,10)'; ctx.fillText(label, mx, my);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // 砦
    drawForts() {
      const ctx = this.ctx, sim = this.sim, S = this.S, px = this.ui / this.cam.z;
      const zs = this.cam.z * S;
      if (!sim.forts.length) return;
      const pulse = (performance.now() % 1000) / 1000;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const f of sim.forts) {
        const n = sim.nations[f.owner];
        if (!n) continue;
        const x = (f.x + 0.5) * S, y = (f.y + 0.5) * S, u = px * 1.1;
        if (f.besieged >= sim.t - 3) {
          ctx.beginPath(); ctx.arc(x, y, (8 + pulse * 5) * px, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(190,30,20,${0.9 - pulse * 0.8})`; ctx.lineWidth = 2 * px; ctx.stroke();
          ctx.fillStyle = 'rgba(40,25,15,0.7)'; ctx.fillRect(x - 7 * px, y + 6 * px, 14 * px, 2.5 * px);
          ctx.fillStyle = 'rgb(200,60,40)'; ctx.fillRect(x - 7 * px, y + 6 * px, 14 * px * TW.clamp(f.hp / f.maxHp, 0, 1), 2.5 * px);
        }
        // 塔
        ctx.beginPath();
        ctx.moveTo(x - 4 * u, y + 4 * u); ctx.lineTo(x - 4 * u, y - 3 * u);
        ctx.lineTo(x - 2.7 * u, y - 3 * u); ctx.lineTo(x - 2.7 * u, y - 4.5 * u); ctx.lineTo(x - 1.3 * u, y - 4.5 * u); ctx.lineTo(x - 1.3 * u, y - 3 * u);
        ctx.lineTo(x + 1.3 * u, y - 3 * u); ctx.lineTo(x + 1.3 * u, y - 4.5 * u); ctx.lineTo(x + 2.7 * u, y - 4.5 * u); ctx.lineTo(x + 2.7 * u, y - 3 * u);
        ctx.lineTo(x + 4 * u, y - 3 * u); ctx.lineTo(x + 4 * u, y + 4 * u); ctx.closePath();
        ctx.fillStyle = 'rgb(214,198,166)'; ctx.fill();
        ctx.strokeStyle = 'rgb(50,34,22)'; ctx.lineWidth = 1.2 * px; ctx.stroke();
        ctx.fillStyle = 'rgb(50,34,22)'; ctx.fillRect(x - 1 * u, y + 1 * u, 2 * u, 3 * u);
        ctx.beginPath(); ctx.moveTo(x, y - 4.5 * u); ctx.lineTo(x, y - 9 * u); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y - 9 * u); ctx.lineTo(x + 4.5 * u, y - 8 * u); ctx.lineTo(x, y - 6.8 * u); ctx.closePath();
        ctx.fillStyle = n.css; ctx.fill(); ctx.stroke();
        if (zs >= 6) {
          ctx.font = `700 ${8.5 * px}px ${FONT}`;
          ctx.lineWidth = 2.4 * px; ctx.strokeStyle = 'rgba(246,236,210,0.9)'; ctx.strokeText(f.name, x, y + 5.5 * u);
          ctx.fillStyle = 'rgb(60,40,24)'; ctx.fillText(f.name, x, y + 5.5 * u);
        }
      }
      ctx.restore();
    }

    drawEffects(now) {
      const ctx = this.ctx, sim = this.sim, S = this.S, px = this.ui / this.cam.z;
      ctx.save();
      const keep = [];
      for (const e of sim.effects) {
        const dur = e.type === 'threat' ? 7000 : ['plague', 'disaster', 'bless'].includes(e.type) ? 4500 : 2600;
        const k = Math.max(0, (now - e.born) / dur);
        if (k >= 1) continue;
        keep.push(e);
        const x = (e.x + 0.5) * S, y = (e.y + 0.5) * S, R = e.r * S;
        const a = 1 - k;
        if (e.type === 'flagfall') {
          // 撃破された軍の旗が倒れる
          const ang = Math.min(1, k * 1.6) * Math.PI / 2 * 0.95;
          ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y + 3 * px); ctx.rotate(ang);
          ctx.strokeStyle = 'rgb(40,26,16)'; ctx.lineWidth = 1.3 * px;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -17 * px); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, -17 * px); ctx.lineTo(12 * px, -15 * px); ctx.lineTo(12 * px, -9 * px); ctx.lineTo(0, -10 * px); ctx.closePath();
          ctx.fillStyle = e.color || '#888'; ctx.fill(); ctx.stroke();
          ctx.restore();
          continue;
        }
        if (e.type === 'threat') {
          for (let q = 0; q < 4; q++) {
            const kk = TW.clamp(k * 1.3 - q * 0.12, 0, 1);
            ctx.globalAlpha = (1 - kk) * 0.9; ctx.beginPath(); ctx.arc(x, y, R * (0.2 + kk * 1.5), 0, Math.PI * 2);
            ctx.strokeStyle = 'rgb(120,20,90)'; ctx.lineWidth = 4 * px; ctx.stroke();
          }
          ctx.globalAlpha = 1;
          continue;
        }
        if (e.type === 'merge') {
          ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x, y, (4 + k * 10) * px, 0, Math.PI * 2);
          ctx.strokeStyle = e.color || '#aa8'; ctx.lineWidth = 2 * px; ctx.stroke(); ctx.globalAlpha = 1;
          continue;
        }
        if (e.type === 'capture' || e.type === 'victory' || e.type === 'capital' || e.type === 'rebel' || e.type === 'destroy') {
          const rings = e.type === 'capital' || e.type === 'destroy' ? 3 : 1;
          for (let q = 0; q < rings; q++) {
            const kk = TW.clamp(k * 1.2 - q * 0.15, 0, 1);
            ctx.beginPath(); ctx.arc(x, y, R * (0.3 + kk), 0, Math.PI * 2);
            ctx.strokeStyle = e.type === 'destroy' ? `rgba(30,20,10,${a})` : e.type === 'rebel' ? `rgba(200,40,20,${a})` : (e.color || 'rgb(200,160,60)');
            ctx.globalAlpha = a; ctx.lineWidth = (e.type === 'victory' ? 2 : 3) * px; ctx.stroke();
          }
          if (e.type === 'capital') {
            ctx.globalAlpha = a; ctx.font = `${22 * px}px serif`; ctx.textAlign = 'center';
            ctx.fillText('👑', x, y - 16 * px - k * 20 * px);
          }
          if (e.type === 'rebel') {
            ctx.globalAlpha = a; ctx.font = `${20 * px}px serif`; ctx.textAlign = 'center';
            ctx.fillText('🔥', x, y - 14 * px - k * 16 * px);
          }
          if (e.type === 'destroy') {
            ctx.globalAlpha = a; ctx.font = `${22 * px}px serif`; ctx.textAlign = 'center';
            ctx.fillText('💀', x, y - 16 * px - k * 16 * px);
          }
        } else if (e.type === 'plague') {
          const g = ctx.createRadialGradient(x, y, 0, x, y, R);
          g.addColorStop(0, `rgba(90,120,40,${0.45 * a})`); g.addColorStop(1, 'rgba(90,120,40,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = a; ctx.font = `${26 * px}px serif`; ctx.textAlign = 'center'; ctx.fillText('☠️', x, y);
        } else if (e.type === 'disaster') {
          ctx.globalAlpha = a;
          ctx.strokeStyle = 'rgba(80,40,10,0.9)'; ctx.lineWidth = 2 * px;
          for (let q = 0; q < 8; q++) {
            const an = q * Math.PI / 4 + 0.3;
            ctx.beginPath(); ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(an) * R * 0.5, y + Math.sin(an + 0.3) * R * 0.5);
            ctx.lineTo(x + Math.cos(an + 0.2) * R, y + Math.sin(an) * R); ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(x, y, R * (0.5 + k * 0.5), 0, Math.PI * 2); ctx.stroke();
          ctx.font = `${26 * px}px serif`; ctx.textAlign = 'center'; ctx.fillText('🌋', x, y);
        } else if (e.type === 'bless') {
          ctx.globalAlpha = a;
          const g = ctx.createRadialGradient(x, y, 0, x, y, R);
          g.addColorStop(0, 'rgba(255,230,120,0.7)'); g.addColorStop(1, 'rgba(255,230,120,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(220,170,40,0.9)'; ctx.lineWidth = 2 * px;
          for (let q = 0; q < 12; q++) {
            const an = q * Math.PI / 6 + k;
            ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * R * 0.3, y + Math.sin(an) * R * 0.3);
            ctx.lineTo(x + Math.cos(an) * R * (0.6 + k * 0.4), y + Math.sin(an) * R * (0.6 + k * 0.4)); ctx.stroke();
          }
        }
      }
      sim.effects = keep;
      ctx.restore();
    }

    drawCursor() {
      if (!this.mouse || !['plague', 'disaster', 'incite', 'threat'].includes(this.tool)) return;
      const ctx = this.ctx, S = this.S, px = this.ui / this.cam.z;
      const p = this.screenToWorld(this.mouse.x, this.mouse.y);
      const R = (this.tool === 'plague' ? 10 : this.tool === 'disaster' ? 7 : this.tool === 'threat' ? 3 : 1.5) * S;
      ctx.save();
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeStyle = this.tool === 'plague' ? 'rgba(70,110,30,0.95)' : this.tool === 'disaster' ? 'rgba(120,50,10,0.95)' : this.tool === 'threat' ? 'rgba(130,30,110,0.95)' : 'rgba(200,40,20,0.95)';
      ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // ---------- エディタ ----------
    drawEditor(ed) {
      const ctx = this.ctx, S = this.S, px = this.ui / this.cam.z;
      if (ed.dirty) ed.rebuild();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ed.cv, 0, 0, this.WW, this.WH);
      ctx.imageSmoothingEnabled = true;
      if (this.cam.z * S >= 10) {
        ctx.strokeStyle = 'rgba(70,50,30,0.12)'; ctx.lineWidth = px;
        ctx.beginPath();
        for (let x = 0; x <= ed.W; x++) { ctx.moveTo(x * S, 0); ctx.lineTo(x * S, this.WH); }
        for (let y = 0; y <= ed.H; y++) { ctx.moveTo(0, y * S); ctx.lineTo(this.WW, y * S); }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(60,44,30,0.9)'; ctx.lineWidth = 2 * px; ctx.strokeRect(0, 0, this.WW, this.WH);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ed.capitals.forEach(([cx, cy], k) => {
        const x = (cx + 0.5) * S, y = (cy + 0.5) * S;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 18 * px); ctx.lineWidth = 1.6 * px; ctx.strokeStyle = 'rgb(40,26,16)'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y - 18 * px); ctx.lineTo(x + 14 * px, y - 15 * px); ctx.lineTo(x, y - 11 * px); ctx.closePath();
        ctx.fillStyle = TW.rgbCss(TW.hslToRgb(k * 0.137, 0.55, 0.5)); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 5 * px, 0, Math.PI * 2); ctx.fillStyle = 'rgb(250,240,215)'; ctx.fill(); ctx.stroke();
        ctx.font = `700 ${7 * px}px sans-serif`; ctx.fillStyle = 'rgb(40,26,16)'; ctx.fillText(String(k + 1), x, y + 0.5 * px);
      });
      if (this.mouse && (ed.tool === 'land' || ed.tool === 'sea')) {
        const p = this.screenToWorld(this.mouse.x, this.mouse.y);
        ctx.setLineDash([5 * px, 4 * px]);
        ctx.beginPath(); ctx.arc(p.x, p.y, ed.brush * S, 0, Math.PI * 2);
        ctx.strokeStyle = ed.tool === 'land' ? 'rgba(90,60,20,0.95)' : 'rgba(30,80,110,0.95)';
        ctx.lineWidth = 2 * px; ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }
  TW.Renderer = Renderer;
})();
