import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useEffect, useState } from 'react';
import { APP_VERSION, APP_RELEASE_DATE, getPrintDateString } from './config/version';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Commesse from './pages/Commesse';
import Ferie from './pages/Ferie';
import Impostazioni from './pages/Impostazioni';
import Presenze from './pages/Presenze';
import Suggerimenti from './pages/Suggerimenti';
import PianificazionePersonale from './pages/PianificazionePersonale';
import Prenotazioni from './pages/Prenotazioni';
import Organigramma from './pages/Organigramma';

// Components
import Navbar from './components/Navbar';
import DevImpersonator from './components/DevImpersonator';

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
    return <div className="min-h-screen flex items-center justify-center bg-gray-100">Caricamento...</div>;
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
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
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
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      )}
    </Router>
  );
}

export default App;
