// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PetBubble } from './pet-bubble.js';

afterEach(cleanup);

describe('PetBubble（桌宠语音气泡）', () => {
  it('renders nothing when text is null', () => {
    const { container } = render(<PetBubble text={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the text with role=status', () => {
    render(<PetBubble text="你好呀" />);
    const el = screen.getByRole('status');
    expect(el.textContent).toBe('你好呀');
  });

  it('applies the pet-speech class and aria-live', () => {
    const { container } = render(<PetBubble text="hi" />);
    const el = container.querySelector('.pet-speech');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-live')).toBe('polite');
    expect(el?.className).toContain('pet-speech');
  });
});
