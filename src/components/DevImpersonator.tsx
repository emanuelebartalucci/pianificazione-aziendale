import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';
import { Wrench, X, User, RotateCcw, AlertTriangle } from 'lucide-react';

export default function DevImpersonator() {
  const { isRealDev, impersonatedEmail, impersonateUser, dipendenti = [], refreshData } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && dipendenti.length === 0) {
      refreshData();
    }
  }, [isOpen, dipendenti.length, refreshData]);

  // Chiusura al click esterno
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (!isRealDev) return null;

  const todayISO = new Date().toLocaleDateString('sv-SE');
  const currentDip = dipendenti.find(d => (d.email || '').toLowerCase().trim() === (impersonatedEmail || '').toLowerCase().trim());
  const isCurrentCessato = Boolean(currentDip && currentDip.dataCessazione && currentDip.dataCessazione <= todayISO);

  const availableDipendenti = dipendenti.filter((d) => d && d.nome && d.email);

  return (
    <div ref={containerRef} className="fixed bottom-4 right-4 z-[999999] no-print select-none">
      {/* Popover / Panel Espanso */}
      {isOpen && (
        <div className="absolute bottom-14 right-0 w-80 sm:w-88 bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-gray-200/90 p-5 animate-in slide-in-from-bottom-2 fade-in duration-200 text-gray-800">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                <Wrench className="w-4 h-4" />
              </div>
              <div>
                <h5 className="font-black text-xs text-gray-900 leading-tight">
                  Impersonificazione Dev
                </h5>
                <span className="text-[10px] text-gray-500 font-semibold">
                  Simulazione ruoli & permessi
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-xl transition cursor-pointer"
              title="Chiudi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-[10.5px] text-gray-500 font-medium mb-3 leading-relaxed">
            Seleziona una risorsa per simulare la sua esperienza (Admin, HR, Coordinatore, PM, Dipendente o Collaboratore).
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1.5 ml-0.5">
                Utente simulato ({availableDipendenti.length} disponibili)
              </label>
              <select
                value={impersonatedEmail || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  impersonateUser(val || null);
                }}
                className="w-full p-2.5 border border-gray-200 rounded-xl bg-gray-50 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition cursor-pointer"
              >
                <option value="">-- Nessuna simulazione (Admin Reale) --</option>
                {availableDipendenti.map((d) => {
                  const isCess = d.dataCessazione && d.dataCessazione <= todayISO;
                  const dateFormatted = d.dataCessazione ? d.dataCessazione.split('-').reverse().join('/') : '';
                  return (
                    <option key={d.id} value={d.email}>
                      {d.nome} ({d.email}){isCess ? ` ⛔ CESSATO IL ${dateFormatted}` : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {impersonatedEmail && (
              <div className={`border text-[11px] p-3 rounded-2xl font-semibold space-y-1.5 ${
                isCurrentCessato ? 'bg-red-50 border-red-200 text-red-900' : 'bg-amber-50 border-amber-200 text-amber-950'
              }`}>
                <div className="flex items-center gap-1.5 font-bold">
                  {isCurrentCessato ? <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" /> : <User className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                  <span>{isCurrentCessato ? '⛔ Account Cessato' : 'Simulazione Attiva'}</span>
                </div>
                <div className="text-[10.5px]">
                  <strong>Risorsa:</strong> {currentDip?.nome || 'N/D'}
                </div>
                {isCurrentCessato && (
                  <div className="text-[10.5px]">
                    <strong>Data Cessazione:</strong> {currentDip?.dataCessazione?.split('-').reverse().join('/')}
                  </div>
                )}
                <div className="text-[10.5px]">
                  <strong>Ruolo:</strong> {currentDip?.tipo === 'collaboratore' ? 'Collaboratore P. IVA' : 'Dipendente'}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    impersonateUser(null);
                    setIsOpen(false);
                  }}
                  className={`w-full mt-2 py-2 px-3 text-white rounded-xl text-xs font-black transition active:scale-95 cursor-pointer shadow-xs flex items-center justify-center gap-1.5 ${
                    isCurrentCessato ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Ripristina Vista Reale</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trigger Button Circolare Discreto */}
      <button
        type="button"
        onClick={() => {
          if (!isOpen && dipendenti.length === 0) {
            refreshData();
          }
          setIsOpen(!isOpen);
        }}
        title={
          impersonatedEmail
            ? `Simulando: ${currentDip?.nome || impersonatedEmail}${isCurrentCessato ? ' (CESSATO)' : ''} (Clicca per gestire)`
            : 'Simulatore Utenti Dev (Clicca per aprire)'
        }
        className={`relative w-11 h-11 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 cursor-pointer active:scale-90 border-2 ${
          isOpen
            ? 'bg-slate-900 text-white border-slate-700 rotate-90 scale-105'
            : impersonatedEmail
              ? isCurrentCessato
                ? 'bg-gradient-to-br from-red-500 to-red-600 text-white border-white ring-2 ring-red-400/80 animate-pulse'
                : 'bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 border-white ring-2 ring-amber-300/80 shadow-amber-500/30'
              : 'bg-slate-850 hover:bg-slate-800 text-slate-200 hover:text-white border-slate-700/80 hover:border-slate-500'
        }`}
      >
        {isOpen ? (
          <X className="w-5 h-5" />
        ) : (
          <>
            <Wrench className="w-4 h-4" />
            {impersonatedEmail && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isCurrentCessato ? 'bg-red-400' : 'bg-amber-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-3.5 w-3.5 border-2 border-white ${isCurrentCessato ? 'bg-red-600' : 'bg-amber-600'}`}></span>
              </span>
            )}
          </>
        )}
      </button>
    </div>
  );
}

