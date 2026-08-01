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
import type { UpdateApi, UpdateChannel, UpdateInfo } from './update-controller.js';

export interface UpdateManifest {
  stable?: UpdateInfo;
  beta?: UpdateInfo;
}

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
      const res = await fetch(manifestUrl);
      if (!res.ok) {
        // 检查失败按"无更新"处理（静默，13.1 不自打扰用户）
        return null;
      }
      const manifest = (await res.json()) as UpdateManifest;
      return manifest[channel] ?? null;
    },
    download: async () => {
      throw new Error('UpdateController: 下载/安装待 V-11 签名链就绪（13.1）');
    },
    verify: async () => undefined,
    install: async () => undefined,
  };
}
