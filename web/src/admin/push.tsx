import { useCallback, useEffect, useState } from 'react';
import { errText, useAuth } from './core';
import { toast } from './ui';

/**
 * Notifications on this phone: new orders, tables calling, orders ready and booking requests arrive with the
 * phone's own sound, even with the admin closed. On iPhone that needs the admin added to the Home Screen (iOS
 * 16.4+); Android Chrome works in the browser or installed.
 */

type State = 'loading' | 'unsupported' | 'install-first' | 'not-configured' | 'blocked' | 'off' | 'on';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(b64u: string) {
  const bin = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

/** Makes "Add to Home Screen" install the admin as its own app (name, icon, opens at /admin). */
export function useAdminApp() {
  useEffect(() => {
    const add = (tag: string, attrs: Record<string, string>) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      el.dataset.admin = '1';
      document.head.appendChild(el);
      return el;
    };
    const els = [
      add('link', { rel: 'manifest', href: '/admin.webmanifest' }),
      add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }),
      add('meta', { name: 'mobile-web-app-capable', content: 'yes' }),
      add('meta', { name: 'apple-mobile-web-app-title', content: 'LB’s admin' }),
      add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }),
    ];
    if (supported()) void navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' }).catch(() => {});
    return () => els.forEach(e => e.remove());
  }, []);
}

export function usePush() {
  const { call } = useAuth();
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (!supported()) return setState(isIOS() && !standalone() ? 'install-first' : 'unsupported');
    if (Notification.permission === 'denied') return setState('blocked');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/admin');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }, []);
  useEffect(() => void check(), [check]);

  const turnOn = async () => {
    setBusy(true);
    try {
      // Ask first, straight from the tap: iPhones won't show the prompt after other work.
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setState(perm === 'denied' ? 'blocked' : 'off');
      const { publicKey } = await call<{ publicKey: string | null }>('/api/admin/push');
      if (!publicKey) return setState('not-configured');
      const reg = (await navigator.serviceWorker.getRegistration('/admin')) ?? (await navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' }));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      await call('/api/admin/push', { method: 'POST', json: sub.toJSON() });
      setState('on');
      await call('/api/admin/push/test', { method: 'POST', json: { endpoint: sub.endpoint } }).catch(() => {});
      toast('Notifications are on for this phone. A test is on its way.');
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/admin');
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return setState('off');
      await call('/api/admin/push/test', { method: 'POST', json: { endpoint: sub.endpoint } });
      toast('Test sent. It should arrive in a few seconds.');
    } catch (e) {
      toast(errText(e), 'bad');
      void check();
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/admin');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await call('/api/admin/push', { method: 'DELETE', json: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
      }
      setState('off');
      toast('Notifications are off for this phone.');
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return { state, busy, turnOn, test, turnOff };
}

/** The panel: in the phone's More sheet and on Settings. */
export function PushPanel() {
  const { state, busy, turnOn, test, turnOff } = usePush();
  return (
    <section className="a-push" aria-labelledby="a-push-title">
      <h2 id="a-push-title">Notifications on this phone</h2>
      {state === 'loading' && <p className="a-hint">Checking…</p>}
      {state === 'on' && (
        <>
          <p className="a-push-state is-on">On. New orders, tables calling and orders ready arrive here with a sound, even with the admin closed.</p>
          <div className="a-actions">
            <button type="button" className="a-btn a-btn-sm" disabled={busy} onClick={test}>
              Send a test
            </button>
            <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy} onClick={turnOff}>
              Turn off
            </button>
          </div>
        </>
      )}
      {state === 'off' && (
        <>
          <p className="a-hint">Get new orders, tables calling and orders ready as notifications with a sound, even with the admin closed.</p>
          <button type="button" className="a-btn a-btn-primary a-btn-block" disabled={busy} onClick={turnOn}>
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </button>
        </>
      )}
      {state === 'install-first' && (
        <ol className="a-push-steps">
          <li>
            Open this page in <b>Safari</b>.
          </li>
          <li>
            Tap <b>Share</b>, then <b>Add to Home Screen</b>.
          </li>
          <li>
            Open <b>LB’s admin</b> from your Home Screen and turn notifications on here.
          </li>
        </ol>
      )}
      {state === 'blocked' && (
        <p className="a-hint">
          Notifications are blocked for LB’s admin. Allow them in the phone’s settings (Notifications, then LB’s admin, or the browser’s site settings), then
          come back here.
        </p>
      )}
      {state === 'unsupported' && <p className="a-hint">This browser can’t show notifications. On Android use Chrome; on iPhone add LB’s admin to the Home Screen from Safari.</p>}
      {state === 'not-configured' && <p className="a-hint">Phone notifications aren’t set up on the server yet. Ask Kaustav.</p>}
    </section>
  );
}

/** A one-time nudge at the top of the admin until this phone has notifications on (or says not now). */
export function PushNudge() {
  const { state, busy, turnOn } = usePush();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('lbs.admin.push-nudge') === 'no';
    } catch {
      return false;
    }
  });
  if (hidden || (state !== 'off' && state !== 'install-first')) return null;
  const notNow = () => {
    setHidden(true);
    try {
      localStorage.setItem('lbs.admin.push-nudge', 'no');
    } catch {
      /* fine */
    }
  };
  return (
    <div className="a-push-nudge" role="region" aria-label="Notifications">
      <p>
        {state === 'off'
          ? 'Get new orders and tables calling as notifications with a sound, even with the admin closed.'
          : 'For notifications with a sound on iPhone, add LB’s admin to your Home Screen: Share, then Add to Home Screen.'}
      </p>
      <div className="a-actions">
        {state === 'off' && (
          <button type="button" className="a-btn a-btn-primary a-btn-sm" disabled={busy} onClick={turnOn}>
            Turn on
          </button>
        )}
        <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={notNow}>
          Not now
        </button>
      </div>
    </div>
  );
}
