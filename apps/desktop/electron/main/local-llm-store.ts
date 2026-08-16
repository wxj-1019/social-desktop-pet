/**
 * LocalLlmStore —— 本地 BYOK 模型配置持久化（OpenAI 兼容端点）。
 *
 * 密钥经 Electron safeStorage 加密后落盘（不可用时明文兜底并标记，
 * 仅存在于用户本机 userData）；对外 view() 不回传密钥，只暴露 hasApiKey。
 * apiKey 传空表示"保留已保存的密钥"（仅更新 baseUrl/model/enabled）。
 */
import type { LocalLlmConfig, LocalLlmConfigView } from '@pet/protocol';
import { safeStorage } from 'electron';
import { z } from 'zod';

import { AtomicJsonStore } from './atomic-json-store.js';

const StoredLocalLlmSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    baseUrl: z.string(),
    model: z.string(),
    /** safeStorage 加密后的 base64；加密不可用时存明文 */
    apiKeyEnc: z.string(),
    apiKeyPlain: z.boolean(),
  })
  .strict();
type StoredLocalLlm = z.infer<typeof StoredLocalLlmSchema>;

const FALLBACK: StoredLocalLlm = {
  version: 1,
  enabled: false,
  baseUrl: '',
  model: '',
  apiKeyEnc: '',
  apiKeyPlain: false,
};

export class LocalLlmStore {
  private readonly store: AtomicJsonStore<StoredLocalLlm>;

  constructor(file: string) {
    this.store = new AtomicJsonStore(file, StoredLocalLlmSchema, FALLBACK);
  }

  /** 解密后的完整配置；从未配置过返回 null */
  load(): LocalLlmConfig | null {
    const stored = this.store.load();
    if (!stored.apiKeyEnc) return null;
    return {
      enabled: stored.enabled,
      baseUrl: stored.baseUrl,
      model: stored.model,
      apiKey: this.decrypt(stored.apiKeyEnc, stored.apiKeyPlain),
    };
  }

  /** 渲染层可见视图（无密钥） */
  view(): LocalLlmConfigView {
    const stored = this.store.load();
    return {
      enabled: stored.enabled,
      baseUrl: stored.baseUrl,
      model: stored.model,
      hasApiKey: stored.apiKeyEnc !== '',
    };
  }

  /**
   * 保存配置。apiKey 为空且已有密钥 → 保留旧密钥；否则要求非空（抛错）。
   * 返回保存后的视图。
   */
  save(config: LocalLlmConfig): LocalLlmConfigView {
    const current = this.store.load();
    let apiKeyEnc = current.apiKeyEnc;
    let apiKeyPlain = current.apiKeyPlain;
    if (config.apiKey !== '') {
      apiKeyEnc = this.encrypt(config.apiKey);
      apiKeyPlain = false;
    }
    if (!apiKeyEnc) {
      throw new Error('missing_api_key');
    }
    this.store.save({
      version: 1,
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyEnc,
      apiKeyPlain,
    });
    return this.view();
  }

  private encrypt(plain: string): string {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.encryptString(plain).toString('base64');
      }
    } catch {
      /* 加密不可用 → 明文兜底 */
    }
    return Buffer.from(plain, 'utf-8').toString('base64');
  }

  private decrypt(enc: string, plain: boolean): string {
    if (plain) return Buffer.from(enc, 'base64').toString('utf-8');
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return '';
    }
  }
}
