import { useState, useEffect } from 'react';
import { PageHeader, SearchField, ContentRow, StateMessage } from '../components/knowledge/ApplicationUI';
import { getSearchData, executeSearch, type RawSearchData } from '../search/searchService';
import { resolveSearchType, type SearchDomain } from '../search/searchCore';
import { useRouter } from '../router';

export function Search({
  searchQuery,
  onSearchChange,
  routeType,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  routeType?: string;
}) {
  const { params } = useRouter();
  const routeTargetType = resolveSearchType(routeType ?? params?.type);
  const [type, setType] = useState<SearchDomain>(routeTargetType);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setType(routeTargetType);
  }, [routeTargetType]);

  const [playbook, setPlaybook] = useState('All');
  const [searchData, setSearchData] = useState<RawSearchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    setError(null);
    getSearchData()
      .then(data => {
        setSearchData(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load search data.');
        setLoading(false);
      });
  };

  useEffect(() => {
    let active = true;
    getSearchData()
      .then(data => {
        if (!active) return;
        setSearchData(data);
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load search data.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const playbooks = searchData?.playbooks || [];
  const playbookMap = new Map(playbooks.map(p => [p.id, p]));
  const issues = searchData?.issues || [];
  const issueMap = new Map(issues.map(i => [i.id, i]));
  const results = searchData
    ? executeSearch(searchQuery, searchData, { type, playbookId: playbook })
    : [];

  return (
    <div className="page">
      <PageHeader title="Search" description="Find a problem, its solution or a standard process." />
      <SearchField
        label="Search knowledge"
        placeholder="Search titles, Issue codes or platforms…"
        value={searchQuery}
        onChange={onSearchChange}
        autoFocus
      />
      <div className="toolbar">
        <div className="segmented" aria-label="Content type">
          {(['All', 'Playbooks', 'Issues', 'Guides', 'SOPs'] as const).map(t => (
            <button aria-pressed={type === t} key={t} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </div>
        <label className="filter-label">
          Playbook
          <select value={playbook} onChange={e => setPlaybook(e.target.value)} disabled={loading || !!error}>
            <option value="All">All Playbooks</option>
            {playbooks.map(p => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <StateMessage title="Loading Search…">
          Retrieving knowledge base from database…
        </StateMessage>
      ) : error ? (
        <StateMessage
          error
          title="Unable to load search data"
          action={
            <button
              type="button"
              className="btn-secondary"
              onClick={loadData}
            >
              Retry
            </button>
          }
        >
          {error}
        </StateMessage>
      ) : (
        <div>
          <p className="helper-text" role="status">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </p>
          {results.length ? (
            <div className="content-list">
              {results.map(item => (
                <ContentRow
                  key={item.id}
                  item={item}
                  playbook={'playbookId' in item ? playbookMap.get(item.playbookId) : undefined}
                  linkedIssue={'issueId' in item && item.issueId ? issueMap.get(item.issueId) : undefined}
                />
              ))}
            </div>
          ) : (
            <StateMessage
              title="No results found"
              action={
                <button
                  className="btn-secondary"
                  onClick={() => {
                    onSearchChange('');
                    setType('All');
                    setPlaybook('All');
                  }}
                >
                  Clear search & filters
                </button>
              }
            >
              Try a different Issue code or describe the problem another way.
            </StateMessage>
          )}
        </div>
      )}
    </div>
  );
}
