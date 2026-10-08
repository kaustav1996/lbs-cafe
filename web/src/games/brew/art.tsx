import type { ReactNode } from 'react';
import type { CardKind } from './engine';

/**
 * Card illustrations, drawn for LB's: flat shapes, 3px ink outlines, warm coffee colours with lime and cyan.
 * Each is a 100x100 SVG. The Bandit uses the real Lemon Bandits logo (passed in as `bandit`).
 */
const INK = '#0b0b0b';
const LIME = '#d0ff00';
const CYAN = '#00bcc8';
const PAPER = '#ffffff';
const S = { stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

const ART: Record<Exclude<CardKind, 'bandit'>, ReactNode> = {
  espresso: (
    <>
      <path d="M38 22c-4 5 4 8 0 13M50 18c-4 6 4 9 0 15M62 22c-4 5 4 8 0 13" fill="none" stroke="#9e9e9e" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="50" cy="80" rx="34" ry="8" fill="#e8e2d6" {...S} />
      <path d="M26 44h48l-5 28a8 8 0 0 1-8 7H39a8 8 0 0 1-8-7z" fill={PAPER} {...S} />
      <path d="M74 50h4a8 8 0 0 1 0 16h-6" fill="none" {...S} />
      <ellipse cx="50" cy="44" rx="24" ry="6" fill="#6b3e26" {...S} />
      <ellipse cx="46" cy="43" rx="10" ry="2.5" fill="#c58b5b" />
    </>
  ),
  milk: (
    <>
      <path d="M40 10h20v12l8 12v52a6 6 0 0 1-6 6H38a6 6 0 0 1-6-6V34l8-12z" fill={PAPER} {...S} />
      <path d="M33 46h34v26H33z" fill={LIME} stroke={INK} strokeWidth="2.5" />
      <path d="M50 66V52M50 59l-7-6M50 59l7-6M50 63l-9-2M50 63l9-2" fill="none" stroke="#2e7d32" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M38 10h24v6H38z" fill={CYAN} {...S} />
    </>
  ),
  gur: (
    <>
      <path d="M22 40l28-14 28 14v28L50 82 22 68z" fill="#b5651d" {...S} />
      <path d="M22 40l28 14 28-14M50 54v28" fill="none" {...S} />
      <path d="M30 42l20 10 20-10" fill="none" stroke="#e0a060" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="35" cy="62" r="2" fill="#7a3f0f" />
      <circle cx="62" cy="66" r="2" fill="#7a3f0f" />
      <circle cx="58" cy="58" r="1.6" fill="#7a3f0f" />
    </>
  ),
  elaichi: (
    <>
      {[
        [34, 60, -35],
        [56, 46, 20],
        [62, 70, -10],
      ].map(([x, y, r], i) => (
        <g key={i} transform={`rotate(${r} ${x} ${y})`}>
          <ellipse cx={x} cy={y} rx="11" ry="20" fill="#7cb342" {...S} />
          <path d={`M${x} ${y - 18}v36M${x - 6} ${y - 12}c-2 8-2 16 0 24M${x + 6} ${y - 12}c2 8 2 16 0 24`} fill="none" stroke="#33691e" strokeWidth="2" strokeLinecap="round" />
        </g>
      ))}
    </>
  ),
  seeds: (
    <>
      <path d="M16 54h68a34 30 0 0 1-68 0z" fill={CYAN} {...S} />
      {[28, 38, 48, 58, 68, 33, 43, 53, 63, 73].map((x, i) => (
        <ellipse key={i} cx={x} cy={i < 5 ? 50 : 44} rx="5" ry="4" fill="#cdbb8f" stroke={INK} strokeWidth="1.8" />
      ))}
      <path d="M50 38V18M50 28l-10-8M50 28l10-8M50 33l-13-3M50 33l13-3" fill="none" stroke="#2e7d32" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  masala: (
    <>
      <circle cx="50" cy="56" r="34" fill="#cfd8dc" {...S} />
      <circle cx="50" cy="56" r="10" fill="#ffca28" {...S} />
      {[
        ['#e53935', 0],
        ['#fb8c00', 72],
        ['#6d4c41', 144],
        ['#43a047', 216],
        ['#fdd835', 288],
      ].map(([c, a], i) => {
        const rad = ((a as number) * Math.PI) / 180;
        return <circle key={i} cx={50 + Math.cos(rad) * 22} cy={56 + Math.sin(rad) * 22} r="9" fill={c as string} {...S} />;
      })}
      <path d="M80 14l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill={LIME} {...S} />
      <path d="M18 12l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill={LIME} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </>
  ),
  chappal: (
    <>
      <path d="M50 12c18 0 26 18 24 40-2 24-10 38-24 38S28 76 26 52C24 30 32 12 50 12z" fill={CYAN} {...S} />
      <path d="M50 18c13 0 19 14 17 32-2 19-8 32-17 32S35 69 33 50c-2-18 4-32 17-32z" fill="#4dd0e1" stroke="none" />
      <path d="M33 42c6 6 12 8 17 8s11-2 17-8M50 50V30" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <circle cx="50" cy="29" r="4" fill={LIME} {...S} />
    </>
  ),
  newspaper: (
    <>
      <path d="M18 22h56v58H24a6 6 0 0 1-6-6z" fill={PAPER} {...S} />
      <path d="M74 32h8v42a6 6 0 0 1-6 6h-2" fill="#eceff1" {...S} />
      <path d="M26 30h40v10H26z" fill={INK} />
      <path d="M26 48h18v18H26z" fill="#b0bec5" stroke={INK} strokeWidth="2" />
      <path d="M50 50h16M50 56h16M50 62h12M26 72h40" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
    </>
  ),
  jugaad: (
    <>
      <circle cx="64" cy="64" r="18" fill="#9e9e9e" {...S} />
      <circle cx="64" cy="64" r="8" fill={PAPER} {...S} />
      <path d="M50 52l14 4" stroke="#bdbdbd" strokeWidth="12" strokeLinecap="round" />
      <path d="M22 78l36-36" stroke={INK} strokeWidth="13" strokeLinecap="round" />
      <path d="M22 78l36-36" stroke="#ff9f1c" strokeWidth="7" strokeLinecap="round" />
      <path d="M56 26a14 14 0 1 0 18 18l-8-2-4-4-2-8z" fill="#ff9f1c" {...S} />
    </>
  ),
  chor: (
    <>
      <circle cx="50" cy="56" r="30" fill="#f1c27d" {...S} />
      <path d="M18 42c10-26 54-26 64 0z" fill={INK} />
      <path d="M22 48h56v12H22z" fill={INK} rx="6" />
      <circle cx="38" cy="54" r="4.5" fill={PAPER} />
      <circle cx="62" cy="54" r="4.5" fill={PAPER} />
      <path d="M40 72c6 4 14 4 20 0" fill="none" {...S} />
      <path d="M70 80h18v12H70z" fill="#8d6e63" {...S} />
      <path d="M79 80v-6" stroke={INK} strokeWidth="3" />
    </>
  ),
  havaldar: (
    <>
      <path d="M20 46c0-18 60-18 60 0v6H20z" fill="#c8a165" {...S} />
      <path d="M14 52h72a6 6 0 0 1 0 8H14a6 6 0 0 1 0-8z" fill="#8d6e3a" {...S} />
      <path d="M44 30h12l-2 10h-8z" fill="#ffd54f" {...S} />
      <circle cx="50" cy="78" r="13" fill="#f1c27d" {...S} />
      <path d="M42 84c5-3 11-3 16 0" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path d="M78 62l-6 34" stroke="#6d4c41" strokeWidth="6" strokeLinecap="round" />
    </>
  ),
  kirana: (
    <>
      <path d="M18 44h64v42H18z" fill={PAPER} {...S} />
      <path d="M14 30h72l-4 16H18z" fill={LIME} {...S} />
      <path d="M26 30l-2 16M38 30v16M50 30v16M62 30v16M74 30l2 16" stroke={INK} strokeWidth="2.6" />
      <path d="M26 30l-2 16M50 30v16M74 30l2 16" stroke="#e53935" strokeWidth="0" />
      <path d="M26 56h20v30H26z" fill={CYAN} {...S} />
      <path d="M54 56h22v14H54z" fill="#ffe0b2" {...S} />
      <circle cx="60" cy="63" r="3" fill="#e53935" />
      <circle cx="69" cy="63" r="3" fill="#fb8c00" />
      <path d="M20 18h60v10H20z" fill={INK} />
    </>
  ),
  mandi: (
    <>
      <path d="M14 58h36v28H14z" fill="#d7a86e" {...S} />
      <path d="M50 58h36v28H50z" fill="#d7a86e" {...S} />
      <path d="M32 30h36v28H32z" fill="#d7a86e" {...S} />
      <path d="M14 72h36M50 72h36M32 44h36" stroke={INK} strokeWidth="2.4" />
      <circle cx="42" cy="26" r="6" fill="#e53935" {...S} />
      <circle cx="54" cy="24" r="6" fill="#43a047" {...S} />
      <circle cx="64" cy="27" r="5" fill="#fb8c00" {...S} />
    </>
  ),
  sheru: (
    <>
      <path d="M22 28c-8 10-8 30 4 34l8-26z" fill="#6d4c41" {...S} />
      <path d="M78 28c8 10 8 30-4 34l-8-26z" fill="#6d4c41" {...S} />
      <path d="M50 20c18 0 28 16 28 34S66 86 50 86 22 72 22 54s10-34 28-34z" fill="#c8915a" {...S} />
      <path d="M36 64c4 12 24 12 28 0" fill="#f5deb3" stroke={INK} strokeWidth="2.6" />
      <circle cx="40" cy="48" r="4" fill={INK} />
      <circle cx="60" cy="48" r="4" fill={INK} />
      <path d="M45 60h10l-5 5z" fill={INK} {...S} />
      <path d="M46 72c2 4 6 4 8 0" fill="#e57373" stroke={INK} strokeWidth="2" />
    </>
  ),
  monsoon: (
    <>
      <path d="M26 56a14 14 0 0 1 4-27 18 18 0 0 1 34-4 14 14 0 0 1 10 31z" fill="#b0bec5" {...S} />
      {[30, 44, 58, 72].map((x, i) => (
        <path key={i} d={`M${x} ${66 + (i % 2) * 4}l-4 12`} stroke={CYAN} strokeWidth="4" strokeLinecap="round" />
      ))}
      <path d="M40 24l8-6 6 8" fill="none" stroke={PAPER} strokeWidth="3" strokeLinecap="round" />
    </>
  ),
};

export function CardArt({ kind, bandit, className }: { kind: CardKind; bandit: string; className?: string }) {
  if (kind === 'bandit') return <img src={bandit} alt="" className={className} />;
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {ART[kind]}
    </svg>
  );
}

/** The Kauwa (crow) that sits at a stall. */
export function CrowArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d="M20 60c10-24 34-34 52-26l14-6-6 12c6 12-2 30-22 34L48 86l-4-12C30 76 20 70 20 60z" fill="#263238" {...S} />
      <path d="M72 34l16-2-12 10z" fill="#ffb300" {...S} />
      <circle cx="68" cy="40" r="3.4" fill={PAPER} />
      <path d="M30 60c10 2 20-2 26-10" fill="none" stroke="#546e7a" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
