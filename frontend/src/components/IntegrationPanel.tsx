import { useQuery } from '@tanstack/react-query';
import { fetchIntegrations } from '../api/energy';

export default function IntegrationPanel() {
  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: fetchIntegrations,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const adapter = integrations.data?.[0];

  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-900/82 p-5 shadow-[0_10px_28px_rgba(2,8,23,0.24)]">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
            Integration
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            CoServ Sync Pipeline
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              adapter?.healthy === 'true' ? 'bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.8)]' : 'bg-slate-500'
            }`}
          />
          <span className="text-xs text-slate-400">
            {adapter?.healthy === 'true' ? 'Connected' : 'Standby'}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-300/12 bg-cyan-300/8 p-4">
        <p className="text-sm leading-6 text-slate-200">
          Sync pulls daily usage from CoServ SmartHub through Green Button Download and writes it directly into PostgreSQL.
        </p>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
          Run From Project Root
        </p>
        <div className="rounded-2xl border border-white/10 bg-slate-950/65 p-3">
          <code className="select-all font-mono text-xs text-emerald-300">
          npm run sync
          </code>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            Defaults
          </p>
          <p className="mt-2 text-sm text-slate-200">
            Pulls yesterday by default, with weekly and single-date modes available.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            Common Flags
          </p>
          <p className="mt-2 text-sm text-slate-200">
            <span className="font-mono text-xs text-slate-300">--date MM/DD/YYYY</span> and <span className="font-mono text-xs text-slate-300">--dry-run</span>
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <p className="text-xs leading-6 text-slate-400">
          Credentials come from <code className="text-slate-300">.env</code> and stay out of git. Copy <code className="text-slate-300">.env.example</code> and add your CoServ login before the first sync.
        </p>
      </div>
    </div>
  );
}
