import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { validateSignIn } from '../../auth/auth';
import { PasswordInput } from './PasswordInput';

export function LoginForm() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false); const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' }); const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null); const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (submitting.current) return;
    const next = validateSignIn(email, password); setErrors(next); setError('');
    if (next.email || next.password) { form.current?.querySelector<HTMLInputElement>(next.email ? '#login-email' : '#login-password')?.focus(); return; }
    submitting.current = true; setBusy(true);
    try { await signIn({ email, password, remember }); setPassword(''); }
    catch { setError('Unable to sign in. Please try again.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <form className="auth-form" ref={form} noValidate onSubmit={submit} aria-busy={busy}>
    <div className="auth-field"><label htmlFor="login-email">Work Email</label><input id="login-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={e => { setEmail(e.target.value); setErrors(s => ({ ...s, email: '' })); }} disabled={busy} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined}/>{errors.email && <p className="auth-error" id="email-error">{errors.email}</p>}</div>
    <PasswordInput value={password} onChange={value => { setPassword(value); setErrors(s => ({ ...s, password: '' })); }} disabled={busy} error={errors.password}/>
    <div className="auth-options"><label><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} disabled={busy}/>Remember me</label><a href="#/forgot-password" aria-disabled={busy || undefined} onClick={e => { if (busy) e.preventDefault(); }}>Forgot password?</a></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="btn-primary auth-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</button>
    <span className="auth-sr-only" role="status">{busy ? 'Signing in, please wait.' : ''}</span>
    <p className="auth-preview">Preview access. Use a test password.<br/>Sign-in is simulated; sessions are not remembered yet.</p>
  </form>;
}
