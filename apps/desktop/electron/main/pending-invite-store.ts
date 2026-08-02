/**
 * PendingInviteStore —— 深链邀请 pending 的跨重启持久化（6.3）。
 *
 * DeepLinkController 的 PendingStore 端口：已登录立即应用、未登录记入 pending，
 * 登录完成后 restorePending 恢复。pending 需跨重启保留（用户点链接 → 启动 →
 * 登录后仍能完成邀请），由本 store 落盘到 userData/pending-invite.json。
 *
 * 文件内容：{ payload: InvitePayload | null }（payload:null 表示无 pending），
 * 缺失/损坏/不匹配 schema 一律回退 null（降级友好：不阻塞邀请流程）。
 */
import { z } from 'zod';

import { AtomicJsonStore } from './atomic-json-store.js';
import type { PendingStore } from './deep-link-controller.js';

/** 邀请 payload 校验（与 deep-link-controller 的 InvitePayload 结构一致） */
export const InvitePayloadSchema = z
  .object({
    userId: z.string(),
    inviteCode: z.string(),
    rawToken: z.string(),
  })
  .strict();
export type InvitePayload = z.infer<typeof InvitePayloadSchema>;

/** 落盘信封：payload:null 表示无 pending */
const PendingInviteFileSchema = z
  .object({
    payload: InvitePayloadSchema.nullable(),
  })
  .strict();

export class PendingInviteStore implements PendingStore {
  private readonly store: AtomicJsonStore<{ payload: InvitePayload | null }>;

  /** @param file 完整文件路径（如 join(userData, 'pending-invite.json')） */
  constructor(file: string) {
    this.store = new AtomicJsonStore<{ payload: InvitePayload | null }>(
      file,
      PendingInviteFileSchema,
      { payload: null },
    );
  }

  load(): InvitePayload | null {
    return this.store.load().payload;
  }

  save(payload: InvitePayload): void {
    this.store.save({ payload });
  }

  clear(): void {
    this.store.save({ payload: null });
  }
}
