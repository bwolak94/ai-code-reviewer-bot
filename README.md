# AI Code Reviewer Bot

> A GitHub App that reviews every Pull Request for **architectural issues** — layer violations, dependency cycles, boundary leaks, and misplaced responsibilities. Built with a hybrid engine: deterministic dependency-graph analysis + LLM semantic review.

[![CI](https://github.com/your-org/ai-code-reviewer-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/ai-code-reviewer-bot/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22_LTS-green)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Create the GitHub App](#1-create-the-github-app)
  - [2. Configure Environment](#2-configure-environment)
  - [3. Start Infrastructure](#3-start-infrastructure)
  - [4. Run Database Migrations](#4-run-database-migrations)
  - [5. Build and Start Services](#5-build-and-start-services)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Development](#development)
- [Testing](#testing)
- [Security](#security)

---

## Features

| Feature | Description |
|---|---|
| **Deterministic graph analysis** | Builds a TypeScript module dependency graph using ts-morph. Zero hallucinations — if it can be computed, it is computed. |
| **Layer dependency rules** | Enforces allowed import directions between architectural layers (domain, application, infrastructure, interface). |
| **Cycle detection** | Detects module-level circular dependencies using Tarjan's SCC algorithm. |
| **Public API enforcement** | Ensures cross-module imports only go through a module's `index.ts`. |
| **Forbidden import rules** | Blocks specific imports (e.g. `domain/**` must not import `@nestjs/*`). |
| **LLM semantic review** | Claude reviews diff chunks for business logic in controllers, leaky abstractions, SRP violations — things a graph cannot see. |
| **Delta-only findings** | Only new violations introduced by a PR are reported. Existing architectural debt never floods a review. |
| **Inline PR comments** | High-severity findings appear as inline review comments on the exact changed lines. |
| **Check run annotations** | All findings appear as GitHub Checks annotations with pass/fail conclusion. |
| **Dedup across pushes** | Findings are fingerprinted (SHA-256). Force-pushing doesn't re-post the same comment. |
| **Re-run support** | Clicking "Re-run" on a check triggers a fresh review with the same SHA. |
| **`@ai-reviewer ignore`** | Comment `@ai-reviewer ignore` on any finding to suppress it in all future runs. |
| **Per-tenant token budgets** | Monthly LLM token limits enforced per GitHub installation with atomic Redis Lua scripts. |
| **Rate limiting** | Per-installation rate limiting on the webhook endpoint (120 req / 60 s). |
| **Multi-tenant** | Full PostgreSQL row-level security; each installation's data is isolated. |

---

## How It Works

### End-to-End Flow

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer
    participant GH as GitHub
    participant API as API Service
    participant Q as BullMQ (Redis)
    participant W as Worker
    participant LLM as Claude (Anthropic)

    Dev->>GH: Open / push to Pull Request
    GH->>API: pull_request webhook (HMAC verified)
    API->>API: Verify signature, dedup delivery ID
    API->>Q: Enqueue review job
    API-->>GH: 202 Accepted (< 1s)
    Q->>W: Process job
    W->>W: Cancel stale jobs for same PR
    W->>GH: Create check_run (in_progress)
    W->>GH: Load .github/ai-review.yml from base branch
    W->>W: Shallow clone base + head commits
    W->>W: arch-graph(base) [Redis cached] vs arch-graph(head)
    W->>W: Graph delta — new rule violations only
    W->>LLM: Diff chunks + violations + architecture context
    LLM-->>W: Structured findings (JSON, zod-validated)
    W->>W: Map findings to diff lines, dedup by fingerprint
    W->>GH: Update check_run (annotations + conclusion)
    W->>GH: Post inline review comments (high severity)
    W->>W: Persist run, findings, token usage to PostgreSQL
```

### Worker Pipeline

```mermaid
flowchart TD
    A([Job received]) --> B{head_sha still current?}
    B -- no --> Z([Drop — superseded])
    B -- yes --> C[Load config from base branch]
    C --> D[Shallow clone base + head]
    D --> E[Filter diff files\nignore: generated, lockfiles, tests]
    E --> F{Diff size?}
    F -- above ceiling --> G[Summary-only mode]
    F -- normal --> H[Build base arch-graph\nfrom Redis cache or ts-morph]
    H --> I[Build head arch-graph]
    I --> J[Evaluate rules\nLayer · Cycles · Public API · Forbidden]
    J --> K[Graph delta\nhead violations − base violations]
    G --> L
    K --> L[LLM review\nTwo-stage: haiku triage → sonnet review]
    L --> M[Merge deterministic + LLM findings]
    M --> N[Dedup vs previous runs\nfingerprint SHA-256]
    N --> O[Publish to GitHub\nCheck annotations + Inline comments]
    O --> P[Persist to PostgreSQL\nrun · findings · token usage]
```

### Review Run Lifecycle

```mermaid
stateDiagram-v2
    [*] --> queued : PR opened / pushed
    queued --> running : Worker picks up job
    queued --> superseded : Newer head_sha enqueued
    running --> completed : Review published
    running --> failed : Unrecoverable error
    running --> superseded : Newer head_sha enqueued
    running --> budget_exceeded : Monthly token limit reached
    completed --> queued : check_run.rerequested
    failed --> queued : check_run.rerequested
    completed --> [*]
    superseded --> [*]
    budget_exceeded --> [*]
    failed --> [*]
```

---

## Architecture

### System Context

```mermaid
flowchart LR
    Dev[Developer] -->|opens PR| GH[(GitHub)]
    GH -->|POST /webhooks/github| API[API Service\nNestJS + Fastify\n:3000]
    API -->|enqueue job| RQ[(Redis Queue\nBullMQ\n:6379)]
    API <--> DB[(PostgreSQL 16\n:5432)]
    RQ --> W[Worker Service\nNestJS standalone\n:3001]
    W <--> DB
    W <-->|Octokit| GH
    W -->|git clone| FS[/Ephemeral workspace/]
    W --> LLM[Anthropic Claude\nHaiku triage\nSonnet review]
    W <--> RC[(Redis Cache\nTokens + Graphs\n:6380)]
    API <--> RC
    W -->|Checks + Comments| GH
    GH -->|annotations + comments| Dev
```

### Monorepo Package Graph

```mermaid
flowchart TD
    API[apps/api] --> DB[packages/db]
    API --> GH_PKG[packages/github]
    WORKER[apps/worker] --> DB
    WORKER --> GH_PKG
    WORKER --> ARCH[packages/arch-graph]
    WORKER --> LLM_PKG[packages/llm-review]
    WORKER --> CFG[packages/config]
    LLM_PKG --> DB
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 22 LTS, TypeScript 5.x |
| **Package manager** | pnpm workspaces + Turborepo |
| **API framework** | NestJS 10 on Fastify |
| **Worker framework** | NestJS standalone + BullMQ |
| **Queue** | Redis 7 + BullMQ |
| **Cache** | Redis 7 (token cache, base-graph cache) |
| **Database** | PostgreSQL 16 + Drizzle ORM |
| **Connection pooling** | PgBouncer (transaction mode) |
| **AST analysis** | ts-morph (TypeScript compiler API) |
| **LLM — triage** | Claude Haiku 4.5 (fast scoring) |
| **LLM — review** | Claude Sonnet 4.6 (deep architectural review) |
| **Local LLM** | Ollama (`LLM_BACKEND=ollama` for dev/offline) |
| **GitHub API** | Octokit REST |
| **Logging** | Pino (structured JSON, redacted tokens) |
| **Metrics** | Prometheus (`prom-client`) |
| **Tracing** | OpenTelemetry SDK (OTLP exporter) |
| **Rate limiting** | `@nestjs/throttler` + Redis-backed storage |
| **Validation** | Zod |
| **Testing** | Vitest + nock |
| **Containers** | Docker + Docker Compose |
| **CI** | GitHub Actions |

---

## Getting Started

### Prerequisites

- **Node.js** 22 LTS
- **pnpm** 9+
- **Docker** and **Docker Compose**
- A **GitHub account** to register the App
- An **Anthropic API key** (or use Ollama locally — see [Development](#development))

---

### 1. Create the GitHub App

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** and configure:

| Field | Value |
|---|---|
| Homepage URL | Your deployment URL (or `http://localhost:3000` for local dev) |
| Webhook URL | `https://<your-domain>/webhooks/github` |
| Webhook secret | Any strong random string — save it for `GITHUB_WEBHOOK_SECRET` |
| **Permissions** | `Pull requests: Write`, `Checks: Write`, `Contents: Read`, `Metadata: Read` |
| **Subscribe to events** | `Pull request`, `Check run`, `Installation`, `Installation repositories`, `Pull request review comment`, `Issue comment` |

After creation, download the **private key** (`.pem` file) and note the **App ID**.

> **Tip for local dev:** Use [ngrok](https://ngrok.com) to expose your local API:
> ```bash
> ngrok http 3000
> # Set Webhook URL to: https://<id>.ngrok.io/webhooks/github
> ```

> **Tip for automated registration:** The `app-manifest.yml` in the root follows the [GitHub App manifest format](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) for one-click app creation.

---

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in the required secrets:

```env
# GitHub App credentials
GITHUB_APP_ID=123456
GITHUB_WEBHOOK_SECRET=your-random-webhook-secret

# Paste the .pem content with literal \n between lines
GITHUB_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----

# From console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...

# AES-256-GCM key for encrypting installation tokens at rest
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TOKEN_ENCRYPTION_KEY=<64 lowercase hex characters>
```

All other values in `.env.example` have safe defaults for local development.

---

### 3. Start Infrastructure

```bash
docker compose up -d
```

| Service | Port | Purpose |
|---|---|---|
| PostgreSQL 16 | 5432 | Primary database |
| PgBouncer | 5433 | Connection pool (transaction mode) |
| Redis queue | 6379 | BullMQ job queue (`noeviction`) |
| Redis cache | 6380 | Token + graph cache (`allkeys-lru`, 256 MB) |

Verify all containers are healthy:
```bash
docker compose ps
```

---

### 4. Run Database Migrations

```bash
pnpm --filter @repo/db db:migrate
```

---

### 5. Build and Start Services

```bash
pnpm install
pnpm build

# In separate terminals:
pnpm --filter @repo/api start    # API on :3000
pnpm --filter @repo/worker start # Worker on :3001
```

Or run both with watch mode for development:
```bash
pnpm dev
```

**Verify the services are running:**
```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"..."}

curl http://localhost:3001/health
# → {"status":"ok","timestamp":"..."}
```

Now install the GitHub App on a repository and open a Pull Request — the full review pipeline runs end-to-end.

---

## Configuration

Add `.github/ai-review.yml` to any repository where the app is installed:

```yaml
version: 1
language: typescript
tsconfig: tsconfig.json

# Define your architectural layers with glob patterns
layers:
  domain:         ["src/**/domain/**"]
  application:    ["src/**/application/**"]
  infrastructure: ["src/**/infrastructure/**", "src/**/repositories/**"]
  interface:      ["src/**/controllers/**", "src/**/resolvers/**"]

rules:
  # Enforce one-way flow: interface → application → domain
  layer-dependency:
    allow:
      interface:      [application]
      application:    [domain]
      infrastructure: [domain]
    severity: high

  # Detect circular module dependencies (Tarjan SCC)
  no-cycles:
    scope: module   # file | module
    severity: high

  # Cross-module imports must go through index.ts
  public-api-only:
    modules: ["src/auth", "src/billing", "src/notifications"]
    severity: medium

  # Block specific imports by glob
  forbidden-import:
    - from: "src/**/domain/**"
      deny: ["@nestjs/*", "typeorm", "prisma", "axios"]
      severity: high

llm:
  enabled: true
  context: docs/architecture.md   # optional: read from base branch, passed to LLM
  focus: ["layering", "responsibility", "abstraction-leak"]

review:
  min_severity_inline: high   # only high findings get inline PR comments
  max_inline_comments: 10     # per-review cap to reduce noise
  ignore:
    - "**/*.spec.ts"
    - "**/generated/**"
    - "migrations/**"
```

### Suppressing a Finding

Reply to any AI review comment with:
```
@ai-reviewer ignore
```

The finding is suppressed in all future runs for this repository. Every AI comment embeds a hidden fingerprint marker (`<!-- aireview:fp=<sha256> -->`) that links the comment to the finding.

---

## Project Structure

```
ai-code-reviewer-bot/
├── apps/
│   ├── api/                        # Webhook ingress (NestJS + Fastify, :3000)
│   │   └── src/
│   │       ├── webhook/            # HMAC guard, dedup, throttler, event routing
│   │       │   └── handlers/       # check_run.rerequested, @ai-reviewer commands
│   │       ├── installation/       # GitHub App installation lifecycle
│   │       ├── queue/              # BullMQ job enqueue
│   │       ├── metrics/            # Prometheus /metrics
│   │       ├── health/             # GET /health
│   │       └── telemetry/          # OpenTelemetry SDK init
│   └── worker/                     # Review job processor (NestJS standalone, :3001)
│       └── src/
│           ├── review-job/         # Main pipeline processor + supersede logic
│           ├── clone/              # git clone + ephemeral workspace management
│           ├── diff/               # Diff file filtering (globs, size ceiling)
│           ├── arch/               # Base graph Redis cache
│           ├── llm-review/         # LlmReviewService: diff → inline/summary findings
│           ├── dedup/              # Fingerprint-based finding deduplication
│           ├── github/             # Installation token service (AES-256-GCM cache)
│           ├── sandbox/            # Workspace limits (disk quota, timeout)
│           ├── retention/          # Scheduled cleanup of old runs and workspaces
│           └── metrics/            # Prometheus /metrics
├── packages/
│   ├── arch-graph/                 # TypeScript dependency graph (ts-morph, pure, no I/O)
│   │   └── src/rules/              # layer-dependency, no-cycles, public-api-only, forbidden-import
│   ├── llm-review/                 # LLM provider abstraction + two-stage router
│   │   └── src/
│   │       ├── provider/           # Anthropic (Claude) + Ollama providers
│   │       ├── routing/            # Two-stage router (haiku triage → sonnet review)
│   │       └── budget/             # Token budget service (Redis Lua atomic reserve)
│   ├── github/                     # Octokit wrappers: auth, Checks API, diff parsing
│   ├── config/                     # .github/ai-review.yml schema (Zod) + loader
│   └── db/                         # Drizzle ORM schema, migrations, repositories
├── eval/                           # Precision/recall eval harness
│   ├── fixtures/                   # Fixture repos: clean-pr, layer-violation, cycle
│   ├── expected-findings.ts        # Ground truth per fixture
│   └── run-eval.ts                 # Outputs precision/recall table; CI gate
├── docs/                           # Architecture and security documentation
├── docker-compose.yml
├── app-manifest.yml                # GitHub App manifest for one-click registration
└── .github/workflows/
    ├── ci.yml                      # Lint → typecheck → test → eval → docker build
    └── deploy.yml                  # Deploy to Fly.io on push to main
```

---

## Development

### Use a Local LLM (no Anthropic key needed)

```bash
# 1. Install Ollama: https://ollama.com
# 2. Pull a model:
ollama pull llama3.2

# 3. Set in .env:
LLM_BACKEND=ollama
OLLAMA_BASE_URL=http://localhost:11434
```

### Generate DB Migrations

After modifying `packages/db/src/schema.ts`:
```bash
pnpm --filter @repo/db db:generate
pnpm --filter @repo/db db:migrate
```

### Run the Eval Harness

```bash
pnpm build
pnpm --filter @repo/eval eval
```

Outputs a precision/recall table per fixture. The CI gate requires 100% precision and recall on deterministic rules.

### Enable OpenTelemetry

Set `OTEL_EXPORTER_OTLP_ENDPOINT` in `.env` to point to your collector (e.g. Jaeger, Grafana Tempo). When unset, OTel is a no-op and has zero overhead.

---

## Testing

```bash
# All tests
pnpm test

# Single package
pnpm --filter @repo/api test
pnpm --filter @repo/worker test
pnpm --filter @repo/arch-graph test

# With coverage
pnpm --filter @repo/worker test:coverage
```

| Package | Tests | Coverage areas |
|---|---|---|
| `apps/api` | 57 | HMAC guard, dedup, throttler, e2e webhook controller, handlers |
| `apps/worker` | 81 | Review pipeline, clone, diff filter, graph cache, LLM review, dedup, retention, token service |
| `packages/arch-graph` | — | Graph building, rule evaluation, cycle detection, fingerprinting |
| `packages/github` | — | Diff parsing, annotation publishing |
| `packages/config` | — | Schema validation, path traversal protection |

---

## Security

| ID | Finding | Mitigation | Status |
|---|---|---|---|
| SEC-001 | No rate limiting on webhook endpoint | Per-installation Redis throttler (120 req / 60 s) | ✅ |
| SEC-002 | Redis unauthenticated in default config | `requirepass` enforced on both Redis instances in docker-compose | ✅ |
| SEC-003 | Installation tokens stored plaintext in Redis | AES-256-GCM encryption at rest; key from `TOKEN_ENCRYPTION_KEY` env var | ✅ |
| SEC-005 | SSRF via crafted repository URLs in git clone | Clone URL validated — only `github.com` host accepted | ✅ |
| SEC-006 | Path traversal via `llm.context` config field | Path normalised and sandboxed to workspace root at config load time | ✅ |
| SEC-008 | Tokens leaking into log output | Pino `redact` strips `token`, `authorization`, `*.accessToken` from all logs | ✅ |
| SEC-013 | No audit trail for webhook events | Every accepted event written to structured Pino log with delivery ID | ✅ |

> Full threat model, risk register, and remaining findings in [`docs/security-audit.md`](docs/security-audit.md).

---

## License

MIT
