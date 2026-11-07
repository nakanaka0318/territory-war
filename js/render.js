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
      this.fit();
    }
    setSim(sim) { this.sim = sim; this.lastTerr = 0; sim.dirty = true; }

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
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.base, 0, 0);
      const sim = this.sim;
      if (!sim) return;
      if ((sim.dirty || this.terrSel !== this.selectedUid) && now - this.lastTerr > 110) {
        this.buildTerritory(); this.lastTerr = now; this.terrSel = this.selectedUid;
      }
      ctx.drawImage(this.terr, 0, 0);
      this.drawArrows();
      this.drawCities();
      this.drawLabels();
      this.drawArmies();
      this.drawEffects(now);
      this.drawCursor();
    }

    armyPos(a) {
      const S = this.S, W = this.w.W;
      let x = a.x, y = a.y;
      if (a.path && a.pi < a.path.length && !a.fighting && a.mode !== 'siege') {
        const n = a.path[a.pi];
        x += ((n % W) - a.x) * a.prog; y += (((n / W) | 0) - a.y) * a.prog;
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
      ctx.restore();
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

    drawArmies() {
      const ctx = this.ctx, sim = this.sim, px = this.ui / this.cam.z, w = this.w;
      const t = performance.now() / 1000;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = `700 ${9.5 * px}px ${FONT}`;
      const byId = new Map(sim.armies.map(a => [a.id, a]));
      // 戦闘マーク
      for (const a of sim.armies) {
        if (!a.fighting) continue;
        const b = byId.get(a.fighting);
        if (!b || b.id < a.id && b.fighting === a.id) continue;
        const [ax, ay] = this.armyPos(a), [bx, by] = this.armyPos(b);
        const mx = (ax + bx) / 2, my = (ay + by) / 2 - 10 * px;
        const s = (6 + Math.sin(t * 10 + a.id) * 1.2) * px;
        ctx.strokeStyle = 'rgb(150,20,10)'; ctx.lineWidth = 2.4 * px;
        ctx.beginPath(); ctx.moveTo(mx - s, my - s); ctx.lineTo(mx + s, my + s); ctx.moveTo(mx + s, my - s); ctx.lineTo(mx - s, my + s); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,230,180,0.9)'; ctx.lineWidth = 1 * px;
        for (let k = 0; k < 6; k++) {
          const an = k * Math.PI / 3 + t * 3;
          ctx.beginPath(); ctx.moveTo(mx + Math.cos(an) * s * 1.3, my + Math.sin(an) * s * 1.3);
          ctx.lineTo(mx + Math.cos(an) * s * 1.9, my + Math.sin(an) * s * 1.9); ctx.stroke();
        }
      }
      for (const a of sim.armies) {
        const n = sim.nations[a.n];
        const [x, y] = this.armyPos(a);
        const sea = !w.land[a.i];
        const sc = TW.clamp(0.85 + Math.sqrt(a.str) * 0.045, 0.85, 1.5) * px;
        ctx.lineWidth = 1.3 * px; ctx.strokeStyle = 'rgb(40,26,16)';
        if (sea) {
          ctx.beginPath();
          ctx.moveTo(x - 8 * sc, y); ctx.lineTo(x + 8 * sc, y); ctx.lineTo(x + 5 * sc, y + 4 * sc); ctx.lineTo(x - 5 * sc, y + 4 * sc); ctx.closePath();
          ctx.fillStyle = 'rgb(120,86,56)'; ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 12 * sc); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + 1 * sc, y - 11 * sc); ctx.lineTo(x + 7 * sc, y - 3 * sc); ctx.lineTo(x + 1 * sc, y - 2 * sc); ctx.closePath();
          ctx.fillStyle = n.css; ctx.fill(); ctx.stroke();
        } else {
          const wave = a.path && !a.fighting ? Math.sin(t * 6 + a.id) * 1.2 : 0;
          ctx.beginPath(); ctx.moveTo(x, y + 3 * sc); ctx.lineTo(x, y - 13 * sc); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x, y - 13 * sc); ctx.lineTo(x + 10 * sc, y - 12 * sc + wave * sc);
          ctx.lineTo(x + 10 * sc, y - 6 * sc + wave * sc); ctx.lineTo(x, y - 7 * sc); ctx.closePath();
          ctx.fillStyle = n.css; ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.ellipse(x, y + 3 * sc, 3.5 * sc, 1.5 * sc, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(40,26,16,0.35)'; ctx.fill();
        }
        if (this.cam.z * this.S >= 3) {
          const label = TW.fmtTroops(a.str);
          ctx.lineWidth = 2.6 * px; ctx.strokeStyle = 'rgba(246,236,210,0.9)';
          ctx.strokeText(label, x, y + 5 * sc);
          ctx.fillStyle = a.mode === 'home' ? 'rgb(110,90,70)' : 'rgb(40,26,16)';
          ctx.fillText(label, x, y + 5 * sc);
        }
      }
      ctx.restore();
    }

    drawEffects(now) {
      const ctx = this.ctx, sim = this.sim, S = this.S, px = this.ui / this.cam.z;
      ctx.save();
      const keep = [];
      for (const e of sim.effects) {
        const dur = ['plague', 'disaster', 'bless'].includes(e.type) ? 4500 : 2600;
        const k = (now - e.born) / dur;
        if (k >= 1) continue;
        keep.push(e);
        const x = (e.x + 0.5) * S, y = (e.y + 0.5) * S, R = e.r * S;
        const a = 1 - k;
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
      if (!this.mouse || !['plague', 'disaster', 'incite'].includes(this.tool)) return;
      const ctx = this.ctx, S = this.S, px = this.ui / this.cam.z;
      const p = this.screenToWorld(this.mouse.x, this.mouse.y);
      const R = (this.tool === 'plague' ? 10 : this.tool === 'disaster' ? 7 : 1.5) * S;
      ctx.save();
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeStyle = this.tool === 'plague' ? 'rgba(70,110,30,0.95)' : this.tool === 'disaster' ? 'rgba(120,50,10,0.95)' : 'rgba(200,40,20,0.95)';
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
