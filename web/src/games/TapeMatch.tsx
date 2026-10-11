import { useEffect, useState } from 'react';
import { readBest, saveBest } from './shared';

const FACES = ['🍋', '☕', '🍕', '🍔', '🥤', '🍟', '🎧', '📼', '🍩', '🧁', '🎸', '🎷', '🎤', '🎹', '🍦'];
type Card = { id: number; face: string; open: boolean; done: boolean };

/** Level 1 is 8 pairs with no limit; then 10, 12 and 15 pairs, each with a move limit that tightens. */
function levelSpec(level: number) {
  const pairs = [8, 10, 12, 15][Math.min(level, 4) - 1];
  const cols = pairs >= 15 ? 5 : 4;
  const limit = level === 1 ? null : Math.max(pairs * 2, Math.round(pairs * 2.6) - Math.max(0, level - 4) * 2);
  return { pairs, cols, limit };
}

const deal = (pairs: number): Card[] => {
  const faces = FACES.slice(0, pairs);
  return [...faces, ...faces]
    .map((face, i) => ({ id: i, face, open: false, done: false, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .map(({ id, face, open, done }) => ({ id, face, open, done }));
};

/** Memory with cassettes: flip two at a time and find the pairs. Bigger boards and move limits as you level up. */
export default function TapeMatch() {
  const [level, setLevel] = useState(1);
  const spec = levelSpec(level);
  const [cards, setCards] = useState<Card[]>(() => deal(spec.pairs));
  const [picked, setPicked] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [best, setBest] = useState(() => readBest('match'));
  const [bestLevel, setBestLevel] = useState(() => Math.max(1, readBest('match-level')));
  const done = cards.every(c => c.done);
  const out = !done && spec.limit !== null && moves >= spec.limit && picked.length === 0;

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
    if (!done) return;
    // Best moves is for the first board, so it compares like with like; the best level is kept too.
    if (level === 1) setBest(saveBest('match', moves, true));
    setBestLevel(saveBest('match-level', level + 1));
  }, [done, moves, level]);

  const flip = (i: number) => {
    if (out || picked.length === 2 || cards[i].open || cards[i].done) return;
    setCards(cs => cs.map((c, j) => (j === i ? { ...c, open: true } : c)));
    const next = [...picked, i];
    setPicked(next);
    if (next.length === 2) setMoves(m => m + 1);
  };
  const play = (lv: number) => {
    setLevel(lv);
    setCards(deal(levelSpec(lv).pairs));
    setPicked([]);
    setMoves(0);
  };

  return (
    <div className="game gmatch">
      <div className="game-scores">
        <p>
          <span>Moves</span>
          <b className="num">
            {moves}
            {spec.limit !== null && <small> of {spec.limit}</small>}
          </b>
        </p>
        <p>
          <span>Level</span>
          <b className="num">{level}</b>
        </p>
        <p>
          <span>Best</span>
          <b className="num">{best || '–'}</b>
        </p>
        <button type="button" className="btn btn-line btn-sm" onClick={() => play(1)}>
          New game
        </button>
      </div>
      <div className="gmatch-board" style={{ gridTemplateColumns: `repeat(${spec.cols}, 1fr)` }}>
        {cards.map((c, i) => (
          <button
            key={`${level}-${c.id}`}
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
            <p>
              Level {level} cleared in {moves} moves.
              <br />
              Next: {levelSpec(level + 1).pairs} pairs in {levelSpec(level + 1).limit} moves.
            </p>
            <button type="button" className="btn btn-ink" onClick={() => play(level + 1)}>
              Level {level + 1}
            </button>
          </div>
        )}
        {out && (
          <div className="game-over">
            <p>Out of moves on level {level}.</p>
            <button type="button" className="btn btn-ink" onClick={() => play(level)}>
              Try level {level} again
            </button>
            <button type="button" className="btn btn-line" onClick={() => play(1)}>
              Start from level 1
            </button>
          </div>
        )}
      </div>
      <p className="game-help">
        Tap two tapes to flip them; a pair stays face up. Level 1 is eight pairs. Later levels have more tapes and a move limit. Your best level is{' '}
        {bestLevel}.
      </p>
    </div>
  );
}
