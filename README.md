# GDGoC Admin Panel

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)

> Admin panel for Google Developer Groups on Campus (GDGoC) chapters — covering certificate template design, bulk certificate issuance, email sending, and chapter management.

---

## Table of Contents

1. [Monorepo Structure](#monorepo-structure)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Data Flow](#data-flow)
5. [Libraries & Frameworks](#libraries--frameworks)
6. [Database Schema](#database-schema)
7. [Key Concepts](#key-concepts)
8. [Installation & Local Development](#installation--local-development)
9. [Running with Docker](#running-with-docker)

---

## Monorepo Structure

```
gdgoc-admin/
├── apps/
│   ├── api/                   Go + Fiber REST API
│   │   ├── cmd/api/           Main entrypoint
│   │   ├── internal/
│   │   │   ├── config/        Env-driven configuration
│   │   │   ├── database/      GORM + Postgres connection
│   │   │   ├── domain/        Domain-driven packages
│   │   │   │   ├── auth/      Session & OIDC integration (Kayan)
│   │   │   │   ├── chapters/  Chapter CRUD + SMTP config
│   │   │   │   ├── dynamicimages/ Renderable images with URL-param overrides
│   │   │   │   ├── fonts/     Font library (upload / serve)
│   │   │   │   ├── issuance/  Batch certificate issuance
│   │   │   │   ├── mail/      Email templates + SMTP sending
│   │   │   │   ├── templates/ Certificate template editor contract
│   │   │   │   ├── users/     User management + whitelist
│   │   │   │   └── verification/ Public certificate verification
│   │   │   ├── middleware/    Auth & RBAC middleware
│   │   │   ├── queue/         In-process batch queue
│   │   │   ├── server/        Fiber router wiring
│   │   │   ├── storage/       Object-storage abstraction (MinIO / S3 / Cloudinary / local)
│   │   │   └── worker/        Image renderer + issuance worker + mail worker
│   │   ├── migrations/        Standalone SQL migration scripts
│   │   └── data/fonts/        Locally-cached font TTF files
│   │
│   └── admin-web/             React Router v7 SPA (client-rendered)
│       └── app/
│           ├── components/    Shared UI components
│           │   └── editor/    Certificate canvas editor (Konva)
│           ├── layouts/       Root layout wrappers
│           ├── lib/           API client, hooks, types
│           └── routes/        File-based routing
│               ├── templates/ Template list / detail / editor
│               ├── batches/   Issuance batch management
│               ├── cert-metadata/ Certificate programme management
│               ├── dynamic-images/ Dynamic image builder
│               ├── mail/      Email template editor
│               ├── fonts/     Font library management
│               ├── chapters/  Chapter management
│               ├── users/     User & whitelist management
│               └── verify.tsx Public certificate verification page
│
├── infrastructure/
│   ├── docker/
│   │   └── docker-compose.yml  Dev-stack: Postgres, Redis, MinIO, Mailpit
│   └── migrations/
│       └── schema.sql          Idempotent, full DB schema
│
└── packages/
    └── api-contract/           Shared TypeScript types (future)
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| **Backend language** | Go | 1.25 |
| **HTTP framework** | Fiber v2 | v2.52 |
| **ORM** | GORM | v1.31 |
| **Database** | PostgreSQL | 16 |
| **Cache / queue** | Redis | 7 |
| **Auth** | Kayan (OIDC + Google OAuth) | v0.1 |
| **Image rendering** | tdewolff/canvas (2D rasteriser) | latest |
| **PDF generation** | gofpdf / fpdf | — |
| **QR code** | skip2/go-qrcode | — |
| **Font fetching** | Google Fonts CSS API (fallback) | — |
| **Frontend framework** | React Router v7 | v7 |
| **UI runtime** | React 19 | v19 |
| **Canvas editor** | Konva / react-konva | v9 |
| **Rich-text editor** | Tiptap v3 | v3.23 |
| **State / fetching** | TanStack Query v5 | v5 |
| **Styling** | Tailwind CSS v4 | v4 |
| **Forms** | React Hook Form + Zod | — |
| **HTTP client** | Axios | v1.7 |
| **Spreadsheet import** | xlsx (SheetJS) | v0.18 |
| **Build tool** | Vite | v5 |

---

## Architecture
```mermaid

---
config:
  layout: dagre
  theme: base
  look: classic
---
flowchart TB
 subgraph Domains["Domains"]
    direction LR
        auth["auth"]
        templates["templates"]
        issuance["issuance"]
        mail["mail"]
  end
 subgraph Services["Services"]
    direction LR
        dynimg["dynamic images\ncustom fonts"]
        verif["verification\nchapters"]
  end
 subgraph API["Go / Fiber API  :8080"]
    direction TB
        Domains
        Services
        worker["IssuanceWorker\n(goroutine pool)"]
        renderer["worker.ImageRenderer\ntdewolff/canvas\ntext · image · shape · QR · gradients"]
  end
 subgraph Storage["Storage"]
    direction LR
        pg[("PostgreSQL 16\nGORM / raw SQL")]
        redis[("Redis 7\nsession store")]
  end
    Domains --> renderer & Services
    worker --> renderer
    Browser["Browser SPA\nReact Router v7 · Konva · Tiptap · TanStack Q"] -- REST JSON (axios) --> API
    issuance --> worker
    auth -. delegates to .-> Kayan["🔐 Kayan\n(auth/authz server)"]
    API --> pg & redis
```

### Domain boundaries

Each domain package (`internal/domain/<name>`) follows a layered pattern:

```
handler.go   ← HTTP handlers (Fiber)
service.go   ← Business logic
repository.go← DB queries (GORM / raw SQL)
model.go     ← Domain structs & enums
```

The `worker` package contains the asynchronous image-rendering pipeline and is kept separate from all domain packages to avoid import cycles. Issuance logic hands off a batch ID to an in-process Go channel; the worker drains it concurrently.

---

## Data Flow
Looking at the five data flows described in the document, I'll render them all as a single multi-flow Mermaid diagram with clear section labels.

```mermaid
---
config:
  layout: dagre
  theme: base
  look: classic
---
flowchart TD

 subgraph F1["① Template design"]
    direction LR
        E1["Editor (Konva)\ndrag / resize layers"]
        E2["SceneDefinition JSON\nin React state"]
        E3["POST /templates/:id/assets\nupload pending images"]
        E4["POST /templates/:id/versions\nsave version"]
        E5[("template_versions\nscene JSONB")]
        E1 --> E2 --> E3 --> E4 --> E5
  end

 subgraph F2["② Certificate issuance"]
    direction LR
        I1["Admin fills\nrecipients table\n(manual or CSV)"]
        I2["JS formulas evaluated\nin browser"]
        I3["POST /issuance/batches\nrecipients + resolved vars"]
        I4[("issuance_batches\npending\nissuance_recipients\nqueued")]
        I5["Batch ID →\nGo channel"]
        I6["IssuanceWorker\ngoroutine pool"]
        I7["Mark batch\nprocessing"]
        I8["Per recipient:\nmark rendered\n± send email"]
        I9["Mark batch\ncompleted / failed"]
        I1 --> I2 --> I3 --> I4 --> I5 --> I6 --> I7 --> I8 --> I9
  end

 subgraph F3["③ Certificate rendering (on demand)"]
    direction LR
        R1["GET /certificates/:id/render\n?format=png|pdf"]
        R2["Fetch recipient +\nbatch + template version"]
        R3["Resolve vars\n+ auto-vars"]
        R4["Parse\nSceneDefinition"]
        R5["ImageRenderer\nper layer type"]
        R6["Rasterize\n+ encode"]
        R7["Cache\nsync.Map"]
        R1 --> R2 --> R3 --> R4 --> R5 --> R6 --> R7

        R5 --> L1["text\nfont lookup → draw"]
        R5 --> L2["image\nfetch storage → fitImage"]
        R5 --> L3["shape\nbezier / rect / gradient"]
        R5 --> L4["qr\ngo-qrcode → draw"]
  end

 subgraph F4["④ Dynamic image rendering"]
    direction LR
        D1["GET /dynamic-images/:id/render\n?key=value&…"]
        D2{"status =\npublished?"}
        D3["Resolve vars\nfrom URL params"]
        D4["ImageRenderer\n(same pipeline as ③)"]
        D5["Return PNG bytes"]
        D1 --> D2 -->|yes| D3 --> D4 --> D5
        D2 -->|no| D6["403 / not found"]
  end

 subgraph F5["⑤ Email sending"]
    direction LR
        M1["IssuanceWorker\nsendCertificateMail"]
        M2["Load chapter\nSMTP config"]
        M3["Load mail\ntemplate"]
        M4["Interpolate subject + body\nrecipient vars → global.* → batch overrides → system vars"]
        M5["mail.SendMail\nnet/smtp STARTTLS"]
        M1 --> M2 --> M3 --> M4 --> M5
  end
```

Each subgraph maps to one of the five data flows from the doc. A few things to note:

- **Flow ②** shows the full async handoff — the browser resolves JS formulas before submission, then the Go worker picks up the batch ID from the channel independently.
- **Flow ③** branches inside the `ImageRenderer` to show the four layer types (text, image, shape, QR) handled in parallel before rasterization.
- **Flow ④** includes the guard check — only published dynamic images are renderable.
- **Flow ⑤** makes the three-stage variable interpolation order explicit: recipient vars → `global.*` aliases → batch-level overrides → system vars.

## Libraries & Frameworks

### Backend (Go)

| Library | Why |
|---|---|
| **`gofiber/fiber/v2`** | High-performance HTTP built on fasthttp; ergonomic routing, middleware, multipart file handling |
| **`gorm.io/gorm` + `driver/postgres`** | ORM with raw-SQL escape hatch for complex queries |
| **`redis/go-redis/v9`** | Session storage; fast key-value for auth tokens |
| **`tdewolff/canvas`** | Pure-Go 2D vector/raster engine. Handles text shaping, bezier paths, gradients and rasterisation without CGo. Used to render all certificate layers into `image.Image` |
| **`skip2/go-qrcode`** | QR code generation with configurable error-correction levels and colours |
| **`coreos/go-oidc/v3` + `golang.org/x/oauth2`** | OAuth2 / OIDC flows — used by Kayan and chapter SMTP OAuth (Google, Microsoft) |
| **`getkayan/kayan/core`** | OIDC identity provider integration for user auth and whitelist-controlled registration |
| **`golang-jwt/jwt/v5`** | Session JWT signing and validation |
| **`google/uuid`** | UUID generation for all primary keys |
| **`joho/godotenv`** | `.env` file loading in development |
| **`spf13/viper`** | Hierarchical config (env vars + defaults) |
| **`golang.org/x/image`** | Image draw/scale utilities (`BiLinear` scaling for object-fit) + bundled Go fonts (fallback) |

### Frontend (TypeScript / React)

| Library | Why |
|---|---|
| **`react-router` v7** | File-based routing; `clientLoader` pattern for data fetching; full SPA mode (no SSR) |
| **`konva` / `react-konva`** | HTML5 Canvas 2D library for the certificate template editor — drag, resize, rotate, z-order layers |
| **`@tiptap/*`** | Headless rich-text editor for HTML email body composition with extensions (color, image, link, align, underline) |
| **`@tanstack/react-query`** | Server-state management, caching, background refetch |
| **`react-hook-form` + `zod`** | Form state + schema validation |
| **`@radix-ui/*`** | Accessible headless primitives (Dialog, Select, Popover, Tooltip, etc.) |
| **`axios`** | HTTP client with interceptors for auth headers |
| **`xlsx`** | Parse Excel / CSV files for bulk recipient import |
| **`qrcode`** | Client-side QR preview inside the editor |
| **`lucide-react`** | Icon set |
| **`tailwindcss` v4** | Utility-first CSS with CSS-variable design tokens |
| **`class-variance-authority` + `clsx` + `tailwind-merge`** | Composable component variant utilities |

---

## Database Schema

> Full schema: [`infrastructure/migrations/schema.sql`](infrastructure/migrations/schema.sql)

**Entity Relationship Diagram** (from the database schema section):
```mermaid
erDiagram
    chapters {
        uuid id PK
        text name
        text email
        uuid leader_id FK
        text status
        text smtp_provider
        text smtp_host
        int smtp_port
        text smtp_username
        text smtp_password
        text oauth_refresh_token
        text code
        int since_year
        text leader_codename
        text profile_picture_url
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    users {
        uuid id PK
        text kayan_id
        text email
        text name
        text role
        uuid chapter_id FK
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    sessions {
        text token PK
        uuid user_id FK
        timestamptz expires_at
        timestamptz created_at
    }

    whitelist {
        uuid id PK
        text email
        text role
        uuid chapter_id FK
        uuid added_by FK
        timestamptz created_at
        timestamptz deleted_at
    }

    kayan_identities {
        text id PK
        uuid user_id FK
        jsonb traits
        text state
        bool verified
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    kayan_credentials {
        text id PK
        text identity_id FK
        text type
        text identifier
        timestamptz created_at
        timestamptz updated_at
    }

    templates {
        uuid id PK
        text name
        text description
        uuid owner_user_id FK
        uuid owner_chapter_id FK
        text visibility
        text status
        uuid source_template_id FK
        uuid current_version_id FK
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    template_versions {
        uuid id PK
        uuid template_id FK
        int version
        jsonb scene
        timestamptz created_at
    }

    template_assets {
        uuid id PK
        uuid template_id FK
        text object_key
        text file_name
        text mime_type
        text content_hash
        timestamptz created_at
    }

    issuance_batches {
        uuid id PK
        uuid chapter_id FK
        uuid template_id FK
        uuid template_version_id FK
        uuid mail_template_id FK
        uuid cert_id FK
        uuid created_by_user_id FK
        text name
        text status
        int total_count
        int success_count
        int failed_count
        bool send_mail
        bool is_printable
        text cert_name
        jsonb mail_variables
        timestamptz created_at
        timestamptz updated_at
    }

    issuance_recipients {
        text id PK
        uuid batch_id FK
        text email
        jsonb variables
        jsonb scripts
        text status
        text pdf_object_key
        text png_object_key
        text failure_reason
        timestamptz created_at
        timestamptz updated_at
    }

    cert_metadata {
        uuid id PK
        uuid chapter_id FK
        text name
        text description
        timestamptz created_at
        timestamptz updated_at
    }

    mail_templates {
        uuid id PK
        uuid chapter_id FK
        uuid created_by FK
        text name
        text subject
        text body
        jsonb variables
        text status
        timestamptz created_at
        timestamptz updated_at
    }

    mail_template_images {
        uuid id PK
        uuid chapter_id
        text object_key
        text file_name
        text mime_type
        text content_hash
        timestamptz created_at
    }

    dynamic_images {
        uuid id PK
        uuid owner_user_id FK
        uuid owner_chapter_id FK
        text name
        text description
        jsonb scene
        text status
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    fonts {
        uuid id PK
        uuid uploaded_by FK
        text family_name
        text object_key
        text file_name
        text mime_type
        text content_hash
        timestamptz created_at
    }

    audit_logs {
        uuid id PK
        uuid actor_id FK
        uuid chapter_id FK
        text action
        text entity_type
        text entity_id
        jsonb metadata
        timestamptz created_at
    }

    %% Auth & identity
    users ||--o{ sessions : "has"
    users ||--o{ kayan_identities : "linked to"
    kayan_identities ||--o{ kayan_credentials : "has"
    users }o--|| chapters : "belongs to"
    chapters }o--o| users : "led by"
    whitelist }o--o| chapters : "scoped to"
    whitelist }o--o| users : "added by"

    %% Templates
    chapters ||--o{ templates : "owns"
    users ||--o{ templates : "created by"
    templates ||--o{ template_versions : "versioned by"
    templates }o--o| template_versions : "current version"
    templates }o--o| templates : "cloned from"
    templates ||--o{ template_assets : "has"

    %% Issuance
    chapters ||--o{ issuance_batches : "runs"
    templates ||--o{ issuance_batches : "used in"
    template_versions ||--o{ issuance_batches : "snapshot"
    users }o--o{ issuance_batches : "created by"
    issuance_batches ||--o{ issuance_recipients : "contains"
    issuance_batches }o--o| mail_templates : "uses"
    issuance_batches }o--o| cert_metadata : "grouped by"

    %% Cert metadata
    chapters ||--o{ cert_metadata : "defines"

    %% Mail
    chapters ||--o{ mail_templates : "has"
    users ||--o{ mail_templates : "created by"

    %% Dynamic images
    chapters ||--o{ dynamic_images : "owns"
    users ||--o{ dynamic_images : "created by"

    %% Fonts & audit
    users }o--o{ fonts : "uploaded by"
    users }o--o{ audit_logs : "actor"
    chapters }o--o{ audit_logs : "scoped to"
```

## Key Concepts

### Dynamic Fields

A **dynamic field** is a text layer on a certificate template (or dynamic image) whose content is not hard-coded. Instead it holds a **`variable_key`** — a named slot (e.g. `name`, `event_title`) that gets filled at issuance time.

When designing the template, the author marks a text layer as *Dynamic* and assigns a variable key. When a batch is created, each recipient row supplies `variables: { name: "Alice", event_title: "Cloud Study Jam" }`. The renderer reads `layer.TextProps.VariableKey`, looks up the value in the `vars` map, and draws that text.

### Global Dynamic Fields

In **email templates and batch-level configuration**, variables from recipients are also exposed under a `global.*` namespace alias:

```
recipient variable: name = "Alice"
also accessible as: global.name = "Alice"
```

This allows mail template authors to use `{{global.name}}` so it is unambiguous when mixing per-recipient variables with batch-level overrides.

Additionally, the system automatically injects a set of **system-level auto-variables** that are available in every certificate render and email without the admin having to supply them:

| Variable | Value |
|---|---|
| `cert.id` | Recipient's unique certificate ID |
| `cert.pdf_url` | Public API URL to render the certificate as PDF |
| `cert.verify_url` | Frontend verification page URL |
| `batch.name` | Batch name |
| `batch.cert_name` | Certification programme name |
| `batch.cert_description` | Programme description |
| `chapter.name` | Chapter name |
| `chapter.code` | Chapter short code |
| `chapter.leader` | Chapter leader's name |
| `chapter.leader_codename` | Leader codename |
| `chapter.since` | Year chapter was founded |

### Dynamic Images

A **Dynamic Image** is a reusable, independently renderable image (same `SceneDefinition` format as a certificate template) that can have its text layer values overridden via **URL query parameters** at render time:

```
GET /api/v1/dynamic-images/{id}/render?participant_name=Alice&event=Cloud+Jam
```

This is useful for generating personalised social-media share cards, LinkedIn banners, or Open Graph images on the fly — without creating full issuance batches. Only **published** dynamic images are renderable publicly.

### Email Templates

An **Email Template** is a reusable HTML email (subject + body) with named `{{variable}}` placeholders. It is created with a Tiptap rich-text editor and stored as HTML in the database.

At sending time, the worker interpolates:
1. Per-recipient variables (and `global.*` aliases)
2. System variables (`cert.id`, `cert.verify_url`, chapter data)
3. Batch-level variable overrides (which can themselves reference recipient vars via `{{global.key}}`)

Templates can be **published** to become visible to all chapters, allowing cross-chapter reuse and cloning.

### Certificate Templates

A **Certificate Template** stores the visual design as a versioned `SceneDefinition` JSON:

```json
{
  "width": 1754, "height": 1240,
  "background": "#ffffff",
  "layers": [
    { "type": "text", "text_props": { "content": "Hello {{name}}", "is_dynamic": true, "variable_key": "name" } },
    { "type": "image", "image_props": { "asset_key": "templates/abc/logo.png" } },
    { "type": "shape", "shape_props": { "kind": "path", "fill": { "type": "linear", "stops": [...] } } },
    { "type": "qr",   "qr_props":   { "content": "{{cert.verify_url}}" } }
  ]
}
```

Each save creates an immutable **`TemplateVersion`** snapshot. The `current_version_id` on the template points to the live version; issuance batches snapshot the version ID at creation so previously-issued certificates are always rendered with the exact original design.

Templates can be `private` (chapter-only) or `public` (visible and cloneable by all chapters). Cloning sets `source_template_id` for lineage tracking.

### Batches

An **Issuance Batch** is a single bulk certificate-generation job. It ties together:

- A template version (immutable snapshot)
- An ordered list of recipients (each with their variable values)
- Delivery options (`send_mail`, `is_printable`)
- An optional mail template + batch-level variable overrides

Status lifecycle: `pending → processing → completed | failed | cancelled`

The batch processor is an **in-process Go worker** running a configurable goroutine pool (`WORKER_CONCURRENCY`). Certificate rendering is **lazy / on-demand** — the worker marks recipients as `rendered` immediately; actual rasterisation happens when the certificate is first fetched via the render endpoint and the result is cached in a `sync.Map` with a singleflight-style `sync.Once` per (recipient, format) pair.

### Certificate Metadata

**CertMetadata** (certificate metadata records, also called "cert programmes") give a stable identity to a certification type (e.g. *"Google Cloud Study Jam 2026"*) that may be issued across multiple batches over time.

A metadata record holds a name and description. Batches reference it via `cert_name` so the verification page and download archive can group and label certificates correctly.

### Defined Functions (Text Interpolation)

The system uses two content resolution modes for text layers:

1. **`{{variable_key}}` interpolation** — any text in `content` matching `{{some_key}}` is replaced with the corresponding value from the `vars` map. This works in text layer `content`, QR code `content`, and email templates.

2. **Explicit variable binding** — if `is_dynamic = true` and `variable_key` is set, the entire layer content is replaced by `vars[variable_key]`. This takes priority over inline interpolation.

Additionally, **text transforms** are applied post-resolution: `uppercase`, `lowercase`, or `capitalize` (title-case).

### Inline Script / Dynamic Field Formula

When building a batch, admins can enter **JavaScript formula expressions** in any recipient variable cell (like a spreadsheet). These are evaluated **in the browser** before submission — the Go backend never executes JavaScript. The resolved string values are stored in `issuance_recipients.variables`, while the original JS source is archived in `issuance_recipients.scripts` for audit purposes.

Example formula:
```js
// In the browser, for variable "greeting":
`Hello ${vars.name}, welcome to ${vars.event}!`
```

After browser evaluation, the backend stores `{ "greeting": "Hello Alice, welcome to Cloud Study Jam!" }`.

### Font Library

The system supports three font resolution tiers (in priority order):

1. **`font_asset_key`** — an explicit TTF/OTF file uploaded by the admin and stored in the object-storage assets bucket. Loaded from storage, cached in memory (`sync.Map` keyed by asset key), and persisted to `./data/fonts/` for fast restarts.

2. **Local font directory** (`./data/fonts/`) — TTF files matching `<FamilyName>-<Weight>.ttf` naming conventions (e.g. `Roboto-Bold.ttf`). Checked first before network calls.

3. **Google Fonts (automatic download)** — if neither of the above matches, the renderer calls the Google Fonts CSS API using an Android mobile `User-Agent` (which returns direct `.ttf` URLs instead of woff2). The downloaded file is cached to `./data/fonts/` so future renders skip the network call.

If all tiers fail, the renderer falls back to the embedded Go standard fonts (`golang.org/x/image/font/gofont`).

---

## Installation & Local Development

### Prerequisites

| Tool | Minimum Version |
|---|---|
| Go | 1.22+ |
| Node.js | 20+ |
| Docker & Docker Compose | v2+ |
| PostgreSQL | 16 (or via Docker) |
| Redis | 7 (or via Docker) |

### 1 — Start infrastructure services

```bash
cd infrastructure/docker
docker compose up -d
```

This starts:
- **PostgreSQL 16** on `localhost:5432` (user: `gdgoc`, password: `gdgoc_secret`, db: `gdgoc_admin`)
- **Redis 7** on `localhost:6379`
- **MinIO** on `localhost:9000` (API) / `localhost:9001` (Console) — credentials: `gdgoc_minio` / `gdgoc_minio_secret`
- **Mailpit** on `localhost:1025` (SMTP) / `localhost:8025` (Web UI) — catches all outgoing emails in dev

### 2 — Apply the database schema

```bash
# Using psql directly
psql postgres://gdgoc:gdgoc_secret@localhost:5432/gdgoc_admin \
  -f infrastructure/migrations/schema.sql
```

The schema is idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`) and safe to re-run.

### 3 — Configure and run the API

```bash
cd apps/api

# Copy and edit environment variables
cp .env.example .env
```

Edit `.env` — at minimum you need:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `KAYAN_BASE_URL` | Your Kayan instance URL |
| `KAYAN_CLIENT_ID` / `KAYAN_CLIENT_SECRET` | OAuth2 app credentials |
| `KAYAN_REDIRECT_URL` | Must match `http://localhost:8080/auth/callback` |
| `SESSION_SECRET` | Long random string |
| `STORAGE_DRIVER` | `cloudinary` for Cloudinary (see below) or `local` |
| `SMTP_GOOGLE_CLIENT_ID` | Google OAuth2 client ID for SMTP |
| `SMTP_GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret for SMTP |
| `SMTP_OAUTH_CALLBACK_URL` | URL for OAuth callback |
| `SMTP_OAUTH_FRONTEND_URL` | URL for frontend |
| `BOOTSTRAP_SUPER_ADMIN` | Email of super admin to be created on first run |

For **Cloudinary** storage add:

```env
STORAGE_DRIVER=cloudinary
STORAGE_CLOUDINARY_CLOUD_NAME=your-cloud-name
STORAGE_ACCESS_KEY=your-access-key
STORAGE_SECRET_KEY=your-secret-key
STORAGE_BUCKET_ASSETS=gdgoc-assets
STORAGE_BUCKET_CERTS=gdgoc-certificates
```

Run the API (with live reload via Air):
```bash
# Option A — live reload
go install github.com/air-verse/air@latest
air

# Option B — direct run
go run ./cmd/api
```

The API listens on `http://localhost:8080`.

### 4 — Configure and run the frontend

```bash
cd apps/admin-web
cp .env.example .env
```

`.env` for the frontend:

```env
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_FRONTEND_BASE_URL=http://localhost:5173
```

```bash
npm install
npm run dev
```

The SPA is served at `http://localhost:5173`.

### 5 — First login

1. Ensure Kayan is running and your Google OAuth app is registered.
2. Add your email to the `whitelist` table manually (or use the Super Admin panel once bootstrapped):
   ```sql
   INSERT INTO whitelist (email) VALUES ('you@example.com');
   ```
3. Visit `http://localhost:5173` and sign in with Google.

---

## Running with Docker

### Infrastructure only (recommended for development)

```bash
cd infrastructure/docker
docker compose up -d
```

### Building the API image

```bash
cd apps/api
docker build -t gdgoc-api .
```

The Dockerfile uses a two-stage build:
- **Stage 1 (`golang:1.25-alpine`)**: compiles a statically-linked binary (`CGO_ENABLED=0`, `-tags netgo`)
- **Stage 2 (`alpine:3.21`)**: minimal runtime with `ca-certificates` and `tzdata`

### Running the API container

```bash
docker run -d \
  --name gdgoc-api \
  --network host \
  -e DATABASE_URL="postgres://gdgoc:gdgoc_secret@localhost:5432/gdgoc_admin?sslmode=disable" \
  -e REDIS_URL="redis://localhost:6379" \
  -e KAYAN_BASE_URL="https://your-kayan-instance.example.com" \
  -e KAYAN_CLIENT_ID="your-client-id" \
  -e KAYAN_CLIENT_SECRET="your-client-secret" \
  -e KAYAN_REDIRECT_URL="http://localhost:8080/auth/callback" \
  -e SESSION_SECRET="change-this-to-a-long-random-string" \
  -e STORAGE_DRIVER="s3" \
  -e STORAGE_ENDPOINT="localhost:9000" \
  -e STORAGE_ACCESS_KEY="gdgoc_minio" \
  -e STORAGE_SECRET_KEY="gdgoc_minio_secret" \
  -e STORAGE_BUCKET_ASSETS="gdgoc-assets" \
  -e STORAGE_BUCKET_CERTS="gdgoc-certificates" \
  -e STORAGE_USE_SSL="false" \
  -e CORS_ALLOWED_ORIGINS="http://localhost:5173" \
  -p 8080:8080 \
  gdgoc-api
```

### Full production docker-compose example

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: gdgoc
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: gdgoc_admin
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infrastructure/migrations/schema.sql:/docker-entrypoint-initdb.d/schema.sql

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - minio_data:/data
    ports:
      - "9000:9000"
      - "9001:9001"

  api:
    build: ./apps/api
    depends_on: [postgres, redis, minio]
    environment:
      DATABASE_URL: postgres://gdgoc:${POSTGRES_PASSWORD}@postgres:5432/gdgoc_admin?sslmode=disable
      REDIS_URL: redis://redis:6379
      STORAGE_DRIVER: s3
      STORAGE_ENDPOINT: minio:9000
      STORAGE_ACCESS_KEY: ${MINIO_ACCESS_KEY}
      STORAGE_SECRET_KEY: ${MINIO_SECRET_KEY}
      STORAGE_BUCKET_ASSETS: gdgoc-assets
      STORAGE_BUCKET_CERTS: gdgoc-certificates
      STORAGE_USE_SSL: "false"
      KAYAN_BASE_URL: ${KAYAN_BASE_URL}
      KAYAN_CLIENT_ID: ${KAYAN_CLIENT_ID}
      KAYAN_CLIENT_SECRET: ${KAYAN_CLIENT_SECRET}
      KAYAN_REDIRECT_URL: ${KAYAN_REDIRECT_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      CORS_ALLOWED_ORIGINS: ${FRONTEND_URL}
    ports:
      - "8080:8080"

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

Store secrets in a `.env` file at the project root and reference with `${VAR}`.

---

## Auth

Authentication is handled by [Kayan](https://github.com/getkayan/kayan), an OIDC/OAuth2 identity platform. Google OAuth is the upstream identity provider. Users must be **whitelisted** (email present in the `whitelist` table) to complete registration.

Roles:
- **`super_admin`** — full access across all chapters
- **`chapter_leader`** — scoped to their assigned chapter

---

## Key Features

- Google OAuth login with whitelist-controlled registration
- Role-based access: Super Admin and Chapter Leader
- Chapter management with per-chapter SMTP (manual / Google OAuth / Microsoft OAuth)
- Certificate template editor (Canva-like: text, image, shape/vector, QR layers)
- Public/private template sharing and cloning
- Versioned templates (immutable snapshots)
- Bulk certificate issuance with PDF + PNG generation (on-demand rendering with caching)
- Printable CMYK-safe colour mode
- Certificate verification public page with Open Graph meta
- Bulk CSV/Excel recipient import with in-browser JS formula evaluation
- Email templates with rich-text editor and variable interpolation
- Dynamic images (URL-parameter-driven personalised image rendering)
- Font library (upload custom TTF/OTF; auto-fallback to Google Fonts)
- Audit log

---

## License

This project is licensed under the **PolyForm Noncommercial License 1.0.0**.

You may use, modify, and distribute this software **for non-commercial purposes only**. Commercial use of any kind — including but not limited to selling the software, using it to deliver paid services, or incorporating it into a commercial product — requires a separate commercial license from the copyright holders.

See the full license text in [LICENSE](LICENSE).

> **What "noncommercial" means in practice:**
> - ✅ Running this for your GDGoC chapter (free, community-driven)
> - ✅ Academic research or personal learning projects
> - ✅ Contributions back to this repository
> - ❌ Selling this software or a service built on it
> - ❌ Using it inside a for-profit product without permission
