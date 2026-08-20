import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminPetsRouter } from './admin-pets.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(rowsByFragment: Array<{ fragment: string; rows: unknown[] }>) {
  const pool = {
    query: vi.fn(async (sql: string) => {
      const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
      return { rows: hit?.rows ?? [], rowCount: hit?.rows.length ?? 0 };
    }),
  };
  const adminUsers = {
    getById: vi.fn(async () => ({ id: 'a1', email: 'admin@pet.dev', status: 'active' })),
  };
  return {
    app: createAdminPetsRouter({
      pool: pool as never,
      jwt: JWT,
      adminUsers: adminUsers as never,
    }),
    pool,
  };
}

describe('admin pets routes', () => {
  it('returns pet registry stats with character/personality distribution', async () => {
    const { app } = buildRouter([
      {
        fragment: 'custom_named',
        rows: [{ total: 10, star_isle: 6, codenono: 3, cream_kitten: 1, custom_named: 4 }],
      },
      {
        fragment: 'group by personality_mode',
        rows: [
          { personality_mode: 'warm', count: 7 },
          { personality_mode: 'lively', count: 3 },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/pets/stats', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      byCharacter: Record<string, number>;
      byPersonality: Array<{ mode: string; count: number }>;
      customNamed: number;
    };
    expect(body.total).toBe(10);
    expect(body.byCharacter['star-isle']).toBe(6);
    expect(body.byCharacter['cream-kitten']).toBe(1);
    expect(body.byPersonality[0]!.mode).toBe('warm');
    expect(body.customNamed).toBe(4);
  });

  it('returns bond distribution and top bonds', async () => {
    const { app } = buildRouter([
      {
        fragment: 'avg_progress',
        rows: [{ total: 8, active: 7, first_meet: 3, familiar: 3, trusted: 1, avg_progress: 6.4 }],
      },
      {
        fragment: 'order by b.progress desc',
        rows: [
          {
            bond_id: 'b1',
            stage: 'trusted',
            progress: 21,
            pet_a_name: '星屿',
            pet_b_name: 'CodeNoNo',
            user_a_email: 'a@b.c',
            user_b_email: 'x@y.z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/bonds/stats', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      active: number;
      byStage: Record<string, number>;
      avgProgress: number;
      topBonds: Array<{ stage: string; progress: number; petAName: string }>;
    };
    expect(body.total).toBe(8);
    expect(body.byStage['trusted']).toBe(1);
    expect(body.avgProgress).toBe(6.4);
    expect(body.topBonds[0]!.stage).toBe('trusted');
    expect(body.topBonds[0]!.petAName).toBe('星屿');
  });

  it('returns per-user pets and bonds detail', async () => {
    const { app } = buildRouter([
      {
        fragment: 'from pets where owner_user_id',
        rows: [
          { pet_id: 'p1', character_id: 'star-isle', name: '小星星', personality_mode: 'warm' },
        ],
      },
      {
        fragment: 'union all',
        rows: [
          {
            bond_id: 'b1',
            stage: 'familiar',
            progress: 12,
            status: 'active',
            own_pet_name: '小星星',
            friend_pet_name: 'CodeNoNo',
            friend_email: 'peer@b.c',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/11111111-1111-4111-8111-111111111111/pets', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pets: Array<{ name: string; characterId: string }>;
      bonds: Array<{ stage: string; ownPetName: string; friendEmail: string }>;
    };
    expect(body.pets[0]!.name).toBe('小星星');
    expect(body.pets[0]!.characterId).toBe('star-isle');
    expect(body.bonds[0]!.ownPetName).toBe('小星星');
    expect(body.bonds[0]!.friendEmail).toBe('peer@b.c');
  });

  it('rejects an invalid userId with 422', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/nope/pets', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
  });
});
