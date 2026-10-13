import { AuthLayout } from '../components/auth/AuthLayout';
import { LoginForm } from '../components/auth/LoginForm';
export function LoginPage() {
  return <AuthLayout><header className="auth-heading"><p>Welcome back</p><h1>Sign in to<br/>Iceberg Playbook</h1><p>Access internal Playbooks, Issues, Guides, and SOPs.</p></header><LoginForm/></AuthLayout>;
}
export function ForgotPasswordPage() {
  return <AuthLayout><header className="auth-heading"><p>Account access</p><h1>Forgot your password?</h1><p>Ask your Admin for a password link.</p></header><a className="auth-back" href="#/login">← Back to Sign In</a></AuthLayout>;
}
