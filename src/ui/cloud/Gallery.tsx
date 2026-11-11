import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CloudAlert,
  CloudUpload,
  Download,
  Images,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deletePhoto,
  downloadPhoto,
  listPhotos,
  photoFileName,
  saveBlobAs,
  StorageError,
  uploadPhoto,
  type Quota,
  type SavedImage,
  type StorageProblem,
} from '../../cloud/storage';
import type { PendingPhoto } from './useCloudSaves';

interface GalleryProps {
  pending: PendingPhoto | null;
  onSaved: () => void;
  onDiscard: () => void;
  onNeedSignIn: () => void;
  onTakePhoto: () => void;
  onClose: () => void;
}

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'failed'; problem: StorageProblem };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function problemOf(error: unknown): StorageProblem {
  return error instanceof StorageError ? error.problem : 'unavailable';
}

function problemText(problem: StorageProblem, doing: string): string {
  switch (problem) {
    case 'offline':
      return `You’re offline, so Glow couldn’t ${doing}. Reconnect and try again.`;
    case 'network':
      return `Glow couldn’t reach retrac.space to ${doing}. Check your connection and try again.`;
    case 'rate_limited':
      return 'That’s a lot at once. Wait a minute, then try again.';
    case 'limit':
      return 'Your gallery is full. Delete a photo to make room.';
    case 'not_allowed':
      return `retrac.space didn’t allow Glow to ${doing} from this page.`;
    case 'too_large':
    case 'invalid':
      return 'This photo couldn’t be saved. Try taking another one.';
    default:
      return `retrac.space is having trouble, so Glow couldn’t ${doing}. Try again in a moment.`;
  }
}

export function Gallery({ pending, onSaved, onDiscard, onNeedSignIn, onTakePhoto, onClose }: GalleryProps) {
  const [images, setImages] = useState<SavedImage[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(() => new Set());
  const [savingPending, setSavingPending] = useState(false);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const noticeId = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const say = useCallback((text: string) => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, text });
  }, []);

  // Signed out partway through: hand back to the sign-in popup.
  const failed = useCallback(
    (error: unknown, doing: string): StorageProblem => {
      const problem = problemOf(error);
      if (problem === 'signed_out' || problem === 'username_required') onNeedSignIn();
      else say(problemText(problem, doing));
      return problem;
    },
    [onNeedSignIn, say],
  );

  const refresh = useCallback(async () => {
    setLoad({ state: 'loading' });
    try {
      const page = await listPhotos(0);
      if (!alive.current) return;
      setImages(page.images);
      setQuota(page.quota);
      setNextOffset(page.nextOffset);
      setLoad({ state: 'ready' });
    } catch (error) {
      if (!alive.current) return;
      const problem = problemOf(error);
      if (problem === 'signed_out' || problem === 'username_required') onNeedSignIn();
      else setLoad({ state: 'failed', problem });
    }
  }, [onNeedSignIn]);

  useEffect(() => {
    void refresh();
    panelRef.current?.focus({ preventScroll: true });
  }, [refresh]);

  const loadMore = async () => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listPhotos(nextOffset);
      if (!alive.current) return;
      setImages((current) => {
        const seen = new Set(current.map((image) => image.id));
        return [...current, ...page.images.filter((image) => !seen.has(image.id))];
      });
      if (page.quota) setQuota(page.quota);
      setNextOffset(page.nextOffset);
    } catch (error) {
      if (alive.current) failed(error, 'load more photos');
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  };

  const remove = async (image: SavedImage) => {
    setConfirming(null);
    setDeleting((set) => new Set(set).add(image.id));
    try {
      await deletePhoto(image.id);
      if (!alive.current) return;
      setImages((current) => current.filter((item) => item.id !== image.id));
      setQuota((current) => (current ? { ...current, used: Math.max(0, current.used - 1) } : current));
      setViewing((current) => (current === image.id ? null : current));
      say('Photo deleted.');
    } catch (error) {
      if (alive.current) failed(error, 'delete that photo');
    } finally {
      if (alive.current)
        setDeleting((set) => {
          const next = new Set(set);
          next.delete(image.id);
          return next;
        });
    }
  };

  const savePending = async () => {
    if (!pending || savingPending) return;
    setSavingPending(true);
    try {
      const image = await uploadPhoto(pending.blob);
      if (!alive.current) return;
      onSaved();
      setImages((current) => [image, ...current.filter((item) => item.id !== image.id)]);
      setQuota((current) => (current ? { ...current, used: current.used + 1 } : current));
      say('Saved to the cloud.');
    } catch (error) {
      if (!alive.current) return;
      const problem = failed(error, 'save your photo');
      // The real count lives on the server, so catch up with it.
      if (problem === 'limit') void refresh();
    } finally {
      if (alive.current) setSavingPending(false);
    }
  };

  const index = viewing ? images.findIndex((image) => image.id === viewing) : -1;
  const viewed = index >= 0 ? images[index] : null;
  const step = useCallback(
    (by: number) => {
      if (index < 0 || !images.length) return;
      setViewing(images[(index + by + images.length) % images.length].id);
    },
    [images, index],
  );

  useEffect(() => {
    // Glow's own shortcuts are off while the gallery is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirming) setConfirming(null);
        else if (viewing) setViewing(null);
        else onClose();
      } else if (viewing && e.key === 'ArrowLeft') step(-1);
      else if (viewing && e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirming, viewing, step, onClose]);

  const full = quota !== null && quota.used >= quota.limit;
  const empty = load.state === 'ready' && images.length === 0 && !pending;

  return (
    <div
      className="gallery-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="gallery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gallery-title"
        tabIndex={-1}
      >
        <header className="gallery-head">
          <div className="gallery-heading">
            <Images size={20} strokeWidth={1.8} aria-hidden="true" />
            <div>
              <h2 id="gallery-title">Your gallery</h2>
              {quota && (
                <p className="gallery-quota">
                  {quota.used} of {quota.limit} saves used
                </p>
              )}
            </div>
          </div>
          {quota && (
            <div
              className={`gallery-meter${full ? ' is-full' : ''}`}
              role="meter"
              aria-label="Saves used"
              aria-valuemin={0}
              aria-valuemax={quota.limit}
              aria-valuenow={quota.used}
            >
              <span style={{ width: `${Math.min(100, (quota.used / Math.max(1, quota.limit)) * 100)}%` }} />
            </div>
          )}
          <button type="button" className="panel-icon gallery-close" aria-label="Close gallery" onClick={onClose}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="gallery-body">
          {load.state === 'failed' && (
            <div className="gallery-empty">
              <CloudAlert size={40} strokeWidth={1.6} aria-hidden="true" />
              <h3>Couldn’t load your gallery</h3>
              <p>{problemText(load.problem, 'load your photos')}</p>
              <button type="button" className="gallery-button" onClick={() => void refresh()}>
                <RotateCw aria-hidden="true" />
                Try again
              </button>
            </div>
          )}

          {empty && (
            <div className="gallery-empty">
              <Camera size={40} strokeWidth={1.6} aria-hidden="true" />
              <h3>No photos yet</h3>
              <p>Press the camera in the toolbar to save a picture of your glow. It’ll show up here.</p>
              <button type="button" className="gallery-button" onClick={onTakePhoto}>
                <Camera aria-hidden="true" />
                Take a photo
              </button>
            </div>
          )}

          {(load.state === 'loading' || (load.state === 'ready' && !empty)) && (
            <ul className="gallery-grid" aria-busy={load.state === 'loading'}>
              {pending && (
                <li className="gallery-tile is-pending">
                  <img src={pending.url} alt="Your newest photo, not saved yet" />
                  <div className="gallery-pending">
                    <span className="gallery-badge">Not saved yet</span>
                    {full && <p>Delete a photo to make room for this one.</p>}
                    <div className="gallery-pending-actions">
                      <button
                        type="button"
                        className="gallery-button is-small"
                        disabled={savingPending || full || load.state !== 'ready'}
                        onClick={() => void savePending()}
                      >
                        {savingPending ? <span className="gallery-spinner" aria-hidden="true" /> : <CloudUpload aria-hidden="true" />}
                        {savingPending ? 'Saving' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="gallery-icon"
                        aria-label="Download this photo"
                        title="Download"
                        onClick={() => saveBlobAs(pending.blob, photoFileName(pending.takenAt, pending.blob.type))}
                      >
                        <Download aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="gallery-icon"
                        aria-label="Discard this photo"
                        title="Discard"
                        disabled={savingPending}
                        onClick={onDiscard}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </li>
              )}
              {load.state === 'loading'
                ? Array.from({ length: 6 }, (_, i) => <li key={i} className="gallery-tile is-skeleton" aria-hidden="true" />)
                : images.map((image) => {
                    const busy = deleting.has(image.id);
                    const date = dateFormat.format(image.createdAt);
                    return (
                      <li key={image.id} className={`gallery-tile${busy ? ' is-busy' : ''}`}>
                        <button
                          type="button"
                          className="gallery-open"
                          aria-label={`Open photo from ${date}`}
                          onClick={() => setViewing(image.id)}
                        >
                          <img src={image.url} alt="" loading="lazy" decoding="async" />
                        </button>
                        <div className="gallery-meta">
                          <span>{date}</span>
                          <div className="gallery-tile-actions">
                            <button
                              type="button"
                              className="gallery-icon"
                              aria-label={`Download photo from ${date}`}
                              title="Download"
                              onClick={() => void downloadPhoto(image)}
                            >
                              <Download aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="gallery-icon is-danger"
                              aria-label={`Delete photo from ${date}`}
                              title="Delete"
                              disabled={busy}
                              onClick={() => setConfirming(image.id)}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                        {confirming === image.id && (
                          <div className="gallery-confirm" role="alertdialog" aria-label="Delete this photo?">
                            <p>Delete this photo?</p>
                            <span>This can’t be undone.</span>
                            <div>
                              <button type="button" className="gallery-button is-small is-danger" autoFocus onClick={() => void remove(image)}>
                                Delete
                              </button>
                              <button type="button" className="gallery-button is-small is-quiet" onClick={() => setConfirming(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                        {busy && <span className="gallery-spinner is-center" role="status" aria-label="Deleting" />}
                      </li>
                    );
                  })}
            </ul>
          )}

          {load.state === 'ready' && nextOffset !== null && (
            <button type="button" className="gallery-button gallery-more" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? <span className="gallery-spinner" aria-hidden="true" /> : null}
              {loadingMore ? 'Loading' : 'Load more'}
            </button>
          )}
        </div>

        {viewed && (
          <div className="gallery-viewer" role="dialog" aria-label={`Photo from ${dateFormat.format(viewed.createdAt)}`}>
            <div className="gallery-viewer-bar">
              <button type="button" className="gallery-button is-small is-quiet" onClick={() => setViewing(null)}>
                <ChevronLeft aria-hidden="true" />
                All photos
              </button>
              <span>{dateFormat.format(viewed.createdAt)}</span>
              <div className="gallery-tile-actions">
                <button type="button" className="gallery-icon" aria-label="Download" title="Download" onClick={() => void downloadPhoto(viewed)}>
                  <Download aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="gallery-icon is-danger"
                  aria-label="Delete"
                  title="Delete"
                  disabled={deleting.has(viewed.id)}
                  onClick={() => setConfirming(viewed.id)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="gallery-stage">
              {images.length > 1 && (
                <button type="button" className="gallery-nav is-prev" aria-label="Previous photo" onClick={() => step(-1)}>
                  <ChevronLeft aria-hidden="true" />
                </button>
              )}
              <img src={viewed.url} alt={`Glow photo from ${dateFormat.format(viewed.createdAt)}`} />
              {images.length > 1 && (
                <button type="button" className="gallery-nav is-next" aria-label="Next photo" onClick={() => step(1)}>
                  <ChevronRight aria-hidden="true" />
                </button>
              )}
              {confirming === viewed.id && (
                <div className="gallery-confirm" role="alertdialog" aria-label="Delete this photo?">
                  <p>Delete this photo?</p>
                  <span>This can’t be undone.</span>
                  <div>
                    <button type="button" className="gallery-button is-small is-danger" autoFocus onClick={() => void remove(viewed)}>
                      Delete
                    </button>
                    <button type="button" className="gallery-button is-small is-quiet" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {notice && (
          <p key={notice.id} className="gallery-notice" role="status">
            {notice.text}
          </p>
        )}
      </section>
    </div>
  );
}
