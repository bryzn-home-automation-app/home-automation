import type { ReactNode } from 'react';
import { useDeferredMount } from '../hooks/useDeferredMount';

interface DeferredRenderProps {
  children: ReactNode;
  placeholder?: ReactNode;
  minHeight?: number;
  className?: string;
  rootMargin?: string;
}

export default function DeferredRender({
  children,
  placeholder,
  minHeight = 320,
  className,
  rootMargin,
}: DeferredRenderProps) {
  const { targetRef, shouldRender } = useDeferredMount({ rootMargin });

  return (
    <div ref={targetRef} className={className}>
      {shouldRender ? (
        children
      ) : (
        placeholder ?? (
          <div
            className="rounded-[28px] border border-appborder bg-appsurface-raised shadow-[0_10px_28px_var(--appshadow)]"
            style={{ minHeight }}
          />
        )
      )}
    </div>
  );
}
