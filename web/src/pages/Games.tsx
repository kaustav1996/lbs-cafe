import { Suspense, lazy, useEffect, type ComponentType } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Footer, Nav } from '../components/Chrome';
import { Cassette } from '../components/Gear';
import { useGames } from '../state/games';
import { readBest } from '../games/shared';

const GAMES: { id: string; name: string; blurb: string; best: (n: number) => string; color: string; load: () => Promise<{ default: ComponentType }> }[] = [
  { id: '2048', name: 'Lemon 2048', blurb: 'Swipe to slide and merge the tiles. Make 2048.', best: n => `Best ${n}`, color: 'var(--lime)', load: () => import('../games/Lemon2048') },
  { id: 'snake', name: 'Snake', blurb: 'Eat the lemons. Don’t hit a wall or your own tail.', best: n => `Best ${n} ${n === 1 ? 'lemon' : 'lemons'}`, color: 'var(--cyan)', load: () => import('../games/Snake') },
  { id: 'match', name: 'Tape match', blurb: 'Flip the tapes and find the eight pairs.', best: n => `Best ${n} moves`, color: '#ff9f1c', load: () => import('../games/TapeMatch') },
  { id: 'simon', name: 'Record Simon', blurb: 'Play back the records as they light up.', best: n => `Best round ${n}`, color: '#ff5fa2', load: () => import('../games/RecordSimon') },
];
const LOADED = Object.fromEntries(GAMES.map(g => [g.id, lazy(g.load)]));

/**
 * Games for a table, open once the table has ordered (or staff open them). If a server closes them while
 * someone is playing, the game gives way to a note.
 */
export default function Games() {
  const { game } = useParams();
  const { on, table } = useGames();
  const pick = GAMES.find(g => g.id === game);
  const Game = pick ? LOADED[pick.id] : null;

  useEffect(() => {
    document.title = `${pick ? pick.name : 'Games'} | LB's`;
    window.scrollTo(0, 0);
  }, [pick]);

  return (
    <div className="page games-page">
      <Nav />
      <main className="wrap narrow status-page">
        {!on ? (
          <>
            <header className="head-mark">
              <Cassette />
              <h1 className="display">Games</h1>
            </header>
            <p>
              {table
                ? `Games open for table ${table} once you’ve ordered. If you have, ask your server to open them.`
                : 'Games are for tables at LB’s. Scan the QR code on your table to start.'}
            </p>
            <Link to="/menu" className="btn btn-ink">
              See the menu
            </Link>
          </>
        ) : pick && Game ? (
          <>
            <header className="game-head">
              <Link to="/games" className="btn btn-line btn-sm">
                All games
              </Link>
              <h1>{pick.name}</h1>
            </header>
            <Suspense fallback={<p className="status-meta">Loading the game…</p>}>
              <Game />
            </Suspense>
          </>
        ) : (
          <>
            <header className="head-mark">
              <Cassette />
              <h1 className="display">Games</h1>
              <p className="status-meta">For table {table}, while you wait or after you eat.</p>
            </header>
            <ul className="game-list">
              {GAMES.map(g => {
                const best = readBest(g.id);
                return (
                  <li key={g.id}>
                    <Link to={`/games/${g.id}`} className="game-tile" style={{ '--label': g.color } as React.CSSProperties}>
                      <span className="game-tile-label">
                        <span className="game-tile-name">{g.name}</span>
                        <span className="game-tile-blurb">{g.blurb}</span>
                        {best > 0 && <span className="game-tile-best num">{g.best(best)}</span>}
                      </span>
                      <span className="chip-window" aria-hidden="true">
                        <i />
                        <i />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="status-meta">Games with friends at your table are on the way.</p>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
