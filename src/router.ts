import { useState, useEffect } from 'react';

export interface RouteState {
  path: string;
  params: { [key: string]: string };
}

export function parseHash(hash: string): RouteState {
  // Normalize hash (remove '#' and leading/trailing slashes)
  let cleanHash = hash.replace(/^#/, '');
  if (!cleanHash.startsWith('/')) {
    cleanHash = '/' + cleanHash;
  }
  // Remove trailing slash if not root
  if (cleanHash.length > 1 && cleanHash.endsWith('/')) {
    cleanHash = cleanHash.slice(0, -1);
  }

  const [routePath, query = ''] = cleanHash.split('?');
  const queryParams = Object.fromEntries(new URLSearchParams(query));
  const path = routePath || '/';

  const editMatch = path.match(/^\/guides\/([^/]+)\/edit$/);
  if (editMatch) return { path: '/guides/[id]/edit', params: { id: decodeURIComponent(editMatch[1]) } };

  // 1. Matches: /playbooks/[slug]/issues/[id]
  const issueMatch = path.match(/^\/playbooks\/([^/]+)\/issues\/([^/]+)$/);
  if (issueMatch) {
    return {
      path: '/playbooks/[slug]/issues/[id]',
      params: { slug: issueMatch[1], id: decodeURIComponent(issueMatch[2]) }
    };
  }

  // 2. Matches: /playbooks/[slug]/guides/[id]
  const guideMatch = path.match(/^\/playbooks\/([^/]+)\/guides\/([^/]+)$/);
  if (guideMatch) {
    return {
      path: '/playbooks/[slug]/guides/[id]',
      params: { ...queryParams, slug: guideMatch[1], id: decodeURIComponent(guideMatch[2]) }
    };
  }

  // 3. Matches: /playbooks/[slug]/sops/[id]
  const sopMatch = path.match(/^\/playbooks\/([^/]+)\/sops\/([^/]+)$/);
  if (sopMatch) {
    return {
      path: '/playbooks/[slug]/sops/[id]',
      params: { slug: sopMatch[1], id: decodeURIComponent(sopMatch[2]) }
    };
  }

  // 4. Matches: /playbooks/[slug]
  const playbookMatch = path.match(/^\/playbooks\/([^/]+)$/);
  if (playbookMatch) {
    return {
      path: '/playbooks/[slug]',
      params: { slug: playbookMatch[1] }
    };
  }

  // 5. Exact matches
  const exactPaths = [
    '/login',
    '/forgot-password',
    '/playbooks',
    '/search',
    '/troubleshooting',
    '/create',
    '/create/issue',
    '/create/guide',
    '/create/sop',
    '/create/playbook',
    '/settings'
  ];

  if (exactPaths.includes(path)) {
    return { path, params: queryParams };
  }

  return { path: '/', params: {} };
}

export function useRouter() {
  const [routeState, setRouteState] = useState<RouteState>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => {
      setRouteState(parseHash(window.location.hash));
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const navigate = (path: string) => {
    // Standardize leading hash symbol
    const targetHash = path.startsWith('#') ? path : `#${path}`;
    window.location.hash = targetHash;
  };

  return {
    path: routeState.path,
    params: routeState.params,
    navigate
  };
}
