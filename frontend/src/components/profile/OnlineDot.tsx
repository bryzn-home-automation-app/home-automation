/**
 * Green "online" dot. By default it pulses (single-use, e.g. the sidebar
 * profile). In long lists pass `pulse={false}` to render a static dot — N
 * never-ending `animate-ping` rings keep the compositor continuously active.
 * The ping is also suppressed under `prefers-reduced-motion`.
 */
export default function OnlineDot({
  className = '',
  pulse = true,
}: {
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span className={`relative flex h-3 w-3 ${className}`}>
      {pulse && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
      )}
      <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
    </span>
  );
}
