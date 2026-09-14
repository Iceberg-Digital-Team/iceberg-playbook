# Iceberg Playbook

## Purpose
Internal support problem-solving and knowledge platform for Iceberg Digital.

## Current Status
Frontend prototype / MVP.

## Core Concepts
- **Playbooks**: Top-level knowledge areas grouping domain-specific troubleshooting workflows and operational documentation.
- **Issues**: Specific support scenarios, customer inquiries, or error states requiring resolution.
- **Guides**: Step-by-step resolution paths linked to issues, detailing troubleshooting actions and solutions.
- **SOPs**: Standard Operating Procedures establishing verified support processes.
- **Guide Version History**: Version tracking and restore capabilities for guide content changes.
- **Internal Login UI**: Clean workspace sign-in interface for support personnel.

> **Important**: The current authentication is mock/frontend-only. A real database, Supabase Auth, permissions, Row-Level Security (RLS), file storage, and Jira integration will be implemented later.

## Local Development

### Prerequisites
- Node.js (v20+ recommended)
- npm

### Setup & Installation
```bash
npm install
```

### Running the Development Server
```bash
npm run dev
```

### Running Tests
```bash
node --test tests/*.test.mjs
```

### Typechecking & Building for Production
```bash
npm run build
```

### Linting
```bash
npm run lint
```
