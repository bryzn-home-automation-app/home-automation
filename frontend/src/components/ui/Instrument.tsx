import { createContext, useContext, useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../../utils/status';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import { Lamp } from './Status';

/*
 * The page's answer (KIT.md §2–3, §7.1–7.3): every converted page opens with one
 * InstrumentPanel holding its instrument (a Dial, a map, the camera tiles, a QR plate), the
 * Verdict (a lamp + one sentence + a note) and 2–4 Readouts. On "doing" pages the primary
 * action goes in `children`, under the readouts.
 *
 *   <InstrumentPanel
 *     instrument={<Dial … />}
 *     verdict={<Verdict tone="headsup" note="Partly cloudy and 67° now.">A few things need a look.</Verdict>}
 *     readouts={<Readouts><Readout label="Yesterday" value="35.5" unit="kWh" note="9% over forecast" /></Readouts>}
 *     foot={<><span className="fp-mono">Updated 5:00 PM</span><Button size="sm">Check now</Button></>}
 *   />
 */

export interface InstrumentPanelProps {
  instrument: ReactNode;
  /** A <Verdict>. The panel is labelled by the verdict sentence. */
  verdict: ReactNode;
  /** A <Readouts> row. */
  readouts?: ReactNode;
  /** Under the readouts: the page's primary action, an attention list, a disclosure. */
  children?: ReactNode;
  /** The freshness line at the bottom of the body (mono text + an optional small action). */
  foot?: ReactNode;
  className?: string;
}

export function InstrumentPanel({ instrument, verdict, readouts, children, foot, className }: InstrumentPanelProps) {
  const id = useId();
  return (
    <VerdictIdContext id={id}>
      <section className={cx('fp-ip', className)} aria-labelledby={id}>
        <div className="fp-ip-instrument">{instrument}</div>
        <div className="fp-ip-body">
          {verdict}
          {readouts}
          {children}
          {foot != null && <div className="fp-ip-foot">{foot}</div>}
        </div>
      </section>
    </VerdictIdContext>
  );
}

// The verdict sentence names the panel. A context (rather than a prop the page must thread)
// hands the panel's id to the Verdict inside it.
const VerdictId = createContext<string | undefined>(undefined);
function VerdictIdContext({ id, children }: { id: string; children: ReactNode }) {
  return <VerdictId.Provider value={id}>{children}</VerdictId.Provider>;
}

export interface VerdictProps {
  /** Never leave a verdict without a lamp: ok = nothing to do, headsup = look soon, problem = broken, info = news. */
  tone: Tone;
  /** The sentence: ≤ 12 words, starting with the fact ("Heading for about $114 this cycle."). */
  children: ReactNode;
  /** One or two sentences of why or what next, with numbers. */
  note?: ReactNode;
  /** The id of the sentence; inside an InstrumentPanel it is set for you. */
  id?: string;
  largeLamp?: boolean;
}

export function Verdict({ tone, children, note, id, largeLamp }: VerdictProps) {
  const panelId = useContext(VerdictId);
  return (
    <div className={cx('fp-verdict', largeLamp && 'fp-verdict--lamp-lg')}>
      {/* The sentence carries the meaning; the lamp's word is said for screen readers only. */}
      <Lamp tone={tone} label />
      <p className="fp-verdict-text" id={id ?? panelId}>{children}</p>
      {note != null && <p className="fp-verdict-note">{note}</p>}
    </div>
  );
}

/**
 * The readout wells: 2 per row on a phone (an odd last one spans), 2–4 in a row on desktop.
 * `count` is how many are actually shown when some are role-gated, so the desktop row fits
 * what is visible (the kit's --fit + data-n).
 */
export function Readouts({ children, count, square, className }: { children: ReactNode; count?: 1 | 2 | 3 | 4; square?: boolean; className?: string }) {
  return (
    <div className={cx('fp-readouts', count != null && 'fp-readouts--fit', square && 'fp-readouts--2x2', className)} data-n={count}>
      {children}
    </div>
  );
}

export interface ReadoutProps {
  /** 1–2 words, silk-screen ("Yesterday", "Inside"). */
  label: ReactNode;
  /** The figure, already formatted ("35.5", "$114", "71°"). A sentence is not a value. */
  value: ReactNode;
  /** In mono beside the figure: kWh, °F, %, gal. */
  unit?: string;
  /** One line of context or comparison. */
  note?: ReactNode;
  noteIcon?: IconName;
  /** A lamp in the label for a reading with a status (a camera battery). */
  tone?: Tone;
  /** No well: a readout inside a panel's stats group. */
  plain?: boolean;
  /** Span the whole row. */
  span?: boolean;
  /** Makes the well the way to the detail: a route (a link) or an action (a button). Both show a chevron. */
  to?: string;
  onClick?: () => void;
  className?: string;
}

export function Readout({ label, value, unit, note, noteIcon, tone, plain, span, to, onClick, className }: ReadoutProps) {
  const cls = cx('fp-readout', plain && 'fp-readout--plain', span && 'fp-readout--span', className);
  const body = (
    <>
      <span className="fp-label">
        {tone && <Lamp tone={tone} size="s" label />}
        {label}
      </span>
      <span className="fp-readout-value">
        <Num value={value} unit={unit} />
      </span>
      {note != null && (
        <span className="fp-readout-note">
          {noteIcon && <Icon name={noteIcon} />}
          {note}
        </span>
      )}
    </>
  );
  if (to) return <Link className={cls} to={to}>{body}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

/**
 * A readout numeral: tabular, condensed, with the unit in mono. Sizes: xl 44 (a dial's centre),
 * l 28 (default, readouts), m 18, s 15.
 */
export function Num({ value, unit, size = 'l', className }: { value: ReactNode; unit?: string; size?: 'xl' | 'l' | 'm' | 's'; className?: string }) {
  return (
    <span className={cx('fp-num', size !== 'l' && `fp-num--${size}`, className)}>
      {value}
      {unit && <span className="fp-unit">{unit}</span>}
    </span>
  );
}
