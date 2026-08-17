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
      summary: { requests: 30, tokens: 4000 },
      items: [{ usageDate: '2026-08-18', requests: 20, tokens: 2500 }],
    });
    await act(async () => {
      render(<UsagePage />);
    });
    expect(screen.getByText(/30 次请求/)).toBeTruthy();
    expect(screen.getByText('2026-08-18')).toBeTruthy();
  });
});
