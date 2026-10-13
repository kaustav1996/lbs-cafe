import { useEffect, useRef } from 'react';
import { sfx, type SoundName } from '../sound';

/** What the log line says happened, as a sound. First match wins. */
const LINES: [RegExp, SoundName][] = [
  [/ran out of time/, 'lose'],
  [/brewed a cup/, 'brew'],
  [/raid|shooed a Bandit/, 'raid'],
  [/chappal/, 'bonk'],
  [/Chor stole/, 'steal'],
  [/Havaldar/, 'whistle'],
  [/Kirana|Mandi/, 'coin'],
  [/Sheru/, 'bark'],
  [/Kauwa/, 'caw'],
  [/Monsoon/, 'rain'],
  [/ traded\./, 'pair'],
  [/said no to|trade offer ran out/, 'bad'],
  [/offered .* a trade/, 'tick'],
  [/discards were shuffled/, 'slide'],
];

interface Viewish {
  me: string;
  turn: string;
  phase: string;
  winner: string | null;
  log: string[];
  players: { id: string; handCount: number }[];
}

/** New lines at the end of the log since last time (the log is the last few lines, so find where they overlap). */
function fresh(prev: string[], next: string[]) {
  if (!prev.length) return [];
  for (let k = Math.min(prev.length, next.length); k > 0; k--) {
    const tail = prev.slice(prev.length - k);
    const start = next.findIndex((_, i) => i + k <= next.length && tail.every((l, j) => next[i + j] === l));
    if (start >= 0 && start + k <= next.length) return next.slice(start + k);
  }
  return next;
}

/** Plays Brew Bandits' sounds by comparing each new view of the game with the last one. */
export function useBrewSounds(view: Viewish) {
  const last = useRef<Viewish | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = view;
    if (!prev) return;
    // At most a couple of sounds per update, so a bot's quick turn doesn't pile up.
    const lines = fresh(prev.log, view.log).slice(-2);
    let played = 0;
    for (const line of lines) {
      const hit = LINES.find(([re]) => re.test(line));
      if (hit) {
        setTimeout(() => sfx(hit[1]), played * 220);
        played++;
      }
    }
    if (view.phase === 'over' && prev.phase !== 'over') {
      setTimeout(() => sfx(view.winner === view.me ? 'win' : 'over'), played * 220 + 200);
      return;
    }
    if (view.turn === view.me && prev.turn !== view.me) setTimeout(() => sfx('yourTurn'), played * 220);
    const mine = (v: Viewish) => v.players.find(p => p.id === v.me)?.handCount ?? 0;
    if (mine(view) > mine(prev) && !played) sfx('draw');
  }, [view]);
}
