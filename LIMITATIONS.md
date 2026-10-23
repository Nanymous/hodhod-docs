# Limitations and known gaps

This document records deliberate trade-offs and unfinished work. Do not describe Hodhod as audited or as providing guarantees beyond this list.

## Security limitations

- **No sender signatures.** Direct envelopes use ephemeral ECDH to each recipient but do not contain a signature by the claimed sender's identity key. A malicious server can inject or relabel a message envelope that a recipient will decrypt; sender identity in the UI comes from server metadata. Safety numbers verify identity keys, not per-message authorship.
- **No forward secrecy or post-compromise security.** Direct messages use long-term identity private keys to unwrap content keys. Anyone who obtains an identity private key (and the stored ephemeral wraps) can decrypt historical direct messages. Group keys are also wrapped to long-term identity keys. Nothing here is a double-ratchet protocol.
- **Group rotation protects the future, not the past.** Removing a member creates a new key version for future messages, but the removed member keeps old group keys and can read history it already had access to. Rotation is not retroactive and depends on clients performing the required rekey.
- **Device revocation cannot erase remote copies.** Revocation removes server-side device records/sessions and wraps. A revoked device that already cached the identity key or plaintext can still read what it has, and may decrypt future ciphertext if it can still obtain it.
- **Metadata is not private.** The server sees accounts, chat membership, titles, timestamps, message sizes, message IDs, reactions, file sizes/MIME, IP addresses, user agents, and admin actions. It can perform traffic analysis and correlation.
- **The operator controls the client code.** Because the SPA is served by the same server, a malicious operator can serve modified JavaScript that leaks keys. Self-hosting, CSP, and reproducible builds reduce but do not eliminate this. There is no signed/pinned client distribution.
- **Only content is end-to-end encrypted.** Profile fields, chat titles, join notes, verification reasons, reports, and similar metadata are stored in plaintext.
- **No independent audit.** The cryptographic design and implementation have automated tests but no third-party review. Do not treat test coverage as a security proof.
- **No key transparency.** Safety-number comparison is manual. There is no public append-only directory that would make invisible key substitution detectable at scale.
- **Compromised endpoints defeat the model.** XSS, malicious extensions, a compromised OS, or a coerced unlock can expose plaintext. The client keeps decrypted content and private keys in memory while unlocked; JavaScript cannot reliably zeroize memory.
- **File scanning is impossible server-side.** Uploaded files are ciphertext, so the server cannot run antivirus/content inspection. Recipients must treat decrypted files as untrusted.
- **Backups are long-term key material.** A v3 identity backup is encrypted with a user passphrase, but once decrypted it contains the static identity private key. Weak or reused backup passphrases are a serious risk.
- **Password semantics are split.** Login uses a domain-separated auth hash; the password-derived KEK protects the identity blob. Changing the password re-wraps the identity but does not change the identity key or past ciphertext.
- **Admin powers are powerful.** Admins can suspend accounts, delete chats, alter verification, and broadcast. These actions are audited, but a compromised admin session is high impact.
- **No account recovery service.** Lost identity backups plus lost device keys mean historical ciphertext is unrecoverable. There is no escrow, recovery code, or admin override.

## Product/behavioral gaps

- No voice/video calls, voice messages, stories, or push notifications.
- The legacy standalone admin panel has fewer features than the SPA admin panel (for example, file policy/cleanup is in the SPA).
- First-run installation and the legacy admin are separate from the SPA and are maintained for compatibility; they duplicate some UI and crypto-loading behavior.
- The UI ships Persian and English only. RTL is the primary layout; additional locales need translation and layout review.
- Search and other client-side operations are limited by what has been decrypted/loaded in the browser. There is no server-side plaintext search by design.
- Retention/cleanup runs when triggered; there is no external scheduler in this repository.
- File MIME is client-declared and enforced against a policy list. The server cannot verify true content type because it only sees ciphertext.

## Deployment gaps

- `config/config.php` ships with development defaults (`app.env = development`, a placeholder secret, local DB root credentials). These must be changed before exposure to untrusted users. There is no hard startup refusal for insecure production settings yet.
- HTTPS/HSTS is expected from Apache or a reverse proxy; the app itself does not force TLS.
- Redis is optional and disabled by default. If enabled while unreachable, it can add latency to requests until timeouts expire.
- PHP's `post_max_size`/`upload_max_filesize` may be lower than the app's 50 MB limit depending on the host; verify the effective values.
- The provided `.htaccess` guards the source tree and storage, but moving `storage/` outside the document root is still recommended for defense in depth.
- There is no container image, systemd unit, or automated deployment pipeline in the repository.
- No log rotation or centralized monitoring configuration is included.

## Testing gaps

- There is no automated browser E2E suite. The SPA has unit tests and type checks. SPA login/unlock and the legacy admin dashboard were smoke-tested in headless Chrome (including the password-unlock call order and admin SVG icons), but send → file → admin mutation flows were not exercised end-to-end in a real browser.
- Accessibility (keyboard, screen reader, contrast) has not been audited.
- Load, soak, and multi-node concurrency tests are not included.
- The live API test creates records and expects a local admin fixture; it must not be pointed at production.
- Error-path coverage for disk-full, Redis failure, and concurrent key rotations is limited.
- Legacy admin/install pages are checked syntactically and by HTTP smoke checks, not by browser automation.

## Near-term roadmap

1. Add cryptographic sender signatures (or an authenticated sender key in the AAD) and verify them in the client, then show a verified/forged state in the UI.
2. Add a double-ratchet-style session protocol for forward secrecy and post-compromise security.
3. Add Playwright browser E2E tests covering install, join approval, unlock, direct/group messaging, file round-trip, backup restore, device revocation, and admin actions.
4. Add production configuration validation (refuse placeholder secrets, require HTTPS awareness, warn on default DB credentials).
5. Add admin 2FA, stricter session binding, and configurable audit retention.
6. Add key transparency or at least a signed key directory with client-side consistency checks.
7. Add accessibility and performance audits, plus load testing for SSE and message pagination.
8. Consolidate the installer/legacy admin into the SPA or clearly version and test them as first-class entry points.
