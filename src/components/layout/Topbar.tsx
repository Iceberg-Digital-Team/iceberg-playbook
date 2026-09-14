import React, { useState, useEffect, useRef } from 'react';
import { Menu, Search, Bell, Plus } from 'lucide-react';
import { useRouter } from '../../router';
import './Topbar.css';

interface TopbarProps {
  onMenuToggle: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({ onMenuToggle }) => {
  const { navigate } = useRouter();
  const [notice, setNotice] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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

  const handleDropdownItemClick = (type: string) => {
    setIsDropdownOpen(false);
    if (type === 'issue') navigate('/create/issue');
    else if (type === 'guide') navigate('/create/guide');
    else if (type === 'sop') navigate('/create/sop');
    else if (type === 'playbook') navigate('/create/playbook');
  };

  return (
    <header className="topbar" onKeyDown={e=>{if(e.key==='Escape'){setIsDropdownOpen(false);setNotice(false);}}}>
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
          <span className="notification-badge" />
        </button>

        {notice && <div className="notification-popover" role="status">No new notifications.</div>}
        {/* Create Button with Dropdown */}
        <div className="create-btn-container" ref={dropdownRef}>
          <button
            className="create-btn"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            aria-expanded={isDropdownOpen}
          >
            <Plus className="create-btn-icon" />
            <span>Create</span>
          </button>

          {isDropdownOpen && (
            <div className="create-dropdown">
              <button className="dropdown-item" onClick={() => handleDropdownItemClick('issue')}>
                New Issue
              </button>
              <button className="dropdown-item" onClick={() => handleDropdownItemClick('guide')}>
                New Guide
              </button>
              <button className="dropdown-item" onClick={() => handleDropdownItemClick('sop')}>
                New SOP
              </button>
              <button className="dropdown-item" onClick={() => handleDropdownItemClick('playbook')}>
                New Playbook
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
