import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CardFace, ICON } from './cards';
import { brewPlan, INGREDIENTS, LABEL, type Card, type CardKind, type GameView, type Ing, type Move } from './engine';

type Mode = null | { pick: 'bandit' | 'chor' | 'newspaper' | 'react-newspaper' } | { trade: true } | { discard: true };

/** Seconds left until a deadline, ticking. */
function useLeft(deadline: number | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

/**
 * The Brew Bandits table, for one player's view of a game (online or on this phone). `act` sends a move;
 * `coach` puts a tutorial tip above the table; `footer` holds Leave / Play again.
 */
export function Board({ view, act, coach, footer }: { view: GameView; act: (m: Move) => void; coach?: ReactNode; footer?: ReactNode }) {
  const me = view.players.find(p => p.id === view.me)!;
  const others = view.players.filter(p => p.id !== view.me);
  const hand = me.hand ?? [];
  const [mode, setMode] = useState<Mode>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [tradeTo, setTradeTo] = useState('');
  const [want, setWant] = useState<Ing[]>([]);
  const pd = view.pending;
  const myTurn = view.phase === 'playing' && view.turn === view.me && !pd;
  const raidOnMe = pd?.kind === 'bandit' && pd.target === view.me;
  const tradeForMe = pd?.kind === 'trade' && pd.to === view.me;
  const left = useLeft(pd ? pd.deadline : view.phase === 'playing' ? view.turnDeadline : null);
  const has = (k: CardKind) => hand.some(c => c.kind === k);
  const canBrew = !!brewPlan(hand as Card[], 5);
  // Jugaad is two actions: the card and the brew.
  const canJugaad = has('jugaad') && view.actionsLeft >= 2 && !!brewPlan(hand as Card[], 3);
  const spoiledMine = me.cups.some(c => c.bandit);
  const overLimit = Math.max(0, hand.length - view.handLimit);
  const name = (id: string) => view.players.find(p => p.id === id)?.name ?? '';
  const whoseTurn = view.players.find(p => p.id === view.turn);

  // A new turn or a new state clears half-made choices.
  useEffect(() => {
    setMode(null);
    setSel([]);
  }, [view.turn, view.phase]);
  const go = (m: Move) => {
    act(m);
    setMode(null);
    setSel([]);
    setWant([]);
  };

  const tapCard = (id: number, kind: CardKind) => {
    if (mode && 'discard' in mode) return setSel(s => (s.includes(id) ? s.filter(x => x !== id) : s.length < overLimit ? [...s, id] : s));
    if (mode && 'trade' in mode) return INGREDIENTS.includes(kind as Ing) && setSel(s => (s.includes(id) ? s.filter(x => x !== id) : s.length < 5 ? [...s, id] : s));
    if (!myTurn || view.actionsLeft <= 0) return;
    if (kind === 'bandit' || kind === 'chor') return setMode({ pick: kind });
    if (kind === 'newspaper' && spoiledMine) return setMode({ pick: 'newspaper' });
    if (kind === 'chappal' && spoiledMine) return go({ a: 'chappal' });
    if (kind === 'monsoon') return go({ a: 'monsoon' });
    if (kind === 'jugaad' && canJugaad) return go({ a: 'jugaad' });
  };

  const pickable = useMemo(() => {
    if (!mode || !('pick' in mode)) return [] as string[];
    if (mode.pick === 'chor') return others.filter(p => p.handCount > 0).map(p => p.id);
    return others.filter(p => p.cups.some(c => !c.bandit)).map(p => p.id);
  }, [mode, others]);
  const pick = (id: string) => {
    if (!mode || !('pick' in mode)) return;
    if (mode.pick === 'react-newspaper') go({ a: 'react', with: 'newspaper', target: id });
    else go({ a: mode.pick, target: id } as Move);
  };

  return (
    <div className="bb">
      {coach && <div className="bb-coach">{coach}</div>}

      <div className={`bb-status ${myTurn ? 'is-mine' : ''}`} aria-live="polite">
        {view.phase === 'over' ? (
          <b>{view.winner === view.me ? 'You win!' : `${name(view.winner ?? '')} wins!`}</b>
        ) : raidOnMe ? (
          <b>A Bandit is raiding your cup! {left}s</b>
        ) : tradeForMe ? (
          <b>{name(pd!.from)} wants to trade. {left}s</b>
        ) : pd?.kind === 'bandit' ? (
          <span>
            {name(pd.target)} is dealing with a Bandit… {left}s
          </span>
        ) : pd?.kind === 'trade' ? (
          <span>Waiting for {name(pd.to)} to answer the trade… {left}s</span>
        ) : myTurn ? (
          <b>
            Your turn: {view.actionsLeft} {view.actionsLeft === 1 ? 'action' : 'actions'} left. {left}s
          </b>
        ) : (
          <span>
            {whoseTurn?.name}’s turn. {left}s
          </span>
        )}
      </div>

      <ul className="bb-others">
        {others.map(p => {
          const can = pickable.includes(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`bb-seat ${view.turn === p.id ? 'is-turn' : ''} ${can ? 'is-pickable' : ''}`}
                disabled={!can}
                onClick={() => pick(p.id)}
                aria-label={`${p.name}${p.table ? `, table ${p.table}` : ''}: ${p.handCount} cards, ${p.cups.length} cups${can ? '. Tap to choose' : ''}`}
              >
                <span className="bb-seat-name">
                  {p.name}
                  {p.bot ? ' 🤖' : ''}
                </span>
                <span className="bb-seat-meta">
                  {p.table ? `Table ${p.table}, ` : ''}
                  {p.handCount} cards
                </span>
                <span className="bb-cups">
                  {p.cups.length === 0 && <span className="bb-nocup">No cups yet</span>}
                  {p.cups.map(c => (
                    <span key={c.id} className={`bb-cup ${c.bandit ? 'is-spoiled' : ''}`}>
                      ☕{c.bandit && <i>🍋</i>}
                      {c.points !== undefined && <small>{c.points}</small>}
                    </span>
                  ))}
                  {p.points !== undefined && <b className="bb-pts">{p.points} pts</b>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {mode && 'pick' in mode && (
        <p className="bb-hint">
          {mode.pick === 'chor' ? 'Tap a player above to steal from.' : 'Tap a player above to send the Bandit to raid their cup.'}{' '}
          <button type="button" className="linkish" onClick={() => setMode(null)}>
            Cancel
          </button>
        </p>
      )}

      <section className="bb-mine" aria-label="Your cups">
        <h3>
          Your cups{' '}
          <b className="num">
            {me.points ?? 0} of {view.winPoints} points
          </b>
        </h3>
        <span className="bb-cups is-mine">
          {me.cups.length === 0 && <span className="bb-nocup">Brew your first cup: one of each ingredient.</span>}
          {me.cups.map(c => (
            <span key={c.id} className={`bb-cup ${c.bandit ? 'is-spoiled' : ''}`}>
              ☕{c.bandit && <i>🍋</i>}
              <small>{c.points}</small>
            </span>
          ))}
        </span>
      </section>

      {myTurn && !mode && (
        <div className="bb-actions">
          <button type="button" className="btn btn-ink" disabled={!canBrew || view.actionsLeft <= 0} onClick={() => go({ a: 'brew' })}>
            Brew a cup
          </button>
          <button type="button" className="btn btn-line" disabled={view.actionsLeft <= 0} onClick={() => (setMode({ trade: true }), setTradeTo(others[0]?.id ?? ''))}>
            Trade
          </button>
          <button
            type="button"
            className="btn btn-line"
            onClick={() => (overLimit > 0 ? setMode({ discard: true }) : go({ a: 'end' }))}
          >
            End turn
          </button>
        </div>
      )}

      {mode && 'discard' in mode && (
        <div className="bb-panel">
          <p>
            You can keep {view.handLimit} cards. Tap {overLimit} to discard ({sel.length} chosen).
          </p>
          <div className="bb-actions">
            <button type="button" className="btn btn-ink" disabled={sel.length !== overLimit} onClick={() => go({ a: 'end', discard: sel })}>
              Discard and end turn
            </button>
            <button type="button" className="btn btn-line" onClick={() => (setMode(null), setSel([]))}>
              Back
            </button>
          </div>
        </div>
      )}

      {mode && 'trade' in mode && (
        <div className="bb-panel">
          <p>
            <b>Trade with</b>
          </p>
          <div className="bb-chips">
            {others.map(p => (
              <button key={p.id} type="button" className={`bb-chip ${tradeTo === p.id ? 'on' : ''}`} onClick={() => setTradeTo(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
          <p>
            <b>You give:</b> tap ingredients in your hand ({sel.length}).
          </p>
          <p>
            <b>You ask for:</b>{' '}
            {want.map((k, i) => (
              <button key={i} type="button" className="bb-chip on" onClick={() => setWant(w => w.filter((_, j) => j !== i))} aria-label={`Remove ${LABEL[k]}`}>
                {ICON[k]} {LABEL[k]}
              </button>
            ))}
          </p>
          <div className="bb-chips">
            {INGREDIENTS.map(k => (
              <button key={k} type="button" className="bb-chip" disabled={want.length >= 5} onClick={() => setWant(w => [...w, k])}>
                + {ICON[k]} {LABEL[k]}
              </button>
            ))}
          </div>
          <div className="bb-actions">
            <button type="button" className="btn btn-ink" disabled={!tradeTo || (!sel.length && !want.length)} onClick={() => go({ a: 'trade', to: tradeTo, give: sel, want })}>
              Offer the trade
            </button>
            <button type="button" className="btn btn-line" onClick={() => (setMode(null), setSel([]), setWant([]))}>
              Back
            </button>
          </div>
        </div>
      )}

      <section className="bb-hand" aria-label="Your hand">
        <h3>
          Your hand <span className="muted">({hand.length})</span>
        </h3>
        <div className="bb-hand-cards">
          {[...hand]
            .sort((a, b) => a.kind.localeCompare(b.kind))
            .map(c => (
              <CardFace key={c.id} kind={c.kind} selected={sel.includes(c.id)} onClick={() => tapCard(c.id, c.kind)} />
            ))}
        </div>
        {myTurn && !mode && <p className="bb-hint">Tap a trick card to play it. Brew with all five ingredients (Masala fills a gap).</p>}
      </section>

      <ol className="bb-log" aria-label="What happened">
        {[...view.log].reverse().map((l, i) => (
          <li key={`${view.seq}-${i}`}>{l}</li>
        ))}
      </ol>

      {footer}

      {raidOnMe && (
        <div className="bb-modal" role="alertdialog" aria-label="A Bandit is raiding your cup">
          <div className="bb-modal-box">
            <span className="bb-raider" aria-hidden="true">
              🍋
            </span>
            <p>
              <b>{name(pd!.from)}</b> sent a Bandit to raid your cup! It won’t count until the Bandit is gone. <b className="num">{left}s</b>
            </p>
            {mode && 'pick' in mode && mode.pick === 'react-newspaper' ? (
              <>
                <p>Shoo it onto whose cup?</p>
                <div className="bb-chips">
                  {others
                    .filter(p => p.cups.some(c => !c.bandit))
                    .map(p => (
                      <button key={p.id} type="button" className="bb-chip" onClick={() => pick(p.id)}>
                        {p.name}
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <div className="bb-actions">
                <button type="button" className="btn btn-ink" disabled={!has('chappal')} onClick={() => go({ a: 'react', with: 'chappal' })}>
                  🩴 Chase it off
                </button>
                <button
                  type="button"
                  className="btn btn-line"
                  disabled={!has('newspaper') || !others.some(p => p.cups.some(c => !c.bandit))}
                  onClick={() => setMode({ pick: 'react-newspaper' })}
                >
                  📰 Shoo it on
                </button>
                <button type="button" className="btn btn-line" onClick={() => go({ a: 'react', with: 'none' })}>
                  Let it be
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tradeForMe && pd?.kind === 'trade' && (
        <div className="bb-modal" role="alertdialog" aria-label="Trade offer">
          <div className="bb-modal-box">
            <p>
              <b>{name(pd.from)}</b> offers {pd.give.length ? `${pd.give.length} ${pd.give.length === 1 ? 'card' : 'cards'}` : 'nothing'}
              {pd.want.length ? ` for your ${pd.want.map(k => LABEL[k]).join(', ')}` : ' as a gift'}. <b className="num">{left}s</b>
            </p>
            <div className="bb-actions">
              <button type="button" className="btn btn-ink" onClick={() => go({ a: 'trade-reply', accept: true })}>
                Accept
              </button>
              <button type="button" className="btn btn-line" onClick={() => go({ a: 'trade-reply', accept: false })}>
                No thanks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
