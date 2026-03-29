import { NavLink } from 'react-router-dom';
import './Sidebar.css';

export type NavItemId = 'calls' | 'tickets' | 'leads' | 'feedback';

const NAV_ITEMS: { id: NavItemId; label: string; path: string; /** Full-page proxy link (no iframe) */ externalHref?: string }[] = [
  { id: 'calls', label: 'Calls', path: '/' },
  { id: 'tickets', label: 'Tickets', path: '/tickets' },
  { id: 'leads', label: 'Leads', path: '/leads' },
  { id: 'feedback', label: 'Feedback', path: '/feedback' },
];

export function Sidebar() {
  return (
    <aside className="unified-sidebar">
      <nav className="sidebar-nav">
        <ul className="sidebar-nav-list">
          {NAV_ITEMS.map(({ id, label, path, externalHref }) => (
            <li key={id}>
              {externalHref ? (
                <a href={externalHref} className="sidebar-nav-link">
                  {label}
                </a>
              ) : (
                <NavLink
                  to={path}
                  className={({ isActive }) =>
                    `sidebar-nav-link ${isActive ? 'active' : ''}`
                  }
                  end={path === '/'}
                >
                  {label}
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
