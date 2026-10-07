import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { HAS_API } from '../lib/api';
import { asset } from '../state/ui';
import { AuthProvider, StreamProvider, errText, useAuth, useOnEvent, useStream } from './core';
import { Toasts, toast } from './ui';
import Orders from './Orders';
import Pos from './Pos';
import MenuAdmin from './MenuAdmin';
import Bookings from './Bookings';
import Reports from './Reports';
import Customers from './Customers';
import Offers from './Offers';
import Settings from './Settings';
import './admin.css';

export default function AdminApp() {
  useEffect(() => {
    document.title = "LB's admin";
    document.body.classList.add('admin-body');
    return () => document.body.classList.remove('admin-body');
  }, []);
  return (
    <AuthProvider>
      <Gate />
      <Toasts />
    </AuthProvider>
  );
}

function Gate() {
  const { me, ready } = useAuth();
  if (!HAS_API)
    return (
      <div className="a-login">
        <div className="a-login-card">
          <h1 className="a-brand">LB's admin</h1>
          <p>The admin needs the API. Set VITE_API_URL when building the site, then reload.</p>
        </div>
      </div>
    );
  if (!ready) return <div className="admin-boot">Loading…</div>;
  if (!me) return <Login />;
  return (
    <StreamProvider>
      <Shell />
    </StreamProvider>
  );
}

function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="a-login">
      <form className="a-login-card" onSubmit={submit}>
        <img src={asset('img/bandit-256.webp')} alt="" width="72" />
        <h1 className="a-brand">LB's admin</h1>
        <label className="a-field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="a-field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <p className="a-error">{error}</p>}
        <button className="a-btn a-btn-primary a-btn-lg" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const NAV = [
  { to: '/admin', label: 'Orders', end: true, icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/admin/pos', label: 'New order', icon: 'M12 5v14M5 12h14' },
  { to: '/admin/bookings', label: 'Bookings', icon: 'M7 3v3M17 3v3M4 8h16M5 5h14v15H5z' },
  { to: '/admin/menu', label: 'Menu', icon: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h3' },
  { to: '/admin/reports', label: 'Reports', icon: 'M5 20V10M12 20V4M19 20v-7' },
  { to: '/admin/offers', label: 'Offers', icon: 'M9 15l6-6M9.5 9.5h.01M14.5 14.5h.01M4 12l8-8 8 8-8 8z' },
  { to: '/admin/customers', label: 'Customers', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0' },
  { to: '/admin/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
];

function Shell() {
  const { me, signOut } = useAuth();
  const { connected, soundOn, setSoundOn, chime } = useStream();
  const [bookingBadge, setBookingBadge] = useState(0);

  useOnEvent(['order.created'], e => {
    chime('order');
    toast(`New order #${e.number}${e.table ? `, table ${e.table}` : e.source === 'takeaway' ? ', takeaway' : ''}`);
  });
  useOnEvent(['service.created'], e => {
    chime('call');
    toast(`Table ${e.table} wants ${e.kind === 'bill' ? 'the bill' : e.kind === 'water' ? 'water' : 'a server'}`);
  });
  useOnEvent(['reservation.created'], () => {
    setBookingBadge(n => n + 1);
    toast('New table booking request');
  });

  return (
    <div className="a-shell">
      <aside className="a-side">
        <div className="a-side-head">
          <img src={asset('img/bandit-256.webp')} alt="" width="36" />
          <span className="a-brand">LB's</span>
        </div>
        <nav className="a-nav" aria-label="Admin">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => n.to.endsWith('bookings') && setBookingBadge(0)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d={n.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{n.label}</span>
              {n.to.endsWith('bookings') && bookingBadge > 0 && <b className="a-badge">{bookingBadge}</b>}
            </NavLink>
          ))}
        </nav>
        <div className="a-side-foot">
          <button type="button" className={`a-sound ${soundOn ? 'on' : ''}`} onClick={() => setSoundOn(!soundOn)}>
            {soundOn ? 'Sound on' : 'Turn sound on'}
          </button>
          <p className={`a-conn ${connected ? 'ok' : ''}`}>
            <i aria-hidden="true" />
            {connected ? 'Live' : 'Reconnecting…'}
          </p>
          <p className="a-me">
            {me?.name}
            <small>{me?.role}</small>
          </p>
          <button type="button" className="a-link" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="a-main">
        <Routes>
          <Route index element={<Orders />} />
          <Route path="pos" element={<Pos />} />
          <Route path="bookings" element={<Bookings />} />
          <Route path="menu" element={<MenuAdmin />} />
          <Route path="reports" element={<Reports />} />
          <Route path="offers" element={<Offers />} />
          <Route path="customers" element={<Customers />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
