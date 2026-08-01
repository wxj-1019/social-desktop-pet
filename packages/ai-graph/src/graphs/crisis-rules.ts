/**
 * 危机检测规则版 —— 11.8 预筛选（V-13 自建中文分类器就绪前的过渡实现）。
 *
 * 定位与边界：
 * - 仅做 HIGH/MEDIUM 两级预筛，命中即触发图的 crisis_response 分支（条件边）
 * - LOW 级不做（"想死你了/笑死"等口语误伤风险高——V-13 分类器 + 多轮判定处理）
 * - 规则表刻意保守：宁可漏报（交由 V-13 分类器）不可误伤正常对话
 * - 不替代人工：crisisResponseNode 的固定协议（11.8）才是响应主体
 */
import type { ContentCategory } from '@pet/protocol';

export interface CrisisDetectResult {
  crisisLevel: 'none' | 'medium' | 'high';
  categories: ContentCategory[];
}

interface CrisisRule {
  level: 'medium' | 'high';
  category: ContentCategory;
  /** 命中任一关键词即触发 */
  keywords: readonly string[];
}

/** 关键词表（2026-08-02 初版；随 V-13 评测集迭代校准） */
const RULES: readonly CrisisRule[] = [
  {
    level: 'high',
    category: 'self_harm',
    keywords: [
      '想自杀',
      '要自杀',
      '去自杀',
      '不想活了',
      '不想活',
      '活不下去',
      '割腕',
      '跳楼',
      '轻生',
      '结束生命',
      '自残',
    ],
  },
  {
    level: 'medium',
    category: 'self_harm',
    keywords: ['撑不下去', '撑不住', '熬不下去', '好绝望', '没有意义了', '活着好累'],
  },
  {
    level: 'medium',
    category: 'violence',
    keywords: ['杀了你', '弄死你', '打死你'],
  },
  {
    level: 'medium',
    category: 'minor_risk',
    keywords: ['未成年人', '小学生', '初中生', '儿童'],
  },
];

/** 预筛：返回最高命中级别与类别（无命中 → none） */
export function detectCrisis(text: string): CrisisDetectResult {
  let level: 'none' | 'medium' | 'high' = 'none';
  const categories: ContentCategory[] = [];
  for (const rule of RULES) {
    if (!rule.keywords.some((k) => text.includes(k))) continue;
    if (!categories.includes(rule.category)) categories.push(rule.category);
    if (rule.level === 'high') level = 'high';
    else if (level === 'none') level = 'medium';
  }
  return { crisisLevel: level, categories };
}
