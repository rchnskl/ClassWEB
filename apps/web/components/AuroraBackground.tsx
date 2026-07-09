/** Animated pastel aurora blobs rendered behind all content (fixed, -z). */
export default function AuroraBackground() {
  return (
    <div className="aurora" aria-hidden>
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
    </div>
  );
}
