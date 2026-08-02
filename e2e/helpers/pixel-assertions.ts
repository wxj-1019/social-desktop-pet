/**
 * 像素断言 —— 透明桌宠窗的"角色真实可见"验证（冷启动 + 非空白帧）。
 *
 * 思路：窗口透明背景（alpha=0），角色 SVG 填充不透明（alpha=255，边缘抗锯齿
 * alpha 介于中间）。`page.screenshot({ omitBackground: true })` 拿到 RGBA 位图后，
 * 统计 alpha > 16 的像素数即可判断角色是否真的画出来了（而非空窗口/白屏）。
 *
 * 依赖 pngjs（root devDependencies，Task 10 已加入 ^7.0.0 + @types/pngjs）。
 */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';

/** 像素区域（缺省 = 全窗口，即"body 区域"） */
export interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** PNG.sync.read 的解码结果最小形态 */
export interface DecodedPng {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * 统计区域内 alpha 通道 > 16 的像素数。
 * 阈值 16 只排除透明/极淡抗锯齿像素，不排除正常半透明渐变。
 */
export function countVisiblePixels(png: DecodedPng, region?: Partial<PixelRegion>): number {
  const r = {
    x: region?.x ?? 0,
    y: region?.y ?? 0,
    width: region?.width ?? png.width,
    height: region?.height ?? png.height,
  };
  const x1 = Math.max(0, Math.min(png.width, r.x));
  const y1 = Math.max(0, Math.min(png.height, r.y));
  const x2 = Math.max(x1, Math.min(png.width, r.x + r.width));
  const y2 = Math.max(y1, Math.min(png.height, r.y + r.height));
  let count = 0;
  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      const alpha = png.data[(y * png.width + x) * 4 + 3];
      if (alpha > 16) count += 1;
    }
  }
  return count;
}

/** 对窗口页面截图（omitBackground → 透明窗 alpha 保留）并解码 */
export async function capturePng(page: Page): Promise<DecodedPng> {
  const shot = await page.screenshot({ omitBackground: true });
  return PNG.sync.read(shot);
}

/**
 * 断言桌宠窗口的可见像素数超过阈值（默认 8000，依据见 star-isle.spec.ts
 * 冷启动用例的注释）。返回实际可见像素数。
 */
export async function assertBodyVisible(
  page: Page,
  region?: Partial<PixelRegion>,
  threshold = 8_000,
): Promise<number> {
  const png = await capturePng(page);
  const count = countVisiblePixels(png, region);
  expect(count).toBeGreaterThan(threshold);
  return count;
}
