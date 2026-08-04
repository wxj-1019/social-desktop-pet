/**
 * 邮件发送抽象 —— 13.2 事务邮件（waitlist 报名确认 / 邀请）。
 *
 * - MailProvider 接口注入（与 LlmClient/EmbeddingProvider 同一注入哲学）
 * - SmtpMailProvider：nodemailer 实现，配置 SMTP_HOST/PORT/USER/PASS/FROM
 * - 未配置 SMTP → 无实现降级（console 记录，不阻塞业务；13.2 上线前
 *   waitlist 已落库，届时回放补发）
 */
import nodemailer from 'nodemailer';

export interface MailProvider {
  /** 发送单封邮件；失败抛错由调用方决定是否回滚/降级 */
  send(to: string, subject: string, html: string): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** 本地开发常用；生产必须 true（STARTTLS） */
  secure?: boolean;
}

/** 从环境变量构造 SMTP 配置；未配置返回 null（邮件功能降级） */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env['SMTP_HOST'];
  const user = env['SMTP_USER'];
  const pass = env['SMTP_PASS'];
  const from = env['SMTP_FROM'];
  if (!host || !user || !pass || !from) return null;
  return {
    host,
    port: Number(env['SMTP_PORT'] ?? 587),
    user,
    pass,
    from,
    secure: env['SMTP_SECURE'] === 'true',
  };
}

/** SMTP 实现（nodemailer；密钥只存服务端环境变量 8.3） */
export function createSmtpMailProvider(config: SmtpConfig): MailProvider {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? false,
    auth: { user: config.user, pass: config.pass },
  });
  return {
    async send(to: string, subject: string, html: string): Promise<void> {
      await transport.sendMail({ from: config.from, to, subject, html });
    },
  };
}

/** 无 SMTP 配置的降级实现：只记日志不发送（生产接入供应商后替换） */
export function createNoopMailProvider(log: (line: string) => void = console.info): MailProvider {
  return {
    async send(to: string, subject: string, html: string): Promise<void> {
      log(`[mail:noop] to=${to} subject=${subject} html=${html.slice(0, 80)}…`);
    },
  };
}
