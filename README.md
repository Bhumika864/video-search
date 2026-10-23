# video-search

video-search accepts video files uploaded from your device. It transcribes speech with AssemblyAI, stores timestamped transcript segments in MongoDB, and lets you search the transcript and jump to a matching timestamp.

Accounts have separate video libraries. Search supports optional whole-word matching and previous/next result navigation. Notes can be saved at the player's current time or at a selected search result.

## Requirements

- Node.js 20 or newer
- MongoDB, local or hosted
- An AssemblyAI API key

## Configure the backend

In PowerShell:

```powershell
Set-Location 'D:\Projects\New folder\server'
npm install
Copy-Item .env.example .env
```

Edit `server/.env` and set:

- `MONGODB_URI`
- `ASSEMBLYAI_API_KEY`
- `AUTH_TOKEN_SECRET` to a random secret of at least 32 characters
- `VECTOR_SEARCH_INDEX` to the name of your Atlas Vector Search index (default: `transcript_vector_index`)

Generate a secret in PowerShell with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Keep `.env` private; it is excluded from Git. Accounts use a minimum 10-character password. Sign-in tokens expire after seven days.

## Configure Atlas Vector Search

Use a MongoDB Atlas cluster with Vector Search enabled. In the Atlas UI, create a Vector Search index on the `transcriptsegments` collection with this JSON definition. Use the index name configured by `VECTOR_SEARCH_INDEX`:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 384, "similarity": "cosine" },
    { "type": "filter", "path": "ownerId" },
    { "type": "filter", "path": "videoId" }
  ]
}
```

The backend creates segment embeddings locally with Transformers.js and `Xenova/all-MiniLM-L6-v2`. Semantic search retrieves vector-similar transcript segments and uses matching query terms as a small ranking boost. The model files are downloaded from Hugging Face the first time semantic indexing runs and cached on the server; no embedding API key is needed. Semantic search is available after indexing completes. Previously uploaded videos can be indexed from the search panel. Keyword search remains available while embeddings are being prepared.

Start the backend:

```powershell
npm run dev
```

## Start the frontend

Open a second PowerShell terminal:

```powershell
Set-Location 'D:\Projects\New folder\client'
npm install
npm run dev
```

Open the local address printed by Vite, usually `http://localhost:5173`.

Create an account or sign in. Choose a video file, confirm you have permission to process it, and select **Upload and transcribe**. Wait for transcription to complete. Choose **Keyword** for literal matching or **Semantic meaning** to search by meaning. Semantic indexing runs in the background after transcription; the first model download may take a while. Use the previous/next controls or select a result to seek the player. Add notes at the current playback time or from a matching result. Your uploads and notes appear in your account's library after refreshing or signing in again.

## Background jobs

Transcription and semantic indexing are stored as MongoDB jobs in the `backgroundjobs` collection. A worker claims jobs with an expiring lease, retries transient failures for up to three attempts with backoff, and resumes a saved AssemblyAI job after a server restart. The API can restart without losing queued jobs. The uploaded video files still live in `server/uploads`, so keep that directory persistent across restarts; for multiple app instances, use shared durable file storage and a shared rate-limit store.

## Deploy to Render and Vercel

Deploy the Express API as a Render **Web Service** and the Vite client as a Vercel project. Both can use this repository:

- Render **Root Directory**: `server`; **Build Command**: `npm ci`; **Start Command**: `npm start`.
- Vercel **Root Directory**: `client`; **Build Command**: `npm run build`; **Output Directory**: `dist`; use the Vite framework preset.

Set these Render environment variables:

- `MONGODB_URI`, `ASSEMBLYAI_API_KEY`, and `AUTH_TOKEN_SECRET` (generate a random secret of at least 32 characters).
- `FRONTEND_ORIGINS` to the exact Vercel site origin, such as `https://video-search.vercel.app`. Separate multiple allowed origins with commas; do not include a trailing slash.
- `UPLOADS_DIR` to a directory on a Render persistent disk. For example, mount the disk at `/var/data` and set `UPLOADS_DIR=/var/data/uploads`. The app creates this directory if needed.
- `VECTOR_SEARCH_INDEX` if using a non-default Atlas Vector Search index name.

Render provides `PORT` automatically. In Vercel, set `VITE_API_URL` to the Render service URL, with no trailing slash (for example, `https://video-search-api.onrender.com`). This value is public and must not contain secrets. Redeploy the Vercel project after changing its environment variables.

The Render disk is required to keep uploaded video files across deploys and restarts. Keep the Atlas cluster reachable from Render, and configure its Vector Search index to enable semantic search. The `FRONTEND_ORIGINS` allowlist controls which browser origins may call the API; set it to the production Vercel origin before testing the deployed frontend.

## Evaluate search quality

Search quality is measured against manually labeled transcript moments; the app does not infer whether a result is relevant. Copy the benchmark template, then list existing video IDs:

```powershell
Set-Location 'D:\Projects\New folder\server'
Copy-Item search-benchmark.example.json search-benchmark.json
npm run evaluate-search -- --list-videos
```

Edit `search-benchmark.json`: for each query, use the listed `videoId` and put the relevant transcript start times (seconds) in `relevantStarts`. Add representative questions and all known relevant moments. The local benchmark file is ignored by Git. Run evaluation:

```powershell
npm run evaluate-search -- search-benchmark.json
```

The script reports macro-averaged **Recall@5**, **Recall@10**, **MRR@10**, and **nDCG@10** for keyword and semantic search. To run only keyword evaluation (for a local MongoDB without Vector Search), use:

```powershell
npm run evaluate-search -- search-benchmark.json --mode keyword
```

Run the focused unit tests with `npm test`. A benchmark with no representative labeled examples is not a meaningful quality measurement; keep the same labeled queries when comparing search changes.

## Security notes

The API uses Helmet security headers, bounded JSON/upload input, per-IP request limits, generic login failures, and owner-scoped data access. Rate limits use in-memory storage by default and reset when the server restarts; use a shared store if you deploy multiple instances. Keep HTTPS enabled in production, keep `.env` private, and ensure `server/uploads` is not served as a public static directory. These safeguards are a baseline for this small app, not a substitute for a production security assessment.

## Backend layout

- `server.js` connects to MongoDB, recovers jobs, starts the worker, and handles shutdown.
- `app.js` configures Express middleware and mounts routes.
- `config/`, `middleware/`, and `utils/` hold runtime settings, shared request handling, and small helpers.
- `routes/` and `controllers/` define the API and its request handlers.
- `models/`, `services/`, and `workers/` hold MongoDB schemas, reusable business logic, and durable background processing.
