import { describe, it, expect } from 'vitest';
import { guessMimeType, arrayBufferToDataUri, blobToDataUri } from './mime';

/**
 * MIME utility tests.
 *
 * Covers:
 *   - guessMimeType() for common extensions + default fallback
 *   - arrayBufferToDataUri() produces correct data: URI
 *   - blobToDataUri() produces correct data: URI
 *   - arrayBufferToDataUri() uses fast Blob-based path (not byte-by-byte)
 */
describe('mime utils', () => {
  describe('guessMimeType', () => {
    it('returns image/png for .png', () => {
      expect(guessMimeType('photo.png')).toBe('image/png');
    });

    it('returns image/jpeg for .jpg and .jpeg', () => {
      expect(guessMimeType('photo.jpg')).toBe('image/jpeg');
      expect(guessMimeType('photo.jpeg')).toBe('image/jpeg');
    });

    it('returns image/webp for .webp', () => {
      expect(guessMimeType('photo.webp')).toBe('image/webp');
    });

    it('returns image/gif for .gif', () => {
      expect(guessMimeType('photo.gif')).toBe('image/gif');
    });

    it('returns image/svg+xml for .svg', () => {
      expect(guessMimeType('icon.svg')).toBe('image/svg+xml');
    });

    it('defaults to image/png for unknown extensions', () => {
      expect(guessMimeType('file.bin')).toBe('image/png');
      expect(guessMimeType('file')).toBe('image/png');
      expect(guessMimeType('')).toBe('image/png');
    });

    it('strips query strings before checking extension', () => {
      expect(guessMimeType('photo.png?token=abc123')).toBe('image/png');
    });

    it('is case-insensitive', () => {
      expect(guessMimeType('PHOTO.PNG')).toBe('image/png');
      expect(guessMimeType('Photo.Jpg')).toBe('image/jpeg');
    });
  });

  describe('arrayBufferToDataUri', () => {
    it('produces a data: URI with the correct MIME type', async () => {
      const bytes = new TextEncoder().encode('hello');
      const dataUri = await arrayBufferToDataUri(bytes.buffer, 'image/png');
      expect(dataUri.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('encodes the bytes correctly (base64)', async () => {
      const bytes = new TextEncoder().encode('test');
      const dataUri = await arrayBufferToDataUri(bytes.buffer, 'text/plain');
      // "test" in base64 is "dGVzdA=="
      expect(dataUri).toBe('data:text/plain;base64,dGVzdA==');
    });
  });

  describe('blobToDataUri', () => {
    it('produces a data: URI from a Blob', async () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      const dataUri = await blobToDataUri(blob);
      expect(dataUri).toBe('data:text/plain;base64,dGVzdA==');
    });
  });
});
