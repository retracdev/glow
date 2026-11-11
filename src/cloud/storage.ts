/*
 * Glow's saved photos, kept by the retrac.space Storage API. The API owns the list, the
 * save limit, and who may see or delete what. Glow only asks, and decides what to say.
 */
import { fetchToken, TokenError } from '../account/account';

const API = 'https://space-api.retrac-space.workers.dev/v1/storage';
const CATEGORY = 'glow/saves';
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 45000;
const REQUEST_TIMEOUT_MS = 15000;
// Tokens last about 5 minutes. Reuse one briefly so a gallery visit isn't a token per call.
const TOKEN_REUSE_MS = 4 * 60 * 1000;

export interface SavedImage {
  id: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  createdAt: number;
  url: string;
}

export interface Quota {
  limit: number;
  used: number;
}

export interface SavesPage {
  images: SavedImage[];
  nextOffset: number | null;
  quota: Quota | null;
}

/*
 * signed_out         no account, or it couldn't prove who it is
 * username_required  signed in, but the account has no username yet
 * limit              every save slot is used
 * too_large          over the upload size limit
 * invalid            the API wouldn't take the image
 * rate_limited       too many saves or deletes in a short time
 * offline            the device has no connection
 * network            the request didn't get through or took too long
 * not_found          the image is already gone
 * not_allowed        the API refused (for example, this website isn't allowed)
 * unavailable        the API or its storage is having trouble
 */
export type StorageProblem =
  | 'signed_out'
  | 'username_required'
  | 'limit'
  | 'too_large'
  | 'invalid'
  | 'rate_limited'
  | 'offline'
  | 'network'
  | 'not_found'
  | 'not_allowed'
  | 'unavailable';

export class StorageError extends Error {
  constructor(
    public problem: StorageProblem,
    public status = 0,
    public details: Record<string, unknown> = {},
  ) {
    super(problem);
  }

  /** Whether the same request could work if tried again later. */
  get retryable(): boolean {
    return ['offline', 'network', 'rate_limited', 'unavailable'].includes(this.problem);
  }
}

let cachedToken: { token: string; until: number } | null = null;

async function token(fresh: boolean): Promise<string> {
  if (!fresh && cachedToken && Date.now() < cachedToken.until) return cachedToken.token;
  cachedToken = null;
  try {
    const value = await fetchToken();
    cachedToken = { token: value, until: Date.now() + TOKEN_REUSE_MS };
    return value;
  } catch (error) {
    const status = error instanceof TokenError ? error.status : 0;
    if (status === 0) throw new StorageError(navigator.onLine ? 'network' : 'offline');
    if (status === 401 || status === 403) throw new StorageError('signed_out', status);
    if (status === 429) throw new StorageError('rate_limited', status);
    throw new StorageError('unavailable', status);
  }
}

/** Forgets the reused token, for example after signing in as someone else. */
export function forgetToken() {
  cachedToken = null;
}

function problemFor(status: number, code: string | undefined): StorageProblem {
  if (status === 401) return 'signed_out';
  if (status === 403) return code === 'username_required' ? 'username_required' : 'not_allowed';
  if (status === 404) return 'not_found';
  if (status === 409 && code === 'storage_limit_reached') return 'limit';
  if (status === 413 || code === 'image_too_large') return 'too_large';
  if (status === 400 || status === 415) return 'invalid';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  // One fresh-token retry if the reused token turns out to have expired. Never more.
  for (let attempt = 0; ; attempt++) {
    const auth = await token(attempt > 0);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(API + path, {
        ...init,
        cache: 'no-store',
        signal: controller.signal,
        headers: { ...init.headers, Authorization: `Bearer ${auth}` },
      });
    } catch {
      throw new StorageError(navigator.onLine ? 'network' : 'offline');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 && attempt === 0) continue;
    const body = await response.json().catch(() => null);
    if (response.ok) return body?.data as T;
    if (response.status === 401) cachedToken = null;
    // Errors look like { error: { code, ...details } }. Older shapes put the code at the top.
    const error = body?.error;
    const details: Record<string, unknown> =
      error && typeof error === 'object' ? error : { ...body, code: typeof error === 'string' ? error : undefined };
    const code = typeof details.code === 'string' ? details.code : undefined;
    throw new StorageError(problemFor(response.status, code), response.status, details);
  }
}

function readImage(value: any): SavedImage | null {
  if (!value || typeof value.id !== 'string' || typeof value.url !== 'string') return null;
  // Only ever show pictures from the Storage API itself.
  if (!value.url.startsWith(API + '/files/')) return null;
  return {
    id: value.id,
    url: value.url,
    mimeType: String(value.mimeType ?? ''),
    size: Number(value.size) || 0,
    width: Number(value.width) || 0,
    height: Number(value.height) || 0,
    createdAt: Number(value.createdAt) || 0,
  };
}

export async function uploadPhoto(photo: Blob): Promise<SavedImage> {
  if (photo.size > MAX_UPLOAD_BYTES) throw new StorageError('too_large');
  const data = await request<unknown>(
    `/images?category=${encodeURIComponent(CATEGORY)}`,
    { method: 'POST', headers: { 'Content-Type': photo.type }, body: photo },
    UPLOAD_TIMEOUT_MS,
  );
  const image = readImage(data);
  if (!image) throw new StorageError('unavailable');
  return image;
}

export async function listPhotos(offset = 0): Promise<SavesPage> {
  const data = await request<any>(`/images?category=${encodeURIComponent(CATEGORY)}&limit=50&offset=${offset}`);
  // Expected: { images, limit, offset, nextOffset, quota: { limit, used } }. A bare array is
  // accepted too, in case the shape ever changes.
  const raw: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.images) ? data.images : [];
  const images = raw.map(readImage).filter((image): image is SavedImage => image !== null);
  const quota = data?.quota;
  return {
    images,
    nextOffset: typeof data?.nextOffset === 'number' ? data.nextOffset : null,
    quota:
      quota && Number.isFinite(quota.limit) && Number.isFinite(quota.used)
        ? { limit: Number(quota.limit), used: Number(quota.used) }
        : null,
  };
}

export async function deletePhoto(id: string): Promise<void> {
  try {
    await request(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (error) {
    // Already gone is what was wanted.
    if (error instanceof StorageError && error.problem === 'not_found') return;
    throw error;
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function photoFileName(createdAt: number, mimeType: string): string {
  const date = new Date(createdAt || Date.now());
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(
    date.getMinutes(),
  )}.${pad(date.getSeconds())}`;
  return `Glow ${stamp}.${EXTENSIONS[mimeType] ?? 'png'}`;
}

export function saveBlobAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Downloads a saved photo. If the file can't be fetched here, it opens in a new tab instead. */
export async function downloadPhoto(image: SavedImage): Promise<void> {
  try {
    const response = await fetch(image.url, { mode: 'cors' });
    if (!response.ok) throw new Error('Download failed');
    saveBlobAs(await response.blob(), photoFileName(image.createdAt, image.mimeType));
  } catch {
    window.open(image.url, '_blank', 'noopener');
  }
}
