import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { APP_VERSION, getPrintDateString } from './config/version';

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
const Forniture = lazy(() => import('./pages/Forniture'));

import { auth } from './services/firebase';

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

function AccountCessatoScreen() {
  const { isRealDev, cessatoInfo, impersonateUser } = useAuth();
  const dateFormatted = cessatoInfo?.dataCessazione
    ? cessatoInfo.dataCessazione.split('-').reverse().join('/')
    : '';

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
      {/* Background Glow Effect */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-red-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-amber-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="max-w-md w-full bg-slate-800/90 backdrop-blur-md p-8 rounded-3xl border border-red-500/30 shadow-2xl space-y-6 z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto text-3xl text-red-500">
          🚫
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-black tracking-tight text-white">
            {isRealDev ? 'Simulazione Blocco Accesso' : 'Accesso Negato: Account Inattivo'}
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            L'account di <strong className="text-white">{cessatoInfo?.nome || 'questa risorsa'}</strong> risulta inattivo a causa della cessazione avvenuta il <strong className="text-red-400 font-extrabold">{dateFormatted || 'N/D'}</strong>.
          </p>
        </div>

        {isRealDev ? (
          <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl text-amber-200 text-xs space-y-3 text-left">
            <p className="font-semibold text-[11px] leading-relaxed">
              🛠️ <strong>Nota Sviluppatore:</strong> Stai simulando l'esperienza di un utente la cui data di cessazione è passata. Gli utenti reali vedono questa schermata e sono impossibilitati ad accedere a qualunque sezione dell'app.
            </p>
            <button
              onClick={() => impersonateUser(null)}
              className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all cursor-pointer"
            >
              Ripristina Utente Sviluppatore Reale
            </button>
          </div>
        ) : (
          <div className="pt-2">
            <p className="text-[11px] text-slate-400 mb-4">
              Per informazioni o chiarimenti amministrativi si prega di contattare la direzione aziendale o l'ufficio HR.
            </p>
            <button
              onClick={() => auth.signOut()}
              className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all cursor-pointer"
            >
              Disconnetti e Torna al Login
            </button>
          </div>
        )}
      </div>

      {isRealDev && <DevImpersonator />}
    </div>
  );
}

function ProtectedRoute({ children, condition }: { children: React.ReactNode; condition: boolean }) {
  if (!condition) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function App() {
  const { user, loading, isAccountCessato, isDev, isHR } = useAuth();

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

  if (user && isAccountCessato) {
    return <AccountCessatoScreen />;
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
                    <Route path="/impostazioni" element={
                      <ProtectedRoute condition={isDev}>
                        <Impostazioni />
                      </ProtectedRoute>
                    } />
                    <Route path="/presenze" element={<Presenze />} />
                    <Route path="/suggerimenti" element={<Suggerimenti />} />
                    <Route path="/forniture" element={<Forniture />} />
                    <Route path="/pianificazione-personale" element={<PianificazionePersonale />} />
                    <Route path="/prenotazioni" element={<Prenotazioni />} />
                    <Route path="/organigramma" element={<Organigramma />} />
                    <Route path="/gestione-hr" element={
                      <ProtectedRoute condition={isHR || isDev}>
                        <GestioneHR />
                      </ProtectedRoute>
                    } />
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
                  {APP_VERSION}
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
