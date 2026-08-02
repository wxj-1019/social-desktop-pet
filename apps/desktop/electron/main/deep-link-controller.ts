/**
 * DeepLinkController —— 对应设计稿 6.3 邀请链接。
 *
 * 协议：pet://invite?token=<url-safe-base64>
 *   - token = urlSafeBase64(userId) + '.' + urlSafeBase64(inviteCode)，无签名（邀请码自身即随机高熵凭据）
 *
 * 流程（6.3）：客户端收到链接 → 校验 → 若已登录直接应用；未登录则记入 pending，
 * 登录完成后恢复邀请流程。
 *
 * 纯逻辑（可单测）+ 注入持久化（pending 需要跨重启保留）。
 */

export interface InvitePayload {
  userId: string;
  inviteCode: string;
  rawToken: string;
}

export interface DeepLinkContext {
  /** 当前是否已登录（由 main 注入） */
  isSignedIn: () => boolean;
  /** 应用邀请（已登录路径） */
  applyInvite(payload: InvitePayload): Promise<void>;
  /** 请求登录（未登录路径，登录完成后会调用 restorePending） */
  requestSignIn(): Promise<void>;
}

/** URL-safe Base64 编解码（无 padding） */
function b64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}
function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/**
 * 解析并校验邀请链接。
 * token 兼容两种格式：
 * - 单段（6.3 现行，服务端 /invite 生成）：randomBytes(32).toString('base64url')，
 *   无内嵌用户信息——userId/inviteCode 置空，消费端只依赖 rawToken（/invite/accept 按 token 校验）；
 * - 两段（早期自造格式）：b64url(userId).b64url(inviteCode)。
 * @returns null 表示非法/格式错误链接
 */
export function parseInviteUrl(raw: string): InvitePayload | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'pet:') return null;
  // 允许 pet://invite 与 pet:invite 两种写法
  const host = url.hostname || url.pathname.split('/')[0] || '';
  if (host !== 'invite') return null;

  const token = url.searchParams.get('token');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length === 2) {
    const [userIdPart, codePart] = parts as [string, string];
    if (!userIdPart || !codePart) return null;
    try {
      const userId = b64urlDecode(userIdPart);
      const inviteCode = b64urlDecode(codePart);
      if (!userId || !inviteCode) return null;
      return { userId, inviteCode, rawToken: token };
    } catch {
      return null; // base64 解码失败 → 非法链接
    }
  }
  if (parts.length === 1 && parts[0] !== '' && /^[A-Za-z0-9_-]+$/.test(parts[0]!)) {
    // 服务端单段 token（6.3 现行格式：base64url 字符集）
    return { userId: '', inviteCode: '', rawToken: token };
  }
  return null;
}

export interface PendingStore {
  load(): InvitePayload | null;
  save(payload: InvitePayload): void;
  clear(): void;
}

export class DeepLinkController {
  private pending: InvitePayload | null = null;

  constructor(
    private readonly context: DeepLinkContext,
    private readonly store: PendingStore | null = null,
  ) {
    // 启动时恢复上次未完成的邀请（跨重启）
    this.pending = this.store?.load() ?? null;
  }

  get pendingInvite(): InvitePayload | null {
    return this.pending;
  }

  /** 处理收到的链接（macOS open-url / Windows second-instance） */
  async handle(rawUrl: string): Promise<'applied' | 'pending' | 'invalid'> {
    const payload = parseInviteUrl(rawUrl);
    if (!payload) return 'invalid';

    if (this.context.isSignedIn()) {
      await this.context.applyInvite(payload);
      this.clearPending();
      return 'applied';
    }
    // 未登录 → 记入 pending，登录完成后恢复
    this.pending = payload;
    this.store?.save(payload);
    await this.context.requestSignIn();
    return 'pending';
  }

  /** 登录完成后调用：恢复 pending 邀请 */
  async restorePending(): Promise<boolean> {
    if (!this.pending) return false;
    const payload = this.pending;
    await this.context.applyInvite(payload);
    this.clearPending();
    return true;
  }

  private clearPending(): void {
    this.pending = null;
    this.store?.clear();
  }
}

export { b64urlEncode, b64urlDecode };
