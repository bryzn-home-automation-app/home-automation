interface PageHeaderProps {
  /** The page's one title (from routes.ts, or a page's own via usePageMeta). */
  title: string;
  /** The silk-screen group label above it: Everyday, House, You, Admin. */
  eyebrow?: string;
  /** A short freshness line ("Updated 5:00 PM"), in DM Mono. */
  subtitle?: string;
}

/**
 * The page header the shell draws above every page: silk-screen group label, the
 * title as the page's only h1, and an optional freshness line. Nothing else: the
 * Backend / Unread / Access chips and the pixel-art scenes that used to sit here
 * repeated the strip and pushed the page below the fold on a phone (B-013).
 *
 * From lg it shows above the content; below lg the kit hides it visually (the
 * strip shows the title and subtitle instead), so screen readers still get one h1.
 * Pages never render a header of their own; their first block is the answer.
 */
export function PageHeader({ title, eyebrow, subtitle }: PageHeaderProps) {
  return (
    <div className="fp-pagehead">
      <div className="fp-pagehead-text">
        {eyebrow ? <p className="fp-label fp-pagehead-eyebrow">{eyebrow}</p> : null}
        <h1 className="fp-pagehead-title">{title}</h1>
      </div>
      {subtitle ? <p className="fp-pagehead-sub fp-mono">{subtitle}</p> : null}
    </div>
  );
}

export default PageHeader;
