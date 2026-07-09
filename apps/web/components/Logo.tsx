/**
 * Faculty of Nursing crest. Uses the official emblem from /public/logos.
 * `variant="university"` renders the Assumption University seal instead.
 */
export default function Logo({
  size = 40,
  variant = 'faculty',
}: {
  size?: number;
  variant?: 'faculty' | 'university';
}) {
  const src = variant === 'university' ? '/logos/university.png' : '/logos/faculty.png';
  const alt = variant === 'university' ? 'Assumption University' : 'Faculty of Nursing';
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.25))',
        flexShrink: 0,
      }}
    />
  );
}
