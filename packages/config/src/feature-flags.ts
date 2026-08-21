/**
 * 功能开关 —— 对应设计稿 P0 运维要求（feature 开关）。
 * 支持运行时热更新（从服务端拉取），框架阶段提供默认值与读取接口。
 */
export interface FeatureFlags {
  /** 0.2-7：首版不允许桌宠自由 Agent-to-Agent 对话 */
  friendAgentToAgentChat: boolean;
  /** 6.2 记忆确认卡：分级确认（D-3） */
  memoryConfirmation: 'tiered' | 'always' | 'never';
  /** 10.9 主动关怀（默认关闭，每天最多一次） */
  proactiveCare: boolean;
  /** 第二轮新增 10.9 重度使用干预（对齐 NY 3h / 中国 2h） */
  heavyUseIntervention: boolean;
  /** P1：实时双宠互动 */
  realtimeDuoInteraction: boolean;
  /** 11.8 危机检测三级响应 */
  crisisThreeTierResponse: boolean;
  /** AI Kill Switch（12.7）—— 关闭后只回固定文案 */
  aiEnabled: boolean;
  /** 9.2 Presence 广播：上线/下线通知好友（基础联动能力；关闭后仅本地在线态，不做好友侧广播） */
  presenceBroadcast: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  friendAgentToAgentChat: false,
  memoryConfirmation: 'tiered',
  proactiveCare: false,
  heavyUseIntervention: true,
  realtimeDuoInteraction: false,
  crisisThreeTierResponse: true,
  aiEnabled: true,
  presenceBroadcast: true,
};
