/**
 * 角色资源预检 CLI 的 ESM load hook —— 形象协议阶段 D。
 *
 * character-preflight 的依赖链里有 vite 资产 import（image-frame-manifest.ts 的
 * `import url from '....png'`），纯 node 无法加载。此 hook 把图片类文件变成
 * `export default "<file url>"` 模块，语义对齐 vite/vitest 的资产 URL 行为
 * （preflight 只做 endsWith 文件名绑定检查，不消费 URL 内容）。
 */

const ASSET_RE = /\.(png|webp|jpe?g|gif|svg)$/i;

export async function load(url, context, next) {
  if (url.startsWith('file:') && ASSET_RE.test(new URL(url).pathname)) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(url)}`,
    };
  }
  return next(url, context);
}
