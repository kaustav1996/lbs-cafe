import type { Diet } from '../data/types';

/** The FSSAI veg / non-veg symbols every Indian menu uses. Unknown keeps the slot empty. */
export function DietMark({ diet }: { diet: Diet }) {
  if (diet === 'unknown') return <span className="diet diet-unknown" aria-hidden="true" />;
  const veg = diet === 'veg';
  return (
    <span className={`diet ${veg ? 'diet-veg' : 'diet-nonveg'}`} role="img" aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect x="1" y="1" width="14" height="14" rx="2" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
        {veg ? <circle cx="8" cy="8" r="3.6" fill="currentColor" /> : <path d="M8 4.2 L12 11.2 H4 Z" fill="currentColor" />}
      </svg>
    </span>
  );
}
