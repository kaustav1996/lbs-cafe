import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { MenuCategory } from '../data/types';
import { Track } from '../pages/Menu';
import { inr } from '../lib/format';

const FLIP_MS = 650;
const parity = (n: number) => ((n % 2) + 2) % 2;

/**
 * The menu as one 3D cassette. Each side is a section of the menu. Scrolling, swiping or the arrow keys on the
 * tape flip it over its long edge to the next or previous section; tapping it opens that section's dishes
 * right underneath. Off the tape the page scrolls as usual, and at the first and last section scrolling on the
 * tape carries on down (or up) the page, so nobody gets stuck.
 */
export function TapeFlip({ cats }: { cats: MenuCategory[] }) {
  const [index, setIndex] = useState(0);
  // Two faces: the one showing and the one on the back. The back gets the next section just before a flip.
  const [faces, setFaces] = useState<[number, number]>([0, 1 % Math.max(cats.length, 1)]);
  const [turns, setTurns] = useState(0); // half turns so far; odd = the back face is showing
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  const tape = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  const flip = useCallback(
    (dir: 1 | -1) => {
      const target = index + dir;
      if (busy.current || target < 0 || target >= cats.length) return false;
      busy.current = true;
      const hidden = parity(turns + 1);
      setFaces(f => (hidden === 0 ? [target, f[1]] : [f[0], target]));
      // Let the back face take its new section before it turns into view.
      requestAnimationFrame(() => {
        setTurns(t => t + dir);
        setIndex(target);
      });
      setTimeout(() => (busy.current = false), FLIP_MS);
      return true;
    },
    [index, turns, cats.length],
  );

  // Wheel and touch on the tape flip it. They need non-passive listeners so the page doesn't scroll as well.
  const flipRef = useRef(flip);
  flipRef.current = flip;
  const atEnd = useRef({ first: true, last: cats.length <= 1 });
  atEnd.current = { first: index === 0, last: index >= cats.length - 1 };
  useEffect(() => {
    const el = tape.current;
    if (!el) return;
    let acc = 0;
    let quietTimer: ReturnType<typeof setTimeout>;
    const onWheel = (e: WheelEvent) => {
      const dir = e.deltaY > 0 ? 1 : -1;
      if ((dir > 0 && atEnd.current.last) || (dir < 0 && atEnd.current.first)) return; // let the page scroll on
      e.preventDefault();
      acc += e.deltaY;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => (acc = 0), 200);
      if (Math.abs(acc) > 40 && !busy.current) {
        flipRef.current(acc > 0 ? 1 : -1);
        acc = 0;
      }
    };
    let startY = 0;
    let startX = 0;
    let done = false;
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      done = false;
      moved.current = false;
    };
    const onMove = (e: TouchEvent) => {
      const dy = startY - e.touches[0].clientY;
      const dx = startX - e.touches[0].clientX;
      if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx)) return;
      moved.current = true;
      const dir = dy > 0 ? 1 : -1;
      if ((dir > 0 && atEnd.current.last) || (dir < 0 && atEnd.current.first)) return;
      e.preventDefault();
      if (!done && Math.abs(dy) > 30) done = flipRef.current(dir);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      clearTimeout(quietTimer);
    };
  }, []);

  if (!cats.length) return null;
  const cat = cats[index];
  const face = (side: 0 | 1) => {
    const c = cats[faces[side]] ?? cat;
    const n = faces[side];
    return (
      <span className={`tape-face tape-face-${side ? 'b' : 'a'}`} style={{ '--label': c.color } as CSSProperties}>
        <span className="tape-screws" />
        <span className="tape-label">
          <span className="tape-side">Side {String.fromCharCode(65 + (n % 26))}</span>
          <span className="tape-name">{c.name}</span>
          <span className="tape-meta num">
            {c.items.length} {c.items.length === 1 ? 'item' : 'items'}, {inr(c.min)} to {inr(c.max)}
          </span>
          <span className="tape-window">
            <span className="tape-reel" />
            <span className="tape-ribbon" />
            <span className="tape-reel" />
          </span>
        </span>
        <span className="tape-foot">
          <span className="num">
            {n + 1}/{cats.length}
          </span>
        </span>
      </span>
    );
  };

  return (
    <div className={`tapeflip ${open ? 'is-open' : ''}`}>
      <div className="tape-stage">
        <button
          ref={tape}
          type="button"
          className="tape"
          aria-expanded={open}
          aria-controls="tape-dishes"
          aria-label={`${cat.name}, section ${index + 1} of ${cats.length}. ${open ? 'Hide' : 'Show'} the dishes. Up and down arrows change the section.`}
          onClick={() => {
            if (moved.current) return void (moved.current = false);
            setOpen(o => !o);
          }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
              if (flip(1)) e.preventDefault();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
              if (flip(-1)) e.preventDefault();
            }
          }}
        >
          <span className="tape-body" style={{ transform: `rotateX(${turns * -180}deg)` }}>
            {face(0)}
            {face(1)}
            <span className="tape-edge tape-edge-top" />
            <span className="tape-edge tape-edge-bottom" />
          </span>
        </button>
      </div>
      <div className="tape-controls">
        <button type="button" className="tape-step" onClick={() => flip(-1)} disabled={index === 0} aria-label="Previous section">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <p className="tape-hint">Scroll or swipe on the tape to change the section. Tap it to see the dishes.</p>
        <button type="button" className="tape-step" onClick={() => flip(1)} disabled={index >= cats.length - 1} aria-label="Next section">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div id="tape-dishes" className="tape-dishes" hidden={!open} style={{ '--label': cat.color } as CSSProperties}>
        <div className="cat-head tape-dishes-head" key={`head-${cat.id}`}>
          <span className="cat-art" aria-hidden="true">
            <span className="vinyl cat-disc" style={{ '--label': cat.color } as CSSProperties}>
              <span className="vinyl-label">
                <span className="vinyl-hole" />
              </span>
            </span>
            <span className="cat-sleeve" />
          </span>
          <span className="cat-text">
            <span className="cat-name">{cat.name}</span>
            <span className="cat-meta muted num">
              {cat.items.length} {cat.items.length === 1 ? 'item' : 'items'}, {inr(cat.min)} to {inr(cat.max)}
            </span>
          </span>
        </div>
        <ul className="tracks" key={cat.id}>
          {cat.items.map(i => (
            <Track key={i.id} item={i} />
          ))}
        </ul>
        <Link to={{ pathname: '/menu', hash: cat.id }} className="btn btn-line btn-block">
          {cat.name} on the full menu
        </Link>
      </div>
    </div>
  );
}
