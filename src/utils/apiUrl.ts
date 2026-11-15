const configuredApiBase = String(import.meta.env?.VITE_API_BASE_URL || '');
const API_BASE_URL = configuredApiBase.endsWith('/')
  ? configuredApiBase.slice(0, -1)
  : configuredApiBase;

/**
 * Build API URLs for both the browser deployment (same-origin) and the
 * packaged Android app (which calls the production Worker over HTTPS).
 */
export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return API_BASE_URL + normalizedPath;
}
