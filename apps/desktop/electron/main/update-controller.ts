/**
 * UpdateController —— 对应设计稿 8.3 + 13.1 + 13.5（更新供应链）。
 *
 * 硬性约束（8.3 / 13.5）：
 * - 更新包必须通过 HTTPS 下载 + 包签名/sha256 校验（verify 步骤不可跳过）
 * - 灰度通道（stable / beta）与撤回支持：服务端撤销 manifest 即撤回
 * - 失败可回滚：旧版本始终保留运行，安装失败进入 ERROR 而非破坏安装
 *
 * 策略：
 * - 启动 30s 后静默检查（不自打扰用户；D30 留存靠自启动而非弹窗）
 * - 新版本 ≤ 当前 → 不动作；强制更新阈值（minSupportedVersion）触发强制提示
 * - 通道选择 = 灰度：stable 全量 / beta 内测先行
 */

export type UpdatePhase =
  | 'IDLE'
  | 'CHECKING'
  | 'NO_UPDATE'
  | 'READY' // 有新版本，等待用户/策略确认安装
  | 'DOWNLOADING'
  | 'VERIFYING'
  | 'INSTALLING'
  | 'ERROR';

export type UpdateChannel = 'stable' | 'beta';

export interface UpdateInfo {
  version: string;
  url: string;
  /** 更新包 sha256（校验必须；8.3 更新包签名验证） */
  sha256: string;
  notes?: string;
  /** 强制更新阈值：低于此版本必须更新 */
  minSupportedVersion?: string;
}

export interface UpdateApi {
  /** 检查更新（HTTPS manifest）；无更新返回 null */
  checkForUpdate(channel: UpdateChannel): Promise<UpdateInfo | null>;
  download(info: UpdateInfo): Promise<string>; // → 本地安装包路径
  /** 校验安装包（sha256 + 签名链验证）；失败抛错 */
  verify(localPath: string, info: UpdateInfo): Promise<void>;
  /** 安装（触发更新器；per-user 安装不要求管理员权限，13.1） */
  install(localPath: string): Promise<void>;
}

export interface UpdateState {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  error?: string;
}

/**
 * semver 比较（含 prerelease，忽略 build metadata）。
 * a > b → 1，a < b → -1，相等 → 0。
 */
export function compareSemver(a: string, b: string): number {
  const [coreA = '0.0.0', preA] = a.split('-');
  const [coreB = '0.0.0', preB] = b.split('-');
  const pa = coreA.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = coreB.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  // core 相同 → 比较 prerelease：无 prerelease > 有 prerelease
  if (preA === undefined && preB === undefined) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : preA > preB ? 1 : 0;
}

export class UpdateController {
  private state: UpdateState = { phase: 'IDLE', info: null };

  constructor(
    private readonly api: UpdateApi,
    private readonly currentVersion: string,
    private readonly channel: UpdateChannel = 'stable',
  ) {}

  get snapshot(): UpdateState {
    return this.state;
  }

  /** 检查更新（静默：无更新/失败都不打扰用户） */
  async check(): Promise<UpdateState> {
    this.state = { phase: 'CHECKING', info: null };
    try {
      const info = await this.api.checkForUpdate(this.channel);
      if (!info || compareSemver(info.version, this.currentVersion) <= 0) {
        this.state = { phase: 'NO_UPDATE', info: null };
        return this.state;
      }
      this.state = { phase: 'READY', info };
      return this.state;
    } catch (e) {
      this.state = { phase: 'ERROR', info: null, error: (e as Error).message };
      return this.state; // 检查失败 → 旧版本继续跑（可回滚）
    }
  }

  /** 是否触发强制更新（13.5 灰度/撤回场景的配套控制） */
  isForced(info: UpdateInfo): boolean {
    if (!info.minSupportedVersion) return false;
    return compareSemver(this.currentVersion, info.minSupportedVersion) < 0;
  }

  /** 下载 → 校验（8.3 双验证）→ 安装 */
  async apply(): Promise<UpdateState> {
    if (this.state.phase !== 'READY' || !this.state.info) {
      this.state = { ...this.state, phase: 'ERROR', error: 'apply() 必须在 READY 后调用' };
      return this.state;
    }
    const info = this.state.info;
    try {
      this.state = { phase: 'DOWNLOADING', info };
      const local = await this.api.download(info);
      this.state = { phase: 'VERIFYING', info };
      await this.api.verify(local, info); // sha256 + 签名链；失败抛错 → 不进入安装
      this.state = { phase: 'INSTALLING', info };
      await this.api.install(local);
      this.state = { phase: 'IDLE', info: null };
      return this.state;
    } catch (e) {
      this.state = { phase: 'ERROR', info, error: (e as Error).message };
      return this.state; // 安装失败 → 旧版本保留（可回滚）
    }
  }
}
