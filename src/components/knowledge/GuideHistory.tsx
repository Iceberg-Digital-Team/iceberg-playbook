import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatGuideDate, formatGuideVersion, type GuideVersion, type VersionedGuide } from '../../data';

export function GuideHistory({ guide, versions, baseUrl }: { guide: VersionedGuide; versions: GuideVersion[]; baseUrl: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const currentVersion = versions.find(v => v.id === guide.currentVersionId);
  const currentVersionNumber = currentVersion ? currentVersion.versionNumber : guide.versionNumber;
  const currentUpdatedAt = currentVersion ? currentVersion.createdAt : guide.updatedAt;

  const totalVersions = versions.length;
  const countLabel = `${totalVersions} ${totalVersions === 1 ? 'version' : 'versions'}`;

  const INITIAL_LIMIT = 5;
  const visibleVersions = showAll ? versions : versions.slice(0, INITIAL_LIMIT);
  const hasOlder = totalVersions > INITIAL_LIMIT;

  return <section className="guide-history-section" aria-labelledby="guide-history-heading">
    <h2 className="guide-history-heading-wrap">
      <button
        type="button"
        id="guide-history-toggle"
        className="guide-history-toggle"
        aria-expanded={isOpen}
        aria-controls="guide-history-panel"
        onClick={() => setIsOpen(open => !open)}
      >
        <span className="guide-history-header-main">
          <span className="guide-history-header-title-row">
            <span id="guide-history-heading" className="guide-history-title">Version History</span>
            <span className="guide-history-header-meta">
              <span className="guide-history-count">{countLabel}</span>
              <ChevronDown className={`guide-history-chevron ${isOpen ? 'is-expanded' : ''}`} size={18} aria-hidden="true" />
            </span>
          </span>
          <span className="guide-history-summary-sub">
            Current: v{formatGuideVersion(currentVersionNumber)} · Updated {formatGuideDate(currentUpdatedAt)}
          </span>
        </span>
      </button>
    </h2>

    {isOpen && <div id="guide-history-panel" className="guide-history-panel" role="region" aria-labelledby="guide-history-heading">
      <ol className="guide-history">{visibleVersions.map(version => {
        let restoredFromLabel: string | null = null;
        if (version.restoredFromVersionId) {
          const sourceVersion = versions.find(v => v.id === version.restoredFromVersionId);
          restoredFromLabel = sourceVersion
            ? `Restored from v${formatGuideVersion(sourceVersion.versionNumber)}`
            : 'Restored version';
        }

        return (
          <li key={version.id}>
            <div className="guide-version-line">
              <strong>v{formatGuideVersion(version.versionNumber)}</strong>
              <span>{formatGuideDate(version.createdAt)}</span>
              <span>{version.createdBy}</span>
              {restoredFromLabel && (
                <span className="guide-restored-tag" style={{ color: 'var(--secondary-text)', fontSize: '12px' }}>
                  ({restoredFromLabel})
                </span>
              )}
              {version.id === guide.currentVersionId ? (
                <span className="guide-current">Current Version</span>
              ) : (
                <a href={`${baseUrl}?version=${encodeURIComponent(version.id)}`}>
                  View Version <span className="home-sr-only">{formatGuideVersion(version.versionNumber)}</span>
                </a>
              )}
            </div>
            <p>{version.changeSummary}</p>
          </li>
        );
      })}</ol>

      {hasOlder && <div className="guide-history-older-wrap">
        <button
          type="button"
          className="guide-history-older-btn"
          onClick={() => setShowAll(prev => !prev)}
          aria-expanded={showAll}
        >
          {showAll ? 'Collapse older versions' : `Show older versions (${totalVersions - INITIAL_LIMIT} more)`}
        </button>
      </div>}

      {!!guide.revisionHistory.length && <details className="guide-legacy"><summary>Earlier revision notes</summary><p>These notes predate version snapshots. Their historical content is unavailable.</p>{guide.revisionHistory.map((r, i) => <p key={i}>{r.date} · {r.updatedBy} · {r.changes}</p>)}</details>}
    </div>}
  </section>;
}

export function RestoreGuideDialog({
  current,
  target,
  busy = false,
  onCancel,
  onRestore
}: {
  current: number;
  target: number;
  busy?: boolean;
  onCancel: () => void;
  onRestore: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog && dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="guide-restore-dialog"
      aria-labelledby="restore-title"
      aria-describedby="restore-description"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="restore-title">Restore this version?</h2>
      <p style={{ margin: '8px 0', fontSize: '13px', color: 'var(--secondary-text)' }}>
        Current: v{formatGuideVersion(current)} · Restoring: v{formatGuideVersion(target)}
      </p>
      <p id="restore-description">
        This will not overwrite existing history. A new Guide version will be created from this snapshot.
      </p>
      <div className="knowledge-actions">
        <button
          type="button"
          autoFocus
          className="btn-secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onRestore}
          disabled={busy}
        >
          {busy ? 'Restoring…' : 'Restore Version'}
        </button>
      </div>
    </dialog>
  );
}
