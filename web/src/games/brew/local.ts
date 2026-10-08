import { useCallback, useEffect, useRef, useState } from 'react';
import { botMove, newGame, play, tick, view, type Game, type GameView, type Move } from './engine';

const BOT_MS = 1100;
export const ME = 'me';

/** Who the game is waiting on. */
export function actorOf(g: Game): string | null {
  if (g.phase !== 'playing') return null;
  if (g.pending) return g.pending.kind === 'bandit' ? g.pending.target : g.pending.to;
  return g.players[g.turn].id;
}

/**
 * A game on this phone against bots (practice, and the tutorial). `setup` can change the fresh game (the
 * tutorial deals set hands); `paused` stops bots and timers while the tutorial explains something.
 */
export function useLocalGame(bots: string[], opts: { setup?: (g: Game) => void; paused?: boolean; onMove?: (g: Game, by: string, m: Move) => void } = {}) {
  const make = useCallback(() => {
    const g = newGame([{ id: ME, name: 'You', table: null, bot: false }, ...bots.map((n, i) => ({ id: `b${i}`, name: n, table: null, bot: true }))], Date.now());
    opts.setup?.(g);
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bots.join('|')]);
  const game = useRef<Game>(make());
  const [v, setV] = useState<GameView>(() => view(game.current, ME));
  const [error, setError] = useState('');
  const refresh = useCallback(() => setV(view(game.current, ME)), []);
  const paused = useRef(!!opts.paused);
  paused.current = !!opts.paused;
  const onMove = useRef(opts.onMove);
  onMove.current = opts.onMove;
  const lastMove = useRef(Date.now());

  const act = useCallback(
    (m: Move) => {
      const err = play(game.current, ME, m, Date.now());
      if (err) {
        setError(err);
        setTimeout(() => setError(''), 3500);
      } else onMove.current?.(game.current, ME, m);
      refresh();
    },
    [refresh],
  );

  // Bots move a beat after it becomes their go; timers run out on their own.
  useEffect(() => {
    const t = setInterval(() => {
      if (paused.current) {
        // Keep the clocks from running down while the tutorial talks.
        const g = game.current;
        g.turnDeadline = Math.max(g.turnDeadline, Date.now() + 60_000);
        if (g.pending) g.pending.deadline = Math.max(g.pending.deadline, Date.now() + 30_000);
        return;
      }
      const g = game.current;
      const who = actorOf(g);
      if (who && who !== ME && Date.now() - lastMove.current > BOT_MS) {
        const m = botMove(g, who);
        if (m && !play(g, who, m, Date.now())) {
          onMove.current?.(g, who, m);
          lastMove.current = Date.now();
          refresh();
          return;
        }
      }
      if (tick(g, Date.now())) refresh();
    }, 250);
    return () => clearInterval(t);
  }, [refresh]);

  const restart = useCallback(() => {
    game.current = make();
    refresh();
  }, [make, refresh]);

  return { view: v, act, error, restart, game, refresh };
}
