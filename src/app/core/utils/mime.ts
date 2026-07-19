/**
 * MIME type helpers — shared across image services.
 *
 * Single source of truth for inferring MIME type from a filename or
 * extension. Used by `ImageResolverService`, `FirstLoginMergeService`,
 * and `FirebaseStorageService`.
 */

/** Infer MIME type from a URL or filename by extension. Defaults to
 *  `image/png` when the extension is unknown (common default for
 *  browser-renderable images). */
export function guessMimeType(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0] ?? '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    default: return 'image/png';
  }
}

/** Convert an ArrayBuffer to a `data:<mime>;base64,...` URI.
 *
 *  Uses `FileReader.readAsDataURL` on a Blob — much faster than the
 *  naive byte-by-byte `String.fromCharCode` + `btoa` approach
 *  (especially for multi-MB images: O(n) vs O(n) with huge constant
 *  factor from string concatenation). */
export function arrayBufferToDataUri(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  return blobToDataUri(new Blob([buffer], { type: mimeType }));
}

/** Convert a Blob to a `data:<mime>;base64,...` URI via FileReader. */
export function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(
      reader.error instanceof Error ? reader.error : new Error(String(reader.error)),
    );
    reader.readAsDataURL(blob);
  });
}
