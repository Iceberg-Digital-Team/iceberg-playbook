import { useState, useEffect } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { useRouter } from '../router';
import type { Issue, Attachment, Playbook } from '../data';
import { listPlaybooks } from '../services/playbookService';
import { createIssue, getIssueById, updateIssue } from '../services/issueService';
import { PageHeader, FormSection, StateMessage } from '../components/knowledge/ApplicationUI';
import { StringList, revealInvalid } from '../components/knowledge/EditorFields';
import { useUnsavedChangesWarning } from '../components/knowledge/useUnsavedChangesWarning';

export function CreateIssue() {
  const { path, params } = useRouter();
  const isEdit = path === '/issues/[id]/edit';
  const [initial, setInitial] = useState<Issue | null | undefined>(isEdit ? undefined : null);
  const [loading, setLoading] = useState(isEdit && Boolean(params.id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (isEdit && params.id) {
      getIssueById(params.id)
        .then(issue => {
          if (!active) return;
          setInitial(issue);
          setLoading(false);
        })
        .catch(err => {
          if (!active) return;
          setError(err instanceof Error ? err.message : 'Failed to load Issue.');
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
        <StateMessage title="Loading Issue…">
          Retrieving issue for editing…
        </StateMessage>
      </div>
    );
  }

  if (error) {
    return (
      <div className="editor">
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

  if (isEdit && !initial) {
    return (
      <div className="editor">
        <StateMessage
          title="Issue not found"
          action={<a href="#/playbooks">Back to Playbooks</a>}
        />
      </div>
    );
  }

  return <IssueEditor key={initial?.id || 'new'} initial={initial || undefined} />;
}

function IssueEditor({ initial }: { initial?: Issue }) {
  const isEdit = Boolean(initial);
  const { navigate, params } = useRouter();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [playbooksLoading, setPlaybooksLoading] = useState(true);
  const [playbookId, setPlaybookId] = useState(initial?.playbookId || params.playbook || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [summary, setSummary] = useState(initial?.summary || '');
  const [jiraCode, setJiraCode] = useState(initial?.jiraCode || '');
  const [status, setStatus] = useState<Issue['status']>(initial?.status || 'Draft');
  const [difficulty, setDifficulty] = useState<Issue['difficulty']>(initial?.difficulty || 'Medium');
  const [time, setTime] = useState(initial?.estimatedTime || '');
  const [symptoms, setSymptoms] = useState<string[]>(initial?.symptoms?.length ? initial.symptoms : ['']);
  const [errorMessage, setErrorMessage] = useState(initial?.errorMessage || '');
  const [context, setContext] = useState(initial?.context || '');
  const [area, setArea] = useState(initial?.affectedArea || '');
  const [information, setInformation] = useState<string[]>(initial?.informationToCollect || []);
  const [attachments, setAttachments] = useState<Attachment[]>(initial?.attachments || []);
  const [notes, setNotes] = useState(initial?.internalNotes || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [defaultPlaybookId, setDefaultPlaybookId] = useState('');

  useEffect(() => {
    let active = true;
    listPlaybooks()
      .then(items => {
        if (!active) return;
        setPlaybooks(items);
        setPlaybooksLoading(false);
        if (!isEdit && items.length > 0) {
          const chosen = (params.playbook && items.some(p => p.id === params.playbook) ? params.playbook : items[0].id);
          setPlaybookId(current => current || chosen);
          setDefaultPlaybookId(current => current || chosen);
        }
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not load Playbooks.');
          setPlaybooksLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [isEdit, params.playbook]);

  const isDirty = isEdit
    ? Boolean(
        initial &&
          (title.trim() !== (initial.title || '').trim() ||
            summary.trim() !== (initial.summary || '').trim() ||
            jiraCode.trim() !== (initial.jiraCode || '').trim() ||
            status !== (initial.status || 'Draft') ||
            difficulty !== (initial.difficulty || 'Medium') ||
            time.trim() !== (initial.estimatedTime || '').trim() ||
            errorMessage.trim() !== (initial.errorMessage || '').trim() ||
            context.trim() !== (initial.context || '').trim() ||
            area.trim() !== (initial.affectedArea || '').trim() ||
            notes.trim() !== (initial.internalNotes || '').trim() ||
            playbookId !== initial.playbookId ||
            JSON.stringify(symptoms.filter(s => s.trim())) !==
              JSON.stringify((initial.symptoms || []).filter(s => s.trim())) ||
            JSON.stringify(information.filter(s => s.trim())) !==
              JSON.stringify((initial.informationToCollect || []).filter(s => s.trim())) ||
            JSON.stringify(attachments) !== JSON.stringify(initial.attachments || []))
      )
    : Boolean(
        title.trim() !== '' ||
          summary.trim() !== '' ||
          jiraCode.trim() !== '' ||
          status !== 'Draft' ||
          difficulty !== 'Medium' ||
          time.trim() !== '' ||
          errorMessage.trim() !== '' ||
          context.trim() !== '' ||
          area.trim() !== '' ||
          notes.trim() !== '' ||
          symptoms.some(s => s.trim() !== '') ||
          information.some(s => s.trim() !== '') ||
          attachments.length > 0 ||
          (defaultPlaybookId && playbookId !== defaultPlaybookId)
      );

  const { DiscardDialog, markClean } = useUnsavedChangesWarning(isDirty);

  const pb = playbooks.find(p => p.id === playbookId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playbookId) {
      setError('Select a Playbook for this Issue.');
      return;
    }
    if (!title.trim() || !summary.trim()) {
      setError('Issue title and problem summary are required.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      if (isEdit && initial) {
        const updated = await updateIssue({
          id: initial.id,
          title: title.trim(),
          summary: summary.trim(),
          jiraCode: jiraCode.trim() || undefined,
          status,
          difficulty,
          estimatedTime: time.trim(),
          symptoms: symptoms.filter(s => s.trim()),
          errorMessage: errorMessage.trim(),
          context: context.trim(),
          affectedArea: area.trim(),
          informationToCollect: information.filter(s => s.trim()),
          attachments: attachments.filter(a => a.url.trim()),
          internalNotes: notes.trim(),
        });
        markClean();
        const targetPb = playbooks.find(p => p.id === playbookId);
        navigate(`/playbooks/${targetPb?.slug || playbookId}/issues/${encodeURIComponent(updated.id)}`);
      } else {
        const issue = await createIssue({
          playbookId,
          title: title.trim(),
          summary: summary.trim(),
          jiraCode: jiraCode.trim() || undefined,
          status,
          difficulty,
          estimatedTime: time.trim(),
          symptoms: symptoms.filter(s => s.trim()),
          errorMessage: errorMessage.trim(),
          context: context.trim(),
          affectedArea: area.trim(),
          informationToCollect: information.filter(s => s.trim()),
          attachments: attachments.filter(a => a.url.trim()),
          internalNotes: notes.trim(),
        });
        markClean();
        const targetPb = playbooks.find(p => p.id === playbookId);
        navigate(`/playbooks/${targetPb?.slug || playbookId}/issues/${encodeURIComponent(issue.id)}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : isEdit ? 'Could not update the Issue.' : 'Could not save the Issue.');
    } finally {
      setSaving(false);
    }
  };

  const cancelHref = isEdit && initial
    ? `#/playbooks/${pb?.slug || initial.playbookId}/issues/${encodeURIComponent(initial.id)}`
    : '#/create';

  return (
    <div className="editor">
      <a className="back-link" href={cancelHref}>
        <ArrowLeft size={14} />
        {isEdit ? 'Back to Issue' : 'Back to Create'}
      </a>
      <PageHeader
        title={isEdit ? 'Edit Issue' : 'Create Issue'}
        description={
          isEdit
            ? `Update issue details for ${initial?.id}.`
            : 'Document the problem so Support can identify and investigate it.'
        }
      />
      <form onSubmit={submit} onInvalid={revealInvalid}>
        <FormSection title="Basic Information">
          <div className="form-grid">
            <label>
              Playbook *
              <select
                required
                disabled={isEdit}
                value={playbookId}
                onChange={e => setPlaybookId(e.target.value)}
              >
                <option value="" disabled>
                  {playbooksLoading ? 'Loading Playbooks…' : 'Select a Playbook'}
                </option>
                {playbooks.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Issue Code
              <input
                readOnly
                value={isEdit && initial ? initial.id : `${pb?.code || 'ISS'} — assigned when saved`}
              />
            </label>
          </div>
          <label>
            Issue Title *
            <input
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Phone Number Already Registered"
            />
          </label>
          <label>
            Jira Code
            <input
              value={jiraCode}
              onChange={e => setJiraCode(e.target.value)}
              placeholder="e.g. NEW-001"
            />
            <span className="helper-text">Reference to the original Jira ticket, if applicable.</span>
          </label>
          <details className="disclosure">
            <summary>Status & investigation details</summary>
            <div className="optional-fields form-grid">
              <label>
                Status
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value as Issue['status'])}
                >
                  <option>Draft</option>
                  <option>Verified</option>
                </select>
              </label>
              <label>
                Difficulty
                <select
                  value={difficulty}
                  onChange={e => setDifficulty(e.target.value as Issue['difficulty'])}
                >
                  <option>Easy</option>
                  <option>Medium</option>
                  <option>Advanced</option>
                </select>
              </label>
              <label>
                Estimated Investigation Time
                <input
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  placeholder="e.g. 15 min"
                />
              </label>
            </div>
          </details>
        </FormSection>
        <FormSection title="Problem Summary">
          <label>
            Problem Summary *
            <textarea
              required
              rows={4}
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Describe the problem and who it affects."
            />
          </label>
        </FormSection>
        <FormSection title="Symptoms" hint="What does the customer experience?">
          <StringList label="Symptom" values={symptoms} onChange={setSymptoms} />
        </FormSection>
        <FormSection title="Error Message / Code" optional>
          <label>
            Exact error
            <textarea
              rows={2}
              value={errorMessage}
              onChange={e => setErrorMessage(e.target.value)}
            />
          </label>
        </FormSection>
        <FormSection title="When Does This Happen?" optional>
          <label>
            Context
            <textarea
              rows={3}
              value={context}
              onChange={e => setContext(e.target.value)}
            />
          </label>
          <label>
            Affected Area
            <input value={area} onChange={e => setArea(e.target.value)} />
          </label>
        </FormSection>
        <FormSection title="Information to Collect" optional>
          <StringList label="Information item" values={information} onChange={setInformation} />
        </FormSection>
        <FormSection title="Attachments" optional hint="Link screenshots or files showing the problem.">
          {attachments.map((a, i) => (
            <div className="form-section-body" key={i}>
              <label>
                Attachment {i + 1} name
                <input
                  value={a.name}
                  onChange={e =>
                    setAttachments(
                      attachments.map((v, n) => (n === i ? { ...v, name: e.target.value } : v))
                    )
                  }
                />
              </label>
              <label>
                Attachment {i + 1} URL
                <input
                  type="url"
                  pattern="https?://.*"
                  required
                  value={a.url}
                  onChange={e =>
                    setAttachments(
                      attachments.map((v, n) => (n === i ? { ...v, url: e.target.value } : v))
                    )
                  }
                />
              </label>
              <button
                className="back-link"
                type="button"
                onClick={() => setAttachments(attachments.filter((_, n) => n !== i))}
              >
                Remove attachment
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setAttachments([...attachments, { name: '', url: '' }])}
          >
            <Plus size={14} />Add attachment link
          </button>
        </FormSection>
        <FormSection title="Internal Notes" optional>
          <label>
            Support Only
            <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
        </FormSection>
        {error && (
          <p className="knowledge-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <a className="btn-secondary" href={cancelHref}>
            Cancel
          </a>
          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? (isEdit ? 'Updating…' : 'Saving…') : isEdit ? 'Update Issue' : 'Save Issue'}
          </button>
        </div>
      </form>
      <DiscardDialog />
    </div>
  );
}
