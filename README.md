# JumpToThis

JumpToThis accepts video files uploaded from your device. It transcribes speech with AssemblyAI, stores timestamped transcript segments in MongoDB, and lets you search the transcript and jump to a matching timestamp.

Accounts have separate video libraries. Search supports optional whole-word matching and previous/next result navigation. Notes can be saved at the player's current time or at a selected search result.

## Requirements

- Node.js 18.17 or newer
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

Generate a secret in PowerShell with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Keep `.env` private; it is excluded from Git. Accounts use a minimum 10-character password. Sign-in tokens expire after seven days.

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

Create an account or sign in. Choose a video file, confirm you have permission to process it, and select **Upload and transcribe**. Wait for transcription to complete. Search for a word or phrase, optionally enable **Match whole words only**, and use the previous/next controls or select a result to seek the player. Add notes at the current playback time or from a matching result. Your uploads and notes appear in your account's library after refreshing or signing in again.

Transcription runs asynchronously. The app reports upload progress, transcription status, completion, and errors. Upload size is limited by `MAX_UPLOAD_BYTES` in the server environment. This simple authentication setup is intended as a basic app feature; deploy behind HTTPS and review production authentication, rate limiting, and account-recovery needs before exposing it publicly.
