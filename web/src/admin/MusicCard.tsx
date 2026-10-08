import { useEffect, useState, type FormEvent } from 'react';
import { API_URL } from '../lib/api';
import { errText, useAuth } from './core';
import { toast } from './ui';

interface MusicSetting {
  file?: { key: string; name: string; type: string; size: number } | null;
  start?: number;
  end?: number | null;
}

/** 144 -> "2:24", 4304 -> "1:11:44". */
export function clockOf(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
/** "2:24" -> 144, "1:11:44" -> 4304, "" -> null; NaN when it can't be read. */
export function secondsOf(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(t)) return NaN;
  return t.split(':').reduce((a, p) => a * 60 + Number(p), 0);
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * The background music the site's record players and cassettes play: one MP3 (or M4A) and the part of it to
 * loop, from the start time to the end time.
 */
export default function MusicCard() {
  const { call, can, token } = useAuth();
  const manager = can('manager');
  const [music, setMusic] = useState<MusicSetting | null>(null);
  const [start, setStart] = useState('2:24');
  const [end, setEnd] = useState('1:11:44');
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const take = (m: MusicSetting | undefined) => {
    setMusic(m ?? {});
    if (m?.start !== undefined) setStart(clockOf(m.start));
    if (m && 'end' in m) setEnd(m.end ? clockOf(m.end) : '');
  };
  useEffect(() => {
    call<{ settings: { music?: MusicSetting } }>('/api/admin/settings')
      .then(r => take(r.settings.music))
      .catch(e => toast(errText(e), 'bad'));
  }, [call]);

  // A plain request with upload progress: a long set takes a while on cafe Wi-Fi.
  const upload = (file: File) => {
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${API_URL}/api/admin/music`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', file.type || (file.name.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg'));
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.upload.onprogress = e => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      let body: { settings?: { music?: MusicSetting }; message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        take(body.settings?.music);
        toast('Music uploaded. It plays on the site now.');
      } else toast(body.message ?? 'The upload didn’t go through. Try again.', 'bad');
    };
    xhr.onerror = () => {
      setProgress(null);
      toast('The upload stopped. Check the connection and try again.', 'bad');
    };
    xhr.send(file);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const s = secondsOf(start) ?? 0;
    const en = secondsOf(end);
    if (Number.isNaN(s) || Number.isNaN(en ?? 0)) return toast('Write times like 2:24 or 1:11:44.', 'bad');
    if (en !== null && en <= s) return toast('The end has to come after the start.', 'bad');
    setBusy(true);
    try {
      const r = await call<{ settings: { music?: MusicSetting } }>('/api/admin/settings', { method: 'PUT', json: { music: { start: s, end: en } } });
      take(r.settings.music);
      toast('Music times saved');
    } catch (err) {
      toast(errText(err), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await call<{ settings: { music?: MusicSetting } }>('/api/admin/music', { method: 'DELETE' });
      take(r.settings.music);
      toast('Music taken off the site');
    } catch (err) {
      toast(errText(err), 'bad');
    } finally {
      setBusy(false);
    }
  };

  if (!music) return null;
  return (
    <section className="a-card-panel">
      <h2>Music</h2>
      <p className="a-muted">
        The record player on the home page and the cassettes, Walkman and boombox around the site play this. Guests tap one to play or pause; it carries
        on where it stopped and loops from the start time once it reaches the end time. Upload an MP3 or M4A you have the rights to, up to 95 MB (96 or
        128 kbps keeps a long set small).
      </p>
      <form className="a-form" onSubmit={save}>
        <div className="a-field">
          <span>File</span>
          {music.file ? (
            <p>
              <b>{music.file.name}</b> <small className="a-muted">{mb(music.file.size)}</small>
            </p>
          ) : (
            <p className="a-muted">No music yet. The record player just spins.</p>
          )}
          {manager && (
            <input
              className="a-input"
              type="file"
              accept="audio/mpeg,audio/mp4,.mp3,.m4a"
              disabled={progress !== null}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = '';
              }}
            />
          )}
          {progress !== null && <small className="a-muted">Uploading… {progress}%</small>}
        </div>
        <div className="a-row2">
          <label className="a-field">
            <span>Start at</span>
            <input className="a-input" value={start} disabled={!manager} onChange={e => setStart(e.target.value)} placeholder="2:24" inputMode="numeric" />
          </label>
          <label className="a-field">
            <span>Go back to the start at</span>
            <input className="a-input" value={end} disabled={!manager} onChange={e => setEnd(e.target.value)} placeholder="End of the file" inputMode="numeric" />
          </label>
        </div>
        {manager && (
          <div className="a-actions">
            <button className="a-btn a-btn-primary" disabled={busy || progress !== null}>
              Save times
            </button>
            {music.file && (
              <button type="button" className="a-btn" disabled={busy || progress !== null} onClick={remove}>
                Take the music off
              </button>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
