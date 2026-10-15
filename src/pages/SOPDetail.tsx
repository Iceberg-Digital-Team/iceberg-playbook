import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Edit, Link2, Share2, Trash2 } from 'lucide-react';
import { useRouter } from '../router';
import type { Playbook, SOP, Step } from '../data';
import { formatGuideDate } from '../data';
import { getPlaybookBySlug } from '../services/playbookService';
import { getSopById, softDeleteSop } from '../services/sopService';
import { resolveStepMedia } from '../services/mediaService';
import { getIssueById } from '../services/issueService';
import { getGuideById } from '../services/guideService';
import {
  ArticleHeader,
  SummarySection,
  RequirementsSection,
  StepsSection,
  InternalNotes,
  RevisionHistory
} from '../components/article/ArticleComponents';
import { ContentRow, StateMessage, type ContentItem } from '../components/knowledge/ApplicationUI';

function DeleteSOPDialog({
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
      aria-labelledby="delete-sop-title"
      onCancel={e => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="delete-sop-title">Delete SOP?</h2>
      <p>
        This SOP will be removed from active views.
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
          {busy ? 'Deleting…' : 'Delete SOP'}
        </button>
      </div>
    </dialog>
  );
}

export function SOPDetail() {
  const { params, navigate } = useRouter();
  const [completed, setCompleted] = useState<Record<number, boolean>>({});
  const [message, setMessage] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pb, setPb] = useState<Playbook | null>(null);
  const [sop, setSop] = useState<SOP | null>(null);
  const [resolvedSteps, setResolvedSteps] = useState<Step[]>([]);
  const [related, setRelated] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(Boolean(params.slug && params.id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function resolveMedia() {
      if (!sop?.steps?.length) {
        if (active) setResolvedSteps([]);
        return;
      }

      try {
        const steps = await resolveStepMedia(sop.steps);
        if (active) setResolvedSteps(steps);
      } catch (err) {
        console.warn('Could not resolve SOP media URLs:', err);
        if (active) setResolvedSteps(sop.steps);
      }
    }

    resolveMedia();

    return () => {
      active = false;
    };
  }, [sop?.id, sop?.steps]);

  useEffect(() => {
    let active = true;
    if (!params.slug || !params.id) {
      return;
    }

    Promise.all([
      getPlaybookBySlug(params.slug),
      getSopById(params.id)
    ])
      .then(async ([playbookData, sopData]) => {
        if (!active) return;
        setPb(playbookData);
        if (sopData && playbookData && sopData.playbookId === playbookData.id) {
          setSop(sopData);

          // Load related issues and guides if any are specified
          const issueIds = sopData.relatedIssues || [];
          const guideIds = sopData.relatedGuides || [];
          if (issueIds.length || guideIds.length) {
            try {
              const [loadedIssues, loadedGuides] = await Promise.all([
                Promise.all(issueIds.map(id => getIssueById(id))),
                Promise.all(guideIds.map(id => getGuideById(id)))
              ]);
              if (active) {
                const combined: ContentItem[] = [
                  ...loadedIssues.filter((i): i is NonNullable<typeof i> => i !== null),
                  ...loadedGuides.filter((g): g is NonNullable<typeof g> => g !== null)
                ];
                setRelated(combined);
              }
            } catch {
              // Non-fatal if related resources fail to load
            }
          }
        } else {
          setSop(null);
        }
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load SOP.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [params.slug, params.id]);

  if (loading) {
    return (
      <div className="page reading-page">
        <StateMessage title="Loading SOP…">
          Retrieving standard operating procedure…
        </StateMessage>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page reading-page">
        <StateMessage
          error
          title="Unable to load SOP"
          action={<a href="#/playbooks">Back to Playbooks</a>}
        >
          {error}
        </StateMessage>
      </div>
    );
  }

  if (!pb || !sop) {
    return (
      <StateMessage
        title="SOP not found"
        action={<a href="#/playbooks">Back to Playbooks</a>}
      >
        Choose an existing standard process.
      </StateMessage>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage('Link copied.');
    } catch {
      setMessage('Could not copy the link.');
    }
  };

  const share = async () => {
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: sop.title, url: window.location.href });
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setMessage('Could not share the SOP.');
      }
    }
  };

  const handleDelete = async () => {
    if (!sop || !pb) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await softDeleteSop(sop.id);
      setDeleting(false);
      setConfirmDelete(false);
      navigate(`/playbooks/${pb.slug}`);
    } catch (err) {
      setConfirmDelete(false);
      setDeleting(false);
      setDeleteError(err instanceof Error ? err.message : 'Could not delete SOP.');
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
            className="btn-secondary"
            onClick={() => navigate(`/sops/${sop.id}/edit`)}
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
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
          >
            <Trash2 size={14} />Delete
          </button>
        </div>
      </div>
      {deleteError && (
        <div style={{ color: '#d32f2f', margin: '8px 0', fontWeight: 500 }} role="alert">
          {deleteError}
        </div>
      )}
      {(params.warning || sop.warning) && !deleteError && (
        <div className="knowledge-warning" role="status" style={{ margin: '12px 0' }}>
          {params.warning || sop.warning}
        </div>
      )}
      {message && !deleteError && <p role="status" className="helper-text">{message}</p>}

      <ArticleHeader
        code={sop.id}
        title={sop.title}
        status={sop.status}
        playbookName={pb.name}
        estimatedTime={sop.estimatedTime}
        authorOrOwner={sop.owner}
        updatedAt={formatGuideDate(sop.updatedAt)}
        type="SOP"
      />

      <SummarySection text={sop.purpose} title="Purpose" />
      <SummarySection text={sop.whenToUse} title="When to Use" />
      <SummarySection text={sop.responsibleTeam} title="Responsible Team" />

      <RequirementsSection requirements={sop.requirements} />

      {!!sop.checklist.length && (
        <section className="article-section">
          <div className="section-heading">
            <h2>Process Checklist</h2>
            <span className="helper-text">
              {sop.checklist.filter((_, i) => completed[i]).length} of {sop.checklist.length} complete
            </span>
          </div>
          <div className="article-checklist">
            {sop.checklist.map((stage, i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  checked={!!completed[i]}
                  onChange={e => setCompleted({ ...completed, [i]: e.target.checked })}
                />
                <span>{stage}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <StepsSection steps={resolvedSteps.length ? resolvedSteps : sop.steps} title="Process Steps" inlineDirectVideo />

      {sop.escalationRules && (
        <section className="article-section">
          <h2>Escalation Rules</h2>
          <div className="quiet-callout">
            <p>{sop.escalationRules}</p>
          </div>
        </section>
      )}

      <SummarySection text={sop.completionCriteria} title="Completion Criteria" />

      {!!related.length && (
        <section>
          <h2>Related Resources</h2>
          {related.map(item => (
            <ContentRow key={item.id} item={item} playbook={item.playbookId === pb?.id ? pb : undefined} />
          ))}
        </section>
      )}

      <InternalNotes notes={sop.internalNotes} />
      <RevisionHistory history={sop.revisionHistory} />

      {confirmDelete && (
        <DeleteSOPDialog
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
