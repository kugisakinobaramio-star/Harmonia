/**
 * A failed resolver refresh must not invalidate previously discovered sources.
 * Returning the original object also preserves provider metadata and stable identity.
 */
export function preserveTrackAfterFailedRefresh<T extends object>(track: T): T {
  return track;
}
