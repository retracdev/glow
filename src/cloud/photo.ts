import { MAX_UPLOAD_BYTES } from './storage';

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function scaled(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (scale === 1) return source;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Glow's soft gradients make big PNGs, so photos are WebP (or JPEG where WebP can't be
// made), stepping down until they fit the 2 MB upload limit.
const ATTEMPTS: [type: string, quality: number][] = [
  ['image/webp', 0.92],
  ['image/jpeg', 0.92],
  ['image/webp', 0.8],
  ['image/jpeg', 0.8],
];

/** Encodes a captured photo small enough to upload, or resolves null if it can't. */
export async function encodePhoto(photo: HTMLCanvasElement): Promise<Blob | null> {
  for (const scale of [1, 0.75, 0.5]) {
    const canvas = scaled(photo, scale);
    for (const [type, quality] of ATTEMPTS) {
      const blob = await toBlob(canvas, type, quality);
      // Browsers that can't make a type quietly hand back a PNG instead, so check.
      if (blob && blob.type === type && blob.size <= MAX_UPLOAD_BYTES) return blob;
    }
  }
  return null;
}
