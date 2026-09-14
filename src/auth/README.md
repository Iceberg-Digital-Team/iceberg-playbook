# Authentication UI

The login screen uses the existing hash router: /#/login and /#/forgot-password.
Direct /login and /forgot-password entry URLs are normalized to these routes.

## Preview behavior

AuthProvider uses mockAuthAdapter by default. A valid email format and a non-empty test password enter the application after a short loading state. There is no account lookup or real authentication. Passwords are not logged, transmitted, or written to browser storage. The preview session exists only in React memory and ends on refresh or sign out. Remember me is a form preference passed to the adapter; it does not persist the mock session. Password recovery explains its unavailable state without pretending to send email.

The frontend route gate is a preview of navigation behavior, not a security boundary. Existing knowledge records, authors, and Guide version snapshots are unchanged.

## Supabase integration boundary

- Replace the AuthAdapter implementation and inject it into AuthProvider.
- Initialize provider state from the real session and subscribe to auth changes; add an initializing state before rendering protected content.
- Load Profile by auth user ID. Role is Admin, Support, or Viewer; no role-based authorization is implemented here.
- Map authenticated user IDs at mutation boundaries to created_by, updated_by, and version_created_by. getAuthActor supplies an identity shape; it is intentionally not used to rewrite legacy records.
- Connect password recovery to the configured reset flow and redirect allowlist.
- Apply the intended persistence policy for Remember me using the auth provider, never by storing passwords.
- Enforce access and roles in the backend, including database policies. The frontend gate alone does not protect data.
- Keep account creation restricted to administrator-controlled processes. No public registration routes exist.

AuthLayout, LoginForm, and PasswordInput are presentation components. LoginForm displays validation, loading, and a generic inline adapter-failure error. AuthProvider accepts an alternative adapter for testing or backend integration without changing the form.
