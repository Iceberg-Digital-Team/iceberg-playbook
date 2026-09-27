import { useState, useEffect } from 'react';
import { ArrowLeft, Edit, Link2, Share2 } from 'lucide-react';
import { useRouter } from '../router';
import {
  formatGuideVersion,
  formatGuideDate,
  type Playbook,
  type VersionedGuide,
  type Issue,
  type GuideVersion
} from '../data';
import { getPlaybookBySlug } from '../services/playbookService';
import { getGuideById, listGuideVersions, restoreGuideVersion } from '../services/guideService';
import { getIssueById } from '../services/issueService';
import { GuideArticle } from '../components/knowledge/GuideArticle';
import { GuideHistory, RestoreGuideDialog } from '../components/knowledge/GuideHistory';
import '../components/knowledge/Knowledge.css';
import { StateMessage } from '../components/knowledge/ApplicationUI';

export function GuideDetail() {
  const { params, navigate } = useRouter();
  const [message, setMessage] = useState('');
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [current, setCurrent] = useState<VersionedGuide | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [versions, setVersions] = useState<GuideVersion[]>([]);
  const [loading, setLoading] = useState(Boolean(params.slug && params.id));
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);


  useEffect(() => {
    let active = true;
    if (!params.slug || !params.id) {
      return;
    }
    Promise.all([
      getPlaybookBySlug(params.slug),
      getGuideById(params.id)
    ])
      .then(async ([pbData, guideData]) => {
        if (!active) return;
        setPlaybook(pbData);
        if (guideData && pbData && guideData.playbookId === pbData.id) {
          setCurrent(guideData);
          try {
            const [issueData, versionData] = await Promise.all([
              guideData.issueId ? getIssueById(guideData.issueId) : Promise.resolve(null),
              listGuideVersions(guideData.id)
            ]);
            if (active) {
              setIssue(issueData);
              setVersions(versionData);
            }
          } catch {
            // Non-fatal if issue or versions cannot be loaded
          }
        } else {
          setCurrent(null);
        }
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load Guide.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [params.slug, params.id]);

  if (loading) {
    return (
      <div className="guide-article">
        <StateMessage title="Loading Guide…">
          Retrieving guide details…
        </StateMessage>
      </div>
    );
  }

  if (error) {
    return (
      <div className="guide-article">
        <StateMessage
          error
          title="Unable to load Guide"
          action={<a href="#/playbooks">Back to Playbooks</a>}
        >
          {error}
        </StateMessage>
      </div>
    );
  }

  if (!current || !playbook) {
    return (
      <StateMessage
        title="Guide not found"
        action={<a href="#/playbooks">Back to Playbooks</a>}
      />
    );
  }

  const baseUrl = `#/playbooks/${playbook.slug}/guides/${current.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage('Link copied.');
    } catch {
      setMessage('Could not copy the link. Copy the address from your browser.');
    }
  };

  const share = async () => {
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: current.title, url: window.location.href });
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setMessage('Could not share the Guide.');
      }
    }
  };

  const handleRestore = async () => {
    if (!current || !selectedVersion) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const restoredGuide = await restoreGuideVersion({
        guideId: current.id,
        targetVersionId: selectedVersion.id,
        expectedVersionId: current.currentVersionId
      });
      setShowRestoreConfirm(false);
      setCurrent(restoredGuide);
      const updatedVersions = await listGuideVersions(restoredGuide.id);
      setVersions(updatedVersions);
      navigate(`/playbooks/${playbook.slug}/guides/${restoredGuide.id}`);
      setMessage(`Restored version v${formatGuideVersion(selectedVersion.versionNumber)} as new current version v${formatGuideVersion(restoredGuide.versionNumber)}.`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to restore Guide version.';
      setRestoreError(errMsg);
      setMessage(errMsg);
      setShowRestoreConfirm(false);
    } finally {
      setRestoring(false);
    }
  };

  const selectedVersion = params.version
    ? versions.find(v => v.id === params.version)
    : undefined;
  const historical = Boolean(selectedVersion && selectedVersion.id !== current.currentVersionId);
  const displayed: VersionedGuide = selectedVersion
    ? {
        ...current,
        title: selectedVersion.title,
        summary: selectedVersion.summary,
        status: selectedVersion.status,
        difficulty: selectedVersion.difficulty,
        estimatedTime: selectedVersion.estimatedTime,
        beforeYouStart: selectedVersion.beforeYouStart,
        requirements: selectedVersion.requirements,
        importantInformation: selectedVersion.importantInformation,
        video: selectedVersion.video,
        pdf: selectedVersion.pdf,
        steps: selectedVersion.steps,
        commonProblems: selectedVersion.commonProblems,
        faq: selectedVersion.faq,
        relatedItems: selectedVersion.relatedItems,
        internalNotes: selectedVersion.internalNotes,
        updatedAt: selectedVersion.createdAt,
        author: selectedVersion.createdBy
      }
    : current;

  const initialVersionItem: GuideVersion = {
    id: current.currentVersionId,
    guideId: current.id,
    versionNumber: current.versionNumber,
    changeSummary: 'Initial Guide created.',
    createdAt: current.createdAt,
    createdBy: current.createdBy,
    title: current.title,
    summary: current.summary,
    status: current.status,
    difficulty: current.difficulty,
    estimatedTime: current.estimatedTime,
    beforeYouStart: current.beforeYouStart,
    requirements: current.requirements,
    importantInformation: current.importantInformation,
    video: current.video,
    pdf: current.pdf,
    steps: current.steps,
    commonProblems: current.commonProblems,
    faq: current.faq,
    relatedItems: current.relatedItems,
    internalNotes: current.internalNotes
  };

  return (
    <div className="guide-article">
      <div className="knowledge-actions guide-toolbar">
        <button
          className="btn-secondary"
          onClick={() => navigate(`/playbooks/${playbook.slug}`)}
        >
          <ArrowLeft size={14} />Back to {playbook.name} Playbook
        </button>
        <div className="knowledge-actions">
          {!historical && (
            <button
              className="btn-secondary"
              onClick={() => navigate(`/guides/${current.id}/edit`)}
            >
              <Edit size={14} />Edit Guide
            </button>
          )}
          <button className="btn-secondary" onClick={share}>
            <Share2 size={14} />Share
          </button>
          <button className="btn-secondary" onClick={copy}>
            <Link2 size={14} />Copy Link
          </button>
        </div>
      </div>
      {restoreError && (
        <div style={{ color: '#d32f2f', margin: '8px 0', fontWeight: 500 }} role="alert">
          {restoreError}
        </div>
      )}
      {message && !restoreError && <p className="helper-text" role="status">{message}</p>}
      {historical && selectedVersion && (
        <section className="issue-connection">
          <h2>You are viewing an older version</h2>
          <p>
            Version {formatGuideVersion(selectedVersion.versionNumber)} ·{' '}
            {formatGuideDate(selectedVersion.createdAt)} · {selectedVersion.createdBy}
          </p>
          <div className="knowledge-actions">
            <a className="btn-secondary" href={baseUrl}>
              Back to Current Version
            </a>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setRestoreError(null);
                setShowRestoreConfirm(true);
              }}
            >
              Restore this version
            </button>
          </div>
        </section>
      )}
      {showRestoreConfirm && selectedVersion && (
        <RestoreGuideDialog
          current={current.versionNumber}
          target={selectedVersion.versionNumber}
          busy={restoring}
          onCancel={() => {
            if (!restoring) setShowRestoreConfirm(false);
          }}
          onRestore={handleRestore}
        />
      )}
      <GuideArticle
        key={selectedVersion?.id || current.currentVersionId}
        guide={displayed}
        versionLabel={`${historical && selectedVersion ? 'Viewing version' : 'Current version'}: v${formatGuideVersion(selectedVersion?.versionNumber || current.versionNumber)}`}
        playbook={playbook}
        issue={issue}
      />
      <GuideHistory
        guide={current}
        versions={versions.length ? versions : [initialVersionItem]}
        baseUrl={baseUrl}
      />
    </div>
  );
}
