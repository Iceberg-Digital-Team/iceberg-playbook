import React, { useState, useEffect } from 'react';
import { Menu, Search, Bell } from 'lucide-react';
import { useRouter } from '../../router';
import './Topbar.css';

interface TopbarProps {
  onMenuToggle: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({ onMenuToggle }) => {
  const { navigate } = useRouter();
  const [notice, setNotice] = useState(false);
  // No notification source exists yet - this stays false until a real
  // notification system is built. The dot must never show for zero notifications.
  const [hasUnreadNotifications] = useState(false);

  // Keyboard shortcut listener for Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate]);

  return (
    <header className="topbar" onKeyDown={e=>{if(e.key==='Escape'){setNotice(false);}}}>
      {/* Mobile Toggle Button */}
      <button className="menu-toggle-btn" onClick={onMenuToggle} aria-label="Toggle Sidebar">
        <Menu size={18} />
      </button>

      {/* Action buttons (Right-aligned) */}
      <div className="topbar-actions">
        {/* Search Shortcut */}
        <button className="search-shortcut-btn" onClick={() => navigate('/search')} aria-label="Search Shortcut">
          <Search className="search-shortcut-icon" />
          <span>Search</span>
          <span className="search-shortcut-key">⌘K</span>
        </button>

        {/* Notifications */}
        <button className="notification-btn" aria-label="Notifications" onClick={() => setNotice(!notice)} aria-expanded={notice}>
          <Bell className="notification-icon" />
          {hasUnreadNotifications && <span className="notification-badge" />}
        </button>

        {notice && <div className="notification-popover" role="status">No new notifications.</div>}
      </div>
    </header>
  );
};
