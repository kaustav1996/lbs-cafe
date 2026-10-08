import { useEffect, useRef, useState } from 'react';
import { readBest, saveBest } from './shared';

const PADS = [
  { name: 'Lime', color: 'var(--lime)', tone: 329.6 },
  { name: 'Cyan', color: 'var(--cyan)', tone: 261.6 },
  { name: 'Pink', color: '#ff5fa2', tone: 220 },
  { name: 'Orange', color: '#ff9f1c', tone: 164.8 },
];

/** Simon with four records: watch the pattern, play it back; it grows by one each round. */
export default function RecordSimon() {
  const [seq, setSeq] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  const [lit, setLit] = useState<number | null>(null);
  const [phase, setPhase] = useState<'ready' | 'showing' | 'yours' | 'over'>('ready');
  const [best, setBest] = useState(() => readBest('simon'));
  const audio = useRef<AudioContext | null>(null);

  const beep = (i: number, ms = 320) => {
    try {
      const ctx = (audio.current ??= new AudioContext());
      void ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = PADS[i].tone;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + ms / 1000 + 0.02);
    } catch {
      /* no sound: the lights still show the pattern */
    }
  };

  // Play the pattern back, a bit faster as it grows.
  useEffect(() => {
    if (phase !== 'showing') return;
    const gap = Math.max(260, 620 - seq.length * 25);
    const timers: ReturnType<typeof setTimeout>[] = [];
    seq.forEach((p, i) => {
      timers.push(setTimeout(() => (setLit(p), beep(p, gap * 0.6)), 500 + i * gap));
      timers.push(setTimeout(() => setLit(null), 500 + i * gap + gap * 0.6));
    });
    timers.push(setTimeout(() => (setPhase('yours'), setStep(0)), 500 + seq.length * gap));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, seq]);

  const start = () => {
    setSeq([Math.floor(Math.random() * 4)]);
    setPhase('showing');
  };
  const press = (i: number) => {
    if (phase !== 'yours') return;
    setLit(i);
    setTimeout(() => setLit(null), 180);
    if (seq[step] !== i) {
      beep(i, 600);
      setPhase('over');
      setBest(saveBest('simon', seq.length - 1));
      try {
        navigator.vibrate?.(150);
      } catch {
        /* fine */
      }
      return;
    }
    beep(i);
    if (step + 1 === seq.length) {
      setSeq(s => [...s, Math.floor(Math.random() * 4)]);
      setTimeout(() => setPhase('showing'), 450);
    } else setStep(step + 1);
  };

  const round = Math.max(seq.length - (phase === 'over' ? 1 : 0), 0);
  return (
    <div className="game gsimon">
      <div className="game-scores">
        <p>
          <span>Round</span>
          <b className="num">{round}</b>
        </p>
        <p>
          <span>Best</span>
          <b className="num">{best}</b>
        </p>
        <p className="gsimon-turn" aria-live="polite">
          {phase === 'showing' ? 'Listen…' : phase === 'yours' ? 'Your turn' : ''}
        </p>
      </div>
      <div className="gsimon-board">
        {PADS.map((p, i) => (
          <button
            key={p.name}
            type="button"
            className={`gsimon-pad ${lit === i ? 'is-lit' : ''}`}
            style={{ '--pad': p.color } as React.CSSProperties}
            onClick={() => press(i)}
            disabled={phase !== 'yours'}
            aria-label={p.name}
          >
            <span className="gsimon-groove" aria-hidden="true" />
          </button>
        ))}
        <div className="gsimon-hub" aria-hidden="true" />
        {(phase === 'ready' || phase === 'over') && (
          <div className="game-over">
            <p>{phase === 'over' ? `Wrong record. You reached round ${round}.` : 'Watch the records light up, then play them back.'}</p>
            <button type="button" className="btn btn-ink" onClick={start}>
              {phase === 'over' ? 'Play again' : 'Start'}
            </button>
          </div>
        )}
      </div>
      <p className="game-help">Each round adds one more. Turn your sound on to hear the notes.</p>
    </div>
  );
}
