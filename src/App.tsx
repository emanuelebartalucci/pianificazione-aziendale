import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useEffect } from 'react';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Commesse from './pages/Commesse';
import Ferie from './pages/Ferie';
import Impostazioni from './pages/Impostazioni';
import Presenze from './pages/Presenze';
import Suggerimenti from './pages/Suggerimenti';
import PianificazionePersonale from './pages/PianificazionePersonale';

// Components
import Navbar from './components/Navbar';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-100">Caricamento...</div>;
  }

  return (
    <Router>
      <ScrollToTop />
      {user ? (
        <div className="bg-gray-100 text-gray-900 font-sans min-h-screen flex flex-col justify-between">
          <div className="flex-1">
            <Navbar />
            <main className="max-w-[1400px] mx-auto px-4 py-8">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/commesse" element={<Commesse />} />
                <Route path="/ferie" element={<Ferie />} />
                <Route path="/impostazioni" element={<Impostazioni />} />
                <Route path="/presenze" element={<Presenze />} />
                <Route path="/suggerimenti" element={<Suggerimenti />} />
                <Route path="/pianificazione-personale" element={<PianificazionePersonale />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </main>
          </div>
          <footer className="text-center py-6 text-xs text-gray-400 opacity-40 select-none print:hidden">
            Sviluppato da Emanuele Bartalucci
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
