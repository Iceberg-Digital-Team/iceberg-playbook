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
  const [confirmingForceReset, setConfirmingForceReset] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
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
      setDownloaded(true);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  const handleForceReset = () => {
    setActionError('');
    try {
      resetCorruptedStorage({ withoutBackup: true });
      const updated = checkStorageIntegrity();
      setIntegrity(updated);
      setConfirmingForceReset(false);
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
            {integrity.canReset ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => setConfirmingReset(true)}
              >
                Start Fresh
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                disabled={!downloaded}
                onClick={() => setConfirmingForceReset(true)}
              >
                Start Fresh (Download Required)
              </button>
            )}
          </div>
        }
      >
        {integrity.canReset
          ? 'Corrupted or inconsistent data was detected in browser storage. To protect your work from permanent loss, unreadable data has been preserved in a backup key. You can download the backup file and start fresh with a clean workspace.'
          : 'Corrupted or inconsistent data was detected in browser storage. Automated backup to browser storage was not possible because storage quota was reached. Please download your data file before resetting.'}
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
                  <span className="knowledge-error" style={{ marginLeft: 8, display: 'inline' }}>
                    — backup failed (storage quota reached; preserved in original key)
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!integrity.canReset && !downloaded && (
        <p className="knowledge-error" role="alert" style={{ marginTop: 16 }}>
          Automated backup could not be completed because browser storage is full. Please download your backup file first before resetting.
        </p>
      )}

      {!integrity.canReset && downloaded && (
        <p role="status" className="helper-text" style={{ marginTop: 16 }}>
          Backup file downloaded. You can now proceed to start fresh.
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

      {confirmingForceReset && (
        <dialog
          open
          className="guide-restore-dialog"
          aria-labelledby="force-reset-title"
          onCancel={e => {
            e.preventDefault();
            setConfirmingForceReset(false);
          }}
        >
          <h2 id="force-reset-title">Reset unbacked data and start fresh?</h2>
          <p>
            Because browser storage reached capacity, an automatic backup could not be saved inside your browser storage.
            You have downloaded the backup file to your computer.
          </p>
          <p>
            Proceeding will erase the unreadable data from your browser storage and reset with clean defaults.
            Please ensure you have saved your downloaded backup file.
          </p>
          <div className="knowledge-actions">
            <button type="button" autoFocus className="btn-secondary" onClick={() => setConfirmingForceReset(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={handleForceReset}>
              I Have Saved My Download — Start Fresh
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
