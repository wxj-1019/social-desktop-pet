/**
 * StateGraph —— 显式状态图构建与执行。
 *
 * 用法：
 *   const graph = new StateGraph<MyState>()
 *     .addNode('auth', authNode)
 *     .addNode('classify', classifyNode)
 *     .addEdge(START, 'auth')
 *     .addEdge('auth', 'classify')
 *     .addConditionalEdge('classify', (s) => s.route === 'SAFETY' ? 'crisis' : 'retrieve')
 *     .addEdge('crisis', END)
 *     .compile({ checkpointer });
 *   const finalState = await graph.invoke(initialState, { threadId, emit });
 */
import {
  type Checkpointer,
  END,
  START,
  type ConditionFn,
  type GraphEvent,
  type GraphRunContext,
  type NodeFn,
  type NodeName,
} from './types.js';

export interface CompiledGraphOptions<S extends object> {
  checkpointer?: Checkpointer<S>;
  /** 最大节点跳转数（防环） */
  recursionLimit?: number;
}

export class StateGraph<S extends object> {
  private nodes = new Map<NodeName, NodeFn<S>>();
  private edges = new Map<NodeName, NodeName>();
  private conditionalEdges = new Map<NodeName, ConditionFn<S>>();

  /** 注册一个节点 */
  addNode(name: NodeName, fn: NodeFn<S>): this {
    this.nodes.set(name, fn);
    return this;
  }

  /** 无条件边：从 from 走到 to */
  addEdge(from: NodeName | typeof START, to: NodeName | typeof END): this {
    this.edges.set(from, to);
    return this;
  }

  /** 条件边：根据状态决定下一节点 */
  addConditionalEdge(from: NodeName, condition: ConditionFn<S>): this {
    this.conditionalEdges.set(from, condition);
    return this;
  }

  /** 编译为可执行图 */
  compile(options: CompiledGraphOptions<S> = {}): CompiledGraph<S> {
    return new CompiledGraph(this.nodes, this.edges, this.conditionalEdges, options);
  }
}

export class CompiledGraph<S extends object> {
  private readonly recursionLimit: number;

  constructor(
    private readonly nodes: Map<NodeName, NodeFn<S>>,
    private readonly edges: Map<NodeName, NodeName>,
    private readonly conditionalEdges: Map<NodeName, ConditionFn<S>>,
    private readonly options: CompiledGraphOptions<S>,
  ) {
    this.recursionLimit = options.recursionLimit ?? 25;
  }

  /** 执行图至 END，返回最终状态 */
  async invoke(
    initial: S,
    ctx: Omit<GraphRunContext, 'emit'> & { emit?: (e: GraphEvent) => void },
  ): Promise<S> {
    const emit = ctx.emit ?? (() => {});
    const runCtx: GraphRunContext = { ...ctx, emit };
    let state: S = initial;
    const startNode = this.edges.get(START);
    if (!startNode) throw new Error('StateGraph: 缺少 START 边');
    let current: NodeName = startNode;

    for (let step = 0; step < this.recursionLimit; step++) {
      if (current === END) break;
      if (ctx.signal?.aborted) throw new Error('Graph aborted');

      const fn = this.nodes.get(current);
      if (!fn) throw new Error(`StateGraph: 未知节点 "${current}"`);

      const startTs = Date.now();
      emit({ type: 'node_start', node: current, timestamp: startTs });
      const patch = await fn(state, runCtx);
      // 状态不可变合并
      state = { ...state, ...patch };
      const endTs = Date.now();
      emit({ type: 'node_end', node: current, timestamp: endTs, durationMs: endTs - startTs });

      // checkpoint
      if (this.options.checkpointer) {
        await this.options.checkpointer.save(ctx.threadId, current, state);
        emit({ type: 'checkpoint', node: current, stateVersion: step });
      }

      // 决定下一节点：优先条件边，其次无条件边
      const cond = this.conditionalEdges.get(current);
      current = cond ? cond(state) : (this.edges.get(current) ?? END);
    }

    if (current !== END) throw new Error(`StateGraph: 超过递归上限 ${this.recursionLimit}`);
    return state;
  }

  /** 获取图结构（用于可视化/调试） */
  getStructure() {
    return {
      nodes: [...this.nodes.keys()],
      edges: [...this.edges.entries()].map(([from, to]) => ({ from, to })),
      conditionalEdges: [...this.conditionalEdges.keys()],
    };
  }
}
