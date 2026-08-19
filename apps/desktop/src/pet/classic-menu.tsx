/**
 * ClassicMenu —— 第二套环形菜单 UI（经典环状，桌面端泛用风）。
 *
 * 与 SaoMenu（左侧链式弧 + 统一靛青全息）互为可切换皮肤：
 * 右键切换开合、同一组动作（开面板 5 视图 / 勿扰 / 穿透 / 隐藏 / 系统菜单）。
 * 节点环绕桌宠（窗口右下）布局，毛玻璃深色卡片；当前激活态由快照驱动。
 */
import {
  Brain,
  EyeOff,
  MessageCircle,
  MoreHorizontal,
  MousePointerClick,
  Settings2,
  Sliders,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

export interface ClassicMenuProps {
  isOpen: boolean;
  onClose: () => void;
  dnd?: boolean;
  passThrough?: boolean;
  onToggleDnd?: (enabled: boolean) => void;
  onTogglePassThrough?: (enabled: boolean) => void;
  onHidePet?: () => void;
  /** 切换环形菜单 UI 风格（classic 环状 ↔ 'sao' 左侧链式弧） */
  onSwitchMenuStyle?: () => void;
  onOpenPanel?: (
    view: 'chat' | 'friends' | 'character' | 'memories' | 'settings' | 'model',
  ) => void;
  onShowNativeMenu?: () => void;
}

interface ClassicNode {
  id: string;
  label: string;
  icon: React.ReactNode;
  x: number;
  y: number;
  onClick: () => void;
}

/** 环绕桌宠的节点布局（右下半环，圆心在窗口右下之外；240×260 基准坐标） */
const NODE_POSITIONS: Array<{ x: number; y: number }> = [
  { x: 152, y: 42 }, // 对话（顶部偏右）
  { x: 100, y: 56 },
  { x: 58, y: 96 },
  { x: 38, y: 148 },
  { x: 50, y: 200 },
  { x: 90, y: 240 }, // 控制（底部）
];

const RING_CENTER = { x: 190, y: 186 };
const RING_RADIUS = 108;
/** 节点视觉直径 32px：小窗时节点中心至少留 18px 边距（16 半径 + 2 呼吸） */
const NODE_EDGE_MARGIN = 18;
/** 二级面板 6 个 chip 的近似总高（小窗时面板压缩为滚动容器） */
const CLASSIC_SUB_HEIGHT = 176;

export interface ClassicMenuGeometry {
  w: number;
  h: number;
  ring: { cx: number; cy: number; r: number };
  nodePositions: Array<{ x: number; y: number }>;
  close: { left: number; top: number };
  sub: { left: number; top: number; maxHeight: number };
}

/** 按窗口尺寸计算经典环状菜单几何（240×260 基准等比；导出供测试）。
 *  节点坐标等比缩放并钳进窗口（小窗不越界）；引导环半径钳制到窗口内
 *  完整可见（原 108px 环在基准窗口下右/下缘就超窗被裁，一并修复）。 */
export function computeClassicMenuGeometry(w: number, h: number): ClassicMenuGeometry {
  const kx = w / 240;
  const ky = h / 260;
  const cx = RING_CENTER.x * kx;
  const cy = RING_CENTER.y * ky;
  const r = Math.min(RING_RADIUS * kx, RING_RADIUS * ky, cx - 8, w - cx - 8, cy - 8, h - cy - 8);
  const nodePositions = NODE_POSITIONS.map((p) => ({
    x: Math.min(Math.max(p.x * kx, NODE_EDGE_MARGIN), w - NODE_EDGE_MARGIN),
    y: Math.min(Math.max(p.y * ky, NODE_EDGE_MARGIN), h - NODE_EDGE_MARGIN),
  }));
  const close = { left: cx - 52 * kx, top: cy - 138 * ky };
  const subTop = Math.max(8, Math.min(148 * ky, h - CLASSIC_SUB_HEIGHT - 8));
  // 面板宽 148px 固定：left 钳进窗口（小窗下贴左缘，避免右缘出窗）
  const subLeft = Math.min(118 * kx, w - 148 - 8);
  const sub = { left: subLeft, top: subTop, maxHeight: Math.max(80, h - subTop - 8) };
  return { w, h, ring: { cx, cy, r }, nodePositions, close, sub };
}

/** 菜单画布恒为 240×260 基准（与 Main 侧 PET_WINDOW_SIZE 对应）：菜单展开时
 *  Main 已把窗口临时扩到 ≥ 基准并右下锚定（pet:set-menu-canvas），几何不随
 *  窗口/缩放档位重算 —— 任何档位（0.5–2.0）下菜单尺寸、位置恒定且完整可见。 */
const MENU_CANVAS = { width: 240, height: 260 };

export function ClassicMenu({
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
}: ClassicMenuProps) {
  const [subOpen, setSubOpen] = useState(false);

  // 菜单几何恒用 240×260 基准（展开期间窗口已由 Main 扩到 ≥ 基准、右下锚定）：
  // 不再按 innerWidth/innerHeight 重算 —— 按窗口压缩几何是小档位下菜单被截断的根因
  const geometry = useMemo(
    () => computeClassicMenuGeometry(MENU_CANVAS.width, MENU_CANVAS.height),
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      setSubOpen(false);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  const handleOpenView = (
    view: 'chat' | 'friends' | 'character' | 'memories' | 'settings' | 'model',
  ) => {
    handleAction(() => {
      if (onOpenPanel) onOpenPanel(view);
      else window.pet?.panel?.open({ view });
    });
  };

  const nodes: ClassicNode[] = [
    {
      id: 'chat',
      label: '对话',
      icon: <MessageCircle size={15} aria-hidden="true" />,
      x: geometry.nodePositions[0]!.x,
      y: geometry.nodePositions[0]!.y,
      onClick: () => handleOpenView('chat'),
    },
    {
      id: 'friends',
      label: '好友',
      icon: <Users size={15} aria-hidden="true" />,
      x: geometry.nodePositions[1]!.x,
      y: geometry.nodePositions[1]!.y,
      onClick: () => handleOpenView('friends'),
    },
    {
      id: 'character',
      label: '角色',
      icon: <Sparkles size={15} aria-hidden="true" />,
      x: geometry.nodePositions[2]!.x,
      y: geometry.nodePositions[2]!.y,
      onClick: () => handleOpenView('character'),
    },
    {
      id: 'memories',
      label: '记忆',
      icon: <Brain size={15} aria-hidden="true" />,
      x: geometry.nodePositions[3]!.x,
      y: geometry.nodePositions[3]!.y,
      onClick: () => handleOpenView('memories'),
    },
    {
      id: 'model',
      label: '模型',
      icon: <Sliders size={15} aria-hidden="true" />,
      x: geometry.nodePositions[4]!.x,
      y: geometry.nodePositions[4]!.y,
      onClick: () => handleOpenView('model'),
    },
    {
      id: 'controls',
      label: '控制',
      icon: <Settings2 size={15} aria-hidden="true" />,
      x: geometry.nodePositions[5]!.x,
      y: geometry.nodePositions[5]!.y,
      onClick: () => setSubOpen((prev) => !prev),
    },
  ];

  return (
    <div
      className="classic-radial-overlay"
      data-testid="classic-menu"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 环绕桌宠的半透明引导环（半径已钳制到窗口内，完整可见） */}
      <svg
        className="classic-track-svg"
        viewBox={`0 0 ${geometry.w} ${geometry.h}`}
        aria-hidden="true"
      >
        <circle
          cx={geometry.ring.cx}
          cy={geometry.ring.cy}
          r={geometry.ring.r}
          fill="none"
          stroke="rgba(129, 140, 248, 0.4)"
          strokeWidth="1.5"
          strokeDasharray="3 6"
        />
      </svg>

      <button
        className="classic-close"
        style={{ left: geometry.close.left, top: geometry.close.top }}
        type="button"
        aria-label="关闭菜单"
        title="关闭 (Esc)"
        onClick={onClose}
      >
        <X size={13} aria-hidden="true" />
      </button>

      {nodes.map((node, index) => (
        <div
          key={node.id}
          className="classic-slot"
          style={{ left: node.x - 16, top: node.y - 16, animationDelay: `${index * 0.04}s` }}
        >
          <button
            className={`classic-node ${node.id === 'controls' && subOpen ? 'classic-node--active' : ''}`}
            type="button"
            role="menuitem"
            title={node.label}
            onClick={node.onClick}
          >
            {node.icon}
            <span className="classic-pill">{node.label}</span>
          </button>
        </div>
      ))}

      {subOpen && (
        <div
          className="classic-sub"
          style={{
            left: geometry.sub.left,
            top: geometry.sub.top,
            maxHeight: geometry.sub.maxHeight,
          }}
          role="region"
          aria-label="快捷控制"
        >
          <button
            className={`classic-chip ${dnd ? 'classic-chip--on' : ''}`}
            type="button"
            onClick={() => {
              if (onToggleDnd) onToggleDnd(!dnd);
              else window.pet?.petRuntime?.setDnd(!dnd);
            }}
            title={dnd ? '关闭勿扰' : '开启勿扰'}
          >
            {dnd ? <VolumeX size={13} /> : <Volume2 size={13} />}
            <span>{dnd ? '勿扰: 开' : '勿扰: 关'}</span>
          </button>
          <button
            className={`classic-chip ${passThrough ? 'classic-chip--on' : ''}`}
            type="button"
            onClick={() => {
              if (onTogglePassThrough) onTogglePassThrough(!passThrough);
              else window.pet?.petRuntime?.setPassThrough(!passThrough);
            }}
            title={passThrough ? '关闭穿透' : '开启穿透'}
          >
            <MousePointerClick size={13} />
            <span>{passThrough ? '穿透: 开' : '穿透: 关'}</span>
          </button>
          <button
            className="classic-chip"
            type="button"
            onClick={() =>
              handleAction(() => {
                if (onHidePet) onHidePet();
                else window.pet?.petRuntime?.setHidden?.(true);
              })
            }
            title="临时收起桌宠"
          >
            <EyeOff size={13} />
            <span>隐藏桌宠</span>
          </button>
          <button
            className="classic-chip"
            type="button"
            onClick={() => handleOpenView('settings')}
            title="偏好设置"
          >
            <Sliders size={13} />
            <span>详细设置</span>
          </button>
          <button
            className="classic-chip"
            type="button"
            onClick={() => {
              if (onSwitchMenuStyle) {
                onSwitchMenuStyle();
              } else {
                void window.pet?.petProfile?.get().then((profile) => {
                  void window.pet?.petProfile?.set({ ...profile, menuStyle: 'sao' });
                });
              }
              // 与 SAO 菜单一致：换肤后关闭菜单，让下次右键打开的是新皮肤
              onClose();
            }}
            title="切换菜单皮肤：经典环状 ↔ SAO 链式弧"
          >
            <Settings2 size={13} />
            <span>换肤</span>
          </button>
          <button
            className="classic-chip classic-chip--muted"
            type="button"
            onClick={() =>
              handleAction(() => {
                if (onShowNativeMenu) onShowNativeMenu();
                else window.pet?.petRuntime?.showContextMenu();
              })
            }
            title="呼出系统原生菜单"
          >
            <MoreHorizontal size={13} />
            <span>系统托盘</span>
          </button>
        </div>
      )}
    </div>
  );
}
