/**
 * renderer 侧 window.pet 类型声明 —— 审查修复 #8。
 * 与 electron/preload/index.ts 的 PetApi 保持同步（两处都是手工维护的最小契约）。
 * tsconfig.web.json 已 include src/**，此全局声明让 renderer 获得完整类型而非断言绕过。
 */
import type { PetApi } from '../../electron/preload/index';

declare global {
  interface Window {
    pet: PetApi;
  }
}

export {};
