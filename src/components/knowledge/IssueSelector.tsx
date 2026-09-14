import { useState } from 'react';
import { getIssues, getPlaybooks, getPrimaryGuide } from '../../data';
import './Knowledge.css';

export function IssueSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(!value);
  const issues = getIssues();
  const playbooks = getPlaybooks();
  const selected = issues.find(i => i.id === value);
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = issues.filter(i => tokens.every(t => `${i.id} ${i.title} ${i.summary} ${i.symptoms.join(' ')} ${i.errorMessage} ${i.affectedArea} ${playbooks.find(p => p.id === i.playbookId)?.name}`.toLowerCase().includes(t)));
  return <div className="issue-selector">
    <label htmlFor="related-issue-search">Related Issue *</label>
    <p style={{ marginBottom: 12 }}>Search or select the problem this Guide solves.</p>
    {selected && <div className="issue-connection" style={{ marginBottom: 12 }}>
      <strong>{selected.id} — {selected.title}</strong>
      <span>{playbooks.find(p => p.id === selected.playbookId)?.name}</span>
      <button type="button" className="btn-secondary" onClick={() => { onChange(''); setSearching(true); setQuery(''); }}>Change Issue</button>
    </div>}
    {searching && <>
      <input id="related-issue-search" type="search" placeholder="Search by code, title or keywords…" value={query} onChange={e => setQuery(e.target.value)} aria-controls="related-issue-results" />
      <p role="status" style={{ marginTop: 8 }}>{matches.length ? `${matches.length} matching issues` : 'No matching issues. Try another keyword or create an Issue first.'}</p>
      <ul id="related-issue-results" className="issue-selector-results">
        {matches.slice(0, 30).map(issue => <li key={issue.id}><button type="button" onClick={() => { onChange(issue.id); setSearching(false); }}>
          <span><strong>{issue.id}</strong> — {issue.title}</span>
          <small>{playbooks.find(p => p.id === issue.playbookId)?.name} · {getPrimaryGuide(issue.id) ? 'Primary Guide already exists' : 'Guide Needed'}</small>
        </button></li>)}
      </ul>
      {matches.length > 30 && <p>Keep typing to narrow the results.</p>}
      {!issues.length && <a href="#/create/issue">Create an Issue</a>}
    </>}
  </div>;
}
