import { useEffect, useState } from 'react';
import { Footer, Nav } from '../components/Chrome';
import { api, ApiError, HAS_API } from '../lib/api';

interface Licence {
  id: string;
  name: string;
  number: string;
  validUntil?: string | null;
  file?: { key: string; name: string; type: string } | null;
}

const longDate = (d: string) =>
  new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** GSTIN (from Settings → Bill details) and the licences listed in Settings → Licences. */
export default function Licences() {
  const [data, setData] = useState<{ gstin: string; licences: Licence[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = "Licences and registrations | LB's";
    if (!HAS_API) return setData({ gstin: '', licences: [] });
    api<{ cafe?: { gstin?: string }; licences?: Licence[] }>('/api/public/settings')
      .then(s => setData({ gstin: s.cafe?.gstin ?? '', licences: s.licences ?? [] }))
      .catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t load the licence details. Refresh to try again.'));
  }, []);

  const empty = data && !data.gstin && data.licences.length === 0;

  return (
    <div className="zone-night">
      <Nav tone="night" />
      <main className="wrap status-page licences-page">
        <header>
          <h1 className="display">Licences and registrations</h1>
          <p className="status-meta">LB's Hemp Cafe & Lounge, Salt Lake, Kolkata.</p>
        </header>
        {!data && !error && <p className="status-meta">Loading…</p>}
        {error && <p>{error}</p>}
        {empty && <p>Licence details are coming soon.</p>}
        {data && !empty && (
          <ul className="licence-list">
            {data.gstin && (
              <li className="licence">
                <h2>GST registration</h2>
                <p className="licence-number">
                  GSTIN <span className="num">{data.gstin}</span>
                </p>
              </li>
            )}
            {data.licences.map(l => (
              <li key={l.id} className="licence">
                <h2>{l.name}</h2>
                {l.number && (
                  <p className="licence-number">
                    Number <span className="num">{l.number}</span>
                  </p>
                )}
                {l.validUntil && <p className="status-meta">Valid until {longDate(l.validUntil)}</p>}
                {l.file && (
                  <a className="btn btn-lemon" href={`/files/${l.file.key}`} target="_blank" rel="noreferrer">
                    View document
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </div>
  );
}
