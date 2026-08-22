/**
 * 桌宠档案跨设备同步路由（P2 收尾）—— pets.profile_sync。
 *
 * - GET /pet/profile：服务端档案快照（云端无档案返回 profile: null，客户端保留本地）
 * - PUT /pet/profile：整存 PetProfile（protocol PetProfileSchema 白名单校验后落库）
 *
 * 策略：最后写赢（桌面端登录后拉云端覆盖本地，本地变更时上报）；
 * synced_at 记录服务端落库时间，供后续演进为按时间戳合并。
 */
import { type Hono } from 'hono';
import type pg from 'pg';

import { PetProfileSchema } from '@pet/protocol';

import type { JwtService } from '../auth/jwt.js';
import { logger } from '../lib/logger.js';
import { findOrCreatePet } from '../lib/relationships.js';

import { requireAuth, type BusinessVariables } from './business.js';

export interface PetProfileDeps {
  pool: pg.Pool;
  jwt: JwtService;
}

export function registerPetProfileRoutes(
  app: Hono<{ Variables: BusinessVariables }>,
  deps: PetProfileDeps,
): void {
  const auth = requireAuth(deps.jwt, deps.pool);

  app.get('/pet/profile', auth, async (c) => {
    const userId = c.get('userId');
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      const petId = await findOrCreatePet(client, userId);
      const { rows } = await client.query(
        'select profile_sync, synced_at from pets where pet_id = $1',
        [petId],
      );
      await client.query('commit');
      const row = rows[0];
      return c.json({
        petId,
        profile: (row?.profile_sync as unknown) ?? null,
        syncedAt: row?.synced_at ? (row.synced_at as Date).toISOString() : null,
      });
    } catch (e) {
      await client.query('rollback');
      logger.error('pet_profile_get_failed', { error: (e as Error).message });
      return c.json({ error: 'internal_error' }, 500);
    } finally {
      client.release();
    }
  });

  app.put('/pet/profile', auth, async (c) => {
    const userId = c.get('userId');
    const body = await c.req.json().catch(() => null);
    const parsed = PetProfileSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'profile 非法（PetProfileSchema）' }, 400);
    }
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      const petId = await findOrCreatePet(client, userId);
      await client.query(
        'update pets set profile_sync = $2::jsonb, synced_at = now() where pet_id = $1',
        [petId, JSON.stringify(parsed.data)],
      );
      await client.query('commit');
      return c.json({ petId, ok: true });
    } catch (e) {
      await client.query('rollback');
      logger.error('pet_profile_put_failed', { error: (e as Error).message });
      return c.json({ error: 'internal_error' }, 500);
    } finally {
      client.release();
    }
  });
}
