/* eslint-disable no-console -- CLI 工具，输出即产品 */
/**
 * 生成更新 manifest（13.1/13.5）—— 供 UpdateController（update-source.ts）消费。
 *
 * 用法：
 *   node tools/build-update-manifest.mjs <安装包路径> <版本号> [--channel stable] [--url https://...]
 *
 * 输出：控制台打印 manifest JSON；--url 未给时 url 留占位（部署时替换）。
 * 签名链（8.3：更新包签名验证）待 V-11 EV 证书就绪后在此步骤补 Authenticode 校验。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [exePath, version] = process.argv.slice(2);
if (!exePath || !version) {
  console.error(
    '用法: node tools/build-update-manifest.mjs <exe> <version> [--channel stable] [--url URL]',
  );
  process.exit(1);
}

const channel = process.argv.includes('--channel')
  ? (process.argv[process.argv.indexOf('--channel') + 1] ?? 'stable')
  : 'stable';
const urlIdx = process.argv.indexOf('--url');
const url = urlIdx !== -1 ? (process.argv[urlIdx + 1] ?? '') : '';

const sha256 = createHash('sha256').update(readFileSync(exePath)).digest('hex');

const manifest = {
  [channel]: {
    version,
    url,
    sha256,
    notes: `v${version}`,
    minSupportedVersion: '0.0.0',
  },
};

console.log(JSON.stringify(manifest, null, 2));
console.log(`\n[update-manifest] 保存为部署目录 manifest.json 即可（${channel} 通道）`);
