/**
 * SaoMenu —— 刀剑神域 (Sword Art Online) 纯正【左侧远距离大 C 型全息轮盘托盘】(Deep Left C-Arc Orbit)。
 *
 * 核心优化：
 * 1. 彻底拉开超远距离：水晶球深空凸出至 X: 18px，与右侧桌宠保持 70px~80px 的超大开阔呼吸间距
 * 2. 图标如"珠子"等弧长串在左侧 C 型圆弧上（R=110，相邻锚点间隔 24°），
 *    整体压向窗口左下角、与右侧桌宠拉开距离；
 *    能量线只在相邻珠子之间以独立弧段呈现（两端按图标半径收缩，不穿图标本体）
 * 3. SVG 固定 240×260 设计坐标（不随窗口缩放），与节点像素定位永远 1:1 对齐
 * 3. 悬停胶囊稳居中间宽阔安全区：完全无裁切，字迹晶莹通透
 * 4. 动线 100% 像素级无缝贯穿中心
 */
import {
  Brain,
  EyeOff,
  MessageCircle,
  MoreHorizontal,
  MousePointerClick,
  Palette,
  Sliders,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import type { LocalLlmConfigView } from '@pet/protocol';

import { localReply } from '../lib/local-mode.js';

export interface SaoMenuProps {
  isOpen: boolean;
  onClose: () => void;
  dnd?: boolean;
  /** 当前穿透态（运行时快照驱动；托盘/设置页改动实时反射） */
  passThrough?: boolean;
  onToggleDnd?: (enabled: boolean) => void;
  onTogglePassThrough?: (enabled: boolean) => void;
  /** 隐藏桌宠（与托盘 hide 同源；经托盘"显示"恢复） */
  onHidePet?: () => void;
  /** 切换环形菜单 UI 风格（'sao' 链式弧 ↔ 'classic' 环状） */
  onSwitchMenuStyle?: () => void;
  onOpenPanel?: (
    view: 'chat' | 'friends' | 'character' | 'memories' | 'settings' | 'model',
  ) => void;
  onShowNativeMenu?: () => void;
}

interface MenuItemNode {
  id: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
  colorClass: string;
  x: number; // 像素级横坐标 (px)
  y: number; // 像素级纵坐标 (px)
  onClick: () => void;
}

/** 二级毛玻璃面板的锚点：从节点圆心向右弹出，水平/垂直都钳制在当前窗口内。
 * 面板宽/高按窗口收缩（请求高度超窗口时压缩，内容由面板内部滚动兜底），
 * 任意窗口缩放（桌宠大小档位 0.5–2.0）下面板都完整可见。 */
const SUB_PANEL_MARGIN = 8;
const SUB_PANEL_W_MAX = 168;

/**
 * 弧形轨道几何 —— 左侧 C 型圆弧（圆心在宠物一侧、凸面向左）。
 * 关闭钮 + 5 个节点作为"珠子"等弧长分布在弧上；能量线在相邻珠子之间
 * 以独立弧段呈现（两端按图标半径收缩），不连续穿过图标本体。
 *
 * 窗口缩放适配：240×260 基准下的全部几何按窗口等比重算 —— 弧/节点永远
 * 完整落在窗口内；节点半径钳制下限保证内容可读（"整容器 transform: scale"
 * 方案会让节点/文字随小窗一起缩到看不清，这是它的根因）。
 */
const TRACK_RATIO = { cx: 126 / 240, cy: 142.7 / 260, r: 110 / 240 };
/** 锚点角度（度；0° = 弧最左点，正值向上），相邻锚点间隔 20°（6 节点容纳模型项） */
const ANCHOR_DEG = {
  close: 66,
  chat: 46,
  friends: 26,
  character: 6,
  memories: -14,
  model: -34,
  controls: -54,
} as const;
type AnchorKey = keyof typeof ANCHOR_DEG;
const SEG_BREATH = 2; // 弧段与图标边缘的呼吸间隙（px）
/** 节点半径下限/上限：14px 是 240×260 基准值；小窗最低 11px 保证可点可读 */
const NODE_RADIUS_MIN = 11;
const NODE_RADIUS_MAX = 17;
const CLOSE_BTN_RADIUS = 10; // 顶部关闭钮固定（不与节点争弧上间距）

interface TrackSegment {
  d: string;
  length: number;
}

export interface SaoMenuGeometry {
  w: number;
  h: number;
  track: { cx: number; cy: number; r: number };
  nodeRadius: number;
  closeRadius: number;
  points: Record<AnchorKey, { x: number; y: number }>;
  segments: TrackSegment[];
  /** 二级面板尺寸/位置计算（按当前窗口钳制，面板完整可见） */
  subPanelPos: (
    node: { x: number; y: number },
    height: number,
  ) => {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

/** 按窗口尺寸计算 SAO 菜单几何（240×260 基准等比；导出供测试） */
export function computeSaoMenuGeometry(w: number, h: number): SaoMenuGeometry {
  const cx = TRACK_RATIO.cx * w;
  const cy = TRACK_RATIO.cy * h;
  const r = Math.min(TRACK_RATIO.r * w, TRACK_RATIO.r * h);
  const nodeRadius = Math.min(NODE_RADIUS_MAX, Math.max(NODE_RADIUS_MIN, 14 * (r / 110)));

  const arcPoint = (deg: number) => ({
    x: cx - r * Math.cos((deg * Math.PI) / 180),
    y: cy - r * Math.sin((deg * Math.PI) / 180),
  });
  const points = Object.fromEntries(
    (Object.entries(ANCHOR_DEG) as Array<[AnchorKey, number]>).map(([key, deg]) => [
      key,
      arcPoint(deg),
    ]),
  ) as Record<AnchorKey, { x: number; y: number }>;

  /** 相邻锚点之间的可见弧段：从当前图标边缘出发、到下一图标边缘前停下 */
  const order: Array<{ deg: number; radius: number }> = [
    { deg: ANCHOR_DEG.close, radius: CLOSE_BTN_RADIUS },
    { deg: ANCHOR_DEG.chat, radius: nodeRadius },
    { deg: ANCHOR_DEG.friends, radius: nodeRadius },
    { deg: ANCHOR_DEG.character, radius: nodeRadius },
    { deg: ANCHOR_DEG.memories, radius: nodeRadius },
    { deg: ANCHOR_DEG.model, radius: nodeRadius },
    { deg: ANCHOR_DEG.controls, radius: nodeRadius },
  ];
  const shrinkDeg = (px: number) => (px / r) * (180 / Math.PI);
  const segments = order.slice(0, -1).map((cur, index) => {
    const next = order[index + 1]!;
    const from = cur.deg - shrinkDeg(cur.radius + SEG_BREATH);
    const to = next.deg + shrinkDeg(next.radius + SEG_BREATH);
    const p1 = arcPoint(from);
    const p2 = arcPoint(to);
    return {
      d: `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${r} ${r} 0 0 0 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
      length: (r * (from - to) * Math.PI) / 180,
    };
  });

  const subPanelPos = (
    node: { x: number; y: number },
    height: number,
  ): { left: number; top: number; width: number; height: number } => {
    const width = Math.min(SUB_PANEL_W_MAX, w - SUB_PANEL_MARGIN * 2);
    const panelH = Math.max(SUB_PANEL_MARGIN * 2, Math.min(height, h - SUB_PANEL_MARGIN * 2));
    const top = Math.min(
      Math.max(node.y - panelH / 2, SUB_PANEL_MARGIN),
      h - panelH - SUB_PANEL_MARGIN,
    );
    const left = Math.min(
      Math.max(node.x + nodeRadius + 10, SUB_PANEL_MARGIN),
      Math.max(w - width - SUB_PANEL_MARGIN, SUB_PANEL_MARGIN),
    );
    return { left, top, width, height: panelH };
  };

  return {
    w,
    h,
    track: { cx, cy, r },
    nodeRadius,
    closeRadius: CLOSE_BTN_RADIUS,
    points,
    segments,
    subPanelPos,
  };
}

/** 菜单画布恒为 240×260 基准（与 Main 侧 PET_WINDOW_SIZE 对应）：菜单展开时
 *  Main 已把窗口临时扩到 ≥ 基准并右下锚定（pet:set-menu-canvas），几何不随
 *  窗口/缩放档位重算 —— 任何档位（0.5–2.0）下菜单尺寸、位置恒定且完整可见。 */
const MENU_CANVAS = { width: 240, height: 260 };

export function SaoMenu({
  isOpen,
  onClose,
  dnd = false,
  passThrough = false,
  onToggleDnd,
  onTogglePassThrough,
  onHidePet,
  onSwitchMenuStyle,
  onOpenPanel,
  onShowNativeMenu,
}: SaoMenuProps) {
  const [activeSubMenu, setActiveSubMenu] = useState<
    'none' | 'quick_controls' | 'chat' | 'model' | 'friends' | 'character' | 'memories'
  >('none');

  // 菜单几何恒用 240×260 基准（展开期间窗口已由 Main 扩到 ≥ 基准、右下锚定）：
  // 不再按 innerWidth/innerHeight 重算 —— 按窗口压缩几何是小档位（如 0.5 档
  // 120×130）下菜单被截断/节点重叠的根因
  const geometry = useMemo(() => computeSaoMenuGeometry(MENU_CANVAS.width, MENU_CANVAS.height), []);

  // 迷你聊天（chat 二级菜单）本地状态
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<Array<{ role: 'user' | 'pet'; text: string }>>([]);
  const [chatPending, setChatPending] = useState(false);
  // 模型二级菜单
  const [llmView, setLlmView] = useState<LocalLlmConfigView | null>(null);
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmSaved, setLlmSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const toggleSub = (key: Exclude<typeof activeSubMenu, 'none'>) =>
    setActiveSubMenu((prev) => (prev === key ? 'none' : key));

  useEffect(() => {
    if (!isOpen) {
      setActiveSubMenu('none');
      setChatInput('');
      setChatPending(false);
      setLlmApiKey('');
      setLlmSaved('idle');
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  /** 打开主面板并定位到某视图（所有二级菜单共用"完整面板"入口） */
  const openPanelView = (
    view: 'chat' | 'friends' | 'character' | 'memories' | 'settings' | 'model',
  ) => {
    if (onOpenPanel) onOpenPanel(view);
    else window.pet?.panel?.open({ view });
  };

  /** SAO 迷你聊天发送（LLM 配置好走模型，否则规则引擎兜底；动作联动 Main 状态机） */
  const sendMiniChat = async () => {
    const text = chatInput.trim();
    if (!text || chatPending) return;
    setChatInput('');
    setChatPending(true);
    setChatLog((prev) => [...prev.slice(-9), { role: 'user', text }]);
    window.pet?.petRuntime?.chatEvent({ phase: 'start', source: 'local_chat', text });

    let reply: string;
    try {
      const result = await window.pet?.localLlm?.chat({
        messages: [
          {
            role: 'system',
            content:
              '你是用户的桌面小宠物"星屿"，温暖、好奇、话少。用中文回复，一次不超过两句话（60字以内），' +
              '语气轻松可爱。不讨论敏感话题，不扮演真实人类，不说自己是大模型。',
          },
          ...chatLog.slice(-8).map((m) => ({
            role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
            content: m.text,
          })),
          { role: 'user', content: text },
        ],
      });
      reply = result && 'reply' in result && result.reply ? result.reply : localReply(text);
    } catch {
      reply = localReply(text);
    }
    setChatLog((prev) => [...prev.slice(-9), { role: 'pet', text: reply }]);
    setChatPending(false);
    window.pet?.petRuntime?.chatEvent({
      phase: 'done',
      source: 'local_chat',
      output: { dialogue: reply, emotion: 'warm', actionIntent: 'nod', intensity: 1 },
    });
  };

  /** 打开模型二级菜单时拉取当前配置视图 */
  const openModelSub = () => {
    toggleSub('model');
    void window.pet?.localLlm?.getView().then((view) => setLlmView(view));
  };

  const saveModelConfig = async () => {
    if (!llmView) return;
    setLlmSaved('saving');
    try {
      const saved = await window.pet?.localLlm?.save({
        enabled: llmView.enabled,
        baseUrl: llmView.baseUrl,
        apiKey: llmApiKey,
        model: llmView.model,
      });
      if (saved) setLlmView(saved);
      setLlmApiKey('');
      setLlmSaved('saved');
    } catch {
      setLlmSaved('error');
    }
  };

  const handleToggleDndClick = () => {
    if (onToggleDnd) {
      onToggleDnd(!dnd);
    } else {
      window.pet?.petRuntime?.setDnd(!dnd);
    }
  };

  // 穿透可开可关（托盘/设置页同源；快照广播会把新状态反射回本菜单）
  const handleTogglePassThroughClick = () => {
    if (onTogglePassThrough) {
      onTogglePassThrough(!passThrough);
    } else {
      window.pet?.petRuntime?.setPassThrough(!passThrough);
    }
  };

  const handleHidePetClick = () => {
    handleAction(() => {
      if (onHidePet) {
        onHidePet();
      } else {
        window.pet?.petRuntime?.setHidden?.(true);
      }
    });
  };

  const handleNativeMenuClick = () => {
    handleAction(() => {
      if (onShowNativeMenu) {
        onShowNativeMenu();
      } else {
        window.pet?.petRuntime?.showContextMenu();
      }
    });
  };

  const handleSwitchStyleClick = () => {
    // 先关菜单再切皮肤：避免切完后菜单仍开着、渲染出新皮肤的旧状态
    if (onSwitchMenuStyle) {
      onSwitchMenuStyle();
    } else {
      void window.pet?.petProfile?.get().then((profile) => {
        void window.pet?.petProfile?.set({ ...profile, menuStyle: 'classic' });
      });
    }
    onClose();
  };

  // 左侧深空大 C 型轨迹（远距离悬浮，绝不碰触桌宠）
  const menuNodes: MenuItemNode[] = [
    {
      id: 'chat',
      label: '对话',
      sub: 'Message',
      icon: <MessageCircle size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--cyan',
      x: geometry.points.chat.x,
      y: geometry.points.chat.y,
      onClick: () => toggleSub('chat'),
    },
    {
      id: 'friends',
      label: '好友',
      sub: 'Friends',
      icon: <Users size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--indigo',
      x: geometry.points.friends.x,
      y: geometry.points.friends.y,
      onClick: () => toggleSub('friends'),
    },
    {
      id: 'character',
      label: '角色',
      sub: 'Avatar',
      icon: <Sparkles size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--purple',
      x: geometry.points.character.x,
      y: geometry.points.character.y,
      onClick: () => toggleSub('character'),
    },
    {
      id: 'memories',
      label: '记忆',
      sub: 'Memory',
      icon: <Brain size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--amber',
      x: geometry.points.memories.x,
      y: geometry.points.memories.y,
      onClick: () => toggleSub('memories'),
    },
    {
      id: 'model',
      label: '模型',
      sub: 'LLM',
      icon: <Sparkles size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--cyan',
      x: geometry.points.model.x,
      y: geometry.points.model.y,
      onClick: () => openModelSub(),
    },
    {
      id: 'controls',
      label: '控制',
      sub: 'Controls',
      icon: <Sliders size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--teal',
      x: geometry.points.controls.x,
      y: geometry.points.controls.y,
      onClick: () => toggleSub('quick_controls'),
    },
  ];

  return (
    <div
      className="sao-radial-overlay"
      data-testid="sao-menu"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 左侧深空大 C 型全息菜单容器 */}
      <div className="sao-left-menu" role="menu" aria-label="SAO 左侧系统菜单">
        {/* 珠链式能量弧段：图标串在弧上，线只在珠间出现（每段一颗能量珠巡游） */}
        <svg
          className="sao-left-track-svg"
          viewBox={`0 0 ${geometry.w} ${geometry.h}`}
          aria-hidden="true"
        >
          {geometry.segments.map((seg, index) => (
            <g key={index}>
              <path className="sao-seg-base" d={seg.d} />
              <path
                className="sao-seg-run"
                d={seg.d}
                style={
                  {
                    '--seg-len': `${seg.length.toFixed(1)}px`,
                    '--comet-len': `${(seg.length * 0.55).toFixed(1)}px`,
                    animationDelay: `${index * 0.12}s`,
                  } as React.CSSProperties
                }
              />
            </g>
          ))}
        </svg>

        {/* 顶部关闭按钮 (位于弧顶端锚点) */}
        <button
          className="sao-left-close"
          style={{
            left: geometry.points.close.x - geometry.closeRadius,
            top: geometry.points.close.y - geometry.closeRadius,
          }}
          type="button"
          aria-label="关闭环形托盘"
          title="关闭 (Esc)"
          onClick={onClose}
        >
          <X size={11} aria-hidden="true" />
        </button>

        {/* 左侧 5 个发光水晶球节点 */}
        {menuNodes.map((node, index) => {
          const isControlActive = node.id === 'controls' && activeSubMenu === 'quick_controls';

          return (
            <div
              key={node.id}
              className="sao-left-slot"
              style={{
                left: node.x - geometry.nodeRadius,
                top: node.y - geometry.nodeRadius,
                animationDelay: `${index * 0.04}s`,
              }}
            >
              <button
                className={`sao-ring-node ${node.colorClass} ${isControlActive ? 'sao-ring-node--active' : ''}`}
                type="button"
                role="menuitem"
                onClick={node.onClick}
                title={`${node.label} (${node.sub})`}
              >
                {node.icon}
                {/* 悬停时向右内侧浮现的 SAO 全息发光胶囊标签（随节点半径贴边，小窗不越界） */}
                <span
                  className="sao-ring-pill sao-ring-pill--right"
                  style={{ left: geometry.nodeRadius + 24 }}
                >
                  <strong>{node.label}</strong>
                  <small>{node.sub}</small>
                </span>
              </button>
            </div>
          );
        })}

        {/* SAO 二级菜单：动态锚定在对应节点右侧，毛玻璃卡片 */}
        {/* 快捷控制 */}
        {activeSubMenu === 'quick_controls' && (
          <div
            className="sao-radial-sub sao-radial-sub--right"
            style={geometry.subPanelPos(geometry.points.controls, 190)}
            role="region"
            aria-label="快捷控制面板"
          >
            <div className="sao-radial-sub__title">
              <span className="sao-gem-mini" aria-hidden="true" />
              QUICK CONTROLS
            </div>
            <div className="sao-radial-sub__items">
              <button
                className={`sao-sub-chip ${dnd ? 'sao-sub-chip--active' : ''}`}
                type="button"
                onClick={handleToggleDndClick}
                title={dnd ? '关闭勿扰' : '开启勿扰'}
              >
                {dnd ? <VolumeX size={13} /> : <Volume2 size={13} />}
                <span>{dnd ? '勿扰: 开' : '勿扰: 关'}</span>
              </button>

              <button
                className={`sao-sub-chip ${passThrough ? 'sao-sub-chip--active' : ''}`}
                type="button"
                onClick={handleTogglePassThroughClick}
                title={passThrough ? '关闭鼠标穿透' : '开启鼠标穿透'}
              >
                <MousePointerClick size={13} />
                <span>{passThrough ? '穿透: 开' : '穿透: 关'}</span>
              </button>

              <button
                className="sao-sub-chip"
                type="button"
                onClick={() => handleAction(() => openPanelView('settings'))}
                title="偏好设置"
              >
                <Sliders size={13} />
                <span>详细设置</span>
              </button>

              <button
                className="sao-sub-chip"
                type="button"
                onClick={handleHidePetClick}
                title="临时收起桌宠（托盘可恢复）"
              >
                <EyeOff size={13} />
                <span>隐藏桌宠</span>
              </button>

              <button
                className="sao-sub-chip"
                type="button"
                onClick={handleSwitchStyleClick}
                title="切换菜单皮肤：SAO 链式弧 ↔ 经典环状"
              >
                <Palette size={13} />
                <span>换肤</span>
              </button>

              <button
                className="sao-sub-chip sao-sub-chip--native"
                type="button"
                onClick={handleNativeMenuClick}
                title="呼出系统原生菜单"
              >
                <MoreHorizontal size={13} />
                <span>系统托盘</span>
              </button>
            </div>
          </div>
        )}

        {/* 对话二级菜单：迷你聊天（LLM 走本地 BYOK，失败回退规则引擎） */}
        {activeSubMenu === 'chat' && (
          <div
            className="sao-radial-sub sao-radial-sub--right sao-sub--chat"
            style={geometry.subPanelPos(geometry.points.chat, 216)}
            role="region"
            aria-label="迷你聊天"
          >
            <div className="sao-radial-sub__title">
              <MessageCircle size={10} aria-hidden="true" />
              MINI CHAT
            </div>
            <div className="sao-chat-log" role="log" aria-label="聊天记录">
              {chatLog.length === 0 && <p className="sao-chat-empty">打个招呼吧</p>}
              {chatLog.map((m, i) => (
                <div key={i} className={`sao-chat-row sao-chat-row--${m.role}`}>
                  {m.text}
                </div>
              ))}
              {chatPending && <div className="sao-chat-row sao-chat-row--pet">…</div>}
            </div>
            <form
              className="sao-chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMiniChat();
              }}
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="说点什么…"
                maxLength={200}
                aria-label="给星屿发消息"
              />
              <button type="submit" aria-label="发送" disabled={!chatInput.trim()}>
                <MessageCircle size={12} />
              </button>
            </form>
          </div>
        )}

        {/* 模型二级菜单：BYOK 配置（OpenAI 兼容） */}
        {activeSubMenu === 'model' && (
          <div
            className="sao-radial-sub sao-radial-sub--right sao-sub--model"
            style={geometry.subPanelPos(geometry.points.model, 226)}
            role="region"
            aria-label="本地模型配置"
          >
            <div className="sao-radial-sub__title">
              <Sparkles size={10} aria-hidden="true" />
              LOCAL LLM
            </div>
            <label className="sao-model-row">
              <span>启用</span>
              <input
                type="checkbox"
                checked={llmView?.enabled ?? false}
                onChange={(e) =>
                  setLlmView((prev) => prev && { ...prev, enabled: e.target.checked })
                }
                aria-label="启用本地模型"
              />
            </label>
            <label className="sao-model-field">
              <span>基址</span>
              <input
                type="url"
                value={llmView?.baseUrl ?? ''}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => setLlmView((prev) => prev && { ...prev, baseUrl: e.target.value })}
                aria-label="本地模型接口基址"
              />
            </label>
            <label className="sao-model-field">
              <span>模型</span>
              <input
                type="text"
                value={llmView?.model ?? ''}
                placeholder="gpt-4o-mini"
                onChange={(e) => setLlmView((prev) => prev && { ...prev, model: e.target.value })}
                aria-label="本地模型名称"
              />
            </label>
            <label className="sao-model-field">
              <span>Key{llmView?.hasApiKey ? '（已存）' : ''}</span>
              <input
                type="password"
                value={llmApiKey}
                placeholder={llmView?.hasApiKey ? '留空保留旧密钥' : 'sk-…'}
                onChange={(e) => setLlmApiKey(e.target.value)}
                aria-label="本地模型 API Key"
                autoComplete="off"
              />
            </label>
            <div className="sao-model-actions">
              <button
                type="button"
                onClick={() => void saveModelConfig()}
                disabled={llmSaved === 'saving'}
              >
                {llmSaved === 'saving' ? '保存中…' : '保存'}
              </button>
              <button type="button" onClick={() => handleAction(() => openPanelView('model'))}>
                完整设置
              </button>
              {llmSaved === 'saved' && <small className="ok">已保存</small>}
              {llmSaved === 'error' && <small className="err">请填全后重试</small>}
            </div>
          </div>
        )}

        {/* 角色二级菜单 */}
        {activeSubMenu === 'character' && (
          <div
            className="sao-radial-sub sao-radial-sub--right"
            style={geometry.subPanelPos(geometry.points.character, 130)}
            role="region"
            aria-label="角色"
          >
            <div className="sao-radial-sub__title">
              <Sparkles size={10} aria-hidden="true" />
              CHARACTER
            </div>
            <p className="sao-sub-note">在主面板中预览并切换星屿 / CodeNoNo 皮肤。</p>
            <div className="sao-model-actions">
              <button type="button" onClick={() => handleAction(() => openPanelView('character'))}>
                打开角色页
              </button>
            </div>
          </div>
        )}

        {/* 好友二级菜单 */}
        {activeSubMenu === 'friends' && (
          <div
            className="sao-radial-sub sao-radial-sub--right"
            style={geometry.subPanelPos(geometry.points.friends, 130)}
            role="region"
            aria-label="好友"
          >
            <div className="sao-radial-sub__title">
              <Users size={10} aria-hidden="true" />
              FRIENDS
            </div>
            <p className="sao-sub-note">好友互访、送礼需要登录账号，前往主面板解锁。</p>
            <div className="sao-model-actions">
              <button type="button" onClick={() => handleAction(() => openPanelView('friends'))}>
                打开好友页
              </button>
            </div>
          </div>
        )}

        {/* 记忆二级菜单 */}
        {activeSubMenu === 'memories' && (
          <div
            className="sao-radial-sub sao-radial-sub--right"
            style={geometry.subPanelPos(geometry.points.memories, 130)}
            role="region"
            aria-label="记忆"
          >
            <div className="sao-radial-sub__title">
              <Brain size={10} aria-hidden="true" />
              MEMORY
            </div>
            <p className="sao-sub-note">云端记忆中心在主面板；本地聊天自动留存最近 50 条。</p>
            <div className="sao-model-actions">
              <button type="button" onClick={() => handleAction(() => openPanelView('memories'))}>
                打开记忆页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
