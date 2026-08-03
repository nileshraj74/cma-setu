# CMA Studio — Backend Deployment Instructions

## What this is

This is the piece that makes your CMA calculation engine invisible to anyone who
opens the app (or extracts an APK). All the actual formulas — depreciation, EMI
loan schedules, all 9 annexures, cash flow — now live here, on a server, instead
of inside the app itself. The app only sends your inputs to this server and
displays whatever comes back.

You already have a Firebase project from ArthSetu, so this will feel familiar.

## One-time setup

1. Open a terminal on your computer (not the phone) and install the Firebase CLI,
   if you don't already have it:
   ```
   npm install -g firebase-tools
   ```

2. Log in:
   ```
   firebase login
   ```

3. Unzip this `cma-backend` folder somewhere on your computer, then open a
   terminal inside it.

4. Point it at your Firebase project (use the same project as ArthSetu, or create
   a fresh one at https://console.firebase.google.com — either is fine):
   ```
   firebase use --add
   ```
   Pick your project when prompted.

5. Install the function's dependencies:
   ```
   cd functions
   npm install
   cd ..
   ```

## Deploy

```
firebase deploy --only functions
```

This uploads `functions/index.js` and `functions/engine.js` to Google's servers.
When it finishes, it will print a URL that looks like:

```
https://asia-south1-your-project-id.cloudfunctions.net/calculateCMA
```

**Copy that URL.**

## Connect the app to it

Open `CMA_Studio.html` in a text editor (Notepad, VS Code, anything), search for
this line near the top of the big `<script>` block:

```js
const CMA_FUNCTION_URL = 'https://asia-south1-YOUR-PROJECT-ID.cloudfunctions.net/calculateCMA';
```

Replace it with the real URL you copied above, save the file, and that's it —
the app is now fully wired to your private server. Re-share this updated
`CMA_Studio.html` with whoever needs it (your friend, clients, etc.) — the
formulas will never be visible to them, only the results.

## A note on cost

Firebase Cloud Functions has a generous free tier (2 million invocations/month).
For a CMA tool used by you and a handful of clients, you will not come close to
paying anything. If Setu Finsol's usage grows a lot later, worth keeping an eye
on the Firebase console's usage tab, but this isn't a near-term concern.

## Deploy the app itself (Firebase Hosting) — new step

The `public/` folder now contains the actual CMA Studio app (already wired to
your live `calculateCMA` function), plus a PWA manifest, icons, and a small
service worker — everything PWABuilder needs to generate a proper Android APK.

If deploying via GitHub Actions (see below), hosting deploys automatically
alongside your functions — nothing extra to do. If deploying locally:

```
firebase deploy --only hosting
```

This gives you a live URL like:
```
https://cmastudio-15111974.web.app
```

## Turning it into an APK with PWABuilder

1. Go to **https://www.pwabuilder.com**
2. Paste in your hosting URL from above
3. Click **Start** — PWABuilder will read the manifest and confirm it's
   installable
4. Go to the **Android** package option, download the generated APK
5. Share that APK with your friend / clients

**Important — this is the whole point of today's setup:** once this APK
exists, you never need to generate a new one for calculation changes. Fix a
formula in `functions/engine.js`, push to GitHub, it redeploys automatically,
and the APK (which just opens your live hosted page) reflects it the next
time anyone opens the app. A fresh APK is only ever needed if you change the
app's icon, name, or Android-level permissions.



- **"Calculating server error" banner in the app**: usually means the URL in
  `CMA_STUDIO.html` doesn't match what Firebase gave you, or the function
  hasn't finished deploying yet. Double check the URL matches exactly.
- **Deploy fails with a permissions error**: make sure `firebase use --add`
  picked the right project and that your Google account has Editor/Owner
  access to it.
- **Region**: the function is set to deploy in `asia-south1` (Mumbai) since
  that's closest to India. If you'd rather use a different region, change the
  `region:` line in `functions/index.js` before deploying.

---

## Alternative: Deploy via GitHub instead (recommended if you'll keep updating this)

The steps above need you to open a terminal every time you want to redeploy.
If you'd rather just `git push` and have it deploy itself — the same spirit as
how you already run ArthSetu — do this **one-time setup** instead:

### One-time setup (do this once, from any computer or Google Cloud Shell)

1. Push this whole `cma-backend` folder to a new GitHub repo (private is fine).

2. Generate a deploy token. You need the Firebase CLI running *somewhere* just
   for this one command — your own computer, or if you'd rather not install
   anything at all, open **https://console.cloud.google.com** → click the
   `>_` Cloud Shell icon top-right (a free terminal in your browser, nothing
   to install) and run:
   ```
   npm install -g firebase-tools
   firebase login:ci
   ```
   It'll give you a link to sign in, then print a long token starting with
   something like `1//...`. Copy it.

3. In your GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**. Add two secrets:
   - `FIREBASE_TOKEN` — paste the token from step 2
   - `FIREBASE_PROJECT_ID` — your Firebase project ID (visible in the Firebase
     console, top-left, under the project name)

That's it. From now on, any time you (or I) push a change to the `functions/`
folder on the `main` branch, GitHub automatically deploys it for you — you'll
see it run under the **Actions** tab of your repo. No terminal needed again
unless the token itself expires (rare) or you want to check on it.

The workflow file that does this is already included at
`.github/workflows/deploy-functions.yml` — nothing more to write, just the
secrets above.

