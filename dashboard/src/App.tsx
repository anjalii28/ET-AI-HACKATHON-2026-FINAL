import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { CallsView } from './views/CallsView';
import { LeadsView } from './views/LeadsView';
import { FeedbackView } from './views/FeedbackView';
import { TicketsView } from './views/TicketsView';
import './App.css';

function App() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<CallsView />} />
          <Route path="tickets" element={<TicketsView />} />
          <Route path="leads" element={<LeadsView />} />
          <Route path="feedback" element={<FeedbackView />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
