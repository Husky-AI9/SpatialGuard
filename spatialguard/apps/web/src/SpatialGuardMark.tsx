export default function SpatialGuardMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="sg-brand-symbol" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2.7 26.2 7v8.1c0 6.6-4 11.6-10.2 14.2C9.8 26.7 5.8 21.7 5.8 15.1V7Z" />
      <path d="M10.4 11.2h11.2v10.1H10.4zm5.6 0v5.2h5.6M10.4 16.4H16" />
      <circle cx="20.8" cy="20.5" r="2.15" />
    </svg>
  );
}
