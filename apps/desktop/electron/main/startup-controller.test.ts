import { describe, expect, it, vi } from 'vitest';

import { parseStartupArgs, StartupController, type StartupRuntime } from './startup-controller.js';

function makeRuntime(initial = false): StartupRuntime & { enabled: boolean } {
  let enabled = initial;
  return {
    get enabled() {
      return enabled;
    },
    setAutoLaunch: vi.fn((on: boolean) => {
      enabled = on;
    }),
    isAutoLaunchEnabled: () => enabled,
  };
}

describe('StartupController (8.2 启动模块)', () => {
  it('parseStartupArgs detects --poc / --minimized and keeps rest', () => {
    const args = parseStartupArgs([
      'electron.exe',
      '--poc',
      '--minimized',
      'pet://invite?token=a.b',
    ]);
    expect(args.poc).toBe(true);
    expect(args.minimized).toBe(true);
    expect(args.rest).toEqual(['electron.exe', 'pet://invite?token=a.b']);
  });

  it('parseStartupArgs defaults to normal launch', () => {
    const args = parseStartupArgs(['electron.exe']);
    expect(args.poc).toBe(false);
    expect(args.minimized).toBe(false);
  });

  it('setAutoLaunch forwards to runtime and reads back (留存指标依赖项)', () => {
    const runtime = makeRuntime();
    const c = new StartupController(runtime);
    expect(c.isAutoLaunchEnabled()).toBe(false);
    c.setAutoLaunch(true);
    expect(runtime.setAutoLaunch).toHaveBeenCalledWith(true);
    expect(c.isAutoLaunchEnabled()).toBe(true);
  });

  it('bootstrap runs hooks in order and reports failures without blocking (降级友好)', async () => {
    const order: string[] = [];
    const c = new StartupController(makeRuntime());
    const failures = await c.bootstrap([
      { name: 'window', run: async () => void order.push('window') },
      { name: 'session', run: async () => void order.push('session') },
      {
        name: 'broken',
        run: async () => {
          order.push('broken');
          throw new Error('boom');
        },
      },
      { name: 'deep-link', run: async () => void order.push('deep-link') },
    ]);
    expect(order).toEqual(['window', 'session', 'broken', 'deep-link']);
    expect(failures).toEqual(['broken']);
  });
});
