/**
 * 角色资源预检 CLI（形象协议阶段 D）——本地发布流程用。
 * 输出分级报告（error/warning/统计），有 error 时退出码 1。
 * CI 门禁走 vitest 包装（apps/desktop/src/pet/character-preflight.test.ts）。
 *
 * 运行方式（package.json preflight:characters）：
 *   node --import tsx --conditions=development tools/character-preflight-cli.ts
 * - --conditions=development：@pet/protocol 按 exports 走 src（与 vitest 的
 *   alias-to-src 同源，不依赖 packages 各包 dist 是否已构建、是否新鲜）
 * - asset-url-loader.mjs：image-frame-manifest.ts 的 .png 帧 URL import
 *   是 vite 语法，纯 node 下需 load hook 转成 URL 字符串模块
 */
import { register } from 'node:module';

async function main(): Promise<void> {
  register('./asset-url-loader.mjs', import.meta.url);

  const { runCharacterPreflight } = await import('../apps/desktop/src/pet/character-preflight.js');

  const result = runCharacterPreflight();
  for (const e of result.errors) console.error(`[ERROR] ${e.characterId} ${e.id}: ${e.message}`);
  for (const w of result.warnings) console.warn(`[WARN ] ${w.characterId} ${w.id}: ${w.message}`);
  console.info(
    `已复核资产 ${result.checkedAssets} 个；error ${result.errors.length}，warning ${result.warnings.length}`,
  );
  process.exit(result.errors.length > 0 ? 1 : 0);
}

void main().catch((error: unknown) => {
  console.error('[ERROR] preflight 运行失败：', error);
  process.exit(1);
});
