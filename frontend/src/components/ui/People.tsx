import { useState, type ReactNode } from 'react';
import type { Tone } from '../../utils/status';
import { cx, knobs } from './cx';
import { Lamp } from './Status';

/*
 * People and pictures: Avatar (a person's colour disc with readable initials, or their photo),
 * AvatarStack, Board (the presence board: People, Who's home, the guest lobby) and MediaFrame
 * (a camera tile around real footage).
 */

// ─── Avatar ─────────────────────────────────────────────────────────────

/**
 * "Bryan" → "B", "Danny Tran" → "DT", "" → "?": the first letter of each word, at most two.
 * The same rule as the shell's avatar (shell/ShellAvatar initialsOf) and profile/Avatar, so a
 * person reads the same everywhere (B-183). The prototype drew two letters for a one-word name
 * ("BR"); if the owner prefers that, change it here and in initialsOf together.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// The two inks initials can take: Faceplate's ink and white.
const INK = '#15181a';
const WHITE = '#ffffff';

/**
 * The initials colour for a person's colour: whichever of ink or white contrasts more (WCAG).
 * People pick their own colour, pale mint to slate; white on a pale disc measured 1.2–2:1 (B-158),
 * and ink alone fails on a dark one. Null when the colour isn't a hex (a token): the kit's
 * --appavatar-ink applies.
 */
export function avatarInk(color: string | null | undefined): string | null {
  const rgb = color ? parseHex(color) : null;
  if (!rgb) return null;
  const l = luminance(rgb);
  const onInk = (l + 0.05) / (luminance(parseHex(INK)!) + 0.05);
  const onWhite = 1.05 / (l + 0.05);
  return onInk >= onWhite ? INK : WHITE;
}

/** The WCAG contrast ratio of two hex colours (for tests and checks). */
export function contrastRatio(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return 0;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  name: string;
  /** The person's own colour (accentColor). Default: the neutral avatar token. */
  color?: string | null;
  photoUrl?: string | null;
  /** xs 24 · sm 30 · md 36 · lg 56 · xl 88. */
  size?: AvatarSize;
  /** Away: a hollow ring in their colour. */
  away?: boolean;
  /** A presence lamp on the edge; `lampLabel` ("home") is added to the spoken name. */
  lamp?: Tone;
  lampLabel?: string;
  /**
   * The name is already written next to it (a row, a board cell): hide the avatar from screen
   * readers. Otherwise it is an image named `name`.
   */
  decorative?: boolean;
  className?: string;
}

export function Avatar({ name, color, photoUrl, size = 'md', away, lamp, lampLabel, decorative, className }: AvatarProps) {
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = !!photoUrl && broken !== photoUrl;
  const ink = avatarInk(color);
  const style = knobs({
    ...(color ? { '--fp-who': color } : {}),
    // Away draws the initials in graphite on a well, so the computed ink would be wrong there.
    ...(ink && !away && !showPhoto ? { color: ink } : {}),
    ...(showPhoto ? { overflow: 'hidden' } : {}),
  });
  return (
    <span
      className={cx('fp-avatar', size !== 'md' && `fp-avatar--${size}`, away && 'fp-is-away', className)}
      style={style}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : lampLabel ? `${name}, ${lampLabel}` : name}
      aria-hidden={decorative || undefined}
    >
      {showPhoto ? (
        <img
          src={photoUrl!}
          alt=""
          onError={() => setBroken(photoUrl!)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
        />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
      {lamp && <Lamp tone={lamp} className="fp-avatar-lamp" />}
    </span>
  );
}

/** Overlapping avatars ("who's here"). Name the group with `label` ("Bryan and Mai are home"). */
export function AvatarStack({ label, children }: { label: string; children: ReactNode }) {
  return <span className="fp-avatars" role="img" aria-label={label}>{children}</span>;
}

// ─── Presence board ─────────────────────────────────────────────────────

export interface BoardPerson {
  key: string | number;
  name: string;
  color?: string | null;
  photoUrl?: string | null;
  /** The silk-screen state word ("Home", "Away", "On guest Wi-Fi"). */
  state: string;
  tone: Tone;
  /** Greys the cell: not here. */
  away?: boolean;
  /** When, in mono ("Sun, 6:12 PM"). */
  when?: ReactNode;
  /** Opens the person. */
  onClick?: () => void;
}

/** One cell per person: face, name, a lamp with its state word, a time. */
export function Board({ people, label, strip, fill, className }: { people: readonly BoardPerson[]; label: string; strip?: boolean; fill?: boolean; className?: string }) {
  return (
    <div className={cx('fp-board', strip && 'fp-board--strip', fill && 'fp-board--fill', className)}>
      <ul className="fp-board-grid" aria-label={label}>
        {people.map((p) => {
          const inner = (
            <>
              <Avatar name={p.name} color={p.color} photoUrl={p.photoUrl} size="lg" away={p.away} decorative />
              <span className="fp-board-name">{p.name}</span>
              <span className="fp-board-state"><Lamp tone={p.tone} /><span className="fp-label">{p.state}</span></span>
              {p.when != null && <span className="fp-board-when">{p.when}</span>}
            </>
          );
          const cls = cx('fp-board-cell', p.away && 'fp-is-away');
          return (
            <li key={p.key}>
              {p.onClick ? <button type="button" className={cls} onClick={p.onClick}>{inner}</button> : <div className={cls}>{inner}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── MediaFrame ─────────────────────────────────────────────────────────

export interface MediaFrameProps {
  /** The still or live video: give it className="fp-media-feed" so it fills the frame. */
  feed?: ReactNode;
  /** The camera's name, bottom-left. */
  name?: ReactNode;
  /** Top-left tag: live (a blinking REC lamp) or a plain word ("Still", "Paused"). */
  tag?: { text: ReactNode; live?: boolean };
  /** Top-right mono time. */
  time?: ReactNode;
  /** Bottom-right note ("Person · 1 min ago"). */
  note?: ReactNode;
  /** Offline: greys the feed and shows this message in the middle ("Offline since Sun, 4:12 PM"). */
  offline?: ReactNode;
  /** Viewfinder corner marks. */
  viewfinder?: boolean;
  /** Anything else on the picture (a play key: <button className="fp-media-play">). */
  overlay?: ReactNode;
  /** Under the frame: battery, actions. */
  caption?: ReactNode;
  className?: string;
}

/** A camera tile. Footage is always dark, in both themes. */
export function MediaFrame({ feed, name, tag, time, note, offline, viewfinder, overlay, caption, className }: MediaFrameProps) {
  return (
    <figure className={cx('fp-media', className)}>
      <div className={cx('fp-media-frame', offline != null && offline !== false && 'fp-is-offline')}>
        {feed}
        {viewfinder && <span className="fp-media-vf" aria-hidden="true" />}
        {tag && (
          <span className={cx('fp-media-tag', !tag.live && 'fp-media-tag--off')}>
            <span className="fp-media-rec" aria-hidden="true" />
            {tag.text}
          </span>
        )}
        {time != null && <span className="fp-media-time">{time}</span>}
        {offline != null && offline !== false && <span className="fp-media-offline">{offline}</span>}
        {name != null && <span className="fp-media-name">{name}</span>}
        {note != null && <span className="fp-media-note">{note}</span>}
        {overlay}
      </div>
      {caption != null && <figcaption className="fp-media-cap">{caption}</figcaption>}
    </figure>
  );
}
