import { useState, useEffect } from 'react';
import { Plus, MessageSquare, Briefcase, Home, Video, Mic, Globe, ArrowRight, type LucideIcon } from 'lucide-react';
import type { Playbook } from '../data';
import { listPlaybooks } from '../services/playbookService';
import { PageHeader, SearchField, StateMessage } from '../components/knowledge/ApplicationUI';

const icons: Record<string, LucideIcon> = { MessageSquare, Briefcase, Home, Video, Mic, Globe };

export function Playbooks() {
  const [query, setQuery] = useState('');
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    listPlaybooks()
      .then(items => {
        setPlaybooks(items);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Unable to load Playbooks.');
        setLoading(false);
      });
  };

  useEffect(() => {
    let active = true;
    listPlaybooks()
      .then(items => {
        if (active) {
          setPlaybooks(items);
          setLoading(false);
        }
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load Playbooks.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = playbooks.filter(p =>
    `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="page">
      <PageHeader
        title="Playbooks"
        description="Choose a product, platform or problem area."
        action={
          <a className="btn-primary" href="#/create/playbook">
            <Plus size={16} />New Playbook
          </a>
        }
      />
      <SearchField
        label="Search Playbooks"
        placeholder="Search Playbooks…"
        value={query}
        onChange={setQuery}
      />
      {loading ? (
        <StateMessage title="Loading Playbooks…">
          Connecting to workspace…
        </StateMessage>
      ) : error ? (
        <StateMessage
          error
          title="Unable to load Playbooks"
          action={
            <button type="button" className="btn-secondary" onClick={load}>
              Retry
            </button>
          }
        >
          {error}
        </StateMessage>
      ) : filtered.length ? (
        <div className="playbook-grid">
          {filtered.map(p => {
            const Icon = icons[p.icon] || MessageSquare;
            return (
              <a className="playbook-tile" key={p.id} href={`#/playbooks/${p.slug}`}>
                <div className="tile-heading">
                  <Icon size={23} strokeWidth={1.5} />
                  <h2>{p.name}</h2>
                </div>
                <p>{p.description}</p>
                <div className="tile-footer">
                  <span>
                    {p.issueCount} Issues · {p.guideCount} Guides · {p.sopCount} SOPs
                  </span>
                  <ArrowRight size={17} />
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <StateMessage
          title="No Playbooks found"
          action={
            query ? (
              <button type="button" className="btn-secondary" onClick={() => setQuery('')}>
                Clear search
              </button>
            ) : (
              <a href="#/create/playbook">Create a Playbook →</a>
            )
          }
        >
          {query ? 'Try another search term.' : 'Try another search or create a new problem area.'}
        </StateMessage>
      )}
    </div>
  );
}
