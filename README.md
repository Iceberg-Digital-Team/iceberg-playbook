# Iceberg Playbook

Iceberg Playbook is an internal support problem-solving and operational knowledge platform developed for **Iceberg Digital**.

The platform helps the Support Team document recurring problems, connect them with verified solutions, and quickly reuse existing knowledge when similar problems occur again.

---

## Project Concept

The system is based on four main concepts:

### Playbook

A Playbook represents a product, platform, or problem domain.

Examples:

- WhatsApp
- Meta Business
- Lifesycle
- Zoom
- Plaud
- Website
- CRM

### Issue

An Issue represents a recurring problem encountered by the Support Team.

Example:

`WA-001 — Phone Number Already Registered`

An Issue describes the **problem**, not the solution.

### Guide

A Guide contains the documented solution to an existing Issue.

Each Guide must be connected to an Issue.

Example:

```text
WhatsApp Playbook
       ↓
WA-001 — Phone Number Already Registered
       ↓
Solution Guide
```

In simple terms:

**Issue = Problem**  
**Guide = Solution**

### SOP

An SOP (Standard Operating Procedure) represents a standardized operational process.

Unlike Guides, SOPs do not need to be connected to an Issue.

---

## Main Workflow

The intended Support workflow is:

```text
Customer Problem / Support Request
              ↓
       Search Playbook
              ↓
     Existing Issue Found?
          ↙          ↘
        YES           NO
         ↓             ↓
   Open Issue      Create Issue
         ↓             ↓
 Open Solution     Investigate
      Guide             ↓
         ↓         Solve Problem
   Apply Solution       ↓
                   Create Guide
                        ↓
                Document Solution
                        ↓
                Future Reuse
```

The objective is to prevent the Support Team from repeatedly investigating problems that have already been solved.

---

## Guide Structure

All Guides follow a standardized structure:

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

The **Step-by-Step** section is the main operational part of a Guide.

---

## Guide Versioning

Published Guides can be updated without losing previous versions.

Example:

```text
v1.0
v1.1
v1.2
```

Each meaningful published update creates a new version.

Previous versions can be viewed and restored.

Restoring an older version does **not** delete or overwrite the existing version history.

For example:

```text
Current Version: v1.5

Restore v1.2
      ↓
New Version: v1.6
(Restored from v1.2)
```

This allows the complete history of a Guide to remain traceable.

---

## Authentication

Iceberg Playbook is designed as an **internal platform**.

There is no public user registration.

The current project contains the frontend authentication interface and a mock authentication implementation for development.

Real authentication will later be connected using **Supabase Auth**.

Planned roles:

- **Admin** — Full platform management
- **Support** — Create and update Issues, Guides, and SOPs
- **Viewer** — Read-only access

User authentication will also allow content changes to be associated with real users.

Examples:

```text
Created by Tarik
Updated by Nuri
Last updated 15 September 2026
```

---

## Current Project Status

The project is currently transitioning from the frontend prototype stage to backend development.

### Implemented

- Home
- Playbooks
- Issue pages
- Guide pages
- SOP pages
- Search interface
- Create Issue
- Create Guide
- Create SOP
- Create Playbook
- Guide preview
- Guide publishing flow
- Guide version history
- Guide version restore
- Internal login interface
- Mock authentication
- Responsive UI
- Iceberg Digital design system

### Next Development Stages

- PostgreSQL database architecture
- Supabase integration
- Supabase Auth
- User Profiles
- Role-based permissions
- Row Level Security (RLS)
- Real CRUD operations
- Database-powered search
- File / attachment storage
- User activity tracking
- Jira integration
- Production security

---

## Technology Stack

### Current Frontend

- React
- TypeScript
- Vite
- Node.js
- npm

### Planned Backend

- PostgreSQL
- Supabase
- Supabase Auth
- Supabase Storage

---

## Local Development

Clone the repository:

```bash
git clone https://github.com/nottrixx/iceberg-playbook.git
```

Enter the project:

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

---

## Git Workflow

Do **not** develop directly on the `main` branch.

Before starting a task, make sure your local `main` is up to date:

```bash
git checkout main
git pull origin main
```

Create a new branch for your task:

```bash
git checkout -b feature/task-name
```

Example:

```bash
git checkout -b feature/database-schema
```

After completing the task:

```bash
git add .
git commit -m "Describe the changes"
git push origin feature/task-name
```

Then create a **Pull Request** on GitHub.

Changes should be reviewed before being merged into `main`.

---

## Security Rules

Never commit sensitive information to GitHub.

Do not commit:

- `.env` files
- Database passwords
- API keys
- Supabase service role keys
- Jira API tokens
- Access tokens
- Private credentials

Sensitive configuration must be handled through environment variables and secure backend configuration.

---

## Development Principles

When contributing to Iceberg Playbook:

- Keep the distinction between **Issue (Problem)** and **Guide (Solution)** clear.
- A Guide must belong to an existing Issue.
- SOPs remain independent from Issues.
- Do not remove Guide version history.
- Do not introduce unnecessary complexity.
- Preserve the existing Iceberg visual identity.
- Do not commit secrets or credentials.
- Use a separate Git branch for development.
- Submit changes through Pull Requests.

---

## Purpose

Iceberg Playbook is intended to become the internal operational reference point for the Iceberg Digital Support Team.

The goal is simple:

**Find the problem → Find the documented solution → Solve it faster → Preserve the knowledge for the future.**

---

**Internal Project — Iceberg Digital**
