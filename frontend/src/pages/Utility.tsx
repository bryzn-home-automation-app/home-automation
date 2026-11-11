import { lazy, memo, Suspense } from 'react';
import { Loading, Screen, Seg, SegPanel, SkelInstrumentPanel, SkelPanel, useSearchParamState } from '../components/ui';

// Each view pulls in its own recharts-backed sub-tree (and the react-pdf bill
// viewer, lazily, from its bills table). Only one view is ever visible at a
// time, so they are split per view: the /utility chunk only carries the switch.
const ElectricalUsage = lazy(() => import('./ElectricalUsage'));
const GasUsage = lazy(() => import('./GasUsage'));
const WaterUsage = lazy(() => import('./WaterUsage'));

const VIEWS = ['electric', 'gas', 'water'] as const;
const VIEW_OPTIONS = [
  { value: 'electric', label: 'Electric', icon: 'bolt' },
  { value: 'gas', label: 'Gas', icon: 'flame' },
  { value: 'water', label: 'Water', icon: 'droplet' },
] as const;

/**
 * Utilities: the subject switch (Electric, Gas, Water) and the chosen view. The switch sits
 * above the answer because it picks what the whole page is about; each view opens with its
 * own instrument panel. The view lives in ?view= (B-075), so a reload, Back, the sleep screen
 * or a Home quick-link (/utility?view=water) all land on the same one.
 */
export default memo(function Utility() {
  const [view, setView] = useSearchParamState('view', VIEWS, 'electric');

  return (
    <Screen>
      <Seg id="utility-view" label="Utility" value={view} onChange={setView} options={VIEW_OPTIONS} />
      <SegPanel id="utility-view" value={view}>
        {/* The view's chunk downloads on first use: its own shape, inside the page (B-051). */}
        <Suspense
          fallback={
            <Loading label="Loading">
              <div className="fp-stack fp-stack--page">
                <SkelInstrumentPanel readouts={3} />
                <SkelPanel chart />
              </div>
            </Loading>
          }
        >
          {view === 'electric' && <ElectricalUsage />}
          {view === 'gas' && <GasUsage />}
          {view === 'water' && <WaterUsage />}
        </Suspense>
      </SegPanel>
    </Screen>
  );
});
