/**
 * 本地降级模式（第 3–6 周 Alpha：未登录/断网也能养桌宠）。
 *
 * 范围（对应退出标准"用户没有好友也愿意运行桌宠"）：
 * - 规则聊天：关键词 → 回应（纯函数，可单测；第 7–10 周 AI 接入前的基础人格）
 * - 本地会话：localStorage 持久化对话历史（最近 50 条）
 * - 云端功能（好友/礼物/拜访）在本地模式不可用，UI 提示登录解锁
 */
export interface ChatMessage {
  role: 'user' | 'pet';
  text: string;
  at: string;
}

/** 关键词 → 回应表（带人格变体；回应不含任何身份承诺，见 10.4 安全人格） */
const RULES: ReadonlyArray<{ match: RegExp; replies: readonly string[] }> = [
  {
    match: /你好|嗨|哈喽|hello|hi\b/i,
    replies: ['你好呀！今天过得怎么样？', '嗨～我在呢', '哈喽！摸摸头'],
  },
  {
    match: /你是谁|你叫什么|名字/i,
    replies: ['我是你的桌面小宠物，还没有名字——等你来起！', '一只住在你桌面上的小家伙'],
  },
  {
    match: /在吗|在不在|在干嘛/i,
    replies: ['在的在的，一直在你桌面上待着呢', '在呀，看你工作好认真'],
  },
  { match: /吃饭|饿了|吃了吗/i, replies: ['记得按时吃饭呀！', '我闻到了好吃的味道～你吃饭了吗？'] },
  { match: /睡觉|困了|晚安/i, replies: ['晚安～做个好梦！', '我陪你一起休息吧'] },
  { match: /开心|高兴|太好了/i, replies: ['哇！我也跟着开心起来了！', '开心的事要多多分享给我呀'] },
  {
    match: /难过|伤心|不开心|emo/i,
    replies: ['抱抱你……想说的话都可以和我说', '别难过，我一直在你旁边陪着'],
  },
  { match: /谢谢|感谢/i, replies: ['不客气！', '能陪着你我也很开心'] },
  { match: /再见|拜拜|goodbye|bye\b/i, replies: ['再见～随时来找我玩！', '拜拜，记得想我哦'] },
];

const FALLBACKS: readonly string[] = [
  '嗯嗯，我在听你说',
  '然后呢？我想继续听',
  '这个话题我不太懂，但我会一直陪着你',
  '（歪头）你说的很有意思',
];

function pick<T>(arr: readonly T[], seed?: number): T {
  if (seed === undefined) return arr[Math.floor(Math.random() * arr.length)]!;
  return arr[seed % arr.length]!;
}

/** 规则引擎：输入 → 回应（纯函数；seed 固定时结果确定，便于测试） */
export function localReply(input: string, seed?: number): string {
  for (const rule of RULES) {
    if (rule.match.test(input)) return pick(rule.replies, seed);
  }
  return pick(FALLBACKS, seed);
}

const HISTORY_KEY = 'pet:localChat';
const HISTORY_LIMIT = 50;

/** 本地对话历史（localStorage） */
export function loadLocalHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendLocalMessage(history: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const next = [...history, msg].slice(-HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* 存储失败不影响聊天 */
  }
  return next;
}
