import { memo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import ElectricalUsage from './ElectricalUsage';
import GasUsage from './GasUsage';
import WaterUsage from './WaterUsage';

type UtilityView = 'electric' | 'gas' | 'water';

const TABS: { key: UtilityView; label: string; icon: string }[] = [
  { key: 'electric', label: 'Electric', icon: '⚡' },
  { key: 'gas', label: 'Gas', icon: '🔥' },
  { key: 'water', label: 'Water', icon: '💧' },
];

/** Deep-link ?view= values map straight to a tab key. */
function viewFromParam(value: string | null): UtilityView {
  return value === 'gas' || value === 'water' ? value : 'electric';
}

/**
 * Combined "Utility" tab: swap between Electric (default), Gas, and Water at the
 * top. Each child page renders its own content (no page header of its own), so
 * this just owns the switcher + a gas-specific note about monthly reporting.
 */
export default memo(function Utility() {
  useDocumentTitle('Utility');
  // Deep-link support: /utility?view=gas|water opens on that tab (e.g. a Home quick-link).
  const [params] = useSearchParams();
  const [view, setView] = useState<UtilityView>(viewFromParam(params.get('view')));

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Utility"
        className="inline-flex rounded-xl border border-appborder bg-appinset p-1"
      >
        {TABS.map((tab) => {
          const active = view === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(tab.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-appaccent-soft text-appaccent-text shadow-[0_1px_3px_var(--appshadow)]'
                  : 'text-apptext-soft hover:text-apptext'
              }`}
            >
              <span aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {view === 'gas' && (
        <div className="rounded-xl border border-appborder bg-appinset px-4 py-3 text-sm leading-6 text-apptext-soft">
          <span className="font-medium text-apptext">Gas usage is only reported monthly.</span>{' '}
          CoServ posts natural gas as a single figure per billing cycle, so you'll see one reading per
          month rather than the daily/hourly detail available for electricity.
        </div>
      )}

      {view === 'electric' && <ElectricalUsage />}
      {view === 'gas' && <GasUsage />}
      {view === 'water' && <WaterUsage />}
    </div>
  );
});
