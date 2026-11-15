# Harmonia

Harmonia is a React + Vite music discovery and playback interface backed by an Express server.

## Requirements

- Node.js 22 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

The development command starts the Express server with Vite middleware. Open the local URL printed by the server.

## Checks

```bash
npm test
npm run lint
npm run build
```

## Production deployment

Harmonia is a **full-stack Node application**, not a static-only website. The Express server provides the `/api/music/*` endpoints used for discovery, stream resolution, artwork, lyrics and playback. Build the frontend with `npm run build`, then run `npm start` on a Node host that can keep the Express process running.

GitHub Pages alone cannot run `server.ts` or provide these API routes. To use a static host, first deploy the backend separately and configure a same-origin reverse proxy for `/api/*`; do not expose private API credentials in browser code.

## Listener privacy

Likes, playlists, preferences and listening history are stored in the browser's localStorage. They are not written to a shared server-side JSON file. Clearing browser site data will clear this local library. Multi-device sync should only be added alongside real user authentication and per-account storage.

The server-side media proxy accepts public HTTPS URLs only, checks DNS-resolved addresses against conservative IPv4/IPv6 special-use ranges, and revalidates redirects to reduce server-side request forgery risk. Image responses are restricted to common raster formats and capped at 8 MB; the in-memory image cache is capped at 32 MB. Media proxy endpoints are rate-limited per client IP. Keep the server updated and review proxy host requirements when adding a new provider.

## Environment variables

Copy `.env.example` to `.env` only if you need its configured integrations. Keep real secrets out of Git; use your hosting provider's secret manager for production values.

## Music provider availability

Harmonia relies on third-party music catalogues and stream providers. Their APIs, availability, regional catalogues and terms can change independently of this project, so a successful build does not guarantee every external stream will remain available.


## Cloudflare Workers deployment (free-plan target)

Harmonia can run as one full-stack Cloudflare Worker: Express handles the existing `/api/*` routes, while Workers Static Assets serves the Vite React build. The Worker uses Cloudflare's Node.js HTTP server adapter and Node.js compatibility runtime.

### Local development

```bash
npm install
npm run dev
```

### Cloudflare local preview

```bash
npm run dev:cloudflare
```

### Deploy

```bash
npm run deploy:cloudflare
```

The deployment configuration intentionally uses no paid Cloudflare bindings, databases, AI services, or storage products. Keep the account on the Workers Free plan; do not enable a paid plan or paid add-ons. Free-plan quotas and product terms can change, so check the Cloudflare dashboard before increasing usage. Audio proxy traffic is subject to Worker request/subrequest and execution limits.

The media proxy retains HTTPS-only validation, DNS A/AAAA resolution, public-address checks, redirect revalidation, response-size caps, and per-isolate request throttling. Cloudflare Workers does not implement Node's `dns.lookup()`; the Worker adapter uses the supported `dns.resolve4()` and `dns.resolve6()` APIs over DNS-over-HTTPS instead. The local Node server continues using `dns.lookup()`.

Cloudflare deployment is deliberately separate from the existing Google Cloud Run proposal. Do not merge or deploy the Cloud Run branch to use this setup.
