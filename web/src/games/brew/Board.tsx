import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BANDIT_IMG, CardBack, CupMark, DOES, PlayingCard, ICON } from './cards';
import { CrowArt } from './art';
import { brewPlan, INGREDIENTS, LABEL, TRADEABLE, type Card, type CardKind, type GameView, type Ing, type Move } from './engine';

type Mode = null | { pick: 'bandit' | 'havaldar' | 'newspaper' } | { feed: number } | { trade: true } | { kirana: true } | { sheru: true };
const isIng = (k: CardKind) => (INGREDIENTS as readonly string[]).includes(k);
const canTrade = (k: CardKind) => TRADEABLE.includes(k);

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

/** Card width and step between cards so the fanned hand fits the screen. */
function useFan(n: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const card = Math.min(92, Math.max(66, w / 4.6));
  // Leave room at both ends for the tilt of the outer cards.
  const step = n <= 1 ? card : Math.min(card * 0.9, (w - card - 28) / (n - 1));
  return { ref, card, step };
}

/**
 * The Brew Bandits table for one player's view of a game (online or on this phone). Tap a card to choose it;
 * the bar under your hand shows what it does and what you can do with it. `coach` puts a tutorial tip on top.
 */
export function Board({ view, act, coach, footer }: { view: GameView; act: (m: Move) => void; coach?: ReactNode; footer?: ReactNode }) {
  const me = view.players.find(p => p.id === view.me)!;
  const others = view.players.filter(p => p.id !== view.me);
  const hand = useMemo(() => [...(me.hand ?? [])].sort((a, b) => order(a.kind) - order(b.kind) || a.id - b.id), [me.hand]);
  const [mode, setMode] = useState<Mode>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [tradeTo, setTradeTo] = useState('');
  const [want, setWant] = useState<CardKind[]>([]);
  const [newsTarget, setNewsTarget] = useState(false);
  const pd = view.pending;
  const myTurn = view.phase === 'playing' && view.turn === view.me && !pd;
  const raidOnMe = pd?.kind === 'bandit' && pd.target === view.me;
  const tradeForMe = pd?.kind === 'trade' && pd.to === view.me;
  const left = useLeft(pd ? pd.deadline : view.phase === 'playing' ? view.turnDeadline : null);
  const has = (k: CardKind) => hand.some(c => c.kind === k);
  const canBrew = !!brewPlan(hand as Card[], 5);
  const canJugaad = has('jugaad') && view.actionsLeft >= 2 && !!brewPlan(hand as Card[], 3);
  const raidedMine = me.cups.some(c => c.bandit);
  const name = (id: string) => view.players.find(p => p.id === id)?.name ?? '';
  const whoseTurn = view.players.find(p => p.id === view.turn);
  const chosen = hand.filter(c => sel.includes(c.id));
  const one = chosen.length === 1 ? chosen[0] : null;
  const fan = useFan(hand.length);

  // Cards that just arrived (the two you draw at the start of your turn) fly in from the deck.
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<number[]>([]);
  const [drew, setDrew] = useState('');
  useEffect(() => {
    const ids = hand.map(c => c.id);
    if (seen.current) {
      const added = ids.filter(id => !seen.current!.has(id));
      if (added.length) {
        setFresh(added);
        if (view.turn === view.me && added.length === 2) setDrew('You drew 2 cards from the deck.');
        setTimeout(() => setFresh([]), 900);
        setTimeout(() => setDrew(''), 2600);
      }
    }
    seen.current = new Set(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.map(c => c.id).join(',')]);

  // A new turn clears half-made choices; so does a card leaving your hand.
  useEffect(() => {
    setMode(null);
    setSel([]);
  }, [view.turn, view.phase]);
  useEffect(() => setSel(s => s.filter(id => hand.some(c => c.id === id))), [hand]);

  const go = (m: Move) => {
    act(m);
    setMode(null);
    setSel([]);
    setWant([]);
    setNewsTarget(false);
  };

  const tap = (c: Card) => {
    if (mode && 'trade' in mode) {
      if (!canTrade(c.kind)) return;
      return setSel(s => (s.includes(c.id) ? s.filter(x => x !== c.id) : s.length < 6 ? [...s, c.id] : s));
    }
    if (mode) setMode(null);
    // Trick cards are chosen one at a time; tradeable cards can be gathered for a trade.
    if (!canTrade(c.kind)) return setSel(s => (s.length === 1 && s[0] === c.id ? [] : [c.id]));
    setSel(s => {
      const only = s.filter(id => canTrade(hand.find(h => h.id === id)?.kind ?? 'bandit'));
      return only.includes(c.id) ? only.filter(x => x !== c.id) : [...only, c.id].slice(-6);
    });
  };

  const crowAt = (id: string) => view.crows.find(c => c.holder === id) ?? null;
  const myCrow = crowAt(view.me);
  const pickable = useMemo(() => {
    if (mode && 'feed' in mode) return others.filter(p => !view.crows.some(c => c.holder === p.id)).map(p => p.id);
    if (!mode || !('pick' in mode)) return [] as string[];
    if (mode.pick === 'havaldar') return others.filter(p => p.handCount > 0).map(p => p.id);
    return others.filter(p => p.cups.some(c => !c.bandit)).map(p => p.id);
  }, [mode, others, view.crows]);
  const pick = (id: string) => {
    if (mode && 'feed' in mode) return go({ a: 'feed', card: mode.feed, target: id });
    if (!mode || !('pick' in mode)) return;
    go({ a: mode.pick, target: id } as Move);
  };
  const havaldarMine = pd?.kind === 'havaldar' && pd.from === view.me;
  const [grab, setGrab] = useState<number[]>([]);
  const raidable = others.some(p => p.cups.some(c => !c.bandit));

  const status =
    view.phase === 'over'
      ? view.winner === view.me
        ? 'You win!'
        : `${name(view.winner ?? '')} wins!`
      : raidOnMe
        ? 'A Bandit is raiding your cup!'
        : tradeForMe
          ? `${name(pd!.from)} wants to trade`
          : pd?.kind === 'bandit'
            ? `${name(pd.target)} is dealing with a Bandit`
            : pd?.kind === 'trade'
              ? `Waiting for ${name(pd.to)} to answer the trade`
              : pd?.kind === 'havaldar'
                ? pd.from === view.me
                  ? 'Pick two cards to take'
                  : `${name(pd.from)}’s Havaldar is searching ${name(pd.target)}’s cards`
              : myTurn
                ? `Your turn: ${view.actionsLeft} ${view.actionsLeft === 1 ? 'action' : 'actions'} left`
                : `${whoseTurn?.name}’s turn`;

  return (
    <div className="bbt">
      {coach && <div className="bb-coach">{coach}</div>}

      <ul className="bbt-seats">
        {others.map(p => {
          const can = pickable.includes(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`bbt-seat ${view.turn === p.id && view.phase === 'playing' ? 'is-turn' : ''} ${can ? 'is-pickable' : ''}`}
                disabled={!can}
                onClick={() => pick(p.id)}
                aria-label={`${p.name}${p.table ? `, table ${p.table}` : ''}: ${p.handCount} cards, ${p.cups.length} cups${can ? '. Tap to choose' : ''}`}
              >
                <span className="bbt-seat-name">
                  {p.name}
                  {p.bot ? ' 🤖' : ''}
                </span>
                <span className="bbt-seat-meta">{p.table ? `Table ${p.table}` : p.bot ? 'Bot' : ''}</span>
                <span className="bbt-backs" aria-hidden="true">
                  {Array.from({ length: Math.min(p.handCount, 7) }, (_, i) => (
                    <CardBack key={i} className="pc-back-mini" style={{ transform: `rotate(${(i - (Math.min(p.handCount, 7) - 1) / 2) * 7}deg)` }} />
                  ))}
                  <b>{p.handCount}</b>
                </span>
                <span className="bbt-cups">
                  {p.cups.length === 0 ? <span className="bbt-nocup">No cups</span> : p.cups.map(c => <CupMark key={c.id} raided={c.bandit} points={c.points} />)}
                  {crowAt(p.id) && (
                    <span className="bbt-crow" title="A Kauwa is at this stall">
                      <CrowArt />
                      {crowAt(p.id)!.stash > 0 && <b>{crowAt(p.id)!.stash}</b>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="bbt-center">
        <div className="bbt-pile" aria-label={`Deck: ${view.deck} cards`}>
          <CardBack className="pc-back-pile" style={{ transform: 'translate(4px, 4px)' }} />
          <CardBack className="pc-back-pile" style={{ transform: 'translate(2px, 2px)' }} />
          <CardBack className="pc-back-pile" />
          <span className="bbt-pile-count">{view.deck}</span>
          <span className="bbt-pile-label">Deck</span>
        </div>
        <div className={`bbt-banner ${myTurn ? 'is-mine' : ''} ${raidOnMe ? 'is-alert' : ''}`} aria-live="polite">
          <b>{status}</b>
          {view.phase === 'playing' && <span className="bbt-clock num">{left}s</span>}
          {view.log.length > 0 && <span className="bbt-last">{view.log[view.log.length - 1]}</span>}
          <span className="bbt-cupsleft">{view.cupsLeft} cups left to brew</span>
        </div>
        <div className="bbt-pile is-discard" aria-label={view.discardTop ? `Discard pile: ${LABEL[view.discardTop]} on top` : 'Discard pile: empty'}>
          {view.discardTop ? <PlayingCard kind={view.discardTop} size="sm" /> : <span className="bbt-empty-pile" />}
          <span className="bbt-pile-label">Discards</span>
        </div>
      </div>

      <section className="bbt-mine" aria-label="Your cups">
        <h3>
          Your cups
          <b className="num">
            {me.points ?? 0} / {view.winPoints} points
          </b>
        </h3>
        {myCrow && (
          <p className="bbt-crowline">
            <CrowArt className="bbt-crow-big" /> A Kauwa is at your stall: you can’t brew until you feed it an ingredient to send it on (tap an ingredient), or
            catch it with Sheru.
          </p>
        )}
        <div className="bbt-cups is-mine">
          {me.cups.length === 0 ? (
            <span className="bbt-nocup">Brew your first cup with one of each ingredient.</span>
          ) : (
            me.cups.map(c => <CupMark key={c.id} raided={c.bandit} points={c.points} big />)
          )}
        </div>
      </section>

      <div className="bbt-dock">
      {drew && <p className="bbt-drew">{drew}</p>}

      <section className="bbt-hand" aria-label={`Your hand, ${hand.length} cards`}>
        <div className="bbt-fan" ref={fan.ref}>
          {hand.map((c, i) => {
            const mid = (hand.length - 1) / 2;
            const tilt = hand.length > 1 ? ((i - mid) / Math.max(mid, 1)) * 10 : 0;
            return (
              <PlayingCard
                key={c.id}
                kind={c.kind}
                selected={sel.includes(c.id)}
                fresh={fresh.includes(c.id)}
                onClick={() => tap(c)}
                style={
                  {
                    width: fan.card,
                    marginLeft: i === 0 ? 0 : fan.step - fan.card,
                    '--tilt': `${tilt}deg`,
                    '--lift': `${Math.abs(i - mid) * 3}px`,
                    zIndex: sel.includes(c.id) ? 50 : i,
                  } as React.CSSProperties
                }
              />
            );
          })}
          {hand.length === 0 && <span className="bbt-nocup">No cards in your hand.</span>}
        </div>
      </section>

      <div className="bbt-bar">
        {mode && ('pick' in mode || 'feed' in mode) ? (
          <>
            <p>
              <b>
                {'feed' in mode
                  ? 'Tap a player above to send the Kauwa to their stall.'
                  : mode.pick === 'havaldar'
                    ? 'Tap a player above for the Havaldar to search.'
                    : mode.pick === 'bandit'
                      ? 'Tap a player above to raid their cup.'
                      : 'Tap a player above to shoo the Bandit onto their cup.'}
              </b>
            </p>
            <div className="bb-actions">
              <button type="button" className="btn btn-line" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : mode && 'kirana' in mode ? (
          <>
            <p>
              <b>Call the Kirana for which ingredient?</b> Everyone else hands you all of it.
            </p>
            <div className="bb-chips">
              {INGREDIENTS.map(k => (
                <button key={k} type="button" className="bb-chip" onClick={() => go({ a: 'kirana', ing: k })}>
                  {ICON[k]} {LABEL[k]}
                </button>
              ))}
            </div>
            <div className="bb-actions">
              <button type="button" className="btn btn-line" onClick={() => setMode(null)}>
                Back
              </button>
            </div>
          </>
        ) : mode && 'sheru' in mode ? (
          <>
            <p>
              <b>Send Sheru after which Kauwa?</b>
            </p>
            <div className="bb-chips">
              {view.crows
                .filter(c => c.holder)
                .map(c => (
                  <button key={c.id} type="button" className="bb-chip" onClick={() => go({ a: 'sheru', crow: c.id })}>
                    At {c.holder === view.me ? 'your' : `${name(c.holder!)}’s`} stall{c.stash ? `, carrying ${c.stash}` : ''}
                  </button>
                ))}
            </div>
            <div className="bb-actions">
              <button type="button" className="btn btn-line" onClick={() => setMode(null)}>
                Back
              </button>
            </div>
          </>
        ) : mode && 'trade' in mode ? (
          <TradePanel
            others={others}
            tradeTo={tradeTo}
            setTradeTo={setTradeTo}
            giving={chosen.map(c => c.kind)}
            want={want}
            setWant={setWant}
            onSend={() => go({ a: 'trade', to: tradeTo, give: sel, want })}
            onBack={() => (setMode(null), setWant([]))}
          />
        ) : one && !isIng(one.kind) ? (
          <>
            <p>
              <b>{LABEL[one.kind]}.</b> {DOES[one.kind]}
            </p>
            <div className="bb-actions">
              {one.kind === 'bandit' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft || !raidable} onClick={() => setMode({ pick: 'bandit' })}>
                  Raid a cup
                </button>
              )}
              {one.kind === 'chor' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft} onClick={() => go({ a: 'chor' })}>
                  Steal from everyone
                </button>
              )}
              {one.kind === 'havaldar' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft} onClick={() => setMode({ pick: 'havaldar' })}>
                  Search a player
                </button>
              )}
              {one.kind === 'kirana' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft} onClick={() => setMode({ kirana: true })}>
                  Call the Kirana
                </button>
              )}
              {one.kind === 'mandi' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft} onClick={() => go({ a: 'mandi' })}>
                  Go to the Mandi
                </button>
              )}
              {one.kind === 'sheru' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft || !view.crows.some(c => c.holder)} onClick={() => setMode({ sheru: true })}>
                  {view.crows.some(c => c.holder) ? 'Chase a Kauwa' : 'No Kauwa at any stall'}
                </button>
              )}
              {one.kind === 'chappal' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft || !raidedMine} onClick={() => go({ a: 'chappal' })}>
                  {raidedMine ? 'Chase off the Bandit' : 'No Bandit on your cups'}
                </button>
              )}
              {one.kind === 'newspaper' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft || !raidedMine || !raidable} onClick={() => setMode({ pick: 'newspaper' })}>
                  {raidedMine ? 'Shoo the Bandit on' : 'No Bandit on your cups'}
                </button>
              )}
              {one.kind === 'jugaad' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !canJugaad} onClick={() => go({ a: 'jugaad' })}>
                  Brew with Jugaad
                </button>
              )}
              {one.kind === 'monsoon' && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft} onClick={() => go({ a: 'monsoon' })}>
                  Call Monsoon
                </button>
              )}
              <button type="button" className="btn btn-line" onClick={() => setSel([])}>
                Put it back
              </button>
            </div>
            {!myTurn && view.phase === 'playing' && <p className="bbt-note">You can play it on your turn.</p>}
          </>
        ) : chosen.length > 0 ? (
          <>
            <p>
              <b>
                {chosen.length === 1 ? LABEL[chosen[0].kind] : `${chosen.length} cards`} chosen.
              </b>{' '}
              {chosen.length === 1 ? DOES[chosen[0].kind] : 'Offer them in a trade, or tap again to put them back.'}
            </p>
            <div className="bb-actions">
              {myCrow && chosen.length === 1 && (isIng(chosen[0].kind) || chosen[0].kind === 'masala') && (
                <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft} onClick={() => setMode({ feed: chosen[0].id })}>
                  Feed the Kauwa and send it on
                </button>
              )}
              <button type="button" className="btn btn-ink" disabled={!myTurn || !view.actionsLeft} onClick={() => (setMode({ trade: true }), setTradeTo(others[0]?.id ?? ''))}>
                Offer in a trade
              </button>
              <button type="button" className="btn btn-line" onClick={() => setSel([])}>
                Put back
              </button>
            </div>
          </>
        ) : myTurn ? (
          <>
            <div className="bb-actions">
              <button type="button" className={`btn btn-ink ${canBrew ? 'is-ready' : ''}`} disabled={!canBrew || !view.actionsLeft || !!myCrow} onClick={() => go({ a: 'brew' })}>
                ☕ Brew a cup
              </button>
              <button type="button" className="btn btn-line" disabled={!view.actionsLeft} onClick={() => (setMode({ trade: true }), setTradeTo(others[0]?.id ?? ''))}>
                Trade
              </button>
              <button type="button" className="btn btn-line" onClick={() => go({ a: 'end' })}>
                End turn
              </button>
            </div>
            <p className="bbt-note">{myCrow ? 'A Kauwa blocks brewing: tap an ingredient to feed it and send it on.' : canBrew ? 'You have everything to brew a cup!' : 'Tap a card to see what it does.'}</p>
          </>
        ) : (
          <p className="bbt-note">{view.phase === 'over' ? 'Game over.' : 'Tap a card to see what it does. You’ll draw 2 cards when your turn comes.'}</p>
        )}
      </div>

      </div>

      <details className="bbt-log">
        <summary>What happened</summary>
        <ol>
          {[...view.log].reverse().map((l, i) => (
            <li key={`${view.seq}-${i}`}>{l}</li>
          ))}
        </ol>
      </details>

      {footer}

      {raidOnMe && pd?.kind === 'bandit' && (
        <div className="bb-modal" role="alertdialog" aria-label="A Bandit is raiding your cup">
          <div className="bb-modal-box">
            <img className="bb-raider" src={BANDIT_IMG} alt="" />
            <p>
              <b>{name(pd.from)}</b> sent a Bandit to raid your cup! It scores nothing until the Bandit is gone. <b className="num">{left}s</b>
            </p>
            {newsTarget ? (
              <>
                <p>Shoo it onto whose cup?</p>
                <div className="bb-chips">
                  {others
                    .filter(p => p.cups.some(c => !c.bandit))
                    .map(p => (
                      <button key={p.id} type="button" className="bb-chip" onClick={() => go({ a: 'react', with: 'newspaper', target: p.id })}>
                        {p.name}
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <div className="bb-actions">
                <button type="button" className="btn btn-ink" disabled={!has('chappal')} onClick={() => go({ a: 'react', with: 'chappal' })}>
                  {ICON.chappal} Chase it off
                </button>
                <button type="button" className="btn btn-line" disabled={!has('newspaper') || !raidable} onClick={() => setNewsTarget(true)}>
                  {ICON.newspaper} Shoo it on
                </button>
                <button type="button" className="btn btn-line" onClick={() => go({ a: 'react', with: 'none' })}>
                  Let it be
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {havaldarMine && view.peek && (
        <div className="bb-modal" role="dialog" aria-label="The Havaldar's search">
          <div className="bb-modal-box">
            <p>
              <b>The Havaldar searched {name((pd as { target: string }).target)}’s cards.</b> Take any {Math.min(2, view.peek.length)}. <b className="num">{left}s</b>
            </p>
            <div className="bbt-peek">
              {view.peek.map(c => (
                <PlayingCard
                  key={c.id}
                  kind={c.kind}
                  size="sm"
                  selected={grab.includes(c.id)}
                  onClick={() => setGrab(g => (g.includes(c.id) ? g.filter(x => x !== c.id) : [...g, c.id].slice(-2)))}
                />
              ))}
            </div>
            <div className="bb-actions">
              <button type="button" className="btn btn-ink" disabled={grab.length < Math.min(2, view.peek.length)} onClick={() => (go({ a: 'havaldar-take', cards: grab }), setGrab([]))}>
                Take {grab.length === 1 ? 'this card' : 'these cards'}
              </button>
            </div>
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

const ORDER: CardKind[] = ['espresso', 'milk', 'gur', 'elaichi', 'seeds', 'masala', 'jugaad', 'bandit', 'chappal', 'newspaper', 'chor', 'monsoon'];
const order = (k: CardKind) => ORDER.indexOf(k);

function TradePanel(p: {
  others: GameView['players'];
  tradeTo: string;
  setTradeTo: (id: string) => void;
  giving: CardKind[];
  want: CardKind[];
  setWant: (f: (w: CardKind[]) => CardKind[]) => void;
  onSend: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <p>
        <b>Trade with</b>
      </p>
      <div className="bb-chips">
        {p.others.map(o => (
          <button key={o.id} type="button" className={`bb-chip ${p.tradeTo === o.id ? 'on' : ''}`} onClick={() => p.setTradeTo(o.id)}>
            {o.name}
          </button>
        ))}
      </div>
      <p>
        <b>You give:</b> {p.giving.length ? p.giving.map(k => `${ICON[k]} ${LABEL[k]}`).join(', ') : 'tap cards in your hand (ingredients, Masala, Chappal, Newspaper)'}
      </p>
      <p>
        <b>You ask for:</b> {p.want.length ? '' : 'tap below'}
      </p>
      <div className="bb-chips">
        {p.want.map((k, i) => (
          <button key={i} type="button" className="bb-chip on" onClick={() => p.setWant(w => w.filter((_, j) => j !== i))} aria-label={`Remove ${LABEL[k]}`}>
            {ICON[k]} {LABEL[k]} ✕
          </button>
        ))}
      </div>
      <div className="bb-chips">
        {TRADEABLE.map(k => (
          <button key={k} type="button" className="bb-chip" disabled={p.want.length >= 6} onClick={() => p.setWant(w => [...w, k])}>
            + {ICON[k]} {LABEL[k]}
          </button>
        ))}
      </div>
      <div className="bb-actions">
        <button type="button" className="btn btn-ink" disabled={!p.tradeTo || (!p.giving.length && !p.want.length)} onClick={p.onSend}>
          Offer the trade
        </button>
        <button type="button" className="btn btn-line" onClick={p.onBack}>
          Back
        </button>
      </div>
    </>
  );
}
