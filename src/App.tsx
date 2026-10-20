import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { useRouter } from './router';

// Page Views
import { Home } from './pages/Home';
import { Playbooks } from './pages/Playbooks';
import { PlaybookDetail } from './pages/PlaybookDetail';
import { IssueDetail } from './pages/IssueDetail';
import { GuideDetail } from './pages/GuideDetail';
import { SOPDetail } from './pages/SOPDetail';
import { Search } from './pages/Search';
import { Create } from './pages/Create';
import { CreateIssue } from './pages/CreateIssue';
import { CreateGuide } from './pages/CreateGuide';
import { CreateSOP } from './pages/CreateSOP';
import { CreatePlaybook } from './pages/CreatePlaybook';
import { Settings } from './pages/Settings';
import { AdminUsers } from './pages/AdminUsers';
import { ActivateAccount } from './pages/ActivateAccount';
import { decideEntry } from './appAccess';

import { ContentErrorBoundary } from './components/knowledge/ContentErrorBoundary';
import './product.css';
import { useAuth } from './auth/AuthProvider';
import { LoginPage, ForgotPasswordPage } from './pages/LoginPage';

function App() {
  const { session, loading } = useAuth();
  const { path } = useRouter();
  // #/activate works signed in and signed out; other pages need a session.
  const entry = decideEntry(path, Boolean(session));

  useEffect(() => {
    if (loading) return;
    if (entry.redirect) window.location.replace(entry.redirect);
  }, [entry.redirect, loading]);

  if (loading) return null;

  if (entry.view === 'activate') return <ActivateAccount/>;
  if (!session) return entry.view === 'forgot-password' ? <ForgotPasswordPage/> : <LoginPage/>;
  return <WorkspaceApp/>;
}

function WorkspaceApp() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { path, params } = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo(0, 0); }, [path, params.id, params.slug, params.version]);

  const handleMenuToggle = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const renderPage = () => {
    switch (path) {
      case '/':
        return <Home onSearchTrigger={setSearchQuery} />;
      case '/playbooks':
        return <Playbooks />;
      case '/playbooks/[slug]':
        return <PlaybookDetail />;
      case '/playbooks/[slug]/issues/[id]':
        return <IssueDetail />;
      case '/playbooks/[slug]/guides/[id]':
        return <GuideDetail />;
      case '/playbooks/[slug]/sops/[id]':
        return <SOPDetail />;
      case '/search':
        return <Search searchQuery={searchQuery} onSearchChange={setSearchQuery} routeType={params.type} />;
      case '/create':
        return <Create />;
      case '/create/issue':
        return <CreateIssue key="create-issue" />;
      case '/issues/[id]/edit':
        return <CreateIssue key={window.location.hash} />;
      case '/create/guide':
        return <CreateGuide key="create-guide" />;
      case '/guides/[id]/edit':
        return <CreateGuide key={window.location.hash} />;
      case '/create/sop':
        return <CreateSOP key="create-sop" />;
      case '/sops/[id]/edit':
        return <CreateSOP key={window.location.hash} />;
      case '/create/playbook':
        return <CreatePlaybook />;
      case '/settings':
        return <Settings />;
      case '/admin/users':
        return <AdminUsers />;
      default:
        return <Home onSearchTrigger={setSearchQuery} />;
    }
  };

  return (
    <div className={`app-container${path === '/' ? ' home-layout' : ''}`}>
      <a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault(); document.getElementById('main-content')?.focus();}}>Skip to content</a>
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content Layout */}
      <div className="main-layout" ref={scrollRef} inert={sidebarOpen || undefined}>
        {/* Topbar Actions */}
        <Topbar
          onMenuToggle={handleMenuToggle}
        />

        {/* Selected Page Content */}
        <main className="content-container" id="main-content" tabIndex={-1}>
          <ContentErrorBoundary key={`${path}-${params.id || params.slug || ""}`}>{renderPage()}</ContentErrorBoundary>
        </main>
        <footer className="site-credit">
          Developed within Iceberg X by{' '}
          <a href="https://x.iceberg-digital.co.uk/x/010" target="_blank" rel="noopener noreferrer">Cube #10</a>
          {' '}and{' '}
          <a href="https://x.iceberg-digital.co.uk/x/049" target="_blank" rel="noopener noreferrer">Cube #49</a>.
        </footer>
      </div>
    </div>
  );
}

export default App;
