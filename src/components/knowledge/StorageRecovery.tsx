import { useState } from 'react';
import { checkStorageIntegrity, resetCorruptedStorage, getCorruptedBackupData, type StorageIntegrityResult } from '../../data';
import { StateMessage } from './ApplicationUI';

export function StorageRecovery({
  integrity: initialIntegrity,
  onRecovered,
}: {
  integrity?: StorageIntegrityResult;
  onRecovered?: () => void;
}) {
  const [integrity, setIntegrity] = useState(() => initialIntegrity ?? checkStorageIntegrity());
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [actionError, setActionError] = useState('');

  const handleDownload = () => {
    try {
      const backup = getCorruptedBackupData();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `iceberg-playbook-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setActionError('Could not create backup download.');
    }
  };

  const handleReset = () => {
    setActionError('');
    try {
      resetCorruptedStorage();
      const updated = checkStorageIntegrity();
      setIntegrity(updated);
      setConfirmingReset(false);
      if (updated.status === 'healthy') {
        onRecovered?.();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not reset storage.');
    }
  };

  const keyDisplayNames: Record<string, string> = {
    ib_playbook_knowledge_v3: 'Knowledge (Issues & Guides)',
    ib_playbook_playbooks: 'Playbooks',
    ib_playbook_sops: 'SOPs',
    ib_playbook_knowledge_v2: 'Legacy Knowledge',
  };

  return (
    <div className="editor" style={{ maxWidth: 680, margin: '40px auto', padding: '0 20px' }}>
      <StateMessage
        error
        title="Storage Recovery Required"
        action={
          <div className="knowledge-actions" style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary" onClick={handleDownload}>
              Download Backup
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!integrity.canReset}
              onClick={() => setConfirmingReset(true)}
            >
              Start Fresh
            </button>
          </div>
        }
      >
        Corrupted or inconsistent data was detected in browser storage. To protect your work from permanent loss,
        unreadable data has been preserved in a backup key. You can download the backup file and start fresh with a clean workspace.
      </StateMessage>

      {integrity.affectedKeys.length > 0 && (
        <section className="form-section" style={{ marginTop: 24 }}>
          <h2>Affected Storage Areas</h2>
          <ul style={{ margin: '12px 0 0 20px', lineHeight: 1.6 }}>
            {integrity.affectedKeys.map(k => (
              <li key={k}>
                <strong>{keyDisplayNames[k] || k}</strong> (<code>{k}</code>)
                {integrity.details[k]?.backupKey ? (
                  <span style={{ color: 'var(--secondary-text)', marginLeft: 8 }}>
                    — backed up to <code>{integrity.details[k]?.backupKey}</code>
                  </span>
                ) : integrity.details[k]?.backupFailed ? (
                  <span style={{ color: 'var(--error-text, #c00)', marginLeft: 8 }}>
                    — backup failed (storage quota reached; preserved in original key)
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!integrity.canReset && (
        <p className="knowledge-error" role="alert" style={{ marginTop: 16 }}>
          Automated backup could not be completed because browser storage is full. Please download your data first before resetting.
        </p>
      )}

      {actionError && (
        <p className="knowledge-error" role="alert" style={{ marginTop: 16 }}>
          {actionError}
        </p>
      )}

      {confirmingReset && (
        <dialog
          open
          className="guide-restore-dialog"
          aria-labelledby="reset-title"
          onCancel={e => {
            e.preventDefault();
            setConfirmingReset(false);
          }}
        >
          <h2 id="reset-title">Reset corrupted data and start fresh?</h2>
          <p>
            Only corrupted storage keys will be reset to an empty, valid state. Any healthy data will be preserved, and
            your unreadable data remains safely stored in backup keys.
          </p>
          <div className="knowledge-actions">
            <button type="button" autoFocus className="btn-secondary" onClick={() => setConfirmingReset(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={handleReset}>
              Confirm & Start Fresh
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
