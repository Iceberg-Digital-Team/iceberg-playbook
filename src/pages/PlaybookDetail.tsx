import { useState, useEffect } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { useRouter } from '../router';
import type { Playbook, Issue, VersionedGuide } from '../data';
import { getPlaybookBySlug } from '../services/playbookService';
import { listIssuesByPlaybook } from '../services/issueService';
import { listGuidesByPlaybook } from '../services/guideService';
import { getSOPs } from '../data';
import { PageHeader, SearchField, ContentRow, StateMessage, type ContentItem } from '../components/knowledge/ApplicationUI';

export function PlaybookDetail() {
  const { params } = useRouter();
  const [tab, setTab] = useState('Overview');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All');

  const [pb, setPb] = useState<Playbook | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [guides, setGuides] = useState<VersionedGuide[]>([]);
  const [loading, setLoading] = useState(Boolean(params.slug));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!params.slug) {
      return;
    }
    getPlaybookBySlug(params.slug)
      .then(async item => {
        if (!active) return;
        setPb(item);
        if (item) {
          try {
            const [pbIssues, pbGuides] = await Promise.all([
              listIssuesByPlaybook(item.id),
              listGuidesByPlaybook(item.id)
            ]);
            if (active) {
              setIssues(pbIssues);
              setGuides(pbGuides);
            }
          } catch (contentErr) {
            console.error('Failed to load playbook content:', contentErr);
          }
        }
        setLoading(false);
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load playbook.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [params.slug]);

  if (loading) {
    return (
      <div className="page">
        <a className="back-link" href="#/playbooks">
          <ArrowLeft size={14} />Back to Playbooks
        </a>
        <StateMessage title="Loading Playbook…">
          Retrieving playbook details…
        </StateMessage>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <a className="back-link" href="#/playbooks">
          <ArrowLeft size={14} />Back to Playbooks
        </a>
        <StateMessage
          error
          title="Unable to load Playbook"
          action={<a href="#/playbooks">Back to Playbooks</a>}
        >
          {error}
        </StateMessage>
      </div>
    );
  }

  if (!pb) {
    return (
      <StateMessage
        title="Playbook not found"
        action={<a href="#/playbooks">Back to Playbooks</a>}
      >
        Choose an existing Playbook.
      </StateMessage>
    );
  }

  const sops = getSOPs().filter(i => i.playbookId === pb.id);

  const filter = (items: ContentItem[]) =>
    items.filter(
      i =>
        (status === 'All' || i.status === status) &&
        `${i.id} ${i.title}`.toLowerCase().includes(query.toLowerCase())
    );

  const all = filter([...issues, ...guides, ...sops]);
  const list = filter(tab === 'Issues' ? issues : tab === 'Guides' ? guides : sops);
  const create = tab === 'Overview' ? '' : `/${tab === 'Issues' ? 'issue' : tab === 'Guides' ? 'guide' : 'sop'}`;
  const rows = (items: ContentItem[]) => items.map(i => <ContentRow item={i} key={i.id} playbook={pb} />);

  return (
    <div className="page">
      <a className="back-link" href="#/playbooks">
        <ArrowLeft size={14} />Back to Playbooks
      </a>
      <PageHeader
        title={pb.name}
        description={pb.description}
        action={
          <a className="btn-primary" href={`#/create${create}?playbook=${pb.id}`}>
            <Plus size={16} />Create{tab === 'Overview' ? '' : ` ${tab === 'Issues' ? 'Issue' : tab === 'Guides' ? 'Guide' : 'SOP'}`}
          </a>
        }
      />
      <div className="toolbar">
        <SearchField
          label={`Search within ${pb.name}`}
          placeholder={`Search within ${pb.name}…`}
          value={query}
          onChange={setQuery}
        />
        <div className="segmented" aria-label="Filter by status">
          {['All', 'Verified', 'Draft'].map(s => (
            <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Playbook content">
        {['Overview', 'Issues', 'Guides', 'SOPs'].map(t => (
          <button
            role="tab"
            id={`tab-${t}`}
            aria-controls="playbook-panel"
            aria-selected={tab === t}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="playbook-panel" aria-labelledby={`tab-${tab}`}>
        {tab === 'Overview' ? (
          <div className="page">
            <section>
              <h2>Recently Updated</h2>
              {all.length ? (
                rows(
                  [...all]
                    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
                    .slice(0, 4)
                )
              ) : (
                <StateMessage title="No content found">
                  Try another search or create your first Issue.
                </StateMessage>
              )}
            </section>
            <section>
              <h2>Needs Guide</h2>
              {filter(issues.filter(i => !guides.some(g => g.issueId === i.id))).length ? (
                rows(filter(issues.filter(i => !guides.some(g => g.issueId === i.id))).slice(0, 4))
              ) : (
                <p className="helper-text">No Issues need a Guide in this view.</p>
              )}
            </section>
            <section>
              <h2>Common Issues</h2>
              {rows(filter(issues).slice(0, 3))}
              {!filter(issues).length && <p className="helper-text">No Issues in this view.</p>}
            </section>
          </div>
        ) : list.length ? (
          <div className="content-list">{rows(list)}</div>
        ) : (
          <StateMessage
            title={`No ${tab} found`}
            action={
              <a className="btn-secondary" href={`#/create${create}?playbook=${pb.id}`}>
                Create {tab === 'Issues' ? 'Issue' : tab === 'Guides' ? 'Guide' : 'SOP'}
              </a>
            }
          >
            {query
              ? 'Try another search or change the status filter.'
              : `Document the first ${tab === 'Guides' ? 'solution for an existing Issue' : tab === 'Issues' ? 'problem' : 'standard process'} in this Playbook.`}
          </StateMessage>
        )}
      </div>
    </div>
  );
}
