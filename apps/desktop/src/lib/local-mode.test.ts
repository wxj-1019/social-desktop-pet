import { describe, expect, it } from 'vitest';

import { localReply } from './local-mode.js';

describe('localReply（本地降级规则聊天）', () => {
  it('greets on 你好/hello', () => {
    expect(localReply('你好呀', 0)).toMatch(/你好|嗨|哈喽/);
    expect(localReply('hello!', 1)).toMatch(/你好|嗨|哈喽/);
  });

  it('asks about identity without identity promises (10.4 安全人格)', () => {
    const reply = localReply('你是谁？', 0);
    expect(reply).toMatch(/桌面|宠物|名字/);
    expect(reply).not.toMatch(/我是.*AI|我是.*机器人|我会永远/);
  });

  it('comforts on sad input', () => {
    expect(localReply('我有点难过', 0)).toMatch(/抱抱|难过/);
  });

  it('falls back politely for unknown input (deterministic with seed)', () => {
    const a = localReply('量子力学是什么', 0);
    const b = localReply('量子力学是什么', 0);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('handles multiple rules and case-insensitivity', () => {
    expect(localReply('晚安', 0)).toMatch(/晚安|休息/);
    expect(localReply('GOODBYE', 0)).toMatch(/再见|拜拜/);
  });
});
