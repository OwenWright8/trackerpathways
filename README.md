<div align="center">
  <img src="./public/logo.png" alt="Tracker Pathways Logo" width="120" />
  <h1>Tracker Pathways</h1>
</div>

Tracker Pathways is an open source tool designed to map the private tracker network, enabling exploration of invite routes with detailed requirements or visualization of connections using an interactive force directed graph to find the optimal path between communities.

## Self-hosting

This fork is set up to run on your own server. Searching happens in your browser using the bundled tracker data, so it never hits a server-side rate limit. The public site only allows 6 searches a minute per IP, and without proxy headers everyone shares one bucket.

### Quickstart (Docker)

```bash
curl -O https://raw.githubusercontent.com/OwenWright8/trackerpathways/main/docker-compose.yml
docker compose up -d
```

Open `http://<your-server>:3000`. There's no database or volume, and no account to set up.

To build from source instead, swap `image:` for `build: .` in `docker-compose.yml`. You can also run it without Docker on Node 20+:

```bash
npm ci && npm run build
cp -R public .next/standalone/ && cp -R .next/static .next/standalone/.next/
PORT=3000 node .next/standalone/server.js
```

### Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE` | `0` (off) | Caps `/api/routes` calls per client per minute. The web UI doesn't use the API, so this only affects scripts. |
| `TRUSTED_PROXY_HEADERS` | `false` | Set to `true` behind a reverse proxy you control, so per-client limits use the real IP from `X-Forwarded-For`. |
| `PORT` | `3000` | Port to listen on inside the container. |

### How it differs from upstream

- Route search runs in the browser. `/api/routes` is still there for scripts, and has no rate limit by default.
- HSTS and `upgrade-insecure-requests` are only sent over HTTPS, so plain-HTTP LAN installs work.
- `robots.txt` and page metadata tell search engines not to index the site, and the sitemap is gone.
- The Docker image is built for amd64 and arm64 and published to GHCR.

### Updating

Tracker data lives in `src/data/trackers.json` and is built into the image. The **Sync upstream** workflow merges `handokota/trackerpathways` once a day and rebuilds `ghcr.io/owenwright8/trackerpathways:latest` when anything changed. To pick up a new image:

```bash
docker compose pull && docker compose up -d
```

If an upstream change conflicts with this fork, the sync run fails and nothing is published. Merge it by hand:

```bash
git fetch upstream && git merge upstream/main
```

Credit for the app and its data goes to [handokota/trackerpathways](https://github.com/handokota/trackerpathways).

## Contributing

You're very welcome to contribute to Tracker Pathways! Please follow the [contribution guide](CONTRIBUTING.md) to get started.

## License

This project is open source and available under the [MIT License](LICENSE).
