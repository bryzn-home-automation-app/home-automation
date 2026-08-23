import { useTheme } from '../context/ThemeContext';
import type { ChangeType, ReleaseChange } from '../api/releases';

// The app themes via CSS-variable tokens (no Tailwind `dark:` variant), so raw
// palette classes render the SAME in both themes. Light-300 shades wash out on
// the near-white light-mode card, so each status color carries an explicit
// light/dark pair chosen for contrast (the useTheme() pattern the app uses).
const CHANGE_STYLE: Record<ChangeType, { label: string; icon: string; dark: string; light: string }> = {
  new: {
    label: 'New',
    icon: '✨',
    dark: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-300',
    light: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700',
  },
  improved: {
    label: 'Improved',
    icon: '⬆️',
    dark: 'border-sky-300/25 bg-sky-300/10 text-sky-300',
    light: 'border-sky-600/30 bg-sky-600/10 text-sky-700',
  },
  fixed: {
    label: 'Fixed',
    icon: '🔧',
    dark: 'border-amber-300/25 bg-amber-300/10 text-amber-300',
    light: 'border-amber-600/30 bg-amber-600/10 text-amber-700',
  },
};

/** Theme-aware chip style; neutral fallback for any type the backend adds later. */
function changeStyle(type: ChangeType, isDark: boolean) {
  const s = CHANGE_STYLE[type];
  if (!s) return { label: type, icon: '•', className: 'border-appborder bg-appinset text-apptext-muted' };
  return { label: s.label, icon: s.icon, className: isDark ? s.dark : s.light };
}

/** The list of change line items for a release — a type chip + plain-language text. */
export default function ReleaseChangeList({ changes }: { changes: ReleaseChange[] }) {
  const { isDark } = useTheme();
  return (
    <ul className="space-y-2.5">
      {changes.map((change, i) => {
        const style = changeStyle(change.type, isDark);
        return (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-xl border border-appborder bg-appinset px-3.5 py-3 sm:flex-row sm:items-start sm:gap-3"
          >
            <span
              className={`inline-flex shrink-0 items-center gap-1 self-start rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${style.className}`}
            >
              <span aria-hidden="true">{style.icon}</span>
              {style.label}
            </span>
            <span className="min-w-0 break-words text-sm leading-6 text-apptext">{change.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
