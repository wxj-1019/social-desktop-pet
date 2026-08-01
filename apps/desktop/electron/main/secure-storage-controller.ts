/**
 * SecureStorageController —— 对应设计稿 8.3。
 *
 * 刷新令牌保存到 Windows 安全存储（Electron safeStorage = DPAPI 加密）或 macOS Keychain。
 * 绝不落明文：令牌经 safeStorage 加密后写本地文件。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { safeStorage } from 'electron';

export interface SecureStorageOptions {
  /** 存储目录（默认 app.getPath('userData')，由调用方注入以便测试） */
  dir: string;
}

const TOKEN_FILE = 'session-token.bin';

export class SecureStorageController {
  private readonly dir: string;

  constructor(options: SecureStorageOptions) {
    this.dir = options.dir;
    mkdirSync(this.dir, { recursive: true });
  }

  /** 系统加密是否可用（Windows DPAPI / macOS Keychain） */
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /** 保存令牌（加密后写文件） */
  setToken(token: string): void {
    if (!this.isEncryptionAvailable()) {
      throw new Error('SecureStorage: 系统加密不可用（Windows 需 DPAPI）');
    }
    const encrypted = safeStorage.encryptString(token);
    writeFileSync(join(this.dir, TOKEN_FILE), encrypted);
  }

  /** 读取令牌（解密）；不存在返回 null */
  getToken(): string | null {
    const file = join(this.dir, TOKEN_FILE);
    if (!existsSync(file)) return null;
    const encrypted = readFileSync(file);
    try {
      return safeStorage.decryptString(encrypted);
    } catch {
      // 解密失败（如系统密钥变化）→ 视为无令牌并清理
      this.deleteToken();
      return null;
    }
  }

  /** 删除令牌（设备撤销/退出登录时，9.8） */
  deleteToken(): void {
    const file = join(this.dir, TOKEN_FILE);
    if (existsSync(file)) rmSync(file);
  }

  /** 存储目录（调试用） */
  get storageDir(): string {
    return dirname(join(this.dir, TOKEN_FILE));
  }
}
