import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useScrollLock } from '../hooks/useScrollLock';

function Harness({ locked }: { locked: boolean }) {
  useScrollLock(locked);
  return null;
}

describe('useScrollLock', () => {
  afterEach(() => {
    document.documentElement.style.overflow = '';
  });

  it('leaves the page alone while unlocked', () => {
    render(<Harness locked={false} />);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('stops the page scrolling while locked and restores it after', () => {
    const { rerender } = render(<Harness locked={false} />);
    rerender(<Harness locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    rerender(<Harness locked={false} />);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('puts back an overflow the page already had', () => {
    document.documentElement.style.overflow = 'clip';
    const { unmount } = render(<Harness locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount();
    expect(document.documentElement.style.overflow).toBe('clip');
  });
});
