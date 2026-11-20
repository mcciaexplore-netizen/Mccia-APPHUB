# MCCIA App Hub

**A Centralised Application Management Platform for MCCIA**

MCCIA App Hub is a centralised platform that provides a unified access point for MCCIA's internal web applications. It brings applications from different departments into one organised interface, allowing employees to access the tools relevant to their roles through a single authenticated platform.

The hub provides centralised application management, user administration, role-based access control, activity tracking, and integrated business workflows.

It is designed to be scalable and modular, allowing administrators to manage departments, applications, users, and permissions without requiring application redeployment.

## Key Features

### 1. Centralised Application Management
- Unified dashboard for accessing MCCIA applications.
- Department-wise application organisation.
- Custom application cards with configurable icons and availability status.
- Centralised application registration and management.
- Support for external applications and applications integrated directly into the hub.

### 2. User and Access Management
- Secure authentication and account management.
- Individual application-level access permissions.
- Role-based access control.
- Department, branch, team, and reporting-manager organisation.
- Individual and bulk user creation.
- CSV and Excel-based user imports.
- Account activation, deactivation, and management.
- Password setup through one-time invitation links.

### 3. Administrator Dashboard
- Centralised administrative interface.
- Department and application management.
- User directory with search, filtering, and sorting.
- Application access assignment and reusable permission templates.
- Activity monitoring and audit history.
- Bulk access management.
- Application availability monitoring.

### 4. Integrated Approval System
A built-in approval management module supporting:

- HR requests.
- Expenditure approvals.
- Employee expense requests.
- Multi-level approval workflows.
- Budget allocation and utilisation tracking.
- Request attachments and approval timelines.
- Notifications and reporting.
- Configurable approval rules and permissions.

### 5. IVR-CRM
An integrated calling and membership relationship management module.

Key capabilities include:
- Member and lead management.
- Calling workflows through Tata Smartflo.
- Call history and recording management.
- Agent-wise member allocation.
- Calling analytics and reporting.
- Zoho Mail integration.
- Administrative controls and team management.

### 6. Notifications and Activity Tracking
- Centralised notification system.
- Application launch tracking.
- User activity monitoring.
- Administrative audit records.
- Application-wise usage information.
- Notification integration across built-in modules.

## Architecture

MCCIA App Hub follows a modular architecture in which the hub manages application access and navigation while individual external applications retain their own infrastructure and authentication.

**Core architecture:**
- Centralised authentication.
- Server-side permission validation.
- Application-level access management.
- Modular built-in applications.
- Shared database infrastructure.
- Centralised administrative controls.
- Independent module-level data structures.

External applications are accessed through controlled launch routes. Built-in modules operate within the hub's interface and use its authentication and access-management infrastructure.

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 |
| Architecture | App Router |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Validation | Zod |
| Icons | Lucide React |
| Deployment | Vercel |
| Database Hosting | Neon / PostgreSQL |
| Integrations | Tata Smartflo, Zoho Mail |

## Project Structure

The repository follows a modular structure to maintain separation between the core platform and its integrated applications.

| Directory | Purpose |
|---|---|
| `src/app/` | Application routes and pages |
| `src/components/` | Shared UI components |
| `src/lib/` | Core business logic and utilities |
| `src/db/` | Database configuration and schemas |
| `src/lib/approvals/` | Approval System logic |
| `src/lib/ivr/` | IVR-CRM logic |
| `drizzle/` | Database migrations |
| `scripts/` | Database, maintenance, and utility scripts |
| `tests/` | Automated testing |
| `docs/` | Technical documentation |
| `approvals-app/` | Standalone legacy approval application |

## Getting Started

### Prerequisites

- Node.js (compatible with the project dependencies).
- npm.
- PostgreSQL database or Neon database.
- Git.

### Installation

Clone the repository:

```powershell
git clone <repository-url>
cd <project-directory>
```

Install dependencies:

```powershell
npm install
```

Create the local environment file:

```powershell
Copy-Item .env.example .env.local
```

Configure the required environment variables in `.env.local`.

Run database migrations:

```powershell
npx drizzle-kit migrate
```

Seed the initial administrator:

```powershell
npx tsx scripts/seed.ts
```

Start the development server:

```powershell
npm run dev
```

The application will be available at:

`http://localhost:3000`

## Environment Configuration

The application uses environment variables for database connectivity, authentication, administrative access, and optional integrations.

Refer to `.env.example` for the complete configuration reference.

Important configuration groups:

- Database connection.
- Authentication and session security.
- Initial administrator configuration.
- Email and SMTP integration.
- Application URL configuration.
- Optional module integrations.
- Database connection pooling.

**Security:** Never commit `.env.local`, production credentials, API keys, access tokens, database passwords, or other secrets to version control.

## Database Management

The platform uses PostgreSQL with Drizzle ORM for database operations and schema management.

Useful commands:

```powershell
npm run db:generate
npm run db:migrate
npm run db:seed
```

Database migrations are version-controlled and should be applied through the migration process.

Production database changes must be reviewed and backed up before deployment.

## Testing and Quality Assurance

The project includes automated tests covering core functionality, permissions, database operations, integrations, and user workflows.

Available commands:

```powershell
npm run test:unit
npm run test:integration:hub
npm run test:integration
npm run test:e2e
npm run test:e2e:people
npm run build
npm run typecheck
npm run lint
```

Integration and end-to-end tests should use a dedicated test database or isolated database branch.

Never run destructive tests against production data.

Refer to `REPORT.md` and `docs/PERFORMANCE.md` for testing and performance documentation.

## Deployment

The application supports deployment using Vercel with PostgreSQL or Neon as the database.

General deployment process:

1. Configure the production database.
2. Apply database migrations.
3. Configure production environment variables.
4. Deploy the application.
5. Initialise the administrator account.
6. Configure departments, users, applications, and permissions.
7. Verify application access and integrated workflows.

For detailed deployment and database migration procedures, refer to the internal deployment documentation.

## Security and Access Control

Security is a core consideration in the platform architecture.

Key principles include:

- Authentication required for application access.
- Server-side permission verification.
- Application-level access restrictions.
- Role-based administrative permissions.
- Secure password hashing.
- Signed authentication sessions.
- Restricted administrative access.
- Audit logging for sensitive administrative changes.
- Secure handling of integration credentials.
- Validation of external application URLs.
- Protection against unauthorised access to internal resources.

Sensitive operations are independently validated on the server rather than relying exclusively on interface-level restrictions.

## Integrated Modules

| Module | Description |
|---|---|
| Application Hub | Centralised application directory and navigation |
| Administrator | Users, departments, applications, permissions, and monitoring |
| Approval System | HR, expenditure, and employee expense workflows |
| IVR-CRM | Membership calling and relationship management |
| Cab Booking | Internal transportation management |
| Inventory | Internal inventory management |

Module availability and access are controlled through platform configuration and permissions.

## Design Principles

The platform is developed around the following principles:

- **Modularity:** Applications remain logically separated.
- **Scalability:** Designed to support growing teams and application usage.
- **Security:** Access is verified at the server level.
- **Maintainability:** Shared infrastructure and consistent development patterns.
- **Usability:** A unified and consistent user experience.
- **Extensibility:** New departments and applications can be introduced through administration.

## Documentation

Refer to the repository's `docs/` directory and module-specific README files for detailed technical documentation, integration instructions, database procedures, and operational guidance.

---

**MCCIA App Hub**  
Centralised access. Simplified administration. Connected workflows.
