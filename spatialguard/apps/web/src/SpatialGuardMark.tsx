/** Pathlight's mark: a walking path that ends in a small light. */
export default function SpatialGuardMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="sg-brand-symbol" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5.5 26.5c6 0 6.4-7.4 10.8-7.4s4.6-6.3 8.9-8" />
      <path d="M25.6 2.9v1.8M31.4 8.6h-1.8M29.7 4.6l-1.3 1.3" />
      <circle cx="25.6" cy="10.2" r="3.1" />
      <circle cx="5.5" cy="26.5" r="1.6" />
    </svg>
  );
}
