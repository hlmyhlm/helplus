# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Multi-company: every record belongs to a company, and queries are scoped to the logged-in user's company. Existing data moves into "My Company".
- Roles are now owner, admin, supervisor, staff, viewer and client. The first admin of each company becomes owner; agent and editor become staff.
- Settings and business hours are per company.
- Tickets are the main screen now. Each ticket has a number per company, a client/project, a handler (staff login) and one of six steps: New, AI Suggested, Answered, Reopened, Staff working, Closed.
- Every message from a channel lands on a ticket, with IC numbers hidden, even when AI is not set up.
- Quick add, ticket detail with replies and internal notes, and a Clients/Projects screen. Staff and viewers only see the projects they are given.
- The old Conversations page now opens Tickets. Deleting a conversation deletes its tickets.
- The realtime stream is limited to supervisors, admins and owners for now.
- SLA rules per company with project, priority, category and source overrides. Due times follow business hours and holidays and pause while a ticket waits on the client.
- Answered tickets close by themselves after 3 days by default (Settings > Closing tickets). Clients with an email get a warning a day before.
- Link-only email alerts for new, reopened, near-breach and overdue tickets, with retries and an email log.

### Upgrade notes

- Set `HELPLUS_SECRET_KEY` (see `.env.example`), then run `npx tsx --env-file=.env scripts/encrypt-secrets.ts` once.
- Twilio webhooks without a Twilio token are refused. Set the token, or `HELPLUS_ALLOW_UNSIGNED_WEBHOOKS=true` for local testing only.
- Telegram webhooks now need a secret. Set `telegramWebhookSecret` with `PUT /api/settings`, and register the webhook with the same value as `secret_token`. Until then every Telegram update gets 403.
- With more than one company on a server, add `?company=<slug>` to the Twilio and Telegram webhook URLs.
- Run `npx prisma migrate deploy`. The tickets migration gives every conversation without a ticket its own ticket, numbers all tickets, maps the old statuses (open to New, in progress to Staff working, resolved to Closed) and puts everything in a "General" project. Back up first.
- Existing staff and viewer accounts get access to "General" only. Give them other projects under Clients.
- Run the worker next to the app: `npm run worker`. Without it, nothing closes by itself and no emails go out.
- Add an email address to each user who should get alerts (Users & roles).
- SLA times apply to tickets created after the upgrade, and to older tickets once their priority, project, category or source changes.

## [0.2.2] - 2026-04-08

### Added

- Role-Based Access Control (RBAC): 4 roles (admin/supervisor/agent/viewer), 40+ granular permissions, route auth helper
- AI Guardrails: confidence scoring, blocked topic detection, human approval triggers, sentiment analysis, intent detection, suggested replies
- Conversation Management Engine: 4 routing strategies, transfer, merge, snooze, SLA breach auto-escalation, macro execution
- Internationalization (i18n): 6 languages (EN, TR, DE, ES, AR, FR), RTL support, 100+ translation keys
- GDPR Compliance: PII detection/redaction, customer data export, data deletion/anonymization, retention policy enforcement
- Plugin System: hook-based event architecture, 11 built-in events, priority pipeline
- Custom Fields: 8 field types, validation, support for conversation/ticket/customer entities
- Live Chat Widget: embeddable JS widget for customer websites, configurable colors/position/greeting
- Campaign Manager: customer segmentation, proactive messaging, target audience matching
- Flow Builder: 7 node types, decision tree flows, variable interpolation, cycle validation
- 46 new tests (274 total across 25 files)

### Fixed

- Email IMAP listener crash on processEmail failure (now catches and logs)
- WhatsApp message handler crash on any processing error (now wrapped in try-catch)
- AI engine crash on OpenAI API error (now returns graceful fallback message)
- Phone speech handler crash on AI error (now returns user-friendly TwiML)
- Conversation satisfaction endpoint missing existence check (now returns 404)
- Conversation PUT accepting invalid status values (now enum validated)
- Conversation PUT accepting invalid satisfaction values (now integer 1-5 validated)
- Message creation using invalid default role "admin" (now defaults to "assistant")
- Message creation accepting any role string (now validated against enum)
- Webhook PUT accepting unvalidated body (now validates URL, method, known fields only)
- Webhook PUT/DELETE missing existence check (now returns 404)
- InternalNote orphaned on conversation deletion (now cascade deletes via FK)
- Admin role enum mismatch between validations and RBAC (now aligned: admin/supervisor/agent/viewer)
- Conversation channel accepting free-form string (now enum: whatsapp/email/phone/api/widget)

## [0.2.1] - 2026-04-07

### Added

- Cross-channel conversation continuity: automatic customer identity resolution across WhatsApp, Email, and Phone
- `customerId` foreign key on Conversation model linking conversations to unified Customer profiles
- Customer resolver module with phone number normalization and cross-field matching
- Unified customer timeline endpoint: `GET /api/customers/:id/conversations`
- Kubernetes Helm chart (`helm/helplus/`) with deployment, service, ingress, HPA, PVC, secrets
- OpenAPI 3.0 specification served at `GET /api/openapi.json`
- Webhook delivery system with exponential retry (3 attempts) and HMAC-SHA256 signatures
- Webhook delivery log and manual retry endpoint: `/api/webhooks/:id/deliveries`
- Request ID tracking (`X-Request-Id` header) on every API response
- Rate limit headers on all API responses (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`)
- API version header (`X-API-Version: 2026-04-07`)
- CORS support via `CORS_ORIGIN` environment variable
- Standardized error response format: `{ error: { code, message, requestId } }`
- `AppError` class with factory methods (`notFound`, `badRequest`, `unauthorized`, `tooManyRequests`, `internal`)
- Graceful shutdown handler (SIGTERM/SIGINT with connection cleanup)
- Pagination helper module (`src/lib/pagination.ts`) shared across all endpoints
- Export endpoint now supports `customers` and `knowledge` types with date range filters and 50K record limit
- Database compound indexes for query performance
- 51 new tests (228 total across 21 files)

### Changed

- All 14 list endpoints now paginated (max 100 per page, default 20)
- Existing `/api/customers` and `/api/activity` pagination capped at 100
- Export endpoint limits records to prevent memory exhaustion
- Chat endpoint hardened with try/catch, input validation, and 10K character limit
- Dockerfile upgraded to multi-stage build with non-root user and HEALTHCHECK
- Docker Compose updated with app health check, resource limits, and production defaults
- Health check endpoint now reports OpenAI reachability, memory usage, and environment
- AI `get_customer_history` tool supports cross-channel lookup via `customerId`
- Conversation detail API includes linked customer data

### Removed

- Unused `socket.io` and `socket.io-client` dependencies

## [0.1.1] - 2026-04-06

### Security

- Remove hardcoded JWT secret fallback — `JWT_SECRET` env var now required
- Mask sensitive fields (API keys, passwords, tokens) in settings API responses
- Fix XSS vulnerability in email HTML generation
- Fix CRLF header injection in email subject lines
- Add security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy)
- Add rate limiting: 5 req/min on auth endpoints, 60 req/min on general API
- Add JWT structure validation in middleware
- Add webhook fetch timeout (10s AbortController)
- Add Zod input validation schemas for all API endpoints

### Added

- Vitest test suite: 177 tests across 15 files (unit, API, middleware, security)
- Structured logger (`src/lib/logger.ts`) with timestamps, levels, and JSON context
- Rate limiting module (`src/lib/rate-limit.ts`) with sliding window algorithm
- Security utilities (`src/lib/security.ts`) for HTML escaping, secret masking, CRLF sanitization
- Input validation schemas (`src/lib/validations.ts`) with Zod for all API endpoints

### Changed

- Replace 79 console.log/console.error calls across 37 files with structured logger
- Add test step to CI pipeline (GitHub Actions)
- Harden next.config.ts: disable X-Powered-By, enable React strict mode

## [0.1.0] - 2026-04-05

### Added

- Multi-channel support: WhatsApp (QR/API), Email (IMAP/SMTP), Phone (Twilio + ElevenLabs + Whisper)
- AI engine with OpenAI GPT integration and function calling
- 6 AI tools: ticket creation, team routing, internal email, customer history, webhooks, follow-ups
- 19-page admin dashboard with unified inbox
- Customer CRM with profiles, notes, tags, and cross-channel history
- Ticket system with priority levels, department assignment, and SLA tracking
- Knowledge base with categories, entries, priority levels, and test mode
- Automation rules engine: auto-route, auto-tag, auto-reply, keyword alerts
- Business hours configuration with weekly schedule and offline messages
- SLA rules with first response and resolution time targets
- Canned responses with keyboard shortcuts and usage tracking
- Analytics dashboard with line, bar, and donut charts (pure CSS/SVG)
- Activity audit log with entity filtering and pagination
- Admin user management with role-based access (admin, editor, viewer)
- API key generation and management
- Webhook management with test functionality
- Interactive API documentation with live request testing
- Customer satisfaction surveys (1-5 star rating)
- Dark mode with persistent theme preference
- Onboarding checklist for guided setup
- JWT authentication with setup wizard
- Docker Compose deployment
- CSV/JSON data export
- Health check endpoint
- GitHub Actions CI pipeline
