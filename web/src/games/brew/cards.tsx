import type { CSSProperties } from 'react';
import { asset } from '../../state/ui';
import type { CardKind } from './engine';
import { LABEL } from './engine';
import { CardArt } from './art';

/** The Lemon Bandits logo, for the Bandit card and raided cups. */
export const BANDIT_IMG = asset('img/bandit-256.webp');

export const ICON: Record<CardKind, string> = {
  espresso: '☕',
  milk: '🥛',
  gur: '🟤',
  elaichi: '🌿',
  seeds: '🌱',
  bandit: '🍋',
  chappal: '🩴',
  newspaper: '📰',
  jugaad: '🔧',
  chor: '🦹',
  havaldar: '👮',
  kirana: '🏪',
  mandi: '📦',
  sheru: '🐕',
  monsoon: '🌧️',
  masala: '✨',
};
export const TIP: Record<CardKind, string> = {
  espresso: 'Ingredient',
  milk: 'Ingredient',
  gur: 'Ingredient',
  elaichi: 'Ingredient',
  seeds: 'Ingredient',
  bandit: 'Raid a rival’s cup',
  chappal: 'Chase off a Bandit',
  newspaper: 'Shoo a Bandit on',
  jugaad: 'Brew with any 3',
  chor: 'Steal from everyone',
  havaldar: 'Search a hand, take 2',
  kirana: 'Everyone hands over one ingredient',
  mandi: 'Top 3 of the deck: keep ingredients',
  sheru: 'Catch a Kauwa',
  monsoon: 'All pass 2 left',
  masala: 'Any one ingredient',
};
/** What a selected card does, in a line. */
export const DOES: Record<CardKind, string> = {
  espresso: 'An ingredient. Brew with one of each of the five, or offer it in a trade.',
  milk: 'An ingredient. Brew with one of each of the five, or offer it in a trade.',
  gur: 'An ingredient. Brew with one of each of the five, or offer it in a trade.',
  elaichi: 'An ingredient. Brew with one of each of the five, or offer it in a trade.',
  seeds: 'An ingredient. Brew with one of each of the five, or offer it in a trade.',
  bandit: 'Send the Bandit to raid a rival’s cup. A raided cup scores nothing until it’s chased off.',
  chappal: 'Chase a Bandit off your cup. You can also throw it the moment you’re raided.',
  newspaper: 'Shoo the Bandit on your cup onto someone else’s. Works the moment you’re raided too.',
  jugaad: 'Brew a cup with any three different ingredients. Takes two of your three actions.',
  chor: 'Steal one random card from every other player.',
  havaldar: 'Look at all of one player’s cards and take any two.',
  kirana: 'Name an ingredient: every other player hands you all of theirs.',
  mandi: 'Turn over the top three cards of the deck and keep the ingredients and Masala.',
  sheru: 'Send Sheru after a Kauwa at any stall: it flies off and you keep everything it was carrying.',
  monsoon: 'Everyone passes two random cards to the player on their left.',
  masala: 'Wild: counts as any one ingredient when you brew. Used for you automatically.',
};
const FRAME: Record<CardKind, string> = {
  espresso: '#6b3e26',
  milk: '#8fa3ad',
  gur: '#b5651d',
  elaichi: '#4f8a2b',
  seeds: '#8fb800',
  bandit: '#e6b800',
  chappal: '#00a3ad',
  newspaper: '#607d8b',
  jugaad: '#f57c00',
  chor: '#d81b60',
  havaldar: '#8d6e3a',
  kirana: '#7cb342',
  mandi: '#a1662f',
  sheru: '#6d4c41',
  monsoon: '#0288d1',
  masala: '#8e24aa',
};
const TRICK = new Set<CardKind>(['bandit', 'chappal', 'newspaper', 'jugaad', 'chor', 'havaldar', 'kirana', 'mandi', 'sheru', 'monsoon']);

function Art({ kind }: { kind: CardKind }) {
  return <CardArt kind={kind} bandit={BANDIT_IMG} className={kind === 'bandit' ? 'pc-logo' : 'pc-svg'} />;
}

/** A playing card: corner marks, a picture in the middle, its name and what it's for. */
export function PlayingCard({
  kind,
  selected,
  fresh,
  onClick,
  style,
  size = 'md',
}: {
  kind: CardKind;
  selected?: boolean;
  fresh?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  size?: 'sm' | 'md';
}) {
  const cls = `pc pc-${size} ${TRICK.has(kind) ? 'is-trick' : kind === 'masala' ? 'is-wild' : 'is-ing'} ${selected ? 'is-selected' : ''} ${fresh ? 'is-fresh' : ''}`;
  const st = { '--frame': FRAME[kind], ...style } as CSSProperties;
  const face = (
    <>
      <span className="pc-corner pc-tl" aria-hidden="true">
        <CardArt kind={kind} bandit={BANDIT_IMG} />
      </span>
      <span className="pc-art" aria-hidden="true">
        <Art kind={kind} />
      </span>
      <span className="pc-name">{LABEL[kind]}</span>
      {size === 'md' && <span className="pc-tip">{TIP[kind]}</span>}
      <span className="pc-corner pc-br" aria-hidden="true">
        <CardArt kind={kind} bandit={BANDIT_IMG} />
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={cls} style={st} onClick={onClick} aria-pressed={selected} aria-label={`${LABEL[kind]}${selected ? ', chosen' : ''}`}>
      {face}
    </button>
  ) : (
    <span className={cls} style={st}>
      {face}
    </span>
  );
}

/** The back of a card: LB's checker and the bandit. */
export function CardBack({ style, className = '' }: { style?: CSSProperties; className?: string }) {
  return (
    <span className={`pc-back ${className}`} style={style} aria-hidden="true">
      <img src={BANDIT_IMG} alt="" />
    </span>
  );
}

/** A coffee cup on the table; a raided one has the bandit sitting on it. */
export function CupMark({ points, raided, big }: { points?: number; raided: boolean; big?: boolean }) {
  return (
    <span className={`cup ${big ? 'cup-big' : ''} ${raided ? 'is-raided' : ''}`}>
      <span className="cup-body" aria-hidden="true">
        ☕
      </span>
      {raided && <img className="cup-raider" src={BANDIT_IMG} alt="" />}
      {points !== undefined && <span className="cup-pts">{points}</span>}
    </span>
  );
}
