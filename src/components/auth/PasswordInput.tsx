import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
export function PasswordInput({ value, onChange, error, disabled }: { value: string; onChange: (value: string) => void; error?: string; disabled: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-field"><label htmlFor="login-password">Password</label><div className="auth-password">
    <input id="login-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required value={value} onChange={e => onChange(e.target.value)} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? 'password-error' : undefined}/>
    <button type="button" onClick={() => setVisible(!visible)} disabled={disabled} aria-label={visible ? 'Hide password' : 'Show password'} aria-controls="login-password">{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
  </div>{error && <p id="password-error" className="auth-error">{error}</p>}</div>;
}
