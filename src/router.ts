import { useState, useEffect, useCallback } from 'react';

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

  const sopEditMatch = path.match(/^\/sops\/([^/]+)\/edit$/);
  if (sopEditMatch) return { path: '/sops/[id]/edit', params: { id: decodeURIComponent(sopEditMatch[1]) } };

  const issueEditMatch = path.match(/^\/issues\/([^/]+)\/edit$/);
  if (issueEditMatch) return { path: '/issues/[id]/edit', params: { id: decodeURIComponent(issueEditMatch[1]) } };

  const playbookIssueEditMatch = path.match(/^\/playbooks\/([^/]+)\/issues\/([^/]+)\/edit$/);
  if (playbookIssueEditMatch) {
    return {
      path: '/issues/[id]/edit',
      params: { slug: playbookIssueEditMatch[1], id: decodeURIComponent(playbookIssueEditMatch[2]) }
    };
  }

  const playbookGuideEditMatch = path.match(/^\/playbooks\/([^/]+)\/guides\/([^/]+)\/edit$/);
  if (playbookGuideEditMatch) {
    return {
      path: '/guides/[id]/edit',
      params: { slug: playbookGuideEditMatch[1], id: decodeURIComponent(playbookGuideEditMatch[2]) }
    };
  }

  const playbookSopEditMatch = path.match(/^\/playbooks\/([^/]+)\/sops\/([^/]+)\/edit$/);
  if (playbookSopEditMatch) {
    return {
      path: '/sops/[id]/edit',
      params: { slug: playbookSopEditMatch[1], id: decodeURIComponent(playbookSopEditMatch[2]) }
    };
  }

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

export type NavigationBlocker = (targetHash: string, proceed: () => void) => boolean;

let activeBlocker: NavigationBlocker | null = null;
let isReverting = false;
let bypassBlocker = false;
let currentUrlHash = typeof window !== 'undefined' ? (window.location.hash || '#/') : '#/';

export function setNavigationBlocker(blocker: NavigationBlocker | null) {
  activeBlocker = blocker;
}

const listeners = new Set<(state: RouteState) => void>();

function notifyListeners() {
  currentUrlHash = typeof window !== 'undefined' ? (window.location.hash || '#/') : '#/';
  const state = parseHash(typeof window !== 'undefined' ? window.location.hash : '');
  for (const listener of listeners) {
    listener(state);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', (event: HashChangeEvent) => {
    if (isReverting) {
      isReverting = false;
      return;
    }

    if (bypassBlocker) {
      bypassBlocker = false;
      notifyListeners();
      return;
    }

    if (activeBlocker) {
      const oldHash = currentUrlHash || (event.oldURL ? new URL(event.oldURL).hash : '') || '#/';
      const newHash = window.location.hash || '#/';

      if (oldHash && newHash !== oldHash) {
        const targetHash = newHash;
        const blocked = activeBlocker(targetHash, () => {
          bypassBlocker = true;
          window.location.hash = targetHash;
        });

        if (blocked) {
          isReverting = true;
          window.location.hash = oldHash;
          return;
        }
      }
    }

    notifyListeners();
  });

  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      if (!activeBlocker) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

      const anchor = (event.target as HTMLElement)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;

      if (href.startsWith('#')) {
        const current = window.location.hash || '#/';
        const targetHash = href;
        if (targetHash === current) return;

        const blocked = activeBlocker(targetHash, () => {
          bypassBlocker = true;
          window.location.hash = targetHash;
        });

        if (blocked) {
          event.preventDefault();
        }
      }
    },
    true
  );
}

export function useRouter() {
  const [routeState, setRouteState] = useState<RouteState>(() =>
    parseHash(typeof window !== 'undefined' ? window.location.hash : '')
  );

  useEffect(() => {
    listeners.add(setRouteState);
    return () => {
      listeners.delete(setRouteState);
    };
  }, []);

  const navigate = useCallback((path: string) => {
    const targetHash = path.startsWith('#') ? path : `#${path}`;
    const currentHash = typeof window !== 'undefined' ? (window.location.hash || '#/') : '#/';
    if (targetHash === currentHash) return;

    if (activeBlocker) {
      const blocked = activeBlocker(targetHash, () => {
        bypassBlocker = true;
        window.location.hash = targetHash;
      });
      if (blocked) return;
    }

    if (typeof window !== 'undefined') {
      window.location.hash = targetHash;
    }
  }, []);

  return {
    path: routeState.path,
    params: routeState.params,
    navigate
  };
}
