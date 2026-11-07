// 地球マップの陸地マスクを生成するスクリプト
// 使い方: npm install world-atlas@2.0.2 topojson-client@3.1.0 && node tools/build-earth.mjs > js/earth-data.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const topo = require('topojson-client');
const land50 = require('world-atlas/land-50m.json');

const W = 300, H = 150;            // グリッド
const LAT_TOP = 80, LAT_BOTTOM = -62;
const land = topo.feature(land50, land50.objects.land);

const polys = [];
for (const f of land.features) {
  const g = f.geometry;
  const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (let p of list) {
    // 日付変更線をまたぐポリゴンは経度を連続化 (西経90度より西に+360)
    let crosses = false;
    for (const ring of p) for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) crosses = true;
    if (crosses) p = p.map(ring => ring.map(([x, y]) => [x < -90 ? x + 360 : x, y]));
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [x, y] of p[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    polys.push({ rings: p, minX, minY, maxX, maxY });
  }
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function isLand(lon, lat) {
  return isLand0(lon, lat) || isLand0(lon + 360, lat);
}
function isLand0(lon, lat) {
  for (const p of polys) {
    if (lon < p.minX || lon > p.maxX || lat < p.minY || lat > p.maxY) continue;
    if (!inRing(lon, lat, p.rings[0])) continue;
    let hole = false;
    for (let k = 1; k < p.rings.length; k++) if (inRing(lon, lat, p.rings[k])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
const cells = new Uint8Array(W * H);
const SS = 3;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let c = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const lon = -180 + (x + (sx + 0.5) / SS) / W * 360;
      const lat = LAT_TOP - (y + (sy + 0.5) / SS) / H * (LAT_TOP - LAT_BOTTOM);
      if (isLand(lon, lat)) c++;
    }
    cells[y * W + x] = c * 2 >= SS * SS ? 1 : 0;
  }
}
// RLE (海から開始、交互)
const runs = [];
let cur = 0, n = 0;
for (let i = 0; i < cells.length; i++) {
  if (cells[i] === cur) n++;
  else { runs.push(n); cur = cells[i]; n = 1; }
}
runs.push(n);
console.log(`// 自動生成ファイル (tools/build-earth.mjs) — Natural Earth (world-atlas land-50m) を元にした陸地マスク
window.EARTH_MAP = { W: ${W}, H: ${H}, latTop: ${LAT_TOP}, latBottom: ${LAT_BOTTOM}, rle: "${runs.map(r => r.toString(36)).join(',')}" };`);
