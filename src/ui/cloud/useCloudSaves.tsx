import {
  CircleCheck,
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
import { ACCOUNTS, checkAccount, getAccountState, subscribeAccount, type AccountState } from '../../account/account';
import { guidedSetupUrl, takeReturnIntent, type ReturnIntent } from '../../account/guided';
import { encodePhoto } from '../../cloud/photo';
import { stashPhoto, takeStashedPhoto } from '../../cloud/stash';
import { forgetToken, StorageError, uploadPhoto, type StorageProblem } from '../../cloud/storage';
import type { GlowEngine } from '../../engine/GlowEngine';
import { whenSplashDone } from '../../runtime';
import { CloudPopup, type PopupContent } from './CloudPopup';
import { Gallery } from './Gallery';

// The loader always shows for at least this long, so a quick answer doesn't flicker past.
const SAVE_LOADER_MS = 1300;
const ACCOUNT_LOADER_MS = 780;

// 'account' is the popup Glow shows by itself when the account needs action. It isn't on
// the way to anything, so it just closes once the account is sorted out.
type Intent = ReturnIntent;
type SignInStatus = 'guest' | 'incomplete' | 'action' | 'error';
type Failure = StorageProblem | 'capture' | 'encode';

type Popup =
  | { view: 'loading'; label: string }
  // resolving: the visitor opened the page that fixes their account, so coming back checks again.
  | { view: 'signin'; status: SignInStatus; intent: Intent; resolving?: boolean }
  // Back from the guided sign-in page, signed in.
  | { view: 'signedin'; intent: Intent; username: string }
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
  auth_unlink_google: 'Sign in with Google is no longer available for your account. Set a new password to avoid being locked out.',
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
        // Nothing was asked for, so only an account that still needs action is worth a popup.
        if (intent === 'account' && account.status !== 'action') {
          closePopup();
          return;
        }
        release();
        setPopup({ view: 'signin', status: signInStatus(account), intent });
        return;
      }
      if (intent === 'account') {
        await untilElapsed(start, ACCOUNT_LOADER_MS);
        if (flow.current !== id) return;
        closePopup();
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

  // Signing in goes to the retrac.space guided sign-in page in this tab, like Simple
  // Soundboard, and it sends the visitor back here afterwards. A photo that hasn't been saved
  // yet is kept for them meanwhile, so it can be saved once they're back.
  const goToGuidedSetup = useCallback(async (intent: Intent) => {
    const id = ++flow.current;
    const photo = pendingRef.current;
    if (photo) await stashPhoto(photo.blob, photo.takenAt);
    // A second click, or the popup closing, while the photo was being put away.
    if (flow.current !== id) return;
    window.location.assign(guidedSetupUrl(intent));
  }, []);

  // Back from guided setup: bring back any photo that was waiting, check the account, then
  // carry on with what the visitor was doing.
  const welcomeBack = useCallback(
    async (intent: Intent) => {
      const id = ++flow.current;
      const start = performance.now();
      setPopup({ view: 'loading', label: intent === 'save' ? 'Saving your photo' : 'Checking your account' });
      const stashed = await takeStashedPhoto();
      if (stashed && !pendingRef.current) {
        const photo = { ...stashed, url: URL.createObjectURL(stashed.blob) };
        replacePending(photo);
        pendingRef.current = photo;
      }
      if (flow.current !== id) return;
      const account = await checkAccount();
      if (flow.current !== id) return;

      const photo = pendingRef.current;
      if (account.status === 'authenticated' && intent === 'save' && photo) {
        await upload(id, photo, start);
        return;
      }
      await untilElapsed(start, ACCOUNT_LOADER_MS);
      if (flow.current !== id) return;
      release();
      if (account.status === 'authenticated') {
        setPopup({ view: 'signedin', intent, username: account.username });
      } else {
        setPopup({ view: 'signin', status: signInStatus(account), intent });
      }
    },
    [release, replacePending, upload],
  );

  useEffect(() => {
    const intent = takeReturnIntent();
    // After the loading screen, so the popup isn't hidden behind it.
    if (intent) whenSplashDone(() => void welcomeBack(intent));
  }, [welcomeBack]);

  // Opens the page that fixes the account in a new tab, and keeps this popup up meanwhile.
  // Coming back to Glow checks the account again, the same as after signing in.
  const resolveIssue = useCallback((intent: Intent, url: string) => {
    window.open(url, '_blank', 'noopener');
    setPopup({ view: 'signin', status: 'action', intent, resolving: true });
  }, []);

  const verify = useCallback(
    (intent: Intent) => {
      forgetToken();
      void continueSignedIn(intent);
    },
    [continueSignedIn],
  );

  // An account that needs action is told so once, straight away. After "Continue Signed Out",
  // the same popup comes back whenever they reach for saving or the gallery.
  useEffect(() => {
    let prompted = false;
    const onAccount = (account: AccountState) => {
      if (account.status !== 'action') {
        // A failed check doesn't mean the issue was sorted out.
        if (account.status !== 'error') prompted = false;
        return;
      }
      if (prompted) return;
      prompted = true;
      if (popupRef.current) return;
      setPopup({ view: 'signin', status: 'action', intent: 'account' });
    };
    onAccount(getAccountState());
    return subscribeAccount(onAccount);
  }, []);

  const watchIntent = popup?.view === 'signin' && popup.resolving ? popup.intent : null;

  useEffect(() => {
    if (watchIntent === null) return;
    const intent = watchIntent;
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
  }, [watchIntent, verify]);

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
      case 'signedin':
        return {
          key: `signedin-${state.intent}`,
          icon: CircleCheck,
          tone: 'success',
          title: 'You’re signed in',
          text: `Welcome, ${state.username}. Your photos now save to your retrac.space account.`,
          primary:
            state.intent === 'gallery'
              ? { label: 'View gallery', icon: Images, onClick: viewGallery }
              : { label: 'Done', onClick: closePopup },
          secondary: state.intent === 'gallery' ? close : undefined,
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
      intent === 'save'
        ? ' Your photo will be saved as soon as you’re back.'
        : ' We’ll bring you right back here when you’re done.';
    if (status === 'incomplete') {
      return {
        key,
        icon: UserRoundCog,
        tone: 'accent',
        title: 'Finish setting up your account',
        text: `Choose a username at retrac.space to start saving photos.${later}`,
        primary: { label: 'Finish setup', icon: LogIn, onClick: () => void goToGuidedSetup(intent) },
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
        title: 'Action is required on your account',
        text: `${reason ? `${reason} ` : ''}You can keep making light art, but saving photos and your gallery are off until it’s resolved.`,
        primary: { label: 'Resolve Issue', onClick: () => resolveIssue(intent, url) },
        secondary: { label: 'Continue Signed Out', onClick: closePopup },
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
          : `Sign in with your retrac.space account to see the photos you’ve saved, download them, and make room for more.${later}`,
      primary: { label: 'Sign in or create account', icon: LogIn, onClick: () => void goToGuidedSetup(intent) },
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
