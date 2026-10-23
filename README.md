# Hodhod Docs

Public operator documentation for **Hodhod**, a Persian-first, self-hosted messenger with browser-side end-to-end encryption for messages and files.

**Live site:** https://nanymous.github.io/hodhod-docs/

The application source is private. This repository contains the documentation site and its reference notes only.

## Reference documents

- [Architecture](ARCHITECTURE.md)
- [Security model](SECURITY.md)
- [Known limitations](LIMITATIONS.md)

## Local preview

```powershell
python -m http.server 8799 --directory docs
```

Open `http://127.0.0.1:8799/`.

## Deployment

Pushes to `main` deploy the `docs/` directory to GitHub Pages through GitHub Actions. The published site is fully static: no analytics, no font CDN, and no telemetry.
