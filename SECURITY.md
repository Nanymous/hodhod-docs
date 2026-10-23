# Security model

## Scope

Hodhod protects message and file **content** from the server, database administrators, and anyone who obtains a database or storage backup. It does not hide metadata, and it does not defend against a compromised client, a malicious client build, or an operator who can change the JavaScript served to users.

## What the server can see

The server stores and can expose:

- Usernames, display names, profile fields, roles, verification state, and account status.
- Chat titles, types, membership, owners, timestamps, member counts, and message counts.
- Ciphertext envelopes, ciphertext sizes, message IDs, client IDs, reply targets, and reactions.
- Encrypted file blobs, byte sizes, SHA-256 of ciphertext, declared MIME type, uploader, and chat.
- Identity public keys and per-member wrapped group keys (wrapped to public keys; not usable without a member's private key).
- Authentication hashes (Argon2id over a client-side `authHash`), salts, IP addresses, user agents, sessions, devices, and audit events.
- Admin-visible statistics, reports, and moderation records.

The server does not receive plaintext message bodies, plaintext file bytes, identity private keys, password KEKs, group keys in plaintext, or unencrypted identity backups.

## Cryptography

All browser crypto uses the Web Crypto API. The canonical implementation is `public/js/e2ee.js`; the SPA loads the same primitives through `web/src/lib/e2ee.ts`.

- **Identity keys:** ECDH P-256 key pair. The public key is stored as JWK. The private key is never sent unencrypted.
- **Password login:** the browser sends `authHash = SHA-256(password | authSalt | tag)`; the server hashes that value again with Argon2id. The raw password never leaves the client, and the auth hash is domain-separated from the key-encryption key.
- **Password-wrapped identity:** PBKDF2-HMAC-SHA-256 (310,000 iterations) derives a KEK that encrypts the identity private key with AES-256-GCM.
- **Device-wrapped identity:** a non-extractable AES-GCM device key is kept in IndexedDB and wraps the identity private key for automatic unlock on that device.
- **Direct messages:** a random AES-256-GCM content key is generated per message. The sender creates an ephemeral ECDH P-256 key pair, derives wrapping keys with HKDF-SHA-256, and wraps the content key separately for the sender and each recipient. The envelope is stored server-side; only holders of a member's identity private key can unwrap it.
- **AAD binding:** v3 direct envelopes bind `{v:3,k:'dh',cid,mid}`. v3 group envelopes bind `{v:3,k:'g',cid,mid,gv}`. Decryption rejects mismatched chat IDs, message IDs, and group key versions. v2 envelopes remain decryptable for compatibility.
- **Group/channel messages:** a random 256-bit group key is encrypted once per message. The key is wrapped to each member's identity public key using ephemeral ECDH + HKDF + AES-GCM. Membership changes trigger a new group key version; a member removed before rotation cannot unwrap later versions.
- **Safety numbers:** a SHA-512-derived numeric fingerprint helps users compare identity public keys out of band and detect a server-side key substitution.
- **Files:** a random 256-bit file key encrypts chunks independently with AES-256-GCM. The container is `HHF1` (magic, version 1, 512 KiB plaintext chunks, per-chunk IV and length), and each chunk is bound to `{v:1,mid,i,n}`. The file key is carried inside the encrypted message payload.
- **Identity backup:** version 3, PBKDF2-SHA-256 with 600,000 iterations, AES-256-GCM, and AAD containing app, version, purpose, and username. The backup contains the private identity key, identity salt, and public key. It is generated and encrypted in the browser; the server never receives it.

### Why ECDH instead of RSA

Hodhod already uses a hybrid scheme: ephemeral ECDH P-256 derives key-wrapping keys, and AES-256-GCM protects message and file content. RSA would also require a hybrid construction (for example, RSA-OAEP wrapping an AES key); RSA alone cannot encrypt arbitrary message bodies.

RSA-OAEP is not automatically stronger than ECDH:

- RSA-2048 provides roughly 112-bit classical security; ECDH P-256 provides roughly 128-bit.
- RSA-4096 provides roughly 140-bit classical security, but its larger keys and ciphertexts make exchanges, backups, and browser key generation slower. It still does not provide forward secrecy on its own.
- ECDH permits a fresh ephemeral key per message, so a compromise of one message key does not expose other messages. Hodhod's static identity keys still mean there is no full forward secrecy against identity-key compromise; a ratchet would be required for that.
- AES-256-GCM remains the symmetric content cipher in both designs. Replacing ECDH with RSA would not increase AES's effective strength.

The current choice is therefore ECDH P-256 + HKDF-SHA-256 + AES-256-GCM. A future security upgrade should use X25519 (where Web Crypto support is available), a double ratchet for forward secrecy and post-compromise security, and sender signatures for authenticity/deniability. Switching to RSA would be a compatibility and performance regression, not a security upgrade.

## Authentication and sessions

- Login uses a client-side auth hash; the raw password is not transmitted.
- Sessions use an HTTP-only, SameSite cookie. State-changing API calls require an `X-CSRF` token tied to the session.
- Login attempts are rate-limited and lock out temporarily after repeated failures.
- Device identifiers are validated and associated with sessions; devices and sessions can be revoked.
- Admins can suspend accounts and review join requests. There is no server-side password reset or message-key escrow.

## Threat assumptions

Hodhod is designed against:

- A curious or compromised application server/database that captures stored messages and files.
- Backup theft (database and/or storage).
- Other users on the same deployment.
- Network observers when the app is served over HTTPS.

It is **not** designed against:

- A compromised browser, operating system, or XSS in the client.
- A server operator who serves modified JavaScript or malicious API behavior to clients.
- Traffic analysis or metadata correlation; the server intentionally sees chat/message/file metadata.
- Coercion of a user to unlock their own device or disclose a backup passphrase.
- A compromised identity private key or group key. Static identity keys mean there is no full forward secrecy.

## Operational hardening

- Set `app.env` to `production` and replace `app.secret` with a random 64-hex value.
- Use dedicated database credentials, not root, and restrict network access to MySQL.
- Serve only over HTTPS; add HSTS at the web server or reverse proxy.
- Keep `config/`, `server/`, `storage/`, `tests/`, `web/`, `.git*`, and launcher files inaccessible from the web root (the provided `.htaccess` blocks them; also consider moving storage outside the document root via `app.storage_dir`).
- Keep PHP, MariaDB/MySQL, Apache, Node, and browser dependencies patched.
- Verify that `post_max_size`/`upload_max_filesize` match the intended file limit.
- Back up the database and `storage/files`; protect backups as sensitive data.
- Review admin accounts and audit logs. Use the admin panel only over HTTPS.
- Leave Redis disabled unless it is reachable; otherwise every request may pay a connection timeout.
- Run the test suites against a disposable environment only; the live API test creates records.

## Reporting a vulnerability

Do not open a public issue containing exploit details or user data. Report privately to the deployment owner with a minimal reproduction, affected endpoint, and impact. There is no formal bug bounty.

## Audit status

This codebase has automated crypto and API tests, but it has **not** undergone an independent security audit. Treat the cryptographic design and implementation as unverified engineering work, not as a guarantee.
