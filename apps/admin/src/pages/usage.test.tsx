// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsagePage } from './usage.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UsagePage', () => {
  it('renders summary and rows from the API', async () => {
    vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'usage').mockResolvedValue({
      summary: { requests: 30, tokens: 4000, fails: 3, limitHits: 1 },
      items: [{ usageDate: '2026-08-18', requests: 20, tokens: 2500, fails: 1, limitHits: 0 }],
    });
    // 模型列表下拉的数据源（挂载时拉取；测试中静默返回空）
    vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'usageModels').mockResolvedValue({
      models: [],
    });
    await act(async () => {
      render(<UsagePage />);
    });
    expect(screen.getByText('30')).toBeTruthy(); // 区间请求总数
    expect(screen.getByText('4,000')).toBeTruthy(); // 区间 token 估算（千分位格式化）
    expect(screen.getByText('2026-08-18')).toBeTruthy();
  });
});
