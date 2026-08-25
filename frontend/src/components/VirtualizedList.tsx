import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, UIEvent } from 'react';

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  height: number;
  overscan?: number;
  className?: string;
  contentClassName?: string;
  renderItem: (item: T, index: number) => ReactNode;
}

function VirtualizedListComponent<T>({
  items,
  itemHeight,
  height,
  overscan = 4,
  className,
  contentClassName,
  renderItem,
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  // Coalesce scroll events to one state update per animation frame — a raw
  // setState per scroll tick causes a render storm (and eats the windowing win).
  const frameRef = useRef<number | null>(null);
  const pendingScrollRef = useRef(0);

  useEffect(
    () => () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const { startIndex, endIndex, offsetTop, totalHeight } = useMemo(() => {
    const visibleCount = Math.ceil(height / itemHeight);
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(items.length, start + visibleCount + overscan * 2);

    return {
      startIndex: start,
      endIndex: end,
      offsetTop: start * itemHeight,
      totalHeight: items.length * itemHeight,
    };
  }, [height, itemHeight, items.length, overscan, scrollTop]);

  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex],
  );

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    pendingScrollRef.current = event.currentTarget.scrollTop;
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setScrollTop(pendingScrollRef.current);
    });
  };

  return (
    <div className={className} style={{ height, overflowY: 'auto' }} onScroll={onScroll}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          className={contentClassName}
          style={{
            position: 'absolute',
            top: offsetTop,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((item, index) => renderItem(item, startIndex + index))}
        </div>
      </div>
    </div>
  );
}

const VirtualizedList = memo(VirtualizedListComponent) as typeof VirtualizedListComponent;

export default VirtualizedList;