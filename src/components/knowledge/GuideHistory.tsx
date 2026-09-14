import { useEffect, useRef } from 'react';
import { formatGuideDate, formatGuideVersion, type GuideVersion, type VersionedGuide } from '../../data';

export function GuideHistory({ guide, versions, baseUrl }: { guide: VersionedGuide; versions: GuideVersion[]; baseUrl: string }) {
  return <section aria-labelledby="guide-history-heading">
    <h2 id="guide-history-heading">Version History</h2>
    <ol className="guide-history">{versions.map(version => <li key={version.id}>
      <div className="guide-version-line"><strong>v{formatGuideVersion(version.versionNumber)}</strong><span>{formatGuideDate(version.createdAt)}</span><span>{version.createdBy}</span>
        {version.id === guide.currentVersionId ? <span className="guide-current">Current Version</span> : <a href={`${baseUrl}?version=${encodeURIComponent(version.id)}`}>View Version <span className="home-sr-only">{formatGuideVersion(version.versionNumber)}</span></a>}
      </div><p>{version.changeSummary}</p>
    </li>)}</ol>
    {!!guide.revisionHistory.length && <details className="guide-legacy"><summary>Earlier revision notes</summary><p>These notes predate version snapshots. Their historical content is unavailable.</p>{guide.revisionHistory.map((r, i) => <p key={i}>{r.date} · {r.updatedBy} · {r.changes}</p>)}</details>}
  </section>;
}

export function RestoreGuideDialog({ current, target, onCancel, onRestore }: { current: number; target: number; onCancel: () => void; onRestore: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="guide-restore-dialog" aria-labelledby="restore-title" aria-describedby="restore-description" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="restore-title">Restore version {formatGuideVersion(target)}?</h2>
    <p>Current: v{formatGuideVersion(current)} · Restore: v{formatGuideVersion(target)}</p>
    <p id="restore-description">This will create a new version based on v{formatGuideVersion(target)}. No version history will be deleted.</p>
    <div className="knowledge-actions"><button autoFocus className="btn-secondary" onClick={onCancel}>Cancel</button><button className="btn-primary" onClick={onRestore}>Restore Version</button></div>
  </dialog>;
}
