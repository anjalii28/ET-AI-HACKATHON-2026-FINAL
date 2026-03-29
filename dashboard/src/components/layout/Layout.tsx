import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import './Layout.css';

/**
 * AppLayout: Sidebar (persistent) + child route via Outlet.
 * Tickets, Leads, Feedback = embedded iframes. Calls = index route.
 */
export function Layout() {
  return (
    <div className="unified-layout">
      <header className="unified-header">
        <div className="header-title">
          <h1>Call Intelligence</h1>
        </div>
      </header>
      <div className="unified-body">
        <Sidebar />
        <main className="unified-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
