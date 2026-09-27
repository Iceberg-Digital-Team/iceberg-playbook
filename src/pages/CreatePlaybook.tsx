import { useState } from 'react';
import { ArrowLeft, MessageSquare, Briefcase, Home, Video, Mic, Globe } from 'lucide-react';
import { useRouter } from '../router';
import { createPlaybook } from '../services/playbookService';
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    const slug = toSlug(name);
    if (!slug || !code.trim() || !description.trim()) {
      setError('Complete the name, code prefix and description.');
      return;
    }

    setBusy(true);
    try {
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
                disabled={busy}
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
                disabled={busy}
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
              disabled={busy}
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
                disabled={busy}
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
              disabled={busy}
            />
          </label>
          <label>
            Visibility
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value as 'Internal' | 'Public')}
              disabled={busy}
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
          <a className="btn-secondary" href="#/create" aria-disabled={busy || undefined}>
            Cancel
          </a>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create Playbook'}
          </button>
        </div>
      </form>
    </div>
  );
}
