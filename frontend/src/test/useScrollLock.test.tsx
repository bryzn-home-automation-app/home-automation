import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useScrollLock } from '../hooks/useScrollLock';

function Harness({ locked }: { locked: boolean }) {
  useScrollLock(locked);
  return null;
}

function Pair({ menu, dialog }: { menu: boolean; dialog: boolean }) {
  return (
    <>
      <Harness locked={menu} />
      <Harness locked={dialog} />
    </>
  );
}

/** A one-finger swipe on `el` from (0, 100) to (dx, 100 + dy); true if the page blocked it. */
function swipe(el: Element, dx: number, dy: number): boolean {
  const touch = (type: string, x: number, y: number) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'touches', { value: [{ clientX: x, clientY: y }] });
    return e;
  };
  el.dispatchEvent(touch('touchstart', 0, 100));
  return !el.dispatchEvent(touch('touchmove', dx, 100 + dy));
}

/** A scroll area showing 100px of 300px, scrolled `top` px down. */
function scrollArea(top: number): HTMLElement {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { value: 300 });
  Object.defineProperty(el, 'clientHeight', { value: 100 });
  Object.defineProperty(el, 'scrollTop', { value: top });
  el.appendChild(document.createElement('span'));
  document.body.appendChild(el);
  return el;
}

describe('useScrollLock', () => {
  afterEach(() => {
    document.documentElement.style.overflow = '';
    document.body.innerHTML = '';
    delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
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

  it('keeps the page locked until the last of two overlapping locks lets go', () => {
    const { rerender } = render(<Pair menu dialog={false} />);
    rerender(<Pair menu dialog />);
    rerender(<Pair menu={false} dialog />); // the menu closes under the dialog
    expect(document.documentElement.style.overflow).toBe('hidden');
    rerender(<Pair menu={false} dialog={false} />);
    expect(document.documentElement.style.overflow).toBe(''); // not left stuck on hidden
  });

  it("also locks the app's page box while the page scrolls inside it, and only then", () => {
    const box = document.body.appendChild(document.createElement('div'));
    box.setAttribute('data-page-scroller', '');
    box.style.overflowY = 'auto'; // a phone-width screen
    const { rerender } = render(<Harness locked />);
    expect(box.style.overflow).toBe('hidden');
    rerender(<Harness locked={false} />);
    expect(box.style.overflow).toBe('');

    box.style.overflowY = ''; // a wide screen: hiding it would unstick the sticky sidebar
    rerender(<Harness locked />);
    expect(box.style.overflow).toBe('');
  });

  describe('on a touch screen', () => {
    const touchScreen = () => Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });

    it("never touches <html>'s overflow, which left iOS 26's fixed bottom bar scrolling with the page", () => {
      touchScreen();
      const { unmount } = render(<Harness locked />);
      expect(document.documentElement.style.overflow).toBe('');
      unmount();
      expect(document.documentElement.style.overflow).toBe('');
    });

    it('blocks a swipe that would scroll the page, and lets the overlay scroll itself', () => {
      touchScreen();
      const plain = document.body.appendChild(document.createElement('div'));
      const atTop = scrollArea(0);
      const midway = scrollArea(100);
      const { unmount } = render(<Harness locked />);

      expect(swipe(plain, 0, -40)).toBe(true); // the page behind stays put
      expect(swipe(atTop.firstChild as Element, 0, -40)).toBe(false); // the menu scrolls down
      expect(swipe(atTop.firstChild as Element, 0, 40)).toBe(true); // already at its top: nothing for the page
      expect(swipe(midway.firstChild as Element, 0, 40)).toBe(false);
      expect(swipe(plain, -40, 5)).toBe(false); // sideways swipes are left alone

      unmount();
      expect(swipe(plain, 0, -40)).toBe(false); // free again once it closes
    });

    it("doesn't let the page's own scroll box take a swipe on an overlay inside it", () => {
      touchScreen();
      const page = scrollArea(100); // the page box, with room both ways
      const overlay = page.appendChild(document.createElement('div'));
      overlay.style.position = 'fixed';
      const { unmount } = render(<Harness locked />);
      expect(swipe(overlay, 0, -40)).toBe(true);
      expect(swipe(page.firstChild as Element, 0, -40)).toBe(false); // outside the overlay, as before
      unmount();
    });
  });
});
