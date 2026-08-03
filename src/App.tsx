import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useEffect, useState, lazy, Suspense } from 'react';
import { APP_VERSION, APP_RELEASE_DATE, getPrintDateString } from './config/version';

// Lazy-loaded Pages (Code-Splitting per caricamento iniziale ultra-veloce)
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Commesse = lazy(() => import('./pages/Commesse'));
const Ferie = lazy(() => import('./pages/Ferie'));
const Impostazioni = lazy(() => import('./pages/Impostazioni'));
const Presenze = lazy(() => import('./pages/Presenze'));
const Suggerimenti = lazy(() => import('./pages/Suggerimenti'));
const PianificazionePersonale = lazy(() => import('./pages/PianificazionePersonale'));
const Prenotazioni = lazy(() => import('./pages/Prenotazioni'));
const Organigramma = lazy(() => import('./pages/Organigramma'));
const GestioneHR = lazy(() => import('./pages/GestioneHR'));

// Components
import Navbar from './components/Navbar';
import DevImpersonator from './components/DevImpersonator';
import ErrorBoundary from './components/ErrorBoundary';

function PageLoader() {
  return (
    <div className="min-h-[400px] flex flex-col items-center justify-center gap-3 py-12 text-gray-500">
      <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      <span className="text-sm font-semibold tracking-wide">Caricamento in corso...</span>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function PrintVersionFooter() {
  const [printDate, setPrintDate] = useState('');

  useEffect(() => {
    const updateDate = () => setPrintDate(getPrintDateString());
    updateDate();
    window.addEventListener('beforeprint', updateDate);
    return () => window.removeEventListener('beforeprint', updateDate);
  }, []);

  return (
    <div className="print-footer-watermark hidden print:flex">
      <span>Piattaforma Pianificazione Aziendale</span>
      <span>{APP_VERSION} — Data Stampa: {printDate || getPrintDateString()}</span>
    </div>
  );
}

function App() {
  const { user, loading } = useAuth();

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl instanceof HTMLInputElement &&
        activeEl.type === 'number' &&
        (activeEl === e.target || activeEl.contains(e.target as Node))
      ) {
        activeEl.blur();
      }
    };

    document.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      document.removeEventListener('wheel', handleWheel);
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 gap-3">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm font-bold text-gray-700">Inizializzazione applicazione...</span>
      </div>
    );
  }

  return (
    <Router>
      <ScrollToTop />
      <PrintVersionFooter />
      {user ? (
        <div className="bg-gray-100 text-gray-900 font-sans min-h-screen flex flex-col justify-between">
          <div className="flex-1">
            <Navbar />
            <DevImpersonator />
            <main className="max-w-[1400px] mx-auto px-4 py-8">
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/commesse" element={<Commesse />} />
                    <Route path="/ferie" element={<Ferie />} />
                    <Route path="/impostazioni" element={<Impostazioni />} />
                    <Route path="/presenze" element={<Presenze />} />
                    <Route path="/suggerimenti" element={<Suggerimenti />} />
                    <Route path="/pianificazione-personale" element={<PianificazionePersonale />} />
                    <Route path="/prenotazioni" element={<Prenotazioni />} />
                    <Route path="/organigramma" element={<Organigramma />} />
                    <Route path="/gestione-hr" element={<GestioneHR />} />
                    <Route path="*" element={<Navigate to="/" />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>
          <footer className="py-6 px-6 text-xs text-gray-400 select-none print:hidden border-t border-gray-200/50 mt-auto">
            <div className="max-w-[1400px] mx-auto grid grid-cols-1 sm:grid-cols-3 items-center gap-2 text-center">
              <div className="hidden sm:block"></div>
              <span className="opacity-60 font-medium text-center">Sviluppato da Emanuele Bartalucci</span>
              <div className="sm:text-right">
                <span className="inline-block font-bold bg-gray-200/70 px-3 py-1 rounded-full text-gray-600 border border-gray-300/50">
                  {APP_VERSION} ({APP_RELEASE_DATE})
                </span>
              </div>
            </div>
          </footer>
        </div>
      ) : (
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </Suspense>
      )}
    </Router>
  );
}

export default App;
