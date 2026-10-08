import { useEffect, useRef } from 'react';

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Best scores on this phone. */
export function readBest(game: string): number {
  try {
    return Number(localStorage.getItem(`lbs.games.${game}`) ?? 0) || 0;
  } catch {
    return 0;
  }
}
export function saveBest(game: string, score: number, lowerIsBetter = false) {
  const best = readBest(game);
  const better = best === 0 || (lowerIsBetter ? score < best : score > best);
  if (!better) return best;
  try {
    localStorage.setItem(`lbs.games.${game}`, String(score));
  } catch {
    /* fine */
  }
  return score;
}

/** Swipes on an element and arrow keys on the page, as directions. */
export function useSwipe(el: React.RefObject<HTMLElement | null>, onDir: (d: Dir) => void) {
  const cb = useRef(onDir);
  cb.current = onDir;
  useEffect(() => {
    const node = el.current;
    let x = 0;
    let y = 0;
    let tracking = false;
    const start = (e: TouchEvent) => {
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
      tracking = true;
    };
    const move = (e: TouchEvent) => {
      if (tracking) e.preventDefault(); // the board, not the page, takes the swipe
    };
    const end = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - x;
      const dy = e.changedTouches[0].clientY - y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      cb.current(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
    };
    const key = (e: KeyboardEvent) => {
      const d = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp'];
      if (d) {
        e.preventDefault();
        cb.current(d);
      }
    };
    node?.addEventListener('touchstart', start, { passive: true });
    node?.addEventListener('touchmove', move, { passive: false });
    node?.addEventListener('touchend', end);
    window.addEventListener('keydown', key);
    return () => {
      node?.removeEventListener('touchstart', start);
      node?.removeEventListener('touchmove', move);
      node?.removeEventListener('touchend', end);
      window.removeEventListener('keydown', key);
    };
  }, [el]);
}
