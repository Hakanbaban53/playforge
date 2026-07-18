# Cloud Sync & Multi-Device Setup

Parkman supports optional cloud sync via Firebase. When enabled, users can sign in with Google and their data (catalog, customers, invoices, favorites, settings) syncs across all their devices in real time. The app remains fully functional without an account — cloud is opt-in.

## Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│                   Feature services                       │
│  CustomersService, InvoiceService, CatalogService, ...  │
└──────────────────────┬──────────────────────────────────┘
                       │ depends on (DI)
                       ▼
┌─────────────────────────────────────────────────────────┐
│              DataProvider (abstract)                     │
│  collection<T>(), doc<T>(), setRecord(), setDoc(), ...  │
└──────────────────────┬──────────────────────────────────┘
                       │ implemented by
                       ▼
┌─────────────────────────────────────────────────────────┐
│              DataProviderService (proxy)                 │
│  Delegates to whichever backend is active based on auth │
└────┬──────────────────────────────────┬─────────────────┘
     │ when logged out                  │ when logged in
     ▼                                  ▼
┌──────────────────┐          ┌──────────────────────────┐
│ LocalDataProvider│          │ FirestoreDataProvider    │
│ (localStorage)   │          │ (Firestore + IDB cache)  │
└──────────────────┘          └──────────────────────────┘
```

**Key design decisions:**

1. **No backend to build.** Firebase Auth + Firestore + Storage handle identity, database, and file storage as managed services.
2. **Local-first.** Firestore's offline persistence means the app works offline — the local cache IS the local store when logged in. No separate sync engine to build.
3. **Provider swap is transparent.** Feature services inject `DataProvider` and don't care which backend is active. The proxy (`DataProviderService`) handles the swap on auth state changes.
4. **Per-user isolation.** All cloud data lives under `users/{uid}/...`. Firestore rules enforce that users can only read/write their own subtree — no userId filter needed in queries.
5. **Optional cloud.** Set `environment.firebase.enabled = false` and the entire Firebase SDK is tree-shaken out of the bundle. The app runs in pure-local mode.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and create a new project.
2. Add a Web app: click the `</>` icon, register an app nickname (e.g. `parkman-web`), copy the config object.
3. **Authentication → Sign-in method → Google:** enable it. Add your dev domain (e.g. `localhost`, `localhost:4200`) and production domain to **Authorized domains**.
4. **Firestore Database → Create database:** start in production mode. Choose a region close to your users.
5. **Storage → Get started:** default rules are fine (we'll override below).

## 2. Configure the app

Open `src/environments/environment.ts` and fill in the `firebase` block from the config you copied:

```ts
export const environment = {
  version: '0.1.2',
  production: false,
  firebase: {
    enabled: true,                    // master switch
    apiKey: 'AIza...',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: '1234567890',
    appId: '1:1234567890:web:abcdef',
  },
};
```

To disable cloud features entirely (e.g. for a stripped-down build), set `enabled: false`. The Firebase SDK won't be initialized, no auth UI will render, and the app runs in pure-local mode.

For production builds, create `src/environments/environment.prod.ts` with the production config and wire it up via `fileReplacements` in `angular.json`.

## 3. Deploy security rules

The repo includes `firestore.rules` and `storage.rules` at the project root. These enforce per-user data isolation — without them, anyone could read anyone else's data.

Install the Firebase CLI and deploy:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,storage
```

The rules are simple: any document under `users/{uid}/...` is readable/writable only by the authenticated user whose `uid` matches the path. Everything else is denied.

## 4. Tauri deep-link setup (for desktop/mobile builds)

If you're building with Tauri, OAuth redirects need a custom URL scheme so the browser can return to the app after Google sign-in.

1. Register a deep-link scheme in `src-tauri/tauri.conf.json`:
   ```json
   "app": {
     "deepLink": {
       "schemas": ["parkman"]
     }
   }
   ```
2. Add the scheme to Firebase Auth → Settings → Authorized domains: `parkman://auth`
3. The app's `AuthService` already handles both popup (desktop) and redirect (mobile) flows automatically based on viewport width.

For pure web deployments, no deep-link setup is needed — `firebase.auth` uses standard domain-based redirects.

## How it works at runtime

### Sign-in flow

1. User clicks "Sign in with Google" in the sidebar footer or Settings page.
2. `AuthService.signInWithGoogle()` opens the Google OAuth popup (desktop) or redirect (mobile).
3. On success, Firebase Auth fires `onAuthStateChanged`, which updates `AuthService.user()`.
4. `DataProviderService` reacts to the auth signal and swaps from `LocalDataProvider` to `FirestoreDataProvider`.
5. Firestore `onSnapshot` listeners attach to all collections the app uses, pulling data from the cloud (with local cache fallback).
6. If the user had anonymous local data, `FirstLoginMergeService` surfaces a prompt asking whether to upload it to the new account.

### Sign-out flow

1. User clicks "Sign out" in the auth widget menu or Settings page.
2. `AuthService.signOut()` calls `firebase.auth().signOut()`.
3. `onAuthStateChanged` fires with `null`, `AuthService.user()` becomes `null`.
4. `DataProviderService` swaps back to `LocalDataProvider`. The Firestore provider's listeners are unsubscribed.
5. The Firestore local cache is intentionally NOT cleared on sign-out (it's needed for offline mode on the next sign-in). To wipe it on a shared device, the user should use the "Wipe all data" action in Settings → Danger Zone.

### Sync indicator

The sidebar footer shows the current sync state:

- **Saved locally** (gray) — anonymous mode, no cloud.
- **Saved** (green check) — cloud mode, all writes confirmed by the server.
- **Saving…** (spinning) — cloud mode, writes pending.
- **Offline** (amber) — cloud mode, network unreachable, writes queued locally.

The state is aggregated from all open Firestore `onSnapshot` listeners via `snapshot.metadata.fromCache` and `snapshot.metadata.hasPendingWrites`.

### Data layout in Firestore

```
users/{uid}/
├── customers/{customerId}          ← Customer records
├── catalog:families/{familyId}     ← Product families
├── catalog:variants/{variantId}    ← Product variants
├── invoice:saved/{invoiceId}       ← Saved invoices (synced)
├── catalog:favorites/value         ← Single doc: { ids: string[] }
├── receipt:layout/value            ← Single doc: LayoutElement[]
├── app:invoice-defaults/value      ← Single doc: InvoiceDefaults
├── app:exchange-rates/value        ← Single doc: { rates, base }
└── app:language/value              ← Single doc: AppLanguage
```

The `invoice:active` (current working draft) is intentionally NOT synced — it's the work-in-progress, not a saved record. Each device keeps its own active draft.

## Phase 2: Cloud image storage (not yet implemented)

Currently, images stay in IndexedDB even when the user is signed in. This means images added on Device A won't appear on Device B. Phase 2 adds a `FirebaseStorageAdapter` that:

1. Uploads image blobs to Firebase Storage under `users/{uid}/images/{imageId}.{ext}`.
2. Stores the Storage URL (not the IDB id) in catalog/invoice data when signed in.
3. Keeps an LRU cache of recently-used images in IndexedDB so the app doesn't re-download them every launch.
4. On first login, migrates `idb://` URLs to `gs://` URLs during the merge flow.

The Storage security rules (`storage.rules`) are already in place and will gate access per-user. The implementation is the only missing piece.

## Troubleshooting

**Sign-in popup doesn't open on desktop Tauri**
- Make sure the Tauri webview allows popups. The OAuth popup needs `window.open` to work.
- Check that your domain is in Firebase Auth → Authorized domains.

**`Firebase initialization failed` in console**
- Verify the `firebase` config in `environment.ts` is correct (especially `apiKey` and `projectId`).
- Check that `enabled: true` is set.

**Data not syncing across devices**
- Make sure both devices are signed in to the same Google account.
- Check the sync indicator — if it says "Offline", the device lost connection.
- Open Firestore console and verify the data is being written under `users/{uid}/...`.

**`Missing or insufficient permissions` error**
- The Firestore rules require authentication. Make sure the user is signed in.
- Verify the rules are deployed: `firebase deploy --only firestore:rules`.
- Check that the path matches the rules — data must be under `users/{uid}/...`.

**App hangs on launch after sign-in**
- The Firestore `onSnapshot` listeners need a moment to attach and fetch the initial cache. The sync indicator will show "Saving…" briefly, then "Saved" once the first snapshot arrives.
- If it stays stuck, check the browser console — Firestore logs connection errors there.
