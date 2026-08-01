/**
 * 限额与配额 —— 对应设计稿 6.5 / 10.9 / 12.7。
 * 成本保护：每用户每日 Token 预算、并发限制、重试上限、AI Kill Switch。
 */
export const LIMITS = {
  /** 6.5 每位好友每天最多 3 次可见拜访事件 */
  visitsPerFriendPerDay: 3,
  /** 6.6 留言上限：200 Unicode 码点，UTF-8 ≤ 2KB */
  messageMaxCodepoints: 200,
  messageMaxBytes: 2048,
  /** 10.9 主动关怀默认每天最多 1 次 */
  proactiveCarePerDay: 1,
  /** 10.9 主动关怀冷却（小时） */
  proactiveCareCooldownHours: 6,
  /** 10.9 第二轮新增：连续使用提醒阈值（小时）—— 对齐 NY 3h / 中国 2h */
  heavyUseReminderHours: 2,
  /** 12.7 每用户每日 Token 预算 */
  dailyTokenBudgetPerUser: 200_000,
  /** 12.7 单次输入上限 */
  singleInputMaxTokens: 8192,
  /** 12.7 单次输出上限 */
  singleOutputMaxTokens: 600,
  /** 12.7 重试上限 */
  maxRetries: 2,
  /** 12.7 每设备并发请求数 */
  concurrencyPerDevice: 2,
} as const;

/**
 * 保留策略 —— 对应设计稿 11.4（保留期）。
 */
export const RETENTION = {
  shortTermContextHours: 24,
  chatHistoryDays: 90,
  ephemeralActionEventHours: 72,
  /** 关系结束后 90 天再删除或匿名化 */
  relationshipEventDaysAfterTermination: 90,
  serviceLogDays: 14,
  reportMaterialDaysAfterClose: 180,
  backupDays: 30,
} as const;
