/**
 * JWT 签发/校验 —— 自建 Auth（D-13，替代 Supabase Auth/GoTrue）。
 * jose 实现（ESM 原生，Node 20+ 兼容）。
 *
 * 9.8：access token 无状态、TTL 短（默认 15 分钟）以缩小撤销滞后窗口；
 * 撤销双保险（应用层 active_display_device_id 校验）在 routes 层实施。
 */
import { jwtVerify, SignJWT } from 'jose';

export interface JwtPayload {
  /** 用户 id（对应 auth.users.id / profiles.user_id） */
  sub: string;
  /** 设备 id（对应 devices.device_id；9.8 设备维度） */
  deviceId: string;
}

export interface JwtOptions {
  secret: string;
  /** access token TTL（分钟；9.8 建议 15） */
  accessTtlMin?: number;
}

export class JwtService {
  private readonly key: Uint8Array;

  constructor(private readonly options: JwtOptions) {
    this.key = new TextEncoder().encode(options.secret);
  }

  /** 签发 access token */
  async sign(payload: JwtPayload, now = Date.now()): Promise<string> {
    const ttl = this.options.accessTtlMin ?? 15;
    return new SignJWT({ deviceId: payload.deviceId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(payload.sub)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + ttl * 60)
      .sign(this.key);
  }

  /**
   * 校验 access token。
   * @returns payload；过期/签名非法抛错
   */
  async verify(token: string): Promise<JwtPayload> {
    const { payload } = await jwtVerify(token, this.key);
    const sub = payload.sub;
    if (!sub) throw new Error('token 缺少 sub');
    const deviceId = payload.deviceId;
    if (typeof deviceId !== 'string') throw new Error('token 缺少 deviceId');
    return { sub, deviceId };
  }
}
