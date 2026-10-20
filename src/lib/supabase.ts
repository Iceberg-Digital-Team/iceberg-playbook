// The app's single backend client. The name is historical: it now talks to the Iceberg
// Playbook API (server/) over HTTP, backed by plain PostgreSQL. Services import it from here,
// so swapping the backend again only touches this file and apiClient.ts.
import { createApiClient } from './apiClient';
import type { DbClient } from './apiClient';

export type { DbClient };

export const supabase: DbClient = createApiClient();
