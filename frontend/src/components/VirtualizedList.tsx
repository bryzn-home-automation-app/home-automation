import { memo, useMemo, useState } from 'react';
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

  const { startIndex, endIndex, visibleItems, offsetTop, totalHeight } = useMemo(() => {
    const visibleCount = Math.ceil(height / itemHeight);
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(items.length, start + visibleCount + overscan * 2);

    return {
      startIndex: start,
      endIndex: end,
      visibleItems: items.slice(start, end),
      offsetTop: start * itemHeight,
      totalHeight: items.length * itemHeight,
    };
  }, [height, itemHeight, items, overscan, scrollTop]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
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
      {endIndex === 0 ? null : null}
    </div>
  );
}

const VirtualizedList = memo(VirtualizedListComponent) as typeof VirtualizedListComponent;

export default VirtualizedList;