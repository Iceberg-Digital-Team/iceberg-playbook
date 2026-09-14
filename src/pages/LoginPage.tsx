import { AuthLayout } from '../components/auth/AuthLayout';
import { LoginForm } from '../components/auth/LoginForm';
export function LoginPage() {
  return <AuthLayout><header className="auth-heading"><p>Welcome back</p><h1>Sign in to<br/>Iceberg Playbook</h1><p>Access internal Playbooks, Issues, Guides, SOPs, and troubleshooting resources.</p></header><LoginForm/></AuthLayout>;
}
export function ForgotPasswordPage() {
  return <AuthLayout><header className="auth-heading"><p>Account access</p><h1>Forgot your password?</h1><p>Password reset is not available in this preview. Contact your internal administrator for help with access.</p></header><a className="auth-back" href="#/login">← Back to Sign In</a></AuthLayout>;
}
