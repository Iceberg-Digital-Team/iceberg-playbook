import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { supabaseAuthAdapter } from './auth/supabaseAuth'
import { configureAdminUserService } from './services/adminUserService'
import { supabaseAdminUserAdapter } from './services/admin/supabaseAdminUserAdapter'

// Preserve the app's hash router while accepting direct auth entry URLs.
if (!window.location.hash && ['/login', '/forgot-password'].includes(window.location.pathname)) {
  window.history.replaceState(null, '', '/#' + window.location.pathname);
}

// User Management backend (replace this adapter to move off Supabase).
// Activation links point to the address the app is opened from (without the hash).
configureAdminUserService(supabaseAdminUserAdapter, {
  activationBaseUrl: window.location.origin + window.location.pathname,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider adapter={supabaseAuthAdapter}>
      <App />
    </AuthProvider>
  </StrictMode>,
)
