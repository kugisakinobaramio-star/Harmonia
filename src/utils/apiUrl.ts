const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\\/+$/, '');

/**
 * Build API URLs for both the browser deployment (same-origin) and the
 * packaged Android app (which calls the production Worker over HTTPS).
 */
export function apiUrl(path: string): string {
  if (/^https?:\\/\\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
