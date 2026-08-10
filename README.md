# Orders & Settlements

Take-home assignment for the CrossVal Full Stack Developer role.

Create orders with line items, record full or partial payments against them, and track derived status and amounts due on a dashboard.

- **Live URL:** `<DEPLOYED_URL>` (see [Deployment](#deployment))
- **Demo account:** `demo@example.com` / `demo-password-123` (seeded with orders in every status, in USD and AED, including a refund)

## Stack

- **Next.js (App Router) + TypeScript**: one codebase for the REST API (route handlers) and the UI
- **MongoDB** with the official driver: explicit schema types and index design in code (`src/lib/db.ts`)
- **Zod** for input validation, **next-intl** for i18n (en-US default, es-ES included)
- **Vitest** (unit + API integration against a real in-memory Mongo replica set) and **Playwright** (browser journeys)

## Getting started

Prerequisites: Node.js 22+ and pnpm 10+. No MongoDB needed for the zero-setup path:

```bash
pnpm install
pnpm dev:mem                 # http://localhost:3000 (disposable in-memory Mongo)
pnpm seed                    # optional: demo account + sample orders
```

To run against a persistent database instead, `cp .env.example .env.local`, set `MONGODB_URI`, and use `pnpm dev`. Note: payments and refunds use multi-document transactions, which MongoDB only supports on **replica sets**. Atlas (any tier) works out of the box; a plain standalone local `mongod` does not, which is exactly why `pnpm dev:mem` exists (it boots a single-node replica set in memory).

Scripts:

| Command | What it does |
| --- | --- |
| `pnpm dev:mem` | Dev server on :3000 with a disposable in-memory Mongo replica set (zero setup) |
| `pnpm dev` | Dev server on :3000 (needs `MONGODB_URI` pointing at a replica set, e.g. Atlas) |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm test` | All Vitest suites (unit + integration) |
| `pnpm test:unit` | Domain unit tests (money, status derivation) |
| `pnpm test:integration` | API tests against an in-memory Mongo replica set (no setup needed) |
| `pnpm test:e2e` | Playwright browser journeys (self-contained: boots its own server + in-memory Mongo on :3210) |
| `pnpm seed` | Seeds the demo account through the public API (`SEED_BASE_URL` to target the deployed app) |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |

The first integration/e2e run downloads a MongoDB binary for the in-memory server (cached afterwards).

## API overview

All endpoints are session-authenticated (httpOnly cookie) except signup/login. Every error has the shape `{ "error": { "code", "message", "details?" } }` with a stable machine-readable code.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/auth/signup` | Create account (email + password), starts a session |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Current user |
| GET | `/api/orders?status=` | List orders, optional derived-status filter |
| POST | `/api/orders` | Create order (customer, currency, due date, line items; supports `Idempotency-Key`) |
| GET | `/api/orders/:id` | Order detail + payment history + audit log |
| PATCH | `/api/orders/:id` | Edit order (only while it has no payments) |
| DELETE | `/api/orders/:id` | Delete order (only while it has no payments) |
| POST | `/api/orders/:id/payments` | Record a payment (supports `Idempotency-Key` header) |
| POST | `/api/orders/:id/refunds` | Record a refund (supports `Idempotency-Key` header) |
| GET | `/api/orders/export?from=&to=` | CSV export, optional due-date range |

## Design decisions

### Money

All amounts are stored and computed as **integers in the currency's minor unit** (cents for USD, fils for AED). Amounts enter the API as decimal strings, are parsed digit by digit (`src/domain/money.ts`), and floating point never touches arithmetic. Because the only operations are integer multiplication (`quantity x unit price`) and integer addition, **no rounding is ever needed**; there is no rounding policy because there is nothing to round.

Multi-currency is supported **per order**: each order has an ISO 4217 currency chosen at creation (immutable afterwards), and payments/refunds inherit it. Currencies carry their own number of decimal places (USD/AED 2, KWD 3, JPY 0), enforced on input and used on output. **No FX conversion or cross-currency aggregation** exists by design; the dashboard is a per-order list, so amounts of different currencies are never summed. That is also how I would evolve it: conversion is a product decision (which rate, at which date) that deserves its own design.

### Status derivation

Status is **always derived, never stored**, from `(total, net paid, due date, now)`:

| Status | Rule |
| --- | --- |
| `paid` | net paid == total |
| `overdue` | past due date and not fully paid |
| `partially_paid` | 0 < net paid < total, not past due |
| `pending` | no net payments, not past due |

Edge cases (all covered by tests):

- **`paid` wins over `overdue`**: an order that was overdue and is then fully settled shows as `paid`. The audit log preserves the transition history.
- An order becomes overdue starting **the day after** its due date, **in UTC** (payment is expected on the due date itself).
- **Refunds reduce net paid**, so a `paid` order can regress to `partially_paid`, `pending`, or `overdue`. Deriving status makes this automatic and consistent.
- Because `overdue` depends on the clock, it flips with no background job, and the status filter is applied after derivation.

### Payments, refunds, and the over-payment invariant

The invariant is `0 <= net paid <= order total`, where net paid = payments − refunds.

- Over-payments are rejected with **409 `OVERPAYMENT`** including `details.maxAllowed`, and refunds beyond net paid with **409 `REFUND_EXCEEDS_PAID`** including `details.maxRefundable`, so clients can tell the user exactly what would succeed.
- Payments and refunds are **immutable** (no edit/delete): corrections are modeled as refunds, which keeps the history audit-friendly.
- Every mutation writes an **audit log** entry, including derived status before/after.

### Concurrency

Two payments submitted at the same time must not exceed the total. The payment write is a **conditional `findOneAndUpdate`** on the order whose filter enforces the invariant (`netPaid + amount <= total`) while incrementing the denormalized `netPaidMinor`. Mongo serializes writes to a single document, so the losing request matches nothing and gets a 409 with the recalculated maximum; no lock service needed. A **multi-document transaction** wraps the order update, the payment insert, and the audit entry so they commit or fail together (works on any replica set, including Atlas M0; the integration suite runs against an in-memory replica set and includes a test firing concurrent payments).

### Idempotency

Repeating an action must not create a second record (double click, F5 mid-request, network retry). Order, payment and refund POSTs accept an **`Idempotency-Key` header**: replaying a key returns **200 with the original resource** instead of a 201 with a duplicate. Unique partial indexes (`(userId, idempotencyKey)` on orders; `(orderId, type, idempotencyKey)` on payments, so a payment and a refund can never shadow each other's key) back this against races. Replaying a payment key **with different parameters** (amount, date or note) is a client bug, not a retry, and is rejected with 409 `CONFLICT`. The UI sends a fresh key per intent and reuses it across retries of the same submit.

### Order lifecycle

Orders are **editable and deletable only while they have no payments or refunds**. After the first payment the document is read-only (enforced by the API with 409 `ORDER_NOT_EDITABLE`, re-checked atomically in the update filter). Rationale: if the total could shrink below what was already paid, the over-payment invariant would break retroactively; in a financial system the document that money was settled against must not mutate.

### Multi-tenancy

Every document carries `userId` and **every query filters by it** (it leads every index). Another user's order behaves exactly like a missing one: 404, never 403, so order ids don't leak existence.

### i18n

UI is fully translated via next-intl with **en-US default and es-ES included**; adding a locale is one JSON file plus one config entry. Locale lives in a cookie (no URL prefixes). Money and dates format per locale via `Intl`. API error messages are English; the UI translates known error codes client-side and interpolates structured details (e.g. the max allowed amount).

## Assumptions

- One user = one tenant; no organizations or data sharing between accounts.
- Customer is a plain string on the order (no customer entity), as allowed by the brief.
- Order currency is chosen at creation and immutable; payments/refunds are always in the order's currency (no FX).
- An order's total must be greater than zero (line items with price 0 are allowed as long as the order total is positive), since settlement semantics for a zero-total order are undefined.
- Due dates and payment dates are calendar dates (`YYYY-MM-DD`), not timestamps; overdue is evaluated in UTC. Per-user timezones are a production improvement, not assignment scope.
- Payment dates are informational (they don't affect status); status uses the server clock.
- Refunds are modeled as a payment entry of type `refund` (the brief's "negative payment" option) rather than a separate aggregate.
- The dashboard lists all of a user's orders without pagination; fine for assignment-scale data, noted below for production.
- Order editing after creation exists in the API (PATCH, while unpaid); the UI exposes create/delete and treats edit as API-level scope.
- Seeding goes through the public API on purpose (works against any environment, exercises real validation); re-running it is a no-op.

## Data model and indexing at scale

Collections: `users`, `sessions` (TTL-expired), `orders` (line items embedded; denormalized `netPaidMinor` + `paymentCount`), `payments`, `audit_logs`. Indexes are created in code (`src/lib/db.ts`): unique email, session token + TTL, `(userId, createdAt)` and `(userId, dueDate)` on orders, `(orderId, createdAt)` on payments, and the unique partial idempotency index.

At scale, the derived-status filter would move into the query itself: `paid`/`partially_paid`/`pending` are expressible as range conditions over `(netPaidMinor, totalMinor)`, and `overdue` as `dueDate < today AND netPaidMinor < totalMinor`, backed by a compound index, with pagination on `(userId, createdAt)`.

## Testing

- **Unit** (`tests/unit`): money parsing/formatting per currency, full status-derivation matrix including refund regressions and the UTC overdue boundary.
- **API integration** (`tests/integration`): route handlers called as functions against a real in-memory Mongo replica set. Covers the assignment's sample scenario (1000 → 400 → 600 → reject 1), over-payment errors with `maxAllowed`, **concurrent payments** (two 600s; eight parallel 100s stop exactly at 500), idempotency replay and race, tenant isolation (list/detail/pay/delete), immutability after payment, refund rules, audit trail, CSV export.
- **E2E** (`e2e/`): full browser journey (signup → create order → partial payment → over-payment error → settle → refund), dashboard status filter, language switcher. Self-contained via `scripts/e2e-server.mjs`.

## What I would improve before production

- **Security**: rate limiting and lockout on auth endpoints, password reset + email verification, token-based CSRF (today: SameSite=Lax plus an Origin-header check on mutating requests), a full CSP on top of the basic security headers already set, session rotation on privilege changes.
- **Operations**: structured logging with request/trace ids, metrics on payment outcomes (accepted/over-payment/idempotent-replay), alerting, backups and restore drills for Atlas.
- **Product/API**: pagination and search on orders, order editing UI, computed status filtering in the query layer (above), customer as an entity, configurable currency list, webhooks for payment events, CSV export streaming for large ranges.
- **Data**: move audit logs to an append-only pattern with stricter write paths; consider a `settlements` read model if reporting grows.

## Deployment

Designed for **Vercel + MongoDB Atlas M0** (both free tiers, no card required).

1. **Atlas**: create a free M0 cluster, a database user with read/write access, and allow `0.0.0.0/0` in Network Access (Vercel functions have dynamic IPs). Copy the `mongodb+srv://` connection string.
2. **Vercel**: import the GitHub repo at vercel.com/new, set env var `MONGODB_URI` to the connection string. Deploy.
3. **Seed the demo account**: `SEED_BASE_URL=https://<app>.vercel.app node scripts/seed.mjs`
4. Update the Live URL at the top of this README.

## Project structure

```
src/
  domain/        # pure logic: money, status derivation, zod schemas, errors
  lib/           # Mongo client + indexes, auth/sessions, order service, http helpers
  app/api/       # REST route handlers (thin: parse -> service -> respond)
  app/           # pages (login, signup, dashboard, orders)
  components/    # client UI (dashboard, forms, detail, locale switcher)
  i18n/          # next-intl config + en-US / es-ES messages
tests/           # unit + API integration (in-memory Mongo replica set)
e2e/             # Playwright journeys
scripts/         # seed (via public API) and e2e server harness
```
