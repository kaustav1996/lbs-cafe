import { useState, type ReactNode } from 'react';
import { asset } from '../state/ui';
import { useMusic } from '../state/music';

/**
 * LB's music gear, drawn in the ticket style: black ink lines (2px at their drawn size), lime and cyan accents.
 * Each one marks a part of the site: turntable = menu, cassette = your order and bill, Walkman = LB's card,
 * boombox = booking. They're decorative (aria-hidden); the text next to them carries the meaning.
 * Once there's music (Admin, Settings, Music), each one is also a play/pause button for it, and its reels or
 * record turn while it plays.
 */
type GearProps = { className?: string; size?: number };

function Svg({ w, h, size, className = '', children }: { w: number; h: number; size?: number; className?: string; children: ReactNode }) {
  const music = useMusic();
  const svg = (
    <svg
      className={music.available ? 'gear-svg' : `gear ${className}`}
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={size ? (size * h) / w : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
  if (!music.available) return svg;
  return (
    <button
      type="button"
      className={`gear gear-btn ${music.playing ? 'is-playing' : ''} ${className}`}
      onClick={music.toggle}
      aria-pressed={music.playing}
      aria-label={music.playing ? 'Pause the music' : 'Play LB’s set'}
      title={music.playing ? 'Pause the music' : 'Play LB’s set'}
    >
      {svg}
    </button>
  );
}

const LIME = 'var(--lime)';
const CYAN = 'var(--cyan)';
const INK = 'var(--ink)';
const PAPER = 'var(--paper)';

/** Small tape reel with six spokes. */
function Reel({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const spokes = [0, 60, 120, 180, 240, 300].map(a => {
    const rad = (a * Math.PI) / 180;
    return (
      <line
        key={a}
        x1={cx + Math.cos(rad) * r * 0.35}
        y1={cy + Math.sin(rad) * r * 0.35}
        x2={cx + Math.cos(rad) * r * 0.8}
        y2={cy + Math.sin(rad) * r * 0.8}
        strokeWidth="2"
      />
    );
  });
  return (
    <g className="reel">
      <circle cx={cx} cy={cy} r={r} fill={PAPER} />
      {spokes}
    </g>
  );
}

export function Turntable({ className, size }: GearProps) {
  return (
    <Svg w={160} h={120} size={size} className={className}>
      <rect x="6" y="12" width="148" height="94" rx="10" fill={PAPER} />
      <line x1="16" y1="106" x2="16" y2="113" />
      <line x1="144" y1="106" x2="144" y2="113" />
      <circle cx="62" cy="59" r="40" fill={PAPER} />
      <g className="reel reel-slow">
        <circle cx="62" cy="59" r="35" fill={INK} stroke="none" />
        <circle cx="62" cy="59" r="27" stroke={PAPER} strokeOpacity="0.35" strokeWidth="1.5" />
        <circle cx="62" cy="59" r="20" stroke={PAPER} strokeOpacity="0.35" strokeWidth="1.5" />
        <circle cx="62" cy="59" r="12" fill={LIME} stroke="none" />
        <path d="M62 49 A10 10 0 0 1 72 59" stroke={INK} strokeWidth="2" />
        <circle cx="62" cy="59" r="2.5" fill={INK} stroke="none" />
      </g>
      <circle cx="128" cy="30" r="8" fill={CYAN} />
      <path d="M128 30 L134 66 L108 84" strokeWidth="4" />
      <rect x="100" y="80" width="14" height="9" rx="2" transform="rotate(-32 107 84)" fill={INK} />
      <circle cx="122" cy="94" r="4" fill={LIME} />
      <circle cx="138" cy="94" r="4" />
    </Svg>
  );
}

export function Cassette({ className, size }: GearProps) {
  return (
    <Svg w={160} h={104} size={size} className={className}>
      <rect x="5" y="5" width="150" height="94" rx="9" fill={PAPER} />
      <rect x="17" y="15" width="126" height="44" rx="5" fill={LIME} />
      <rect x="44" y="27" width="72" height="22" rx="11" fill={PAPER} />
      <Reel cx={60} cy={38} r={8} />
      <Reel cx={100} cy={38} r={8} />
      <path d="M68 44 H92" strokeWidth="2" />
      <path d="M30 99 L40 73 H120 L130 99" />
      <circle cx="58" cy="86" r="3" fill={INK} stroke="none" />
      <circle cx="102" cy="86" r="3" fill={INK} stroke="none" />
      <circle cx="13" cy="12" r="1.5" fill={INK} stroke="none" />
      <circle cx="147" cy="12" r="1.5" fill={INK} stroke="none" />
    </Svg>
  );
}

export function Walkman({ className, size }: GearProps) {
  return (
    <Svg w={150} h={150} size={size} className={className}>
      <path d="M22 66 C22 18 128 18 128 66" strokeWidth="5" />
      <rect x="10" y="60" width="22" height="34" rx="9" fill={CYAN} />
      <rect x="118" y="60" width="22" height="34" rx="9" fill={CYAN} />
      <rect x="42" y="38" width="66" height="106" rx="9" fill={PAPER} />
      <rect x="42" y="38" width="66" height="14" rx="7" fill={LIME} />
      <rect x="51" y="62" width="48" height="34" rx="5" fill={PAPER} />
      <Reel cx={64} cy={79} r={7} />
      <Reel cx={86} cy={79} r={7} />
      <rect x="51" y="106" width="10" height="8" rx="2" fill={INK} stroke="none" />
      <rect x="65" y="106" width="10" height="8" rx="2" fill={INK} stroke="none" />
      <rect x="79" y="106" width="10" height="8" rx="2" fill={INK} stroke="none" />
      <rect x="51" y="122" width="48" height="10" rx="5" />
      <path d="M32 80 C38 80 38 70 42 70" strokeWidth="2" />
    </Svg>
  );
}

export function Boombox({ className, size }: GearProps) {
  return (
    <Svg w={180} h={116} size={size} className={className}>
      <path d="M150 26 L168 6" strokeWidth="2.5" />
      <path d="M52 26 V12 H128 V26" />
      <rect x="6" y="26" width="168" height="84" rx="12" fill={PAPER} />
      <circle cx="44" cy="70" r="26" fill={PAPER} />
      <circle cx="44" cy="70" r="11" fill={LIME} />
      <circle cx="136" cy="70" r="26" fill={PAPER} />
      <circle cx="136" cy="70" r="11" fill={LIME} />
      <rect x="72" y="48" width="36" height="26" rx="4" fill={PAPER} />
      <Reel cx={82} cy={61} r={5} />
      <Reel cx={98} cy={61} r={5} />
      <rect x="72" y="84" width="8" height="8" rx="2" fill={CYAN} />
      <rect x="86" y="84" width="8" height="8" rx="2" fill={INK} stroke="none" />
      <rect x="100" y="84" width="8" height="8" rx="2" fill={INK} stroke="none" />
      <line x1="18" y1="36" x2="40" y2="36" strokeWidth="2" />
      <line x1="140" y1="36" x2="162" y2="36" strokeWidth="2" />
    </Svg>
  );
}

/**
 * The record player in the home hero: a rounded deck tilted in 3D, a spinning record and a tonearm that swings
 * onto the record when you switch it on. With music uploaded, On plays LB's set and Off pauses it (browsers only
 * play sound after a tap, so it starts off). Without music it just spins while the page is open, and starts
 * switched off for people who ask for reduced motion.
 */
export function Deck() {
  const music = useMusic();
  const [spin, setSpin] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const on = music.available ? music.playing : spin;
  const setOn = () => (music.available ? music.toggle() : setSpin(v => !v));
  const [fast, setFast] = useState(false);
  return (
    <div className={`deck ${on ? 'deck-on' : ''} ${fast ? 'deck-45' : ''}`}>
      <div className="deck-body">
        <button type="button" className="deck-speed" onClick={() => setFast(f => !f)} aria-label={`Speed ${fast ? 45 : 33} rpm. Switch to ${fast ? 33 : 45}.`}>
          {fast ? 45 : 33}
        </button>
        <div className="deck-platter" aria-hidden="true">
          <div className="deck-record">
            <div className="deck-label">
              <img src={asset('img/bandit-256.webp')} alt="" width="256" height="197" />
            </div>
          </div>
          <div className="deck-sheen" />
        </div>
        <div className="deck-arm" aria-hidden="true">
          <span className="deck-weight" />
          <span className="deck-pivot" />
          <span className="deck-rod" />
          <span className="deck-head" />
        </div>
        <button type="button" className="deck-power" aria-pressed={on} onClick={setOn}>
          <span className="deck-led" aria-hidden="true" />
          <span className="deck-switch" aria-hidden="true">
            <span />
          </span>
          <span className="deck-power-text">
            <span className={on ? '' : 'is-on'}>Off</span> <span className={on ? 'is-on' : ''}>On</span>
          </span>
          <span className="sr-only">{music.available ? 'Play LB’s set' : 'Record player'}</span>
        </button>
      </div>
    </div>
  );
}

/** A small spinning record for loading states. */
export function Spinner({ children }: { children: ReactNode }) {
  return (
    <p className="spinner" role="status">
      <span className="spinner-disc" aria-hidden="true" />
      {children}
    </p>
  );
}
