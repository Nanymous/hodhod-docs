# Architecture

## Overview

Hodhod is a modular PHP API plus a client-rendered React SPA.

```
Browser
  React SPA (/messanger/app/)
    - UI, i18n, state, file chunking
    - E2EE primitives (public/js/e2ee.js)
    - fetch API + SSE
        |
        | HTTPS, cookies, X-CSRF, X-Device-Id
        v
Apache (/messanger/)
  .htaccess routing + security headers
        |
        +-- /api/auth|users|chats|messages|files|stream|admin
        |       -> server/api/<module>/index.php
        |             -> server/lib/* -> MySQL
        |
        +-- /app/* -> public/app (built SPA)
        +-- /fonts/* -> public/fonts
        +-- /admin/ -> public/admin (legacy admin)
        +-- /storage/* -> blocked
        +-- /config|server|tests|web -> blocked
```

The SPA uses the same browser crypto implementation as the other entry points: `public/js/e2ee.js` is loaded as a classic script before the app bundle, and `web/src/lib/e2ee.ts` provides typed access to it.

## Request lifecycle

1. Apache rewrites authorized API paths to the matching PHP module.
2. `server/lib/bootstrap.php` loads configuration and libraries, initializes PDO, and initializes Redis if enabled (MySQL fallback otherwise).
3. CSRF is enforced for `POST`/`PUT`/`DELETE` when a session exists.
4. The module router dispatches the route; handlers validate input and call the database/cache/file layers.
5. Responses use the JSON envelope `{ok:true,...}` or `{ok:false,error}`. Errors are mapped to appropriate HTTP status codes (400/401/403/404/409/413/429/500).
6. Audit events and live events are written for significant state changes. `GET /api/stream` exposes them as SSE.

Only one same-origin deployment is supported; cross-origin CORS is not enabled.

## Backend modules

- `server/api/auth/`: join request/status, password login, current session, logout, password change, relock, device registration/listing/revocation, session listing/revocation, logout-all.
- `server/api/users/`: user search, profile, privacy settings, public identity key, safety-number inputs.
- `server/api/chats/`: list/create direct/group/channel, detail, members, key rotation, blacklist, leave, read receipt, preferences, delete.
- `server/api/messages/`: history pagination, send (idempotent by client ID), edit, delete, reactions, typing.
- `server/api/files/`: limits, encrypted upload, encrypted download, deletion.
- `server/api/stream/`: authenticated SSE with only event IDs/metadata.
- `server/api/admin/`: stats, join requests, users, chats, verification, audit, broadcasts, file policy/usage/cleanup.

## Data model

Core tables:

- `users`: account, role/status, Argon2id auth hash, identity public key, password-wrapped identity blob, per-device wrapped identity blob, identity salt/version.
- `sessions`: hashed session tokens, CSRF token, device association, activity and expiry.
- `user_devices`: device ID/name, wrapped identity blob, revocation.
- `chats`, `chat_members`: conversations, membership, roles, unread/read state, per-chat preferences, and removed-member blacklist state.
- `chat_keys`: wrapped group keys by chat key version and member.
- `messages`: encrypted payload, chat/message IDs, client ID for idempotency, edits, reply target, deletion, file association.
- `message_reactions`, `files`, `file_usage`: reactions and encrypted-file accounting.
- `join_requests`, `verification_gifts`, `audit_log`, `presence`: onboarding and moderation.
- `events`: per-user SSE event queue.
- `cache_kv`, `rate_limit_hits`: Redis fallback for cache and rate limits.
- `app_settings`: admin-adjustable limits and MIME policy.

Schema bootstrap is `config/schema.sql`; incremental changes live in `config/migrations/` and are applied by `server/migrate.php` (or by the installer on first run).

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

### Files

1. The sender encrypts a file into the `HHF1` container with a random 256-bit key and binds every chunk to the message ID.
2. The client uploads the encrypted container as raw `application/octet-stream` with CSRF and device headers.
3. The server enforces size limits, MIME policy, daily count, per-user quota, and retention.
4. The file key is embedded in the encrypted message payload; only chat members who can decrypt that message can decrypt the file.
5. Download returns ciphertext; decryption happens in the browser. Deleting a file soft-deletes the record, removes bytes, and refunds quota.

## Frontend

- React 18 + TypeScript strict mode; Vite builds to `public/app/`.
- No component/CSS framework; custom tokens and RTL-first styles.
- `web/src/state/AppContext.tsx` coordinates auth/unlock, chat/message state, file encryption/decryption, SSE, and preferences.
- `web/src/lib/api.ts` handles API errors, CSRF, and device headers.
- `web/src/lib/i18n.ts` provides Persian and English dictionaries; a parity test keeps keys aligned.
- `web/src/lib/e2ee.ts` is the typed wrapper around the shared `HodhodE2EE` browser implementation.
- Virtualized message list (`@tanstack/react-virtual`) and responsive chat layout.
- IndexedDB stores the non-extractable per-device key; localStorage stores non-secret device ID/name and UI preferences.

## Legacy pages

- `public/admin/` is a standalone admin panel. It uses the same `/api/admin` endpoints and loads the shared E2EE script for auth hashing. The SPA's Admin Panel is the richer interface.
- `server/install.php` serves the first-run installer only while `.installed` is absent. It creates the database, schema, migrations, and first admin identity. The identity backup is generated in the browser with the v3 encrypted format.

## Testing strategy

- `tests/test-e2ee.js`: legacy/direct/group envelope and backup compatibility.
- `tests/test-e2ee-v3.js`: v3 AAD binding, key-version checks, file container round-trips, backup format.
- `tests/test-api.js`: live API integration over HTTP with real sessions, CSRF, devices, encrypted payloads, file uploads, and admin operations.
- `web/src/**/*.test.*`: Vitest + jsdom for formatting and UI building blocks.
- `npm run typecheck`/`npm run build`: TypeScript and production build verification.
