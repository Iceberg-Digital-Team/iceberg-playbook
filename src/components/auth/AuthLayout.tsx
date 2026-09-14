import type { ReactNode } from 'react';
import './Auth.css';

export function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-layout">
    <section className="auth-identity" aria-label="Iceberg Playbook">
      <div className="auth-brand"><span className="auth-brand-mark" aria-hidden="true">I</span><div><strong>ICEBERG</strong><span>PLAYBOOK</span></div></div>
      <div className="auth-intro"><span className="auth-kicker">THE INTERNAL WORKSPACE</span><h2>Shared knowledge.<br/>Clear solutions.</h2><p>A place for what we know.<br/>And how we put it to work.</p></div>
      <svg className="auth-lines" viewBox="0 0 600 320" fill="none" aria-hidden="true"><path d="M-50 280 260 40 650 280M-50 280H650M60 320 260 40 420 320M260 40V320M-50 200H650M-50 120H650" stroke="currentColor"/></svg>
      <p className="auth-identity-footer">Internal Support Knowledge System</p>
    </section>
    <section className="auth-panel"><div className="auth-panel-content">{children}</div><footer className="auth-footer">Internal Iceberg Digital system.<br/>Authorized users only.</footer></section>
  </main>;
}
