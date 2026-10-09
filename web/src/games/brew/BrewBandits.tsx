import { useState } from 'react';
import { Board } from './Board';
import { useLocalGame } from './local';
import { savedName, saveName, useArcade } from './online';
import Tutorial from './Tutorial';
import { useGames } from '../../state/games';
import { useCart } from '../../state/cart';

type Screen = 'home' | 'tutorial' | 'practice' | 'online';

/** Brew Bandits: the tutorial, practice against bots on this phone, and rooms to play with people at any table. */
export default function BrewBandits() {
  const [screen, setScreen] = useState<Screen>('home');
  const [extended, setExtended] = useState(false);
  if (screen === 'tutorial') return <Tutorial onDone={setScreen} />;
  if (screen === 'practice') return <Practice extended={extended} onLeave={() => setScreen('home')} />;
  if (screen === 'online') return <Online onLeave={() => setScreen('home')} />;
  return (
    <div className="bb-home">
      <p className="lede">Race the others to brew hemp coffee. One of each of five ingredients makes a face-down cup worth 1 or 2 points; first to 5 wins. Our take on the Malaysian card game Nasi Lemak.</p>
      <ul className="bb-rules">
        <li>
          <b>Your turn:</b> draw 2 cards, then up to 3 actions: brew, trade ingredients, or play a special card.
        </li>
        <li>
          <b>Bandit</b> raids a cup so it scores nothing. <b>Chappal</b> chases it off; <b>Newspaper</b> shoos it onto someone else’s.
        </li>
        <li>
          <b>Havaldar</b> searches a hand and takes 2. <b>Chor</b> steals from everyone. <b>Kirana</b> makes everyone hand over an ingredient.{' '}
          <b>Mandi</b> keeps the ingredients from the top 3 cards.
        </li>
        <li>
          <b>Jugaad</b> brews with any 3 (two actions). <b>Masala</b> is wild.
        </li>
        <li>
          <b>The extension</b> (your choice): a <b>Kauwa</b> lands on whoever brews and blocks brewing until it’s fed and sent on; <b>Sheru</b>{' '}
          catches it; <b>Monsoon</b> makes everyone pass two cards left.
        </li>
      </ul>
      <div className="bb-home-actions">
        <button type="button" className="btn btn-ink btn-lg btn-block" onClick={() => setScreen('tutorial')}>
          Play the tutorial
        </button>
        <button type="button" className="btn btn-line btn-lg btn-block" onClick={() => setScreen('online')}>
          Play with others
        </button>
        <button type="button" className="btn btn-line btn-lg btn-block" onClick={() => setScreen('practice')}>
          Practice against bots
        </button>
        <label className="check bb-ext">
          <input type="checkbox" checked={extended} onChange={e => setExtended(e.target.checked)} />
          Practise with the extension (Kauwa, Sheru and Monsoon)
        </label>
      </div>
    </div>
  );
}

function Practice({ onLeave, extended }: { onLeave: () => void; extended: boolean }) {
  const local = useLocalGame(['Chai Bot', 'Masala Bot', 'Filter Bot'], { extended });
  return (
    <>
      {local.error && <p className="error bb-error">{local.error}</p>}
      <Board
        view={local.view}
        act={local.act}
        footer={
          <div className="bb-actions bb-footer">
            {local.view.phase === 'over' && (
              <button type="button" className="btn btn-ink" onClick={local.restart}>
                Play again
              </button>
            )}
            <button type="button" className="btn btn-line" onClick={onLeave}>
              Leave the game
            </button>
          </div>
        }
      />
    </>
  );
}

function Online({ onLeave }: { onLeave: () => void }) {
  const { table } = useGames();
  const cart = useCart();
  const [name, setName] = useState(() => savedName() || cart.name.trim().split(/\s+/)[0] || '');
  const [ready, setReady] = useState(!!savedName());
  const [seats, setSeats] = useState(4);
  const [ext, setExt] = useState(false);
  const live = useArcade(ready ? table : '', ready ? name : '');

  if (!ready)
    return (
      <form
        className="form bb-panel"
        onSubmit={e => {
          e.preventDefault();
          if (!name.trim()) return;
          saveName(name.trim());
          setReady(true);
        }}
      >
        <div className="field">
          <label htmlFor="bb-name">Your name at the table</label>
          <input id="bb-name" maxLength={24} value={name} onChange={e => setName(e.target.value)} autoComplete="given-name" />
        </div>
        <button type="submit" className="btn btn-ink btn-block" disabled={!name.trim()}>
          Find a room
        </button>
        <button type="button" className="btn btn-line btn-block" onClick={onLeave}>
          Back
        </button>
      </form>
    );

  const error = live.error && <p className="error bb-error">{live.error}</p>;
  const { room, game } = live;
  if (room && game)
    return (
      <>
        {error}
        <Board
          view={game}
          act={live.act}
          footer={
            <div className="bb-actions bb-footer">
              {room.status === 'over' && room.host === live.me && (
                <button type="button" className="btn btn-ink" onClick={() => live.send({ t: 'again' })}>
                  Play again
                </button>
              )}
              <button type="button" className="btn btn-line" onClick={() => live.send({ t: 'leave' })}>
                Leave the room
              </button>
            </div>
          }
        />
      </>
    );

  if (room) {
    const host = room.host === live.me;
    return (
      <div className="bb-room">
        {error}
        <h2>
          Room <span className="num">{room.code}</span>
        </h2>
        <p className="status-meta">
          {room.seats.length} of {room.max} seats taken. {host ? 'Start when everyone’s in, or fill seats with bots.' : 'Waiting for the host to start.'}
        </p>
        {host ? (
          <label className="check">
            <input type="checkbox" checked={!!room.extended} onChange={e => live.send({ t: 'extended', on: e.target.checked })} />
            Play with the extension (Kauwa, Sheru and Monsoon)
          </label>
        ) : (
          <p className="status-meta">{room.extended ? 'With the extension: Kauwa, Sheru and Monsoon.' : 'The base game, without the extension.'}</p>
        )}
        <ul className="bb-seats">
          {room.seats.map(s => (
            <li key={s.id}>
              <b>
                {s.name}
                {s.bot ? ' 🤖' : ''}
              </b>
              <span className="muted">{s.id === room.host ? 'Host' : s.table ? `Table ${s.table}` : s.bot ? 'Bot' : ''}</span>
            </li>
          ))}
        </ul>
        {host && (
          <div className="bb-actions">
            <button type="button" className="btn btn-line" disabled={room.seats.length >= room.max} onClick={() => live.send({ t: 'bot', add: true })}>
              Add a bot
            </button>
            <button type="button" className="btn btn-line" disabled={!room.seats.some(s => s.bot)} onClick={() => live.send({ t: 'bot', add: false })}>
              Remove a bot
            </button>
            <button type="button" className="btn btn-ink" disabled={room.seats.length < 2} onClick={() => live.send({ t: 'start' })}>
              Start the game
            </button>
          </div>
        )}
        <button type="button" className="btn btn-line btn-block" onClick={() => live.send({ t: 'leave' })}>
          Leave the room
        </button>
      </div>
    );
  }

  return (
    <div className="bb-lobby">
      {error}
      {!live.connected && <p className="status-meta">Connecting…</p>}
      <section className="bb-panel">
        <h2>Start a room</h2>
        <div className="field">
          <label htmlFor="bb-seats">Seats</label>
          <select id="bb-seats" value={seats} onChange={e => setSeats(Number(e.target.value))}>
            {Array.from({ length: 9 }, (_, i) => i + 2).map(n => (
              <option key={n} value={n}>
                {n} players
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={ext} onChange={e => setExt(e.target.checked)} />
          Play with the extension (Kauwa, Sheru and Monsoon)
        </label>
        <button type="button" className="btn btn-ink btn-block" disabled={!live.connected} onClick={() => live.send({ t: 'create', max: seats, extended: ext })}>
          Create a room
        </button>
      </section>
      <section>
        <h2>Rooms waiting for players</h2>
        {live.lobby.length === 0 ? (
          <p className="status-meta">No rooms open right now. Start one and others at LB’s can join.</p>
        ) : (
          <ul className="bb-seats">
            {live.lobby.map(r => (
              <li key={r.code}>
                <span>
                  <b>{r.hostName}’s room</b>
                  <br />
                  <span className="muted">
                    {r.table ? `Table ${r.table}, ` : ''}
                    {r.players} of {r.max} seats{r.extended ? ', with the extension' : ''}
                  </span>
                </span>
                <button type="button" className="btn btn-ink btn-sm" onClick={() => live.send({ t: 'join', code: r.code })}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="status-meta">
        Playing as <b>{name}</b>.{' '}
        <button type="button" className="linkish" onClick={() => setReady(false)}>
          Change
        </button>
      </p>
      <button type="button" className="btn btn-line btn-block" onClick={onLeave}>
        Back
      </button>
    </div>
  );
}
