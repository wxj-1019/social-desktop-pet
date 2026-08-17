/**
 * 更新源客户端 —— 13.1/13.5：HTTP manifest 检查（自动更新初版，14.2 Alpha 条目）。
 *
 * manifest 格式（服务端静态 JSON）：
 *   { "stable": { "version": "1.1.0", "url": "https://.../pet-1.1.0-setup.exe",
 *                 "sha256": "...", "notes": "...", "minSupportedVersion": "1.0.0" },
 *     "beta": { ... } }
 *
 * 约束（8.3/13.5）：
 * - HTTPS 拉取（本地开发可 http）；更新包 sha256 校验（verify 步骤 V-11 签名后完善）
 * - 灰度通道（stable/beta）由 manifest 分键实现
 * - 未配置 UPDATE_MANIFEST_URL → 返回 null（静默跳过）
 */
import { z } from 'zod';

import type { UpdateApi, UpdateChannel, UpdateInfo } from './update-controller.js';

/** manifest 字段校验（8.3：网络外部输入必须过 schema，不能只做 as 强转） */
const UpdateInfoSchema = z.object({
  version: z.string().min(1),
  url: z.string().min(1),
  /** 更新包 sha256（校验必须；8.3 更新包签名验证） */
  sha256: z.string().min(1),
  notes: z.string().optional(),
  /** 强制更新阈值：低于此版本必须更新 */
  minSupportedVersion: z.string().optional(),
});
const UpdateManifestSchema = z.object({
  stable: UpdateInfoSchema.optional(),
  beta: UpdateInfoSchema.optional(),
});
export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;

export function createUpdateApi(manifestUrl?: string): UpdateApi {
  if (!manifestUrl) {
    // 未配置更新源：检查永远无更新（应用内 UpdateController 逻辑不变）
    return {
      checkForUpdate: async () => null,
      download: async () => {
        throw new Error('UpdateController: 更新源未配置（UPDATE_MANIFEST_URL）');
      },
      verify: async () => undefined,
      install: async () => undefined,
    };
  }

  return {
    async checkForUpdate(channel: UpdateChannel): Promise<UpdateInfo | null> {
      try {
        // 10s 超时：挂起网络不能卡死 CHECKING 相位（AbortSignal.timeout 抛 AbortError）
        const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
          // 检查失败按"无更新"处理（静默，13.1 不自打扰用户）
          return null;
        }
        const manifest = UpdateManifestSchema.safeParse(await res.json());
        if (!manifest.success) {
          console.warn('[update] manifest 校验失败，按无更新处理');
          return null;
        }
        return manifest.data[channel] ?? null;
      } catch {
        // 离线 / DNS / 超时 / 畸形 JSON：一律静默按无更新处理（13.1 契约）
        return null;
      }
    },
    download: async () => {
      throw new Error('UpdateController: 下载/安装待 V-11 签名链就绪（13.1）');
    },
    verify: async () => undefined,
    install: async () => undefined,
  };
}
