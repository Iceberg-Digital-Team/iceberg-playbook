# Iceberg Playbook

Iceberg Playbook is an internal support problem-solving and operational knowledge platform developed for Iceberg Digital.

The goal of the platform is to help the Support Team document recurring problems, connect them with verified solutions, and quickly reuse these solutions when similar issues occur in the future.

## Core Structure

The platform is built around four main concepts:

- **Playbooks** — Product or platform areas such as WhatsApp, Meta Business, Lifesycle, Zoom, Plaud, Website, and CRM.
- **Issues** — Recurring problems encountered by the Support Team.
- **Guides** — Documented solutions linked to existing Issues.
- **SOPs** — Standardized operational processes that are independent from Issues.

## Issue → Guide Relationship

An **Issue** describes the problem.

A **Guide** describes the solution to that problem.

Example:

```text
Playbook: WhatsApp

Issue:
WA-001 — Phone Number Already Registered

Guide:
Solution Guide for WA-001
```

This structure allows the Support Team to search for a known problem and quickly access its documented solution.

## Guide Structure

Guides follow a standardized structure:

1. Header
2. Summary
3. Before You Start
4. Important Information
5. Video Tutorial
6. Step-by-Step
7. PDF Guide
8. Common Problems
9. Internal Notes
10. Version History

## Guide Versioning

Published Guides can be updated without losing their previous versions.

Each meaningful update creates a new Guide version.

For example:

```text
v1.0
v1.1
v1.2
```

Previous versions can be reviewed and restored.

Restoring an older version does not delete or overwrite the existing history. Instead, a new version is created using the content of the selected historical version.

## Authentication

The project currently includes an internal login interface.

Public registration is intentionally not included.

Authentication currently uses a frontend mock implementation for development and testing. Real authentication will be integrated later using Supabase Auth.

Planned roles:

- Admin
- Support
- Viewer

## Current Status

Iceberg Playbook is currently in the MVP development stage.

### Implemented

- Home
- Playbooks
- Issues
- Guides
- SOPs
- Search interface
- Troubleshooting flow
- Create flows
- Guide version history
- Guide restore flow
- Internal login UI
- Responsive interface
- Iceberg Digital visual identity

### Planned

- PostgreSQL / Supabase database
- Supabase Auth
- User profiles
- Role-based permissions
- Row Level Security (RLS)
- Real CRUD operations
- File storage
- Database-powered search
- Jira integration
- User activity tracking such as Created By and Updated By

## Technology

Current frontend:

- React
- TypeScript
- Vite
- Node.js
- npm

Planned backend infrastructure:

- PostgreSQL
- Supabase
- Supabase Auth
- Supabase Storage

## Local Development

Clone the repository:

```bash
git clone https://github.com/nottrixx/iceberg-playbook.git
```

Enter the project directory:

```bash
cd iceberg-playbook
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

## Development Workflow

Do not work directly on the `main` branch.

Create a separate branch for each task:

```bash
git checkout -b feature/task-name
```

After completing your work:

```bash
git add .
git commit -m "Describe your changes"
git push origin feature/task-name
```

Then create a Pull Request for review before merging changes into `main`.

## Security

Never commit sensitive information to the repository.

This includes:

- `.env` files
- API keys
- Supabase service role keys
- Database passwords
- Jira tokens
- Private credentials

Sensitive configuration must be handled through environment variables.

## Workflow

The intended Iceberg Playbook workflow is:

```text
Problem occurs
      ↓
Search Playbook
      ↓
Existing Issue found?
      ↓
YES → Open Solution Guide → Solve
      ↓
NO → Create Issue → Investigate → Create Guide
      ↓
Future Support cases reuse the documented solution
```

## Purpose

Iceberg Playbook is intended to become the internal operational reference point for the Iceberg Digital Support Team, making recurring problems easier to identify, document, solve, and reuse as organizational knowledge.

---

Internal project for Iceberg Digital.
