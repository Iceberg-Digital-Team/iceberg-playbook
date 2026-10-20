// Browser client for the Iceberg Playbook API (server/). It exposes the small query-builder
// surface the services use (from / rpc / storage / functions / auth) and talks to the server's
// JSON endpoints. Authorization is enforced by the server and the database, never by this file.

export interface DbError {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
  name?: string;
}

export interface DbResult<T = any> {
  data: T | null;
  error: DbError | null;
}

export interface ClientSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
}

export interface ClientOptions {
  baseUrl?: string;
  storageKey?: string;
  fetch?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

type Primitive = string | number | boolean | null;
type Filter = { column: string; op: string; value: unknown; negate?: boolean };

class QueryBuilder<T = any> implements PromiseLike<DbResult<T>> {
  private method: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private columns = '*';
  private filters: Filter[] = [];
  private ors: string[] = [];
  private orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = [];
  private limitCount: number | undefined;
  private values: unknown;
  private returning = true;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private negateNext = false;

  private readonly table: string;
  private readonly send: (spec: Record<string, unknown>) => Promise<DbResult<T>>;

  constructor(table: string, send: (spec: Record<string, unknown>) => Promise<DbResult<T>>) {
    this.table = table;
    this.send = send;
  }

  select(columns = '*'): this {
    this.returning = true;
    this.columns = columns;
    return this;
  }

  insert(values: unknown): this {
    this.method = 'insert';
    this.values = values;
    this.returning = false;
    return this;
  }

  update(values: unknown): this {
    this.method = 'update';
    this.values = values;
    this.returning = false;
    return this;
  }

  delete(): this {
    this.method = 'delete';
    this.returning = false;
    return this;
  }

  private add(op: string, column: string, value: unknown): this {
    this.filters.push({ column, op, value, negate: this.negateNext || undefined });
    this.negateNext = false;
    return this;
  }

  eq(column: string, value: Primitive) { return this.add('eq', column, value); }
  neq(column: string, value: Primitive) { return this.add('neq', column, value); }
  gt(column: string, value: Primitive) { return this.add('gt', column, value); }
  gte(column: string, value: Primitive) { return this.add('gte', column, value); }
  lt(column: string, value: Primitive) { return this.add('lt', column, value); }
  lte(column: string, value: Primitive) { return this.add('lte', column, value); }
  like(column: string, value: string) { return this.add('like', column, value); }
  ilike(column: string, value: string) { return this.add('ilike', column, value); }
  is(column: string, value: boolean | null) { return this.add('is', column, value); }
  in(column: string, values: Primitive[]) { return this.add('in', column, values); }

  // not('col', 'is', null) -> NOT (col IS NULL)
  not(column: string, op: string, value: unknown): this {
    this.filters.push({ column, op, value, negate: true });
    return this;
  }

  or(expression: string): this {
    this.ors.push(expression);
    return this;
  }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    this.orders.push({ column, ascending: options.ascending !== false, nullsFirst: options.nullsFirst });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  single(): this { this.mode = 'single'; return this; }
  maybeSingle(): this { this.mode = 'maybe'; return this; }

  then<R1 = DbResult<T>, R2 = never>(
    onfulfilled?: ((value: DbResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.send({
      table: this.table,
      method: this.method,
      columns: this.columns,
      filters: this.filters,
      or: this.ors,
      order: this.orders,
      limit: this.limitCount,
      values: this.values,
      returning: this.returning,
      mode: this.mode,
    }).then(onfulfilled, onrejected);
  }
}

export interface StorageFileApi {
  upload(path: string, file: Blob, options?: { contentType?: string; upsert?: boolean }): Promise<DbResult<{ path: string }>>;
  createSignedUrl(path: string, expiresIn: number): Promise<DbResult<{ signedUrl: string }>>;
  createSignedUrls(paths: string[], expiresIn: number): Promise<DbResult<Array<{ path: string | null; signedUrl: string | null; error: string | null }>>>;
  remove(paths: string[]): Promise<DbResult<Array<{ name: string }>>>;
}

export interface FunctionsHttpErrorLike extends DbError {
  context?: Response;
}

export interface DbClient {
  from(table: string): QueryBuilder;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  storage: { from(bucket: string): StorageFileApi };
  functions: {
    invoke(path: string, options?: { method?: string; body?: unknown }): Promise<DbResult>;
  };
  auth: {
    signInWithPassword(input: { email: string; password: string }): Promise<{ data: { user: ClientSession['user'] | null; session: ClientSession | null }; error: DbError | null }>;
    signOut(): Promise<{ error: DbError | null }>;
    getSession(): Promise<{ data: { session: ClientSession | null }; error: DbError | null }>;
  };
}

const REFRESH_MARGIN_SECONDS = 60;

function envBaseUrl(): string {
  const value = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL;
  return (value ?? '').trim().replace(/\/+$/, '');
}

export function createApiClient(options: ClientOptions = {}): DbClient {
  const baseUrl = (options.baseUrl ?? envBaseUrl()).replace(/\/+$/, '');
  const storageKey = options.storageKey ?? 'iceberg-playbook.session';
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const store = options.storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : options.storage;
  const origin = () => baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');

  let memory: ClientSession | null = null;
  let refreshing: Promise<ClientSession | null> | null = null;

  function readSession(): ClientSession | null {
    if (memory) return memory;
    try {
      const raw = store?.getItem(storageKey);
      memory = raw ? (JSON.parse(raw) as ClientSession) : null;
    } catch {
      memory = null;
    }
    return memory;
  }

  function writeSession(session: ClientSession | null): void {
    memory = session;
    try {
      if (session) store?.setItem(storageKey, JSON.stringify(session));
      else store?.removeItem(storageKey);
    } catch {
      // Storage may be unavailable (private mode); the in-memory session still works.
    }
  }

  async function refresh(): Promise<ClientSession | null> {
    const current = readSession();
    if (!current) return null;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const response = await doFetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: current.refresh_token }),
          });
          if (response.status === 400 || response.status === 401) {
            writeSession(null);
            return null;
          }
          if (!response.ok) return readSession();
          const next = (await response.json()) as ClientSession;
          writeSession(next);
          return next;
        } catch {
          // Network failure: keep the session, the caller will see the real error.
          return readSession();
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  }

  async function accessToken(): Promise<string | null> {
    let session = readSession();
    if (session && session.expires_at - Date.now() / 1000 < REFRESH_MARGIN_SECONDS) {
      session = await refresh();
    }
    return session?.access_token ?? null;
  }

  // fetch with the Bearer token; on a 401 the session is refreshed once and the call retried.
  async function authed(path: string, init: RequestInit = {}): Promise<Response> {
    const call = async (token: string | null) => {
      const headers = new Headers(init.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return doFetch(`${baseUrl}${path}`, { ...init, headers });
    };
    let response = await call(await accessToken());
    if (response.status === 401 && readSession()) {
      const next = await refresh();
      if (next) response = await call(next.access_token);
    }
    return response;
  }

  async function json(path: string, body: unknown, method = 'POST'): Promise<DbResult> {
    try {
      const response = await authed(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json().catch(() => null)) as { data?: unknown; error?: DbError } | null;
      if (payload?.error) return { data: null, error: { ...payload.error, status: response.status } };
      if (!response.ok) return { data: null, error: { message: `Request failed (${response.status})`, status: response.status } };
      return { data: (payload?.data ?? null) as unknown, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : 'Network error' } };
    }
  }

  function storageApi(bucket: string): StorageFileApi {
    const encode = (key: string) => key.split('/').map(encodeURIComponent).join('/');
    return {
      async upload(path, file, opts = {}) {
        try {
          const response = await authed(`/storage/v1/object/${bucket}/${encode(path)}`, {
            method: 'POST',
            headers: { 'Content-Type': opts.contentType || file.type || 'application/octet-stream' },
            body: file,
          });
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          if (!response.ok) return { data: null, error: { message: payload?.message ?? `Upload failed (${response.status})`, status: response.status } };
          return { data: { path }, error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : 'Network error' } };
        }
      },

      async createSignedUrl(path, expiresIn) {
        try {
          const response = await authed(`/storage/v1/object/sign/${bucket}/${encode(path)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expiresIn }),
          });
          const payload = (await response.json().catch(() => null)) as { signedURL?: string; message?: string } | null;
          if (!response.ok || !payload?.signedURL) return { data: null, error: { message: payload?.message ?? 'Object not found', status: response.status } };
          return { data: { signedUrl: absolute(payload.signedURL) }, error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : 'Network error' } };
        }
      },

      async createSignedUrls(paths, expiresIn) {
        try {
          const response = await authed(`/storage/v1/object/sign/${bucket}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expiresIn, paths }),
          });
          const payload = (await response.json().catch(() => null)) as Array<{ path: string; signedURL: string | null; error: string | null }> | { message?: string } | null;
          if (!response.ok || !Array.isArray(payload)) return { data: null, error: { message: (payload as { message?: string } | null)?.message ?? 'Could not sign URLs', status: response.status } };
          return {
            data: payload.map(item => ({ path: item.path, signedUrl: item.signedURL ? absolute(item.signedURL) : null, error: item.error })),
            error: null,
          };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : 'Network error' } };
        }
      },

      async remove(paths) {
        try {
          const response = await authed(`/storage/v1/object/${bucket}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefixes: paths }),
          });
          const payload = (await response.json().catch(() => null)) as Array<{ name: string }> | { message?: string } | null;
          if (!response.ok || !Array.isArray(payload)) return { data: null, error: { message: (payload as { message?: string } | null)?.message ?? 'Delete failed', status: response.status } };
          return { data: payload, error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : 'Network error' } };
        }
      },
    };
  }

  const absolute = (url: string) => (/^https?:\/\//.test(url) ? url : `${origin()}${url}`);

  return {
    from: table => new QueryBuilder(table, spec => json('/rest/v1/query', spec)),

    rpc: (fn, args = {}) => ({
      then: (onfulfilled, onrejected) => json(`/rest/v1/rpc/${encodeURIComponent(fn)}`, args).then(onfulfilled, onrejected),
    }),

    storage: { from: storageApi },

    functions: {
      async invoke(path, opts = {}) {
        let response: Response;
        try {
          response = await authed(`/functions/v1/${path}`, {
            method: opts.method ?? 'POST',
            headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          });
        } catch {
          return { data: null, error: Object.assign(new Error('Failed to send a request to the server'), { name: 'FunctionsFetchError', message: 'Failed to send a request to the server' }) as DbError };
        }
        if (!response.ok) {
          return { data: null, error: Object.assign(new Error('Server returned an error'), { name: 'FunctionsHttpError', message: 'Server returned an error', context: response }) as FunctionsHttpErrorLike };
        }
        const text = response.status === 204 ? '' : await response.text();
        return { data: text ? JSON.parse(text) : null, error: null };
      },
    },

    auth: {
      async signInWithPassword({ email, password }) {
        try {
          const response = await doFetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const payload = (await response.json().catch(() => null)) as (ClientSession & { error_description?: string }) | null;
          if (!response.ok || !payload?.access_token) {
            return { data: { user: null, session: null }, error: { message: payload?.error_description ?? 'Invalid email or password.', status: response.status } };
          }
          writeSession(payload);
          return { data: { user: payload.user, session: payload }, error: null };
        } catch (error) {
          return { data: { user: null, session: null }, error: { message: error instanceof Error ? error.message : 'Network error' } };
        }
      },

      async signOut() {
        const session = readSession();
        writeSession(null);
        if (session) {
          // Best effort; the session is already cleared locally.
          doFetch(`${baseUrl}/auth/v1/logout`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => undefined);
        }
        return { error: null };
      },

      async getSession() {
        const token = await accessToken();
        const session = token ? readSession() : null;
        return { data: { session }, error: null };
      },
    },
  };
}
