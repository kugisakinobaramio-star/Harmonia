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

Harmonia is a **full-stack Node application**, not a static-only website. The Express server provides the `/api/music/*` endpoints used for discovery, stream resolution, artwork, lyrics and playback. The frontend and API should be deployed together behind the same origin.

### Deploy to Google Cloud Run

The repository includes `.github/workflows/deploy-cloud-run.yml`. It uses Google Cloud Buildpacks to build the Node.js app from source and deploy the Express service to Cloud Run. The Node.js buildpack runs the `build` script when present and starts the app using `npm start`.

Before enabling the workflow, configure these GitHub repository variables:

- `GCP_CLOUD_RUN_DEPLOY_ENABLED`: set to `true` only after the remaining configuration is complete
- `GCP_PROJECT_ID`: Google Cloud project ID
- `GCP_REGION`: Cloud Run region, for example `asia-south1`
- `GCP_CLOUD_RUN_SERVICE`: optional service name; defaults to `harmonia`

Configure these GitHub repository secrets:

- `GCP_WIF_PROVIDER`: full Workload Identity Federation provider resource name
- `GCP_WIF_SERVICE_ACCOUNT`: Google service account email permitted to deploy

Use Workload Identity Federation rather than storing a long-lived service-account JSON key in GitHub. The deployer identity needs the permissions required to deploy Cloud Run and act as the Cloud Run service identity. The Cloud Build build identity also needs the Cloud Run Builder role to build and deploy from source. Enable the Cloud Run, Cloud Build and Artifact Registry APIs in the Google Cloud project.

The workflow runs on pushes to `main` and can also be started manually. It is deliberately gated: until `GCP_CLOUD_RUN_DEPLOY_ENABLED=true`, the deploy job is skipped. Once configured, it deploys a public service because Harmonia is intended to be a public music web app. Review the service's access policy before enabling deployment.

GitHub Pages cannot run `server.ts` or provide the Express API routes. The old Pages workflow has been removed so it cannot publish the repository source as though that were a working application deployment.

For a manual deployment from a configured Google Cloud environment, run:

```bash
gcloud run deploy harmonia --source . --region REGION --project PROJECT_ID --allow-unauthenticated
```

Cloud Run supplies the `PORT` environment variable; the Express server listens on it and serves the production Vite build from `dist`.

## Listener privacy

Likes, playlists, preferences and listening history are stored in the browser's localStorage. They are not written to a shared server-side JSON file. Clearing browser site data will clear this local library. Multi-device sync should only be added alongside real user authentication and per-account storage.

The server-side media proxy accepts public HTTPS URLs only, checks DNS-resolved addresses against conservative IPv4/IPv6 special-use ranges, and revalidates redirects to reduce server-side request forgery risk. Image responses are restricted to common raster formats and capped at 8 MB; the in-memory image cache is capped at 32 MB. Media proxy endpoints are rate-limited per client IP. Keep the server updated and review proxy host requirements when adding a new provider.

## Environment variables

Copy `.env.example` to `.env` only if you need its configured integrations. Keep real secrets out of Git; use your hosting provider's secret manager for production values.

## Music provider availability

Harmonia relies on third-party music catalogues and stream providers. Their APIs, availability, regional catalogues and terms can change independently of this project, so a successful build does not guarantee every external stream will remain available.
