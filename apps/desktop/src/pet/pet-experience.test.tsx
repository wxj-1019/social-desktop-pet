// @vitest-environment jsdom
import type { PetProfile, PetRuntimeSnapshot, PetVisualCommand } from '@pet/protocol';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PetExperience } from './pet-experience.js';

afterEach(cleanup);

interface FakePet {
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

function installFakePet(): void {
  const snapshot: PetRuntimeSnapshot = { state: 'IDLE', online: true, dnd: false, hidden: false };
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

  pet = {
    petRuntime: {
      getSnapshot: vi.fn(async () => snapshot),
      onSnapshot: vi.fn(() => onSnapshotCleanup),
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

function firePointer(
  el: Element,
  type: 'down' | 'move' | 'up' | 'cancel',
  init: { screenX: number; screenY: number },
): void {
  el.dispatchEvent(
    new PointerEvent(`pointer${type}`, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      buttons: type === 'up' ? 0 : 1,
      screenX: init.screenX,
      screenY: init.screenY,
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
    const head = document.querySelector('[data-hit="head"]');
    expect(head).not.toBeNull();
    firePointer(head!, 'down', { screenX: 100, screenY: 100 });
    firePointer(head!, 'up', { screenX: 100, screenY: 100 });
    expect(pet.petRuntime.interaction).toHaveBeenCalledWith({ kind: 'head_touch' });
  });

  it('sends body_touch when clicking the body hit area', () => {
    render(<PetExperience />);
    const body = document.querySelector('[data-hit="body"]');
    expect(body).not.toBeNull();
    firePointer(body!, 'down', { screenX: 140, screenY: 240 });
    firePointer(body!, 'up', { screenX: 140, screenY: 240 });
    expect(pet.petRuntime.interaction).toHaveBeenCalledWith({ kind: 'body_touch' });
  });

  it('opens the chat panel on double click', () => {
    render(<PetExperience />);
    const head = document.querySelector('[data-hit="head"]');
    firePointer(head!, 'down', { screenX: 100, screenY: 100 });
    firePointer(head!, 'up', { screenX: 100, screenY: 100 });
    firePointer(head!, 'down', { screenX: 101, screenY: 100 });
    firePointer(head!, 'up', { screenX: 101, screenY: 100 });
    expect(pet.panel.open).toHaveBeenCalledWith({ view: 'chat' });
  });

  it('starts a drag after moving beyond the threshold and ends it on pointer up', () => {
    render(<PetExperience />);
    const container = document.querySelector('.pet-experience');
    firePointer(container!, 'down', { screenX: 100, screenY: 100 });
    firePointer(container!, 'move', { screenX: 130, screenY: 120 });
    expect(pet.petRuntime.dragStart).toHaveBeenCalledWith({ x: 130, y: 120 });
    firePointer(container!, 'up', { screenX: 130, screenY: 120 });
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

  it('opens the context menu and prevents default on contextmenu', () => {
    render(<PetExperience />);
    const container = document.querySelector('.pet-experience');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    container!.dispatchEvent(event);
    expect(pet.petRuntime.showContextMenu).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
