import { useEffect } from 'react';

/**
 * Sets `document.title` to the provided value while the component is mounted.
 * Restores the previous title on unmount so navigation away doesn't leave a stale value.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    if (title) {
      document.title = title;
    }
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export default useDocumentTitle;
