import { useState } from 'react';
import { getPlaybooks } from '../data';
import { PageHeader, SearchField, ContentRow, StateMessage } from '../components/knowledge/ApplicationUI';
import { executeSearch } from '../search/searchService';

export function Search({ searchQuery, onSearchChange }: { searchQuery: string; onSearchChange: (q: string) => void }) {
  const [type, setType] = useState('All');
  const [playbook, setPlaybook] = useState('All');
  const playbooks = getPlaybooks();
  const query = searchQuery.trim().toLowerCase();
  const results = executeSearch(searchQuery, { type, playbookId: playbook });

  return (
    <div className="page">
      <PageHeader title="Search" description="Find a problem, its solution or a standard process." />
      <SearchField label="Search knowledge" placeholder="Search titles, Issue codes or platforms…" value={searchQuery} onChange={onSearchChange} autoFocus />
      <div className="toolbar">
        <div className="segmented" aria-label="Content type">
          {['All', 'Issues', 'Guides', 'SOPs'].map(t => (
            <button aria-pressed={type === t} key={t} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </div>
        <label className="filter-label">
          Playbook
          <select value={playbook} onChange={e => setPlaybook(e.target.value)}>
            <option value="All">All Playbooks</option>
            {playbooks.map(p => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <p className="helper-text" role="status">
          {results.length} {results.length === 1 ? 'result' : 'results'}
        </p>
        {results.length ? (
          <div className="content-list">
            {results.map((item, i) => (
              <ContentRow key={item.id} item={item} excerpt={!!query && i === 0} />
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
    </div>
  );
}
