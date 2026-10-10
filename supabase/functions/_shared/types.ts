// Contract types for the User Management Edge Functions.
// Mirror of src/services/adminUserService.ts (Edge bundles cannot reliably import src/).
// Keep both in sync; the response mappers in mappers.ts produce exactly these shapes.

export type Role = 'Admin' | 'Support' | 'Viewer';
export type UserStatus = 'Active' | 'Disabled';
export type InvitationStatus = 'Pending' | 'Accepted' | 'Expired' | 'Revoked';
export type LinkPurpose = 'invitation' | 'password_reset';
export type LinkDelivery = 'manual' | 'email';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface Invitation {
  id: string;
  purpose: LinkPurpose;
  email: string;
  fullName: string;
  role: Role;
  userId: string | null;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedBy: string | null;
  createdAt: string;
}

export interface IssuedLink {
  invitationId: string;
  purpose: LinkPurpose;
  email: string;
  expiresAt: string;
  delivery: LinkDelivery;
  token: string | null;
}

export interface ActivationLinkInfo {
  purpose: LinkPurpose;
  status: 'Pending';
  email: string;
  fullName: string;
  role: Role;
  expiresAt: string;
}

export interface ActivationResult {
  purpose: LinkPurpose;
  email: string;
}

export type AdminSuggestion =
  | { action: 'create_password_link'; userId: string }
  | { action: 'enable_user'; userId: string }
  | { action: 'resend_invitation'; invitationId: string };

// ---- Infrastructure boundaries (implemented in index.ts, faked in tests) ----

// Error shape returned by PostgREST / supabase-js rpc().
export interface RpcError {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
}

export interface RpcResult {
  data: unknown;
  error: RpcError | null;
}

export interface AuthAdminError {
  message: string;
  code?: string | null;
  status?: number;
}

export interface AuthAdminResult {
  error: AuthAdminError | null;
}

export interface SupabaseKeys {
  publishableKey: string | null;
  secretKey: string | null;
  source: 'new' | 'legacy' | 'mixed' | 'none';
}

export interface AdminDeps {
  keys: SupabaseKeys;
  allowedOrigins: string[];
  // Supabase Auth: validates the caller's JWT on the Auth server (signature, expiry, user, session).
  getAuthUser(jwt: string): Promise<{ userId: string | null; error: AuthAdminError | null }>;
  // fn_admin_current_caller with the caller's own JWT: {user_id} of an active Admin, or a P0001 error.
  checkActiveAdmin(authorization: string): Promise<RpcResult>;
  // RPC with the caller's own Authorization header (the database checks auth.uid()).
  callerRpc(authorization: string, fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  // Supabase Auth admin call with the secret key: block / allow sign-in.
  setUserBanned(userId: string, banned: boolean): Promise<AuthAdminResult>;
}

export interface AuthLinkDeps {
  keys: SupabaseKeys;
  allowedOrigins: string[];
  // RPC with the secret key (server only functions).
  serviceRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  // fn_rate_limit_hit with the secret key: data = [{ allowed, retry_after_seconds }].
  rateLimitHit(keyHash: string, limit: number, windowSeconds: number): Promise<RpcResult>;
  createAuthUser(email: string, password: string): Promise<{ userId: string | null; error: AuthAdminError | null }>;
  updateAuthUser(userId: string, attributes: { password: string; emailConfirm?: boolean }): Promise<AuthAdminResult>;
  // Maximum wait for one Supabase Auth admin call; default AUTH_CALL_TIMEOUT_MS (tests pass a short value).
  authTimeoutMs?: number;
}
