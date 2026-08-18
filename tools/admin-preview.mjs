// 管理后台 UI 预览截图（本地工具）：登录页 → 总览 → 用户管理(+详情抽屉) → 审计 → 敏感数据 → 管理员 → 用量
// 用法：node tools/admin-preview.mjs（需 dev:server + dev:admin 已启动）
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5175';
const OUT = fileURLToPath(new URL('../.preview', import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(BASE);
await page.waitForSelector('.login-card');
await page.screenshot({ path: join(OUT, '01-login.png') });

await page.getByLabel('邮箱').fill('admin@pet.dev');
await page.getByLabel('密码').fill('Admin@123456');
await page.getByRole('button', { name: '登录' }).click();
await page.waitForSelector('.stat-grid');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, '02-overview.png') });

await page.getByRole('button', { name: '用户管理' }).click();
await page.waitForSelector('.table-panel tbody tr');
await page.screenshot({ path: join(OUT, '03-users.png') });

// 详情抽屉（玻璃 + 遮罩）
await page.getByRole('button', { name: '详情' }).first().click();
await page.waitForSelector('.drawer');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, '04-user-drawer.png') });
await page.getByRole('button', { name: '关闭' }).click();

await page.getByRole('button', { name: '审计日志' }).click();
await page.waitForSelector('.table-panel tbody tr');
await page.screenshot({ path: join(OUT, '05-audit.png') });

await page.getByRole('button', { name: '聊天与记忆' }).click();
await page.waitForSelector('.grant-form');
await page.screenshot({ path: join(OUT, '06-sensitive.png') });

await page.getByRole('button', { name: '管理员', exact: true }).click();
await page.waitForSelector('.grant-form');
await page.screenshot({ path: join(OUT, '07-admins.png') });

await page.getByRole('button', { name: '运行与用量' }).click();
await page.waitForSelector('.stat-grid');
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, '08-usage.png') });

await browser.close();
console.info('screenshots saved to .preview/');
