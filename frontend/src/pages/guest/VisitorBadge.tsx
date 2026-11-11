import type { ReactNode } from 'react';
import { Avatar, cx, knobs } from '../../components/ui';

/*
 * The guest pages' instrument: a visitor badge. A white label plate (dark on white in both
 * themes, like the Wi-Fi plate) with a band in the guest's own colour, their face, their name,
 * and two facts along the foot. The colour only fills the band and the face, never text, so a
 * pale pick like Lime stays readable (B-167); the initials pick ink or white by contrast (B-158).
 */
export default function VisitorBadge({
  name,
  color,
  photoUrl,
  role,
  foot,
  faceKey,
  label,
  faceName,
}: {
  name: string;
  /** The name the initials come from, when the shown name is a placeholder ("Your name"). */
  faceName?: string;
  color: string;
  photoUrl?: string | null;
  /** The line under the name ("Guest at the house", "Checked in at 1:42 PM"). */
  role: ReactNode;
  /** Two [label, value] facts along the foot. */
  foot: [ReactNode, ReactNode][];
  /** A key on the face (the photo picker), positioned by the badge. */
  faceKey?: ReactNode;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-[min(100%,340px)] flex-col overflow-hidden rounded-[14px] border border-[var(--appplate-edge)] bg-appplate text-appplate-ink lg:w-[360px]"
      style={knobs({ '--fp-who': color })}
    >
      <span aria-hidden="true" className="grid h-[30px] place-items-center bg-[var(--fp-who)]">
        <span className="h-2 w-[46px] rounded bg-appsurface shadow-[var(--appwell-shadow)]" />
      </span>
      <span className="flex min-w-0 items-center gap-4 px-[18px] pb-4 pt-[18px]">
        <span className="relative grid flex-none">
          <Avatar
            name={faceName ?? name}
            color={color}
            photoUrl={photoUrl}
            decorative
            className="[--fp-size:64px] lg:[--fp-size:72px] shadow-[inset_0_0_0_1px_var(--appplate-edge)]"
          />
          {faceKey}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <PlateLabel>Visitor</PlateLabel>
          <span className="truncate text-[27px] font-semibold leading-[1.1] tracking-[-.01em] lg:text-[30px]">{name}</span>
          <span className="flex items-center gap-[7px] text-[13px] text-[var(--appplate-soft)]">{role}</span>
        </span>
      </span>
      <span className="flex justify-between gap-3 border-t border-[var(--appplate-edge)] px-[18px] pb-3 pt-2.5 font-mono text-[13px] leading-snug tabular-nums">
        {foot.map(([k, v], i) => (
          <span key={i} className={cx('flex min-w-0 flex-col gap-[3px]', i === foot.length - 1 && foot.length > 1 && 'items-end text-right')}>
            <PlateLabel>{k}</PlateLabel>
            {v}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Silk-screen lettering in the plate's own soft ink. */
export function PlateLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-sans text-[10.5px] font-semibold uppercase leading-tight tracking-[.1em] text-[var(--appplate-soft)] [font-stretch:var(--appstretch-label)]">
      {children}
    </span>
  );
}
