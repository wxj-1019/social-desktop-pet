/* eslint-disable no-console -- CLI 工具，输出即产品 */
/**
 * 生成托盘图标（apps/desktop/resources/tray.png）。
 *
 * 32x32 透明 PNG：星屿（蓝紫大耳星尾狐猫）头部 + 尾星。
 * 用直接像素绘制循环（每个像素独立判定点形/星形），保证可维护、无外部素材依赖。
 * 颜色沿用 renderer 星屿 SVG（star-isle-visual.tsx）：
 *   - fur #cbdaf5（头）
 *   - outerEar #7188c8（大耳，深蓝）
 *   - star #ffe094（尾星，金黄）
 *
 * 用法：pnpm assets:tray（等价 node tools/generate-tray-icon.mjs）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

const SIZE = 32;

const FUR = { r: 0xcb, g: 0xda, b: 0xf5 };
const OUTER_EAR = { r: 0x71, g: 0x88, b: 0xc8 };
const STAR_GOLD = { r: 0xff, g: 0xe0, b: 0x94 };

// 头：椭圆（画布坐标，32x32 中心偏下）
const HEAD = { cx: 15.5, cy: 19.5, rx: 9.5, ry: 8.5 };

// 大耳：两个朝外的三角形（耳尖伸到画布顶）
const LEFT_EAR = [
  [5, 13],
  [9, 2],
  [16, 11],
];
const RIGHT_EAR = [
  [16, 11],
  [23, 2],
  [27, 13],
];

// 尾星：中心点 + 内/外半径
const TAIL_STAR = { cx: 27, cy: 27, outer: 5.6, inner: 2.6 };

function inEllipse(x, y, e) {
  const dx = (x - e.cx) / e.rx;
  const dy = (y - e.cy) / e.ry;
  return dx * dx + dy * dy <= 1;
}

/** 射线法点形判定（支持任意凸/凹多边形顶点） */
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 五角星顶点（10 点交替外/内半径） */
function starPolygon(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return pts;
}

const TAIL_STAR_POLY = starPolygon(TAIL_STAR.cx, TAIL_STAR.cy, TAIL_STAR.outer, TAIL_STAR.inner);

/** 取像素颜色：null = 透明 */
function colorAt(x, y) {
  if (inPolygon(x, y, LEFT_EAR) || inPolygon(x, y, RIGHT_EAR)) return OUTER_EAR;
  if (inPolygon(x, y, TAIL_STAR_POLY)) return STAR_GOLD;
  if (inEllipse(x, y, HEAD)) return FUR;
  return null;
}

function render() {
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 取像素中心采样，避免半像素边界抖动
      const color = colorAt(x + 0.5, y + 0.5);
      if (!color) continue;
      const idx = (SIZE * y + x) << 2;
      png.data[idx] = color.r;
      png.data[idx + 1] = color.g;
      png.data[idx + 2] = color.b;
      png.data[idx + 3] = 0xff;
    }
  }
  return PNG.sync.write(png);
}

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'desktop',
  'resources',
  'tray.png',
);
mkdirSync(dirname(outPath), { recursive: true });
const buffer = render();
writeFileSync(outPath, buffer);
console.log(`tray icon written: ${outPath} (${buffer.length} bytes)`);
