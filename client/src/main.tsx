import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import { IconContext } from '@phosphor-icons/react';
import { MotionConfig } from 'motion/react';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppToaster, ConfirmProvider, Loader } from './components/ui.tsx';
import { DinerApp } from './diner/DinerApp.tsx';
import './styles/index.css';

// El panel del local y la portada se cargan aparte: el celular del comensal solo baja lo suyo.
const StaffApp = lazy(() => import('./staff/StaffApp.tsx').then((m) => ({ default: m.StaffApp })));
const Landing = lazy(() => import('./Landing.tsx').then((m) => ({ default: m.Landing })));

// Demo estática (npm run build:demo): rutas con "#" y una barra para cambiar de vista con datos de prueba.
const DEMO = import.meta.env.MODE === 'demo';
const Router = DEMO ? HashRouter : BrowserRouter;
const DemoBar = DEMO ? lazy(() => import('./demo/DemoBar.tsx')) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <IconContext.Provider value={{ size: 20, weight: 'regular' }}>
        <ConfirmProvider>
          {DemoBar && (
            <Suspense fallback={null}>
              <DemoBar />
            </Suspense>
          )}
          <Router>
            <Suspense fallback={<Loader />}>
              <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/m/:qrToken" element={<DinerApp />} />
              <Route path="/staff/*" element={<StaffApp />} />
              <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </Router>
          <AppToaster />
        </ConfirmProvider>
      </IconContext.Provider>
    </MotionConfig>
  </StrictMode>,
);
