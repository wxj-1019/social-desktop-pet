/**
 * 环境变量 schema 校验 —— 启动 fail-fast（P2 观测/交付收尾）。
 *
 * 只强校验必填项；可选变量（AI、SMTP、运营 token 等）由各自模块的
 * configFromEnv 按需解析（缺省即降级），不在此重复。
 * 生产环境的密钥强度校验（JWT ≥32 字节）仍在 main() 中执行。
 */
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, '缺少 DATABASE_URL（参考 .env.example）'),
  JWT_SECRET: z.string().min(1, '缺少 JWT_SECRET（参考 .env.example）'),
  PORT: z.coerce.number().int().positive().optional(),
  PET_BIND_HOST: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
});

export interface ParsedEnv {
  DATABASE_URL: string;
  JWT_SECRET: string;
  PORT?: number;
  PET_BIND_HOST?: string;
  NODE_ENV?: 'development' | 'production' | 'test';
}

/** 校验并返回必填环境变量；缺失/非法直接抛错中止启动（宁可不起，不可带病跑） */
export function parseRequiredEnv(source: Record<string, string | undefined>): ParsedEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`环境变量校验失败——${issues}`);
  }
  return parsed.data;
}
