/** 哈希比较（timing-safe）：防时序侧信道；长度不等直接 false（timingSafeEqual 会 throw） */
import { timingSafeEqual } from 'node:crypto';

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
