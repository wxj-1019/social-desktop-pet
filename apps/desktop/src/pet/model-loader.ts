/**
 * ModelLoader 骨架 —— 8.8 / V-1：Live2D 模型清单加载与校验。
 *
 * - 读取打包资源 resources/live2d/model-manifest.json
 * - zod 校验清单结构（与 8.3 精神一致：外部输入过 schema）
 * - 暴露模型路径与动作/表情清单，供 MotionController 消费
 *
 * ⚠️ Cubism SDK 加载（model3.json → Live2DModel 实例化）受许可门禁 V-1 约束：
 * 未获书面许可前不引入 SDK；此处仅提供清单层，SDK 集成在此函数内补 TODO。
 */
import { z } from 'zod';

import { EXPRESSIONS, MOTIONS } from './motion-mapping.js';

/** 与 resources/live2d/model-manifest.json 结构一致 */
export const ModelManifestSchema = z.object({
  $schema: z.string().optional(),
  version: z.number(),
  character: z.string(),
  models: z.array(
    z.object({
      id: z.string(),
      path: z.string(), // 相对 resources/live2d/ 的 model3.json 路径
      status: z.enum(['ready', 'pending-license']),
    }),
  ),
  motions: z.array(z.enum(MOTIONS)),
  expressions: z.array(z.enum(EXPRESSIONS)),
  note: z.string().optional(),
});
export type ModelManifest = z.infer<typeof ModelManifestSchema>;

export interface LoadedModel {
  id: string;
  /** model3.json 的绝对路径（打包后 resources 路径） */
  model3Url: string;
  status: ModelManifest['models'][number]['status'];
  motions: ModelManifest['motions'];
  expressions: ModelManifest['expressions'];
}

export function parseModelManifest(raw: unknown): ModelManifest {
  return ModelManifestSchema.parse(raw);
}

/**
 * 加载清单并选出默认模型。
 * @param manifestUrl 清单 URL（渲染进程相对资源目录）
 */
export async function loadModelManifest(manifestUrl: string): Promise<LoadedModel> {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`manifest 加载失败 (${res.status})`);
  const manifest = parseModelManifest(await res.json());
  const model = manifest.models[0];
  if (!model) throw new Error('manifest 中没有模型');

  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/'));
  return {
    id: model.id,
    model3Url: `${base}/${model.path}`,
    status: model.status,
    motions: manifest.motions,
    expressions: manifest.expressions,
  };
}

/**
 * Cubism SDK 集成点（V-1 许可后）：
 *   const model = await Live2DModel.from(url, options);   // 或 SDK 对应 API
 *   model.motion(name); model.expression(name);
 * 前置：资源 status 必须为 'ready'（许可确认后由打包流程置位）。
 */
export function isModelReady(manifest: ModelManifest): boolean {
  return manifest.models.some((m) => m.status === 'ready');
}
