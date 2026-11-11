import {
  CloudAlert,
  CloudCheck,
  Hourglass,
  ImageOff,
  Images,
  LogIn,
  RotateCw,
  ShieldAlert,
  TriangleAlert,
  UserRound,
  UserRoundCog,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ACCOUNTS, checkAccount, getAccountState, type AccountState } from '../../account/account';
import { encodePhoto } from '../../cloud/photo';
import { forgetToken, StorageError, uploadPhoto, type StorageProblem } from '../../cloud/storage';
import type { GlowEngine } from '../../engine/GlowEngine';
import { CloudPopup, type PopupContent } from './CloudPopup';
import { Gallery } from './Gallery';

// The loader always shows for at least this long, so a quick answer doesn't flicker past.
const SAVE_LOADER_MS = 1300;
const ACCOUNT_LOADER_MS = 780;

type Intent = 'save' | 'gallery';
type SignInStatus = 'guest' | 'incomplete' | 'action' | 'error';
type Failure = StorageProblem | 'capture' | 'encode';

type Popup =
  | { view: 'loading'; label: string }
  | { view: 'signin'; status: SignInStatus; intent: Intent }
  | { view: 'waiting'; intent: Intent }
  | { view: 'saved' }
  | { view: 'limit'; limit: number | null }
  | { view: 'failed'; failure: Failure };

/** A photo that's been taken but isn't in the cloud yet. */
export interface PendingPhoto {
  blob: Blob;
  url: string;
  takenAt: number;
}

const ACTION_REASONS: Record<string, string> = {
  account_review: 'Your account needs a quick review. There may be a few steps to verify it’s really you.',
  inappropriate_username: 'Your username isn’t allowed and needs to be changed.',
  inappropriate_content: 'Some of what you’ve posted on retrac.space needs to be removed.',
  account_suspended: 'Your account is temporarily unavailable.',
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const untilElapsed = (start: number, ms: number) => wait(Math.max(0, start + ms - performance.now()));

function signInStatus(account: AccountState): SignInStatus {
  if (account.status === 'incomplete' || account.status === 'action' || account.status === 'error') return account.status;
  return 'guest';
}

export function useCloudSaves(engineRef: RefObject<GlowEngine | null>) {
  const [popup, setPopup] = useState<Popup | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [flashId, setFlashId] = useState(0);
  // Bumped whenever a flow is replaced or closed, so late answers from the old one are ignored.
  const flow = useRef(0);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const popupRef = useRef(popup);
  popupRef.current = popup;
  const trigger = useRef<HTMLElement | null>(null);

  const replacePending = useCallback((next: PendingPhoto | null) => {
    setPending((previous) => {
      if (previous && previous !== next) URL.revokeObjectURL(previous.url);
      return next;
    });
  }, []);

  useEffect(() => () => {
    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.url);
  }, []);

  const release = useCallback(() => engineRef.current?.release(), [engineRef]);

  const closePopup = useCallback(() => {
    flow.current++;
    release();
    setPopup(null);
    const el = trigger.current;
    trigger.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, [release]);

  const remember = () => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el !== document.body) trigger.current = el;
  };

  /** Uploads the pending photo behind the loader, then says how it went. */
  const upload = useCallback(
    async (id: number, photo: PendingPhoto, start: number) => {
      let next: Popup;
      try {
        await uploadPhoto(photo.blob);
        next = { view: 'saved' };
      } catch (error) {
        const problem = error instanceof StorageError ? error.problem : 'unavailable';
        if (problem === 'limit') {
          const limit = Number((error as StorageError).details.limit);
          next = { view: 'limit', limit: Number.isFinite(limit) ? limit : null };
        } else if (problem === 'signed_out' || problem === 'username_required') {
          forgetToken();
          const account = await checkAccount();
          next = {
            view: 'signin',
            status: problem === 'username_required' ? 'incomplete' : signInStatus(account),
            intent: 'save',
          };
        } else {
          next = { view: 'failed', failure: problem };
        }
      }
      await untilElapsed(start, SAVE_LOADER_MS);
      if (flow.current !== id) return;
      if (next.view === 'saved') {
        setPending((current) => {
          if (current === photo) {
            URL.revokeObjectURL(photo.url);
            return null;
          }
          return current;
        });
      }
      release();
      setPopup(next);
    },
    [release],
  );

  /** Makes sure someone is signed in before saving or opening the gallery. */
  const continueSignedIn = useCallback(
    async (intent: Intent, start = performance.now()) => {
      const id = ++flow.current;
      setPopup({ view: 'loading', label: intent === 'save' ? 'Saving your photo' : 'Checking your account' });
      let account = getAccountState();
      if (account.status !== 'authenticated') account = await checkAccount();
      if (flow.current !== id) return;

      if (account.status !== 'authenticated') {
        await untilElapsed(start, ACCOUNT_LOADER_MS);
        if (flow.current !== id) return;
        release();
        setPopup({ view: 'signin', status: signInStatus(account), intent });
        return;
      }
      if (intent === 'gallery') {
        await untilElapsed(start, ACCOUNT_LOADER_MS);
        if (flow.current !== id) return;
        closePopup();
        setGalleryOpen(true);
        return;
      }
      const photo = pendingRef.current;
      if (!photo) {
        closePopup();
        return;
      }
      await upload(id, photo, start);
    },
    [closePopup, release, upload],
  );

  const takePhoto = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || popupRef.current?.view === 'loading') return;
    remember();
    const id = ++flow.current;
    const start = performance.now();
    setPopup({ view: 'loading', label: 'Saving your photo' });
    setFlashId((n) => n + 1);

    const canvas = await engine.capture();
    const blob = canvas ? await encodePhoto(canvas) : null;
    if (flow.current !== id) return;
    if (!blob) {
      await untilElapsed(start, SAVE_LOADER_MS);
      if (flow.current !== id) return;
      release();
      setPopup({ view: 'failed', failure: canvas ? 'encode' : 'capture' });
      return;
    }
    // A new photo takes the place of any earlier one that wasn't saved.
    const photo = { blob, url: URL.createObjectURL(blob), takenAt: Date.now() };
    replacePending(photo);
    pendingRef.current = photo;
    // continueSignedIn starts its own flow, carrying on from this one's loader.
    await continueSignedIn('save', start);
  }, [continueSignedIn, engineRef, release, replacePending]);

  const openGallery = useCallback(() => {
    if (getAccountState().status === 'authenticated') {
      setGalleryOpen(true);
      return;
    }
    remember();
    void continueSignedIn('gallery');
  }, [continueSignedIn]);

  const retrySave = useCallback(() => {
    const photo = pendingRef.current;
    if (!photo) {
      closePopup();
      return;
    }
    const id = ++flow.current;
    setPopup({ view: 'loading', label: 'Saving your photo' });
    void upload(id, photo, performance.now());
  }, [closePopup, upload]);

  const viewGallery = useCallback(() => {
    closePopup();
    setGalleryOpen(true);
  }, [closePopup]);

  // Sign-in happens in a new tab, like Simple Soundboard. Coming back checks the account.
  const openAccounts = useCallback((intent: Intent, url = ACCOUNTS) => {
    window.open(url, '_blank', 'noopener');
    setPopup({ view: 'waiting', intent });
  }, []);

  const verify = useCallback(
    (intent: Intent) => {
      forgetToken();
      void continueSignedIn(intent);
    },
    [continueSignedIn],
  );

  useEffect(() => {
    if (popup?.view !== 'waiting') return;
    const intent = popup.intent;
    let away = document.hidden || !document.hasFocus();
    let timer = 0;
    const leave = () => {
      away = true;
    };
    const back = () => {
      if (!away || document.hidden) return;
      // visibilitychange and focus usually arrive together, so act on just one of them.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.hidden || !document.hasFocus()) return;
        away = false;
        verify(intent);
      }, 200);
    };
    const onVisibility = () => (document.hidden ? leave() : back());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
    };
  }, [popup, verify]);

  const content = popup && popup.view !== 'loading' ? describe(popup) : null;

  function describe(state: Exclude<Popup, { view: 'loading' }>): PopupContent {
    const close = { label: 'Close', onClick: closePopup };
    switch (state.view) {
      case 'saved':
        return {
          key: `saved-${flow.current}`,
          icon: CloudCheck,
          tone: 'success',
          title: 'Saved to the cloud',
          text: 'Your photo is safe in your retrac.space account. Find it any time in your gallery.',
          primary: { label: 'View gallery', icon: Images, onClick: viewGallery },
          secondary: close,
        };
      case 'limit':
        return {
          key: 'limit',
          icon: TriangleAlert,
          tone: 'warning',
          title: 'Your save limit was reached',
          text: `You’ve used ${state.limit ? `all ${state.limit}` : 'all'} of your saves. Go to your gallery and delete some photos to make room for new ones. This photo will be waiting there for you.`,
          primary: { label: 'Go to gallery', icon: Images, onClick: viewGallery },
          secondary: close,
        };
      case 'waiting':
        return {
          key: `waiting-${state.intent}`,
          icon: UserRound,
          tone: 'accent',
          title: 'Finish signing in',
          text: 'Sign in or create your account in the new tab. When you’re done, come back here and Glow will pick up where you left off.',
          status: 'Waiting for your account',
          primary: { label: 'I’ve signed in', onClick: () => verify(state.intent) },
          secondary: { label: 'Open retrac.space again', onClick: () => openAccounts(state.intent) },
        };
      case 'signin':
        return describeSignIn(state.status, state.intent);
      case 'failed':
        return describeFailure(state.failure);
    }
  }

  function describeSignIn(status: SignInStatus, intent: Intent): PopupContent {
    const key = `signin-${status}-${intent}`;
    const notNow = { label: 'Not now', onClick: closePopup };
    const later =
      intent === 'save' ? ' Your photo will be saved as soon as you’re signed in.' : '';
    if (status === 'incomplete') {
      return {
        key,
        icon: UserRoundCog,
        tone: 'accent',
        title: 'Finish setting up your account',
        text: `Choose a username at retrac.space to start saving photos, then come back here.${later}`,
        primary: { label: 'Open retrac.space', icon: LogIn, onClick: () => openAccounts(intent) },
        secondary: notNow,
      };
    }
    if (status === 'action') {
      const account = getAccountState();
      const reason = account.status === 'action' && account.reason ? ACTION_REASONS[account.reason] : undefined;
      const url = account.status === 'action' && account.url ? account.url : ACCOUNTS;
      return {
        key,
        icon: ShieldAlert,
        tone: 'warning',
        title: 'Your account needs attention',
        text: `${reason ? `${reason} ` : ''}Saving photos and your gallery are off until it’s sorted out.`,
        primary: { label: 'Resolve issue', onClick: () => openAccounts(intent, url) },
        secondary: notNow,
      };
    }
    if (status === 'error') {
      return {
        key,
        icon: CloudAlert,
        tone: 'danger',
        title: 'Couldn’t check your account',
        text: 'We couldn’t reach retrac.space just now. Check your connection and try again.',
        primary: { label: 'Try again', icon: RotateCw, onClick: () => verify(intent) },
        secondary: { label: 'Close', onClick: closePopup },
      };
    }
    return {
      key,
      icon: UserRound,
      tone: 'accent',
      title: 'You need a retrac.space account',
      text:
        intent === 'save'
          ? `Sign in with your retrac.space account to save photos to the cloud and see them in your gallery.${later}`
          : 'Sign in with your retrac.space account to see the photos you’ve saved, download them, and make room for more.',
      primary: { label: 'Sign in', icon: LogIn, onClick: () => openAccounts(intent) },
      secondary: notNow,
    };
  }

  function describeFailure(failure: Failure): PopupContent {
    const key = `failed-${failure}-${flow.current}`;
    const close = { label: 'Close', onClick: closePopup };
    const retry = { label: 'Try again', icon: RotateCw, onClick: retrySave };
    switch (failure) {
      case 'capture':
        return {
          key,
          icon: ImageOff,
          tone: 'danger',
          title: 'Couldn’t take a photo',
          text: 'Glow couldn’t capture the canvas just now. Give it a moment, then try again.',
          primary: { label: 'Try again', icon: RotateCw, onClick: () => void takePhoto() },
          secondary: close,
        };
      case 'offline':
        return {
          key,
          icon: WifiOff,
          tone: 'danger',
          title: 'You’re offline',
          text: 'Your photo can’t be saved without an internet connection. Reconnect, then try again.',
          primary: retry,
          secondary: close,
        };
      case 'network':
        return {
          key,
          icon: CloudAlert,
          tone: 'danger',
          title: 'Couldn’t reach the cloud',
          text: 'Your photo didn’t make it to retrac.space. Check your connection and try again.',
          primary: retry,
          secondary: close,
        };
      case 'rate_limited':
        return {
          key,
          icon: Hourglass,
          tone: 'warning',
          title: 'Slow down a little',
          text: 'You’re saving photos really quickly. Wait a minute, then try again.',
          primary: retry,
          secondary: close,
        };
      case 'not_allowed':
        return {
          key,
          icon: ShieldAlert,
          tone: 'danger',
          title: 'Saving isn’t available here',
          text: 'retrac.space didn’t allow this photo to be saved from this page.',
          primary: close,
        };
      case 'too_large':
      case 'invalid':
      case 'encode':
        return {
          key,
          icon: ImageOff,
          tone: 'danger',
          title: 'This photo couldn’t be saved',
          text: 'Something about this photo didn’t work out. Try taking another one.',
          primary: { label: 'Take another', icon: RotateCw, onClick: () => void takePhoto() },
          secondary: close,
        };
      default:
        return {
          key,
          icon: CloudAlert,
          tone: 'danger',
          title: 'Saving isn’t working right now',
          text: 'retrac.space is having trouble saving photos. Try again in a moment.',
          primary: retry,
          secondary: close,
        };
    }
  }

  const saved = useCallback(() => replacePending(null), [replacePending]);

  const needSignIn = useCallback(() => {
    setGalleryOpen(false);
    forgetToken();
    setPopup({ view: 'signin', status: 'guest', intent: 'gallery' });
  }, []);

  const takeFromGallery = useCallback(() => {
    setGalleryOpen(false);
    // Let the gallery leave first, so the photo is of Glow and the toolbar is back.
    window.setTimeout(() => void takePhoto(), 120);
  }, [takePhoto]);

  const busy = popup?.view === 'loading';
  const element = (
    <>
      {flashId > 0 && <div key={flashId} className="camera-flash" aria-hidden="true" />}
      {galleryOpen && (
        <Gallery
          pending={pending}
          onSaved={saved}
          onDiscard={() => replacePending(null)}
          onNeedSignIn={needSignIn}
          onTakePhoto={takeFromGallery}
          onClose={() => setGalleryOpen(false)}
        />
      )}
      {popup && (
        <CloudPopup
          content={content}
          busy={busy}
          busyLabel={popup.view === 'loading' ? popup.label : ''}
          onClose={closePopup}
        />
      )}
    </>
  );

  return {
    takePhoto,
    openGallery,
    busy,
    modalOpen: popup !== null || galleryOpen,
    element,
  };
}
