# GrandpaChang site

Shows a live banner + embedded player whenever twitch.tv/grandpachang is live, and a grid of recent VODs embedded via Twitch's own player (no re-encoding, so no quality/audio loss).

## 1. Create a Twitch developer app

1. Go to https://dev.twitch.tv/console/apps and log in with your Twitch account.
2. Click **Register Your Application**.
3. Fill in:
   - **Name**: anything unique, e.g. `GrandpaChang Site`
   - **OAuth Redirect URLs**: `http://localhost:3000` (not actually used for this flow, but required by the form)
   - **Category**: `Website Integration`
4. Click **Create**, then open the app and click **New Secret** to generate a Client Secret.
5. Copy the **Client ID** and **Client Secret**.

## 2. Configure environment variables

Copy `.env.example` to `.env` and fill in the values from step 1:

```bash
cp .env.example .env
```

```
TWITCH_CLIENT_ID=xxxxxxxxxxxx
TWITCH_CLIENT_SECRET=xxxxxxxxxxxx
```

Never commit `.env` — it's already in `.gitignore`.

## 3. Run locally

```bash
npm install
npm run dev
```

This runs `vercel dev`, which serves `public/` as static files and `api/*.js` as serverless functions on `http://localhost:3000`.

## 4. Deploy (when ready)

```bash
npx vercel
```

Follow the prompts, then add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` as Environment Variables in the Vercel project dashboard (Settings → Environment Variables) before your first production deploy.

## Notes on ads

Twitch's embedded player doesn't expose a parameter to disable ads — ad insertion is controlled by Twitch's own backend based on your channel's monetization settings, not by embedding sites. There's no supported way for this site to suppress them.
