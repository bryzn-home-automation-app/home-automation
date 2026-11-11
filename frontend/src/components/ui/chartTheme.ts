import { useTheme } from '../../context/ThemeContext';

/*
 * One look for every Recharts chart (the big time-series: usage vs temperature, forecasts,
 * camera batteries, thermostat history, server metrics). Phase 2 swaps each chart's own axis,
 * grid and tooltip props for these:
 *
 *   const t = useChartTheme();
 *   <CartesianGrid {...t.grid} />
 *   <XAxis dataKey="day" {...t.axis} />
 *   <YAxis {...t.axis} width={36} />
 *   <Tooltip {...t.tooltip} />
 *   <Line dataKey="kwh" stroke={t.series.ink} strokeWidth={2} dot={false} />
 *   <Line dataKey="predicted" stroke={t.series.graphite} strokeDasharray={t.dash} dot={false} />
 *
 * Hex, not var(--app…): Recharts writes stroke and fill as SVG attributes, where var() is
 * unreliable (see DATA_SERIES in ThemeContext). The values mirror the --appchart-* and lamp
 * tokens in index.css, light and dark; a finish (palette) never changes them, so neither does
 * this. Faceplate rules: a single series is ink; a comparison or forecast is graphite, dashed;
 * a hue only when two series must be told apart; never two y-axes on one chart.
 *
 * Tooltips are not the only way to read a value (Faceplate shows a readout line); B-039 asks
 * that a 7- or 30-day tooltip name the date, not just a weekday: use formatDateTime there.
 */

export interface ChartPalette {
  ink: string;
  graphite: string;
  soft: string;
  heat: string;
  cool: string;
  water: string;
  gas: string;
  ok: string;
  warn: string;
  problem: string;
  info: string;
  /** Range bands and the "likely" area (translucent ink). */
  band: string;
  /** Bars with no breakdown yet. */
  empty: string;
}

interface ChartColours {
  text: string;
  muted: string;
  panel: string;
  hairline: string;
  hairlineStrong: string;
  grid: string;
  cursor: string;
  series: ChartPalette;
}

/** The token values, per theme (index.css :root and [data-theme="dark"]). */
export const CHART_COLOURS: Record<'light' | 'dark', ChartColours> = {
  light: {
    text: '#15181a',
    muted: '#4e555a',
    panel: '#f7f8f7',
    hairline: 'rgba(21, 24, 26, 0.14)',
    hairlineStrong: 'rgba(21, 24, 26, 0.26)',
    grid: 'rgba(21, 24, 26, 0.09)',
    cursor: 'rgba(21, 24, 26, 0.38)',
    series: {
      ink: '#15181a', graphite: '#6a7277', soft: '#a3aaae', heat: '#d9480f', cool: '#1c7ed6',
      water: '#1098ad', gas: '#b8860b', ok: '#22a35a', warn: '#e0a100', problem: '#e0483b', info: '#3b82f6',
      band: 'rgba(21, 24, 26, 0.09)', empty: '#c3c9c6',
    },
  },
  dark: {
    text: '#eef1ef',
    muted: '#a7aeb3',
    panel: '#1b1e21',
    hairline: 'rgba(238, 241, 239, 0.13)',
    hairlineStrong: 'rgba(238, 241, 239, 0.24)',
    grid: 'rgba(238, 241, 239, 0.09)',
    cursor: 'rgba(238, 241, 239, 0.45)',
    series: {
      ink: '#eef1ef', graphite: '#9aa2a7', soft: '#5e676d', heat: '#ff8a4c', cool: '#6fb6ff',
      water: '#3cc6da', gas: '#e0b341', ok: '#3ddc84', warn: '#ffb627', problem: '#ff6b5e', info: '#6fa8ff',
      band: 'rgba(238, 241, 239, 0.11)', empty: '#454c51',
    },
  },
};

const MONO = '"DM Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const SANS = '"Archivo", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export interface ChartTheme {
  /** Spread on <XAxis> / <YAxis>: mono 11px graphite ticks, no tick marks, a hairline axis line. */
  axis: {
    stroke: string;
    tick: { fill: string; fontSize: number; fontFamily: string };
    tickLine: false;
    axisLine: { stroke: string };
    tickMargin: number;
  };
  /** Spread on <CartesianGrid>: horizontal hairlines only. */
  grid: { stroke: string; vertical: false; strokeDasharray?: string };
  /** Spread on <Tooltip>: an opaque panel with a hairline, ink text, a soft cursor. */
  tooltip: {
    contentStyle: Record<string, string | number>;
    labelStyle: Record<string, string | number>;
    itemStyle: Record<string, string | number>;
    cursor: { stroke: string; strokeWidth: number } | { fill: string };
    wrapperStyle: Record<string, string | number>;
  };
  /** For a bar chart's tooltip cursor (a band rather than a line). */
  barCursor: { fill: string };
  /** Spread on <Legend>. */
  legend: { wrapperStyle: Record<string, string | number>; iconSize: number };
  series: ChartPalette;
  /** strokeDasharray for a forecast / comparison line. */
  dash: string;
  /** Reference lines (an average, a budget). */
  reference: { stroke: string; strokeDasharray: string };
  /** A "today" marker. */
  today: { stroke: string; strokeDasharray: string };
}

/** The Recharts props for a theme. Built once per theme at module scope (stable references). */
export function buildChartTheme(theme: 'light' | 'dark'): ChartTheme {
  const c = CHART_COLOURS[theme];
  return {
    axis: {
      stroke: c.hairlineStrong,
      tick: { fill: c.muted, fontSize: 11, fontFamily: MONO },
      tickLine: false,
      axisLine: { stroke: c.hairlineStrong },
      tickMargin: 6,
    },
    grid: { stroke: c.grid, vertical: false },
    tooltip: {
      contentStyle: {
        background: c.panel,
        border: `1px solid ${c.hairline}`,
        borderRadius: 8,
        boxShadow: 'none',
        color: c.text,
        fontFamily: SANS,
        fontSize: 13,
        padding: '8px 10px',
      },
      labelStyle: { color: c.text, fontFamily: MONO, fontSize: 12, fontWeight: 500, marginBottom: 4 },
      itemStyle: { color: c.text, fontFamily: MONO, fontSize: 12, padding: 0 },
      cursor: { stroke: c.cursor, strokeWidth: 1 },
      wrapperStyle: { outline: 'none', zIndex: 10 },
    },
    barCursor: { fill: c.series.band },
    legend: { wrapperStyle: { fontFamily: SANS, fontSize: 13, color: c.muted }, iconSize: 10 },
    series: c.series,
    dash: '5 4',
    reference: { stroke: c.series.graphite, strokeDasharray: '2 3' },
    today: { stroke: c.cursor, strokeDasharray: '3 3' },
  };
}

export const CHART_THEME: Record<'light' | 'dark', ChartTheme> = {
  light: buildChartTheme('light'),
  dark: buildChartTheme('dark'),
};

/** The chart theme for the theme on screen now. Call it before any early return (hooks rule). */
export function useChartTheme(): ChartTheme {
  const { theme } = useTheme();
  return CHART_THEME[theme === 'dark' ? 'dark' : 'light'];
}
