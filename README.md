# GDGoC Admin Panel

Admin panel for Google Developer Groups on Campus chapters.

## Monorepo Structure

```
/apps
  /api            Go + Fiber backend
  /admin-web      React Router v7 + TypeScript frontend
/infrastructure
  /migrations     Postgres SQL migrations
  /docker         Docker Compose and service configs
```

## Quick Start

### Prerequisites
- Go 1.22+
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 16
- Redis 7

### Development

```bash
# Start infrastructure (Postgres, Redis, MinIO)
cd infrastructure/docker && docker compose up -d

# Backend
cd apps/api && cp .env.example .env && go run ./cmd/api

# Frontend
cd apps/admin-web && cp .env.example .env && npm install && npm run dev
```

## Architecture

See `docs/architecture.md` for the full system design.

## Auth

Authentication and authorization is handled by [Kayan](https://github.com/getkayan/kayan).
Google OAuth is the identity provider. Users must be whitelisted to register.

## Key Features

- Google OAuth login with whitelist-controlled registration
- Role-based access: Super Admin and Chapter Leader
- Chapter management (Super Admin)
- Certificate template editor (Canva-like, layered)
- Public/private template sharing and cloning
- Bulk certificate issuance with PDF + PNG generation
- Certificate verification (public endpoint)
- Email sending
