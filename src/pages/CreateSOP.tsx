import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from '../router';
import type { Playbook, Step, SOP } from '../data';
import { listPlaybooks } from '../services/playbookService';
import { createSop, getSopById, updateSop } from '../services/sopService';
import { PageHeader, FormSection, StateMessage } from '../components/knowledge/ApplicationUI';
import { StringList, StepEditor, revealInvalid } from '../components/knowledge/EditorFields';
import { useUnsavedChangesWarning } from '../components/knowledge/useUnsavedChangesWarning';

export function CreateSOP() {
  const { path, params } = useRouter();
  const isEdit = path === '/sops/[id]/edit';
  const [initial, setInitial] = useState<SOP | null | undefined>(isEdit ? undefined : null);
  const [loading, setLoading] = useState(isEdit && Boolean(params.id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (isEdit && params.id) {
      getSopById(params.id)
        .then(sop => {
          if (!active) return;
          setInitial(sop);
          setLoading(false);
        })
        .catch(err => {
          if (!active) return;
          setError(err instanceof Error ? err.message : 'Failed to load SOP.');
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
        <StateMessage title="Loading SOP…">
          Retrieving standard operating procedure for editing…
        </StateMessage>
      </div>
    );
  }

  if (error) {
    return (
      <div className="editor">
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

  if (isEdit && !initial) {
    return (
      <StateMessage
        title="SOP not found"
        action={<a href="#/playbooks">Back to Playbooks</a>}
      />
    );
  }

  return <SOPEditor key={initial?.id || 'new'} initial={initial || undefined} />;
}

function SOPEditor({ initial }: { initial?: SOP }) {
  const { navigate, params } = useRouter();
  const isEdit = Boolean(initial);
  const [draftSessionId] = useState(
    () => `draft-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [playbookId, setPlaybookId] = useState(initial?.playbookId || params.playbook || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [status, setStatus] = useState<SOP['status']>(initial?.status || 'Draft');
  const [time, setTime] = useState(initial?.estimatedTime || '30 min');
  const [team, setTeam] = useState(initial?.responsibleTeam || 'Support & Onboarding Team');
  const [purpose, setPurpose] = useState(initial?.purpose || '');
  const [when, setWhen] = useState(initial?.whenToUse || '');
  const [requirements, setRequirements] = useState<string[]>(initial?.requirements || []);
  const [checklist, setChecklist] = useState(
    initial?.checklist || [
      'Customer information received',
      'Setup verified',
      'Testing completed'
    ]
  );
  const [steps, setSteps] = useState<Omit<Step, 'number'>[]>(
    initial?.steps?.length
      ? initial.steps.map(s => ({
          title: s.title,
          description: s.description,
          ...(s.estimatedTime?.trim() ? { estimatedTime: s.estimatedTime.trim() } : {}),
          ...(s.screenshot?.trim() ? { screenshot: s.screenshot.trim() } : {}),
          ...(s.importantNote?.trim() ? { importantNote: s.importantNote.trim() } : {}),
          ...(s.successIndicator?.trim() ? { successIndicator: s.successIndicator.trim() } : {}),
          ...(s.videoLink?.trim() ? { videoLink: s.videoLink.trim() } : {}),
          ...(s.pdfReference?.trim() ? { pdfReference: s.pdfReference.trim() } : {})
        }))
      : [{ title: '', description: '' }]
  );
  const [escalation, setEscalation] = useState(initial?.escalationRules || '');
  const [completion, setCompletion] = useState(initial?.completionCriteria || '');
  const [notes, setNotes] = useState(initial?.internalNotes || '');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const defaultSopChecklist = ['Customer information received', 'Setup verified', 'Testing completed'];
  const [defaultPlaybookId, setDefaultPlaybookId] = useState('');

  useEffect(() => {
    let active = true;
    listPlaybooks()
      .then(data => {
        if (!active) return;
        setPlaybooks(data);
        if (!initial) {
          const chosen = params.playbook || (data.length > 0 ? data[0].id : '');
          setPlaybookId(current => current || chosen);
          setDefaultPlaybookId(current => current || chosen);
        }
      })
      .catch(err => {
        if (active) {
          console.error('Failed to load playbooks for SOP:', err);
        }
      });
    return () => {
      active = false;
    };
  }, [params.playbook, initial]);

  const isDirty = initial
    ? Boolean(
        title.trim() !== (initial.title || '').trim() ||
          purpose.trim() !== (initial.purpose || '').trim() ||
          when.trim() !== (initial.whenToUse || '').trim() ||
          status !== (initial.status || 'Draft') ||
          time.trim() !== (initial.estimatedTime || '30 min').trim() ||
          team.trim() !== (initial.responsibleTeam || 'Support & Onboarding Team').trim() ||
          escalation.trim() !== (initial.escalationRules || '').trim() ||
          completion.trim() !== (initial.completionCriteria || '').trim() ||
          notes.trim() !== (initial.internalNotes || '').trim() ||
          playbookId !== initial.playbookId ||
          JSON.stringify(requirements.filter(r => r.trim())) !==
            JSON.stringify((initial.requirements || []).filter(r => r.trim())) ||
          JSON.stringify(checklist.filter(c => c.trim())) !==
            JSON.stringify((initial.checklist || []).filter(c => c.trim())) ||
          JSON.stringify(
            steps.map(s => ({
              title: s.title.trim(),
              description: s.description.trim(),
              estimatedTime: s.estimatedTime?.trim() || '',
              screenshot: s.screenshot?.trim() || '',
              importantNote: s.importantNote?.trim() || '',
              successIndicator: s.successIndicator?.trim() || '',
              videoLink: s.videoLink?.trim() || '',
              pdfReference: s.pdfReference?.trim() || ''
            }))
          ) !==
            JSON.stringify(
              (initial.steps || []).map(s => ({
                title: s.title.trim(),
                description: s.description.trim(),
                estimatedTime: s.estimatedTime?.trim() || '',
                screenshot: s.screenshot?.trim() || '',
                importantNote: s.importantNote?.trim() || '',
                successIndicator: s.successIndicator?.trim() || '',
                videoLink: s.videoLink?.trim() || '',
                pdfReference: s.pdfReference?.trim() || ''
              }))
            )
      )
    : Boolean(
        title.trim() !== '' ||
          purpose.trim() !== '' ||
          when.trim() !== '' ||
          escalation.trim() !== '' ||
          completion.trim() !== '' ||
          notes.trim() !== '' ||
          status !== 'Draft' ||
          time !== '30 min' ||
          team !== 'Support & Onboarding Team' ||
          requirements.some(r => r.trim() !== '') ||
          steps.some(
            s =>
              s.title.trim() !== '' ||
              s.description.trim() !== '' ||
              Boolean(s.screenshot?.trim()) ||
              Boolean(s.importantNote?.trim()) ||
              Boolean(s.successIndicator?.trim()) ||
              Boolean(s.videoLink?.trim()) ||
              Boolean(s.pdfReference?.trim()) ||
              Boolean(s.estimatedTime?.trim())
          ) ||
          JSON.stringify(checklist) !== JSON.stringify(defaultSopChecklist) ||
          (defaultPlaybookId && playbookId !== defaultPlaybookId)
      );

  const { DiscardDialog, markClean } = useUnsavedChangesWarning(isDirty);

  const pb = playbooks.find(p => p.id === playbookId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setWarning('');

    const trimmedTitle = title.trim();
    const trimmedPurpose = purpose.trim();
    const trimmedWhen = when.trim();

    if (!playbookId || !trimmedTitle || !trimmedPurpose || !trimmedWhen) {
      setError('Select a Playbook and complete the title, purpose and when to use.');
      return;
    }

    if (!pb) {
      setError('Select an existing Playbook.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit && initial) {
        const updated = await updateSop({
          id: initial.id,
          title: trimmedTitle,
          status,
          estimatedTime: time.trim() || '30 min',
          purpose: trimmedPurpose,
          whenToUse: trimmedWhen,
          requirements: requirements.filter(s => s.trim()),
          responsibleTeam: team.trim() || 'Support & Onboarding Team',
          checklist: checklist.filter(s => s.trim()),
          steps: steps.map((s, i) => ({
            ...s,
            number: i + 1,
            title: s.title.trim(),
            description: s.description.trim()
          })),
          escalationRules: escalation.trim(),
          completionCriteria: completion.trim(),
          relatedIssues: initial.relatedIssues || [],
          relatedGuides: initial.relatedGuides || [],
          internalNotes: notes.trim(),
          owner: initial.owner || 'Support Team',
          revisionHistory: initial.revisionHistory || []
        });
        markClean();
        if (updated.warning) {
          setWarning(updated.warning);
        }
        const warningParam = updated.warning ? `?warning=${encodeURIComponent(updated.warning)}` : '';
        navigate(`/playbooks/${pb.slug}/sops/${initial.id}${warningParam}`);
      } else {
        const sop = await createSop({
          playbookId,
          title: trimmedTitle,
          status,
          estimatedTime: time.trim() || '30 min',
          purpose: trimmedPurpose,
          whenToUse: trimmedWhen,
          requirements: requirements.filter(s => s.trim()),
          responsibleTeam: team.trim() || 'Support & Onboarding Team',
          checklist: checklist.filter(s => s.trim()),
          steps: steps.map((s, i) => ({
            ...s,
            number: i + 1,
            title: s.title.trim(),
            description: s.description.trim()
          })),
          escalationRules: escalation.trim(),
          completionCriteria: completion.trim(),
          relatedIssues: [],
          relatedGuides: [],
          internalNotes: notes.trim(),
          owner: 'Support Team'
        });
        markClean();
        if (sop.warning) {
          setWarning(sop.warning);
        }
        const warningParam = sop.warning ? `?warning=${encodeURIComponent(sop.warning)}` : '';
        navigate(`/playbooks/${pb.slug}/sops/${sop.id}${warningParam}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (isEdit ? 'Could not update SOP.' : 'Could not publish SOP.'));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelHref = isEdit && pb && initial
    ? `#/playbooks/${pb.slug}/sops/${initial.id}`
    : isEdit && pb
    ? `#/playbooks/${pb.slug}`
    : '#/create';

  return (
    <div className="editor">
      <a className="back-link" href={cancelHref}>
        <ArrowLeft size={14} />
        {isEdit && initial ? `Back to ${initial.id}` : 'Back to Create'}
      </a>
      <PageHeader
        title={isEdit && initial ? `Edit SOP · ${initial.id}` : 'Create SOP'}
        description={
          isEdit
            ? 'Update standard operating procedure details.'
            : 'Define a repeatable operational process for Support.'
        }
      />
      <form onSubmit={submit} onInvalid={revealInvalid}>
        <FormSection title="Basic Information">
          <label>
            Playbook *
            <select
              required
              value={playbookId}
              disabled={isEdit}
              onChange={e => setPlaybookId(e.target.value)}
            >
              <option value="" disabled>
                Select a Playbook
              </option>
              {playbooks.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            SOP Title *
            <input
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. WhatsApp Customer Onboarding Process"
            />
          </label>
          <div className="form-grid">
            <label>
              Status
              <select
                value={status}
                onChange={e => setStatus(e.target.value as SOP['status'])}
              >
                <option>Draft</option>
                <option>Verified</option>
              </select>
            </label>
            <label>
              Estimated Duration
              <input value={time} onChange={e => setTime(e.target.value)} />
            </label>
          </div>
          <label>
            Responsible Team
            <input value={team} onChange={e => setTeam(e.target.value)} />
          </label>
          <p className="helper-text">
            {isEdit && initial
              ? `Code: ${initial.id}`
              : `${pb?.code || 'SOP'}-SOP code assigned when published.`}
          </p>
        </FormSection>

        <FormSection title="Purpose">
          <label>
            Purpose *
            <textarea
              required
              rows={3}
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
            />
          </label>
          <label>
            When to Use *
            <textarea
              required
              rows={3}
              value={when}
              onChange={e => setWhen(e.target.value)}
            />
          </label>
        </FormSection>

        <FormSection title="Before You Start" optional>
          <StringList
            label="Requirement"
            values={requirements}
            onChange={setRequirements}
          />
        </FormSection>

        <FormSection title="Process Checklist" optional open>
          <StringList
            label="Workflow Stage"
            values={checklist}
            onChange={setChecklist}
          />
        </FormSection>

        <FormSection title="Process Steps">
          <StepEditor
            steps={steps}
            initialSteps={initial?.steps}
            domain="sops"
            entityId={isEdit && initial ? initial.id : `pending/${draftSessionId}`}
            onChange={setSteps}
          />
        </FormSection>

        <FormSection title="Escalation Rules" optional>
          <label>
            Escalation Rules
            <textarea
              rows={3}
              value={escalation}
              onChange={e => setEscalation(e.target.value)}
            />
          </label>
        </FormSection>

        <FormSection title="Completion Criteria" optional>
          <label>
            Completion Criteria
            <textarea
              rows={3}
              value={completion}
              onChange={e => setCompletion(e.target.value)}
            />
          </label>
        </FormSection>

        <FormSection title="Internal Notes" optional>
          <label>
            Support Only
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </label>
        </FormSection>

        {warning && (
          <p className="knowledge-warning" role="status">
            {warning}
          </p>
        )}

        {error && (
          <p className="knowledge-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <a className="btn-secondary" href={cancelHref}>
            Cancel
          </a>
          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? (isEdit ? 'Updating…' : 'Publishing…') : (isEdit ? 'Update SOP' : 'Publish SOP')}
          </button>
        </div>
      </form>
      <DiscardDialog />
    </div>
  );
}
