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

Harmonia is a **full-stack Node application**, not a static-only website. The Express server provides the `/api/music/*` endpoints used for discovery, stream resolution, artwork, lyrics and playback.

### Google Cloud Run

The repository includes a Dockerfile and a GitHub Actions workflow at `.github/workflows/cloudrun.yml`. The workflow always runs tests, type checking and a production build on the default branch. It deploys only after the Google Cloud Workload Identity Federation settings below have been added as GitHub **Actions repository variables**.

Required repository variables:

- `GCP_PROJECT_ID`: Google Cloud project ID.
- `GCP_WORKLOAD_IDENTITY_PROVIDER`: full Workload Identity Provider resource name.
- `GCP_SERVICE_ACCOUNT`: service account email used by GitHub Actions.

Before the first deployment, create an Artifact Registry Docker repository named `harmonia` in `asia-south1`, configure a Workload Identity Pool and GitHub OIDC provider, and grant the service account permission to push images and deploy Cloud Run services. The service account typically needs Artifact Registry Writer and Cloud Run deployment permissions, plus Service Account User on the runtime service account. Grant the GitHub federated principal permission to impersonate the deployment service account.

The workflow deliberately does **not** make the service publicly accessible automatically. Review Cloud Run IAM and grant public invocation only if you intentionally want an unauthenticated public music website. Store private API credentials in Google Secret Manager or Cloud Run environment secrets, never in Git.

GitHub Pages cannot run `server.ts` or provide Harmonia's API routes. The old repository-upload Pages workflow has therefore been removed; use Cloud Run for the full application.

## Listener privacy

Likes, playlists, preferences and listening history are stored in the browser's localStorage. They are not written to a shared server-side JSON file. Clearing browser site data will clear this local library. Multi-device sync should only be added alongside real user authentication and per-account storage.

The server-side media proxy accepts public HTTPS URLs only, checks DNS-resolved addresses against conservative IPv4/IPv6 special-use ranges, and revalidates redirects to reduce server-side request forgery risk. Image responses are restricted to common raster formats and capped at 8 MB; the in-memory image cache is capped at 32 MB. Media proxy endpoints are rate-limited per client IP. Keep the server updated and review proxy host requirements when adding a new provider.

## Environment variables

Copy `.env.example` to `.env` only if you need its configured integrations. Keep real secrets out of Git; use your hosting provider's secret manager for production values.

## Music provider availability

Harmonia relies on third-party music catalogues and stream providers. Their APIs, availability, regional catalogues and terms can change independently of this project, so a successful build does not guarantee every external stream will remain available.
