import type { CSSProperties } from 'react';

/** Joins class names, skipping the falsy ones: cx('fp-btn', primary && 'fp-btn--primary', className). */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Inline style with the kit's per-element knobs (--fp-p, --fp-who, --fp-dial-max...). React's
 * CSSProperties has no custom properties, so they are typed here once instead of a cast per call.
 */
export type KnobStyle = CSSProperties & Record<`--fp-${string}`, string | number | undefined>;

export function knobs(style: KnobStyle): CSSProperties {
  return style as CSSProperties;
}
