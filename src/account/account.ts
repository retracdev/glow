/*
 * The visitor's retrac.space account, using the same flow as Simple Soundboard.
 *
 * The sign-in cookie belongs to accounts.retrac.space and is never readable here. This
 * asks that site who is signed in. Nothing is stored.
 */

const ACCOUNTS = 'https://accounts.retrac.space';
const SESSION_TIMEOUT_MS = 5000;

/*
 * unknown        nothing has been checked yet
 * authenticated  signed in, with a username
 * incomplete     signed in, but the account has no username yet
 * action         signed in, but the account needs something sorted out first
 * guest          not signed in
 * error          the check failed, so we can't tell
 */
export type AccountState =
  | { status: 'unknown' | 'incomplete' | 'guest' | 'error' }
  | { status: 'authenticated'; username: string }
  | { status: 'action'; reason: string | null; url: string | null };

type Listener = (state: AccountState) => void;

let state: AccountState = { status: 'unknown' };
let inFlight: Promise<AccountState> | null = null;
const listeners = new Set<Listener>();

function publish(next: AccountState): AccountState {
  state = next;
  listeners.forEach((listener) => listener(state));
  return state;
}

// Only ordinary https pages are worth linking to.
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function readSession(session: any): AccountState | null {
  if (session === null) return { status: 'guest' };
  // Accounts only ever tells other websites the username: { user: { username } }.
  const user = session?.user;
  if (!user) return null;
  const action = session.actionRequired;
  if (action?.required === true) {
    return {
      status: 'action',
      reason: typeof action.reason === 'string' ? action.reason : null,
      url: safeUrl(action.url),
    };
  }
  const username = user.username;
  return typeof username === 'string' && username.trim()
    ? { status: 'authenticated', username }
    : { status: 'incomplete' };
}

async function requestSession(): Promise<AccountState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  try {
    const response = await fetch(ACCOUNTS + '/api/auth/get-session', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Session unavailable');
    const next = readSession(await response.json());
    if (!next) throw new Error('Unexpected session');
    return publish(next);
  } catch {
    // A failed recheck isn't a sign-out. Anyone signed in stays that way until a real
    // answer says otherwise.
    return state.status === 'authenticated' || state.status === 'action'
      ? state
      : publish({ status: 'error' });
  } finally {
    clearTimeout(timeout);
  }
}

export function getAccountState(): AccountState {
  return state;
}

// Everyone asking at the same moment shares one request.
export function checkAccount(): Promise<AccountState> {
  if (!inFlight) {
    inFlight = requestSession().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function subscribeAccount(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
