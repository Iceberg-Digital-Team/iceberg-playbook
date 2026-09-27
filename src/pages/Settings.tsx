import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import type { Playbook } from '../data';
import { listPlaybooks, softDeletePlaybook } from '../services/playbookService';
import { hasAnyContent, loadSampleData, formatStorageError } from '../data';
import { PageHeader, FormSection } from '../components/knowledge/ApplicationUI';

function DeleteDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      className="guide-restore-dialog"
      ref={ref}
      aria-labelledby="delete-title"
      onCancel={e => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="delete-title">Delete {name}?</h2>
      <p>This empty Playbook will be removed. This cannot be undone.</p>
      <div className="knowledge-actions">
        <button autoFocus className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" onClick={onConfirm}>
          Delete Playbook
        </button>
      </div>
    </dialog>
  );
}

function SampleDataDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      className="guide-restore-dialog"
      ref={ref}
      aria-labelledby="sample-title"
      onCancel={e => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="sample-title">Load sample data?</h2>
      <p>Example Playbooks, Issues, Guides and SOPs will be added to this empty workspace.</p>
      <div className="knowledge-actions">
        <button autoFocus className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" onClick={onConfirm}>
          Load sample data
        </button>
      </div>
    </dialog>
  );
}

export function Settings() {
  const { session, signOut } = useAuth();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loadingPlaybooks, setLoadingPlaybooks] = useState(true);
  const [defaultPlaybook, setDefaultPlaybook] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState('10');
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState('');
  const [hasContent, setHasContent] = useState(hasAnyContent);
  const [confirmSample, setConfirmSample] = useState(false);
  const [sampleError, setSampleError] = useState('');

  const refreshPlaybooks = () => {
    setLoadingPlaybooks(true);
    listPlaybooks()
      .then(items => {
        setPlaybooks(items);
        setLoadingPlaybooks(false);
        setDefaultPlaybook(curr => {
          if (items.length > 0 && !items.some(p => p.id === curr)) {
            return items[0].id;
          }
          return curr;
        });
      })
      .catch(err => {
        setLoadingPlaybooks(false);
        setMessage(err instanceof Error ? err.message : 'Could not load Playbooks.');
      });
  };

  useEffect(() => {
    let active = true;
    listPlaybooks()
      .then(items => {
        if (!active) return;
        setPlaybooks(items);
        setLoadingPlaybooks(false);
        setDefaultPlaybook(curr => {
          if (items.length > 0 && !items.some(p => p.id === curr)) {
            return items[0].id;
          }
          return curr;
        });
      })
      .catch(err => {
        if (!active) return;
        setLoadingPlaybooks(false);
        setMessage(err instanceof Error ? err.message : 'Could not load Playbooks.');
      });
    return () => {
      active = false;
    };
  }, []);

  const loadSamples = () => {
    setConfirmSample(false);
    setSampleError('');
    try {
      loadSampleData();
      setHasContent(true);
      setMessage('Sample data loaded into local preview.');
    } catch (e) {
      setSampleError(formatStorageError(e, 'Could not load sample data.'));
    }
  };

  const deletion = async () => {
    if (!pending) return;
    try {
      await softDeletePlaybook(pending);
      setMessage('Playbook deleted.');
      refreshPlaybooks();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not delete Playbook.');
    } finally {
      setPending(undefined);
    }
  };

  return (
    <div className="editor settings-page">
      <PageHeader title="Settings" description="Your profile, Playbooks and content preferences." />
      <FormSection title="Support Profile">
        <dl className="settings-profile">
          <div>
            <dt>Name</dt>
            <dd>{session?.profile?.full_name || 'Internal user'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{session?.user.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{session?.profile?.role || 'Internal user'}</dd>
          </div>
        </dl>
      </FormSection>
      <FormSection title="Playbooks">
        <div>
          {playbooks.map(pb => (
            <div className="settings-row" key={pb.id}>
              <a href={`#/playbooks/${pb.slug}`}>{pb.name}</a>
              <span className="helper-text">{pb.code}</span>
              <button
                className="back-link"
                onClick={() => setPending(pb.id)}
                aria-label={`Delete ${pb.name}`}
              >
                Delete
              </button>
            </div>
          ))}
          {!loadingPlaybooks && playbooks.length === 0 && (
            <p className="helper-text">No active Playbooks in workspace.</p>
          )}
        </div>
        <a href="#/create/playbook">New Playbook →</a>
      </FormSection>
      {message && <p role="status" className="helper-text">{message}</p>}
      <FormSection title="Content Preferences">
        <div className="form-grid">
          <label>
            Default Playbook
            <select value={defaultPlaybook} onChange={e => setDefaultPlaybook(e.target.value)}>
              {playbooks.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Items per page
            <select value={itemsPerPage} onChange={e => setItemsPerPage(e.target.value)}>
              {['5', '10', '20', '50'].map(n => (
                <option key={n} value={n}>
                  {n} items
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="helper-text">Preference controls are a preview and do not yet change content lists.</p>
      </FormSection>
      <FormSection title="Sample Data">
        <div className="settings-row">
          <div>
            <h3>Example content</h3>
            <p className="helper-text">
              {hasContent
                ? 'Sample data can only be loaded into an empty workspace. Your existing Playbooks, Issues, Guides and SOPs are never overwritten.'
                : 'Add example Playbooks, Issues, Guides and SOPs to explore the workspace.'}
            </p>
          </div>
          <button
            className="btn-secondary"
            disabled={hasContent}
            onClick={() => {
              setSampleError('');
              setConfirmSample(true);
            }}
          >
            Load sample data
          </button>
        </div>
        {sampleError && <p className="knowledge-error" role="alert">{sampleError}</p>}
      </FormSection>
      <FormSection title="Integrations">
        <div className="settings-row">
          <div>
            <h3>Jira Integration</h3>
            <p className="helper-text">Connect support tickets to documented solutions.</p>
          </div>
          <span className="helper-text">Coming Soon</span>
        </div>
      </FormSection>
      <button
        className="back-link"
        onClick={async () => {
          try {
            await signOut();
          } catch {
            setMessage('Unable to sign out. Please try again.');
          }
        }}
      >
        Sign Out of Account
      </button>
      {pending && (
        <DeleteDialog
          name={playbooks.find(p => p.id === pending)?.name || 'Playbook'}
          onCancel={() => setPending(undefined)}
          onConfirm={deletion}
        />
      )}
      {confirmSample && (
        <SampleDataDialog onCancel={() => setConfirmSample(false)} onConfirm={loadSamples} />
      )}
    </div>
  );
}
