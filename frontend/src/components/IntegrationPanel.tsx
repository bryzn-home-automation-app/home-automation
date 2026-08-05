import { useQuery } from '@tanstack/react-query';
import { fetchIntegrations } from '../api/energy';

export default function IntegrationPanel() {
  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: fetchIntegrations,
    refetchInterval: 60_000,
  });

  const adapter = integrations.data?.[0];

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">
          Data Sync
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              adapter?.healthy === 'true' ? 'bg-emerald-500' : 'bg-gray-500'
            }`}
          />
          <span className="text-xs text-gray-500">
            {adapter?.healthy === 'true' ? 'Connected' : 'Standby'}
          </span>
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Sync pulls energy usage data from CoServ SmartHub via Green Button
        Download and stores it in the database. Run this command from the
        project root:
      </p>

      <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 mb-4">
        <code className="text-xs text-emerald-400 font-mono select-all">
          npm run sync
        </code>
      </div>

      <p className="text-xs text-gray-600">
        Syncs yesterday's usage by default. Options:{' '}
        <code className="text-gray-500">--date MM/DD/YYYY</code>,{' '}
        <code className="text-gray-500">--dry-run</code> to preview without
        writing.
      </p>

      {/* Last sync note */}
      <div className="mt-4 pt-4 border-t border-gray-800">
        <p className="text-xs text-gray-600">
          Credentials are read from <code className="text-gray-500">.env</code>{' '}
          (gitignored). Copy <code className="text-gray-500">.env.example</code>{' '}
          and fill in your CoServ login.
        </p>
      </div>
    </div>
  );
}
