import type { CardKind } from './engine';
import { LABEL } from './engine';

/** How each card looks: an icon, its name, and a colour band. Ingredients are warm; the rest are tricks. */
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
  jugaad: 'Brew with 3 (2 actions)',
  chor: 'Steal a card',
  monsoon: 'All pass 2 left',
  masala: 'Any one ingredient',
};
const BAND: Record<CardKind, string> = {
  espresso: '#6b3e26',
  milk: '#f3f5f4',
  gur: '#b5651d',
  elaichi: '#7cb342',
  seeds: 'var(--lime)',
  bandit: '#ffd84d',
  chappal: 'var(--cyan)',
  newspaper: '#cfd8dc',
  jugaad: '#ff9f1c',
  chor: '#ff5fa2',
  monsoon: '#4fc3f7',
  masala: '#e040fb',
};

export function CardFace({ kind, selected, onClick, small }: { kind: CardKind; selected?: boolean; onClick?: () => void; small?: boolean }) {
  const body = (
    <>
      <span className="bb-card-icon" aria-hidden="true">
        {ICON[kind]}
      </span>
      <span className="bb-card-name">{LABEL[kind]}</span>
      {!small && <span className="bb-card-tip">{TIP[kind]}</span>}
    </>
  );
  const style = { '--band': BAND[kind] } as React.CSSProperties;
  return onClick ? (
    <button type="button" className={`bb-card ${small ? 'is-small' : ''} ${selected ? 'is-selected' : ''}`} style={style} onClick={onClick} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <span className={`bb-card ${small ? 'is-small' : ''}`} style={style}>
      {body}
    </span>
  );
}
