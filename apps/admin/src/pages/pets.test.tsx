// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PetsPage } from './pets.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PetsPage', () => {
  it('renders pet registry and bond distribution', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'petsStats').mockResolvedValue({
      total: 10,
      byCharacter: { 'star-isle': 6, codenono: 3, 'cream-kitten': 1 },
      byPersonality: [
        { mode: 'warm', count: 7 },
        { mode: 'lively', count: 3 },
      ],
      customNamed: 4,
    });
    vi.spyOn(api, 'bondsStats').mockResolvedValue({
      total: 8,
      active: 7,
      byStage: { first_meet: 3, familiar: 3, trusted: 1 },
      avgProgress: 6.4,
      topBonds: [
        {
          bondId: 'b1',
          stage: 'trusted',
          progress: 21,
          petAName: '星屿',
          petBName: 'CodeNoNo',
          userAEmail: 'a@b.c',
          userBEmail: 'x@y.z',
        },
      ],
    });

    await act(async () => {
      render(<PetsPage />);
    });

    expect(screen.getByText('宠物总数')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    // '星屿' 同时出现在角色分布卡与 TOP 羁绊榜
    expect(screen.getAllByText('星屿').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('自定义命名')).toBeTruthy();
    expect(screen.getByText('温柔陪伴')).toBeTruthy();
    // '默契朋友' 同时出现在阶段分布卡与羁绊 pill
    expect(screen.getAllByText('默契朋友').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('TOP 羁绊榜（按有效共同事件进度）')).toBeTruthy();
    // 用户邮箱与" ↔ "分隔符跨元素拼接，用灵活 matcher 按 td 文本断言
    expect(
      screen.getByText((_, el) =>
        el?.tagName === 'TD' ? (el.textContent ?? '').includes('a@b.c') : false,
      ),
    ).toBeTruthy();
  });
});
