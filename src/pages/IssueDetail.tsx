import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Share2, Link2, Edit, ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useRouter } from '../router';
import type { Issue, Playbook, VersionedGuide } from '../data';
import { getPlaybookBySlug } from '../services/playbookService';
import { getIssueById, softDeleteIssue } from '../services/issueService';
import { getPrimaryGuideByIssue } from '../services/guideService';
import { formatGuideVersion, formatGuideDate } from '../data';
import { ArticleHeader, SummarySection, InternalNotes } from '../components/article/ArticleComponents';
import { StateMessage } from '../components/knowledge/ApplicationUI';
import { safeMediaUrl } from '../guideTemplate';

function DeleteIssueDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.showModal();
    }
    return () => el?.close();
  }, []);

  return (
    <dialog
      className="guide-restore-dialog"
      ref={ref}
      aria-labelledby="delete-issue-title"
      onCancel={e => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="delete-issue-title">Delete Issue?</h2>
      <p>
        This Issue will be removed from active views.
        <br />
        Its database record and audit history will be preserved.
      </p>
      <div className="knowledge-actions">
        <button autoFocus className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn-primary"
          style={{ background: '#d32f2f', borderColor: '#d32f2f' }}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Deleting…' : 'Delete Issue'}
        </button>
      </div>
    </dialog>
  );
}

export function IssueDetail() {
  const { params, navigate } = useRouter();
  const [message, setMessage] = useState('');
  const [pb, setPb] = useState<Playbook | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [guide, setGuide] = useState<VersionedGuide | null>(null);
  const [loading, setLoading] = useState(Boolean(params.slug && params.id));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    if (!params.slug || !params.id) {
      return;
    }
    Promise.all([
      getPlaybookBySlug(params.slug),
      getIssueById(params.id),
      getPrimaryGuideByIssue(params.id)
    ])
      .then(([playbookData, issueData, guideData]) => {
        if (!active) return;
        setPb(playbookData);
        if (issueData && playbookData && issueData.playbookId === playbookData.id) {
          setIssue(issueData);
          setGuide(guideData);
        } else {
          setIssue(null);
          setGuide(null);
        }
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load Issue.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [params.slug, params.id]);

  if (loading) {
    return (
      <div className="page reading-page">
        <StateMessage title="Loading Issue…">
          Retrieving issue details…
        </StateMessage>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page reading-page">
        <StateMessage
          error
          title="Unable to load Issue"
          action={<a href="#/playbooks">Back to Playbooks</a>}
        >
          {error}
        </StateMessage>
      </div>
    );
  }

  if (!issue || !pb) {
    return (
      <StateMessage
        title="Issue not found"
        action={<a href="#/playbooks">Back to Playbooks</a>}
      >
        Choose an existing problem from a Playbook.
      </StateMessage>
    );
  }

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
      await navigator.share({ title: issue.title, url: window.location.href });
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setMessage('Could not share the Issue.');
      }
    }
  };

  const handleDelete = async () => {
    if (!issue || !pb) return;
    setDeleting(true);
    try {
      await softDeleteIssue(issue.id);
      setConfirmDelete(false);
      navigate(`/playbooks/${pb.slug}`);
    } catch (err) {
      setConfirmDelete(false);
      setDeleting(false);
      setMessage(err instanceof Error ? err.message : 'Could not delete Issue.');
    }
  };

  return (
    <div className="page reading-page">
      <div className="toolbar">
        <a className="back-link" href={`#/playbooks/${pb.slug}`}>
          <ArrowLeft size={14} />Back to {pb.name} Playbook
        </a>
        <div className="inline-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate(`/issues/${encodeURIComponent(issue.id)}/edit`)}
          >
            <Edit size={14} />Edit
          </button>
          <button className="btn-secondary" onClick={share}>
            <Share2 size={14} />Share
          </button>
          <button className="btn-secondary" onClick={copy}>
            <Link2 size={14} />Copy Link
          </button>
          <button
            className="btn-secondary"
            style={{ color: '#d32f2f' }}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} />Delete
          </button>
        </div>
      </div>
      {message && (
        <p className="helper-text" role="status">
          {message}
        </p>
      )}
      <ArticleHeader
        code={issue.id}
        title={issue.title}
        status={issue.status}
        playbookName={pb.name}
        difficulty={issue.difficulty}
        estimatedTime={issue.estimatedTime}
        updatedAt={formatGuideDate(issue.updatedAt)}
        authorOrOwner={issue.author}
        type="Issue"
        jiraCode={issue.jiraCode}
      />
      {issue.jiraCode && (
        <SummarySection text={issue.jiraCode} title="Jira Code" />
      )}
      <SummarySection text={issue.summary} title="Problem Summary" />
      <section className="article-section">
        <h2>Symptoms</h2>
        {issue.symptoms.length ? (
          <ul className="plain-list">
            {issue.symptoms.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p>No symptoms documented yet.</p>
        )}
      </section>
      {issue.errorMessage && (
        <SummarySection text={issue.errorMessage} title="Error Message / Code" />
      )}
      {issue.context && (
        <SummarySection text={issue.context} title="When Does This Happen?" />
      )}
      {issue.affectedArea && (
        <SummarySection text={issue.affectedArea} title="Affected Area" />
      )}
      <section className="article-section">
        <h2>Information to Collect</h2>
        {issue.informationToCollect.length ? (
          <ul className="plain-list">
            {issue.informationToCollect.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p>No information requirements documented yet.</p>
        )}
      </section>
      {!!issue.attachments.length && (
        <section className="article-section">
          <h2>Attachments</h2>
          {issue.attachments.map((a, i) => (
            <div className="document-row" key={i}>
              <a href={safeMediaUrl(a.url)} target="_blank" rel="noreferrer">
                {a.name || a.url}
              </a>
            </div>
          ))}
        </section>
      )}
      <InternalNotes notes={issue.internalNotes} />
      <section className="issue-connection" aria-labelledby="solution-guide-heading">
        <h3 id="solution-guide-heading">Solution Guide</h3>
        {guide ? (
          <>
            <p className="helper-text">Solution Available</p>
            <h2>{guide.title}</h2>
            <p className="helper-text">
              {guide.status} · {guide.estimatedTime} · Current version: v
              {formatGuideVersion(guide.versionNumber)} · Updated {formatGuideDate(guide.updatedAt)}
            </p>
            <a className="btn-primary" href={`#/playbooks/${pb.slug}/guides/${guide.id}`}>
              Open Guide<ArrowRight size={16} />
            </a>
          </>
        ) : (
          <>
            <h2>Guide Needed</h2>
            <p>This problem has been documented but does not have a solution Guide yet.</p>
            <a
              className="btn-primary"
              href={`#/create/guide?issue=${encodeURIComponent(issue.id)}`}
            >
              <Plus size={16} />Create Guide
            </a>
          </>
        )}
      </section>
      {confirmDelete && (
        <DeleteIssueDialog
          busy={deleting}
          onCancel={() => {
            if (!deleting) setConfirmDelete(false);
          }}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
