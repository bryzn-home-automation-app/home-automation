import { useId, useState, type ReactNode } from 'react';
import { Fieldset, Icon, Select, cx } from './ui';

/*
 * A birthday as three native pickers, month / day / year: on a phone each opens the phone's own
 * wheel, which beats scrolling a calendar back decades. Reports yyyy-MM-dd once all three make a
 * real date (never Feb 30), and '' until then. Pass `defaultValue` to start from a stored date;
 * remount (key) to start over.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const EARLIEST_BIRTH_YEAR = 1900;

/** yyyy-MM-dd from the three picks, or '' while one is missing or they don't make a real date. */
export function isoBirthday(year: string, month: string, day: string): string {
  if (!year || !month || !day) return '';
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "March 4, 1990" for a yyyy-MM-dd, without going through a timezone (which can shift the day). */
export function formatBirthday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS_LONG[m - 1]} ${d}, ${y}`;
}

function daysIn(month: string, year: string): number {
  if (!month) return 31;
  // Year unknown yet: allow Feb 29 (a leap year), checked again once the year is picked.
  const y = year ? Number(year) : 2000;
  return new Date(Date.UTC(y, Number(month), 0)).getUTCDate();
}

function split(iso: string | undefined): { y: string; m: string; d: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) return { y: '', m: '', d: '' };
  return { y: String(Number(match[1])), m: String(Number(match[2])), d: String(Number(match[3])) };
}

export interface BirthdayInputProps {
  legend?: ReactNode;
  defaultValue?: string;
  onChange: (iso: string) => void;
  help?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export default function BirthdayInput({ legend = 'Birthday', defaultValue, onChange, help, error, disabled, className }: BirthdayInputProps) {
  const [parts, setParts] = useState(() => split(defaultValue));
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const helpId = help != null ? `bd${id}-help` : undefined;
  const errorId = error ? `bd${id}-error` : undefined;
  const describedBy = cx(errorId, helpId) || undefined;

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - EARLIEST_BIRTH_YEAR + 1 }, (_, i) => String(thisYear - i));
  const days = Array.from({ length: daysIn(parts.m, parts.y) }, (_, i) => String(i + 1));

  const pick = (key: 'y' | 'm' | 'd', value: string) => {
    const next = { ...parts, [key]: value };
    // A day the new month or year doesn't have (Feb 30) is cleared rather than kept invisibly.
    if (next.d && Number(next.d) > daysIn(next.m, next.y)) next.d = '';
    setParts(next);
    onChange(isoBirthday(next.y, next.m, next.d));
  };

  const common = { disabled, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined } as const;

  return (
    <Fieldset legend={legend} className={className}>
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.25fr)] gap-2">
        <Select aria-label="Month" name="bday-month" autoComplete="bday-month" value={parts.m} onChange={(e) => pick('m', e.target.value)} {...common}>
          <option value="" disabled>Month</option>
          {MONTHS.map((label, i) => (
            <option key={label} value={String(i + 1)}>{label}</option>
          ))}
        </Select>
        <Select aria-label="Day" name="bday-day" autoComplete="bday-day" value={parts.d} onChange={(e) => pick('d', e.target.value)} {...common}>
          <option value="" disabled>Day</option>
          {days.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>
        <Select aria-label="Year" name="bday-year" autoComplete="bday-year" value={parts.y} onChange={(e) => pick('y', e.target.value)} {...common}>
          <option value="" disabled>Year</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>
      </div>
      {errorId && (
        <span className="fp-field-error" id={errorId}>
          <Icon name="alert-circle" />
          {error}
        </span>
      )}
      {helpId && <span className="fp-field-help" id={helpId}>{help}</span>}
    </Fieldset>
  );
}
