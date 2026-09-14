import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'

// Preserve the app's hash router while accepting direct auth entry URLs.
if (!window.location.hash && ['/login', '/forgot-password'].includes(window.location.pathname)) {
  window.history.replaceState(null, '', '/#' + window.location.pathname);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider><App /></AuthProvider>
  </StrictMode>,
)
