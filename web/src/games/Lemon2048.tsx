import { useCallback, useRef, useState } from 'react';
import { readBest, saveBest, useSwipe, type Dir } from './shared';

const SIZE = 4;
type Board = number[];

const empty = (): Board => Array(SIZE * SIZE).fill(0);
function addTile(b: Board): Board {
  const free = b.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
  if (!free.length) return b;
  const n = [...b];
  n[free[Math.floor(Math.random() * free.length)]] = Math.random() < 0.9 ? 2 : 4;
  return n;
}
const fresh = () => addTile(addTile(empty()));

/** Slides one row toward its start; returns the row and the points scored. */
function slide(row: number[]): [number[], number] {
  const vals = row.filter(Boolean);
  const out: number[] = [];
  let pts = 0;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] === vals[i + 1]) {
      out.push(vals[i] * 2);
      pts += vals[i] * 2;
      i++;
    } else out.push(vals[i]);
  }
  while (out.length < SIZE) out.push(0);
  return [out, pts];
}
function move(b: Board, d: Dir): [Board, number, boolean] {
  const n = empty();
  let pts = 0;
  for (let k = 0; k < SIZE; k++) {
    // Cells of row/column k, in the order they slide toward.
    const idx = Array.from({ length: SIZE }, (_, j) =>
      d === 'left' ? k * SIZE + j : d === 'right' ? k * SIZE + (SIZE - 1 - j) : d === 'up' ? j * SIZE + k : (SIZE - 1 - j) * SIZE + k,
    );
    const [row, p] = slide(idx.map(i => b[i]));
    pts += p;
    idx.forEach((i, j) => (n[i] = row[j]));
  }
  return [n, pts, n.some((v, i) => v !== b[i])];
}
const stuck = (b: Board) => (['up', 'down', 'left', 'right'] as Dir[]).every(d => !move(b, d)[2]);

/** 2048 in LB's colours: swipe (or arrow keys) to slide; matching lemons merge. */
export default function Lemon2048() {
  const [board, setBoard] = useState<Board>(fresh);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => readBest('2048'));
  const [won, setWon] = useState(false);
  const [keepGoing, setKeepGoing] = useState(false);
  const [fresh1, setFresh1] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const over = stuck(board);

  const go = useCallback(
    (d: Dir) => {
      if (over || (won && !keepGoing)) return;
      const [n, pts, changed] = move(board, d);
      if (!changed) return;
      const next = addTile(n);
      setFresh1(next.findIndex((v, i) => v && !n[i]));
      setBoard(next);
      const s = score + pts;
      setScore(s);
      setBest(saveBest('2048', s));
      if (!won && next.includes(2048)) setWon(true);
    },
    [board, score, over, won, keepGoing],
  );
  useSwipe(ref, go);

  const restart = () => {
    setBoard(fresh());
    setScore(0);
    setWon(false);
    setKeepGoing(false);
  };

  return (
    <div className="game g2048">
      <div className="game-scores">
        <p>
          <span>Score</span>
          <b className="num">{score}</b>
        </p>
        <p>
          <span>Best</span>
          <b className="num">{best}</b>
        </p>
        <button type="button" className="btn btn-line btn-sm" onClick={restart}>
          New game
        </button>
      </div>
      <div className="g2048-board" ref={ref} role="grid" aria-label={`2048 board. Score ${score}. Swipe or use the arrow keys.`}>
        {board.map((v, i) => (
          <div key={i} className={`g2048-cell ${v ? `t${Math.min(v, 4096)}` : ''} ${i === fresh1 ? 'is-new' : ''}`} role="gridcell">
            {v || ''}
          </div>
        ))}
        {(over || (won && !keepGoing)) && (
          <div className="game-over">
            <p>{over ? 'No moves left.' : 'You made 2048!'}</p>
            {won && !over && (
              <button type="button" className="btn btn-line" onClick={() => setKeepGoing(true)}>
                Keep going
              </button>
            )}
            <button type="button" className="btn btn-ink" onClick={restart}>
              Play again
            </button>
          </div>
        )}
      </div>
      <p className="game-help">Swipe on the board to slide every tile. Two of the same merge into one. Make 2048.</p>
    </div>
  );
}
