# Contributing to GDGoC Admin

Thank you for taking the time to contribute! This document covers everything you need to get your environment set up, understand the codebase conventions, and get a pull request merged.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Project Layout Recap](#project-layout-recap)
4. [Branch & Commit Strategy](#branch--commit-strategy)
5. [Backend (Go) Guidelines](#backend-go-guidelines)
6. [Frontend (TypeScript / React) Guidelines](#frontend-typescript--react-guidelines)
7. [Database Changes](#database-changes)
8. [Adding a New Feature — End-to-End Checklist](#adding-a-new-feature--end-to-end-checklist)
9. [Pull Request Process](#pull-request-process)
10. [Running Tests](#running-tests)
11. [Useful Commands](#useful-commands)

---

## Code of Conduct

Be respectful, constructive, and inclusive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) code of conduct.

---

## Getting Started

> Full installation instructions are in [README.md](README.md#installation--local-development). This section summarises the quickest path to a working dev environment.

### Prerequisites

| Tool | Minimum |
|---|---|
| Go | 1.22+ |
| Node.js | 20+ |
| Docker & Compose v2 | any recent |
| Air (Go live-reload) | `go install github.com/air-verse/air@latest` |

### One-time setup

```bash
# 1. Fork + clone
git clone https://github.com/<your-fork>/gdgoc-admin.git
cd gdgoc-admin

# 2. Start infrastructure
cd infrastructure/docker && docker compose up -d && cd ../..

# 3. Apply schema
psql postgres://gdgoc:gdgoc_secret@localhost:5432/gdgoc_admin \
  -f infrastructure/migrations/schema.sql

# 4. Configure API
cd apps/api && cp .env.example .env
# → edit .env (see README for required keys)

# 5. Configure frontend
cd ../admin-web && cp .env.example .env
# VITE_API_BASE_URL=http://localhost:8080/api/v1
# VITE_FRONTEND_BASE_URL=http://localhost:5173
```

### Daily development

```bash
# Terminal 1 — API with live reload
cd apps/api && air

# Terminal 2 — Frontend dev server
cd apps/admin-web && npm run dev
```

---

## Project Layout Recap

```
gdgoc-admin/
├── apps/api/          Go backend
│   └── internal/
│       ├── domain/    One sub-package per bounded context
│       └── worker/    Async rendering pipeline
└── apps/admin-web/    React Router v7 SPA
    └── app/
        ├── routes/    File-based routes (one file = one page)
        ├── components/
        └── lib/       API client + shared types
```

See the full annotated tree in [README.md](README.md#monorepo-structure).

---

## Branch & Commit Strategy

### Branches

| Pattern | Purpose |
|---|---|
| `main` | Always deployable; protected |
| `feat/<short-description>` | New feature |
| `fix/<short-description>` | Bug fix |
| `chore/<short-description>` | Tooling, dependencies, CI |
| `docs/<short-description>` | Documentation only |
| `refactor/<short-description>` | Non-functional code restructure |

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <imperative summary>

[optional body]

[optional footer: BREAKING CHANGE / closes #123]
```

**Types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `style`

**Scopes** (optional but helpful): `api`, `web`, `issuance`, `templates`, `mail`, `fonts`, `db`, `docker`

**Examples:**

```
feat(issuance): add ZIP archive download for completed batches
fix(renderer): correct Y-axis flip for rotated text layers
chore(deps): upgrade go-qrcode to v0.0.21
docs: expand CONTRIBUTING with frontend guidelines
```

Keep commits atomic — one logical change per commit. Squash "wip" commits before opening a PR.

---

## Backend (Go) Guidelines

### Domain package structure

Every bounded context lives in `internal/domain/<name>/` and follows this layout:

```
model.go        // Domain structs, enums, constants
repository.go   // DB queries (GORM + raw SQL)
service.go      // Business logic (no HTTP knowledge)
handler.go      // Fiber HTTP handlers (thin — call service, return JSON)
```

When adding a **new domain**:

1. Create the package under `internal/domain/<name>/`.
2. Wire the repository, service, and handler in `internal/server/server.go`.
3. Register routes in the appropriate router group.

### Style rules

- Run `go fmt ./...` before every commit (Air does this on rebuild, but verify locally).
- Use `go vet ./...` — fix all warnings.
- Errors from dependencies must be wrapped with `fmt.Errorf("context: %w", err)`.
- Use the `apperrors` package for HTTP-meaningful errors (`apperrors.NotFound`, `apperrors.BadRequest`, `apperrors.Forbidden`) — the middleware converts them to JSON responses automatically.
- **Never** put business logic in handlers. Handlers extract input → call service → serialize output.
- Keep `repository.go` free of business rules; it is allowed to run only DB operations.

### Naming

| Thing | Convention |
|---|---|
| Packages | lowercase, single word |
| Exported types | `PascalCase` |
| Unexported vars | `camelCase` |
| Constants | `PascalCase` for exported, `camelCase` for package-private |
| Error vars | `Err<Description>` |
| Constructors | `New<Type>(...)` |

### Adding a new API endpoint

1. Add the handler method to `handler.go` in the relevant domain.
2. Register the route in `internal/server/server.go`.
3. Apply the correct middleware:
   - `middleware.RequireAuth` — any authenticated user
   - `middleware.RequireRole("super_admin")` — super admin only
   - `middleware.RequireChapter` — chapter-scoped requests
4. Update the `packages/api-contract/` shared types if the endpoint is consumed by the frontend.

### Worker / async work

The issuance rendering pipeline lives in `internal/worker/`. If you need new async processing:

- Add a dedicated `*_worker.go` file following the `IssuanceWorker` pattern.
- Use a buffered Go channel for the queue (defined in `internal/queue/`).
- Wire it in `internal/server/server.go` and start it with `go worker.Run(ctx)`.
- **Do not** block HTTP handlers on heavy computation — always hand off to a goroutine.

---

## Frontend (TypeScript / React) Guidelines

### Route files

Each route file in `app/routes/` maps 1-to-1 to a page. The file should:

- Export a `meta()` function with a descriptive `title`.
- Export a `clientLoader` for data fetching (uses the API client from `~/lib/api/`).
- Export a default React component as the page component.
- Keep the file focused — extract complex UI into `~/components/`.

```tsx
// Example minimal route file
export function meta() {
  return [{ title: "My Page | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return await getSomething(params.id);
}

export default function MyPage() {
  const data = useLoaderData<typeof clientLoader>();
  return <div>...</div>;
}
```

### API calls

Use the typed wrappers in `app/lib/api/`. Do **not** call `axios` directly from route or component files.

- Group API functions by domain: `app/lib/api/templates.ts`, `app/lib/api/issuance.ts`, etc.
- All functions return typed promises; add new types to `app/lib/types.ts`.
- The base `apiClient` (Axios instance) in `app/lib/api/client.ts` handles the base URL and auth headers.

### Component guidelines

- **Shared / reusable** components live in `app/components/`.
- **Page-specific** components can live inline in the route file if small, or in a co-located file.
- Use Radix UI primitives (`@radix-ui/*`) for interactive UI (dialogs, selects, tooltips) — they handle accessibility automatically.
- Use `lucide-react` for icons.
- Use `react-hook-form` + `zod` for all forms — no uncontrolled inputs.

### Canvas editor (`app/components/editor/`)

The certificate editor uses `react-konva`. When touching it:

- Keep Konva stage/layer/node manipulation inside the editor components.
- The `SceneDefinition` type (from `app/lib/types.ts`) is the single source of truth; all editor state is stored as a `SceneDefinition`.
- The editor is **client-only** — it is wrapped in `<ClientOnly>` and lazy-loaded. Never import it at the top level of a route file.

### Styling

- Use **Tailwind CSS v4** utility classes.
- Design tokens (colours, spacing, radii) are defined as CSS variables in `app/app.css`. Use them via Tailwind's `text-foreground`, `bg-surface`, `border-border`, etc.
- Avoid raw hex colours or magic spacing values — always use tokens.
- Use `clsx` + `tailwind-merge` (via the `cn()` helper) for conditional class names.

### TypeScript

- Strict mode is enabled — no `any` without a comment explaining why.
- All API response shapes must be typed in `app/lib/types.ts`.
- Run `npm run typecheck` before pushing.

---

## Database Changes

All schema changes live in **`infrastructure/migrations/schema.sql`**.

### Rules

1. **Always use `IF NOT EXISTS`** guards for `CREATE TABLE` and `ALTER TABLE ADD COLUMN IF NOT EXISTS`. The schema file is designed to be re-applied safely at any time.
2. **Never drop columns or tables** in the schema file. Destructive changes require a separate, coordinated migration.
3. **Add a comment** above any non-obvious DDL explaining the business reason.
4. After changing the schema, update the corresponding Go model (`model.go`) and GORM repository (`repository.go`).
5. Update `README.md` → [Database Schema](README.md#database-schema) section with the new table/column details.

### Naming conventions

| Object | Convention |
|---|---|
| Tables | `snake_case`, plural |
| Columns | `snake_case` |
| Indexes | `idx_<table>_<columns>` |
| Constraints | `fk_<description>`, `uq_<description>` |
| Primary keys | `id UUID DEFAULT gen_random_uuid()` |
| Timestamps | `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `deleted_at TIMESTAMPTZ` (soft-delete) |

---

## Adding a New Feature — End-to-End Checklist

Use this checklist when building a new end-to-end feature (e.g. a new entity type):

### Backend

- [ ] Create `internal/domain/<name>/model.go` with domain structs and enums
- [ ] Create `internal/domain/<name>/repository.go` with DB queries
- [ ] Create `internal/domain/<name>/service.go` with business logic
- [ ] Create `internal/domain/<name>/handler.go` with Fiber HTTP handlers
- [ ] Add the domain's schema additions to `infrastructure/migrations/schema.sql`
- [ ] Register routes in `internal/server/server.go`
- [ ] Apply appropriate auth middleware
- [ ] Run `go build ./...` — zero errors
- [ ] Run `go vet ./...` — zero warnings

### Frontend

- [ ] Add API wrapper functions to `app/lib/api/<name>.ts`
- [ ] Add TypeScript types to `app/lib/types.ts`
- [ ] Add routes to `app/routes.ts`
- [ ] Create route files under `app/routes/<name>/`
- [ ] Run `npm run typecheck` — zero errors
- [ ] Manually verify the feature in the browser

### Documentation

- [ ] Update `README.md` if the feature introduces a new concept, table, or env var
- [ ] Add a `// ...` comment to any non-obvious business logic in Go code

---

## Pull Request Process

1. **Open an issue first** for anything beyond a small bug fix — describe the problem and your proposed solution.
2. **Fork** the repository and work on a branch (`feat/my-feature`).
3. **Keep PRs focused** — one feature or fix per PR. Large changes are harder to review and more likely to be reverted.
4. **Fill out the PR template** — describe *what* changed and *why*, not just *how*.
5. **Self-review** your diff before requesting review — check for leftover debug logs, commented-out code, and TODO comments.
6. **All checks must pass:**
   - `go build ./...` (no compile errors)
   - `go vet ./...` (no vet warnings)
   - `npm run typecheck` (no TypeScript errors)
   - `npm run lint` (no ESLint errors)
7. **Request review** from a maintainer. Address all comments before merging.
8. PRs are merged with **Squash and Merge** — the PR title becomes the commit message, so make it a valid Conventional Commit string.

---

## Running Tests

### Backend

```bash
cd apps/api

# Run all tests
go test ./...

# Run tests in a specific package
go test ./internal/server/...

# Run with verbose output
go test -v ./...

# Run with race detector
go test -race ./...
```

The security/middleware tests live in `internal/server/security_test.go`.

### Frontend

```bash
cd apps/admin-web

# Type checking
npm run typecheck

# Linting
npm run lint
```

> Unit/integration tests for the frontend are not yet set up. Contributions adding a test suite (e.g. Vitest) are very welcome!

---

## Useful Commands

### API

```bash
# Live reload (recommended)
cd apps/api && air

# Direct run
go run ./cmd/api

# Format
go fmt ./...

# Vet
go vet ./...

# Build production binary
go build -tags netgo -ldflags '-s -w' -o server ./cmd/api
```

### Frontend

```bash
cd apps/admin-web

npm run dev          # Dev server (http://localhost:5173)
npm run build        # Production bundle
npm run typecheck    # TypeScript type-check
npm run lint         # ESLint
```

### Infrastructure

```bash
cd infrastructure/docker

docker compose up -d          # Start all services
docker compose down           # Stop all services
docker compose down -v        # Stop and wipe volumes

# View logs
docker compose logs -f postgres
docker compose logs -f minio
```

### Schema

```bash
# Re-apply schema (idempotent)
psql postgres://gdgoc:gdgoc_secret@localhost:5432/gdgoc_admin \
  -f infrastructure/migrations/schema.sql
```

### Docker build & push (maintainers)

```powershell
# Tag + push API image to ECR (maintainers only)
.\push.ps1
```

---

## Questions?

Open a [GitHub Discussion](../../discussions) or reach out in the GDGoC community channels. We're happy to help you get started.

---

## License

By contributing to this project you agree that your contributions will be licensed under the **PolyForm Noncommercial License 1.0.0** — the same license that covers the project. See [LICENSE](LICENSE) for the full terms.
