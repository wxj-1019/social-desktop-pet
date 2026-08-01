/**
 * SSE 客户端解析 —— 不用 EventSource（无法带 Authorization header），
 * 用 fetch + ReadableStream 手动解析 text/event-stream 帧。
 *
 * 帧格式：事件以空行分隔，每行 `event: <type>` 或 `data: <json>`。
 */
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * 纯函数：增量解析 SSE 字节流。
 * @param buffer 累积的未消费文本（跨 chunk 保留）
 * @param chunk 新到达的文本
 * @returns { frames, rest }——完整帧列表 + 剩余未完成文本
 */
export function parseSseChunks(
  buffer: string,
  chunk: string,
): { frames: SseFrame[]; rest: string } {
  const text = buffer + chunk;
  const frames: SseFrame[] = [];
  let rest = text;

  // 空行分隔帧
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const frame = parseSseBlock(block);
    if (frame) frames.push(frame);
  }
  return { frames, rest };
}

/** 解析单个 SSE 块（event/data 行） */
export function parseSseBlock(block: string): SseFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
