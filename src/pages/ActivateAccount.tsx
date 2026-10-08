import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { AuthLayout } from '../components/auth/AuthLayout';
import { useRouter } from '../router';
import { readActivationToken, validatePasswordForm } from '../services/adminUserRules';
import { activateAccount, getInvitation } from '../services/adminUserService';
import { initialView, viewFromInfo, viewFromLookupError, viewFromResult, viewFromSubmitError } from './activateAccountState';
import type { ActivationFormView, ActivationView } from './activateAccountState';
import './ActivateAccount.css';

function NewPasswordField({ id, label, value, onChange, error, disabled }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string;
  disabled: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-password">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          required
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
        <button type="button" onClick={() => setVisible(!visible)} disabled={disabled}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-controls={id}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error && <p id={errorId} className="auth-error">{error}</p>}
    </div>
  );
}

function PasswordForm({ form, token, onResult }: {
  form: ActivationFormView;
  token: string;
  onResult: (view: ActivationView) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const next = validatePasswordForm(password, confirm);
    setErrors(next);
    if (next.password || next.confirm) return;
    const value = password;
    // Never keep the password in state longer than needed.
    setPassword('');
    setConfirm('');
    setBusy(true);
    try {
      onResult(viewFromResult(await activateAccount({ token, password: value })));
    } catch (err) {
      onResult(viewFromSubmitError(form, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit} aria-busy={busy}>
      <dl className="activate-facts">
        <div><dt>Email</dt><dd>{form.email}</dd></div>
        <div><dt>Name</dt><dd>{form.fullName}</dd></div>
        <div><dt>Role</dt><dd>{form.role}</dd></div>
      </dl>
      <NewPasswordField id="activate-password" label="New password" value={password}
        onChange={value => { setPassword(value); setErrors(s => ({ ...s, password: '' })); }} error={errors.password} disabled={busy} />
      <NewPasswordField id="activate-password-confirm" label="Confirm password" value={confirm}
        onChange={value => { setConfirm(value); setErrors(s => ({ ...s, confirm: '' })); }} error={errors.confirm} disabled={busy} />
      <p className="activate-hint">At least 8 characters.</p>
      {form.error && <p className="auth-error" role="alert">{form.error}</p>}
      <button className="btn-primary auth-submit" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
      <span className="auth-sr-only" role="status">{busy ? 'Saving your password, please wait.' : ''}</span>
    </form>
  );
}

export function ActivateAccount() {
  const { session } = useAuth();
  const { params } = useRouter();
  const token = readActivationToken(params);
  const [attempt, setAttempt] = useState(0);
  // Result of the current lookup (token + attempt). Until it arrives the page shows "loading".
  const key = `${attempt}:${token ?? ''}`;
  const [result, setResult] = useState<{ key: string; view: ActivationView } | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    getInvitation(token)
      .then(info => { if (active) setResult({ key, view: viewFromInfo(info) }); })
      .catch(err => { if (active) setResult({ key, view: viewFromLookupError(err) }); });
    return () => {
      active = false;
    };
  }, [token, key]);

  const view: ActivationView = !token ? initialView(null) : result?.key === key ? result.view : initialView(token);
  const setView = (next: ActivationView) => setResult({ key, view: next });

  const signedInAs = session ? session.profile?.full_name || session.user.email : '';
  const heading = view.kind === 'form' ? view.heading
    : view.kind === 'done' ? 'Password set'
    : view.kind === 'loading' ? 'Checking your link'
    : view.kind === 'error' ? 'Could not check your link'
    : 'Link not valid';
  const intro = view.kind === 'form' ? view.intro : '';

  return (
    <AuthLayout>
      {signedInAs && <p className="activate-note">You are signed in as {signedInAs}.</p>}
      <header className="auth-heading">
        <p>Account access</p>
        <h1>{heading}</h1>
        {intro && <p>{intro}</p>}
      </header>

      {view.kind === 'loading' && <p className="activate-message" role="status">Checking your link…</p>}

      {(view.kind === 'invalid' || view.kind === 'dead') && (
        <div className="activate-message" role="alert">
          <p>{view.message}</p>
          <p>{view.help}</p>
        </div>
      )}

      {view.kind === 'error' && (
        <div className="activate-message">
          <p className="auth-error" role="alert">{view.message}</p>
          <button type="button" className="btn-secondary" onClick={() => setAttempt(a => a + 1)}>Try again</button>
        </div>
      )}

      {view.kind === 'form' && token && <PasswordForm form={view} token={token} onResult={setView} />}

      {view.kind === 'done' && (
        <div className="activate-message" role="status">
          <p>{view.message}</p>
          <a className="btn-primary auth-submit" href="#/login">Go to Sign In</a>
        </div>
      )}

      {view.kind !== 'done' && view.kind !== 'form' && <a className="auth-back" href="#/login">← Back to Sign In</a>}
    </AuthLayout>
  );
}
