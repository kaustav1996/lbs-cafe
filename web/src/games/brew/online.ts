import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '../../lib/api';
import type { GameView, Move } from './engine';

export interface LobbyRoom {
  code: string;
  hostName: string;
  table: string | null;
  players: number;
  max: number;
}
export interface RoomInfo {
  code: string;
  host: string;
  max: number;
  status: 'waiting' | 'playing' | 'over';
  seats: { id: string; name: string; table: string | null; bot: boolean }[];
}

/** This phone's player id for game rooms (kept so a reload drops back into the same seat). */
export function playerId() {
  try {
    let id = localStorage.getItem('lbs.player.v1');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('lbs.player.v1', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
export function savedName() {
  try {
    return localStorage.getItem('lbs.player.name') ?? '';
  } catch {
    return '';
  }
}
export function saveName(n: string) {
  try {
    localStorage.setItem('lbs.player.name', n);
  } catch {
    /* fine */
  }
}

/** The live connection to the game rooms: the lobby, the room you're in, and your view of its game. */
export function useArcade(table: string, name: string) {
  const [lobby, setLobby] = useState<LobbyRoom[]>([]);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const id = useRef(playerId());

  useEffect(() => {
    if (!table || !name) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    let ping: ReturnType<typeof setInterval>;
    const base = (API_URL || window.location.origin).replace(/^http/, 'ws');
    const open = () => {
      const s = new WebSocket(`${base}/api/public/games/live?table=${encodeURIComponent(table)}`);
      ws.current = s;
      s.onopen = () => {
        setConnected(true);
        s.send(JSON.stringify({ t: 'hello', id: id.current, name }));
      };
      s.onmessage = ev => {
        if (ev.data === 'pong') return;
        const m = JSON.parse(ev.data as string);
        if (m.t === 'lobby') {
          setLobby(m.rooms);
          setRoom(null);
          setGame(null);
        } else if (m.t === 'room') {
          setRoom(m.room);
          setGame(m.game);
        } else if (m.t === 'error') {
          setError(m.message);
          setTimeout(() => setError(''), 4000);
        }
      };
      ping = setInterval(() => s.readyState === WebSocket.OPEN && s.send('ping'), 25_000);
      s.onclose = ev => {
        setConnected(false);
        clearInterval(ping);
        if (ev.code === 1008 || closed) return;
        retry = setTimeout(open, 2500);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(ping);
      ws.current?.close();
    };
  }, [table, name]);

  const send = useCallback((msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
    else setError('Reconnecting… try again in a moment.');
  }, []);
  const act = useCallback((move: Move) => send({ t: 'move', move }), [send]);
  return { me: id.current, lobby, room, game, error, connected, send, act };
}
