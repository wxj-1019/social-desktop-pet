/**
 * 每角色专属错误降级（形象协议阶段 C，§11.8）。
 *
 * VisualComponent 渲染抛错时，PetVisualBoundary 降级到"该角色"的静态
 * 剪影，而不是统一变成星屿（旧 PetFallback 行为）。spritesheet/图片角色
 * 复用各自模块的 renderStatic* 静态标记输出（与动画组件不同代码路径，
 * 组件本体崩溃时静态标记仍可渲染）；星屿沿用 PetFallback。
 */
import { renderStaticCreamKitten } from './image-visual.js';
import { PetFallback } from './pet-fallback.js';
import { renderStaticSpritesheet } from './spritesheet-visual.js';

function StaticMarkupFallback({ html, testId }: { html: string; testId: string }) {
  return <div data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CodenonoFallback() {
  return <StaticMarkupFallback html={renderStaticSpritesheet()} testId="codenono-fallback" />;
}

export function CreamKittenFallback() {
  return <StaticMarkupFallback html={renderStaticCreamKitten()} testId="cream-kitten-fallback" />;
}

export { PetFallback };
