/**
 * Span 收集器 —— 对应设计稿 11.2 第四道隔离（检索/写入审计日志）。
 *
 * 图执行时每个 node_start/node_end 自动产出 span，
 * 喂给 11.2 审计日志与未来 LangSmith 式可观测面板。
 */
import type { GraphEvent } from '../runtime/types.js';

export interface SpanRecord {
  node: string;
  startedAt: number;
  durationMs: number;
  threadId: string;
}

export class SpanCollector {
  private spans: SpanRecord[] = [];
  private startMap = new Map<string, number>();

  /** 返回可作为 GraphRunContext.emit 的回调 */
  sink = (threadId: string): ((e: GraphEvent) => void) => {
    return (e: GraphEvent) => {
      if (e.type === 'node_start') {
        this.startMap.set(`${threadId}:${e.node}`, e.timestamp);
      } else if (e.type === 'node_end') {
        const start = this.startMap.get(`${threadId}:${e.node}`);
        if (start !== undefined) {
          this.spans.push({
            node: e.node,
            startedAt: start,
            durationMs: e.durationMs,
            threadId,
          });
          this.startMap.delete(`${threadId}:${e.node}`);
        }
      }
    };
  };

  /** 取出并清空（供持久化为审计日志） */
  drain(): SpanRecord[] {
    const out = this.spans;
    this.spans = [];
    return out;
  }
}
