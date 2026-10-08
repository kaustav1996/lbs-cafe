/** The LB's card sign-in on this phone (90 days). The API decides whether it still works. */
import { useEffect, useState } from 'react';

const KEY = 'lbs.card.v1';
const EVENT = 'lbs-card';

/** Whether this phone holds an LB's card, kept up to date when one is claimed or removed. */
export function useHasCard() {
  const [has, setHas] = useState(() => !!getCardToken());
  useEffect(() => {
    const update = () => setHas(!!getCardToken());
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return has;
}

export function getCardToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setCardToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Storage blocked: the guest signs in again next time.
  }
}
