/**
 * 管理后台浏览器级 e2e —— 设计 §9 验收：Playwright 验证管理员登录、暂停用户、
 * 审计记录出现的真实 GUI 链路（构建产物 + vite preview 同源代理 + 真实 Postgres）。
 *
 * 依赖：后端 :8787（PET_API_BASE）+ 管理后台构建预览 :5175（PET_ADMIN_UI_BASE）
 * 与管理员账号（CI 已预置 e2e-admin@pet.dev / E2eAdmin@123456；本地用
 * E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD 覆盖）。依赖不满足时跳过。
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';
// vite dev/preview 默认绑 localhost（Windows 上常解析为 ::1）；用 127.0.0.1 会拒连
const UI_BASE = process.env['PET_ADMIN_UI_BASE'] ?? 'http://localhost:5175';
const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'e2e-admin@pet.dev';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'E2eAdmin@123456';

test.beforeAll(async () => {
  try {
    const [api, ui] = await Promise.all([fetch(`${API_BASE}/healthz`), fetch(UI_BASE)]);
    if (!api.ok || !ui.ok) test.skip(true, '后端或管理后台预览未就绪');
  } catch {
    test.skip(true, '后端或管理后台预览不可达');
  }
});

test('管理后台 GUI：登录 → 搜索用户 → 暂停 → 审计出现记录', async ({ page }) => {
  // 0. 管理员账号未初始化 → 探测后跳过（本地未跑 admin:create 时不误报）
  const probe = await fetch(`${API_BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (probe.status === 401) test.skip(true, '管理员账号未初始化（admin:create）');

  // 1. 造一个一次性用户（API 层，GUI 只验证管理操作）
  const email = `adminui-${Date.now()}@test.local`;
  const reg = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'password123',
      deviceId: randomUUID(),
      platform: 'windows',
    }),
  });
  expect(reg.status).toBe(201);

  // 2. GUI 登录
  await page.goto(UI_BASE);
  await page.getByLabel('邮箱').fill(ADMIN_EMAIL);
  await page.getByLabel('密码').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '总览' })).toBeVisible();

  // 3. 用户管理 → 搜索邮箱 → 打开详情（点击范围限定到该邮箱所在行，
  //    新用户按注册时间倒序恰在未过滤列表第一页，50 个"详情"按钮会歧义）
  await page.getByRole('button', { name: '用户管理' }).click();
  await page.getByPlaceholder('搜索邮箱 / 昵称 / userId').fill(email);
  await expect(page.getByRole('cell', { name: email })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: email })
    .getByRole('button', { name: '详情' })
    .click();
  await expect(page.getByRole('dialog', { name: '用户详情' })).toBeVisible();

  // 4. 暂停账号（reason 走浏览器 prompt 对话框）
  page.once('dialog', (dialog) => void dialog.accept('e2e 管理后台 GUI 验证'));
  await page.getByRole('button', { name: '暂停账号' }).click();
  await expect(page.getByRole('status')).toContainText('账号已暂停');
  // 抽屉内出现红色"已暂停"徽章（注意避开状态筛选下拉里同文案的隐藏 option）
  await expect(page.getByRole('dialog', { name: '用户详情' }).getByText('已暂停')).toBeVisible();

  // 5. 关闭抽屉（遮罩会拦截侧栏点击）→ 审计日志出现 user.suspend 记录
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '审计日志' }).click();
  await page.getByLabel('动作筛选').selectOption('user.suspend');
  await expect(page.getByRole('cell', { name: '暂停账号' }).first()).toBeVisible();
  await expect(page.getByText('e2e 管理后台 GUI 验证').first()).toBeVisible();
});
