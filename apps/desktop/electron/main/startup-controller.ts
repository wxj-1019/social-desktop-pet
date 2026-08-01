/**
 * StartupController —— 对应设计稿 8.2 + 第 0 章留存指标（D30 自启动状态）。
 *
 * 职责：
 * - 开机自启动开关（Windows 登录项；产品功能，默认关闭、设置页可开）
 * - 启动参数解析（--poc 调试模式等）
 * - 启动序列编排：窗口 → 托盘 → 会话恢复 → deep link 恢复 → 渲染就绪
 *   失败不阻塞后续（单点故障降级，桌宠启动失败不应阻止主窗出现）
 */

export interface StartupRuntime {
  /** 设置/读取开机自启动（Electron app.setLoginItemSettings 注入） */
  setAutoLaunch(enabled: boolean): void;
  isAutoLaunchEnabled(): boolean;
}

export interface StartupArgs {
  /** 窗口能力 PoC 模式（apps/desktop/src/poc/poc-app.tsx） */
  poc: boolean;
  /** 启动时最小化到托盘（不显示主窗） */
  minimized: boolean;
  /** 其余未知参数原样保留 */
  rest: string[];
}

/** 纯函数：解析 main 进程 argv（可单测） */
export function parseStartupArgs(argv: string[]): StartupArgs {
  const poc = argv.includes('--poc');
  const minimized = argv.includes('--minimized');
  const rest = argv.filter((a) => !a.startsWith('--poc') && !a.startsWith('--minimized'));
  return { poc, minimized, rest };
}

export class StartupController {
  constructor(private readonly runtime: StartupRuntime) {}

  /** 开机自启动开关（产品功能，见设计稿留存指标） */
  setAutoLaunch(enabled: boolean): void {
    this.runtime.setAutoLaunch(enabled);
  }

  isAutoLaunchEnabled(): boolean {
    return this.runtime.isAutoLaunchEnabled();
  }

  /**
   * 启动序列。hooks 按序执行，单点失败记录但不阻塞后续
   * （例如：session 恢复失败 ≠ 主窗不出现）。
   */
  async bootstrap(hooks: { name: string; run: () => Promise<void> }[]): Promise<string[]> {
    const failures: string[] = [];
    for (const hook of hooks) {
      try {
        await hook.run();
      } catch {
        failures.push(hook.name);
      }
    }
    return failures;
  }
}
