import type { CSSProperties, ReactNode } from 'react';
import { useChartTheme } from './chartTheme';
import { LegendKey, type ChartTone, type LegendItem } from './Instruments';

/*
 * The pieces around a Recharts chart that every chart page needs: the legend row above it and
 * the card a custom tooltip draws. Written for Utilities in phase 2 and promoted here so the
 * next chart doesn't hand-roll its own (the kit's tooltip look comes from useChartTheme).
 */

/** The legend row above a chart: what each line, dash or box means. */
export function ChartLegend({ items }: { items: Array<LegendItem & { tone?: ChartTone }> }) {
  return (
    <div className="fp-chart-legend">
      {items.map((it, i) => (
        <span key={i} className="fp-lg-item">
          <LegendKey tone={it.tone} kind={it.key} />
          {it.label}
          {it.value != null && <> <b className="fp-mono">{it.value}</b></>}
        </span>
      ))}
    </div>
  );
}

/** The opaque card a custom Recharts tooltip draws (the kit's tooltip look). */
export function TooltipCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  const t = useChartTheme();
  return (
    <div style={t.tooltip.contentStyle as CSSProperties}>
      <p style={t.tooltip.labelStyle as CSSProperties}>{title}</p>
      <div style={{ ...(t.tooltip.itemStyle as CSSProperties), display: 'grid', gap: 2 }}>{children}</div>
    </div>
  );
}

/** One "name … value" line inside a TooltipCard. */
export function TooltipLine({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontWeight: strong ? 600 : undefined }}>
      <span>{label}</span>
      <span>{value}</span>
    </span>
  );
}
