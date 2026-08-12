import { type ReactNode } from 'react';

interface PageHeaderProps {
  /** Page title rendered as the primary heading. */
  title: string;
  /** Optional subtitle (one short sentence, rendered under the title). */
  subtitle?: string;
  /** Optional eyebrow — small uppercase label rendered above the title. */
  eyebrow?: string;
  /** Optional slot for right-aligned content (status pills, action buttons, etc.). */
  actions?: ReactNode;
  /** Heading level. Defaults to h2 to match the app shell. */
  as?: 'h1' | 'h2' | 'h3';
}

/**
 * PageHeader — per-page header used inside the app shell.
 *
 * Replaces the static "Operations Console / Utilities, alerts..." copy that was
 * duplicated on every route. Each page renders its own title/subtitle/eyebrow
 * and can optionally supply right-aligned action chips (status pills, CTAs).
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  as = 'h2',
}: PageHeaderProps) {
  const HeadingTag = as;
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        {eyebrow ? (
          <p className="inline-flex items-center rounded-full border border-appaccent-border bg-appaccent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-appaccent-text">
            {eyebrow}
          </p>
        ) : null}
        <HeadingTag className="mt-3 max-w-3xl text-xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl xl:text-4xl">
          {title}
        </HeadingTag>
        {subtitle ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-apptext-soft sm:text-base">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:gap-3">{actions}</div> : null}
    </div>
  );
}

export default PageHeader;
