/** Pulsing green dot — indicates a user is currently online. */
export default function OnlineDot({ className = '' }: { className?: string }) {
  return (
    <span className={`relative flex h-3 w-3 ${className}`}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-appaccent opacity-75" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-appaccent shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
    </span>
  );
}
