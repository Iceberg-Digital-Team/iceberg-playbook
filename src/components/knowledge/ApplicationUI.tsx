import { Search, ArrowRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import type { Issue, VersionedGuide, SOP, Playbook } from '../../data';
import { getRowJiraCode } from '../../search/searchCore';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}
export function SearchField({ value, onChange, placeholder = 'Search…', label = 'Search', autoFocus = false }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string; autoFocus?: boolean }) {
  return <div className="search-field"><Search size={19} aria-hidden="true"/><input type="search" aria-label={label} placeholder={placeholder} value={value} autoFocus={autoFocus} onChange={e => onChange(e.target.value)} /></div>;
}
export function StateMessage({ title, children, action, error = false }: { title: string; children?: ReactNode; action?: ReactNode; error?: boolean }) {
  return <div className={`state-message${error ? ' state-error' : ''}`} role={error ? 'alert' : 'status'}><h2>{title}</h2>{children && <p>{children}</p>}{action}</div>;
}
export function FormSection({ title, hint, children, optional = false, open = false }: { title: string; hint?: string; children: ReactNode; optional?: boolean; open?: boolean }) {
  const body = <div className="form-section-body">{hint && <p className="helper-text">{hint}</p>}{children}</div>;
  return optional ? <details className="form-section disclosure" open={open || undefined}><summary>{title}<span>Optional</span></summary>{body}</details> : <section className="form-section"><h2>{title}</h2>{body}</section>;
}
export type ContentItem = Issue | VersionedGuide | SOP;
export type SearchRowItem = ContentItem | Playbook;

function isPlaybook(item: SearchRowItem): item is Playbook {
  return 'slug' in item && 'name' in item;
}

export function ContentRow({
  item,
  excerpt: _excerpt = false,
  playbook,
  linkedIssue,
  jiraCode: directJiraCode,
}: {
  item: SearchRowItem;
  excerpt?: boolean;
  playbook?: Playbook;
  linkedIssue?: Issue;
  jiraCode?: string;
}) {
  if (isPlaybook(item)) {
    const metaItems: ReactNode[] = [
      <span key="visibility">{item.visibility || 'Internal'}</span>,
      item.owner ? <span key="owner">{item.owner}</span> : null,
    ].filter(Boolean);

    const description = item.description?.trim();

    return (
      <a className="content-row" href={`#/playbooks/${item.slug}`}>
        <div className="row-content">
          <div className="row-header">
            <span className="type-badge type-badge-playbook">PLAYBOOK</span>
            {item.code && <span className="row-code">{item.code}</span>}
          </div>
          <div className="row-title">{item.name}</div>
          {description && <p className="row-desc">{description}</p>}
          {metaItems.length > 0 && (
            <div className="row-meta">
              {metaItems.map((meta, idx) => (
                <Fragment key={idx}>
                  {idx > 0 && <span className="meta-sep" aria-hidden="true">·</span>}
                  {meta}
                </Fragment>
              ))}
            </div>
          )}
        </div>
        <ArrowRight size={18} aria-hidden="true" />
      </a>
    );
  }

  const pb = playbook;
  const isGuide = 'issueId' in item;
  const isSop = 'owner' in item && !('symptoms' in item);
  const type = isGuide ? 'Guide' : isSop ? 'SOP' : 'Issue';
  const folder = isGuide ? 'guides' : isSop ? 'sops' : 'issues';
  const jiraCode = directJiraCode?.trim() || getRowJiraCode(item, linkedIssue);
  if (!pb) return null;

  let description: string | undefined;
  if (isGuide) {
    description = item.issueId ? `Solves ${item.issueId}` : item.summary?.trim();
  } else if (isSop) {
    description = item.purpose?.trim();
  } else {
    description = (item as Issue).summary?.trim();
  }

  const metaItems: ReactNode[] = [];
  if (pb.name) {
    metaItems.push(<span key="pb">{pb.name}</span>);
  }

  if (isGuide || type === 'Issue') {
    // Both Issue and Guide: Playbook Name · Status · Difficulty · JIRA CODE
    if (item.status) {
      metaItems.push(<span key="status">{item.status}</span>);
    }
    if ('difficulty' in item && item.difficulty) {
      metaItems.push(<span key="diff">{item.difficulty}</span>);
    }
    if (jiraCode) {
      metaItems.push(<span key="jira" className="jira-badge">JIRA {jiraCode}</span>);
    }
  } else if (isSop) {
    // SOP: Playbook Name · Status · Estimated Time (no Jira, no owner, no updated date)
    if (item.status) {
      metaItems.push(<span key="status">{item.status}</span>);
    }
    if (item.estimatedTime) {
      metaItems.push(<span key="time">{item.estimatedTime}</span>);
    }
  }

  const badgeClass = `type-badge type-badge-${type.toLowerCase()}`;

  return (
    <a className="content-row" href={`#/playbooks/${pb.slug}/${folder}/${encodeURIComponent(item.id)}`}>
      <div className="row-content">
        <div className="row-header">
          <span className={badgeClass}>{type.toUpperCase()}</span>
          <span className="row-code">{item.id}</span>
        </div>
        <div className="row-title">{item.title}</div>
        {description && <p className="row-desc">{description}</p>}
        {metaItems.length > 0 && (
          <div className="row-meta">
            {metaItems.map((meta, idx) => (
              <Fragment key={idx}>
                {idx > 0 && <span className="meta-sep" aria-hidden="true">·</span>}
                {meta}
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <ArrowRight size={18} aria-hidden="true" />
    </a>
  );
}
