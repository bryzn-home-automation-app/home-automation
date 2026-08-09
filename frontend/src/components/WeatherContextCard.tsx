import { useQuery } from '@tanstack/react-query';
import { fetchWeatherForRange } from '../api/weather';
import { getDominantWeatherEmoji } from '../utils/weather';
import type { WeatherResponse } from '../types';

interface WeatherContextCardProps {
  startDate: string;
  endDate: string;
  showHDD?: boolean;
  showPrecipitation?: boolean;
}

function formatTemp(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value)}°F`;
}

function formatPrecip(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(2)}"`;
}

function formatHDD(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value)} HDD`;
}

function formatDateRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function Skeleton() {
  return (
    <div className="animate-pulse rounded-[24px] border border-appborder bg-appsurface-raised p-5">
      <div className="mb-4 h-4 w-28 rounded bg-appinset" />
      <div className="h-8 w-64 rounded bg-appinset" />
    </div>
  );
}

function WeatherContent({ data, showHDD, showPrecipitation, startDate, endDate }: {
  data: WeatherResponse;
  showHDD?: boolean;
  showPrecipitation?: boolean;
  startDate: string;
  endDate: string;
}) {
  const agg = data.aggregation;
  if (!agg || (agg.averageTemperature == null && agg.totalPrecipitation == null)) {
    return null;
  }

  const codes = data.daily.map((d) => d.weatherCode).filter((c) => c > 0);
  const emoji = getDominantWeatherEmoji(codes);

  const parts: string[] = [];
  parts.push(`${formatTemp(agg.averageTemperature)} avg`);
  if (agg.minTemperature != null && agg.maxTemperature != null) {
    parts.push(`${formatTemp(agg.minTemperature)} – ${formatTemp(agg.maxTemperature)}`);
  }
  if (showPrecipitation && agg.totalPrecipitation != null) {
    parts.push(`💧 ${formatPrecip(agg.totalPrecipitation)}`);
  }
  if (showHDD && agg.heatingDegreeDays != null) {
    parts.push(`🔥 ${formatHDD(agg.heatingDegreeDays)}`);
  }

  return (
    <div className="rounded-[24px] border border-appborder bg-appsurface-raised p-5 shadow-[0_8px_24px_var(--appshadow)] transition-colors hover:border-appborder-hover">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">{emoji}</span>
        <span className="text-sm font-medium text-apptext-soft">Weather Context</span>
        <span className="text-xs text-apptext-muted">{formatDateRange(startDate, endDate)}</span>
      </div>
      <p className="text-base text-apptext-soft tracking-[-0.02em]">
        {parts.join('  ·  ')}
      </p>
    </div>
  );
}

export default function WeatherContextCard({
  startDate,
  endDate,
  showHDD = false,
  showPrecipitation = false,
}: WeatherContextCardProps) {
  // Normalize to date-only strings (YYYY-MM-DD) — buildUsagePeriods
  // produces full ISO datetimes but the backend expects LocalDate.
  const dateStart = startDate.slice(0, 10);
  const dateEnd = endDate.slice(0, 10);
  const enabled = dateStart !== '' && dateEnd !== '';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['weather', dateStart, dateEnd],
    queryFn: () => fetchWeatherForRange(dateStart, dateEnd),
    enabled,
    staleTime: 60_000,
  });

  // Silently hide on error or when disabled
  if (!enabled || isError) return null;
  if (isLoading) return <Skeleton />;
  if (!data) return null;

  return (
    <WeatherContent
      data={data}
      showHDD={showHDD}
      showPrecipitation={showPrecipitation}
      startDate={startDate}
      endDate={endDate}
    />
  );
}
