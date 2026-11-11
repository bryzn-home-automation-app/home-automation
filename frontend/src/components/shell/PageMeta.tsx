import { createContext, useContext, useEffect } from 'react';

/**
 * What a page may add to the header the shell draws for it. The title comes from
 * the route registry (routes.ts); a page only adds its freshness line ("Updated
 * 5:00 PM") and, rarely, a title of its own (e.g. a page whose name depends on who
 * is looking). The verdict is not here: it is the first thing in the page itself,
 * in its instrument panel (docs/faceplate/IMPLEMENTATION.md, "Shell and routes").
 */
export interface PageMeta {
  /** Short and factual, shown in DM Mono beside the title (under it on a phone). */
  subtitle?: string;
  /** Replaces the registry title in the header and the browser tab. */
  title?: string;
}

type SetPageMeta = (meta: PageMeta | null) => void;

const PageMetaContext = createContext<SetPageMeta>(() => {});

export const PageMetaProvider = PageMetaContext.Provider;

/**
 * Called by a page to fill in its header. Cleared when the page goes away, so the
 * next page never inherits an old "Updated" line. Outside the shell (tests, public
 * pages) it does nothing.
 */
export function usePageMeta({ subtitle, title }: PageMeta): void {
  const set = useContext(PageMetaContext);
  useEffect(() => {
    set({ subtitle, title });
    return () => set(null);
  }, [set, subtitle, title]);
}
