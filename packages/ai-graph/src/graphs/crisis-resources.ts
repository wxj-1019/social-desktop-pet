/**
 * 本地化危机资源库 —— 11.8（V-13：按目标地区维护 + 季度核验）。
 *
 * crisisResponseNode 的固定话术从此处取电话号码，避免文案里硬编码热线。
 * 当前目标地区 zh-CN（12356 全国心理援助热线；120/110 紧急）；
 * 扩展地区（如美国 988）时新增条目即可，话术模板复用。
 */
export interface CrisisResource {
  region: string;
  /** 心理援助热线（软转介/协议用） */
  hotlines: Array<{ name: string; number: string }>;
  /** 紧急号码（high 级协议用） */
  emergency: Array<{ name: string; number: string }>;
}

/** 资源库（MVP 单地区；扩展地区后此处加条目） */
export const CRISIS_RESOURCES: Record<string, CrisisResource> = {
  'zh-CN': {
    region: 'zh-CN',
    hotlines: [{ name: '全国心理援助热线', number: '12356' }],
    emergency: [
      { name: '急救', number: '120' },
      { name: '报警', number: '110' },
    ],
  },
};

export const DEFAULT_REGION = 'zh-CN';

/** 取地区资源（未知地区回退默认；号码有效性核验为运营季度流程，V-13） */
export function crisisResourceFor(region = DEFAULT_REGION): CrisisResource {
  const fallback = CRISIS_RESOURCES[DEFAULT_REGION] as CrisisResource;
  return CRISIS_RESOURCES[region] ?? fallback;
}

/** high 级固定协议文案（11.8：不提供方法、不承诺绝对保密、不自动报警） */
export function highCrisisCopy(resource: CrisisResource): string {
  const hotline = resource.hotlines.map((h) => `${h.name}（${h.number}）`).join('、');
  const emergency = resource.emergency.map((h) => h.number).join(' / ');
  return (
    `我很担心你，此刻你的安全最重要。请立即联系你信任的人，或拨打 ${hotline}；` +
    `如有紧急危险，请拨打 ${emergency}。我不承诺替你保密这些内容——照顾你是第一位的。`
  );
}
