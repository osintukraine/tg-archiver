# GHCR Image Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the four app images (listener, processor, api, frontend) to GHCR from CI, have docker-compose use them by default, and keep `docker compose build` working for local development.

**Architecture:** Each app service declares both `image:` (GHCR ref with `${TG_IMAGE_TAG:-latest}`) and `build:`. CI's `docker-build` job gains GHCR login + `docker/metadata-action` tagging (branch / `sha-<short>` / `latest`-on-main) and pushes on branch pushes (not PRs). Docs explain pull-vs-build.

**Tech Stack:** GitHub Actions, GHCR, docker/metadata-action, docker/build-push-action, Docker Compose.

**Spec:** `docs/plans/2026-10-25-ghcr-image-publishing-design.md`

**Note on "tests":** this is CI/compose/docs config — there are no unit tests. Each task's verification is a concrete command (YAML parse, `env_audit`, a local build that proves the image tag, `grep`). The authoritative end-to-end proof (actual GHCR push) happens in CI after merge; a task covers confirming that.

---

### Task 1: Add `image:` to the four app services in `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml` (services `listener`, `processor`, `api`, `frontend`)

- [ ] **Step 1: Add `image:` to `api`**

Find the `api:` service and add an `image:` line as its first key (before `build:`):

```yaml
  api:
    image: ghcr.io/osintukraine/tg-archiver-api:${TG_IMAGE_TAG:-latest}
    build:
      context: .
      dockerfile: services/api/Dockerfile
    container_name: tg-archiver-api
```

- [ ] **Step 2: Add `image:` to `listener`**

```yaml
  listener:
    image: ghcr.io/osintukraine/tg-archiver-listener:${TG_IMAGE_TAG:-latest}
    build:
      context: .
      dockerfile: services/listener/Dockerfile
```

- [ ] **Step 3: Add `image:` to `processor`**

```yaml
  processor:
    image: ghcr.io/osintukraine/tg-archiver-processor:${TG_IMAGE_TAG:-latest}
    build:
      context: .
      dockerfile: services/processor/Dockerfile
```

- [ ] **Step 4: Add `image:` to `frontend`** (its `build:` has `args:` — keep them)

```yaml
  frontend:
    image: ghcr.io/osintukraine/tg-archiver-frontend:${TG_IMAGE_TAG:-latest}
    build:
      context: .
      dockerfile: services/frontend/Dockerfile
      args:
```

- [ ] **Step 5: Verify YAML parses and the four images are present**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml')); print('yaml ok')"
grep -c 'image: ghcr.io/osintukraine/tg-archiver-' docker-compose.yml
```
Expected: `yaml ok` and `4`.

- [ ] **Step 6: Verify a local build tags the GHCR name** (proves `build` still works and tags correctly)

Run:
```bash
docker compose build api
docker images --format '{{.Repository}}:{{.Tag}}' | grep 'tg-archiver-api'
```
Expected: a line `ghcr.io/osintukraine/tg-archiver-api:latest`.
Do NOT run `docker compose config` (it resolves and prints secrets).

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(compose): use GHCR images for app services, keep local build"
```

---

### Task 2: Make CI build and push to GHCR (`.github/workflows/ci.yml`)

**Files:**
- Modify: `.github/workflows/ci.yml` (the `docker-build` job)

The current job (keep the matrix + gha cache) is:

```yaml
  docker-build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        service: [listener, processor, api, frontend]
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          context: .
          file: services/${{ matrix.service }}/Dockerfile
          push: false
          cache-from: type=gha,scope=${{ matrix.service }}
          cache-to: type=gha,scope=${{ matrix.service }},mode=max
```

- [ ] **Step 1: Replace the `docker-build` job with the push-enabled version**

```yaml
  docker-build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      packages: write
    strategy:
      fail-fast: false
      matrix:
        service: [listener, processor, api, frontend]
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Image metadata (tags + labels)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/osintukraine/tg-archiver-${{ matrix.service }}
          tags: |
            type=ref,event=branch
            type=sha,prefix=sha-,format=short
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/build-push-action@v7
        with:
          context: .
          file: services/${{ matrix.service }}/Dockerfile
          platforms: linux/amd64
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=${{ matrix.service }}
          cache-to: type=gha,scope=${{ matrix.service }},mode=max
```

Note: the workflow keeps its top-level `permissions: { contents: read }`; this job adds `packages: write` locally, so the other jobs stay least-privileged.

- [ ] **Step 2: Verify the workflow YAML parses**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"
```
Expected: `yaml ok`.

- [ ] **Step 3: Verify the push gate and platform are set**

Run:
```bash
grep -nE "push: \\$\\{\\{ github.event_name != 'pull_request'|platforms: linux/amd64|packages: write" .github/workflows/ci.yml
```
Expected: three matching lines.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build and push app images to GHCR (branch/sha/latest tags)"
```

---

### Task 3: Add `TG_IMAGE_TAG` to `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the variable near the top of `.env.example`** (after the opening header comment block, before the first settings section)

```bash
# =============================================================================
# Docker image source
# =============================================================================
# Which published image tag docker-compose pulls for the app services
# (listener, processor, api, frontend). Default "latest" tracks main.
# Set to "develop" to track the develop branch, or "sha-<short>" to pin an
# exact commit. Ignored when you build locally with `docker compose build`.
TG_IMAGE_TAG=latest
```

- [ ] **Step 2: Verify env_audit still passes (TG_IMAGE_TAG is referenced via compose `image:`)**

Run:
```bash
pip install -q pyyaml 2>/dev/null; python3 scripts/env_audit.py --env-file .env.example --strict
```
Expected: exit 0, no `DEAD_NOT_PASSED` for `TG_IMAGE_TAG` (env_audit captures `${TG_IMAGE_TAG}` from each service's `image:` field via `other_vars`).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(env): add TG_IMAGE_TAG for selecting the published image tag"
```

---

### Task 4: Document pull-vs-build in `README.md` and fix renamed-image test commands

**Files:**
- Modify: `README.md` (Development section)

- [ ] **Step 1: Add a "Prebuilt images vs. building locally" subsection** at the start of the `## Development` section (right after the `## Development` heading, before `### Directory Structure`)

```markdown
### Prebuilt images vs. building locally

The four app services (`listener`, `processor`, `api`, `frontend`) are published to GHCR by CI
(`ghcr.io/osintukraine/tg-archiver-<service>`). You can either pull them or build locally — the
`docker-compose.yml` services carry both `image:` and `build:`.

```bash
# Use GitHub's prebuilt images (no local build):
docker compose pull && docker compose up -d
# `latest` tracks main. To track develop or pin a commit, set TG_IMAGE_TAG in .env:
#   TG_IMAGE_TAG=develop        (or)   TG_IMAGE_TAG=sha-abc1234

# Build locally instead (unchanged workflow):
docker compose build && docker compose up -d
```

`docker compose build` tags the local image with the same GHCR name, so `up` uses whichever you
produced last (pulled or built). The three Python images are fully portable; the **frontend image
bakes `NEXT_PUBLIC_*` at build time**, so the published frontend image carries default (`localhost`)
URLs — for a custom production domain, build the frontend locally so your `PUBLIC_BASE_URL` is baked in.
```

- [ ] **Step 2: Update the Python-test `docker run` commands to the new image names**

In the Development → Python tests block, replace the three image references:

- `tg-archiver-processor sh -c` → `ghcr.io/osintukraine/tg-archiver-processor:${TG_IMAGE_TAG:-latest} sh -c`
- `tg-archiver-listener sh -c` → `ghcr.io/osintukraine/tg-archiver-listener:${TG_IMAGE_TAG:-latest} sh -c`
- `tg-archiver-api sh -c` → `ghcr.io/osintukraine/tg-archiver-api:${TG_IMAGE_TAG:-latest} sh -c`

And replace the note line:

- Old: `Image names follow the compose project name (\`tg-archiver-*\` when the checkout directory is \`tg-archiver\`).`
- New: `Compose builds tag images as \`ghcr.io/osintukraine/tg-archiver-<service>:${TG_IMAGE_TAG:-latest}\` (default tag \`latest\`); the test commands above use that name.`

- [ ] **Step 3: Verify the stale image names are gone and the new section exists**

Run:
```bash
grep -nE 'tg-archiver-(processor|listener|api) sh -c' README.md || echo "no stale image names"
grep -c 'Prebuilt images vs. building locally' README.md
```
Expected: `no stale image names` and `1`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): document pull-vs-build images and GHCR image names"
```

---

### Task 5: Update `CLAUDE.md` build guidance

**Files:**
- Modify: `CLAUDE.md` (the "Building Services" section)

- [ ] **Step 1: Add a note under the "Building Services (MANDATORY)" section** about the pull-or-build model, after the existing build commands:

```markdown
The four app services carry both `image:` (GHCR) and `build:`. `docker compose build` builds locally
and tags the image as `ghcr.io/osintukraine/tg-archiver-<service>:${TG_IMAGE_TAG:-latest}`;
`docker compose pull` fetches CI-published images instead. CI pushes `latest` (main), the branch name,
and `sha-<short>` on every push to main/develop. Set `TG_IMAGE_TAG` in `.env` to choose a tag.
```

- [ ] **Step 2: Verify the note is present**

Run:
```bash
grep -c 'docker compose pull. fetches CI-published' CLAUDE.md
```
Expected: `1`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): note the GHCR pull-or-build image model"
```

---

### Task 6: Open PR, verify CI, and the one-time public-package step

**Files:** none (process)

- [ ] **Step 1: Push the branch and open a PR to `develop`**

```bash
git push -u origin worktree-cicd-ghcr
gh pr create --base develop --head worktree-cicd-ghcr \
  --title "CI: publish app images to GHCR; compose pulls or builds" \
  --body "Implements docs/plans/2026-10-25-ghcr-image-publishing-design.md"
```

- [ ] **Step 2: Verify PR CI is green** — in particular `docker-build` (it builds all four; `push` is skipped because the event is a pull_request).

Run: `gh pr checks <PR#>`
Expected: all checks pass, including `docker-build (api|listener|processor|frontend)`.

- [ ] **Step 3: Merge to develop** (rebase), which triggers a push build that publishes `:develop` + `:sha-<short>` images.

- [ ] **Step 4: Confirm images published**

Run (after the develop CI run finishes):
```bash
gh api /orgs/osintukraine/packages?package_type=container 2>/dev/null | grep -oE 'tg-archiver-(listener|processor|api|frontend)' | sort -u
```
Expected: the four package names. (If the org API 404s, list via the repo's Packages page.)

- [ ] **Step 5: One-time operator step — make the four packages public**

GHCR packages are created **private** by default. For other developers to `docker compose pull` without `docker login`, set each of the four `tg-archiver-<service>` packages to **public** once (GitHub → the package → Package settings → Change visibility → Public). This is a manual click the repo owner performs; until then, pulling needs `docker login ghcr.io` with a `read:packages` PAT.

- [ ] **Step 6: Verify a clean pull works** (after packages are public)

Run (from a logged-out shell):
```bash
docker pull ghcr.io/osintukraine/tg-archiver-api:develop && echo "public pull ok"
```
Expected: pulls successfully, `public pull ok`.

---

## Notes

- The `frontend` service `build.args` (`NEXT_PUBLIC_API_URL`, etc.) are unchanged; only an `image:` line is added above `build:`.
- Infra services (`postgres`, `db-migrate`, `redis`, `seaweedfs`, `caddy`, `prometheus`) already use upstream images and are not touched.
- No arm64 / multi-arch (contributors build locally). No signing/SBOM (out of scope).
