import { useId, useState } from 'react';
import { Icon, KeyValue, KV, cx, knobs } from './ui';
import {
  DASH, formatDate, formatNumber, formatPercent, formatTemp, formatTime, formatWeekday, homeToday,
} from '../utils/format';
import { getWeatherCodeDescription, weatherIcon, weekScale, type SunPlace, type WeekDay } from '../utils/weather';
import { sunTimesOn } from '../utils/sun';

/*
 * Home's week view: today and the next six days. A phone gets seven rows (day, sky, rain,
 * low, the range bar, high), from 640px a seven-column strip (the bar stands up between the
 * high and the low). Each day's bar is its low–high placed on the week's own coldest-to-warmest
 * scale, so the warm and cold days read at a glance; the bar's colour runs cool to heat along
 * that same scale. Rain is a figure (the chance, plus the amount when there is one), in the
 * cool colour and medium weight on a day it is likely.
 *
 * Tapping a day shows its detail (sunrise and sunset, wind, rain) under the week; tapping it
 * again hides it. Nothing is hover-only.
 */

/** Rain amounts under this are noise ("0.00 in"), not worth a line. */
const TRACE_INCHES = 0.01;

export function WeekStrip({ week, place, now = new Date() }: { week: WeekDay[]; place?: SunPlace | null; now?: Date }) {
  const [open, setOpen] = useState<string | null>(null);
  const detailId = useId();
  const scale = weekScale(week);
  const today = homeToday(now);
  const openDay = week.find((d) => d.date === open && !d.missing) ?? null;

  return (
    <div className="fp-stack fp-stack--s">
      <ol className="grid grid-cols-1 gap-0.5 sm:grid-cols-7 sm:gap-1" aria-label="Week forecast">
        {week.map((d) => {
          const isToday = d.date === today;
          const name = isToday ? 'Today' : formatWeekday(d.date);
          const sky = d.code != null ? getWeatherCodeDescription(d.code) : null;
          const span = scale && !d.missing ? Math.max(scale.max - scale.min, 1) : 1;
          const lo = scale && !d.missing ? (((d.low as number) - scale.min) / span) * 100 : 0;
          const hi = scale && !d.missing ? (((d.high as number) - scale.min) / span) * 100 : 0;
          // A day whose low and high are a degree apart still gets a visible pill.
          const width = Math.max(hi - lo, 6);
          const left = Math.min(lo, 100 - width);
          const rain = d.rainInches != null && d.rainInches >= TRACE_INCHES ? formatNumber(d.rainInches, { decimals: 2, unit: 'in' }) : null;
          return (
            <li key={d.date}>
              <button
                type="button"
                disabled={d.missing}
                aria-pressed={d.missing ? undefined : open === d.date}
                aria-controls={open === d.date ? detailId : undefined}
                aria-current={isToday ? 'date' : undefined}
                onClick={() => setOpen((o) => (o === d.date ? null : d.date))}
                className={cx(
                  // Phone: one row. From 640px: one column.
                  'grid min-h-11 w-full grid-cols-[3rem_1.75rem_3.5rem_2.25rem_minmax(0,1fr)_2.25rem] items-center gap-x-2 rounded-well px-2 py-1.5 text-left',
                  'sm:flex sm:h-full sm:flex-col sm:items-center sm:gap-2 sm:px-1 sm:py-3 sm:text-center',
                  'transition-colors duration-150 enabled:hover:bg-appinset enabled:active:bg-appinset',
                  'disabled:cursor-default',
                  (isToday || open === d.date) && 'bg-appinset shadow-[var(--appwell-shadow)]',
                  // The open day is ringed, so it reads apart from today's well.
                  open === d.date && 'ring-2 ring-inset ring-[var(--appborder-strong)]',
                )}
              >
                {/* Day */}
                <span className={cx('whitespace-nowrap text-sm sm:order-1', isToday ? 'font-semibold text-apptext' : 'font-medium text-apptext')}>
                  {name}
                </span>
                {/* Sky */}
                <span className="flex justify-center sm:order-2">
                  {d.code != null
                    ? <Icon name={skyIcon(d.code)} className={cx('text-[22px] sm:text-[26px]', d.wet ? 'text-appchart-cool' : 'text-apptext-muted')} />
                    : <span className="text-apptext-muted" aria-hidden="true">{DASH}</span>}
                  {sky && <span className="fp-sr-only">, {sky}</span>}
                </span>
                {/* Rain: the chance, and the amount when there is one */}
                <span className={cx('flex min-w-0 flex-col font-mono text-xs leading-tight sm:order-6 sm:items-center', d.wet ? 'font-medium text-appchart-cool' : 'text-apptext-muted')}>
                  {d.missing ? (
                    <span className="text-apptext-muted">No forecast</span>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                        <Icon name="droplet" className="text-[11px]" />
                        <span className="fp-sr-only">, chance of rain </span>
                        {d.rainChance != null ? formatPercent(d.rainChance) : DASH}
                      </span>
                      {rain && (
                        <span className="whitespace-nowrap text-[11px]">
                          <span className="fp-sr-only">, </span>{rain}
                        </span>
                      )}
                    </>
                  )}
                </span>
                {/* Low */}
                <span className="fp-num text-right text-sm text-apptext-muted sm:order-5 sm:text-center">
                  <span className="fp-sr-only">, low </span>{d.missing ? DASH : formatTemp(d.low)}
                </span>
                {/* The week's scale, this day's low–high on it */}
                <span
                  className="relative block h-1.5 w-full rounded-full bg-appinset sm:order-4 sm:h-16 sm:w-1.5 sm:flex-none"
                  aria-hidden="true"
                >
                  {!d.missing && (
                    <span
                      className={cx(
                        'absolute inset-y-0 left-[calc(var(--fp-lo)*1%)] w-[calc(var(--fp-w)*1%)] overflow-hidden rounded-full',
                        'sm:inset-y-auto sm:inset-x-0 sm:bottom-[calc(var(--fp-lo)*1%)] sm:h-[calc(var(--fp-w)*1%)] sm:w-auto',
                      )}
                      style={knobs({ '--fp-lo': String(left), '--fp-w': String(width) })}
                    >
                      {/* The gradient spans the whole week's scale; each day shows its own slice of it. */}
                      <span
                        className={cx(
                          'absolute inset-y-0 left-[calc(var(--fp-lo)/var(--fp-w)*-100%)] w-[calc(10000%/var(--fp-w))] bg-linear-to-r from-appchart-cool to-appchart-heat',
                          'sm:inset-y-auto sm:inset-x-0 sm:bottom-[calc(var(--fp-lo)/var(--fp-w)*-100%)] sm:h-[calc(10000%/var(--fp-w))] sm:w-auto sm:bg-linear-to-t',
                        )}
                      />
                    </span>
                  )}
                </span>
                {/* High */}
                <span className="fp-num text-right text-sm font-semibold text-apptext sm:order-3 sm:text-center">
                  <span className="fp-sr-only">, high </span>{d.missing ? DASH : formatTemp(d.high)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {openDay && <DayDetail id={detailId} day={openDay} place={place} />}
    </div>
  );
}

function DayDetail({ id, day, place }: { id: string; day: WeekDay; place?: SunPlace | null }) {
  const sky = day.code != null ? getWeatherCodeDescription(day.code) : null;
  // The backend's sun times are home wall-clock; the local calculation stands in if they're missing.
  const sun = !day.sunrise || !day.sunset ? sunTimesOn(day.date, place?.lat ?? null, place?.lon ?? null) : null;
  const sunrise = day.sunrise ?? sun?.sunrise ?? null;
  const sunset = day.sunset ?? sun?.sunset ?? null;
  return (
    <div id={id} className="rounded-well bg-appinset px-4 py-3 shadow-[var(--appwell-shadow)]" aria-live="polite">
      <p className="text-sm font-semibold text-apptext">
        {formatDate(day.date)}{sky ? ` · ${sky}` : ''}
      </p>
      <KeyValue cols className="mt-1">
        <KV label="High and low" value={`${formatTemp(day.high)} / ${formatTemp(day.low)}`} />
        <KV label="Chance of rain" value={day.rainChance != null ? formatPercent(day.rainChance) : DASH} />
        <KV label="Rain" value={day.rainInches != null ? formatNumber(day.rainInches, { decimals: 2, unit: 'in' }) : DASH} />
        <KV label="Wind" value={day.wind != null ? `Up to ${formatNumber(day.wind, { decimals: 0, unit: 'mph' })}` : DASH} />
        <KV label={<><Icon name="sunrise" />Sunrise</>} value={formatTime(sunrise)} />
        <KV label={<><Icon name="sunset" />Sunset</>} value={formatTime(sunset)} />
      </KeyValue>
    </div>
  );
}

/** The day's sky, always the daytime icon (a day is planned by its daylight). */
const skyIcon = (code: number) => weatherIcon(code, false);
