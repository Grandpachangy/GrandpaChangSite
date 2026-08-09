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

## Asset caching

Vercel serves everything in `public/` with `max-age=0, must-revalidate` by
default, so every repeat visit revalidates every file before rendering.
`vercel.json` overrides that, and the split is deliberate (JSON can't carry
comments, hence this note):

| Files | Policy | Why |
| --- | --- | --- |
| `fonts/*` | 1 year, `immutable` | Never edited in place. Changing a face means a new filename. |
| `.svg .png .ico .webmanifest` | 1 week, then 30 days `stale-while-revalidate` | Generated art and icons. Rarely change, and a stale week is harmless. |
| `.jpg .jpeg .webp .avif` | 1 day, then 1 week `stale-while-revalidate` | `avatar.jpg` and `og.jpg` are the ones most likely to be swapped, so the staleness window is short. |

`index.html`, `style.css` and `script.js` are deliberately **left revalidating**.
They aren't content-hashed, so caching them would mean a deploy doesn't reach
returning visitors until the cache expires — and a stale stylesheet against
fresh markup renders broken. A 304 on those is cheap; the win here is the
fonts, the eight branch SVGs and the icons.

## Notes on ads

Twitch's embedded player doesn't expose a parameter to disable ads — ad insertion is controlled by Twitch's own backend based on your channel's monetization settings, not by embedding sites. There's no supported way for this site to suppress them.
