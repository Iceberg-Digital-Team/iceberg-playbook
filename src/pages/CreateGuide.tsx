import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useRouter } from '../router';
import {
  guideContent,
  formatGuideVersion,
  type GuideContent,
  type VersionedGuide,
  type Step,
  type CommonProblem,
  type Issue,
  type Playbook
} from '../data';
import { listPlaybooks } from '../services/playbookService';
import { listIssues } from '../services/issueService';
import { listGuides, createGuide, publishGuideVersion, getGuideById } from '../services/guideService';
import { guideChecklist } from '../guideTemplate';
import { GuideArticle } from '../components/knowledge/GuideArticle';
import { IssueSelector } from '../components/knowledge/IssueSelector';
import { PageHeader, FormSection, StateMessage } from '../components/knowledge/ApplicationUI';
import { StringList, StepEditor, revealInvalid } from '../components/knowledge/EditorFields';
import { MediaUploadField } from '../components/knowledge/MediaUploadField';
import { type FileMetadata } from '../components/knowledge/mediaUtils';

export function CreateGuide() {
  const { path, params } = useRouter();
  const isEdit = path === '/guides/[id]/edit';
  const [initial, setInitial] = useState<VersionedGuide | null | undefined>(isEdit ? undefined : null);
  const [loading, setLoading] = useState(isEdit && Boolean(params.id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (isEdit && params.id) {
      getGuideById(params.id)
        .then(guide => {
          if (!active) return;
          setInitial(guide);
          setLoading(false);
        })
        .catch(err => {
          if (!active) return;
          setError(err instanceof Error ? err.message : 'Failed to load Guide.');
          setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [isEdit, params.id]);

  if (loading) {
    return (
      <div className="editor">
        <StateMessage title="Loading Guide…">
          Retrieving guide for editing…
        </StateMessage>
      </div>
    );
  }

  if (error) {
    return (
      <div className="editor">
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

  if (path === '/guides/[id]/edit' && !initial) {
    return (
      <StateMessage
        title="Guide not found"
        action={<a href="#/playbooks">Back to Playbooks</a>}
      />
    );
  }

  return <GuideEditor key={initial?.id || 'new'} initial={initial || undefined} />;
}

function GuideEditor({ initial }: { initial?: VersionedGuide }) {
  const { navigate, params } = useRouter();
  const [base] = useState(initial);
  const [issueId, setIssueId] = useState(base?.issueId || params.issue || '');
  const [title, setTitle] = useState(base?.title || '');
  const [summary, setSummary] = useState(base?.summary || '');
  const [status, setStatus] = useState<GuideContent['status']>(base?.status || 'Draft');
  const [difficulty, setDifficulty] = useState<GuideContent['difficulty']>(base?.difficulty || 'Medium');
  const [estimatedTime, setEstimatedTime] = useState(base?.estimatedTime || '15 min');
  const [checklist, setChecklist] = useState(base ? guideChecklist(base) : []);
  const [info, setInfo] = useState(base?.importantInformation || '');
  const [video, setVideo] = useState(base?.video || '');
  const [pdf, setPdf] = useState(base?.pdf || '');
  const [videoMeta, setVideoMeta] = useState<FileMetadata | null>(null);
  const [pdfMeta, setPdfMeta] = useState<FileMetadata | null>(null);
  const [steps, setSteps] = useState<Array<Omit<Step, 'number'>>>(
    base ? structuredClone(base.steps) : [{ title: '', description: '' }]
  );
  const [problems, setProblems] = useState<CommonProblem[]>(
    base ? structuredClone(base.commonProblems) : []
  );
  const [notes, setNotes] = useState(base?.internalNotes || '');
  const [changes, setChanges] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [guides, setGuides] = useState<VersionedGuide[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      listPlaybooks(),
      listIssues(),
      listGuides()
    ])
      .then(([pbList, issueList, guideList]) => {
        if (!active) return;
        setPlaybooks(pbList);
        setIssues(issueList);
        setGuides(guideList);
        setLoadingData(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load options.');
        setLoadingData(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const issue = issues.find(i => i.id === issueId);
  const pb = playbooks.find(p => p.id === issue?.playbookId);
  const existing = issue ? guides.find(g => g.issueId === issue.id) : undefined;
  const blocked = !issue || !pb || (!base && !!existing);

  // Do not rewrite legacy content merely by opening the editor. Preserve archived fields.
  const checklistChanged = !base || JSON.stringify(checklist) !== JSON.stringify(guideChecklist(base));
  const content: GuideContent = {
    title,
    summary,
    status,
    difficulty,
    estimatedTime,
    video,
    pdf,
    steps: steps.map((s, i) => ({ ...s, number: i + 1 })),
    beforeYouStart: checklistChanged ? checklist.map(s => s.trim()).filter(Boolean) : base!.beforeYouStart,
    requirements: checklistChanged ? [] : base!.requirements,
    importantInformation: info,
    commonProblems: problems.filter(p => p.problem.trim()),
    internalNotes: notes,
    faq: base?.faq || [],
    relatedItems: base?.relatedItems || []
  };

  const hasChanges = !base || JSON.stringify(guideContent(content)) !== JSON.stringify(guideContent(base));
  const back = () => navigate(base && pb ? `/playbooks/${pb.slug}/guides/${base.id}` : '/create');

  const publish = async () => {
    setError('');
    if (blocked || !issue || !pb) {
      setError('Select an existing Issue without a solution Guide.');
      return;
    }
    setSubmitting(true);
    try {
      if (base) {
        const updated = await publishGuideVersion({
          guideId: base.id,
          expectedVersionId: base.currentVersionId,
          changeSummary: changes,
          content: {
            title: content.title,
            summary: content.summary,
            status: content.status,
            difficulty: content.difficulty,
            estimatedTime: content.estimatedTime,
            beforeYouStart: content.beforeYouStart,
            requirements: content.requirements,
            importantInformation: content.importantInformation,
            video: content.video,
            pdf: content.pdf,
            steps: content.steps,
            commonProblems: content.commonProblems,
            faq: content.faq,
            relatedItems: content.relatedItems,
            internalNotes: content.internalNotes
          }
        });
        navigate(`/playbooks/${pb.slug}/guides/${updated.id}`);
      } else {
        const saved = await createGuide({
          issueId: issue.id,
          playbookId: pb.id,
          title: content.title,
          summary: content.summary,
          status: content.status,
          difficulty: content.difficulty,
          estimatedTime: content.estimatedTime,
          beforeYouStart: content.beforeYouStart,
          requirements: content.requirements,
          importantInformation: content.importantInformation,
          video: content.video,
          pdf: content.pdf,
          steps: content.steps,
          commonProblems: content.commonProblems,
          faq: content.faq,
          relatedItems: content.relatedItems,
          internalNotes: content.internalNotes
        });
        navigate(`/playbooks/${pb.slug}/guides/${saved.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish the Guide.');
      setSubmitting(false);
    }
  };

  if (preview && base) {
    return (
      <div className="guide-article">
        <section className="issue-connection">
          <h2>Preview Changes</h2>
          <p>Unpublished changes · Current Guide remains v{formatGuideVersion(base.versionNumber)}.</p>
          <div className="inline-actions">
            <button className="btn-secondary" onClick={() => setPreview(false)}>
              Back to Editing
            </button>
            <button className="btn-primary" disabled={!hasChanges} onClick={publish}>
              Publish Update
            </button>
          </div>
        </section>
        {error && <p className="knowledge-error" role="alert">{error}</p>}
        <GuideArticle
          guide={{ ...base, ...structuredClone(content) }}
          versionLabel="Unpublished preview"
          playbook={pb}
          issue={issue}
        />
      </div>
    );
  }

  return (
    <div className="editor">
      <button className="back-link" onClick={back}>
        <ArrowLeft size={14} />{base ? 'Back to Guide' : 'Back to Create'}
      </button>
      <PageHeader
        title={base ? 'Edit Guide' : 'Create Guide'}
        description="Document the solution to an existing Issue."
      />
      <form onInvalid={revealInvalid} onSubmit={e => { e.preventDefault(); publish(); }}>
        <FormSection
          title="Related Issue"
          hint={base ? undefined : 'Select the problem this Guide solves. The Playbook is inherited automatically.'}
        >
          {base ? (
            <div>
              <a href={`#/playbooks/${pb?.slug}/issues/${issueId}`}>
                {issueId} — {issue?.title}
              </a>
              <p className="helper-text">{pb?.name} · {base.id}</p>
            </div>
          ) : (
            <IssueSelector
              value={issueId}
              onChange={setIssueId}
              issues={issues}
              playbooks={playbooks}
              hasGuide={id => guides.some(g => g.issueId === id)}
            />
          )}
          {!base && existing && (
            <p role="status">
              This Issue already has a Guide.{' '}
              <a href={`#/playbooks/${pb?.slug}/guides/${existing.id}`}>Open existing Guide →</a>
            </p>
          )}
          {loadingData && <p className="helper-text">Loading available issues…</p>}
        </FormSection>

        {issue && !blocked && (
          <>
            <FormSection title="Header">
              <label>
                Guide Title *
                <input
                  required
                  aria-label="Guide Title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="How to resolve…"
                />
              </label>
              <div className="form-grid">
                <label>
                  Status
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as GuideContent['status'])}
                  >
                    <option>Draft</option>
                    <option>Verified</option>
                  </select>
                </label>
                <label>
                  Estimated Time
                  <input
                    value={estimatedTime}
                    onChange={e => setEstimatedTime(e.target.value)}
                  />
                </label>
              </div>
              <details className="disclosure">
                <summary>Additional metadata</summary>
                <div className="optional-fields">
                  <label>
                    Playbook
                    <input readOnly value={pb?.name || ''} />
                  </label>
                  <label>
                    Difficulty
                    <select
                      value={difficulty}
                      onChange={e => setDifficulty(e.target.value as GuideContent['difficulty'])}
                    >
                      <option>Easy</option>
                      <option>Medium</option>
                      <option>Advanced</option>
                    </select>
                  </label>
                </div>
              </details>
            </FormSection>

            <FormSection
              title="Summary"
              hint="Explain what this solves, when to use it and the expected outcome in 2–4 sentences."
            >
              <label>
                Guide Summary *
                <textarea
                  aria-label="Guide Summary"
                  required
                  rows={4}
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                />
              </label>
            </FormSection>

            <FormSection
              title="Before You Start"
              hint="Access, identifiers and permissions needed before following the solution."
            >
              <StringList label="Checklist item" values={checklist} onChange={setChecklist} />
            </FormSection>

            <FormSection title="Important Information" optional open={!!info}>
              <label>
                Warnings & limitations
                <textarea value={info} rows={3} onChange={e => setInfo(e.target.value)} />
              </label>
            </FormSection>

            <FormSection title="Video Tutorial" optional open={!!video}>
              <MediaUploadField
                type="video"
                accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                acceptedFormatsText="Accepted formats: MP4, WebM, MOV"
                dropText="Drag & drop a video here"
                buttonText="Choose Video"
                value={video}
                initialValue={base?.video}
                fileMeta={videoMeta}
                onChange={(url, file) => {
                  setVideo(url);
                  setVideoMeta(file ? { name: file.name, size: file.size } : null);
                }}
              />
            </FormSection>

            <FormSection title="Step-by-Step">
              <StepEditor steps={steps} initialSteps={base?.steps} onChange={setSteps} />
            </FormSection>

            <FormSection title="PDF Guide" optional open={!!pdf}>
              <MediaUploadField
                type="pdf"
                accept="application/pdf,.pdf"
                acceptedFormatsText="Accepted format: PDF"
                dropText="Drag & drop a PDF here"
                buttonText="Choose PDF"
                value={pdf}
                initialValue={base?.pdf}
                fileMeta={pdfMeta}
                onChange={(url, file) => {
                  setPdf(url);
                  setPdfMeta(file ? { name: file.name, size: file.size } : null);
                }}
              />
            </FormSection>

            <FormSection
              title="Common Problems"
              optional
              open={!!problems.length}
              hint="Small troubleshooting notes for problems encountered while following these steps."
            >
              {problems.map((p, i) => (
                <div className="form-section-body" key={i}>
                  {(['problem', 'cause', 'solution'] as const).map(field => (
                    <label key={field}>
                      {field[0].toUpperCase() + field.slice(1)}
                      <textarea
                        rows={2}
                        value={p[field]}
                        onChange={e =>
                          setProblems(
                            problems.map((v, n) => (n === i ? { ...v, [field]: e.target.value } : v))
                          )
                        }
                      />
                    </label>
                  ))}
                  <button
                    className="back-link"
                    type="button"
                    onClick={() => setProblems(problems.filter((_, n) => n !== i))}
                  >
                    <Trash2 size={14} />Remove problem {i + 1}
                  </button>
                </div>
              ))}
              <button
                className="btn-secondary"
                type="button"
                onClick={() => setProblems([...problems, { problem: '', cause: '', solution: '' }])}
              >
                <Plus size={14} />Add Problem
              </button>
            </FormSection>

            <FormSection title="Internal Notes" optional open={!!notes}>
              <p className="helper-text">Support Only</p>
              <label>
                Internal Notes
                <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
              </label>
            </FormSection>

            {base ? (
              <FormSection title="Publish Update">
                <label>
                  What did you change?
                  <textarea
                    rows={2}
                    value={changes}
                    onChange={e => setChanges(e.target.value)}
                    placeholder="Updated Step 4 after the Meta interface changed."
                  />
                </label>
                <p className="helper-text">A new version is created when you publish. Earlier versions remain available.</p>
              </FormSection>
            ) : (
              <p className="helper-text">Publishing creates v1.0 and starts Version History.</p>
            )}
            {base && !hasChanges && <p className="helper-text">No content changes to publish.</p>}
          </>
        )}

        {error && <p role="alert" className="knowledge-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={back} disabled={submitting}>
            Cancel
          </button>
          {base && (
            <button
              className="btn-secondary"
              type="button"
              onClick={e => {
                if (e.currentTarget.form?.reportValidity()) setPreview(true);
              }}
            >
              Preview Changes
            </button>
          )}
          <button
            className="btn-primary"
            type="submit"
            disabled={blocked || !hasChanges || submitting}
          >
            {submitting ? 'Publishing…' : base ? 'Publish Update' : 'Publish Guide'}
          </button>
        </div>
      </form>
    </div>
  );
}
