# CampusCart: Firebase + Supabase verification setup (Phase 4B, Route B)

Architecture in one paragraph: Firebase Auth + Firestore hold accounts and verification status. The COR file
lives in a PRIVATE Supabase bucket (`student-cors`) and is reached only through three Supabase Edge Functions
that verify the student's Firebase ID token. The browser never gets a Supabase key. No Firebase billing upgrade
is needed (Firebase Storage is not used).

Until `VITE_*` values exist the app keeps using the old local accounts, exactly as before.

---------------------------------------------------------------------------------------------------------

## 1. Firebase Console (project `campuscart-1887f`)
1. Authentication > Sign-in method > **Email/Password: enabled**. (Keep this on the free Spark plan.)
2. Firestore Database exists (production mode). Open **Rules**, paste `firestore.rules`, **Publish**.
3. Project settings > General > your Web app: copy the config values for `.env.local` (step 4).
4. **Attestor account** (one low-privilege account used only by the `verify-cor` function):
   - Authentication > Users > **Add user**: email like `cor-attestor@yourdomain.example`, a long random password.
   - Copy its **User UID**. Firestore > Start collection `attestors` > Document ID = that UID, add a field `note` = `backend`.
   - This account never logs into the app. Its credentials go ONLY into Supabase secrets (step 3).
5. **Admin account** (you, see section 5): Firestore collection `admins`, Document ID = your UID.

## 2. Supabase dashboard
1. Storage: bucket `student-cors` must be **private** (Public bucket = off).
2. SQL Editor, run and check:
   ```sql
   -- Must show NO policy that mentions student-cors and NO policy with a qual of just "true":
   select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects';
   -- Defence in depth: private + 10 MB + only PDF/JPG/PNG
   update storage.buckets set public = false, file_size_limit = 10485760,
     allowed_mime_types = array['application/pdf','image/jpeg','image/png'] where id = 'student-cors';
   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'student-cors';
   ```
   If a permissive policy exists: `drop policy "<name>" on storage.objects;` (the functions use the service-role
   key, which bypasses RLS, so no policy is needed or wanted).
3. Do NOT change the Firebase Third-Party Auth integration. Route B does not use it.

## 3. Secrets (never commit, never paste in chat)
Create `supabase/secrets.local` (the Vite template's `*.local` rule git-ignores it; confirm with `git status`):
```
FIREBASE_PROJECT_ID=campuscart-1887f
FIREBASE_WEB_API_KEY=<same value as VITE_FIREBASE_API_KEY>
ATTESTOR_EMAIL=<attestor email from 1.4>
ATTESTOR_PASSWORD=<attestor password from 1.4>
ALLOWED_ORIGINS=http://localhost:5173,https://localhost
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase into every Edge Function automatically;
you do not set them and they never leave Supabase. (If your dashboard shows the new "secret keys" instead of the
legacy service-role key, check Edge Functions > Secrets: the variable name `SUPABASE_SERVICE_ROLE_KEY` must be present.)

## 4. Deploy (Windows, from the project root)
```
npx.cmd supabase login
npx.cmd supabase link --project-ref <your-project-ref>
npx.cmd supabase secrets set --env-file supabase/secrets.local
npx.cmd supabase functions deploy submit-cor --no-verify-jwt
npx.cmd supabase functions deploy get-cor-url --no-verify-jwt
npx.cmd supabase functions deploy verify-cor --no-verify-jwt
```
If the CLI asks for Docker, add `--use-api`. `--no-verify-jwt` is intentional: Supabase's gateway only understands
Supabase tokens; each function verifies the FIREBASE token itself.

Then copy `.env.example` to `.env.local` and fill it (functions URL is `https://<project-ref>.supabase.co/functions/v1`).
Restart `npm.cmd run dev`.

## 5. Admin account (no hard-coded identity, no service-account file)
1. Sign up in the app normally (a COR upload is required) and keep that account.
2. Firebase Console > Authentication > Users: copy that account's **User UID**.
3. Firestore: create `admins/<that UID>` (add a field `note` = `owner`).
4. Log in. Profile now shows **Verification requests**. Approve your own request there. This works because
   admin power depends only on the `admins` record, not on verification status.
Revoke admin by deleting that document: it takes effect on the next request in both Firestore and the functions.
Do not create the admin only in the Authentication console (an account with no profile counts as unfinished).

## 6. Origins (CORS)
Functions answer browsers only for origins listed EXACTLY in `ALLOWED_ORIGINS`; anything else gets 403 and no CORS
headers. No wildcard is accepted.
| Build | Origin to list |
|---|---|
| Web dev (Vite) | `http://localhost:5173` |
| Android (Capacitor) | the WebView origin: `https://localhost` with the default `androidScheme: 'https'` |
| Production web | none yet. Add your exact `https://your-domain` when you have one |
The Android value is the Capacitor default and is UNCONFIRMED for your project: send `capacitor.config.ts`
(or `capacitor.config.json`) from the project root. A custom `server.hostname`, `androidScheme: 'http'` or a
`server.url` changes the origin. After changing `ALLOWED_ORIGINS`, run `secrets set` again and, if the change doesn't take effect, redeploy the functions.

## 7. Tests
**Already run by the author (stand-ins for Deno/jose/Firebase, see report):** Edge Function logic (45 checks), client
signup/login/admin flows (26 checks), local-mode regression.

**You must run (need real services):**
- Firestore rules (emulator, needs Java): see the header of `rules-tests/firestore.rules.test.mjs`. Rules Playground
  can check reads/lists/`admins` access only; it cannot simulate `request.time`, so create/approve rules need the emulator.
- Token verifier with the real jose: `deno test --allow-env --allow-net=none supabase/functions/_shared/auth_test.ts`
- Deployed functions (PowerShell, use `curl.exe`; replace the URL):
  ```
  curl.exe -i -X POST https://<ref>.supabase.co/functions/v1/get-cor-url                        # expect 401
  curl.exe -i -X POST -H "Authorization: Bearer abc.def.ghi" https://<ref>.supabase.co/functions/v1/get-cor-url   # 401
  curl.exe -i -X POST -H "Origin: https://evil.example" https://<ref>.supabase.co/functions/v1/get-cor-url        # 403, no CORS headers
  curl.exe -i -X OPTIONS -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" https://<ref>.supabase.co/functions/v1/submit-cor   # 204, ACAO = exactly that origin
  ```
- Manual app checks:
  1. Sign up with a .docx and with an 11 MB PDF: both refused with a clear message. Sign up with a PDF: lands on Profile as "Pending verification".
  2. Pending student: Create and Messages show "Student verification needed"; Message seller shows the notice; browsing and saving work.
  3. Firebase Console: `users/<uid>` has `verificationStatus: pending`, `corStoragePath: <uid>/cor`; Supabase bucket has `<uid>/cor`.
  4. Admin: Verification requests lists the student; View COR opens a link that stops working after about a minute; Approve works;
     student taps Check status (or logs in again) and the marketplace unlocks.
  5. Kill the app mid-signup (or block the network after account creation), then log in: "registration wasn't completed". Sign up again with the same email/password: completes.
  6. Student account tries Verification requests (`/admin`): "Administrators only".
  7. Rejected student stays restricted.

## Marketplace data in Firestore (listings, saved items, messages)
When the `VITE_*` values exist, listings, saved items and messages live in Firestore and update live. Nothing is read
from or written to the browser's localStorage in that mode, and no demo data is ever inserted into Firestore.
Without the `VITE_*` values the old local prototype still runs (with its demo listings), exactly as before.

| Collection | Document | Who may do what |
|---|---|---|
| `listings/{listingId}` | title, price, condition, category, description, images, sellerId, sellerName, campus, createdAt | any signed-in user reads; only a VERIFIED student creates (sellerId must be their uid; name and campus must match their profile); only the owner edits or deletes; sellerId, campus and createdAt never change |
| `users/{uid}/saved/{listingId}` | listingId, savedAt | only that user, only for a listing that exists; pending/rejected students may save |
| `conversations/{listingId}_{buyerUid}` | listingId, listingTitle, listingPrice, buyerId, buyerName, sellerId, sellerName, participants, lastMessage, lastMessageId, createdAt, updatedAt | only the buyer and the seller read; only a verified buyer creates (the seller must be the listing's real seller; the id makes duplicates impossible); participants/listing never change; admins get no access |
| `conversations/{id}/messages/{messageId}` | conversationId, senderId, text (1-1000 chars), createdAt, editedAt (only after an edit) | only the two participants read; only a verified participant sends, as themselves; only the SENDER can edit (text and editedAt only) or delete their own message |

Verification is read from the SERVER-side `users/{uid}.verificationStatus` (students cannot change it), so pending and
rejected students are blocked by the rules themselves, not only by the screens. No new indexes are needed.

### Publish the rules BEFORE using the new build
The new app reads `listings` and `conversations`; with the old (deny-all) rules every list would fail with a permission
error. Run the tests below first, then Firebase Console > Firestore > Rules > paste `firestore.rules` > Publish
(or `npx.cmd firebase-tools deploy --only firestore:rules`).

### Tests (emulator, needs Java; uses demo data only, never your real project)
```
npm.cmd install -D @firebase/rules-unit-testing      # once, dev-only
npx.cmd firebase-tools emulators:exec --only firestore --project demo-campuscart "node rules-tests/firestore.rules.test.mjs && node rules-tests/marketplace.rules.test.mjs && node rules-tests/profile-and-messages.rules.test.mjs"
```
`firestore.rules.test.mjs` covers verification and admin review (one line changed: the "default-deny" check now uses an
unknown collection, because `listings` is a real collection now). `marketplace.rules.test.mjs` covers listings, saved
items, conversations and messages.

### Service tests (no emulator, no Firebase needed)
```
node tests/service/run.mjs
```
Runs the client code against an in-memory fake Firestore and fake Auth (131 checks): document shapes, ownership, one
conversation per listing and buyer, atomic message batches, subscriptions, "Firebase mode never touches localStorage",
that local mode still works, and the offline / session behaviour described below. It does NOT test the real Firestore or the security rules; use the emulator tests above for that.

### Offline and session behaviour
Firebase keeps the signed-in session in the browser, so a refresh or a short outage does not sign anyone out. CampusCart
loads the student's profile on top of that session. If the profile cannot be read (offline, timeout, permission problem) the
app shows "Can't reach CampusCart" with Try again and Log out, keeps the session, unlocks nothing, and retries by itself
(after 3, 6, 12, 24, then every 30 seconds, and immediately when the browser goes back online). Only two things sign a user
out: pressing Log out, or the SERVER confirming that the account has no profile (an unfinished registration).

### Two-browser check (needs the published rules and two approved students, A and B)
1. A (browser 1) creates a listing with a photo. B (browser 2, or a private window) sees it appear without refreshing.
2. B saves it, refreshes, and still sees it saved. Log in as B on another device: same saved list. A does not see B's saved items.
3. B taps Message seller, sends "hi". A opens Messages: the conversation and the message are there, live. A replies; B sees it.
4. Tap Message seller again as B: it reopens the same conversation (no duplicate).
5. A edits the price: B sees the new price. A deletes the listing: it disappears for B, and B's Saved list cleans itself up.
6. A pending or rejected student can browse and save, but Create, Messages and Message seller are blocked.
7. Signed out (or while a Firestore request fails) the app shows a login prompt or an error with Try again, never demo data.

### Your existing browser data (migration)
Old localStorage listings, saved items and messages are NOT uploaded and NOT deleted; they stay in that browser,
untouched, and are simply not shown in Firebase mode. There is no automatic import on purpose: those records belong to
the old local accounts, and nothing proves that a Firebase account owns them, so uploading them could attach someone
else's data to the wrong person. Demo listings were never meant for production. To keep a real listing, re-create it
from your Firebase account (the photos can be re-added). Old chats and saved ids cannot be carried over (the other
person and the listing ids only exist locally).

## Android back, message editing, COR resubmission and profile editing

### One-time steps on your machine
1. **Android Back button** needs the official Capacitor App plugin on the native side (Capacitor itself has no back handling,
   which is why Back used to close the app):
   ```
   npm.cmd install @capacitor/app
   npx.cmd cap sync android
   ```
   then rebuild the APK. Until then the app behaves exactly as before. The web build never needs it.
2. **Redeploy the `submit-cor` Edge Function** (the only function that changed; secrets stay as they are):
   ```
   npx.cmd supabase functions deploy submit-cor --no-verify-jwt
   ```
3. Run the three emulator rules tests (command above). **Only if they all pass**, publish `firestore.rules`
   (Firebase Console > Firestore > Rules > Publish). Until the rules are published, message editing/deleting, resubmission,
   e-mail sync and student-number requests are refused by Firestore; everything that worked before keeps working.

### What changed
| Feature | How it works |
|---|---|
| Android Back | Each history entry remembers its depth and the screen it came from. Back goes to the previous screen; on the main marketplace screen it exits; after a refresh on a deep screen it goes UP to the parent; a signed-in student is never sent back to login/welcome and is never logged out. While editing a message, Back cancels the edit first. The top-bar arrow now really goes back when the previous screen is its target, so history does not pile up. |
| Edit message | Tap one of your own messages, then Edit. The text goes into the normal composer with an "Editing message / Cancel" strip; Save writes `text` + `editedAt` (shown as "edited"). If it is the latest message the conversation preview follows. |
| Delete message | Tap your own message, then Delete (confirmation). Only that message is removed. If it was the latest, the conversation preview, `lastMessageId` and `updatedAt` move to the newest remaining message (or the preview empties and `updatedAt` returns to when the conversation started), in the same transaction. A message that is already gone counts as deleted. |
| COR resubmission | A rejected student sees a file picker on their Profile. The `submit-cor` function stores the new file over the old one (same private path, nothing left behind) and ONLY THEN reopens the request as `pending`, clears `reviewedAt` and the old `corVerifiedAt` (so the new file must be verified again), using the attestor account. Students never write their own status. Pending and approved students are refused. |
| Name / username / campus | Validated (name 2-100 characters, username 3-50 without spaces); only changed fields are written; seller and conversation names re-sync as before. Verification status can never change from here. |
| E-mail | Account > "New Email" re-checks the password, then Firebase sends a verification link to the new address (`verifyBeforeUpdateEmail`). The sign-in e-mail changes only after the link is opened; the profile's copy then follows automatically (the rules accept exactly the verified e-mail in the token, and nothing else). |
| Student number | Not directly editable (it is tied to the COR). The student files a request (`studentNumberRequests/{uid}`); the administrator reviews it on the Admin screen (View COR, Approve, Reject). Approving changes the number AND closes the request in one write; the rules refuse one without the other. Verification status is untouched. |
| Profile picture | Not implemented (see limitations). |

### Tests added
- `node tests/service/run.mjs`: 131 checks (navigation and the Android listener lifecycle, message edit/delete on both backends, resubmission, profile, e-mail, student-number review).
- `node tests/functions/run.mjs`: 22 checks of the `submit-cor` signup and resubmission logic and `verify-cor` (needs Node 22+).
- `rules-tests/profile-and-messages.rules.test.mjs`: 39 emulator checks for the new rules. In `marketplace.rules.test.mjs` the old "messages are immutable" check was updated: only the sender may edit or delete.

### Manual checks that need a phone or two accounts
1. Android: open several screens, press Back (returns to the previous screen), reach Home, press Back (exits). Refresh-equivalent: open a chat from a notification-less cold start and press Back (goes to Messages).
2. Two phones/browsers: A edits and deletes own messages; B sees both live; A has no Edit/Delete on B's messages; deleting the latest message updates the preview in the Messages list.
3. Rejected account: upload a corrected COR; status becomes Pending; the admin sees it, View COR opens the new file, Approve works only after the new file passes verification; a failed upload (airplane mode) leaves it Rejected.
4. Profile: change name/username/campus and check listings and chats show the new name; request an e-mail change, open the link, log in with the new e-mail; request a student-number change and approve it as admin.

## Data model
`users/{uid}`: fullName, username, email, studentNumber, campus, verificationStatus ("pending"|"approved"|"rejected"),
corStoragePath (`{uid}/cor`, a path in the private bucket, never a URL), createdAt, verifiedAt, reviewedAt, and
corVerifiedAt (written only by the attestor account via `verify-cor`).
`admins/{uid}`, `attestors/{uid}`: created only in the Firebase Console; clients can never write them.

## Known limitations
- A disabled/revoked Firebase account's ID token still works until it expires (at most 1 hour): the functions do not call the Admin API.
- The rules cannot see Supabase, so a student could create a profile without uploading; the admin then sees "No COR was found" and `verify-cor` blocks approval.
- Each unfinished signup can leave at most one file (`<uid>/cor`, max 10 MB) behind; clean up in the Supabase dashboard if needed.
- The functions are publicly reachable (no per-user rate limit), so hostile traffic could consume the free invocation quota.
- Supabase Free projects pause after about 7 days of inactivity; signup and COR viewing stop until you restore the project.
- The admin screen opens signed links in a new tab; Android WebViews don't render PDFs inline, so review on the web build.
- Listing photos are stored inside the listing document (at most 5 photos, about 900 KB in total, because a Firestore document is limited to 1 MiB). Only the newest 100 listings are loaded (no pagination yet), so a saved listing older than that is not shown on the Saved page.
- Signed-out visitors cannot browse in Firebase mode (the rules require sign-in). For public browsing change `allow get, list: if signedIn();` on `listings` to `if true` and republish.
- Seller and buyer names are checked against the profile only by first name; the last initial is not enforced.
- The administrator cannot delete other people's listings from the app (delete them in the Firebase Console if needed).
- Deleting a listing cannot reach other users' saved lists; each user's app removes its own dangling ids the next time it loads. Conversations about a deleted listing remain, showing the title saved at the time.
- Writes made while offline wait until the connection returns, so "Publishing..." can stay on screen; do not submit twice or you may create two listings.
- Not built yet: unread counts, notifications, read receipts, typing or online status ("Active now" in the chat header is still the original static label).
- Profile pictures are not supported: there is no field for one and no place to put the image. Firebase Storage needs a paid plan, the Supabase bucket is private and reserved for CORs, and a data URL in the profile document would only be visible to its owner. Decide where pictures should live (and who may see them) before this is built.
- When a message is deleted, the conversation preview is chosen from the newest remaining message the app could see. If another message arrives at the same moment, the transaction notices and leaves the newer preview alone.
- Message edit and delete need an internet connection (they are transactions); sending still queues offline as before.
- A resubmission replaces the stored COR before the status is reopened. If that second step fails the new file is already stored but the student stays "rejected" and can simply try again.
- Android Back needs the native `@capacitor/app` plugin; I could not test it on a device.


## Profile pictures and unread message counts

### What was added
- **Edge Function `profile-picture`** (POST = upload/replace, DELETE = remove). Sign-in is checked with the Firebase ID token and the storage path `profile-pictures/{uid}/avatar` is derived from the verified token only. Size (2 MB) and the real image type (JPEG/PNG/WebP, from the file's bytes) are checked again on the server.
- **Firestore rules**: a student may change only `photoPath` / `photoUpdatedAt` of their own profile, and only to their own path; and a new `users/{uid}/unread/{messageId}` marker collection (one tiny document per unread message).
- **Nothing else changes**: no new Storage policies are needed (the bucket is public for reading; every write goes through the Edge Function with the service-role key). No new secrets or `.env` values.

### Deployment order (do these only when you are ready; nothing was deployed for you)
Rules FIRST, then the function, then the new app build. The new app writes an unread marker with every message, so installing the new app before the rules would make sending messages fail.

1. Firestore rules: `npx.cmd firebase-tools deploy --only firestore:rules`
2. Edge Function: `npx.cmd supabase functions deploy profile-picture --no-verify-jwt`
   (`supabase/config.toml` already sets `verify_jwt = false` for it, like the other functions.)
3. Build and release the web app / Android APK as you normally do (`npm.cmd run build`, `npx.cmd cap sync android`, ...).

The `profile-picture` function uses the secrets the other functions already use (`FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS`, and the Supabase-provided `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`). Its CORS rules are the same as `submit-cor`, so the Android origin that works today works here too.

### Tests
```
npm.cmd run build
npm.cmd run lint
node tests/service/run.mjs
node tests/functions/run.mjs
npx.cmd firebase-tools emulators:exec --only firestore --project demo-campuscart "node rules-tests/firestore.rules.test.mjs && node rules-tests/marketplace.rules.test.mjs && node rules-tests/profile-and-messages.rules.test.mjs && node rules-tests/avatar-and-unread.rules.test.mjs && node rules-tests/sold.rules.test.mjs"
```

### Notes
- Messages that were sent before this update have no unread marker, so they are never counted as unread (the badge starts at zero for old conversations).
- Messages sent from an old app version (before updating) do not create a marker, so the recipient's badge will not count them.
- Other students see a changed picture after the browser cache expires (up to 5 minutes). The owner sees it immediately.


## Mark as Sold

- **Field**: `listings/{id}.status` is `"available"` or `"sold"`. Listings created before this feature have no `status` and count as available, so nothing needs migrating. There is only this one status field.
- **How it works**: in Profile > My listings the seller taps **Mark as Sold** and confirms. Only `status` is written, and only from available to sold (it cannot be undone). The listing then shows a red **SOLD** label on its card and detail page, disappears from the Home catalog and search (a **Sold** chip on Home shows sold items separately), stays in the seller's My listings and in buyers' Saved finds (labelled SOLD), and shows a disabled "Sold" button instead of "Message seller".
- **Conversations**: a conversation that already exists is kept, and both people can keep messaging. Nobody can start a NEW conversation about a sold item.
- **Rules** (`firestore.rules`): the owner may change only `status`, and only to `"sold"` from available (`validMarkSold`); new listings must start available (or have no status); `validNewConversation` refuses sold listings. Nobody else can change a listing's status.

### Deployment
Only the Firestore rules and the app need deploying (no Edge Function or Supabase change). Rules FIRST: the new app writes `status: "available"` when it creates a listing, which the old rules would refuse.

1. `npx.cmd firebase-tools deploy --only firestore:rules`
2. Build and release the web app / Android APK as usual.
