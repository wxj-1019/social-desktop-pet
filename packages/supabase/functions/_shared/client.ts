// Supabase Edge Functions 共享工具 —— Deno 运行时
// 设计稿 9.4：服务端从 JWT 获取身份，不信任 Payload 中的用户 ID
// deno-lint-ignore-file no-explicit-any

export interface AuthContext {
  userId: string;
  deviceId: string;
}

/** 从请求头解析 JWT 并返回用户身份（不信任 Payload 中的 userId） */
export async function requireAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization') ?? '';
  // TODO: 接 Supabase 鉴权，校验 JWT 并提取 sub（userId）
  // 框架阶段返回占位；实现工作在第 11-14 周
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) throw new Error('未认证');
  return { userId: '(scaffold)', deviceId: '(scaffold)' };
}

/** 统一错误响应 */
export function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
