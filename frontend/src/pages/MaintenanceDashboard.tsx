import { useState, type FormEvent, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMaintenanceRecords,
  fetchMaintenanceAnalytics,
  createMaintenanceRecord,
  updateMaintenanceRecord,
  deleteMaintenanceRecord,
  uploadMaintenanceFile,
  type MaintenanceRecord,
  type MaintenanceRequest,
  type MaintenanceAnalytics,
} from '../api/maintenance';

// ════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════

const CATEGORIES = [
  'Electrical','Plumbing','HVAC','Roof','Foundation','Exterior','Interior',
  'Painting','Flooring','Appliances','Landscaping','Pest Control','Cleaning',
  'Security','Networking','Smart Home','General Repair','Inspection','Remodel',
] as const;

const AREAS = [
  'Kitchen','Living Room','Master Bedroom','Garage','Attic','Roof',
  'Backyard','Front Yard','Laundry Room','Bathrooms','Office','Hallway',
  'Whole House','Bedroom','Basement','Dining Room',
] as const;

const PRIORITIES = ['LOW','MEDIUM','HIGH','EMERGENCY'] as const;
const STATUSES = ['SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED'] as const;

const CAT_ICONS: Record<string, string> = {
  'Electrical':'⚡','Plumbing':'🔧','HVAC':'❄️','Roof':'🏠','Foundation':'🏗️',
  'Exterior':'🏡','Interior':'🛋️','Painting':'🎨','Flooring':'🪵','Appliances':'🧺',
  'Landscaping':'🌿','Pest Control':'🐜','Cleaning':'🧹','Security':'🔒',
  'Networking':'🌐','Smart Home':'🤖','General Repair':'🔨','Inspection':'🔍','Remodel':'🏗️',
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'border-sky-300/20 bg-sky-300/10 text-sky-300',
  MEDIUM: 'border-amber-300/20 bg-amber-300/10 text-amber-300',
  HIGH: 'border-orange-300/20 bg-orange-300/10 text-orange-300',
  EMERGENCY: 'border-red-400/30 bg-red-400/10 text-red-400',
};

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  IN_PROGRESS: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  COMPLETED: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  CANCELLED: 'border-appborder bg-appinset text-apptext-muted',
};

function isBusiness(name: string): boolean {
  return /(LLC|Inc|Co\.|Ltd|Services|Roofing|Plumbing|Electric|Insulation|Construction|Repair|Company)/i.test(name);
}

const STATUS_ICONS: Record<string, string> = {
  SCHEDULED: '📅',
  IN_PROGRESS: '🔧',
  COMPLETED: '✅',
  CANCELLED: '❌',
};

function formatCurrency(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ════════════════════════════════════════════════════════
// Summary Cards
// ════════════════════════════════════════════════════════

function SummaryCards({ a }: { a: MaintenanceAnalytics | undefined }) {
  const cards = [
    { label: 'Open Tasks', value: a?.openCount ?? '...', icon: '📋', accent: 'border-amber-300/30 bg-amber-300/10' },
    { label: 'Upcoming', value: a?.scheduledCount ?? '...', icon: '📅', accent: 'border-sky-300/30 bg-sky-300/10' },
    { label: 'Completed', value: a?.completedCount ?? '...', icon: '✅', accent: 'border-emerald-300/30 bg-emerald-300/10' },
    { label: 'Lifetime Cost', value: formatCurrency(a?.totalLifetimeCost ?? 0), icon: '💰', accent: 'border-amber-300/20 bg-amber-300/5' },
    { label: 'This Year', value: formatCurrency(a?.thisYearCost ?? 0), icon: '📆', accent: 'border-sky-300/20 bg-sky-300/5' },
    { label: 'Monthly Avg', value: formatCurrency(a?.averageMonthlyCost ?? 0), icon: '📊', accent: 'border-purple-300/20 bg-purple-300/5' },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-2xl border ${c.accent} p-4`}>
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-apptext-dim">
            <span>{c.icon}</span> {c.label}
          </p>
          <p className="mt-2 text-lg font-semibold text-apptext">{c.value}</p>
        </div>
      ))}
    </section>
  );
}

// ════════════════════════════════════════════════════════
// Timeline
// ════════════════════════════════════════════════════════

function Timeline({ records, onSelect }: { records: MaintenanceRecord[]; onSelect: (r: MaintenanceRecord) => void }) {
  const completed = records
    .filter((r) => r.status === 'COMPLETED' && r.completedDate)
    .sort((a, b) => new Date(b.completedDate!).getTime() - new Date(a.completedDate!).getTime());

  if (!completed.length) {
    return <div className="py-8 text-center text-sm text-apptext-muted">No completed maintenance yet.</div>;
  }

  return (
    <div className="relative ml-4">
      <div className="absolute left-4 top-0 h-full w-px bg-appborder" />
      {completed.map((r) => (
        <div key={r.id} className="relative mb-4 flex items-start gap-4 pl-10 last:mb-0 cursor-pointer group" onClick={() => onSelect(r)}>
          <div className={`absolute left-2 flex h-5 w-5 items-center justify-center rounded-full border-2 mt-0.5 ${
            r.priority === 'EMERGENCY' ? 'border-red-400 bg-red-400/20' :
            r.priority === 'HIGH' ? 'border-orange-400 bg-orange-400/20' :
            'border-emerald-400 bg-emerald-400/20'
          }`}>
            <span className="text-[10px]">{STATUS_ICONS.COMPLETED}</span>
          </div>
          <div className="flex-1 rounded-2xl border border-appborder-light bg-appinset px-4 py-3 transition-colors group-hover:border-appborder-hover group-hover:bg-appinset-strong">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-apptext">{r.title}</p>
              <span className="shrink-0 text-xs tabular-nums text-apptext-muted">{formatDate(r.completedDate)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-apptext-muted">{CAT_ICONS[r.category] || '🔨'} {r.category}</span>
              {r.cost != null && r.cost > 0 && (
                <span className="text-xs font-medium text-appaccent-text">{formatCurrency(r.cost)}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Record Card
// ════════════════════════════════════════════════════════

function RecordCard({ r, onSelect }: { r: MaintenanceRecord; onSelect: (r: MaintenanceRecord) => void }) {
  return (
    <div
      className="cursor-pointer rounded-2xl border border-appborder bg-appinset transition-all hover:border-appborder-hover hover:bg-appinset-strong"
      onClick={() => onSelect(r)}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.6fr)] lg:items-center lg:gap-3 px-4 py-3 lg:px-5 lg:py-4">
        {/* Row 1 — mobile: title/status badge + priority; lg: Title + Category */}
        <div className="flex items-center gap-3 min-w-0 lg:hidden">
          <span className="text-lg shrink-0">{STATUS_ICONS[r.status] || '📋'}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-apptext">{r.title}</p>
            </div>
            <p className="mt-0.5 text-xs text-apptext-muted">
              {CAT_ICONS[r.category] || '🔨'} {r.category}{r.area ? ` · ${r.area}` : ''}
              {r.cost != null && r.cost > 0 && (
                <span className="ml-2 font-semibold tabular-nums text-appaccent-text">{formatCurrency(r.cost)}</span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={`rounded-full border px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.1em] ${PRIORITY_COLORS[r.priority]}`}>
              {r.priority}
            </span>
            <span className={`rounded-full border px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.1em] ${STATUS_COLORS[r.status]}`}>
              {r.status.replace('_', ' ')}
            </span>
          </div>
        </div>
        {/* Row 2 — mobile: dates + people */}
        <div className="grid grid-cols-3 gap-2 text-xs lg:hidden">
          <div>
            {r.startedDate && <span className="text-apptext-soft">🔧 {formatDate(r.startedDate)}</span>}
            {r.scheduledDate && <span className="text-sky-300">📅 {formatDate(r.scheduledDate)}</span>}
            {!r.startedDate && !r.scheduledDate && <span className="text-apptext-dim">—</span>}
          </div>
          <div>
            {r.completedDate && <span className="text-emerald-300">✅ {formatDate(r.completedDate)}</span>}
          </div>
          <div className="flex items-center gap-1">
            {r.requestedBy ? <span className="rounded-full border border-appborder bg-appinset px-2 py-0.5 text-apptext-muted truncate">👤 {r.requestedBy}</span> : <span className="text-apptext-dim">—</span>}
            {r.completedBy ? <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-0.5 text-sky-300 truncate">{isBusiness(r.completedBy) ? '🏢' : '👷'} {r.completedBy}</span> : null}
          </div>
        </div>
        {/* Desktop: original 5-column layout */}
        <div className="hidden lg:flex items-center gap-3 min-w-0">
          <span className="text-lg shrink-0">{STATUS_ICONS[r.status] || '📋'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-apptext">{r.title}</p>
              <span className={`shrink-0 rounded-full border px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.1em] ${STATUS_COLORS[r.status]}`}>
                {r.status.replace('_', ' ')}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-apptext-muted">
              {CAT_ICONS[r.category] || '🔨'} {r.category}{r.area ? ` · ${r.area}` : ''}
              {r.cost != null && r.cost > 0 && (
                <span className="ml-2 font-semibold tabular-nums text-appaccent-text">{formatCurrency(r.cost)}</span>
              )}
            </p>
          </div>
        </div>

        {/* Dates column */}
        <div className="hidden flex-col gap-0.5 text-[12px] lg:flex">
          {r.startedDate ? (
            <span className="text-apptext-soft">🔧 {formatDate(r.startedDate)}</span>
          ) : r.scheduledDate ? (
            <span className="text-sky-300">📅 {formatDate(r.scheduledDate)}</span>
          ) : (
            <span className="text-apptext-dim">—</span>
          )}
          {r.completedDate ? (
            <span className="text-emerald-300">✅ {formatDate(r.completedDate)}</span>
          ) : (
            <span className="text-apptext-dim">—</span>
          )}
        </div>

        {/* Requested by */}
        <div className="hidden text-[12px] truncate lg:block">
          {r.requestedBy ? (
            <span className="rounded-full border border-appborder bg-appinset px-2 py-0.5 text-apptext-muted">👤 {r.requestedBy}</span>
          ) : (
            <span className="text-apptext-dim">—</span>
          )}
        </div>

        {/* Completed by */}
        <div className="hidden text-[12px] truncate lg:block">
          {r.completedBy ? (
            <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-0.5 text-sky-300">{isBusiness(r.completedBy) ? '🏢' : '👷'} {r.completedBy}</span>
          ) : (
            <span className="text-apptext-dim">—</span>
          )}
        </div>

        {/* Priority */}
        <div className="hidden text-right lg:block">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${PRIORITY_COLORS[r.priority]}`}>
            {r.priority}
          </span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Detail Modal
// ════════════════════════════════════════════════════════

function DetailModal({ r, onClose, onEdit }: {
  r: MaintenanceRecord;
  onClose: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const del = useMutation({
    mutationFn: (id: number) => deleteMaintenanceRecord(id),
  });

  const photos = [
    ...(r.photosBefore ? JSON.parse(r.photosBefore || '[]') as string[] : []),
    ...(r.photosDuring ? JSON.parse(r.photosDuring || '[]') as string[] : []),
    ...(r.photosAfter ? JSON.parse(r.photosAfter || '[]') as string[] : []),
  ];
  const docs = r.documents ? JSON.parse(r.documents || '[]') as string[] : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-[5vh] overflow-y-auto" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-[32px] border border-appborder bg-appsurface p-6 shadow-[0_20px_60px_var(--appshadow-lg)] sm:p-8" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`rounded-full border px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.1em] ${PRIORITY_COLORS[r.priority]}`}>{r.priority}</span>
              <span className={`rounded-full border px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.1em] ${STATUS_COLORS[r.status]}`}>{r.status.replace('_',' ')}</span>
            </div>
            <h2 className="text-xl font-semibold text-apptext">{r.title}</h2>
            <p className="mt-1 text-sm text-apptext-muted">{CAT_ICONS[r.category] || '🔨'} {r.category}{r.area ? ` · ${r.area}` : ''}</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-appborder text-apptext-muted hover:bg-appinset">✕</button>
        </div>

        {/* Description */}
        {r.description && <p className="mb-4 text-sm leading-6 text-apptext-soft">{r.description}</p>}

        {/* Dates */}
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-appborder bg-appinset p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Scheduled</p>
            <p className="mt-1 text-sm font-medium text-apptext-soft">{formatDate(r.scheduledDate)}</p>
          </div>
          <div className="rounded-xl border border-appborder bg-appinset p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Started</p>
            <p className="mt-1 text-sm font-medium text-apptext-soft">{formatDate(r.startedDate)}</p>
          </div>
          <div className="rounded-xl border border-appborder bg-appinset p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Completed</p>
            <p className="mt-1 text-sm font-medium text-apptext-soft">{formatDate(r.completedDate)}</p>
          </div>
        </div>

        {/* People */}
        {(r.requestedBy || r.completedBy) && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            {r.requestedBy && (
              <div className="rounded-xl border border-appborder bg-appinset p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Requested By</p>
                <p className="mt-1 text-sm font-medium text-apptext-soft">{r.requestedBy}</p>
              </div>
            )}
            {r.completedBy && (
              <div className="rounded-xl border border-appborder bg-appinset p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Completed By</p>
                <p className="mt-1 text-sm font-medium text-apptext-soft">{r.completedBy}</p>
              </div>
            )}
          </div>
        )}

        {/* Cost */}
        {r.cost != null && r.cost > 0 && (
          <div className="mb-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4">
            <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-muted">Cost</p>
            <p className="mt-1 text-lg font-semibold text-amber-200">{formatCurrency(r.cost)}</p>
          </div>
        )}

        {/* Contractor */}
        {(r.contractorName || r.company || r.receiptNumber) && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {r.contractorName && (
              <div className="rounded-xl border border-appborder bg-appinset p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Contractor</p>
                <p className="mt-1 text-sm font-medium text-apptext-soft">{r.contractorName}</p>
              </div>
            )}
            {r.company && (
              <div className="rounded-xl border border-appborder bg-appinset p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Company</p>
                <p className="mt-1 text-sm font-medium text-apptext-soft">{r.company}</p>
              </div>
            )}
            {r.receiptNumber && (
              <div className="rounded-xl border border-appborder bg-appinset p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Receipt</p>
                <p className="mt-1 text-sm font-medium font-mono text-apptext-soft">{r.receiptNumber}</p>
              </div>
            )}
          </div>
        )}

        {r.warrantyExpiration && (
          <div className="mb-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-muted">Warranty Expires</p>
            <p className="mt-1 text-sm font-medium text-amber-200">{formatDate(r.warrantyExpiration)}</p>
          </div>
        )}

        {/* Photos */}
        {photos.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-dim">Photos ({photos.length})</p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {photos.map((url, i) => (
                <img key={i} src={url} alt={`Photo ${i + 1}`} className="h-28 w-28 shrink-0 rounded-xl border border-appborder object-cover" />
              ))}
            </div>
          </div>
        )}

        {/* Documents */}
        {docs.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-dim">Documents ({docs.length})</p>
            <div className="space-y-1">
              {docs.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-appborder bg-appinset px-3 py-2 text-sm text-appaccent-text hover:bg-appinset-strong">
                  📄 {url.split('/').pop()}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {r.notes && (
          <div className="mb-4 rounded-xl border border-appborder bg-appinset p-4">
            <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Notes</p>
            <p className="text-sm leading-6 text-apptext-soft whitespace-pre-wrap">{r.notes}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2 border-t border-appborder">
          <button onClick={onEdit} className="flex-1 rounded-2xl border border-appaccent-border bg-appaccent-soft px-4 py-3 text-sm font-semibold text-appaccent-text hover:bg-appaccent-soft/80">✏️ Edit</button>
          <button
            onClick={() => { if (confirm('Delete this record?')) { del.mutate(r.id); onClose(); } }}
            className="rounded-2xl border border-appdanger/30 bg-appdanger/10 px-4 py-3 text-sm font-semibold text-appdanger hover:bg-appdanger/20"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Add/Edit Modal
// ════════════════════════════════════════════════════════

function FormModal({ editing, onClose, onSuccess }: {
  editing: MaintenanceRecord | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState(editing?.title || '');
  const [description, setDescription] = useState(editing?.description || '');
  const [category, setCategory] = useState(editing?.category || 'General Repair');
  const [customCat, setCustomCat] = useState('');
  const [area, setArea] = useState(editing?.area || '');
  const [customArea, setCustomArea] = useState('');
  const [priority, setPriority] = useState(editing?.priority || 'MEDIUM');
  const [status, setStatus] = useState<string>(editing?.status || 'SCHEDULED');
  const [scheduledDate, setScheduledDate] = useState(editing?.scheduledDate || '');
  const [startedDate, setStartedDate] = useState(editing?.startedDate || '');
  const [completedDate, setCompletedDate] = useState(editing?.completedDate || '');
  const [cost, setCost] = useState(editing?.cost?.toString() || '');
  const [requestedBy, setRequestedBy] = useState(editing?.requestedBy || '');
  const [completedBy, setCompletedBy] = useState(editing?.completedBy || '');
  const [contractorName, setContractorName] = useState(editing?.contractorName || '');
  const [company, setCompany] = useState(editing?.company || '');
  const [receiptNumber, setReceiptNumber] = useState(editing?.receiptNumber || '');
  const [warrantyExpiration, setWarrantyExpiration] = useState(editing?.warrantyExpiration || '');
  const [notes, setNotes] = useState(editing?.notes || '');
  const [photos, setPhotos] = useState<string[]>(() => {
    const all: string[] = [];
    if (editing?.photosBefore) all.push(...JSON.parse(editing.photosBefore));
    if (editing?.photosDuring) all.push(...JSON.parse(editing.photosDuring));
    if (editing?.photosAfter) all.push(...JSON.parse(editing.photosAfter));
    return all;
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const createMut = useMutation({
    mutationFn: createMaintenanceRecord,
    onSuccess: () => { onSuccess(); onClose(); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, req }: { id: number; req: MaintenanceRequest }) => updateMaintenanceRecord(id, req),
    onSuccess: () => { onSuccess(); onClose(); },
  });
  const saving = createMut.isPending || updateMut.isPending;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadMaintenanceFile(file);
      setPhotos((p) => [...p, url]);
    } catch {} finally { setUploading(false); }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const cat = customCat.trim() || category;
    const ar = customArea.trim() || area;
    const req: MaintenanceRequest = {
      title: title.trim(), description: description.trim() || undefined,
      category: cat, area: ar || undefined,
      priority, status,
      scheduledDate: scheduledDate || undefined,
      startedDate: startedDate || undefined,
      completedDate: completedDate || undefined,
      cost: cost ? parseFloat(cost) : undefined,
      requestedBy: requestedBy.trim() || undefined,
      completedBy: completedBy.trim() || undefined,
      contractorName: contractorName.trim() || undefined,
      company: company.trim() || undefined,
      receiptNumber: receiptNumber.trim() || undefined,
      warrantyExpiration: warrantyExpiration || undefined,
      photosAfter: photos.length > 0 ? JSON.stringify(photos) : undefined,
      notes: notes.trim() || undefined,
    };
    if (editing) {
      updateMut.mutate({ id: editing.id, req });
    } else {
      createMut.mutate(req);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-[3vh] overflow-y-auto" onClick={onClose}>
      <div className="my-4 w-full max-w-xl rounded-[32px] border border-appborder bg-appsurface p-6 shadow-[0_20px_60px_var(--appshadow-lg)] sm:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-apptext">{editing ? 'Edit Record' : 'Add Maintenance'}</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full border border-appborder text-apptext-muted hover:bg-appinset">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Water Heater Replacement"
              className="w-full rounded-xl border border-appborder bg-appinset px-4 py-3 text-sm text-apptext placeholder:text-apptext-dim focus:border-appaccent focus:outline-none" />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What was done..."
              className="w-full rounded-xl border border-appborder bg-appinset px-4 py-3 text-sm text-apptext placeholder:text-apptext-dim focus:border-appaccent focus:outline-none resize-none" />
          </div>

          {/* Category + Area */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft focus:border-appaccent focus:outline-none">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={customCat} onChange={(e) => setCustomCat(e.target.value)} placeholder="Or custom..."
                className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2 text-xs text-apptext placeholder:text-apptext-dim focus:border-appaccent focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Area</label>
              <select value={area} onChange={(e) => setArea(e.target.value)}
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft focus:border-appaccent focus:outline-none">
                <option value="">Any</option>
                {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input value={customArea} onChange={(e) => setCustomArea(e.target.value)} placeholder="Or custom..."
                className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2 text-xs text-apptext placeholder:text-apptext-dim focus:border-appaccent focus:outline-none" />
            </div>
          </div>

          {/* Priority + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Priority</label>
              <div className="flex gap-1.5">
                {PRIORITIES.map((p) => (
                  <button key={p} type="button" onClick={() => setPriority(p)}
                    className={`flex-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-all ${priority === p ? `${PRIORITY_COLORS[p]} border-current` : 'border-appborder text-apptext-dim'}`}>{p}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft focus:border-appaccent focus:outline-none">
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Scheduled</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft focus:border-appaccent focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Started</label>
              <input type="date" value={startedDate} onChange={(e) => setStartedDate(e.target.value)}
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft focus:border-appaccent focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Completed</label>
              <input type="date" value={completedDate} onChange={(e) => setCompletedDate(e.target.value)}
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft focus:border-appaccent focus:outline-none" />
            </div>
          </div>

          {/* People + Cost */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Requested By</label>
              <input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="Name"
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft placeholder:text-apptext-dim focus:border-appaccent focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Completed By</label>
              <input value={completedBy} onChange={(e) => setCompletedBy(e.target.value)} placeholder="Name"
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft placeholder:text-apptext-dim focus:border-appaccent focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Cost</label>
              <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$0.00"
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft placeholder:text-apptext-dim focus:border-appaccent focus:outline-none" />
            </div>
          </div>

          {/* Contractor */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Contractor</label>
              <input value={contractorName} onChange={(e) => setContractorName(e.target.value)} placeholder="Name"
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft placeholder:text-apptext-dim focus:border-appaccent focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Company</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company"
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft placeholder:text-apptext-dim focus:border-appaccent focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Receipt #</label>
              <input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} placeholder="R-2026-..."
                className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft placeholder:text-apptext-dim focus:border-appaccent focus:outline-none" />
            </div>
          </div>

          {/* Warranty */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Warranty Expiration</label>
            <input type="date" value={warrantyExpiration} onChange={(e) => setWarrantyExpiration(e.target.value)}
              className="w-full rounded-xl border border-appborder bg-appinset px-3 py-3 text-sm text-apptext-soft focus:border-appaccent focus:outline-none sm:w-1/2" />
          </div>

          {/* Photos */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Photos</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {photos.map((url, i) => (
                <div key={i} className="relative h-20 w-20 shrink-0 rounded-xl border border-appborder overflow-hidden">
                  <img src={url} alt={`Upload ${i + 1}`} className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-appborder text-2xl text-apptext-muted hover:border-appborder-hover hover:text-apptext-soft transition-colors">
                {uploading ? '⏳' : '+'}
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-muted">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="Details, observations, recommendations..."
              className="w-full rounded-xl border border-appborder bg-appinset px-4 py-3 text-sm text-apptext placeholder:text-apptext-dim focus:border-appaccent focus:outline-none resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-2xl border border-appborder bg-appinset px-4 py-3 text-sm font-semibold text-apptext-soft hover:bg-appinset-strong">Cancel</button>
            <button type="submit" disabled={saving || !title.trim()}
              className="flex-1 rounded-2xl bg-appaccent px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_var(--appaccent-soft)] hover:brightness-110 disabled:opacity-50">
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Main Page
// ════════════════════════════════════════════════════════

export default function MaintenanceDashboard() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MaintenanceRecord | null>(null);
  const [editing, setEditing] = useState<MaintenanceRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<'cards' | 'timeline'>('cards');
  const [filters, setFilters] = useState<{ category: string; status: string; priority: string; search: string }>({
    category: '', status: '', priority: '', search: '',
  });

  const records = useQuery({
    queryKey: ['maintenance-records', filters],
    queryFn: () => fetchMaintenanceRecords({
      category: filters.category || undefined,
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      search: filters.search || undefined,
      limit: 100,
    }),
  });

  const analytics = useQuery({
    queryKey: ['maintenance-analytics'],
    queryFn: fetchMaintenanceAnalytics,
  });

  const data = records.data ?? [];

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Header */}
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Home Maintenance
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Digital service history for your home.
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Every repair, replacement, inspection, and upgrade — tracked, searchable, and permanent.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-appaccent px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_var(--appaccent-soft)] hover:brightness-110 active:scale-[0.98]"
          >
            + Add Maintenance
          </button>
        </div>
      </section>

      {/* Summary */}
      <SummaryCards a={analytics.data} />

      {/* Filters */}
      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-1 rounded-full border border-appborder bg-appinset p-0.5 mr-2">
            {(['cards','timeline'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold capitalize transition-all ${
                  view === v ? 'bg-appaccent-soft text-appaccent-text' : 'text-apptext-muted'}`}>
                {v === 'cards' ? '📇 Cards' : '⏳ Timeline'}
              </button>
            ))}
          </div>

          {/* Category filter */}
          <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
            className="rounded-full border border-appborder bg-appinset px-3 py-1.5 text-xs text-apptext-soft focus:outline-none">
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Status filter */}
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="rounded-full border border-appborder bg-appinset px-3 py-1.5 text-xs text-apptext-soft focus:outline-none">
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
          </select>

          {/* Priority filter */}
          <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
            className="rounded-full border border-appborder bg-appinset px-3 py-1.5 text-xs text-apptext-soft focus:outline-none">
            <option value="">All Priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          {/* Search */}
          <input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search..." type="text"
            className="rounded-full border border-appborder bg-appinset px-4 py-1.5 text-xs text-apptext placeholder:text-apptext-dim focus:border-appaccent focus:outline-none min-w-[12rem] flex-1 sm:flex-none" />
        </div>
      </section>

      {/* Content */}
      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        {records.isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[1,2,3].map((i) => <div key={i} className="h-16 rounded-2xl bg-appinset" />)}
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <span className="text-4xl">🔨</span>
            <p className="text-sm text-apptext-muted">No maintenance records yet. Start tracking your home's history.</p>
            <button onClick={() => setAdding(true)}
              className="rounded-2xl bg-appaccent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">
              + Add First Record
            </button>
          </div>
        ) : view === 'timeline' ? (
          <Timeline records={data} onSelect={setSelected} />
        ) : (
          <div className="max-h-[40rem] overflow-y-auto pr-1">
            {/* Column headers */}
            <div className="mb-2 grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.6fr)] items-center gap-3 px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-apptext-dim">
              <span>Job</span>
              <span>Dates</span>
              <span>Requested</span>
              <span>Completed</span>
              <span className="text-right">Priority</span>
            </div>
            <div className="space-y-2">
              {data.map((r) => <RecordCard key={r.id} r={r} onSelect={setSelected} />)}
            </div>
          </div>
        )}
      </section>

      {/* Detail modal */}
      {selected && (
        <DetailModal r={selected} onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null); }}
          onDelete={() => { queryClient.invalidateQueries({ queryKey: ['maintenance-records'] }); queryClient.invalidateQueries({ queryKey: ['maintenance-analytics'] }); }} />
      )}

      {/* Add / Edit modal */}
      {(adding || editing) && (
        <FormModal editing={editing} onClose={() => { setAdding(false); setEditing(null); }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['maintenance-records'] });
            queryClient.invalidateQueries({ queryKey: ['maintenance-analytics'] });
          }} />
      )}
    </div>
  );
}
