/* eslint-disable no-console -- CLI 工具，输出即产品 */
/**
 * 生成应用图标（apps/desktop/resources/icon.ico）。
 *
 * 占位图标（V-12 角色/视觉资产就绪后替换）：256 基准绘制的星屿头像 ——
 * 深靛星空圆角底 + 蓝紫大耳浅蓝头 + 额间暖黄星冠 + 尾星，多尺寸 ICO
 * （16/24/32/48/64/128/256，全部 PNG 压缩条目，Windows Vista+ 原生支持）。
 *
 * 颜色与角色语义沿用 renderer 星屿 SVG（star-isle-visual.tsx）：
 *   - fur #cbdaf5（头）· outerEar #7188c8（深蓝大耳）· innerEar #8199d5
 *   - pupil #415277 · blush #f2aabd · mouth #795b77 · star #ffe094（星光）
 *
 * 用法：pnpm assets:icon（等价 node tools/generate-app-icon.mjs）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

/** 图标尺寸档位（px；ICO 中 256 以 0 记宽高） */
const SIZES = [256, 128, 64, 48, 32, 24, 16];

const FUR = { r: 0xcb, g: 0xda, b: 0xf5 };
const OUTER_EAR = { r: 0x71, g: 0x88, b: 0xc8 };
const INNER_EAR = { r: 0x81, g: 0x99, b: 0xd5 };
const PUPIL = { r: 0x41, g: 0x52, b: 0x77 };
const BLUSH = { r: 0xf2, g: 0xaa, b: 0xbd };
const MOUTH = { r: 0x79, g: 0x5b, b: 0x77 };
const STAR = { r: 0xff, g: 0xe0, b: 0x94 };
const WHITE = { r: 0xff, g: 0xff, b: 0xff };
/** 深靛夜空背景（上→下渐变） */
const BG_TOP = { r: 0x3d, g: 0x44, b: 0x85 };
const BG_BOTTOM = { r: 0x24, g: 0x29, b: 0x55 };

/** 圆角底：256 坐标，边距 8、圆角 56 */
const BG = { x0: 8, y0: 8, x1: 248, y1: 248, r: 56 };

/** 背景小星点（点缀尾星对侧的留白） */
const BG_STARS = [
  { x: 44, y: 46, r: 3 },
  { x: 66, y: 88, r: 2 },
  { x: 38, y: 128, r: 2.4 },
  { x: 222, y: 196, r: 2.4 },
  { x: 200, y: 224, r: 2 },
];

/** 大耳：两个朝外三角形（外耳 + 内耳） */
const LEFT_EAR = [
  [56, 132],
  [84, 28],
  [128, 92],
];
const RIGHT_EAR = [
  [128, 92],
  [172, 28],
  [200, 132],
];
const LEFT_INNER_EAR = [
  [74, 116],
  [90, 54],
  [116, 96],
];
const RIGHT_INNER_EAR = [
  [140, 96],
  [166, 54],
  [182, 116],
];

/** 头：椭圆（居中偏下） */
const HEAD = { cx: 128, cy: 164, rx: 92, ry: 78 };
/** 腮红 */
const CHEEK_LEFT = { cx: 82, cy: 188, rx: 14, ry: 9 };
const CHEEK_RIGHT = { cx: 174, cy: 188, rx: 14, ry: 9 };
/** 瞳孔（椭圆）+ 高光 */
const EYE_LEFT = { cx: 98, cy: 156, rx: 7.5, ry: 10.5 };
const EYE_RIGHT = { cx: 158, cy: 156, rx: 7.5, ry: 10.5 };
const EYE_GLINT_LEFT = { cx: 100, cy: 152, r: 2.6 };
const EYE_GLINT_RIGHT = { cx: 160, cy: 152, r: 2.6 };
/** 嘴：小椭圆 */
const MOUTH_ARC = { cx: 128, cy: 183, rx: 6.5, ry: 3.6 };
/** 额间星冠 */
const CROWN_STAR = { cx: 128, cy: 106, outer: 12.5, inner: 5.6 };
/** 尾星（右上角） */
const TAIL_STAR = { cx: 212, cy: 52, outer: 29, inner: 13 };

function inEllipse(x, y, e) {
  const dx = (x - e.cx) / e.rx;
  const dy = (y - e.cy) / e.ry;
  return dx * dx + dy * dy <= 1;
}

function inCircle(x, y, c) {
  const dx = x - c.cx;
  const dy = y - c.cy;
  return dx * dx + dy * dy <= c.r * c.r;
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

const CROWN_STAR_POLY = starPolygon(
  CROWN_STAR.cx,
  CROWN_STAR.cy,
  CROWN_STAR.outer,
  CROWN_STAR.inner,
);
const TAIL_STAR_POLY = starPolygon(TAIL_STAR.cx, TAIL_STAR.cy, TAIL_STAR.outer, TAIL_STAR.inner);

function inRoundedRect(x, y, b) {
  if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false;
  const cx = Math.max(b.x0 + b.r, Math.min(x, b.x1 - b.r));
  const cy = Math.max(b.y0 + b.r, Math.min(y, b.y1 - b.r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= b.r * b.r;
}

/** 背景渐变插值 */
function bgColor(y) {
  const t = (y - BG.y0) / (BG.y1 - BG.y0);
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  return {
    r: lerp(BG_TOP.r, BG_BOTTOM.r),
    g: lerp(BG_TOP.g, BG_BOTTOM.g),
    b: lerp(BG_TOP.b, BG_BOTTOM.b),
  };
}

/** 取像素颜色（256 设计坐标）；null = 透明。后绘制的部件优先。 */
function colorAt(x, y) {
  if (!inRoundedRect(x, y, BG)) return null;
  for (const s of BG_STARS) if (inCircle(x, y, s)) return STAR;
  let color = bgColor(y);
  // 图层优先级：背景 → 大耳 → 尾星 → 头 → 面部 → 内耳（头外部分）→ 星光
  if (inPolygon(x, y, LEFT_EAR) || inPolygon(x, y, RIGHT_EAR)) color = OUTER_EAR;
  if (inPolygon(x, y, TAIL_STAR_POLY)) color = STAR;
  if (inEllipse(x, y, HEAD)) {
    color = FUR;
    if (inEllipse(x, y, CHEEK_LEFT) || inEllipse(x, y, CHEEK_RIGHT)) color = BLUSH;
    if (inEllipse(x, y, EYE_LEFT) || inEllipse(x, y, EYE_RIGHT)) color = PUPIL;
    if (inCircle(x, y, EYE_GLINT_LEFT) || inCircle(x, y, EYE_GLINT_RIGHT)) color = WHITE;
    if (inEllipse(x, y, MOUTH_ARC)) color = MOUTH;
    if (inPolygon(x, y, CROWN_STAR_POLY)) color = STAR;
  }
  // 内耳：只在头椭圆之外的耳区可见（头遮住耳根，露出上半内耳）
  if (
    !inEllipse(x, y, HEAD) &&
    (inPolygon(x, y, LEFT_INNER_EAR) || inPolygon(x, y, RIGHT_INNER_EAR))
  ) {
    color = INNER_EAR;
  }
  return color;
}

/** 渲染单档尺寸（256 设计坐标按比例缩放，各档独立抗锯齿采样） */
function renderPng(size) {
  const png = new PNG({ width: size, height: size });
  const scale = size / 256;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 像素中心映射回设计坐标采样
      const color = colorAt((x + 0.5) / scale, (y + 0.5) / scale);
      const idx = (size * y + x) << 2;
      if (!color) {
        png.data[idx + 3] = 0;
        continue;
      }
      png.data[idx] = color.r;
      png.data[idx + 1] = color.g;
      png.data[idx + 2] = color.b;
      png.data[idx + 3] = 0xff;
    }
  }
  return PNG.sync.write(png);
}

/** 打包 ICO（PNG 压缩条目：ICONDIR + ICONDIRENTRY[] + PNG blobs） */
function packIco(pngs) {
  const count = pngs.length;
  const headerSize = 6 + 16 * count;
  const dir = Buffer.alloc(headerSize);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(count, 4);
  const blobs = [];
  let offset = headerSize;
  pngs.forEach((png, i) => {
    const dim = png.size === 256 ? 0 : png.size; // ICO 约定：0 表示 256
    const entry = 6 + 16 * i;
    dir.writeUInt8(dim, entry);
    dir.writeUInt8(dim, entry + 1);
    dir.writeUInt8(0, entry + 2); // colorCount
    dir.writeUInt8(0, entry + 3); // reserved
    dir.writeUInt16LE(1, entry + 4); // planes
    dir.writeUInt16LE(32, entry + 6); // bitCount
    dir.writeUInt32LE(png.buffer.length, entry + 8);
    dir.writeUInt32LE(offset, entry + 12);
    offset += png.buffer.length;
    blobs.push(png.buffer);
  });
  return Buffer.concat([dir, ...blobs]);
}

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'desktop',
  'resources',
  'icon.ico',
);
mkdirSync(dirname(outPath), { recursive: true });
const pngs = SIZES.map((size) => ({ size, buffer: renderPng(size) }));
const ico = packIco(pngs);
writeFileSync(outPath, ico);
console.log(`app icon written: ${outPath} (${ico.length} bytes, ${SIZES.length} sizes)`);
