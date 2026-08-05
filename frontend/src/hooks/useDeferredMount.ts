import { useEffect, useRef, useState } from 'react';

interface DeferredMountOptions {
  rootMargin?: string;
  triggerOnce?: boolean;
}

export function useDeferredMount(options?: DeferredMountOptions) {
  const { rootMargin = '240px', triggerOnce = true } = options ?? {};
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);

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
          if (triggerOnce) {
            observer.disconnect();
          }
        }
      },
      { rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, shouldRender, triggerOnce]);

  return { targetRef, shouldRender };
}