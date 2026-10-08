import { useEffect, useState } from 'react';
import { readBest, saveBest } from './shared';

const FACES = ['🍋', '☕', '🍕', '🍔', '🥤', '🍟', '🎧', '📼'];
type Card = { id: number; face: string; open: boolean; done: boolean };

const deal = (): Card[] =>
  [...FACES, ...FACES]
    .map((face, i) => ({ id: i, face, open: false, done: false, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .map(({ id, face, open, done }) => ({ id, face, open, done }));

/** Memory with cassettes: flip two at a time and find the pairs in as few moves as you can. */
export default function TapeMatch() {
  const [cards, setCards] = useState<Card[]>(deal);
  const [picked, setPicked] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [best, setBest] = useState(() => readBest('match'));
  const done = cards.every(c => c.done);

  useEffect(() => {
    if (picked.length !== 2) return;
    const [a, b] = picked.map(i => cards[i]);
    const same = a.face === b.face;
    const t = setTimeout(
      () => {
        setCards(cs => cs.map((c, i) => (picked.includes(i) ? { ...c, open: same, done: same } : c)));
        setPicked([]);
      },
      same ? 250 : 750,
    );
    return () => clearTimeout(t);
  }, [picked, cards]);

  useEffect(() => {
    if (done) setBest(saveBest('match', moves, true));
  }, [done, moves]);

  const flip = (i: number) => {
    if (picked.length === 2 || cards[i].open || cards[i].done) return;
    setCards(cs => cs.map((c, j) => (j === i ? { ...c, open: true } : c)));
    const next = [...picked, i];
    setPicked(next);
    if (next.length === 2) setMoves(m => m + 1);
  };
  const restart = () => {
    setCards(deal());
    setPicked([]);
    setMoves(0);
  };

  return (
    <div className="game gmatch">
      <div className="game-scores">
        <p>
          <span>Moves</span>
          <b className="num">{moves}</b>
        </p>
        <p>
          <span>Best</span>
          <b className="num">{best || '–'}</b>
        </p>
        <button type="button" className="btn btn-line btn-sm" onClick={restart}>
          New game
        </button>
      </div>
      <div className="gmatch-board">
        {cards.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`gmatch-card ${c.open || c.done ? 'is-open' : ''} ${c.done ? 'is-done' : ''}`}
            onClick={() => flip(i)}
            aria-label={c.open || c.done ? c.face : 'Face-down tape'}
          >
            <span className="gmatch-inner">
              <span className="gmatch-back" aria-hidden="true">
                <i />
                <i />
              </span>
              <span className="gmatch-front" aria-hidden="true">
                {c.face}
              </span>
            </span>
          </button>
        ))}
        {done && (
          <div className="game-over">
            <p>All pairs in {moves} moves.</p>
            <button type="button" className="btn btn-ink" onClick={restart}>
              Play again
            </button>
          </div>
        )}
      </div>
      <p className="game-help">Tap two tapes to flip them. A pair stays face up. Find all eight pairs.</p>
    </div>
  );
}
