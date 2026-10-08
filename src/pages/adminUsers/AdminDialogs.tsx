import { useEffect, useRef, useState, type FormEvent, type ReactNode, type SyntheticEvent } from 'react';
import type { Role } from '../../auth/auth';
import { ROLES } from '../../services/adminUserRules';
import { changeUserRole, inviteUser } from '../../services/adminUserService';
import type { AdminSuggestion, CreatedLink, UserListRow } from '../../services/adminUserService';
import {
  confirmationFor,
  DEFAULT_EXPIRY_FORM,
  EXPIRY_OPTIONS,
  expiryDateBounds,
  expiryFromForm,
  linkResultView,
  presentError,
  validateInviteForm,
} from '../adminUsersView';
import type { Confirmation, ExpiryFormValue, SuggestionView } from '../adminUsersView';

// Native modal dialog (same pattern as Settings / UnsavedChangesDialog).
// Focus goes back to the element that opened it.
function useModalDialog(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };
  return { ref, onCancel };
}

export function ErrorWithSuggestion({ error, onSuggestion }: {
  error: { message: string; suggestion: SuggestionView | null } | null;
  onSuggestion?: (suggestion: AdminSuggestion) => void;
}) {
  if (!error) return null;
  const { suggestion } = error;
  return (
    <div className="admin-error">
      <p className="knowledge-error" role="alert">{error.message}</p>
      {suggestion && onSuggestion && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onSuggestion(
            suggestion.action === 'resend_invitation'
              ? { action: 'resend_invitation', invitationId: suggestion.targetId }
              : { action: suggestion.action, userId: suggestion.targetId },
          )}
        >
          {suggestion.label}
        </button>
      )}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return message ? <span className="admin-field-error" id={id}>{message}</span> : null;
}

function ExpiryField({ idPrefix, value, onChange, error, disabled }: {
  idPrefix: string;
  value: ExpiryFormValue;
  onChange: (value: ExpiryFormValue) => void;
  error: string;
  disabled: boolean;
}) {
  const bounds = expiryDateBounds(new Date());
  const errorId = `${idPrefix}-expiry-error`;
  return (
    <fieldset className="admin-expiry" aria-describedby={error ? errorId : undefined}>
      <legend>Link expires after</legend>
      <div className="admin-expiry-options">
        {EXPIRY_OPTIONS.map(option => (
          <label key={option.value}>
            <input
              type="radio"
              name={`${idPrefix}-expiry`}
              value={option.value}
              checked={value.preset === option.value}
              onChange={() => onChange({ ...value, preset: option.value })}
              disabled={disabled}
            />
            {option.label}
          </label>
        ))}
      </div>
      {value.preset === 'custom' && (
        <label>
          Expiry date
          <input
            type="date"
            min={bounds.min}
            max={bounds.max}
            value={value.customDate}
            onChange={e => onChange({ ...value, customDate: e.target.value })}
            disabled={disabled}
            aria-invalid={!!error}
          />
          <span className="helper-text">The link stops working at the end of this day (at most 7 days).</span>
        </label>
      )}
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

function DialogShell({ titleId, title, children, onClose }: { titleId: string; title: string; children: ReactNode; onClose: () => void }) {
  const { ref, onCancel } = useModalDialog(onClose);
  return (
    <dialog className="guide-restore-dialog admin-dialog" ref={ref} aria-labelledby={titleId} onCancel={onCancel}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

export function InviteUserDialog({ onClose, onCreated, onSuggestion }: {
  onClose: () => void;
  onCreated: (link: CreatedLink) => void;
  onSuggestion: (suggestion: AdminSuggestion) => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('Viewer');
  const [expiry, setExpiry] = useState<ExpiryFormValue>(DEFAULT_EXPIRY_FORM);
  const [errors, setErrors] = useState({ email: '', fullName: '', role: '', expiry: '' });
  const [error, setError] = useState<ReturnType<typeof presentError> | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const result = validateInviteForm({ email, fullName, role, expiry }, new Date());
    setErrors(result.errors);
    if (!result.input) return;
    setBusy(true);
    try {
      onCreated(await inviteUser(result.input));
    } catch (err) {
      setError(presentError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell titleId="invite-user-title" title="Invite user" onClose={onClose}>
      <form className="admin-form" noValidate onSubmit={submit} aria-busy={busy}>
        <label>
          Email
          <input type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} disabled={busy}
            aria-invalid={!!errors.email} aria-describedby={errors.email ? 'invite-email-error' : undefined} />
          <FieldError id="invite-email-error" message={errors.email} />
        </label>
        <label>
          Name
          <input type="text" autoComplete="off" value={fullName} onChange={e => setFullName(e.target.value)} disabled={busy}
            aria-invalid={!!errors.fullName} aria-describedby={errors.fullName ? 'invite-name-error' : undefined} />
          <FieldError id="invite-name-error" message={errors.fullName} />
        </label>
        <label>
          Role
          <select value={role} onChange={e => setRole(e.target.value as Role)} disabled={busy}
            aria-invalid={!!errors.role} aria-describedby={errors.role ? 'invite-role-error' : undefined}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <FieldError id="invite-role-error" message={errors.role} />
        </label>
        <ExpiryField idPrefix="invite" value={expiry} onChange={setExpiry} error={errors.expiry} disabled={busy} />
        <ErrorWithSuggestion error={error} onSuggestion={onSuggestion} />
        <div className="knowledge-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
        </div>
      </form>
    </DialogShell>
  );
}

// Resend invitation / create password link: choose the expiry, then create the link.
export function ExpiryLinkDialog({ title, description, target, run, onClose, onCreated, onSuggestion }: {
  title: string;
  description: string;
  target: { name: string; email: string };
  run: (expiresAt: string) => Promise<CreatedLink>;
  onClose: () => void;
  onCreated: (link: CreatedLink) => void;
  onSuggestion: (suggestion: AdminSuggestion) => void;
}) {
  const [expiry, setExpiry] = useState<ExpiryFormValue>(DEFAULT_EXPIRY_FORM);
  const [expiryError, setExpiryError] = useState('');
  const [error, setError] = useState<ReturnType<typeof presentError> | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const result = expiryFromForm(expiry, new Date());
    setExpiryError(result.error);
    if (!result.expiresAt) return;
    setBusy(true);
    try {
      onCreated(await run(result.expiresAt));
    } catch (err) {
      setError(presentError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell titleId="expiry-link-title" title={title} onClose={onClose}>
      <p>For <strong>{target.name}</strong> ({target.email}). {description}</p>
      <form className="admin-form" noValidate onSubmit={submit} aria-busy={busy}>
        <ExpiryField idPrefix="link" value={expiry} onChange={setExpiry} error={expiryError} disabled={busy} />
        <ErrorWithSuggestion error={error} onSuggestion={onSuggestion} />
        <div className="knowledge-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
        </div>
      </form>
    </DialogShell>
  );
}

export function ChangeRoleDialog({ row, onClose, onDone }: {
  row: UserListRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newRole, setNewRole] = useState<Role>(ROLES.find(r => r !== row.role) ?? row.role);
  const [error, setError] = useState<ReturnType<typeof presentError> | null>(null);
  const [busy, setBusy] = useState(false);
  const warning = confirmationFor('change_role', row, newRole);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || newRole === row.role) return;
    setError(null);
    setBusy(true);
    try {
      await changeUserRole(row.id, newRole);
      onDone();
    } catch (err) {
      setError(presentError(err));
      setBusy(false);
    }
  }

  return (
    <DialogShell titleId="change-role-title" title={`Change the role of ${row.fullName || row.email}`} onClose={onClose}>
      <p>Current role: <strong>{row.role}</strong></p>
      <form className="admin-form" noValidate onSubmit={submit} aria-busy={busy}>
        <label>
          New role
          <select value={newRole} onChange={e => setNewRole(e.target.value as Role)} disabled={busy}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {warning && <p className="admin-warning">{warning.body}</p>}
        <ErrorWithSuggestion error={error} />
        <div className="knowledge-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || newRole === row.role}>{busy ? 'Saving…' : 'Change role'}</button>
        </div>
      </form>
    </DialogShell>
  );
}

export function ConfirmActionDialog({ confirmation, run, onClose, onDone }: {
  confirmation: Confirmation;
  run: () => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<ReturnType<typeof presentError> | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await run();
      onDone();
    } catch (err) {
      setError(presentError(err));
      setBusy(false);
    }
  }

  return (
    <DialogShell titleId="confirm-action-title" title={confirmation.title} onClose={onClose}>
      <p>{confirmation.body}</p>
      <ErrorWithSuggestion error={error} />
      <div className="knowledge-actions">
        <button type="button" autoFocus className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary" onClick={confirm} disabled={busy}>{busy ? 'Working…' : confirmation.confirmLabel}</button>
      </div>
    </DialogShell>
  );
}

// Shows the link once. It lives only in this component's state and is gone when the dialog closes.
export function LinkResultDialog({ link, onClose }: { link: CreatedLink; onClose: () => void }) {
  const view = linkResultView(link);
  const input = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  function selectLink() {
    input.current?.focus();
    input.current?.select();
  }

  async function copy() {
    if (!view.url) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard not available');
      await navigator.clipboard.writeText(view.url);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
      selectLink();
    }
  }

  return (
    <DialogShell titleId="link-result-title" title={view.title} onClose={onClose}>
      {view.mode === 'manual' && view.url ? (
        <>
          <label className="admin-link-label">
            Link
            <input ref={input} className="admin-link-input" type="text" readOnly value={view.url} onFocus={e => e.currentTarget.select()} />
          </label>
          <div className="knowledge-actions admin-link-actions">
            <button type="button" className="btn-secondary" onClick={copy}>Copy link</button>
            <span role="status" className="helper-text">
              {copyState === 'copied' ? 'Copied.' : copyState === 'failed' ? 'Copy did not work. Select the link and copy it.' : ''}
            </span>
          </div>
        </>
      ) : null}
      <p>{view.expiresText}</p>
      <p><strong>{view.notice}</strong></p>
      <div className="knowledge-actions">
        <button type="button" autoFocus className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </DialogShell>
  );
}
