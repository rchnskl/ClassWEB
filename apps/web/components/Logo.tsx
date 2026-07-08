export default function Logo({ size = 40 }: { size?: number }) {
  return (
    <div
      className="brand-gradient"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        display: 'grid',
        placeItems: 'center',
        boxShadow: '0 8px 20px -8px rgba(14,124,123,0.8)',
        flexShrink: 0,
      }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l9 4.5-9 4.5-9-4.5z" />
        <path d="M21 7.5V13" />
        <path d="M6.5 9.8V15c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3V9.8" />
      </svg>
    </div>
  );
}
