// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PetProfile, PetRuntimeSnapshot, PetVisualCommand } from '@pet/protocol';

import { getCharacterManifest } from './character-manifests.js';
import { isRadialMenuElement, PetExperience } from './pet-experience.js';

afterEach(cleanup);

interface FakePet {
  getPetScale: ReturnType<typeof vi.fn>;
  petRuntime: {
    getSnapshot: ReturnType<typeof vi.fn>;
    onSnapshot: ReturnType<typeof vi.fn>;
    onVisualCommand: ReturnType<typeof vi.fn>;
    interaction: ReturnType<typeof vi.fn>;
    requestAction: ReturnType<typeof vi.fn>;
    chatEvent: ReturnType<typeof vi.fn>;
    dragStart: ReturnType<typeof vi.fn>;
    dragMove: ReturnType<typeof vi.fn>;
    dragEnd: ReturnType<typeof vi.fn>;
    setDnd: ReturnType<typeof vi.fn>;
    setPassThrough: ReturnType<typeof vi.fn>;
    setMenuCanvas: ReturnType<typeof vi.fn>;
    showContextMenu: ReturnType<typeof vi.fn>;
  };
  panel: {
    open: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    navigate: ReturnType<typeof vi.fn>;
    onNavigate: ReturnType<typeof vi.fn>;
  };
  petProfile: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
}

let pet: FakePet;
let onSnapshotCleanup: ReturnType<typeof vi.fn>;
let onVisualCommandCleanup: ReturnType<typeof vi.fn>;
let visualCommandHandler: (command: PetVisualCommand) => void;
let snapshotHandler: (snapshot: PetRuntimeSnapshot) => void;

function installFakePet(state: PetRuntimeSnapshot['state'] = 'IDLE'): void {
  const snapshot: PetRuntimeSnapshot = {
    state,
    online: true,
    dnd: false,
    hidden: false,
    passThrough: false,
  };
  const profile: PetProfile = {
    version: 1,
    petId: 'star-isle',
    displayName: '星屿',
    reducedMotion: false,
    dnd: false,
    bubbleEnabled: true,
  };
  onSnapshotCleanup = vi.fn();
  onVisualCommandCleanup = vi.fn();
  visualCommandHandler = () => undefined;
  snapshotHandler = () => undefined;

  pet = {
    getPetScale: vi.fn(async () => 1),
    petRuntime: {
      getSnapshot: vi.fn(async () => snapshot),
      onSnapshot: vi.fn((cb: (snapshot: PetRuntimeSnapshot) => void) => {
        snapshotHandler = cb;
        return onSnapshotCleanup;
      }),
      onVisualCommand: vi.fn((cb: (command: PetVisualCommand) => void) => {
        visualCommandHandler = cb;
        return onVisualCommandCleanup;
      }),
      interaction: vi.fn(),
      requestAction: vi.fn(),
      chatEvent: vi.fn(),
      dragStart: vi.fn(),
      dragMove: vi.fn(),
      dragEnd: vi.fn(),
      setDnd: vi.fn(),
      setPassThrough: vi.fn(),
      setMenuCanvas: vi.fn(),
      showContextMenu: vi.fn(),
    },
    panel: {
      open: vi.fn(),
      close: vi.fn(),
      navigate: vi.fn(),
      onNavigate: vi.fn(() => vi.fn()),
    },
    petProfile: {
      get: vi.fn(async () => profile),
      set: vi.fn(),
    },
  };
  (window as unknown as { pet: unknown }).pet = pet;
}

/** jsdom 无布局：mock .pet-canvas 为 240×260、原点 (0,0)（logical === client 坐标） */
function installCanvasRect(): void {
  const canvas = document.querySelector('.pet-canvas') as HTMLElement | null;
  if (!canvas) throw new Error('.pet-canvas not rendered');
  canvas.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 240,
      bottom: 260,
      width: 240,
      height: 260,
      toJSON: () => ({}),
    }) as DOMRect;
}

function firePointer(
  el: Element,
  type: 'down' | 'move' | 'up' | 'cancel',
  init: { screenX: number; screenY: number; button?: number },
): void {
  const button = init.button ?? 0;
  el.dispatchEvent(
    new PointerEvent(`pointer${type}`, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'touch',
      button,
      buttons: type === 'up' ? 0 : button === 0 ? 1 : button,
      screenX: init.screenX,
      screenY: init.screenY,
      clientX: init.screenX,
      clientY: init.screenY,
    }),
  );
}

beforeEach(() => {
  installFakePet();
});

describe('PetExperience（星屿直连交互面）', () => {
  it('subscribes to runtime snapshot, visual commands and profile on mount', () => {
    render(<PetExperience />);
    expect(pet.petRuntime.getSnapshot).toHaveBeenCalledTimes(1);
    expect(pet.petRuntime.onSnapshot).toHaveBeenCalledTimes(1);
    expect(pet.petRuntime.onVisualCommand).toHaveBeenCalledTimes(1);
    expect(pet.petProfile.get).toHaveBeenCalledTimes(1);
  });

  it('unmounts subscriptions on cleanup', () => {
    const { unmount } = render(<PetExperience />);
    unmount();
    expect(onSnapshotCleanup).toHaveBeenCalledTimes(1);
    expect(onVisualCommandCleanup).toHaveBeenCalledTimes(1);
  });

  it('applies visual commands to the rendered svg', () => {
    render(<PetExperience />);
    act(() => {
      visualCommandHandler({ type: 'motion', motion: 'happy', intensity: 3 });
    });
    const svg = document.querySelector('svg.star-isle');
    expect(svg?.getAttribute('data-motion')).toBe('happy');
    act(() => {
      visualCommandHandler({ type: 'expression', expression: 'surprised' });
    });
    expect(document.querySelector('svg.star-isle')?.getAttribute('data-expression')).toBe(
      'surprised',
    );
    act(() => {
      visualCommandHandler({ type: 'speaking', active: true });
    });
    expect(document.querySelector('svg.star-isle')?.getAttribute('data-speaking')).toBe('true');
  });

  it('sends head_touch when clicking the head hit area', () => {
    render(<PetExperience />);
    installCanvasRect();
    const head = document.querySelector('[data-hit="head"]');
    expect(head).not.toBeNull();
    firePointer(head!, 'down', { screenX: 100, screenY: 100 });
    firePointer(head!, 'up', { screenX: 100, screenY: 100 });
    expect(pet.petRuntime.interaction).toHaveBeenCalledWith({ kind: 'head_touch' });
  });

  it('sends body_touch when clicking the body hit area', () => {
    render(<PetExperience />);
    installCanvasRect();
    const body = document.querySelector('[data-hit="body"]');
    expect(body).not.toBeNull();
    firePointer(body!, 'down', { screenX: 140, screenY: 240 });
    firePointer(body!, 'up', { screenX: 140, screenY: 240 });
    expect(pet.petRuntime.interaction).toHaveBeenCalledWith({ kind: 'body_touch' });
  });

  it('opens the chat panel on double click', () => {
    render(<PetExperience />);
    installCanvasRect();
    const head = document.querySelector('[data-hit="head"]');
    firePointer(head!, 'down', { screenX: 100, screenY: 100 });
    firePointer(head!, 'up', { screenX: 100, screenY: 100 });
    firePointer(head!, 'down', { screenX: 101, screenY: 100 });
    firePointer(head!, 'up', { screenX: 101, screenY: 100 });
    expect(pet.panel.open).toHaveBeenCalledWith({ view: 'chat' });
  });

  it('double right-click is not classified as double click (no panel)', () => {
    render(<PetExperience />);
    installCanvasRect();
    const head = document.querySelector('[data-hit="head"]');
    for (const screenX of [100, 101]) {
      firePointer(head!, 'down', { screenX, screenY: 100, button: 2 });
      firePointer(head!, 'up', { screenX, screenY: 100, button: 2 });
    }
    expect(pet.panel.open).not.toHaveBeenCalled();
    expect(pet.petRuntime.interaction).not.toHaveBeenCalled();
  });

  it('starts from the original pointer and forwards the threshold-crossing move', () => {
    render(<PetExperience />);
    installCanvasRect();
    const container = document.querySelector('.pet-experience');
    firePointer(container!, 'down', { screenX: 100, screenY: 100 });
    firePointer(container!, 'move', { screenX: 130, screenY: 120 });
    expect(pet.petRuntime.dragStart).toHaveBeenCalledWith({ x: 100, y: 100 });
    expect(pet.petRuntime.dragMove).toHaveBeenCalledWith({ x: 130, y: 120 });
    firePointer(container!, 'up', { screenX: 130, screenY: 120 });
    expect(pet.petRuntime.dragEnd).toHaveBeenCalledTimes(1);
  });

  it('self-heals a stuck drag when the button is already released mid-move', () => {
    render(<PetExperience />);
    installCanvasRect();
    const container = document.querySelector('.pet-experience');
    firePointer(container!, 'down', { screenX: 100, screenY: 100 });
    firePointer(container!, 'move', { screenX: 130, screenY: 120 });
    expect(pet.petRuntime.dragStart).toHaveBeenCalledTimes(1);

    // 模拟 pointerup 丢失（快速甩出窗口）：再次 move 时按钮已松开
    container!.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        buttons: 0,
        screenX: 170,
        screenY: 160,
      }),
    );
    expect(pet.petRuntime.dragEnd).toHaveBeenCalledTimes(1);

    // 自愈后再次移动不应重新进入拖动（避免"不按键也在拖"）
    firePointer(container!, 'move', { screenX: 200, screenY: 200 });
    expect(pet.petRuntime.dragStart).toHaveBeenCalledTimes(1);
  });

  it('ends the drag on pointercancel', () => {
    render(<PetExperience />);
    installCanvasRect();
    const container = document.querySelector('.pet-experience');
    firePointer(container!, 'down', { screenX: 100, screenY: 100 });
    firePointer(container!, 'move', { screenX: 130, screenY: 120 });
    expect(pet.petRuntime.dragStart).toHaveBeenCalledTimes(1);
    firePointer(container!, 'cancel', { screenX: 130, screenY: 120 });
    expect(pet.petRuntime.dragEnd).toHaveBeenCalledTimes(1);
  });

  it('shows a bubble when enabled and the runtime emits one', async () => {
    render(<PetExperience />);
    await act(async () => {
      visualCommandHandler({ type: 'bubble', text: '你好，我是星屿' });
    });
    const bubble = document.querySelector('.pet-speech');
    expect(bubble?.textContent).toBe('你好，我是星屿');
  });

  it('shows the landing base on cold start (STARTING) and removes it after the landing window', async () => {
    vi.useFakeTimers();
    installFakePet('STARTING');
    render(<PetExperience />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('.pet-landing-base')).not.toBeNull();
    expect(document.querySelector('.pet-experience')?.getAttribute('data-state')).toBe('STARTING');

    act(() => {
      vi.advanceTimersByTime(2_600);
    });
    expect(document.querySelector('.pet-landing-base')).toBeNull();
    vi.useRealTimers();
  });

  it('does not show the landing base when the pet is already IDLE (restore / hot reload)', async () => {
    installFakePet('IDLE');
    render(<PetExperience />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('.pet-landing-base')).toBeNull();
    expect(document.querySelector('.pet-experience')?.getAttribute('data-state')).toBe('IDLE');
  });

  it('clicking the bubble opens the chat panel (气泡直达聊天的短路径)', async () => {
    render(<PetExperience />);
    installCanvasRect();
    await act(async () => {
      visualCommandHandler({ type: 'bubble', text: '你好，我是星屿' });
    });
    const bubble = document.querySelector('.pet-speech');
    expect(bubble).not.toBeNull();

    firePointer(bubble!, 'down', { screenX: 120, screenY: 20 });
    firePointer(bubble!, 'up', { screenX: 120, screenY: 20 });
    expect(pet.panel.open).toHaveBeenCalledWith({ view: 'chat' });
    // 气泡点击不应误触任何摸头/身体互动
    expect(pet.petRuntime.interaction).not.toHaveBeenCalled();
  });

  it('renders the fallback when the visual component throws', () => {
    function ThrowingVisual(): never {
      throw new Error('visual boom');
    }
    function CustomFallback() {
      return <div data-testid="custom-fallback" />;
    }
    render(<PetExperience VisualComponent={ThrowingVisual} FallbackComponent={CustomFallback} />);
    expect(screen.getByTestId('custom-fallback')).not.toBeNull();
  });

  it('opens the SAO menu (not the native one) and prevents default on contextmenu', () => {
    render(<PetExperience />);
    const container = document.querySelector('.pet-experience');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      container!.dispatchEvent(event);
    });
    expect(screen.getByTestId('sao-menu')).not.toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(pet.petRuntime.showContextMenu).not.toHaveBeenCalled();
  });

  it('环形菜单开合驱动菜单画布扩窗（展开 → setMenuCanvas(true)，关闭 → false）', () => {
    render(<PetExperience />);
    const container = document.querySelector('.pet-experience');
    expect(pet.petRuntime.setMenuCanvas).toHaveBeenCalledWith(false); // 初始 false

    act(() => {
      container!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(pet.petRuntime.setMenuCanvas).toHaveBeenCalledWith(true);

    // 再右键收起菜单 → 还原窗口
    act(() => {
      container!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(screen.queryByTestId('sao-menu')).toBeNull();
    expect(pet.petRuntime.setMenuCanvas).toHaveBeenLastCalledWith(false);
  });

  it('桌宠画布按缩放档位定尺寸并右下锚定（扩窗时桌宠屏幕位置不动）', async () => {
    pet.getPetScale.mockResolvedValue(0.5);
    render(<PetExperience />);
    // getPetScale 是异步拉取，等画布尺寸更新
    await act(async () => {
      await Promise.resolve();
    });
    const canvas = document.querySelector('.pet-canvas') as HTMLElement | null;
    expect(canvas).not.toBeNull();
    expect(canvas!.style.width).toBe('120px');
    expect(canvas!.style.height).toBe('130px');
    expect(canvas!.className).toBe('pet-canvas');
  });

  it('unmount 兜底收起菜单画布（角色切换重建窗时扩窗不残留）', () => {
    const { unmount } = render(<PetExperience />);
    unmount();
    const calls = pet.petRuntime.setMenuCanvas.mock.calls.map((c) => c[0]);
    expect(calls[calls.length - 1]).toBe(false);
  });

  it('closes the radial menu when pass-through turns on (菜单留在屏幕上将无法点击关闭)', () => {
    render(<PetExperience />);
    const container = document.querySelector('.pet-experience');
    act(() => {
      container!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(screen.getByTestId('sao-menu')).not.toBeNull();

    // 任一入口（SAO/设置页/托盘）开启穿透 → 快照广播 passThrough:true → 菜单立即收起
    act(() => {
      snapshotHandler({
        state: 'IDLE',
        online: true,
        dnd: false,
        hidden: false,
        passThrough: true,
      });
    });
    expect(screen.queryByTestId('sao-menu')).toBeNull();
  });

  it('zone 命中迁移：透明角落点击不触发互动（协议 §6 收窄语义）', () => {
    render(<PetExperience />);
    installCanvasRect();
    const canvas = document.querySelector('.pet-canvas')!;
    firePointer(canvas, 'down', { screenX: 5, screenY: 5 });
    firePointer(canvas, 'up', { screenX: 5, screenY: 5 });
    expect(pet.petRuntime.interaction).not.toHaveBeenCalled();
  });

  it('注入 codenono manifest：视口内点击触发 body_touch，视口外不触发（命中收窄）', () => {
    render(<PetExperience manifest={getCharacterManifest('codenono')} />);
    installCanvasRect();
    const canvas = document.querySelector('.pet-canvas')!;
    firePointer(canvas, 'down', { screenX: 120, screenY: 170 });
    firePointer(canvas, 'up', { screenX: 120, screenY: 170 });
    expect(pet.petRuntime.interaction).toHaveBeenCalledWith({ kind: 'body_touch' });

    firePointer(canvas, 'down', { screenX: 10, screenY: 10 });
    firePointer(canvas, 'up', { screenX: 10, screenY: 10 });
    expect(pet.petRuntime.interaction).toHaveBeenCalledTimes(1);
  });

  it('画布 rect 无效（jsdom 未 mock）时 zone 为 null，不回退 DOM 命中', () => {
    render(<PetExperience />);
    // 不 installCanvasRect：默认 getBoundingClientRect 宽高为 0
    const head = document.querySelector('[data-hit="head"]');
    firePointer(head!, 'down', { screenX: 100, screenY: 100 });
    firePointer(head!, 'up', { screenX: 100, screenY: 100 });
    expect(pet.petRuntime.interaction).not.toHaveBeenCalled();
  });

  it('interaction.enabled=false 的角色不响应点击互动（协议 §6.3）', () => {
    const disabled = {
      ...getCharacterManifest('star-isle'),
      interaction: { enabled: false, zones: [] },
    };
    render(<PetExperience manifest={disabled} />);
    installCanvasRect();
    const canvas = document.querySelector('.pet-canvas')!;
    firePointer(canvas, 'down', { screenX: 124, screenY: 214 });
    firePointer(canvas, 'up', { screenX: 124, screenY: 214 });
    expect(pet.petRuntime.interaction).not.toHaveBeenCalled();
  });
});

describe('isRadialMenuElement（环形菜单点击不被拖拽手势吞掉）', () => {
  it('SAO 菜单（.sao-radial-overlay）内点击命中', () => {
    const el = document.createElement('div');
    el.className = 'sao-radial-overlay';
    expect(isRadialMenuElement(el)).toBe(true);
    // 菜单深层子元素（按钮等）同样命中
    const btn = document.createElement('button');
    el.appendChild(btn);
    expect(isRadialMenuElement(btn)).toBe(true);
  });

  it('classic 菜单（.classic-radial-overlay）内点击命中（f4b9a5a 只修 SAO 的漏网）', () => {
    const el = document.createElement('div');
    el.className = 'classic-radial-overlay';
    expect(isRadialMenuElement(el)).toBe(true);
    const node = document.createElement('button');
    el.appendChild(node);
    expect(isRadialMenuElement(node)).toBe(true);
  });

  it('菜单外（宠物身体/背景）不命中', () => {
    const body = document.createElement('div');
    body.setAttribute('data-hit', 'body');
    expect(isRadialMenuElement(body)).toBe(false);
    expect(isRadialMenuElement(null)).toBe(false);
  });
});
