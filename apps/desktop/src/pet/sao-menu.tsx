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
  MessageCircle,
  MoreHorizontal,
  MousePointerClick,
  Sliders,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

export interface SaoMenuProps {
  isOpen: boolean;
  onClose: () => void;
  dnd?: boolean;
  onToggleDnd?: (enabled: boolean) => void;
  onTogglePassThrough?: (enabled: boolean) => void;
  onOpenPanel?: (view: 'chat' | 'friends' | 'character' | 'memories' | 'settings') => void;
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

/**
 * 弧形轨道几何 —— 左侧 C 型圆弧（圆心在宠物一侧、凸面向左）。
 * 关闭钮 + 5 个节点作为"珠子"等弧长分布在弧上；能量线在相邻珠子之间
 * 以独立弧段呈现（两端按图标半径收缩），不连续穿过图标本体。
 */
const TRACK = { cx: 126, cy: 142.7, r: 110 };
/** 锚点角度（度；0° = 弧最左点，正值向上），相邻锚点间隔 24° */
const ANCHOR_DEG = {
  close: 60,
  chat: 36,
  friends: 12,
  character: -12,
  memories: -36,
  controls: -60,
} as const;
const CLOSE_BTN_RADIUS = 10;
const NODE_RADIUS = 14;
const SEG_BREATH = 2; // 弧段与图标边缘的呼吸间隙（px）

const arcPoint = (deg: number) => ({
  x: TRACK.cx - TRACK.r * Math.cos((deg * Math.PI) / 180),
  y: TRACK.cy - TRACK.r * Math.sin((deg * Math.PI) / 180),
});

const ARC_POINTS = {
  close: arcPoint(ANCHOR_DEG.close),
  chat: arcPoint(ANCHOR_DEG.chat),
  friends: arcPoint(ANCHOR_DEG.friends),
  character: arcPoint(ANCHOR_DEG.character),
  memories: arcPoint(ANCHOR_DEG.memories),
  controls: arcPoint(ANCHOR_DEG.controls),
};

interface TrackSegment {
  d: string;
  length: number;
}

/** 相邻锚点之间的可见弧段：从当前图标边缘出发、到下一图标边缘前停下 */
const buildTrackSegments = (): TrackSegment[] => {
  const order: Array<{ deg: number; radius: number }> = [
    { deg: ANCHOR_DEG.close, radius: CLOSE_BTN_RADIUS },
    { deg: ANCHOR_DEG.chat, radius: NODE_RADIUS },
    { deg: ANCHOR_DEG.friends, radius: NODE_RADIUS },
    { deg: ANCHOR_DEG.character, radius: NODE_RADIUS },
    { deg: ANCHOR_DEG.memories, radius: NODE_RADIUS },
    { deg: ANCHOR_DEG.controls, radius: NODE_RADIUS },
  ];
  const shrinkDeg = (px: number) => (px / TRACK.r) * (180 / Math.PI);
  return order.slice(0, -1).map((cur, index) => {
    const next = order[index + 1]!;
    const from = cur.deg - shrinkDeg(cur.radius + SEG_BREATH);
    const to = next.deg + shrinkDeg(next.radius + SEG_BREATH);
    const p1 = arcPoint(from);
    const p2 = arcPoint(to);
    return {
      d: `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${TRACK.r} ${TRACK.r} 0 0 0 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
      length: (TRACK.r * (from - to) * Math.PI) / 180,
    };
  });
};

const TRACK_SEGMENTS = buildTrackSegments();

export function SaoMenu({
  isOpen,
  onClose,
  dnd = false,
  onToggleDnd,
  onTogglePassThrough,
  onOpenPanel,
  onShowNativeMenu,
}: SaoMenuProps) {
  const [activeSubMenu, setActiveSubMenu] = useState<'none' | 'quick_controls'>('none');
  const [isDnd, setIsDnd] = useState(dnd);

  useEffect(() => {
    setIsDnd(dnd);
  }, [dnd]);

  useEffect(() => {
    if (!isOpen) {
      setActiveSubMenu('none');
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

  const handleOpenView = (view: 'chat' | 'friends' | 'character' | 'memories' | 'settings') => {
    handleAction(() => {
      if (onOpenPanel) {
        onOpenPanel(view);
      } else {
        window.pet?.panel?.open({ view });
      }
    });
  };

  const handleToggleDndClick = () => {
    const next = !isDnd;
    setIsDnd(next);
    if (onToggleDnd) {
      onToggleDnd(next);
    } else {
      window.pet?.petRuntime?.setDnd(next);
    }
  };

  const handleTogglePassThroughClick = () => {
    handleAction(() => {
      if (onTogglePassThrough) {
        onTogglePassThrough(true);
      } else {
        window.pet?.petRuntime?.setPassThrough(true);
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

  // 左侧深空大 C 型轨迹（远距离悬浮，绝不碰触桌宠）
  const menuNodes: MenuItemNode[] = [
    {
      id: 'chat',
      label: '对话',
      sub: 'Message',
      icon: <MessageCircle size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--cyan',
      x: ARC_POINTS.chat.x,
      y: ARC_POINTS.chat.y,
      onClick: () => handleOpenView('chat'),
    },
    {
      id: 'friends',
      label: '好友',
      sub: 'Friends',
      icon: <Users size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--indigo',
      x: ARC_POINTS.friends.x,
      y: ARC_POINTS.friends.y,
      onClick: () => handleOpenView('friends'),
    },
    {
      id: 'character',
      label: '角色',
      sub: 'Avatar',
      icon: <Sparkles size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--purple',
      x: ARC_POINTS.character.x,
      y: ARC_POINTS.character.y,
      onClick: () => handleOpenView('character'),
    },
    {
      id: 'memories',
      label: '记忆',
      sub: 'Memory',
      icon: <Brain size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--amber',
      x: ARC_POINTS.memories.x,
      y: ARC_POINTS.memories.y,
      onClick: () => handleOpenView('memories'),
    },
    {
      id: 'controls',
      label: '控制',
      sub: 'Controls',
      icon: <Sliders size={14} aria-hidden="true" />,
      colorClass: 'sao-ring-node--teal',
      x: ARC_POINTS.controls.x,
      y: ARC_POINTS.controls.y,
      onClick: () =>
        setActiveSubMenu((prev) => (prev === 'quick_controls' ? 'none' : 'quick_controls')),
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
        <svg className="sao-left-track-svg" viewBox="0 0 240 260" aria-hidden="true">
          {TRACK_SEGMENTS.map((seg, index) => (
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
            left: ARC_POINTS.close.x - CLOSE_BTN_RADIUS,
            top: ARC_POINTS.close.y - CLOSE_BTN_RADIUS,
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
                left: node.x - NODE_RADIUS,
                top: node.y - NODE_RADIUS,
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
                {/* 悬停时向右内侧浮现的 SAO 全息发光胶囊标签（安全区域，永不被裁切） */}
                <span className="sao-ring-pill sao-ring-pill--right">
                  <strong>{node.label}</strong>
                  <small>{node.sub}</small>
                </span>
              </button>
            </div>
          );
        })}

        {/* SAO 环形二级全息快捷控制面板（展开时位于中间安全区） */}
        {activeSubMenu === 'quick_controls' && (
          <div
            className="sao-radial-sub sao-radial-sub--right"
            style={{ left: 58, top: 96 }}
            role="region"
            aria-label="快捷控制面板"
          >
            <div className="sao-radial-sub__title">
              <span className="sao-gem-mini" aria-hidden="true" />
              QUICK CONTROLS
            </div>
            <div className="sao-radial-sub__items">
              <button
                className={`sao-sub-chip ${isDnd ? 'sao-sub-chip--active' : ''}`}
                type="button"
                onClick={handleToggleDndClick}
                title={isDnd ? '关闭勿扰' : '开启勿扰'}
              >
                {isDnd ? <VolumeX size={13} /> : <Volume2 size={13} />}
                <span>{isDnd ? '勿扰: 开' : '勿扰: 关'}</span>
              </button>

              <button
                className="sao-sub-chip"
                type="button"
                onClick={handleTogglePassThroughClick}
                title="开启鼠标穿透"
              >
                <MousePointerClick size={13} />
                <span>鼠标穿透</span>
              </button>

              <button
                className="sao-sub-chip"
                type="button"
                onClick={() => handleOpenView('settings')}
                title="偏好设置"
              >
                <Sliders size={13} />
                <span>详细设置</span>
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
      </div>
    </div>
  );
}
