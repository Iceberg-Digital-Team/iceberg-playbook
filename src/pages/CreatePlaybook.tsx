import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, MessageSquare, Briefcase, Home, Video, Mic, Globe } from 'lucide-react';
import { useRouter } from '../router';
import {
  createPlaybook,
  checkPlaybookConflict,
  restorePlaybook,
  type DeletedPlaybookConflict,
} from '../services/playbookService';
import { PageHeader, FormSection } from '../components/knowledge/ApplicationUI';
import { toSlug } from '../slug';

const icons = [
  { name: 'MessageSquare', icon: MessageSquare, label: 'Chat / Social' },
  { name: 'Briefcase', icon: Briefcase, label: 'Business Suite' },
  { name: 'Home', icon: Home, label: 'Property CRM' },
  { name: 'Video', icon: Video, label: 'Video Meetings' },
  { name: 'Mic', icon: Mic, label: 'Audio' },
  { name: 'Globe', icon: Globe, label: 'Web Systems' },
];

function RestorePlaybookDialog({
  playbook,
  busy,
  onCancel,
  onRestore,
}: {
  playbook: DeletedPlaybookConflict;
  busy: boolean;
  onCancel: () => void;
  onRestore: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.showModal();
    }
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  return (
    <dialog
      className="guide-restore-dialog"
      ref={ref}
      aria-labelledby="restore-title"
      onCancel={e => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="restore-title">Restore Playbook?</h2>
      <p>A deleted Playbook with this name or code already exists. Would you like to restore it instead?</p>
      <div
        style={{
          margin: '16px 0',
          padding: '12px 16px',
          background: 'var(--muted-bg, #f4f5f7)',
          borderRadius: 'var(--radius, 6px)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--primary-text)' }}>
          {playbook.name}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--secondary-text)', marginTop: '4px' }}>
          Code Prefix: <strong>{playbook.code}</strong>
        </div>
      </div>
      <div className="knowledge-actions">
        <button autoFocus type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={onRestore} disabled={busy}>
          {busy ? 'Restoring…' : 'Restore Playbook'}
        </button>
      </div>
    </dialog>
  );
}

export function CreatePlaybook() {
  const { navigate } = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('MessageSquare');
  const [owner, setOwner] = useState('Support Team');
  const [visibility, setVisibility] = useState<'Internal' | 'Public'>('Internal');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflictPlaybook, setConflictPlaybook] = useState<DeletedPlaybookConflict | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || restoreBusy) return;
    setError('');

    const slug = toSlug(name);
    if (!slug || !code.trim() || !description.trim()) {
      setError('Complete the name, code prefix and description.');
      return;
    }

    setBusy(true);
    try {
      // Differentiate active vs soft-deleted conflict
      const conflict = await checkPlaybookConflict({ name, code, slug });
      if (conflict.type === 'ACTIVE_CONFLICT') {
        setError(conflict.message);
        setBusy(false);
        return;
      }

      if (conflict.type === 'DELETED_CONFLICT') {
        setConflictPlaybook(conflict.playbook);
        setBusy(false);
        return;
      }

      await createPlaybook({
        name,
        code,
        description,
        icon,
        owner,
        visibility,
        slug,
      });
      navigate(`/playbooks/${slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Playbook.');
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!conflictPlaybook || restoreBusy) return;
    setRestoreBusy(true);
    setError('');
    try {
      const restored = await restorePlaybook(conflictPlaybook.id);
      setConflictPlaybook(null);
      navigate(`/playbooks/${restored.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore Playbook.');
      setConflictPlaybook(null);
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleCancelRestore = () => {
    setConflictPlaybook(null);
  };

  return (
    <div className="editor">
      <a className="back-link" href="#/create">
        <ArrowLeft size={14} />Back to Create
      </a>
      <PageHeader title="New Playbook" description="Create a product, platform or problem area." />
      <form onSubmit={submit}>
        <FormSection title="Playbook Details">
          <div className="form-grid">
            <label>
              Playbook Name *
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. WhatsApp"
                disabled={busy || restoreBusy}
              />
            </label>
            <label>
              Code Prefix *
              <input
                required
                pattern="[A-Za-z0-9]+"
                maxLength={5}
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="e.g. WA"
                disabled={busy || restoreBusy}
              />
            </label>
          </div>
          <label>
            Description *
            <textarea
              required
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={busy || restoreBusy}
            />
          </label>
          <p className="helper-text">
            Issue codes will start with <span className="row-code">{code.trim().toUpperCase() || 'PREFIX'}-001</span>.
          </p>
        </FormSection>
        <FormSection title="Icon">
          <div className="icon-options">
            {icons.map(({ name: iconName, icon: Icon, label }) => (
              <button
                type="button"
                key={iconName}
                aria-pressed={icon === iconName}
                onClick={() => setIcon(iconName)}
                disabled={busy || restoreBusy}
              >
                <Icon size={19} />
                {label}
              </button>
            ))}
          </div>
        </FormSection>
        <FormSection title="Ownership & Visibility" optional>
          <label>
            Owner
            <input
              value={owner}
              onChange={e => setOwner(e.target.value)}
              disabled={busy || restoreBusy}
            />
          </label>
          <label>
            Visibility
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value as 'Internal' | 'Public')}
              disabled={busy || restoreBusy}
            >
              <option value="Internal">Internal (Support Only)</option>
              <option value="Public">Public (All Departments)</option>
            </select>
          </label>
          <p className="helper-text">
            Visibility is a content label in this preview. Access permissions are not connected yet.
          </p>
        </FormSection>
        {error && <p className="knowledge-error" role="alert">{error}</p>}
        <div className="form-actions">
          <a className="btn-secondary" href="#/create" aria-disabled={busy || restoreBusy || undefined}>
            Cancel
          </a>
          <button className="btn-primary" type="submit" disabled={busy || restoreBusy}>
            {busy ? 'Creating…' : 'Create Playbook'}
          </button>
        </div>
      </form>

      {conflictPlaybook && (
        <RestorePlaybookDialog
          playbook={conflictPlaybook}
          busy={restoreBusy}
          onCancel={handleCancelRestore}
          onRestore={handleRestore}
        />
      )}
    </div>
  );
}
