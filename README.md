# Link Vault

Save links from Instagram, LinkedIn, or anywhere else with one click (or a
right-click) from Chrome, and browse/search/tag them from any browser —
phone included. Everything is stored as a single `Link Vault/links.json`
file in your own Google Drive, so there's no server and no account system
beyond your Google login.

Two pieces:
- **`extension/`** — a Chrome extension for quick-capture while browsing.
- The repo root (`index.html`, `app.js`, `style.css`, `lib/`) — a static
  dashboard page (meant for GitHub Pages) for browsing, searching, tagging,
  and managing everything you've saved. It lives at the repo root rather
  than its own subfolder because GitHub Pages' "deploy from a branch"
  mode can only serve `/` or `/docs`, not an arbitrary path.

Both talk directly to the Google Drive API from the browser using OAuth —
no backend to run or pay for.

## 1. Google Cloud setup (one-time)

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   create a new project (e.g. "Link Vault").
2. **APIs & Services → Library** → enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Publishing status: leave it in **Testing**. This skips Google's
     verification review (unnecessary for a personal tool) but means
     access tokens expire after about 7 days, requiring a quick
     re-sign-in — a fine trade-off here.
   - Under **Test users**, add your own Google account's email.
   - Scopes: you don't need to add anything here manually; the apps
     request scopes at runtime.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   twice:
   - **Type: Chrome Extension.** Application ID:
     `ffckgbcbpdamhkchonfkbjpamcgacgic` (this is the extension's ID,
     already fixed by the `key` baked into `extension/manifest.json` —
     it won't change no matter how many times you reload the extension).
     Copy the generated client ID into `extension/manifest.json`, replacing
     `GOOGLE_CLIENT_ID_EXTENSION.apps.googleusercontent.com` in the
     `oauth2.client_id` field.
   - **Type: Web application.** Under **Authorized JavaScript origins**,
     add `https://ohad-israeli.github.io`. Copy the generated client ID
     into `app.js` (repo root), replacing the
     `GOOGLE_CLIENT_ID_WEB.apps.googleusercontent.com` placeholder near the
     top of the file.

Both client IDs live under the same Cloud project — that's fine and
expected.

## 2. Load the Chrome extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select the `extension/` folder.
4. Pin the Link Vault icon to your toolbar for quick access.

To use it: click the icon to save the current tab (editable URL field, plus
optional tags/note), or right-click any link on a page and choose **Save
link to Link Vault** to save it without opening it.

## 3. Publish the dashboard on GitHub Pages

Live at: **https://ohad-israeli.github.io/linkvault/** — separate from the
`ohad-israeli.github.io` user site (a project repo's Pages site is
independent).

Already done: repo created at
[github.com/ohad-israeli/linkvault](https://github.com/ohad-israeli/linkvault)
(pushed from the `ohad-demo-1` GCP box, since the Mac can't push to GitHub as
`ohad-israeli`), Pages enabled via **Settings → Pages** → Source: **Deploy
from a branch** → Branch `main`, folder `/`.

To ship a future change: edit locally on the Mac → `gcloud compute scp
--tunnel-through-iap --zone us-east1-d --recurse <path> ohad-demo-1:~/` →
on the box, `cd ~/linkvault && git add -A && git commit -m "..." && git push`.

## 4. Try it end to end

1. Right-click a real link (e.g. an Instagram post) → **Save link to Link
   Vault**. A `Link Vault` folder with `links.json` should appear in your
   Google Drive.
2. Open the dashboard URL, sign in with the same Google account, and
   confirm the link shows up with the right platform badge.
3. Add a link from the dashboard's form, search for it, click one of its
   tags to filter, mark it done, then delete it — reload the page to
   confirm each change actually persisted to Drive.
4. Open the same dashboard URL on your phone, sign in, and confirm the
   same links are there. Add one from your phone, then reload the desktop
   dashboard — it should show up there too (the dashboard polls Drive every
   20 seconds while open).

## Notes on the permission model

Both apps request the broad `.../auth/drive` scope (full Drive access)
rather than the narrower `drive.file` scope. That's a deliberate
simplification: `drive.file` access is granted per *(you, this specific
OAuth client)*, so the extension and the dashboard — two different OAuth
clients — would not automatically be able to see a file the other one
created. The broad scope avoids needing a Google file-picker hand-off step
between them. In practice, both apps only ever touch the one `links.json`
file they create — but Google's consent screen will describe the
permission broadly ("See, edit, create, and delete all your Google Drive
files"), which is worth knowing before you click Allow.

Because the OAuth consent screen stays in **Testing** mode, tokens expire
roughly every 7 days — you'll just need to click "Sign in with Google"
again on the dashboard when that happens, and the extension will silently
re-prompt via `chrome.identity` when it next needs a token.

## Who can actually use the public dashboard URL

The dashboard is a public web page (GitHub Pages has no built-in way to
restrict *viewing* it to just you), but that doesn't mean anyone can use
it or reach your data:

- **The real gate is the OAuth consent screen.** As long as it stays in
  **Testing** with only your own email under **Test users**, Google itself
  refuses to let anyone else finish signing in — a stranger who opens the
  page and clicks "Sign in with Google" gets an access-denied screen from
  Google before your app ever runs. Don't move the consent screen to
  "In production" / publish it, and don't add test users you don't trust
  with drive access.
- **No shared backend.** Even someone who *did* sign in would only ever
  create/see a `Link Vault/links.json` in *their own* Drive — there is no
  path for one signed-in account to read or write another's data.
- **A client-side allowlist as a second layer.** `app.js`'s
  `ALLOWED_OWNER_EMAILS` list is checked right after sign-in; anything
  else gets immediately signed out with a "this vault is private" message,
  before any Drive call is made. Update that list if you ever want a
  second account (e.g. a spouse) to have access — they'd also need to be
  added as an OAuth test user in Cloud Console.
- The OAuth client ID in `app.js`/`manifest.json` is not a secret (it's
  meant to be public, unlike a client *secret*, which this app never
  uses), and it only works from the registered origin
  (`https://ohad-israeli.github.io`) — a copy of the page hosted elsewhere
  can't reuse it.
