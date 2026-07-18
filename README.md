# Alliance Command Center

Leadership intelligence platform for alliance management in Last War.

Alliance Command Center helps alliance leaders make better decisions by combining historical participation data, configurable metrics, and qualitative leadership observations into a single source of truth.

## Features

- **Member Management:** Track your alliance roster with detailed profiles
- **Configurable Metrics:** Define what matters to your alliance (VS Points, Donations, Participation)
- **Evaluation Periods:** Run time-boxed evaluations with weighted scoring
- **Leadership Notes:** Document observations, warnings, and recognition
- **Role-Based Access:** Owner, Admin, Leader, and Viewer roles with appropriate permissions
- **Multi-Tenant:** Each alliance has isolated data and configuration

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL)

### Local Development

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd alliance-command-center-app
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your local settings (defaults work for local dev)
   ```

3. **Start the database and seed data:**
   ```bash
   npm run db:init
   ```
   This starts PostgreSQL via Docker, runs migrations, and seeds test data.

4. **Start the development server:**
   ```bash
   npm run dev
   ```

5. **Open the app:**
   - http://localhost:3000
   - Login with seeded test user: `owner@day1.com` / `Password123`

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test` | Run all tests |
| `npm run test:unit` | Run unit tests |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run db:init` | Initialize local database with seed data |
| `npm run studio` | Open Prisma Studio for database inspection |
| `npm run beta:invite` | Create a beta invitation |

## Environment Variables

See `.env.example` for all available configuration options.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Secret for signing sessions |
| `NEXTAUTH_URL` | Base URL for authentication |

### Optional

| Variable | Description |
|----------|-------------|
| `PLATFORM_ADMIN_EMAILS` | Comma-separated list of platform admin emails |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Enable "Continue with Google" (both required) |
| `RESEND_API_KEY` | Resend API key for transactional email (with `EMAIL_FROM`) |
| `EMAIL_FROM` | Sender address for transactional email; emails are logged instead of sent when unset |
| `SENTRY_DSN` | Sentry DSN for error tracking |
| `FEATURE_*` | Feature flags |

## Architecture

Alliance Command Center is built with:

- **Framework:** Next.js 16 (App Router)
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** Auth.js (NextAuth v5)
- **Styling:** Tailwind CSS
- **Testing:** Vitest (unit), Playwright (E2E)

### Key Architectural Decisions

- **ADR-002:** Multi-tenant - every feature respects tenant boundaries
- **ADR-007:** Capability-based authorization
- **ADR-009:** Design system architecture
- **ADR-010:** Platform Operations Console
- **ADR-011:** Continuous Delivery

See `docs/adr/` for all architectural decision records.

## Deployment

### Vercel (Recommended)

1. Connect your repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy automatically on merge to `main`

Build command is configured to:
- Generate Prisma client
- Run database migrations
- Build Next.js application

### Database

Use a managed PostgreSQL provider:
- [Neon](https://neon.tech) - Recommended for Vercel
- [Supabase](https://supabase.com)
- [AWS RDS](https://aws.amazon.com/rds/)

## Operations

- `docs/operations/rollback.md` - Rollback procedures
- `docs/operations/backups.md` - Backup and restore

## Contributing

See `AGENTS.md` for engineering guidelines and `docs/` for detailed documentation.

## License

Private - All rights reserved.
