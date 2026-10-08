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
3. The user enters a password and its confirmation. Rules: at least **8 characters**, at most
   **72 bytes** in UTF-8 (bcrypt limit), not only spaces, not trimmed, confirmation must match exactly.
4. The page calls `activateAccount({ token, password })`. The backend checks the token again,
   sets the password, marks the link `Accepted` (single use) and, for an invitation, creates the active
   user with the invited name and role.
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
404 `not_found`, 409 `email_in_use` / `invitation_exists` / `invalid_status` / `last_admin` / `self_action`,
410 `token_expired` / `token_used` / `token_revoked`, 400 `token_invalid`).

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
| `POST /api/auth/invitations/lookup` | Anyone with the token | `{ token }` | `ActivationLinkInfo` | `token_invalid`, `token_expired`, `token_used`, `token_revoked` |
| `POST /api/auth/activate` | Anyone with the token | `{ token, password }` | `ActivationResult` | `token_*`, `invalid_input` |

`IssuedLink` = `{ invitationId, purpose, email, expiresAt, delivery, token }`. The raw `token` appears
**only** in this creation response (and is `null` when `delivery` is `'email'`). The frontend service turns
it into `activationUrl` and never exposes the token separately.

**Token lookup uses POST instead of `GET /api/auth/invitations/:token`** (provisional, see §13).
A token in a URL path ends up in server access logs, proxy and CDN logs, and monitoring tools. In a
POST body it does not. The `#/activate?token=` part of the page URL is a hash fragment, which browsers
never send to the server, so it stays out of server logs too.

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
- **Rate limiting** (recommended): limit lookup and activate calls per IP and per token.

---

## 11. Current Supabase reference implementation

> Status: migrations 10 and 11 are **written (task B) but not deployed** (`Mode: PROPOSED`).
> Edge Functions (task C) and the adapter (task D) are planned.
> Supabase-specific lines in the SQL are marked `[SUPABASE]`.

| Part | Task | Content |
| :--- | :--- | :--- |
| `supabase/migrations/10_user_management.sql` | B (written) | Data model: `profiles.status` (`Active` / `Disabled`, default `Active`, backfills existing rows), table `user_invitations` (§3), CHECK constraints, partial unique indexes (one open invitation per email, one open reset link per user), `fn_invitation_effective_status`. |
| `supabase/migrations/11_user_invitation_security.sql` | B (written) | Security: RLS on `user_invitations` with no policies, privileges, triggers, the functions below, and the changes to existing behavior listed in §13. |
| `supabase/tests/user_management_tests.sql` | B (written) | 17 database tests in `BEGIN … ROLLBACK`. |
| Supabase Edge Functions | C (planned) | One function per endpoint group in §9. They hash tokens, call the database functions below, create / update auth users, and are the only place that uses `service_role`. The server must enforce the same rules as `adminUserRules.ts`; task C decides whether this file can be reused. |
| `src/services/admin/supabaseAdminUserAdapter.ts` | D (planned) | Implements `AdminUserAdapter` by calling the Edge Functions, maps responses to the domain models and errors to `AdminUserError` codes. Wired with `configureAdminUserService(adapter, { activationBaseUrl })`. |

### Database functions

All are `SECURITY DEFINER` with `SET search_path = ''` and explicit `REVOKE` / `GRANT`.

| Function | Contract operation | Caller |
| :--- | :--- | :--- |
| `fn_admin_list_users()` | `listUsers` | Admin's own JWT (`authenticated`) |
| `fn_admin_create_invitation(email, full_name, role, expires_at, token_hash)` | `inviteUser` | Admin's own JWT |
| `fn_admin_resend_invitation(invitation_id, expires_at, token_hash)` | `resendInvitation` | Admin's own JWT |
| `fn_admin_revoke_invitation(invitation_id)` | `revokeInvitation` | Admin's own JWT |
| `fn_admin_change_user_role(user_id, role)` | `changeUserRole` | Admin's own JWT |
| `fn_admin_disable_user(user_id)` | `disableUser` (also revokes open reset links) | Admin's own JWT |
| `fn_admin_enable_user(user_id)` | `enableUser` | Admin's own JWT |
| `fn_admin_create_password_reset_link(user_id, expires_at, token_hash)` | `createPasswordResetLink` (revokes older open ones) | Admin's own JWT |
| `fn_get_activation_link(token_hash)` | `getInvitation` | server only (`service_role`) |
| `fn_accept_invitation(token_hash, auth_user_id)` | `activateAccount` (invitation) | server only |
| `fn_accept_password_reset(token_hash)` | `activateAccount` (password reset) | server only |

Every `fn_admin_*` function checks that `auth.uid()` is an **active Admin**. Every admin action writes
`public.audit_logs` (`entity_type` `user` or `invitation`) without token, hash or password.

**Triggers** protect the rules on every write path, not only through the functions:
`trg_profiles_guard_role_status` (role / status change only through the functions; no self action;
last active Admin, race-safe with an advisory lock), `trg_user_invitations_guard` (Accepted / Revoked
are final; link target fields never change), `trg_user_invitations_no_delete` (no hard delete).

**Error convention:** `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<AdminUserErrorCode>',
DETAIL = '<English text>', HINT = '<suggestion JSON>'`. The Edge Function maps `MESSAGE` 1:1 to
`AdminUserError.code`, `DETAIL` to the message and `HINT` to `suggestion`. Any other SQLSTATE → `unknown`.

### Activation order (task C)

**Invitation**
1. Hash the token → `fn_get_activation_link` (dead link → `token_*`).
2. Find an auth user with the same email (`lower(btrim(...))` on both sides).
   None → create it. Exists **and has no profile** (left over from an earlier failed try) → reuse it and
   set its password. Exists **with** a profile → stop with `email_in_use`; never change that password.
3. `fn_accept_invitation(hash, auth_user_id)` — one transaction: lock the link (`FOR UPDATE`), re-check
   it, check the auth email matches, create the `Active` profile with the invited name and role, mark
   the link `Accepted`, write audit.
4. If step 3 fails, nothing is saved and the link stays `Pending`. The auth user without a profile cannot
   sign in and is reused on retry. Nothing is deleted.

**Password reset**
1. Hash the token → `fn_get_activation_link`.
2. `fn_accept_password_reset(hash)` first: the link is claimed in the database (single use).
3. Then set the new password for the returned `user_id`. If this fails, the link is already used and the
   Admin creates a new one.

---

## 12. Iceberg migration notes

Same approach as `INFRASTRUCTURE_MIGRATION.md` §5–§8:

1. **Replace only the adapter.** Create e.g. `src/services/admin/icebergAdminUserAdapter.ts`
   implementing `AdminUserAdapter` with HTTP calls to the endpoints in §9, and pass it to
   `configureAdminUserService`. `adminUserService.ts`, `adminUserRules.ts`, the pages and the router stay
   unchanged.
2. **Move business rules to the backend.** The Iceberg API must enforce: effective invitation status,
   the allowed-actions table, self-action and last-Admin protection, expiry limits (max 7 days),
   invite validation and conflicts, password rules, single-use hashed tokens, revoking older reset links,
   revoking links of disabled users, and blocking sign-in for disabled users.
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
- Password: 8 characters minimum, 72 bytes maximum.

Database decisions (task B):

- Role and status can change only through the admin functions (trigger), never by a direct API update.
- Admin functions are called with the Admin's own JWT; link lookup / accept only by the server.
- Statuses are stored as TEXT + CHECK (same strings as the contract); `Expired` is computed, never stored.
- Token hash: SHA-256, 64 lower-case hex chars; hashing happens on the server.
- Activation retry reuses only an auth user with the same email and **no** profile; nothing is deleted.

**Changes to existing behavior (migration 11) — needs team lead approval:**

- Policy `profiles_delete_admin_only` (migration 04) is dropped and `DELETE` on `profiles` is revoked
  from `anon` / `authenticated`: no hard delete of users through the API.
- `fn_user_role()` (04) returns no role for a `Disabled` user, so `fn_is_admin()` and
  `fn_is_support_or_admin()` deny a disabled user with a session that has not expired yet.
- `fn_get_current_actor()` (03) resolves a `Disabled` user to `Viewer`.
- New trigger on `profiles`: `role` / `status` cannot be changed by a direct API update.
  Name / avatar updates are unchanged.
- `user_invitations.user_id` / `invited_by` use `ON DELETE RESTRICT`: deleting a user who created
  links or has a reset link fails (history is kept).

Open:

- Invitation fields `full_name`, `purpose`, `user_id` were added to the team lead's field list — needs
  team lead OK.
- Policy `profiles_insert_admin_only` (04) still lets an Admin insert a profile directly through the API,
  bypassing the invitation flow and audit. The frontend does not use it. Team lead decides.
- Task C: two concurrent activation requests with the same invitation token could let the second request
  reset the password of the auth user the first request just created. Task C must handle it (for
  example: claim / lock the link before creating or updating the auth user).
- Task C: on disable, also block sign-in and end sessions in the auth service; on enable, allow again.
- Who deploys migrations and Edge Functions (tasks B and C). The migrations and SQL tests have not been
  run against a database yet.
