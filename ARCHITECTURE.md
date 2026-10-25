# Architecture

## Overview

Hodhod is a modular PHP API plus a client-rendered React SPA.

```
Browser
  React SPA (<base>/app/)
    - UI, i18n, state, file chunking
    - E2EE primitives (public/js/e2ee.js)
    - fetch API + SSE, base URLs derived from window.location
        |
        | HTTPS, cookies, X-CSRF, X-Device-Id
        v
Apache (<base>/)
  .htaccess routing + security headers
        |
        +-- /api/auth|users|chats|messages|files|stream|admin
        |       -> server/api/<module>/index.php
        |             -> server/lib/* -> MySQL
        |
        +-- /app/* -> public/app (built SPA)
        +-- /public/js/* -> shared E2EE script and installer script
        +-- /storage/* -> blocked
        +-- /config|server|tests|web -> blocked
```

`<base>` is the directory that serves Hodhod. The installer detects it from `SCRIPT_NAME` and stores the chosen value in `config/install.json`; the launcher reads the same file. Root installs have an empty base. The built SPA uses a relative Vite base and resolves API, E2EE, and SSE URLs from its own location, so the same build works at any path or port.

The SPA uses the same browser crypto implementation as the other entry points: `public/js/e2ee.js` is loaded as a classic script before the app bundle, and `web/src/lib/e2ee.ts` provides typed access to it.

## Request lifecycle

1. Apache rewrites authorized API paths to the matching PHP module. Each module derives the route with `Util::apiPath()`, which finds `/api/` in the request URI instead of assuming the install directory name.
2. `server/lib/bootstrap.php` loads configuration and libraries, initializes PDO, and initializes Redis if enabled (MySQL fallback otherwise).
3. CSRF is enforced for `POST`/`PUT`/`DELETE` when a session exists.
4. The module router dispatches the route; handlers validate input and call the database/cache/file layers.
5. Responses use the JSON envelope `{ok:true,...}` or `{ok:false,error}`. Errors are mapped to appropriate HTTP status codes (400/401/403/404/409/413/429/500).
6. Audit events and live events are written for significant state changes. `GET /api/stream` exposes them as SSE.

Only one same-origin deployment is supported; cross-origin CORS is not enabled.

## Backend modules

- `server/api/auth/`: join request/status, password login, current session, logout, password change, relock, device registration/listing/revocation, session listing/revocation (joined with readable device names), logout-all.
- `server/api/users/`: user search, profile, privacy settings, avatar upload/serve/delete, public identity key, safety-number inputs.
- `server/api/chats/`: list/create direct/group/channel, detail, members, key rotation, blacklist, leave, read receipt, preferences, delete.
- `server/api/messages/`: history pagination, send (idempotent by client ID), edit, delete, reactions, typing.
- `server/api/files/`: limits, encrypted upload, encrypted download, deletion.
- `server/api/stream/`: authenticated SSE with only event IDs/metadata.
- `server/api/admin/`: stats, join requests, users, chats, verification, audit, broadcasts, file policy/usage/cleanup.

## Data model

Core tables:

- `users`: account, role/status, Argon2id auth hash, identity public key, password-wrapped identity blob, per-device wrapped identity blob, identity salt/version, avatar path/MIME/version/visibility.
- `sessions`: hashed session tokens, CSRF token, device association, activity and expiry. Session listings join `user_devices` to show a readable device name.
- `user_devices`: device ID/name, wrapped identity blob, revocation.
- `chats`, `chat_members`: conversations, membership, roles, unread/read state, per-chat preferences, and removed-member blacklist state.
- `chat_keys`: wrapped group keys by chat key version and member.
- `messages`: encrypted payload, chat/message IDs, client ID for idempotency, edits, reply target, deletion, file association. Image captions are part of the encrypted payload, not a separate column.
- `message_reactions`, `files`, `file_usage`: reactions (at most one per user per message), encrypted-file accounting.
- `join_requests`, `verification_gifts`, `audit_log`, `presence`: onboarding and moderation.
- `events`: per-user SSE event queue.
- `cache_kv`, `rate_limit_hits`: Redis fallback for cache and rate limits.
- `app_settings`: admin-adjustable limits and MIME policy.

Schema bootstrap is `config/schema.sql`; incremental changes live in `config/migrations/` and are applied by `server/migrate.php` (or by the installer on first run). Migration `004_profile_avatar.sql` adds the avatar columns and has no data backfill.

## Messaging flow

### Direct chat

1. The client fetches members' public identity keys (included in chat detail).
2. It generates a random content key and encrypts the JSON message payload with AES-256-GCM.
3. It generates an ephemeral ECDH key pair and wraps the content key for every recipient (including the sender) with HKDF-derived AES keys.
4. The server stores the base64url envelope and metadata. It cannot unwrap the content key.
5. The recipient downloads the envelope, unwraps its own content key with its identity private key, and verifies the AAD binding (`chat_id`, `message_id`) before decrypting.

### Group/channel

1. The group owner generates a group key and stores a wrapped copy per member (`chat_keys`).
2. Messages use the group key with AAD binding to chat, message, and key version.
3. Adding/removing members or an explicit rekey request creates a new key version and a new set of wraps. Old messages remain readable with old keys; future messages use the new version.
4. Channels use the same key mechanism; posting rights are enforced by the API, while content remains encrypted like a group.

### Reactions

1. The client posts a reaction for a message it can access.
2. The server locks the message row, deletes any existing reaction by that user, and inserts the new one; tapping the same reaction only removes it.
3. Deleted messages are rejected before the reaction is written.
4. Reaction counts and the caller's own state are returned, then broadcast to chat members as metadata.

### Image messages

1. An image travels through the same encrypted file flow as any attachment.
2. Its caption is stored in the encrypted message payload, so the server never sees it.
3. The client downloads and decrypts the image, renders it inline, and exposes the caption and a full-screen viewer.
4. Downloads use `Content-Disposition: inline` because the endpoint feeds the in-page decryptor rather than the browser's download manager.

### Files

1. The sender encrypts a file into the `HHF1` container with a random 256-bit key and binds every chunk to the message ID.
2. The client uploads the encrypted container as raw `application/octet-stream` with CSRF and device headers.
3. The server enforces size limits, MIME policy, daily count, per-user quota, and retention.
4. The file key is embedded in the encrypted message payload; only chat members who can decrypt that message can decrypt the file.
5. Download returns ciphertext; decryption happens in the browser. Deleting a file soft-deletes the record, removes bytes, and refunds quota.

### Profile photos

1. The authenticated user uploads raw image bytes to `POST /api/users/avatar` (JPEG, PNG, or WebP, 3 MB maximum, 32×32 minimum).
2. `AvatarService` re-encodes through GD where available; otherwise it rebuilds the container while stripping EXIF/XMP/ICC/comments, then reparses the result.
3. The file is written under `storage/avatars/<user-id>/` with a random name, outside the web root. Path, MIME, and a new version are stored on the user row.
4. `GET /api/users/avatar?id=…` checks account status and `avatar_visibility` (`chats` or `everyone`) before streaming. Responses carry an ETag tied to the version and use `private, no-cache` so visibility changes take effect immediately.
5. Replacing or deleting a photo removes the previous file. Profile changes are broadcast as `user:profile` metadata to shared chats.

## Frontend

- React 18 + TypeScript strict mode; Vite builds to `public/app/`.
- No component/CSS framework; custom design tokens and RTL-first styles.
- `web/src/state/AppContext.tsx` coordinates auth/unlock, chat/message state, file encryption/decryption, SSE, and preferences.
- `web/src/lib/api.ts` handles API errors, CSRF, and device headers.
- `web/src/lib/i18n.ts` provides Persian and English dictionaries; a parity test keeps keys aligned.
- `web/src/lib/e2ee.ts` is the typed wrapper around the shared `HodhodE2EE` browser implementation.
- IndexedDB stores the non-extractable per-device key; localStorage stores non-secret device ID/name and UI preferences.

### Screens and layout

- **Auth and onboarding:** sign-in, join request, and first-run identity unlock.
- **Workspace:** navigation rail, searchable chat list, conversation header, virtualized timeline, and composer.
- **Overlays:** message action menu, chat/group details, new chat/group, profile editor, image lightbox, and settings.
- **Settings:** profile, privacy, security, appearance, and identity backup tabs.
- **Administration:** dashboard, join review, users, chats, files, audit, and broadcast.

The desktop layout is a three-column shell that collapses to two columns on tablets and a drawer-based single column on phones. The composer respects safe-area insets; dialogs trap focus and close on Escape or backdrop click.

### Message list and overlays

- `@tanstack/react-virtual` keeps long histories cheap to render.
- Pending sends carry a client ID and are reconciled with the server row instead of being appended twice.
- Timeline rows establish local stacking contexts, while an open message menu is promoted above neighboring rows so it is never clipped.
- Deleted rows omit actions and reaction controls; one reaction per user is enforced by the API and reflected in the UI.
- Image bubbles render the decrypted preview plus the encrypted caption in a column, in both RTL and LTR.
- Any mutation temporarily preserves the row's measured height to avoid scroll jumps.

### Theming, locale, and accessibility

- `web/src/styles/tokens.css` defines light and dark palettes, spacing, radii, shadows, and motion.
- The root `dir` follows the locale; Persian is RTL by default and English is LTR.
- A `--font-scale` custom property adjusts text size without rewriting layout rules.
- Shared primitives in `web/src/components/ui.tsx` provide focus-visible states, labels, modal behavior, and keyboard handlers.
- Icons are inline SVG with no emoji dependency; Vazirmatn subsets are self-hosted.
- `prefers-reduced-motion` reduces animation and smooth scrolling.

## Legacy pages

- `server/install.php` serves the first-run installer only while `.installed` is absent. It detects the current install path, lets the operator choose the final base path and port, previews the URL, and validates both before touching the database. It then creates the database, schema, migrations, and first admin identity, and writes `config/install.json` with the chosen address. The identity backup is generated in the browser with the v3 encrypted format. It loads `public/js/e2ee.js` and `public/js/install.js`.

## Testing strategy

- `tests/test-e2ee.js`: legacy/direct/group envelope and backup compatibility.
- `tests/test-e2ee-v3.js`: v3 AAD binding, key-version checks, file container round-trips, backup format.
- `tests/test-api.js`: live API integration over HTTP with real sessions, CSRF, devices, encrypted payloads, file uploads, and admin operations.
- `web/src/**/*.test.*`: Vitest + jsdom for formatting, localization parity, and UI building blocks (`12` tests in the reference build).
- `npm run typecheck`/`npm run build`: TypeScript and production build verification.
- Headless Chrome captures the main product screens at desktop widths and `390×844` for the product tour; this is a manual smoke run, not committed browser E2E automation.
