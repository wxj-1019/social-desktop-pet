import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminSocialRouter } from './admin-social.js';

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
    app: createAdminSocialRouter({
      pool: pool as never,
      jwt: JWT,
      adminUsers: adminUsers as never,
    }),
    pool,
  };
}

describe('admin social routes', () => {
  it('returns daily social aggregation with summary', async () => {
    const { app } = buildRouter([
      {
        fragment: 'generate_series',
        rows: [
          { day: '2026-08-18', gifts: 5, visits: 3, new_friends: 2, active_users: 6 },
          { day: '2026-08-19', gifts: 4, visits: 2, new_friends: 1, active_users: 5 },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/social/daily?from=2026-08-18&to=2026-08-19', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { gifts: number; visits: number; newFriends: number; activeUsers: number };
      items: Array<{ date: string; gifts: number }>;
    };
    expect(body.summary.gifts).toBe(9);
    expect(body.summary.visits).toBe(5);
    expect(body.summary.newFriends).toBe(3);
    expect(body.items[0]!.date).toBe('2026-08-18');
  });

  it('returns unified event stream with user emails', async () => {
    const { app } = buildRouter([
      { fragment: 'select count(*)::int as total from events e', rows: [{ total: 1 }] },
      {
        fragment: 'select e.event_id',
        rows: [
          {
            event_id: 'e1',
            type: 'gift.snack_sent',
            payload: { giftId: 'g1', snackId: 'snack_cookie', fromUserId: 'u1', toUserId: 'u2' },
            from_email: 'a@b.c',
            to_email: 'x@y.z',
            created_at: '2026-08-18T10:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/social/events?page=1&pageSize=50', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      items: Array<{ type: string; fromEmail: string | null; toEmail: string | null }>;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]!.type).toBe('gift.snack_sent');
    expect(body.items[0]!.fromEmail).toBe('a@b.c');
    expect(body.items[0]!.toEmail).toBe('x@y.z');
  });

  it('rejects an unknown event type with 422', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/social/events?type=hack.all', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
  });

  it('returns per-user social history', async () => {
    const { app } = buildRouter([
      {
        fragment: 'from gift_events g',
        rows: [
          {
            gift_id: 'g1',
            snack_id: 'snack_tea',
            status: 'sent',
            direction: 'sent',
            peer_email: 'peer@b.c',
            created_at: '2026-08-18T10:00:00Z',
          },
        ],
      },
      {
        fragment: 'from visits v',
        rows: [
          {
            visit_id: 'v1',
            type: 'wave',
            status: 'arrived',
            direction: 'received',
            peer_email: 'peer@b.c',
            created_at: '2026-08-17T10:00:00Z',
          },
        ],
      },
      {
        fragment: 'from friendships f',
        rows: [
          {
            friendship_id: 'f1',
            status: 'active',
            friend_email: 'peer@b.c',
            accepted_at: '2026-08-15T10:00:00Z',
            created_at: '2026-08-15T10:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/11111111-1111-4111-8111-111111111111/social', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gifts: Array<{ snackId: string; direction: string; peerEmail: string | null }>;
      visits: Array<{ type: string; direction: string }>;
      friendships: Array<{ status: string; friendEmail: string }>;
    };
    expect(body.gifts[0]!.snackId).toBe('snack_tea');
    expect(body.gifts[0]!.peerEmail).toBe('peer@b.c');
    expect(body.visits[0]!.direction).toBe('received');
    expect(body.friendships[0]!.status).toBe('active');
  });

  it('rejects an invalid userId with 422', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/not-a-uuid/social', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
  });

  it('rejects a date range longer than 31 days for daily aggregation', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/social/daily?from=2026-01-01&to=2026-03-01', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
  });
});
