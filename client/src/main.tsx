import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ConfirmProvider, ToastProvider } from './components/ui.tsx';
import { DinerApp } from './diner/DinerApp.tsx';
import { Landing } from './Landing.tsx';
import { StaffApp } from './staff/StaffApp.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/m/:qrToken" element={<DinerApp />} />
            <Route path="/staff/*" element={<StaffApp />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
