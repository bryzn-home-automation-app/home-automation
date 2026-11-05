import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

function Harness({ open }: { open: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(open, panelRef, triggerRef);
  return (
    <div>
      <button ref={triggerRef} data-testid="trigger">menu</button>
      {open && (
        <div ref={panelRef}>
          <button data-testid="inside">inside</button>
        </div>
      )}
    </div>
  );
}

describe('useFocusTrap return focus', () => {
  afterEach(() => vi.useRealTimers());

  it('does not move focus on mount while closed', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Harness open={false} />);
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement).not.toBe(getByTestId('trigger'));
  });

  it('returns focus to the trigger after open then close', () => {
    vi.useFakeTimers();
    const { getByTestId, rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement).toBe(getByTestId('inside'));
    rerender(<Harness open={false} />);
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement).toBe(getByTestId('trigger'));
  });
});
