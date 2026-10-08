import { useState } from 'react';
import { Board } from './Board';
import { ME, useLocalGame } from './local';
import type { CardKind, Game, Move } from './engine';

/** Puts these cards in a player's hand (the tutorial deals what each step needs). */
function deal(g: Game, id: string, kinds: CardKind[]) {
  const p = g.players.find(x => x.id === id)!;
  for (const kind of kinds) p.hand.push({ id: g.nextId++, kind });
}
function cup(g: Game, id: string, points: 1 | 2 = 1) {
  g.players.find(x => x.id === id)!.cups.push({ id: g.nextId++, points, bandit: false });
}

interface Step {
  say: string;
  /** Set the table up for this step. */
  setup?: (g: Game) => void;
  /** The moves this step accepts (others get a nudge back to the step). */
  allow?: Move['a'][];
  /** Done when this is true after a move; steps without one move on with Next. */
  done?: (g: Game) => boolean;
  /** After it's done, tidy up (e.g. a bot answers). */
  after?: (g: Game) => void;
}

const STEPS: Step[] = [
  {
    say: 'You’re a barista at LB’s. Brew hemp coffee faster than the others: one Espresso shot, Hemp milk, Gur, Elaichi and Hemp seeds make a cup. First to 5 points wins. Each turn you draw 2 cards from the deck, then take up to 3 actions.',
    setup: g => {
      g.turn = 0;
      g.actionsLeft = 3;
      const me = g.players[0];
      me.hand = [];
      for (const p of g.players) p.cups = [];
      deal(g, ME, ['espresso', 'milk', 'gur', 'elaichi', 'seeds', 'gur', 'chappal', 'bandit']);
      cup(g, 'b0', 2);
      cup(g, 'b1', 1);
    },
  },
  {
    say: 'You hold all five ingredients. Tap Brew a cup. A brew, a trade or a trick card is one action each.',
    allow: ['brew'],
    done: g => g.players[0].cups.length === 1,
  },
  {
    say: 'Your cup is face down to everyone else: worth 1 or 2 points, and only you know which. But the smell brought a Kauwa (crow) to your stall: you can’t brew again until it’s gone. Tap a Gur card, then Feed the Kauwa and send it on, then tap a player.',
    allow: ['feed'],
    done: g => !g.crows.some(c => c.holder === ME),
  },
  {
    say: 'Chai Bot sent a Bandit to raid your cup! A raided cup scores nothing. You have a Chappal: tap Chase it off.',
    setup: g => {
      const c = g.players[0].cups[0];
      c.bandit = true;
      g.pending = { kind: 'bandit', from: 'b0', target: ME, cupId: c.id, deadline: Date.now() + 60_000, flicks: 0 };
    },
    allow: ['react'],
    done: g => !g.pending && !g.players[0].cups[0].bandit,
  },
  {
    say: 'Your turn to make trouble. Tap the Bandit card, then Raid a cup, then tap a player at the top.',
    allow: ['bandit'],
    done: g => g.players.slice(1).some(p => p.cups.some(c => c.bandit)),
    after: g => {
      g.pending = null; // they have nothing to fight back with
    },
  },
  {
    say: 'Another Bandit crept onto your cup. This time use the Newspaper: tap it, then Shoo the Bandit on, then a player whose cup is still clean.',
    setup: g => {
      g.actionsLeft = 3;
      g.players[0].cups[0].bandit = true;
      deal(g, ME, ['newspaper']);
    },
    allow: ['newspaper'],
    done: g => !g.players[0].cups[0].bandit,
    after: g => {
      g.pending = null;
    },
  },
  {
    say: 'The Havaldar (police) searches someone’s cards and you keep any two. Tap the Havaldar card, Search a player, tap a player, then pick two of their cards.',
    setup: g => {
      g.actionsLeft = 3;
      deal(g, ME, ['havaldar']);
      deal(g, 'b0', ['masala', 'espresso']);
      deal(g, 'b1', ['masala', 'espresso']);
    },
    allow: ['havaldar', 'havaldar-take'],
    done: g => g.pending === null && g.log.some(l => l.includes('Havaldar took')),
  },
  {
    say: 'Short an ingredient? Jugaad brews with any three different ones, but it takes two actions: the card and the brew. Masala is wild and stands in for any ingredient. Tap the Jugaad card, then Brew with Jugaad.',
    setup: g => {
      g.actionsLeft = 3;
      deal(g, ME, ['jugaad', 'espresso', 'gur', 'masala']);
    },
    allow: ['jugaad'],
    done: g => g.players[0].cups.length === 2,
  },
  {
    say: 'More tricks: Chor steals a card from everyone, Kirana makes everyone hand over one ingredient you name, Mandi turns up the top 3 and you keep the ingredients, Sheru (the street dog) catches a Kauwa and keeps what it carried, Monsoon passes 2 cards left. You can also trade ingredients, Masala, Chappals and Newspapers. Tap End turn.',
    allow: ['end'],
    done: g => g.turn !== 0,
  },
  {
    say: 'That’s it! First to 5 points of clean cups wins, or the most points when the cups run out. Have fun!',
  },
];

/** Learn Brew Bandits by playing: each step sets up a moment and waits for you to try it. */
export default function Tutorial({ onDone }: { onDone: (next: 'practice' | 'online' | 'home') => void }) {
  const [step, setStep] = useState(0);
  const [nudge, setNudge] = useState('');
  const local = useLocalGame(['Chai Bot', 'Masala Bot'], {
    paused: true,
    setup: g => STEPS[0].setup?.(g),
    onMove: (g, by) => {
      if (by !== ME) return;
      const s = STEPS[step];
      if (s.done?.(g)) {
        s.after?.(g);
        advance(step + 1, g);
      }
    },
  });
  const advance = (to: number, g = local.game.current) => {
    setNudge('');
    STEPS[to]?.setup?.(g);
    setStep(to);
    local.refresh();
  };
  const s = STEPS[step];
  const act = (m: Move) => {
    if (s.allow && !s.allow.includes(m.a)) return setNudge('Try the step above first.');
    if (!s.allow) return setNudge('Tap Next to carry on.');
    local.act(m);
  };

  return (
    <Board
      view={local.view}
      act={act}
      coach={
        <>
          <p className="bb-coach-step">
            Step {step + 1} of {STEPS.length}
          </p>
          <p>{s.say}</p>
          {(nudge || local.error) && <p className="error">{nudge || local.error}</p>}
          <div className="bb-actions">
            {!s.allow && step < STEPS.length - 1 && (
              <button type="button" className="btn btn-ink" onClick={() => advance(step + 1)}>
                Next
              </button>
            )}
            {step === STEPS.length - 1 ? (
              <>
                <button type="button" className="btn btn-ink" onClick={() => onDone('practice')}>
                  Practice against bots
                </button>
                <button type="button" className="btn btn-line" onClick={() => onDone('online')}>
                  Play with others
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-line" onClick={() => onDone('home')}>
                Leave the tutorial
              </button>
            )}
          </div>
        </>
      }
    />
  );
}
