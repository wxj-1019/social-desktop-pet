/**
 * 邮件抽象测试 —— 13.2（SMTP 配置解析 + 无配置降级）。
 * nodemailer transport 本身不在单测覆盖（集成层），仅验证接口装配行为。
 */
import { describe, expect, it, vi } from 'vitest';

import { createNoopMailProvider, smtpConfigFromEnv } from './mail.js';

describe('smtpConfigFromEnv', () => {
  it('SMTP_* 齐全 → 配置（缺省端口 587、非 secure）', () => {
    const env = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'robot',
      SMTP_PASS: 'secret',
      SMTP_FROM: 'no-reply@example.com',
    } as NodeJS.ProcessEnv;
    expect(smtpConfigFromEnv(env)).toEqual({
      host: 'smtp.example.com',
      port: 587,
      user: 'robot',
      pass: 'secret',
      from: 'no-reply@example.com',
      secure: false,
    });
  });

  it('SMTP_SECURE=true → secure 开启（STARTTLS 生产配置）', () => {
    const env = {
      SMTP_HOST: 'h',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      SMTP_FROM: 'f',
      SMTP_SECURE: 'true',
    } as NodeJS.ProcessEnv;
    expect(smtpConfigFromEnv(env)?.secure).toBe(true);
  });

  it('缺任一 SMTP_* → null（邮件降级日志）', () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h' } as NodeJS.ProcessEnv)).toBeNull();
    expect(smtpConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('createNoopMailProvider', () => {
  it('降级实现：只记日志不抛错（不阻塞业务）', async () => {
    const lines: string[] = [];
    const mail = createNoopMailProvider((line) => lines.push(line));
    await mail.send('a@b.com', '主题', '<p>正文</p>');
    expect(lines[0]).toContain('a@b.com');
    expect(lines[0]).toContain('主题');
  });
});

describe('waitlist 注入 mail（13.2 确认邮件不阻塞注册）', () => {
  it('mail 失败仅日志，注册仍返回 200', async () => {
    // 通过 waitlist 路由验证：注入抛错的 mail，注册成功且 200
    const { registerWaitlistRoutes } = await import('../routes/waitlist.js');
    const { Hono } = await import('hono');
    const app = new Hono();
    let mailSettled = false;
    const failingMail = {
      send: vi.fn(async () => {
        mailSettled = true;
        throw new Error('smtp down');
      }),
    };
    registerWaitlistRoutes(app, {
      pool: {
        query: async () => ({ rowCount: 1 }),
      } as never,
      mail: failingMail,
    });

    const res = await app.request('/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@b.com' }),
    });
    expect(res.status).toBe(200);
    expect(failingMail.send).toHaveBeenCalledWith(
      'new@b.com',
      expect.stringContaining('等待名单'),
      expect.any(String),
    );
    // 邮件失败是 fire-and-forget：等 send 真正 settle（含抛错）后无未处理异常
    // （固定 sleep 慢机/快机不稳——用正向探针）
    await vi.waitFor(() => expect(mailSettled).toBe(true));
  });
});
