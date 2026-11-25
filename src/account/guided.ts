/*
 * The retrac.space guided sign-in, as in Simple Soundboard. Signing in goes to
 * accounts.retrac.space/guided-setup in this tab, and that page sends the visitor back here
 * with ?signed-in=<what they were doing>, so Glow can carry on with it.
 */
import { ACCOUNTS } from './account';

const GUIDED_URL = ACCOUNTS + '/guided-setup';
const SITE_URL = 'https://glowstudio.retrac.space/';
// 960x1200, made by `npm run build:art`. Guided setup only shows art from retrac.space.
const GUIDED_IMAGE = SITE_URL + 'guided-setup.jpg';
const RETURN_PARAM = 'signed-in';

/** What the visitor was on their way to when they went to sign in. */
export type ReturnIntent = 'save' | 'gallery' | 'account';
const INTENTS: readonly ReturnIntent[] = ['save', 'gallery', 'account'];

// Guided setup only sends people back to retrac.space sites and localhost, so anywhere else
// (a preview host, say) comes back to the real site instead.
function returnUrl(intent: ReturnIntent): string {
  const here = new URL(window.location.href);
  const host = here.hostname;
  const allowed =
    /^https?:$/.test(here.protocol) &&
    (host === 'retrac.space' || host.endsWith('.retrac.space') || host === 'localhost');
  const url = allowed ? here : new URL(SITE_URL);
  url.searchParams.set(RETURN_PARAM, intent);
  return url.href;
}

export function guidedSetupUrl(intent: ReturnIntent): string {
  const params = new URLSearchParams({ app: 'Glow', redirect: returnUrl(intent), image: GUIDED_IMAGE });
  return GUIDED_URL + '?' + params;
}

// Read once, then taken out of the address so a reload or a copied link doesn't repeat it.
function takeReturnFlag(): ReturnIntent | null {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(RETURN_PARAM)) return null;
    const value = url.searchParams.get(RETURN_PARAM) as ReturnIntent;
    url.searchParams.delete(RETURN_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    return INTENTS.includes(value) ? value : 'account';
  } catch {
    return null;
  }
}

let returned = takeReturnFlag();

/** True when this page load came straight back from guided setup. */
export const returnedFromSignIn = returned !== null;

/** What the visitor was doing before guided setup, handed out only once. */
export function takeReturnIntent(): ReturnIntent | null {
  const intent = returned;
  returned = null;
  return intent;
}
