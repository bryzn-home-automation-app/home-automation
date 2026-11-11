import { memo, type ReactNode } from 'react';

/**
 * PageSkeleton: the placeholder shown while a page's code downloads, drawn with
 * the kit's fp-skel pieces in the shape of the page to come.
 *
 * Inside the shell (the default) it is only the page body: no screen-tall slab,
 * no padding of its own, no second title. The shell already draws the header, and
 * a full page squeezed under it used to flash a flat block and a fake title before
 * every first visit (B-051). The public pages (sign-in, guest welcome), which have
 * no shell, pass `fullPage` and get the enamel page around it.
 */

export type PageSkeletonVariant =
  /** An instrument panel (dial + verdict + readouts), then a chart panel. */
  | 'stats-charts'
  /** One panel of rows. */
  | 'list'
  /** A stack of setting panels (Profile). */
  | 'cards'
  /** A sign-in style card of fields. */
  | 'form'
  /** A welcome plate with cards under it (guest pages). */
  | 'hero'
  /** One short panel. */
  | 'default';

interface PageSkeletonProps {
  variant: PageSkeletonVariant;
  /** Outside the shell: paint the page background and centre the shape. */
  fullPage?: boolean;
}

function Lines({ widths }: { widths: Array<'s' | 'm' | 'l'> }) {
  return (
    <div className="fp-stack fp-stack--s">
      {widths.map((w, i) => (
        <span key={i} className={`fp-skel fp-skel-line${w === 'l' ? '' : ` fp-skel-line--${w}`}`} />
      ))}
    </div>
  );
}

function Readouts({ n }: { n: number }) {
  return (
    <div className="fp-readouts">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="fp-skel-readout">
          <span className="fp-skel fp-skel-line fp-skel-line--s" />
          <span className="fp-skel fp-skel-num" />
        </div>
      ))}
    </div>
  );
}

function Rows({ n }: { n: number }) {
  return (
    <div className="fp-stack fp-stack--xs">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="fp-skel-row">
          <span className="fp-skel" />
          <div>
            <span className="fp-skel fp-skel-line fp-skel-line--m" />
            <span className="fp-skel fp-skel-line fp-skel-line--s" />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatsCharts() {
  return (
    <>
      <div className="fp-ip">
        <div className="fp-ip-instrument">
          <span className="fp-skel fp-skel-circle aspect-square w-full max-w-[200px]" />
        </div>
        <div className="fp-ip-body">
          <Lines widths={['m', 'l']} />
          <Readouts n={4} />
        </div>
      </div>
      <div className="fp-panel fp-stack">
        <span className="fp-skel fp-skel-line fp-skel-line--s" />
        <span className="fp-skel fp-skel-block h-64" />
      </div>
    </>
  );
}

function List() {
  return (
    <div className="fp-panel fp-stack">
      <span className="fp-skel fp-skel-line fp-skel-line--s" />
      <Rows n={6} />
    </div>
  );
}

function Cards() {
  return (
    <>
      {[3, 2, 2].map((n, i) => (
        <div key={i} className="fp-panel fp-stack">
          <span className="fp-skel fp-skel-line fp-skel-line--s" />
          <Rows n={n} />
        </div>
      ))}
    </>
  );
}

function Form() {
  return (
    <div className="fp-panel fp-stack fp-stack--l">
      <Lines widths={['s', 'm']} />
      {[0, 1].map((i) => (
        <div key={i} className="fp-stack fp-stack--s">
          <span className="fp-skel fp-skel-line fp-skel-line--s" />
          <span className="fp-skel h-11 w-full" />
        </div>
      ))}
      <span className="fp-skel h-11 w-full" />
    </div>
  );
}

function Hero() {
  return (
    <>
      <div className="fp-panel fp-stack fp-stack--m items-center py-10">
        <span className="fp-skel fp-skel-circle h-14 w-14" />
        <span className="fp-skel fp-skel-line w-64 max-w-full" />
        <span className="fp-skel fp-skel-line fp-skel-line--m" />
        <span className="fp-skel h-11 w-44" />
      </div>
      <div className="fp-grid-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="fp-panel">
            <Lines widths={['s', 'l', 'm']} />
          </div>
        ))}
      </div>
    </>
  );
}

function Default() {
  return (
    <div className="fp-panel">
      <Lines widths={['s', 'l', 'm']} />
    </div>
  );
}

const SHAPES: Record<PageSkeletonVariant, () => ReactNode> = {
  'stats-charts': StatsCharts,
  list: List,
  cards: Cards,
  form: Form,
  hero: Hero,
  default: Default,
};

function PageSkeleton({ variant, fullPage = false }: PageSkeletonProps) {
  const Shape = SHAPES[variant] ?? Default;
  const body = (
    <div role="status" className="fp-stack fp-stack--page" aria-busy="true">
      <span className="fp-sr-only">Loading</span>
      <div aria-hidden="true" className="contents">
        <Shape />
      </div>
    </div>
  );
  if (!fullPage) return body;
  const width = variant === 'form' ? 'max-w-md' : 'max-w-5xl';
  return (
    <div className="flex min-h-[100dvh] justify-center bg-appbg px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-10">
      <div className={`w-full ${width}`}>{body}</div>
    </div>
  );
}

export default memo(PageSkeleton);
