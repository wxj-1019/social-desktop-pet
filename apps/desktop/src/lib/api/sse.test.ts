import { describe, expect, it } from 'vitest';

import { parseSseBlock, parseSseChunks } from './sse.js';

describe('parseSseChunks（SSE 流式解析，客户端）', () => {
  it('parses a complete frame with event + data', () => {
    const { frames, rest } = parseSseChunks('', 'event: token\ndata: {"text":"你"}\n\n');
    expect(frames).toEqual([{ event: 'token', data: '{"text":"你"}' }]);
    expect(rest).toBe('');
  });

  it('handles frames split across chunks (跨 chunk 缓冲)', () => {
    // 第一块只有半个帧
    const first = parseSseChunks('', 'event: node_start\ndata: {"node":"auth"}');
    expect(first.frames).toHaveLength(0);
    expect(first.rest).toContain('node_start');
    // 第二块补齐
    const second = parseSseChunks(first.rest, '\n\n');
    expect(second.frames).toHaveLength(1);
    expect(second.frames[0]?.event).toBe('node_start');
  });

  it('parses multiple frames in one chunk and keeps trailing partial', () => {
    const { frames, rest } = parseSseChunks(
      '',
      'event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c',
    );
    expect(frames).toHaveLength(2);
    expect(frames[0]?.event).toBe('a');
    expect(frames[1]?.event).toBe('b');
    expect(rest).toBe('event: c'); // 未完成的第三帧
  });

  it('skips blocks without data lines (comment/ping frames)', () => {
    expect(parseSseBlock(': keep-alive')).toBeNull();
    expect(parseSseBlock('event: ping\n')).toBeNull();
  });

  it('joins multi-line data payloads', () => {
    const frame = parseSseBlock('event: done\ndata: {"dialogue":"你好"}\n');
    expect(frame?.event).toBe('done');
    expect(JSON.parse(frame?.data ?? '{}')).toEqual({ dialogue: '你好' });
  });
});
