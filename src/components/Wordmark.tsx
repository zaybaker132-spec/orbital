/** The Orbital wordmark: lowercase Outfit, "orb" bold and "ital" regular. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-brand leading-none tracking-[-0.01em] text-white ${className}`} aria-label="Orbital">
      <span className="font-bold">orb</span><span className="font-normal">ital</span>
    </span>
  );
}
