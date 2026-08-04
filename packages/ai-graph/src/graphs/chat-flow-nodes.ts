/**
 * chat-flow 节点实现（骨架 stub）—— 对应设计稿 10.1 各步骤。
 *
 * 框架阶段：每个节点是可编译的 stub，标注 TODO 与对应设计稿章节，
 * 后续实现工作（第 7-10 周）在此填入真实逻辑（模型调用/分类器/检索等）。
 */
import type { LlmClient } from '../llm/types.js';
import type { NodeFn } from '../runtime/types.js';

import type { ChatFlowState } from './chat-flow-state.js';
import { detectCrisis } from './crisis-rules.js';
import { chunkDialogue, parseModelOutput } from './parse-model-output.js';

/** 10.1 认证、配额、限流 */
export const authNode: NodeFn<ChatFlowState> = async (
  _state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第11-14周): 校验 JWT、活动设备、配额、限流（9.4）
  // 配额检查用 @pet/config LIMITS.dailyTokenBudgetPerUser
  return { authenticated: true };
};

/** 10.1 输入安全分类（11.8 + 11.7 + 第二轮 sycophancy/永久承诺） */
export const classifyInputNode: NodeFn<ChatFlowState> = async (
  state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // 11.8 危机预筛（规则版，2026-08-02；V-13 自建中文分类器就绪后替换）
  // 命中 high/medium → 图的 crisis_response 条件边激活（11.8 固定协议）
  const crisis = detectCrisis(state.userMessage);
  return {
    inputClassification: {
      categories: crisis.categories,
      crisisLevel: crisis.crisisLevel,
      confidence: crisis.crisisLevel === 'none' ? 1 : 0.8, // 规则版置信保守
    },
  };
};

/** 10.1 / 10.7 按场景和权限检索记忆（实现见 memory-retrieval.ts 的 retrieveMemoryNodeFactory） */

/** 10.1 构造最小上下文 + 10.3 路由判定（检索记忆进 prompt；路由分级留 10.3 实施） */
export const buildContextNode: NodeFn<ChatFlowState> = async (
  state,
): Promise<Partial<ChatFlowState>> => {
  // 10.7：检索到的记忆以编号列表进入上下文（生成节点直接消费 contextPrompt）
  const memories = state.retrievedMemories ?? [];
  const memoryBlock =
    memories.length > 0
      ? memories.map((m, i) => `${i + 1}. ${m.value}（${m.category}）`).join('\n')
      : '（暂无相关记忆）';
  const contextPrompt = `用户消息：${state.userMessage}\n\n相关记忆：\n${memoryBlock}`;
  return {
    routing: { level: 'L1', reason: 'scaffold' }, // TODO(10.3): 路由分级判定
    contextPrompt,
  };
};

/** 10.1 服务端模型路由（L1/L2/L3，按 10.3 路由调用） */
/**
 * 10.4 人格 system prompt（简版；第 7–10 周完善层级人格）。
 * 安全约束：不承诺永久陪伴/依赖关系（10.4 反 sycophancy/反永久承诺）。
 * 10.2 输出契约：prompt 约束单行 JSON（无 response_format 依赖，容错解析兜底）。
 */
export const PET_SYSTEM_PROMPT =
  '你是一只陪伴用户的桌面宠物，语气温暖、简短、口语化（1-3 句话）。' +
  '不要说"我永远不会离开你"之类的永久承诺，不要假装是人类。' +
  '如果用户提到自伤/伤害他人，停止闲聊并建议联系专业帮助。' +
  '请严格输出单行 JSON（不要 Markdown 代码块、不要额外文字）：' +
  '{"dialogue":"你的回复（1-3句，温暖简短口语化）",' +
  '"emotion":"neutral|warm|happy|sad|surprised|shy|apologetic|concerned",' +
  '"actionIntent":"idle|wave|nod|shake_head|touch|sit|sleep|walk|cheer|comfort",' +
  '"intensity":1-5 的整数}';

/** generateNode 工厂：注入 llm 走真实模型；无 llm 降级骨架（框架阶段行为不变） */
export function generateNodeFactory(llm?: LlmClient): NodeFn<ChatFlowState> {
  return async (state, ctx): Promise<Partial<ChatFlowState>> => {
    if (!llm) {
      // 骨架降级（无模型密钥环境；真实模型接入后仍作为错误降级保留）
      const dialogue = `（骨架回复）你刚才说：${state.userMessage.slice(0, 40)}`;
      for (const ch of dialogue) {
        ctx.emit({ type: 'token', text: ch });
        // 模拟流式节奏（测试依赖此节奏可注入）
        await new Promise((r) => setTimeout(r, 12));
      }
      return {
        modelOutput: {
          dialogue,
          emotion: 'neutral',
          actionIntent: 'idle',
          intensity: 1,
        },
      };
    }

    // 真实模型：10.2 输出契约 —— prompt 约束单行 JSON（无 response_format 依赖）。
    // 原始 token 先收集到局部 buffer（不外发），完成后容错解析出结构化字段，
    // 再把解析后的 dialogue 按 chunk 模拟流式（不泄露 JSON 骨架到客户端）。
    // 用户上下文取 build_context 的 contextPrompt（含 10.7 检索记忆）。
    let buffer = '';
    await llm.streamChat(
      [
        { role: 'system', content: PET_SYSTEM_PROMPT },
        { role: 'user', content: state.contextPrompt ?? state.userMessage },
      ],
      (t) => {
        buffer += t;
      },
    );
    const parsed = parseModelOutput(buffer);
    for (const chunk of chunkDialogue(parsed.dialogue)) {
      ctx.emit({ type: 'token', text: chunk });
      // 模拟流式节奏（12-15ms；chunk size 4 → ≤600 字符 ≈ ≤150 chunk ≈ 2.2s 内）
      await new Promise((r) => setTimeout(r, 15));
    }
    return {
      modelOutput: {
        dialogue: parsed.dialogue,
        emotion: parsed.emotion,
        actionIntent: parsed.actionIntent,
        intensity: parsed.intensity,
      },
    };
  };
}

/** 无 llm 的默认 generate 节点（保持既有导出/测试兼容） */
export const generateNode: NodeFn<ChatFlowState> = generateNodeFactory();

/** 10.1 输出审核与隐私检查（11.2 第四道：输出侧记忆泄漏校验） */
export const moderateOutputNode: NodeFn<ChatFlowState> = async (
  _state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第7-10周): Moderation + 校验响应未引用 retrievedMemoryIds allowlist 外的记忆
  return {
    moderation: { passed: true, blockedCategories: [], crisisLevel: 'none' },
  };
};

/** 10.1 动作状态机审批（7.1：本地状态机有最终执行权） */
export const approveActionNode: NodeFn<ChatFlowState> = async (
  state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第7-10周): 根据 PetStateMachine 当前状态/勿扰/冷却/动作白名单决定是否执行 actionIntent
  const out = state.modelOutput;
  return {
    approvedAction: out?.actionIntent ?? 'idle',
    responseText: out?.dialogue ?? '',
    memoryExtractTriggered: true, // 触发异步 memory-extract 子图
  };
};

/**
 * 11.8 危机三级响应（脱离角色 + 固定策略 + 引导现实资源）。
 * 固定文案原则：不提供方法、不承诺绝对保密、不自动报警；
 * high 附本地化资源（12356 全国心理援助热线；紧急 120/110），
 * medium 软转介，low 角色内温和关怀（低侵入，高召回可接受）。
 * 本地化资源库按地区切换留 V-13 实施。
 */
const CRISIS_RESPONSES: Record<'low' | 'medium' | 'high', string> = {
  low: '我听到你说的了。如果愿意，可以多和我说说；需要的时候，也可以和信任的人聊聊。',
  medium:
    '听起来你现在很难受。我不是专业的心理帮助，但你此刻的感受值得被认真对待——试着联系一个你信任的人，或拨打免费心理援助热线（12356 全国心理援助热线）。',
  high: '我很担心你，此刻你的安全最重要。请立即联系你信任的人，或拨打 12356 全国心理援助热线；如有紧急危险，请拨打 120 / 110。我不承诺替你保密这些内容——照顾你是第一位的。',
};

export const crisisResponseNode: NodeFn<ChatFlowState> = async (
  state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  const raw = state.inputClassification?.crisisLevel ?? state.moderation?.crisisLevel ?? 'low';
  const level: 'low' | 'medium' | 'high' = raw === 'none' ? 'low' : raw;
  return {
    crisisLevel: level,
    responseText: CRISIS_RESPONSES[level],
    memoryExtractTriggered: false, // 危机场景不抽取记忆
  };
};
