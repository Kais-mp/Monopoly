/**
 * Where the game server lives.
 *
 * Empty means "same origin", which is what the single-service deployment (the
 * backend serving the built client) uses. Set `VITE_SERVER_URL` at build time
 * to point a separately hosted frontend — Vercel, for example — at the Azure
 * App Service running the game server.
 */
const raw = (import.meta.env.VITE_SERVER_URL ?? '').trim();

/** Normalised base URL with no trailing slash, or '' for same-origin. */
export const SERVER_URL = raw.replace(/\/+$/, '');

/** Builds an absolute URL for a server route, honouring SERVER_URL. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return SERVER_URL ? SERVER_URL + suffix : suffix;
}
