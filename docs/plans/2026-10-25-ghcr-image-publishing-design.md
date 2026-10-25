# GHCR image publishing + pull-or-build compose

**Date:** 2026-10-25
**Status:** Design approved, pending implementation

## Goal

Offload the four application image builds (`listener`, `processor`, `api`, `frontend`)
to GitHub Actions, publish them to GHCR, and have `docker-compose.yml` use the published
images by default — while any developer can still build locally if they choose, with no
change to the existing `docker compose build` workflow.

## Decisions

- **Mechanism:** each app service declares **both** `image:` and `build:` (option A). One
  compose file, single source of truth. `docker compose pull` uses the published image;
  `docker compose build` builds locally and tags it as that same image name.
- **Registry:** GHCR, `ghcr.io/osintukraine/tg-archiver-<svc>`. Packages set **public**
  (repo is public) so pulls need no login.
- **Tags (published per build):** branch name (`main` / `develop`), immutable `sha-<short>`,
  and `latest` **only on `main`**.
- **Compose default:** `${TG_IMAGE_TAG:-latest}` — stable `main` by default; the dev box
  sets `TG_IMAGE_TAG=develop` in `.env`; anyone can pin `sha-<short>`.
- **Architecture:** `linux/amd64` only. arm64 contributors build locally (option A covers
  them). Keeps CI fast; the dev/prod boxes are x86_64.

## Changes

### 1. CI — evolve the existing `docker-build` job (`.github/workflows/ci.yml`)

Keep the service matrix (`listener`, `processor`, `api`, `frontend`) and the gha build cache.
Add:

- Job (or workflow) permission `packages: write` (plus existing `contents: read`).
- `docker/login-action` to `ghcr.io` using `${{ github.actor }}` / `${{ secrets.GITHUB_TOKEN }}`.
- `docker/metadata-action` with `images: ghcr.io/osintukraine/tg-archiver-${{ matrix.service }}`
  and tags:
  - `type=ref,event=branch` → `main`, `develop`
  - `type=sha,prefix=sha-,format=short` → `sha-<short>`
  - `type=raw,value=latest,enable={{is_default_branch}}` → `latest` on `main` only
- `docker/build-push-action` with:
  - `platforms: linux/amd64`
  - `push: ${{ github.event_name != 'pull_request' }}` — **PRs build only (validation, no push);
    pushes to `main`/`develop` build + push.**
  - `tags`/`labels` from metadata-action
  - `cache-from`/`cache-to: type=gha,scope=<service>` (unchanged)

The `org.opencontainers.image.source` label (metadata-action default) links each package to
the repo.

### 2. `docker-compose.yml` — the four app services

For each of `listener`, `processor`, `api`, `frontend`, add an `image:` alongside the
existing `build:` (build unchanged):

```yaml
  api:
    image: ghcr.io/osintukraine/tg-archiver-api:${TG_IMAGE_TAG:-latest}
    build:
      context: .
      dockerfile: services/api/Dockerfile
```

Infra services (`postgres`, `db-migrate`, `redis`, `seaweedfs`, `caddy`, `prometheus`) are
unchanged — already upstream images.

Compose reads `.env` for `${TG_IMAGE_TAG}` interpolation. This is distinct from service
runtime env (compose has no `env_file`); image interpolation and runtime env are separate,
so this does not reintroduce an env_file.

### 3. Documentation

- **README** — new "Prebuilt images vs. building locally" subsection:
  - Use GitHub's images: `docker compose pull && docker compose up -d` (`latest` = `main`;
    set `TG_IMAGE_TAG=develop` in `.env` to track develop; pin `TG_IMAGE_TAG=sha-<short>`).
  - Build locally (unchanged): `docker compose build && docker compose up -d`.
  - Update the Development test commands that run `docker run … tg-archiver-<svc>` to the new
    image names `ghcr.io/osintukraine/tg-archiver-<svc>` (and the note stating image names
    follow the compose project name).
- **CLAUDE.md** — update "Building Services" and any `tg-archiver-<svc>` image-name references;
  add a one-line note on the pull-or-build model and `TG_IMAGE_TAG`.
- **.env.example** — add `TG_IMAGE_TAG` with a comment (default `latest`, dev uses `develop`).

## Known caveats (documented, not hidden)

1. **GHCR packages are private by default**, even from a public repo. After the first push to
   `main`/`develop`, the four packages must be set **public** once (GitHub package settings or
   API) so other developers pull without `docker login`. One-time operator step. Until then,
   pulling needs `docker login ghcr.io` with a PAT (`read:packages`).
2. **Renamed images:** adding explicit `image:` changes built image names from
   `tg-archiver-<svc>` to `ghcr.io/osintukraine/tg-archiver-<svc>`. Container names
   (`container_name: tg-archiver-<svc>`) are unaffected. Docs that reference the old image
   names are updated in this change.
3. **Frontend is URL-baked:** `NEXT_PUBLIC_*` (incl. `NEXT_PUBLIC_BASE_URL`) are baked at
   build time, so the *published* frontend image carries default (`localhost`) URLs. Fine for
   a localhost dev box; for a real production domain, build the frontend locally (or pass
   build-args), since CI cannot know the deploy URL. The three Python images are fully
   portable; only the frontend has this caveat. Documented in README.

## Verification

- **PR CI:** the `docker-build` job builds all four services (push skipped on the PR).
- **Post-merge to develop:** the four `:develop` + `:sha-<short>` images appear in GHCR;
  `docker compose pull` succeeds after the packages are made public.
- **Local build still works:** `docker compose build <svc>` produces
  `ghcr.io/osintukraine/tg-archiver-<svc>:<tag>` (visible in `docker images`), and
  `docker compose up -d` uses it.
- Do **not** run `docker compose config` to verify (it resolves and prints secrets per
  CLAUDE.md); verify via `docker images` after a build and via `docker compose pull`.

## Out of scope

- arm64 / multi-arch images (contributors build locally).
- Signing / SBOM / provenance attestation (can be added later).
- Publishing infra images (they are upstream).
- Deploy automation (pulling images onto prod is a separate concern).
