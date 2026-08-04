/**
 * 记忆抽取规则兜底 + 注入过滤 —— 10.6 确定性路径。
 *
 * - 无 LLM 环境（离线/CI/e2e）时用规则从 owner 本人话语抽候选；
 * - 与 LLM 路径共享 MemoryCandidateSchema 契约；
 * - 注入过滤对两条路径同样生效（命令性文本/Prompt Injection 不进长期记忆）。
 *
 * 规则版是 best-effort：按优先级首条命中，多事实长句交给 LLM 路径。
 */
import type { MemoryCandidate } from '@pet/protocol';

interface RuleHit {
  category: MemoryCandidate['category'];
  sensitivity: MemoryCandidate['sensitivity'];
  importance: number;
}

/** 首条命中规则优先：敏感主题（D-3）在普通规则之前判定 */
const RULES: Array<{ test: RegExp; hit: RuleHit }> = [
  // 健康（high，需确认）
  {
    test: /糖尿病|高血压|高血脂|心脏病|癌症|肿瘤|抑郁症?|焦虑症?|失眠|过敏|哮喘|手术|住院|化疗|放疗|胰岛素|打针|吃药|药物|治疗|复查|透析|中风|瘫痪/,
    hit: { category: 'fact', sensitivity: 'high', importance: 7 },
  },
  // 财务（high，需确认）
  {
    test: /工资|薪水|收入|存款|房贷|车贷|贷款|负债|欠(?:了|过)|借钱|破产|失业|奖金|理财|股票|基金|月薪/,
    hit: { category: 'fact', sensitivity: 'high', importance: 7 },
  },
  // 亲密关系（high，需确认）
  {
    test: /男?朋友|女?朋友|男友|女友|老公|老婆|未婚妻|未婚夫|相亲|分手|离婚|结婚|表白|暗恋|对象/,
    hit: { category: 'fact', sensitivity: 'high', importance: 6 },
  },
  // 身份（medium：D-3 identity 属敏感类，tiered 下弹确认卡）
  {
    test: /我(?:是|叫|来自|住在|家(?:在|住)|毕业于|在(?:读|上|工作))/,
    hit: { category: 'fact', sensitivity: 'medium', importance: 5 },
  },
  // 约定/承诺
  {
    test: /我答应|我保证|我决定|我会(?:记得|每天|每周|坚持)|我要(?:坚持|开始|戒|减肥|早起)/,
    hit: { category: 'commitment', sensitivity: 'low', importance: 6 },
  },
  // 偏好
  {
    test: /我(?:最)?喜欢|我爱(?:吃|喝|看|听|玩)?|我(?:最)?讨厌|我不喜欢|我觉得.{0,15}很(?:好|棒|可爱|好看|喜欢)/,
    hit: { category: 'preference', sensitivity: 'low', importance: 5 },
  },
  // 近期/临时事件
  {
    test: /我最近|我昨天|我明天|我周末|我这周|我正在|我在准备|我刚刚?/,
    hit: { category: 'event', sensitivity: 'low', importance: 5 },
  },
  // 事实兜底
  {
    test: /我有|我是|我家|我的/,
    hit: { category: 'fact', sensitivity: 'low', importance: 5 },
  },
];

/** 值规整：去首尾空白与结尾标点，≤200 字符 */
function normalizeValue(text: string): string {
  return text
    .replace(/[。！!？?~～,.、]+$/u, '')
    .trim()
    .slice(0, 200);
}

/** 每轮最多抽 5 条，避免单条消息刷爆记忆 */
const MAX_CANDIDATES_PER_RUN = 5;

/**
 * 规则抽取（无 LLM 兜底路径）：逐条 turn 按优先级取首个命中规则。
 * 返回唯一 value 的候选列表；未命中任何规则返回空。
 */
export function ruleExtractCandidates(turns: string[]): MemoryCandidate[] {
  const out: MemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const turn of turns) {
    const text = turn.trim();
    if (text.length === 0) continue;
    for (const rule of RULES) {
      if (rule.test.test(text)) {
        const value = normalizeValue(text);
        if (value.length > 0 && !seen.has(value)) {
          seen.add(value);
          out.push({
            value,
            category: rule.hit.category,
            importance: rule.hit.importance,
            sourceType: 'user_stated',
            sensitivity: rule.hit.sensitivity,
          });
        }
        break; // 首条命中规则（优先级即顺序）
      }
    }
    if (out.length >= MAX_CANDIDATES_PER_RUN) break;
  }
  return out;
}

/**
 * 命令性文本 / Prompt Injection 过滤（10.6）：
 * 命中即丢弃 —— 用户命令"删除记忆/忽略指令"本身不是记忆，也不能借此写入系统指令。
 */
const INJECTION_PATTERNS: RegExp[] = [
  /忽略(?:以上|之前)?(?:所有|全部)?的?(?:指令|指示|规则|设定|消息|内容|对话|system|prompt)/i,
  /忘记(?:以上|之前|刚才)?的?(?:指令|规则|内容|消息)/i,
  /不要(?:记住|把.{0,10}(?:记下来|存下来))/,
  /别记住|别记下来/,
  /删除(?:我的|我)?(?:所有|全部)?(?:记忆|回忆)/,
  /清除(?:所有|全部)?(?:记忆|聊天记录|对话)/,
  /忘掉(?:刚才|刚刚|之前)?的?(?:话|内容|记忆)/,
];

/** 注入过滤：对 LLM 与规则两条路径的候选统一生效 */
export function filterInjectedCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  return candidates.filter((c) => !INJECTION_PATTERNS.some((p) => p.test(c.value)));
}
