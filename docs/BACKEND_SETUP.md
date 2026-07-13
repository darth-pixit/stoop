# Backend setup — SSO login + per-user sync

Stoop runs with **no backend** by default (local-only, exactly as before). Add a
Supabase project to switch on Sign in with Apple / Google and per-user cloud
sync. Nothing here needs a build step — the app just reads `www/js/config.js`.

## 1. Create a Supabase project

1. Sign up at <https://supabase.com> and create a project (free tier is plenty
   for a beta).
2. In **Project Settings → API**, copy the **Project URL** and the **anon /
   publishable** key. The anon key is meant to ship in client apps; your data is
   protected by Row-Level Security, not by hiding it.

## 2. Apply the database schema

The app stores each user's whole Stoop state as one row in `public.user_state`,
guarded by RLS so a user can only touch their own row.

- **Dashboard:** open the SQL editor and paste
  [`supabase/migrations/0001_user_state.sql`](../supabase/migrations/0001_user_state.sql),
  then run it, **or**
- **CLI:** `supabase link --project-ref <ref> && supabase db push`.

## 3. Point the app at your project

Either edit `www/js/config.js` directly:

```js
const DEFAULT = {
  supabaseUrl: 'https://YOUR-REF.supabase.co',
  supabaseAnonKey: 'eyJ...your-anon-key...',
  providers: { apple: true, google: true, email: false },
  authScheme: 'stoop',
  requireLogin: true,
};
```

…or, to keep credentials out of git, set `window.STOOP_CONFIG` from an inline
`<script>` in `www/index.html` **before** the app module loads:

```html
<script>
  window.STOOP_CONFIG = {
    supabaseUrl: 'https://YOUR-REF.supabase.co',
    supabaseAnonKey: 'eyJ...',
  };
</script>
```

As soon as a URL + key are present, Stoop shows the login gate and starts
syncing. Leave them blank to keep it local-only.

## 4. Configure the OAuth providers

In Supabase: **Authentication → Providers**.

### Google

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
   create an **OAuth 2.0 Client ID** (type: Web application).
2. Add this **Authorized redirect URI**:
   `https://YOUR-REF.supabase.co/auth/v1/callback`
3. Paste the Client ID + secret into Supabase's Google provider and enable it.

### Apple (required for the iOS App Store when any social login is offered)

1. In the [Apple Developer portal](https://developer.apple.com/account/resources/identifiers/list)
   create an **App ID** with **Sign in with Apple** enabled (this is also your
   iOS bundle id — see [NATIVE_BUILD.md](./NATIVE_BUILD.md)).
2. Create a **Services ID** for the web/OAuth side, enable Sign in with Apple on
   it, and set the return URL to
   `https://YOUR-REF.supabase.co/auth/v1/callback`.
3. Create a **Sign in with Apple key**, then fill Supabase's Apple provider with
   the Services ID, Team ID, Key ID and the key's contents.

### Redirect URLs (native deep link)

Under **Authentication → URL Configuration → Redirect URLs**, add the app's deep
link so the native callback is allowed:

```
stoop://auth/callback
```

(Also add your web origin, e.g. `http://localhost:8000` and your deployed URL,
if you serve Stoop as a PWA too.)

### Email magic link (optional)

Set `providers.email: true` in the config to show a passwordless email option.
Add `stoop://auth/callback` to the redirect URLs as above; Supabase's built-in
email works out of the box for a beta.

## How sync behaves

- **Offline-first.** `localStorage` stays the working copy; changes are pushed
  to Supabase a few seconds after they settle, and flushed when the app is
  backgrounded or comes back online.
- **Last-write-wins** by a per-state `updatedAt` timestamp when the same account
  edited on two devices.
- **No cross-account leakage.** Signing in on a device that a different account
  used starts clean rather than uploading the previous user's data. Data created
  before your first ever sign-in (guest use) is claimed by that first account.
- **Start over** wipes the cloud row too (it syncs the empty state up before
  reloading).

## Branding the Google consent screen

Out of the box, Google's "Sign in" page says *"to continue to
`<project-ref>.supabase.co`"* — the raw Supabase domain, which looks
unprofessional to users signing into **stoop**. Two levers fix it:

1. **OAuth consent screen branding** (free): in Google Cloud Console →
   *APIs & Services → OAuth consent screen*, set the app name to **stoop**,
   add the logo and your homepage. This changes the header of the page.
2. **Supabase custom domain** (paid add-on): give the project a domain like
   `auth.yourdomain.com` (Supabase dashboard → *Settings → Custom Domains*),
   update `supabaseUrl` in `www/js/config.js`, and re-add the redirect URLs in
   the Google credentials. The "to continue to…" line then shows your domain
   instead of `*.supabase.co`.

Both are configuration-only; no app code changes beyond `config.js`.
