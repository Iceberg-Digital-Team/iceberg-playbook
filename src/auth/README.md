# Authentication Architecture

This document describes the authentication architecture, session lifecycle, and authorization model implemented in Iceberg Playbook.

---

## 1. Authentication Overview

Authentication in Iceberg Playbook is live and fully integrated with **Supabase Auth**.

- The client application relies on `@supabase/supabase-js` to communicate with the Supabase Auth service.
- The application's `AuthProvider` (`src/auth/AuthProvider.tsx`) uses `supabaseAuthAdapter` (`src/auth/supabaseAuth.ts`) by default.
- Access to the application requires both a valid Supabase Auth account and an active user profile record in the application's `public.profiles` database table.

---

## 2. Important Authentication Files

The authentication module consists of the following files within `src/auth/` and related presentation components:

- **`src/auth/auth.ts`**:
  - Declares core authentication types: `AuthUser`, `Profile`, `AuthSession`, `SignInInput`, `AuthAdapter`, and `Role` (`'Admin' | 'Support' | 'Viewer'`).
  - Contains input validation logic (`validateSignIn`) for email and password formatting.
  - Provides actor resolution utility (`getAuthActor`) for identifying session users during content mutations.
- **`src/auth/supabaseAuth.ts`**:
  - Implements the `AuthAdapter` interface for Supabase Auth.
  - Implements `signIn` (credential authentication via `signInWithPassword` and profile lookup), `signOut` (session termination), and `getSession` (session restoration).
  - Implements `fetchUserProfile` to fetch profile records from `public.profiles`.
- **`src/auth/AuthProvider.tsx`**:
  - React Context provider that manages `session` state and `loading` status.
  - Restores existing sessions on application mount via `adapter.getSession()`.
  - Exposes the `useAuth()` hook for accessing current session state and auth actions (`signIn`, `signOut`).
- **`src/components/auth/`**:
  - `LoginForm.tsx`: Handles input state, field validation, submission loading states, and error alerts.
  - `PasswordInput.tsx`: Password field component with visibility toggle.
  - `AuthLayout.tsx`: Branded container layout for authentication screens.
- **`src/pages/LoginPage.tsx`**:
  - Route view components for `#/login` and `#/forgot-password`.
- **`src/App.tsx` (Route Guarding)**:
  - Enforces route access based on session state, redirecting unauthenticated users to `#/login` and authenticated users away from auth pages.

---

## 3. Session Lifecycle

Session state is persisted by the Supabase client across browser reloads:

1. **Sign In**:
   - The user enters their email and password in `LoginForm`.
   - `supabaseAuthAdapter.signIn` calls `supabase.auth.signInWithPassword({ email, password })`.
   - Upon successful credential verification, the adapter queries `public.profiles` for the user's profile record.
   - If the profile exists, an `AuthSession` containing user identity and profile metadata is set into `AuthProvider` state.
2. **Session Restoration**:
   - On application startup, `AuthProvider` calls `supabaseAuthAdapter.getSession()`.
   - The Supabase client inspects browser storage for an active session token.
   - If a valid session token exists, `fetchUserProfile` queries `public.profiles` to retrieve the corresponding profile.
   - If verified, the session state is restored and `loading` is set to `false`.
3. **Sign Out**:
   - Triggered from the user profile menu in the sidebar or the Settings view.
   - `supabaseAuthAdapter.signOut` calls `supabase.auth.signOut()`, revoking/clearing tokens in browser storage.
   - `AuthProvider` resets session state to `null`, redirecting the user to `#/login`.
4. **Auth State Changes**:
   - `AuthProvider` tracks active session state in React context.
   - When `signIn` or `signOut` completes, state updates immediately, triggering route redirection via `src/App.tsx`.

---

## 4. Profiles and Authorization

Authentication in Supabase Auth is paired with authorization driven by the `public.profiles` table:

```text
auth.users (Supabase Auth User)
     │ (1:1 relation via id)
     ▼
public.profiles (Application Profile)
     ├── id (UUID matching auth.users)
     ├── full_name
     ├── department
     ├── avatar_url
     └── role ('Admin' | 'Support' | 'Viewer')
```

### Supported Roles

- **`Admin`**:
  - Full platform administration.
  - View and manage soft-deleted records.
  - Permitted to provision and modify user profiles and assign roles in `public.profiles`.
- **`Support`**:
  - Operational team member access.
  - Create, edit, and manage Playbooks, Issues, Guides, and SOPs.
  - Upload media attachments to storage.
  - Read active records across all domains.
- **`Viewer`**:
  - Read-only access across active Playbooks, Issues, Guides, and SOPs.
  - Cannot create, update, or soft-delete content.

Database-level Row Level Security (RLS) policies in PostgreSQL enforce these role permissions on all data tables.

---

## 5. User Provisioning

Iceberg Playbook is an internal platform with **no public user registration or self-signup flow**.

### Profile Prerequisite

For a user to access the application:
1. An account must be created in Supabase Auth (`auth.users`).
2. A corresponding record must exist in `public.profiles` matching the user's `id`.

### Missing Profile Handling

If an authenticated user in `auth.users` lacks a matching profile in `public.profiles`:
- **During Sign In**: The adapter immediately signs the user out via `client.auth.signOut()` and throws an error:
  `"Account profile not found. Please contact an administrator to provision your profile."`
- **During Session Restoration**: The adapter logs a warning, signs out the user, and returns `null`, preventing application access and redirecting to `#/login`.

---

## 6. Admin and User Management

User accounts and profiles are managed through administrative workflows:

- **No Public Signup Route**: The application does not expose self-service account registration.
- **Administrative Provisioning**: New accounts are created by administrators via Supabase Auth (or Supabase Dashboard / administrative CLI), and corresponding profile records are inserted into `public.profiles`.
- **Database Policy Enforcement**: As defined in migration `04_security_and_rls.sql`, the `profiles_insert_admin_only` policy allows only authenticated users with the `Admin` role (or `service_role`) to insert new profiles into `public.profiles`.

---

## 7. Environment Requirements

Authentication configuration relies on client-side Supabase environment variables defined in `.env.local` (refer to `.env.example` in the repository root):

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

*(Or `VITE_SUPABASE_PUBLISHABLE_KEY` as an alternative to `VITE_SUPABASE_ANON_KEY`).*

> [!CAUTION]
> **Key Security**: The client application must **only** use the public client key (`anon` or publishable key). The Supabase `service_role` key bypasses all Row Level Security and must **never** be included in frontend environment variables or client-side code.

---

## 8. Infrastructure Handover

The authentication layer is designed around an adapter interface (`AuthAdapter` in `src/auth/auth.ts`) to allow Iceberg engineers to replace Supabase Auth with an internal authentication system if desired.

### Adaptation Boundaries

To transition from Supabase Auth to an internal Iceberg identity provider:

1. **Implement `AuthAdapter`**: Create an adapter conforming to the `AuthAdapter` interface (`signIn`, `signOut`, `getSession`) that interfaces with Iceberg SSO, OAuth, or LDAP.
2. **Provider Injection**: Inject the new adapter into `<AuthProvider adapter={customAuthAdapter}>` in `src/main.tsx` or `src/auth/AuthProvider.tsx`.
3. **Session & Profile Mapping**: Map the identity shape from the external identity provider to `AuthUser` and `Profile`.
4. **Backend Authorization Adaptation**: Replace or adapt Supabase Row Level Security (RLS) policies and `auth.uid()` references with Iceberg API authorization middleware or equivalent database permissions.

> [!WARNING]
> Authentication migration is **not** plug-and-play. While the frontend adapter decouples UI components from Supabase Auth, backend authorization relies heavily on PostgreSQL RLS policies tied to Supabase JWT claims and the `public.profiles` table.

---

## 9. Security Notes

- **Client Key Security**: The browser client operates strictly with the Supabase public anonymous/publishable key.
- **Defense in Depth**: Client-side route gating (in `src/App.tsx`) provides navigation flow control; real data protection is enforced at the database level by PostgreSQL Row Level Security (RLS).
- **Profile Integrity**: Users can update their own profile name and avatar, but cannot escalate their own role. Only `Admin` users can assign or modify roles in `public.profiles`.
- **Zero Secret Exposure**: No database passwords, service role keys, or private API tokens are embedded or required in frontend code.

---

## 10. Removed / Obsolete Architecture

The following legacy prototype concepts have been completely removed from the codebase:

- **Mock Authentication**: `mockAuthAdapter` has been removed. All authentication is performed against Supabase Auth.
- **In-Memory Sessions**: Sessions are no longer ephemeral in-memory state; persistent tokens are managed by Supabase Auth storage.
- **Preview Auth**: The authentication system is not a preview mock; it connects directly to live database tables and security policies.
- **"Supabase Added Later" Language**: Supabase Auth and database integration are fully implemented in the current codebase.
