/**
 * IPC 校验单元测试（Task 7）—— validateIpcSender / isRendererUrl / parseIpcPayload。
 * sender 校验只认主 frame + 期望窗口 + 受信任渲染 URL（file renderer 或 dev origin）+ surface。
 */
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  IpcPayloadError,
  IpcSenderError,
  isRendererUrl,
  parseIpcPayload,
  validateIpcSender,
} from './ipc-validation.js';
import type { IpcSenderEvent } from './ipc-validation.js';

const fromWebContents = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents },
}));

/** 生产打包后渲染入口（pathname 以 /renderer/index.html 结尾） */
const PROD_URL = (surface: 'pet' | 'panel') =>
  `file:///E:/app/out/renderer/index.html?surface=${surface}`;

/** process.env 的写入/删除辅助（@types/node 将 ELECTRON_RENDERER_URL 标为 readonly） */
const env = process.env as Record<string, string | undefined>;

const windows = new Map<unknown, unknown>();

function makeSender(url: string, owner: unknown, opts?: { subframe?: boolean }): IpcSenderEvent {
  const frame = { url };
  const sender = { mainFrame: frame };
  const senderFrame = opts?.subframe ? { url: `${url}#subframe` } : frame;
  windows.set(sender, owner);
  return { sender, senderFrame } as unknown as IpcSenderEvent;
}

beforeEach(() => {
  windows.clear();
  fromWebContents.mockImplementation((webContents: unknown) => windows.get(webContents) ?? null);
});

afterEach(() => {
  delete env.ELECTRON_RENDERER_URL;
});

describe('validateIpcSender', () => {
  const petWin = { id: 'pet' } as unknown as BrowserWindow;
  const panelWin = { id: 'panel' } as unknown as BrowserWindow;

  it('accepts a main-frame message from the expected window on the production renderer URL', () => {
    const sender = makeSender(PROD_URL('pet'), petWin);
    expect(validateIpcSender(sender, petWin, 'pet')).toBe(petWin);
  });

  it('accepts a main-frame message from the expected window on the dev renderer origin', () => {
    env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    const sender = makeSender('http://localhost:5173/?surface=pet', petWin);
    expect(validateIpcSender(sender, petWin, 'pet')).toBe(petWin);
  });

  it('rejects sub-frame senders', () => {
    const sender = makeSender(PROD_URL('pet'), petWin, { subframe: true });
    expect(() => validateIpcSender(sender, petWin, 'pet')).toThrow(IpcSenderError);
  });

  it('rejects senders from a different window', () => {
    const sender = makeSender(PROD_URL('pet'), petWin);
    expect(() => validateIpcSender(sender, panelWin, 'pet')).toThrow(IpcSenderError);
  });

  it('rejects URLs that are not a trusted renderer entry', () => {
    const sender = makeSender('https://evil.example/phish.html?surface=pet', petWin);
    expect(() => validateIpcSender(sender, petWin, 'pet')).toThrow(IpcSenderError);
  });

  it('rejects senders whose surface query does not match the channel surface', () => {
    const sender = makeSender(PROD_URL('panel'), petWin);
    expect(() => validateIpcSender(sender, petWin, 'pet')).toThrow(IpcSenderError);
  });

  it('rejects senders with no window backing the webContents', () => {
    const sender = makeSender(PROD_URL('pet'), null);
    expect(() => validateIpcSender(sender, petWin, 'pet')).toThrow(IpcSenderError);
  });
});

describe('isRendererUrl', () => {
  it('accepts the production file renderer entry', () => {
    expect(isRendererUrl(PROD_URL('pet'))).toBe(true);
  });

  it('accepts the dev renderer origin', () => {
    env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    expect(isRendererUrl('http://localhost:5173/?surface=pet')).toBe(true);
  });

  it('rejects foreign origins, other schemes and malformed URLs', () => {
    expect(isRendererUrl('https://evil.example/renderer/index.html?surface=pet')).toBe(false);
    expect(isRendererUrl('file:///E:/other/index.html?surface=pet')).toBe(false);
    expect(isRendererUrl('not a url')).toBe(false);
  });
});

describe('parseIpcPayload', () => {
  const schema = z.object({ x: z.number() });

  it('returns parsed data for a valid payload', () => {
    expect(parseIpcPayload(schema, { x: 1 })).toEqual({ x: 1 });
  });

  it('throws a stable error for an invalid payload', () => {
    expect(() => parseIpcPayload(schema, { x: 'nope' })).toThrow(IpcPayloadError);
    expect(() => parseIpcPayload(schema, { x: 'nope' })).toThrow('IPC payload 校验失败');
  });
});
