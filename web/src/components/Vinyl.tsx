import type { CSSProperties } from 'react';

/** A record drawn in CSS: grooves, a sheen, and a printed label in the category's colour. */
export function Vinyl({
  color,
  label,
  size,
  className = '',
}: {
  color: string;
  label?: string;
  size?: string;
  className?: string;
}) {
  return (
    <div
      className={`vinyl ${className}`}
      style={{ '--label': color, ...(size ? { width: size } : {}) } as CSSProperties}
      aria-hidden="true"
    >
      <div className="vinyl-sheen" />
      <div className="vinyl-label">
        {label && <span className="vinyl-title">{label}</span>}
        <span className="vinyl-hole" />
      </div>
    </div>
  );
}
