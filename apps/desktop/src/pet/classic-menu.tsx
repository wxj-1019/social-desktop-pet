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
import React, { useEffect, useState } from 'react';

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

/** 环绕桌宠的节点布局（右下半环，圆心在窗口右下之外） */
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
      x: NODE_POSITIONS[0]!.x,
      y: NODE_POSITIONS[0]!.y,
      onClick: () => handleOpenView('chat'),
    },
    {
      id: 'friends',
      label: '好友',
      icon: <Users size={15} aria-hidden="true" />,
      x: NODE_POSITIONS[1]!.x,
      y: NODE_POSITIONS[1]!.y,
      onClick: () => handleOpenView('friends'),
    },
    {
      id: 'character',
      label: '角色',
      icon: <Sparkles size={15} aria-hidden="true" />,
      x: NODE_POSITIONS[2]!.x,
      y: NODE_POSITIONS[2]!.y,
      onClick: () => handleOpenView('character'),
    },
    {
      id: 'memories',
      label: '记忆',
      icon: <Brain size={15} aria-hidden="true" />,
      x: NODE_POSITIONS[3]!.x,
      y: NODE_POSITIONS[3]!.y,
      onClick: () => handleOpenView('memories'),
    },
    {
      id: 'model',
      label: '模型',
      icon: <Sliders size={15} aria-hidden="true" />,
      x: NODE_POSITIONS[4]!.x,
      y: NODE_POSITIONS[4]!.y,
      onClick: () => handleOpenView('model'),
    },
    {
      id: 'controls',
      label: '控制',
      icon: <Settings2 size={15} aria-hidden="true" />,
      x: NODE_POSITIONS[5]!.x,
      y: NODE_POSITIONS[5]!.y,
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
      {/* 环绕桌宠的半透明引导环 */}
      <svg className="classic-track-svg" viewBox="0 0 240 260" aria-hidden="true">
        <circle
          cx={RING_CENTER.x}
          cy={RING_CENTER.y}
          r={RING_RADIUS}
          fill="none"
          stroke="rgba(129, 140, 248, 0.4)"
          strokeWidth="1.5"
          strokeDasharray="3 6"
        />
      </svg>

      <button
        className="classic-close"
        style={{ left: RING_CENTER.x - 52, top: RING_CENTER.y - 138 }}
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
          style={{ left: 118, top: 148 }}
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
