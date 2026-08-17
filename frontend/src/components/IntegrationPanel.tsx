import { useQuery } from '@tanstack/react-query';
import { fetchIntegrations } from '../api/energy';
import { jitteredInterval } from '../hooks/useJitteredInterval';

export default function IntegrationPanel() {
  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: fetchIntegrations,
    staleTime: 120_000,
    refetchInterval: jitteredInterval(120_000),
    refetchIntervalInBackground: false,
  });

  const adapter = integrations.data?.[0];

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
            Integration
          </p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">
            CoServ Sync Pipeline
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              adapter?.healthy === 'true'
                ? 'bg-appsuccess shadow-[0_0_18px_var(--appsuccess)]'
                : 'bg-apptext-dim'
            }`}
          />
          <span className="text-xs text-apptext-muted">
            {adapter?.healthy === 'true' ? 'Connected' : 'Standby'}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-300/35 bg-cyan-300/18 p-4">
        <p className="text-sm leading-6 text-apptext-soft">
          Sync pulls daily usage from CoServ SmartHub through Green Button Download and writes it directly into PostgreSQL.
        </p>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
          Run From Project Root
        </p>
        <div className="rounded-2xl border border-appborder bg-appinset-strong p-3">
          <code className="select-all font-mono text-xs text-appaccent">
            npm run sync
          </code>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-appborder bg-appinset p-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-apptext-dim">
            Defaults
          </p>
          <p className="mt-2 text-sm text-apptext-soft">
            Pulls yesterday by default, with weekly and single-date modes available.
          </p>
        </div>
        <div className="rounded-2xl border border-appborder bg-appinset p-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-apptext-dim">
            Common Flags
          </p>
          <p className="mt-2 text-sm text-apptext-soft">
            <span className="font-mono text-xs text-apptext-soft">--date MM/DD/YYYY</span> and{' '}
            <span className="font-mono text-xs text-apptext-soft">--dry-run</span>
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-appborder pt-4">
        <p className="text-xs leading-6 text-apptext-muted">
          Credentials come from <code className="text-apptext-soft">.env</code> and stay out of git. Copy{' '}
          <code className="text-apptext-soft">.env.example</code> and add your CoServ login before the first sync.
        </p>
      </div>
    </div>
  );
}
