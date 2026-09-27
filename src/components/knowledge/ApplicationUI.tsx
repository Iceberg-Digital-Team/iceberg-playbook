import { Search, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { getPlaybooks, getSolutionState, formatGuideDate, formatGuideVersion, type Issue, type VersionedGuide, type SOP, type Playbook } from '../../data';

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
export function ContentRow({ item, excerpt = false, playbook }: { item: ContentItem; excerpt?: boolean; playbook?: Playbook }) {
  const pb = playbook || getPlaybooks().find(p => p.id === item.playbookId);
  const type = 'issueId' in item ? 'Guide' : 'owner' in item ? 'SOP' : 'Issue';
  const folder = type === 'Guide' ? 'guides' : type === 'SOP' ? 'sops' : 'issues';
  if (!pb) return null;
  return <a className="content-row" href={`#/playbooks/${pb.slug}/${folder}/${encodeURIComponent(item.id)}`}>
    <span className="row-code">{item.id}</span><div className="row-content"><div className="row-title">{item.title}</div>
    <div className="row-meta"><span>{type}</span><span>{pb.name}</span>{'issueId' in item ? <><span>Solves {item.issueId}</span><span>v{formatGuideVersion(item.versionNumber)}</span></> : type === 'Issue' ? <span>{getSolutionState(item.id)}</span> : <span>{'owner' in item ? item.owner : ''}</span>}
      {item.estimatedTime && <span>{item.estimatedTime}</span>}<span>{item.status}</span>{'difficulty' in item && <span>{item.difficulty}</span>}<span>Updated {formatGuideDate(item.updatedAt)}</span></div>
    {excerpt && <p className="row-excerpt">{'summary' in item ? item.summary : item.purpose}</p>}</div><ArrowRight size={17} aria-hidden="true" />
  </a>;
}
