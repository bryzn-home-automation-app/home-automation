import { useEffect, useRef, useState } from 'react';

interface DeferredMountOptions {
  rootMargin?: string;
  triggerOnce?: boolean;
}

export function useDeferredMount(options?: DeferredMountOptions) {
  const { rootMargin = '240px', triggerOnce = true } = options ?? {};
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);

  // Keep latest values in refs so the IntersectionObserver is created once and
  // not torn down on every render (callers pass a new options object literal
  // each time, which would otherwise invalidate the effect deps).
  const rootMarginRef = useRef(rootMargin);
  const triggerOnceRef = useRef(triggerOnce);
  rootMarginRef.current = rootMargin;
  triggerOnceRef.current = triggerOnce;

  useEffect(() => {
    const node = targetRef.current;
    if (!node || shouldRender) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible) {
          setShouldRender(true);
          if (triggerOnceRef.current) {
            observer.disconnect();
          }
        }
      },
      { rootMargin: rootMarginRef.current }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRender]);

  return { targetRef, shouldRender };
}