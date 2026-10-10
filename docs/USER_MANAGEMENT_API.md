# User Management API Contract

This document defines the backend-independent contract for the Admin Panel / User Management feature
(users, roles, invitations, account activation, password reset links). It is the reference for the
current Supabase implementation (tasks B–D) and for a future Iceberg backend.

Read together with [`INFRASTRUCTURE_MIGRATION.md`](./INFRASTRUCTURE_MIGRATION.md).

---

## 1. Overview

```text
Admin UI (#/admin/users, #/activate, Admin-only "Users" sidebar link)        → portable
  → src/services/adminUserService.ts   (domain types, contract, operations) → portable
  → src/services/adminUserRules.ts     (pure rules, no backend, no clock)   → portable
  → AdminUserAdapter implementation    (Supabase today, Iceberg later)      → replaceable
  → Backend endpoints                  (Edge Functions today)               → replaceable
```

- The UI only calls the operations exported by `adminUserService.ts`. It never talks to a backend SDK.
- `adminUserService.ts` delegates every operation to the adapter set with
  `configureAdminUserService(adapter, { activationBaseUrl })`. Without an adapter, every operation fails
  with the error code `not_configured`.
- **The server is the authority.** The rules in `adminUserRules.ts` (statuses, allowed actions, admin
  safety, expiry, validation) are mirrors that give fast feedback in the UI. The server must enforce
  the same rules; task C decides whether this file can be reused.
- All dates are ISO 8601 strings. No backend-specific types appear in the domain models.
- Users are never hard-deleted. Disabling is the only way to remove access.

---

## 2. User model

`AdminUser`

| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | `string` | Stable user id (UUID in the reference backend). |
| `email` | `string` | Lowercase, unique. |
| `fullName` | `string` | Required. |
| `role` | `Role` | `'Admin' \| 'Support' \| 'Viewer'`. |
| `status` | `UserStatus` | `'Active' \| 'Disabled'`. |
| `createdAt` | `string` | ISO date. |

A disabled user cannot sign in. Their history (authorship, audit logs, version records) stays intact.

---

## 3. Invitation model

One record per link. A record is either an **invitation** (new user) or a **password reset link**
(existing active user). Both are used on the same page: `#/activate?token=…`.

`Invitation`

| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | `string` | Invitation id. |
| `purpose` | `LinkPurpose` | `'invitation' \| 'password_reset'`. |
| `email` | `string` | Lowercase. |
| `fullName` | `string` | Name entered by the Admin (invitation) or the user's name (reset). |
| `role` | `Role` | Role given on activation (invitation) or the user's role (reset). |
| `userId` | `string \| null` | Target user for `password_reset`; `null` for `invitation`. |
| `status` | `InvitationStatus` | Stored status. See §5 for the effective status. |
| `expiresAt` | `string` | ISO date. |
| `acceptedAt` | `string \| null` | Set when the link is used. |
| `revokedAt` | `string \| null` | Set when the link is revoked. |
| `invitedBy` | `string \| null` | Admin user id who created the link. |
| `createdAt` | `string` | ISO date. |

The raw token is **never** part of this model. The backend stores only a hash of it. The link is
returned once, when it is created (`CreatedLink`, §6), and can never be read again.

**Storage (reference database, `public.user_invitations`):**

| Column | Notes |
| :--- | :--- |
| `id, purpose, email, full_name, role, user_id, status, expires_at, accepted_at, revoked_at, invited_by, created_at` | Map 1:1 to the fields above. `purpose`, `full_name`, `user_id` were added to the team lead's field list for this contract (needs team lead OK). |
| `token_hash` | Lower-case hex SHA-256 of the token (64 chars), unique. Never a plaintext token. |
| `issued_at` | When the current token was issued; changes on resend. The 7-day window is measured from here. |
| `updated_at` | Last change of the row. |
| `claim_id`, `claimed_until` | Activation lease (§11): set for 60 seconds while one request sets the password; only on a `Pending` link; never returned by any API. |

- **Stored vs effective status:** the database stores only `Pending`, `Accepted`, `Revoked`.
  `Expired` is never stored; a stored `Pending` row with `expires_at <= now` is `Expired`
  (`fn_invitation_effective_status`). Admin lists return the effective status.
- **Token format:** the server creates 32 random bytes, encodes them base64url for the link, and sends
  only `lower(hex(sha256(token)))` to the database. The raw token never reaches SQL, database logs or
  audit logs.
- Email is stored lower-case and trimmed. Comparisons with existing `profiles.email` (which is not
  normalized) use `lower(btrim(...))` on both sides.

---

## 4. Roles

The contract reuses `Role` from [`src/auth/auth.ts`](../src/auth/auth.ts): `'Admin' | 'Support' | 'Viewer'`.
Permissions per role are described in `INFRASTRUCTURE_MIGRATION.md` §8. Only an **active Admin** may
call the admin operations in this document.

---

## 5. Status values

| Kind | Values |
| :--- | :--- |
| User | `Active`, `Disabled` |
| Invitation | `Pending`, `Accepted`, `Expired`, `Revoked` |
| User list row | `Active`, `Disabled`, `Pending Invite`, `Invite Expired` |

**Effective invitation status** (`getEffectiveInvitationStatus(invitation, now)`):
a stored `Pending` record whose `expiresAt <= now` is `Expired`. `Accepted` and `Revoked` are final and
never change. A record with an unreadable date counts as `Expired`.

**User list rows** (`buildUserListRows(users, invitations, now)`): every user (status `Active` or
`Disabled`) plus every `invitation`-purpose record whose effective status is `Pending`
(→ `Pending Invite`) or `Expired` (→ `Invite Expired`). Accepted and revoked invitations and all
password reset links are not shown as rows. Rows are sorted by name, then email.

**Allowed actions per row status** (`ALLOWED_ACTIONS`):

| Row status | Resend | Revoke | Disable | Enable | Change role | Create password link |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `Active` | – | – | ✓ | – | ✓ | ✓ |
| `Disabled` | – | – | – | ✓ | – | – |
| `Pending Invite` | ✓ | ✓ | – | – | – | – |
| `Invite Expired` | ✓ | – | – | – | – | – |

**Admin safety** (`checkAdminAction`), checked in this order:

1. Action not in the table above → `invalid_status`.
2. An Admin cannot disable themselves or change their own role → `self_action`.
3. The last active Admin cannot be disabled or changed to a non-Admin role → `last_admin`.
4. Changing to the role the user already has → `invalid_input`.

---

## 6. Admin operations

Exported by `src/services/adminUserService.ts`. Every operation returns a `Promise` and fails with an
`AdminUserError` (or the error the adapter throws). Client-side checks only fail fast; the server checks
everything again.

| Operation | Input | Output |
| :--- | :--- | :--- |
| `listUsers()` | – | `UserListRow[]` |
| `inviteUser(input)` | `{ email, fullName, role, expiresAt }` | `CreatedLink` |
| `resendInvitation(invitationId, expiresAt)` | id, ISO date | `CreatedLink` |
| `revokeInvitation(invitationId)` | id | `void` |
| `changeUserRole(userId, role)` | id, `Role` | `AdminUser` |
| `disableUser(userId)` | id | `AdminUser` |
| `enableUser(userId)` | id | `AdminUser` |
| `createPasswordResetLink(userId, expiresAt)` | id, ISO date | `CreatedLink` |
| `getInvitation(token)` | raw token | `ActivationLinkInfo` |
| `activateAccount({ token, password })` | raw token, password | `ActivationResult` |

`CreatedLink` — returned only at creation time:

```ts
{
  invitationId: string;
  purpose: 'invitation' | 'password_reset';
  email: string;
  expiresAt: string;
  delivery: 'manual' | 'email';
  activationUrl: string | null; // set for 'manual'; null when the backend delivered the link itself
}
```

Today `delivery` is always `'manual'`: the Admin sees the link with a **Copy** button and sends it
themselves. When email delivery is added later, the backend returns `delivery: 'email'` and no token,
and the UI shows "sent" instead of the link — no contract or UI structure change is needed.

`ActivationLinkInfo` — only what the activation page needs, no ids:
`{ purpose, status: 'Pending', email, fullName, role, expiresAt }`.

`ActivationResult` — `{ purpose, email }`. Never contains a password or a token.

### Error codes

`AdminUserError` has `code`, `message` (clear English) and an optional `suggestion`.
Adapters map backend errors to these codes.

| Code | Default message | When |
| :--- | :--- | :--- |
| `unauthenticated` | Your session has ended. Please sign in again. | No valid session. |
| `forbidden` | Permission denied. Only active Admins can manage users. | Caller is not an active Admin. |
| `not_found` | The user or invitation was not found. | Unknown id. |
| `invalid_input` | Some of the entered values are not valid. | Validation failed (email, name, role, expiry, password, id). |
| `invalid_status` | This action is not allowed for the current status. | Action not in the allowed-actions table. |
| `email_in_use` | This email already has an account. | Invite for an existing user's email. |
| `invitation_exists` | This email already has an open invitation. Resend it instead. | Invite for an email with a `Pending` or `Expired` invitation. |
| `last_admin` | The last active Admin cannot be disabled or demoted. | §5 rule 3. |
| `self_action` | You cannot disable your own account or change your own role. | §5 rule 2. |
| `token_invalid` | This link is not valid. Ask your Admin for a new link. | Unknown, empty or malformed token. |
| `token_expired` | This link has expired. Ask your Admin for a new link. | Effective status `Expired`. |
| `token_used` | This link has already been used. … | Status `Accepted`. |
| `token_revoked` | This link has been revoked. Ask your Admin for a new link. | Status `Revoked`. |
| `rate_limited` | Too many attempts. Please wait a few minutes and try again. | Lookup / activate over the rate limit (§9). |
| `link_busy` | This link is being used right now. Please try again in a moment. | Another activation request holds the link lease (§11). |
| `not_configured` | User management is not configured. | No adapter or base URL configured. |
| `network` | Could not reach the server. … | Transport failure. |
| `unknown` | Something went wrong. Please try again. | Anything else. |

Suggestions (`AdminSuggestion`), used with `email_in_use` / `invitation_exists`:

| Situation | Code | Suggestion |
| :--- | :--- | :--- |
| Email belongs to an **Active** user | `email_in_use` | `{ action: 'create_password_link', userId }` — "Create password link instead" |
| Email belongs to a **Disabled** user | `email_in_use` | `{ action: 'enable_user', userId }` — "Enable user" (no password link) |
| Email has a `Pending` or `Expired` invitation | `invitation_exists` | `{ action: 'resend_invitation', invitationId }` — "Resend" |

---

## 7. Invitation lifecycle

1. **Create** — An Admin enters email, **name (required)** and role, and picks an expiry:
   24 hours (default), 3 days, 7 days, or a calendar date. A picked date means the **end of that day
   in the Admin's local time**, capped at 7 days from now. The expiry must be in the future and at most
   **7 days** ahead (the server allows 5 minutes of clock difference).
   Email is trimmed and lowercased. Conflicts return `email_in_use` or `invitation_exists` (§6).
2. **Show link** — No email is sent. The response contains the link once; the Admin copies it and
   sends it themselves.
3. **Resend** — Allowed for `Pending Invite` and `Invite Expired`. The same invitation record gets a
   **new token** and a new expiry. The old token stops working at once. The old link cannot be shown
   again because only its hash is stored.
4. **Revoke** — Allowed for `Pending Invite`. Sets status `Revoked`. Final.
5. **Expire** — A `Pending` record past `expiresAt` is `Expired` (computed, no job needed).
6. **Accept** — Activation (§8) sets status `Accepted` and `acceptedAt`, and creates the user. Final.

---

## 8. Activation lifecycle

1. The user opens `#/activate?token=<token>`. The page reads the token with `readActivationToken`
   (trimmed; missing or empty → "invalid link", no backend call).
2. The page calls `getInvitation(token)`. The backend resolves email, name, role, purpose, status and
   expiry **from the token only**. Only a usable link returns data; an expired, used, revoked or unknown
   link returns `token_expired`, `token_used`, `token_revoked` or `token_invalid`, with no personal data.
3. The user enters a password and its confirmation. Rules: at least **8 characters** (minimum), at most
   **72 bytes** in UTF-8 (bcrypt limit), not only spaces, not trimmed, confirmation must match exactly.
   The identity provider may add its own checks (in Supabase: leaked-password protection, which stays
   **on**). A password it rejects returns `invalid_input` and the link **stays usable**: the user simply
   chooses another password.
4. The page calls `activateAccount({ token, password })`. The backend checks the token again,
   sets the password, marks the link `Accepted` (single use) and, for an invitation, creates the active
   user with the invited name and role. A link is used up only when the password was accepted.
5. On success the page clears the password from state and goes to `#/login`. There is **no automatic
   sign-in**; the user signs in with the new password.

### Password reset link

- An Admin can create a new password link for an **Active** user (forgot password):
  `createPasswordResetLink(userId, expiresAt)`. Same expiry choices and limit, same `#/activate` page,
  single use.
- Creating a new reset link **revokes that user's older unused reset links**.
- Disabling a user revokes their open reset links. A disabled user cannot get a new one.
- Activation with a reset link changes the password only; role and status do not change.

---

## 9. Required backend endpoints

All admin endpoints require a valid session of an **active Admin**, checked on the server for every
call. All bodies are JSON. Errors return `{ "error": { "code": "<AdminUserErrorCode>", "message": "…", "suggestion": { … } | null } }`
with a matching HTTP status (400 `invalid_input`, 401 `unauthenticated`, 403 `forbidden`,
404 `not_found`, 409 `email_in_use` / `invitation_exists` / `invalid_status` / `last_admin` / `self_action` /
`link_busy`, 410 `token_expired` / `token_used` / `token_revoked`, 400 `token_invalid`, 429 `rate_limited`
with a `Retry-After` header in seconds).

| Method & path | Caller | Request | Response | Errors |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/admin/users` | Admin | – | `{ users: AdminUser[], invitations: Invitation[] }` | `unauthenticated`, `forbidden` |
| `POST /api/admin/invitations` | Admin | `{ email, fullName, role, expiresAt }` | `IssuedLink` | `invalid_input`, `email_in_use`, `invitation_exists`, `forbidden` |
| `POST /api/admin/invitations/:id/resend` | Admin | `{ expiresAt }` | `IssuedLink` | `not_found`, `invalid_status`, `invalid_input`, `forbidden` |
| `DELETE /api/admin/invitations/:id` | Admin | – | `204` (sets `Revoked`, no row deleted) | `not_found`, `invalid_status`, `forbidden` |
| `PATCH /api/admin/users/:id/role` | Admin | `{ role }` | `AdminUser` | `not_found`, `invalid_input`, `invalid_status`, `self_action`, `last_admin`, `forbidden` |
| `POST /api/admin/users/:id/disable` | Admin | – | `AdminUser` | `not_found`, `invalid_status`, `self_action`, `last_admin`, `forbidden` |
| `POST /api/admin/users/:id/enable` | Admin | – | `AdminUser` | `not_found`, `invalid_status`, `forbidden` |
| `POST /api/admin/users/:id/password-links` | Admin | `{ expiresAt }` | `IssuedLink` | `not_found`, `invalid_status`, `invalid_input`, `forbidden` |
| `POST /api/auth/invitations/lookup` | Anyone with the token | `{ token }` | `ActivationLinkInfo` | `token_invalid`, `token_expired`, `token_used`, `token_revoked`, `rate_limited` |
| `POST /api/auth/activate` | Anyone with the token | `{ token, password }` | `ActivationResult` | `token_*`, `invalid_input`, `email_in_use`, `link_busy`, `rate_limited` |

`IssuedLink` = `{ invitationId, purpose, email, expiresAt, delivery, token }`. The raw `token` appears
**only** in this creation response (and is `null` when `delivery` is `'email'`). The frontend service turns
it into `activationUrl` and never exposes the token separately.

**Token lookup uses POST instead of `GET /api/auth/invitations/:token`** (provisional, see §13).
A token in a URL path ends up in server access logs, proxy and CDN logs, and monitoring tools. In a
POST body it does not. The `#/activate?token=` part of the page URL is a hash fragment, which browsers
never send to the server, so it stays out of server logs too.

### Supabase Edge Function URLs (reference implementation, task C)

| Logical path (above) | Edge Function URL |
| :--- | :--- |
| `/api/admin/<rest>` | `https://<project>.supabase.co/functions/v1/admin-users/<rest>` |
| `/api/auth/<rest>` | `https://<project>.supabase.co/functions/v1/auth-links/<rest>` |

- **`admin-users`** — requires `Authorization: Bearer <user access token>`. Before **any** admin RPC the
  function verifies the caller itself (safe with or without the platform `verify_jwt` check):
  1. missing / malformed header → 401 `unauthenticated` (no further call);
  2. `auth.getUser(jwt)` with the secret key: the Auth server checks the signature (legacy and new
     signing keys), the expiry, that the user exists and that the session was not signed out. Rejected →
     401 `unauthenticated`; Auth server unreachable → 500 `unknown`;
  3. `fn_admin_current_caller()` with the caller's JWT returns the caller's id only for an **active
     Admin**: not an active Admin → 403 `forbidden`; an id that differs from step 2 → 401.
  Then the header is forwarded to the database with the publishable key, so every `fn_admin_*` function
  checks `auth.uid()` again (second lock). No user id is taken from the body. Success statuses: `201` for
  created links (`POST /invitations`, `POST /users/:id/password-links`), `204` for revoke, `200` otherwise.
- **`auth-links`** — public (deployed with `--no-verify-jwt`), authorized only by the link token, and it
  protects itself: token format check (no database call for a wrong format), rate limits (below), and
  expiry / single use / revocation in the database functions (§11). Uses the secret key for the
  server-only database functions and Supabase Auth admin calls.
- **Rate limits (`auth-links`)**, counted in the database (`fn_rate_limit_hit`, migration 12) because
  Edge Function instances share no memory. Fixed windows:
  - lookup: at most **20 requests per client IP per 10 minutes**;
  - activate: at most **10 requests per client IP per 10 minutes**;
  - per token: at most **10 requests per hour** (lookup and activate counted together).
  Over a limit → 429 `rate_limited` + `Retry-After`, no other work, log line `rate_limited step=<kind>`.
  If the counter cannot be reached → 500 `unknown` (fails closed). A malformed request (bad token format,
  password that breaks §8) is rejected before the counter. Keys are `HMAC-SHA-256(secret key,
  "<kind>:<value>")`; no raw IP address and no token hash is stored. Counter rows older than 1 day are
  deleted by the same function (at most 100 rows per call); they are not user data. A burst of up to twice
  a limit is possible across a window boundary.
- **Client IP** for the rate limit: `cf-connecting-ip` (set by Cloudflare in front of Supabase; a value sent
  by the client is rejected), otherwise the **right-most** `X-Forwarded-For` entry (added by the platform
  proxy). The left-most `X-Forwarded-For` value is never used because a client can forge it. Without both
  headers all requests share one bucket (log `client_ip_missing`). This header behavior is not documented
  by Supabase: confirm it at deploy time (§14 checklist).
- **Tokens**: 32 random bytes (Web Crypto), base64url in the link (43 characters). Only the lower-case hex
  SHA-256 is sent to SQL. An incoming token is trimmed; a wrong format → 400 `token_invalid` without a
  database call.
- **Input checks before any database call**: JSON object body of at most 16 KB, ids are UUIDs, `role`
  is a `Role`, `expiresAt` is a date, the password follows §8 → otherwise 400 `invalid_input`.
- **Routing**: unknown path → 404 `not_found`; known path with another method → 405 (code
  `invalid_input`) with an `Allow` header; `OPTIONS` → 204 preflight.
- **Errors**: `{ "error": { "code", "message", "suggestion" } }`, statuses as above, plus 500 `unknown`
  for anything unexpected (generic message). Logs contain only the event, the database function name and
  the SQLSTATE — never tokens, hashes, passwords, emails, keys or request bodies.
- **CORS**: env `ALLOWED_ORIGINS` (comma-separated origins). A request with an allowed `Origin` gets that
  origin echoed in `Access-Control-Allow-Origin` (+ `Vary: Origin`). Allowed headers: every header the
  Supabase SDK can send (`authorization, x-client-info, apikey, content-type, x-retry-count, traceparent,
  tracestate, baggage`, the list of `@supabase/supabase-js/cors`) plus `x-region`; a test fails if a new
  SDK version adds a header that is not allowed. Never `*`, never
  `Access-Control-Allow-Credentials` (Bearer header, no cookies). A request with any other `Origin` → 403
  `forbidden`. **`ALLOWED_ORIGINS` missing or empty → fail closed**: every request with an `Origin` gets
  403 and a log line `cors_not_configured`. Requests without `Origin` (server to server) are processed.
- Code: `supabase/functions/admin-users/`, `supabase/functions/auth-links/`, shared code in
  `supabase/functions/_shared/`. Each function has a thin Deno `index.ts` and a pure `handler.ts`
  (tested in Node with fakes).

---

## 10. Security rules

- **Tokens**: cryptographically random, at least 32 bytes, URL-safe encoding (base64url or hex).
  Stored only as a hash (e.g. SHA-256). Single-use, expiring, revocable. Never logged.
- **URL**: carries only the token: `#/activate?token=…`. Never email, role, user id or name.
- **Resolution**: the backend resolves email, role, status, purpose and expiry from the token.
  Values sent by the client for these are ignored.
- **Authorization**: every admin operation checks on the server that the caller is an active Admin.
  Frontend checks (sidebar link, route guard, disabled buttons) are UX only.
- **Admin safety**: an Admin cannot disable themselves or change their own role. The last active Admin
  cannot be disabled or demoted. Checks must be race-safe (e.g. row lock or transaction).
- **Disabled users** cannot sign in and cannot use or receive links. Their history stays intact.
- **No hard delete** of users anywhere.
- **Secrets**: passwords and tokens never in `localStorage`, `sessionStorage`, URLs (except the token in
  `#/activate?token=`), console output, logs, error messages, or plaintext in the database. The UI
  clears the password from state after submit.
- **Privileged keys** (e.g. Supabase `service_role`) live only in server-side code.
- **Rate limiting** (required): limit lookup and activate calls per client IP and per token, inside the
  endpoint (reference implementation: §9).
- **Rejected passwords never use up a link**: the link is single use only for an accepted password
  (reference implementation: the activation lease in §11).

---

## 11. Current Supabase reference implementation

> Status: migrations 11, 12 and 13 and the Edge Functions are **written (tasks B, C, F) but not deployed**
> (`Mode: PROPOSED`). Supabase-specific lines in the SQL are marked `[SUPABASE]`. Deployment steps: §14.
> Migration **10 is the team lead's `10_restore_playbook.sql`** and must run before ours (task F renumbered
> ours from 10–12 to 11–13).

| Part | Task | Content |
| :--- | :--- | :--- |
| `supabase/migrations/11_user_management.sql` | B, F | Data model: `profiles.status` (`Active` / `Disabled`, default `Active`, backfills existing rows), table `user_invitations` (§3) with the activation lease columns `claim_id` / `claimed_until`, CHECK constraints, partial unique indexes (one open invitation per email, one open reset link per user, one link per lease id), `fn_invitation_effective_status`. |
| `supabase/migrations/12_user_invitation_security.sql` | B, F | Security: RLS on `user_invitations` with no policies, privileges, triggers, the functions below, the rate limit table and function, and the changes to existing behavior listed in §13. |
| `supabase/tests/user_management_tests.sql` | B, F | 22 database tests in `BEGIN … ROLLBACK`. |
| `supabase/migrations/13_auth_user_lookup.sql` | C | `fn_find_auth_user_by_email(email)` → `(user_id, has_profile)`, server only, used during activation. Tests: `supabase/tests/auth_user_lookup_tests.sql`. |
| `supabase/functions/admin-users`, `supabase/functions/auth-links` | C (written) | Edge Functions for §9 (URLs and behavior in §9). They hash tokens, call the database functions below, create / update auth users, and are the only place that uses the secret key and `auth.admin`. Business rules are enforced by the database; the password rule is mirrored in `supabase/functions/_shared/rules.ts` (a test keeps it identical to `adminUserRules.ts`). |
| `src/services/admin/supabaseAdminUserAdapter.ts` | D (written) | Implements `AdminUserAdapter` by calling only the two Edge Functions (details below). Wired once in `src/main.tsx`. |

### Adapter (`src/services/admin/supabaseAdminUserAdapter.ts`)

- `createSupabaseAdminUserAdapter(client = supabase)` returns the `AdminUserAdapter`;
  `supabaseAdminUserAdapter` is the default instance. It uses only `client.auth.getSession()` and
  `client.functions.invoke(...)` — never `from`, `rpc`, `auth.admin` or `storage`.
- Calls: `invoke('<function>/<path>', { method, body })` with exactly the methods, paths and bodies of
  §9 (e.g. `invoke('admin-users/users/<id>/disable', { method: 'POST' })`,
  `invoke('auth-links/invitations/lookup', { method: 'POST', body: { token } })`). Ids are URL-encoded;
  the token is only ever in a POST body.
- Session: supabase-js attaches `Authorization: Bearer <session JWT>` to `functions.invoke` when a user is
  signed in. Before every `admin-users` call the adapter checks `auth.getSession()`; no session →
  `AdminUserError('unauthenticated')` without a network call. `auth-links` calls need no session.
- Error mapping: HTTP error with body `{ error: { code, message, suggestion } }` → same code (only contract
  codes; others → `unknown`), the message (empty → contract default) and the suggestion (only valid
  shapes; others → `null`). Other HTTP error bodies → `unauthenticated` for 401 (e.g. gateway "Invalid
  JWT"), else `unknown`. Network failure → `network`. Relay error or unreadable response → `unknown`.
- Responses are checked with small guards (roles, statuses, purposes, delivery, strings); a wrong shape →
  `unknown`. Only contract fields are returned. The `IssuedLink.token` goes to the service, which builds
  `activationUrl`; the adapter never logs or stores anything.
- Wiring (`src/main.tsx`): `configureAdminUserService(supabaseAdminUserAdapter, { activationBaseUrl:
  window.location.origin + window.location.pathname })`. Links point to the address the app is opened
  from: links created in local development point to `localhost` and are only for testing; create real
  links from the deployed app.

### Database functions

All are `SECURITY DEFINER` with `SET search_path = ''` and explicit `REVOKE` / `GRANT`.

| Function | Contract operation | Caller |
| :--- | :--- | :--- |
| `fn_admin_current_caller()` | caller check of `admin-users` (returns `{ user_id }` of an active Admin) | Admin's own JWT |
| `fn_admin_list_users()` | `listUsers` | Admin's own JWT (`authenticated`) |
| `fn_admin_create_invitation(email, full_name, role, expires_at, token_hash)` | `inviteUser` | Admin's own JWT |
| `fn_admin_resend_invitation(invitation_id, expires_at, token_hash)` | `resendInvitation` | Admin's own JWT |
| `fn_admin_revoke_invitation(invitation_id)` | `revokeInvitation` | Admin's own JWT |
| `fn_admin_change_user_role(user_id, role)` | `changeUserRole` | Admin's own JWT |
| `fn_admin_disable_user(user_id)` | `disableUser` (also revokes open reset links) | Admin's own JWT |
| `fn_admin_enable_user(user_id)` | `enableUser` | Admin's own JWT |
| `fn_admin_create_password_reset_link(user_id, expires_at, token_hash)` | `createPasswordResetLink` (revokes older open ones) | Admin's own JWT |
| `fn_get_activation_link(token_hash)` | `getInvitation` | server only (`service_role`) |
| `fn_claim_activation_link(token_hash)` | `activateAccount` step 1: 60 second lease → `{ claim_id, purpose, email, user_id }` | server only |
| `fn_release_activation_link(claim_id)` | `activateAccount` on failure: ends the lease, link stays `Pending` | server only |
| `fn_accept_invitation(claim_id, auth_user_id)` | `activateAccount` (invitation) step 3 | server only |
| `fn_accept_password_reset(claim_id)` | `activateAccount` (password reset) step 3 | server only |
| `fn_find_auth_user_by_email(email)` (migration 13) | activation helper: `(user_id, has_profile)` | server only |
| `fn_rate_limit_hit(key_hash, limit, window_seconds)` | rate limit counter for `auth-links` (§9) | server only |

Every `fn_admin_*` function checks that `auth.uid()` is an **active Admin**. Every admin action writes
`public.audit_logs` (`entity_type` `user` or `invitation`) without token, hash or password.

**Triggers** protect the rules on every write path, not only through the functions:
`trg_profiles_guard_role_status` (role / status change only through the functions; no self action;
last active Admin, race-safe with an advisory lock), `trg_user_invitations_guard` (Accepted / Revoked
are final; link target fields never change), `trg_user_invitations_no_delete` (no hard delete).

**Error convention:** `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<AdminUserErrorCode>',
DETAIL = '<English text>', HINT = '<suggestion JSON>'`. The Edge Function maps `MESSAGE` 1:1 to
`AdminUserError.code`, `DETAIL` to the message and `HINT` to `suggestion`. Any other SQLSTATE → `unknown`.

### Activation order (`auth-links`, `POST /activate`)

Before any database call: the token format and the password rules (§8) are checked. Then the rate limits
(§9). Then the **activation lease** keeps the link single use without letting a rejected password use it up:

- `fn_claim_activation_link(hash)` locks the link (`FOR UPDATE`), checks it is usable (`token_*`
  otherwise; a reset link of a non-Active user → `token_revoked`) and gives this request a **60 second
  lease** (`claim_id`, `claimed_until`). While the lease is active, any other request gets 409
  `link_busy` and **touches no password**.
- Only the lease holder sets a password in Supabase Auth, then calls `fn_accept_*` with its `claim_id`
  (a lost lease → `link_busy`). Accept clears the lease and marks the link `Accepted`.
- **On any failure after the claim, the lease is released** (`fn_release_activation_link`) and the link
  stays `Pending`, so the user can try again at once. If the release itself fails (logged
  `release_failed`), the lease ends by itself after 60 seconds.
- Revoke, resend, disabling the user and a newer reset link also end an active lease.

**Invitation – new user**
1. Claim (`token_*` / `link_busy` → stop).
2. `fn_find_auth_user_by_email(email)` (`lower(btrim(...))` on both sides): account **with** a profile →
   409 `email_in_use`, its password is never changed.
3. No account → `auth.admin.createUser({ email, password, email_confirm: true })`.
   - Weak / leaked password → 400 `invalid_input` "This password does not meet the password policy.
     Choose a stronger password." The **link is not used**.
   - "email already exists" → look up again → orphan path below (or `email_in_use`).
   - Other error → 500 `unknown`.
4. `fn_accept_invitation(claim_id, new_id)`: one transaction: re-check the link, check the auth email
   matches, create the `Active` profile with the invited name and role, mark the link `Accepted`, write
   audit. If it fails, nothing is saved; an auth user without a profile cannot use the app and is reused
   on retry. Nothing is deleted (`auth.admin.deleteUser` is never used).

**Invitation – orphan reuse** (auth account **without** a profile, left over from an earlier failed try)
1. Claim. 2. `auth.admin.updateUserById(id, { password, email_confirm: true })`: weak → 400 (link not
used); other failure → 500 "Your password could not be saved. Please try again." 3. `fn_accept_invitation(claim_id, id)`.

**Password reset**
1. Claim (the user must be Active). 2. `auth.admin.updateUserById(user_id, { password })`: weak → 400
(link not used); other failure → 500 "Your password could not be saved. Please try again."
3. `fn_accept_password_reset(claim_id)`. If this fails after the password was saved (e.g. the user was
disabled during the lease), the error is returned and logged (`accept_after_password_failed`); an
unexpected failure says "Your new password may already work, but the link could not be closed. …".
`user_id` and `claim_id` are never returned to the browser.

**Concurrency:** only the lease holder touches a password for a link, so the final password belongs to
the request that reported success.

**Auth call timeout:** every Supabase Auth admin call (`createUser`, `updateUserById`) is aborted after
**20 seconds** (`AUTH_CALL_TIMEOUT_MS`; the secret client's `fetch` uses `AbortSignal.timeout`, and the
handler also stops waiting). This is well below the 60 second lease. On a timeout the lease is **kept, not
released**, because the write may still land in Supabase Auth; it ends by itself after 60 seconds, so a
late write has at least 40 seconds to land before anyone can claim the link again. Response: 500
`unknown` "Your password could not be saved. Please wait a minute and try again." A retry within that
minute gets `link_busy`; a later retry simply sets the password again. Log: `auth_call_timeout`.

### Disable / enable (`admin-users`)

1. `fn_admin_disable_user` / `fn_admin_enable_user` with the caller's JWT.
2. Then Supabase Auth: `auth.admin.updateUserById(id, { ban_duration: '876000h' })` (disable) or
   `{ ban_duration: 'none' }` (enable). A ban blocks new sign-ins and refresh-token renewals.
3. If step 2 fails, step 1 is rolled back with the opposite function (caller's JWT) and the response is
   500 `unknown`: "Could not block sign-in. The user was not disabled. Try again." (or "Could not allow
   sign-in. The user is still disabled. Try again."). If the rollback also fails: "The user is disabled
   in the app, but sign-in could not be blocked. Contact the system owner." (or the enable variant).
   Never a silent success. Audit logs show both steps.
4. Sessions: Supabase has no admin "sign out user X". An access token already issued stays valid until it
   expires (default 1 hour), but migration 12 makes RLS deny a Disabled user everything.

---

## 12. Iceberg migration notes

Same approach as `INFRASTRUCTURE_MIGRATION.md` §5–§8:

1. **Replace only the adapter.** Create e.g. `src/services/admin/icebergAdminUserAdapter.ts`
   implementing `AdminUserAdapter` with HTTP calls to the endpoints in §9, and pass it to
   `configureAdminUserService` in `src/main.tsx` instead of `supabaseAdminUserAdapter` (one line).
   `adminUserService.ts`, `adminUserRules.ts`, the pages and the router stay unchanged. The Supabase
   adapter is the only frontend file that knows Edge Function names and paths.
2. **Move business rules to the backend.** The Iceberg API must enforce: effective invitation status,
   the allowed-actions table, self-action and last-Admin protection, expiry limits (max 7 days),
   invite validation and conflicts, password rules, single-use hashed tokens, revoking older reset links,
   revoking links of disabled users, blocking sign-in for disabled users, rate limiting of the public
   link endpoints, and "a rejected password never uses up a link" (e.g. with a short lease as in §11).
3. **Middleware authorization.** Every `/api/admin/*` endpoint must validate the identity token and
   require an active `Admin` before reaching the database, the same way RLS and Edge Function checks
   do today. `/api/auth/invitations/lookup` and `/api/auth/activate` are public but authorized by the
   token itself.
4. **Identity provider.** If Iceberg SSO creates users itself, the activation step may set no password;
   the contract allows this by keeping `activateAccount` and `ActivationResult` free of auth details.
5. **Email delivery** can be added on the server by returning `delivery: 'email'` without a token.
6. **Replacement map row** to add to `INFRASTRUCTURE_MIGRATION.md` §4 (by the team lead):
   `src/services/admin/supabaseAdminUserAdapter.ts` → `icebergAdminUserAdapter.ts` calling the §9 endpoints.

---

## 13. Decisions and open questions

Agreed with the team lead (CLAUDE.md §9):

- **No email sending.** The Admin sees the link with a **Copy** button and sends it. The contract allows
  email delivery later (`delivery`, nullable `activationUrl`).
- **Link expiry**: default 24 hours; choices 24 hours / 3 days / 7 days / pick a date.
- **Password reset link**: Admin creates it for an active user; same `#/activate` page and expiry choice;
  single use; a new link revokes that user's older unused links.

**Provisional — waiting for team lead approval:**

- **Name is required** in the invite form (`profiles.full_name` is NOT NULL; the list has a Name column).
- **Expiry upper limit is 7 days.**
- **Conflict behavior**: `email_in_use` with a suggestion (Active → "Create password link instead",
  Disabled → "Enable user"), and `invitation_exists` with a "Resend" suggestion.
- **Token lookup via `POST /api/auth/invitations/lookup`** with `{ token }` in the body, instead of the
  team lead's `GET /api/auth/invitations/:token` (reason in §9).

Other decisions in this contract:

- An Admin cannot change their own role.
- After activation: go to `#/login`, no automatic sign-in.
- Resend keeps the invitation id and issues a new token.
- A picked expiry date means the end of that local day, capped at 7 days.
- Password: at least 8 characters (minimum), at most 72 bytes (maximum). Supabase Auth leaked-password
  protection stays **on** where available (task F).
- Rate limits for the public link endpoints (task F): at most 20 lookups and at most 10 activations per
  client IP per 10 minutes, at most 10 attempts per token per hour.
- Activation lease (task F): 60 seconds; Supabase Auth calls time out after 20 seconds.

Database decisions (task B):

- Role and status can change only through the admin functions (trigger), never by a direct API update.
- Admin functions are called with the Admin's own JWT; link lookup / accept only by the server.
- Statuses are stored as TEXT + CHECK (same strings as the contract); `Expired` is computed, never stored.
- Token hash: SHA-256, 64 lower-case hex chars; hashing happens on the server.
- Activation retry reuses only an auth user with the same email and **no** profile; nothing is deleted.

**Changes to existing behavior (migration 12) — needs team lead approval:**

- Policy `profiles_delete_admin_only` (migration 04) is dropped and `DELETE` on `profiles` is revoked
  from `anon` / `authenticated`: no hard delete of users through the API.
- `fn_user_role()` (04) returns no role for a `Disabled` user, so `fn_is_admin()` and
  `fn_is_support_or_admin()` deny a disabled user with a session that has not expired yet.
- `fn_get_current_actor()` (03) resolves a `Disabled` user to `Viewer`.
- New trigger on `profiles`: `role` / `status` cannot be changed by a direct API update.
  Name / avatar updates are unchanged.
- `user_invitations.user_id` / `invited_by` use `ON DELETE RESTRICT`: deleting a user who created
  links or has a reset link fails (history is kept).
- Policy `profiles_insert_admin_only` (04) is dropped and `INSERT` on `profiles` is revoked from `anon` /
  `authenticated` (task F, requested by the team lead): profiles are created **only** by
  `fn_accept_invitation` (invitation flow, audited). The frontend never inserted profiles.
- `fn_accept_invitation` / `fn_accept_password_reset` take the lease id (`claim_id`) instead of the token
  hash; new functions `fn_claim_activation_link`, `fn_release_activation_link` (task F).
- The public link endpoints return 429 `rate_limited` over the limits and 409 `link_busy` while another
  request holds the link lease (task F).
- `admin-users` calls Supabase Auth `getUser` and `fn_admin_current_caller` before every operation (one
  extra round trip each, task F).

Open:

- Invitation fields `full_name`, `purpose`, `user_id` were added to the team lead's field list — needs
  team lead OK.
- ~~Policy `profiles_insert_admin_only` (04) lets an Admin insert a profile directly.~~ Closed in task F
  (see the list above).
- ~~Task C: concurrent activation requests could reset the password of a just-created auth user.~~
  Handled by the activation lease (§11): only the lease holder touches a password.
- ~~Task C: on disable, also block sign-in in the auth service.~~ Handled in task C with a Supabase Auth
  ban + rollback on failure (§11). Already issued access tokens stay valid until they expire (≤ 1 hour);
  RLS denies them.
- ~~Rate limiting for `/invitations/lookup` and `/activate`.~~ Implemented in task F inside `auth-links`
  (§9).
- ~~A password rejected by Supabase Auth (stricter policy or leaked-password protection) could use up a
  reset link or a reused account's invitation.~~ Handled in task F by the activation lease (§11): a
  rejected password releases the lease and the link stays usable.
- ~~An Auth call slower than the lease could let a second request claim the link.~~ Handled in task F:
  every Auth admin call is aborted after 20 seconds and the lease is kept (not released) after a timeout
  (§11). **Remaining (residual):** if Supabase still applies an aborted write more than 60 seconds later,
  that write could replace a password set by a later attempt. Not expected in practice; listed for
  completeness.
- The client IP header used for the rate limit (`cf-connecting-ip`, then the right-most
  `X-Forwarded-For`) is not documented by Supabase; confirm it on the real project (§14 checklist).
- Who deploys migrations and Edge Functions (§14). The migrations and SQL tests have not been run
  against a database yet.
- The frontend adapter (task D) is tested only with fakes; it has not been run against deployed Edge
  Functions yet.

---

## 14. Deployment (team lead)

> Commands are documented only. Nothing was deployed or run in tasks A–F.

### Order

1. Apply migrations 01–09, then the team lead's `10_restore_playbook.sql`, then ours:
   `11_user_management.sql` → `12_user_invitation_security.sql` → `13_auth_user_lookup.sql`.
   Then run the SQL tests in a test project:
   `supabase/tests/verification_tests.sql`, `supabase/tests/user_management_tests.sql`,
   `supabase/tests/auth_user_lookup_tests.sql` (all `BEGIN … ROLLBACK`).
2. Type-check the functions (needs Deno):
   ```bash
   deno check supabase/functions/admin-users/index.ts supabase/functions/auth-links/index.ts
   ```
3. Set the allowed browser origins (comma-separated). **Missing or empty = every browser request is
   blocked (403).**
   ```bash
   supabase secrets set ALLOWED_ORIGINS=https://playbook.example.com,http://localhost:5173
   ```
4. Deploy:
   ```bash
   supabase functions deploy admin-users
   supabase functions deploy auth-links --no-verify-jwt
   ```
   `verify_jwt` is set by these deploy flags only (there is no `supabase/config.toml`).

### API keys

- The functions read the **new Supabase API keys** first: `SUPABASE_PUBLISHABLE_KEYS` and
  `SUPABASE_SECRET_KEYS` (JSON dictionaries `{"<name>": "<key>"}` provided by the platform). The key name
  comes from the optional secrets `SUPABASE_PUBLISHABLE_KEY_NAME` / `SUPABASE_SECRET_KEY_NAME`
  (default `default`).
- Fallback: the legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`.
- `admin-users` needs both keys, `auth-links` needs the secret key, both need `SUPABASE_URL`. If a key is
  missing, every request returns 500 `unknown` before any database or auth call, with the log line
  `config_missing` (key values are never logged).
- Never put the secret key in a `VITE_` variable or in the frontend.

### JWT gateway

`admin-users` may be deployed **with or without** `--no-verify-jwt` (with the new JWT signing keys the
platform check may need to be off). It is safe either way: before any admin RPC the function itself
validates the Bearer JWT with Supabase Auth (`auth.getUser`) and checks that the caller is an active Admin
(`fn_admin_current_caller`); then every admin RPC runs with the caller's JWT and the database checks
`auth.uid()` and the active Admin role again (§9). `auth-links` is deployed with `--no-verify-jwt` and
protects itself (token checks, rate limits, lease; §9, §11).

### Checklist

- [ ] Migrations 01–09, 10 (team lead), 11, 12, 13 applied; the three SQL test files pass.
- [ ] `ALLOWED_ORIGINS` set to the app origin(s).
- [ ] Both functions deployed (`auth-links` with `--no-verify-jwt`; `admin-users` with or without it).
- [ ] **Supabase Auth → public sign-ups disabled.** The app has no sign-up screen; this protects the
      activation path that reuses an auth account without a profile.
- [ ] **Supabase Auth → leaked password protection: keep it ON** where the plan offers it. The app rule is
      a minimum of 8 characters; a stricter Supabase policy is allowed. A password Supabase rejects returns
      400 `invalid_input` and the link stays usable (activation lease, §11).
- [ ] **Client IP header check** (rate limit, §9): send 21 lookups with an invalid-but-well-formed token,
      each with a different forged `X-Forwarded-For` and `CF-Connecting-IP` value. The 21st must get 429.
      If it does not, the platform passes the forged value through: stop and report it.
- [ ] Manual check: invite → copy link → activate → sign in; disable → sign-in blocked; enable → allowed;
      a password Supabase rejects keeps the link usable.

### Rollback

- Functions: redeploy the previous version of the function, or `supabase functions delete <name>` to
  remove it. Data is not affected.
- Migrations are not rolled back automatically. To undo them, write a new migration reviewed by the team
  lead; never drop tables with user history.

---

## 15. User interface (task E)

The UI uses only `adminUserService.ts`, `adminUserRules.ts`, `src/auth/*` and existing UI components —
never Supabase and never `src/services/admin/*`. Decision logic lives in pure, tested files:
`src/appAccess.ts`, `src/pages/adminUsersView.ts`, `src/pages/activateAccountState.ts`.

### Navigation

- Routes (`src/router.ts`): `#/admin/users` and `#/activate?token=…` (`params.token`).
- `decideEntry(path, signedIn)` (`src/appAccess.ts`): `#/activate` renders for signed-in and signed-out
  users (outside the workspace shell, in `AuthLayout`); other pages need a session; signed-in users leave
  `#/login` / `#/forgot-password`.
- Sidebar: a **Users** link (`Users` icon) only when `profile.role === 'Admin'`. A non-Admin who opens
  `#/admin/users` sees "You do not have access to this page." and no service call is made. This is UX
  only; the server checks every operation.

### `#/admin/users`

- Header **Invite user**; table Name / Email / Role / Status / Expires / Actions. Status is a text badge
  (Active, Disabled, Pending Invite, Invite Expired) with a border style, not color only. Up to 1100 px
  each row becomes a card with the column names shown. Loading, empty and error (with **Try again**)
  states.
- Row actions come from `getRowActions` (§5). Blocked actions are shown disabled with the reason
  ("You cannot disable your own account.", "You cannot change your own role.", "This is the last active
  Admin.").
- Dialogs are native `<dialog className="guide-restore-dialog">` (`showModal()`, Esc = cancel, focus
  returns to the opener): Invite user, Resend invitation / Create password link (expiry choice), Change
  role (extra warning when Admin is involved), confirmation for Disable and Revoke. Enable runs directly.
- Expiry choice: 24 hours (default), 3 days, 7 days, pick a date (`customDateBounds`, end of that local
  day).
- Link result: the link once, read-only field + **Copy link** ("Copied." / fallback: select and copy),
  validity date, "This link is shown only once. Send it to the user yourself." (`delivery: 'email'` →
  "Sent by email to …"). The link exists only in component state.
- Errors: `AdminUserError.message` in `knowledge-error`; suggestions become buttons ("Create password
  link instead", "Enable user", "Resend invitation") that start that flow.
- After every successful action the list is loaded again from the server.
- Dates use the fixed English format of Guide dates (`formatGuideDate`).

### `#/activate?token=…`

States: no token → "This link is not valid." (no network call); loading; dead link (`token_*`) →
message + "Ask your Admin for a new link."; other error → message + **Try again**; form; done.
The form shows email, name and role, and asks for a new password + confirmation
(`autocomplete="new-password"`, show/hide, at least 8 characters). Both password fields are cleared when
the form is sent. Success: "Your password is set. Sign in with your email and new password." +
**Go to Sign In**. A signed-in visitor sees "You are signed in as …" and the page works normally.

The forgot-password page now says "Ask your Admin for a password link."
