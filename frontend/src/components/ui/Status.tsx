import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { kitTone, TONE_WORD, type Status, type Tone } from '../../utils/status';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

/*
 * Status in Faceplate is a lamp and a word, never colour alone (KIT.md §0 rule 6). Tones come
 * from utils/status.ts, which maps every server enum to a tone and a plain label:
 *
 *   const s = severityStatus(n.severity);
 *   <Badge tone={s.tone}>{s.label}</Badge>      or      <Badge status={s} />
 *
 * Lamp is the bare light (give it `label` when no word sits next to it), Badge a lamp + word
 * plate, StatusText coloured words, Tag a neutral silk-screen chip (roles, categories),
 * Count an unread counter, LampRow a row of labelled system lamps (Home, Diagnostics).
 */

export interface LampProps {
  tone?: Tone;
  size?: 's' | 'm' | 'l';
  /** A slow pulse for something live (a recording, a robot moving). Off for reduced motion. */
  pulse?: boolean;
  /**
   * Spoken text when no visible word explains the lamp. Pass true for the tone's own word
   * ("Heads-up"). Without it the lamp is decorative (aria-hidden).
   */
  label?: string | true;
  className?: string;
}

/** A status lamp. Neutral is the unlit lamp. */
export function Lamp({ tone = 'neutral', size = 'm', pulse, label, className }: LampProps) {
  const t = kitTone(tone);
  const cls = cx('fp-lamp', t && `fp-lamp--${t}`, size === 's' && 'fp-lamp--s', size === 'l' && 'fp-lamp--l', pulse && 'fp-lamp--pulse', className);
  if (!label) return <span className={cls} aria-hidden="true" />;
  return (
    <>
      <span className={cls} aria-hidden="true" />
      <span className="fp-sr-only">{label === true ? TONE_WORD[tone] : label}</span>
    </>
  );
}

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone?: Tone;
  /** A mapped status from utils/status (tone + label); `children` overrides the label. */
  status?: Status;
  /** No lamp dot: a plain state ("2 hr ago") or a change kind on What's new. */
  plain?: boolean;
  /** The inverted ink plate ("New"). */
  ink?: boolean;
  icon?: IconName;
  children?: ReactNode;
}

/** A lamp + word plate: "Heads-up", "Home", "Offline", "Scheduled". */
export function Badge({ tone, status, plain, ink, icon, className, children, ...rest }: BadgeProps) {
  const t = kitTone(tone ?? status?.tone ?? 'neutral');
  return (
    <span className={cx('fp-badge', t && `fp-badge--${t}`, plain && 'fp-badge--plain', ink && 'fp-badge--ink', className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children ?? status?.label}
    </span>
  );
}

const TEXT_CLASS: Record<Tone, string> = { ok: 'fp-t-ok', headsup: 'fp-t-warn', problem: 'fp-t-problem', info: 'fp-t-info', neutral: 'fp-muted' };

/** Status-coloured words (always words: the colour only repeats what they say). */
export function StatusText({ tone = 'neutral', status, className, children }: { tone?: Tone; status?: Status; className?: string; children?: ReactNode }) {
  return <span className={cx(TEXT_CLASS[status?.tone ?? tone], className)}>{children ?? status?.label}</span>;
}

/** The text-colour class for a tone, for an element that isn't a StatusText (a kv value, a cell). */
export function toneTextClass(tone: Tone): string {
  return TEXT_CLASS[tone];
}

/** A neutral silk-screen chip for a role or category ("Admin", "HVAC"); `ink` for "New". */
export function Tag({ ink, className, children }: { ink?: boolean; className?: string; children: ReactNode }) {
  return <span className={cx('fp-tag', ink && 'fp-tag--ink', className)}>{children}</span>;
}

/**
 * An unread counter plate. Hidden at zero. `label` is what a screen reader hears
 * ("3 unread"); the plate itself shows only the number (99+ past 99).
 */
export function Count({ value, label, className }: { value: number; label?: string; className?: string }) {
  if (!value || value < 0) return null;
  return (
    <span className={cx('fp-count', className)}>
      <span aria-hidden={label ? true : undefined}>{value > 99 ? '99+' : value}</span>
      {label && <span className="fp-sr-only">{label}</span>}
    </span>
  );
}

export interface LampRowItem {
  key: string;
  /** One short word in silk-screen ("Power", "Sync"). */
  label: string;
  tone: Tone;
  /** A route to the detail; the lamp becomes a link. */
  to?: string;
}

/** An indicator panel: one lamp per system, each with its label and its status said aloud. */
export function LampRow({ items, label, left, className }: { items: LampRowItem[]; label: string; left?: boolean; className?: string }) {
  return (
    <ul className={cx('fp-lamps', left && 'fp-lamps--left', className)} aria-label={label}>
      {items.map((item) => {
        const inner = (
          <>
            <Lamp tone={item.tone} />
            <span className="fp-label">{item.label}</span>
            <span className="fp-sr-only">{TONE_WORD[item.tone]}</span>
          </>
        );
        return (
          <li key={item.key}>
            {item.to ? (
              <Link className="fp-lamps-item" to={item.to}>{inner}</Link>
            ) : (
              <span className="fp-lamps-item">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
