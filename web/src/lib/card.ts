/** The LB's card sign-in on this phone (90 days). The API decides whether it still works. */
const KEY = 'lbs.card.v1';

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
  } catch {
    // Storage blocked: the guest signs in again next time.
  }
}
