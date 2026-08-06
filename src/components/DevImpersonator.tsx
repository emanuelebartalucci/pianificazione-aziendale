import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';

export default function DevImpersonator() {
  const { isRealDev, impersonatedEmail, impersonateUser, dipendenti = [], refreshData } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen && dipendenti.length === 0) {
      refreshData();
    }
  }, [isOpen, dipendenti.length, refreshData]);

  if (!isRealDev) return null;

  const todayISO = new Date().toLocaleDateString('sv-SE');
  const currentDip = dipendenti.find(d => (d.email || '').toLowerCase().trim() === (impersonatedEmail || '').toLowerCase().trim());
  const isCurrentCessato = Boolean(currentDip && currentDip.dataCessazione && currentDip.dataCessazione <= todayISO);

  const availableDipendenti = dipendenti.filter((d) => d && d.nome && d.email);

  return (
    <div className="fixed bottom-6 right-6 z-[999999] no-print">
      {/* Trigger Button */}
      <button
        onClick={() => {
          if (!isOpen && dipendenti.length === 0) {
            refreshData();
          }
          setIsOpen(!isOpen);
        }}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-full shadow-2xl transition font-extrabold text-xs uppercase tracking-wider cursor-pointer border ${
          impersonatedEmail
            ? isCurrentCessato
              ? 'bg-red-600 hover:bg-red-700 text-white border-red-700 animate-pulse'
              : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 animate-pulse'
            : 'bg-indigo-650 hover:bg-indigo-700 text-white border-indigo-700'
        }`}
      >
        <span>🛠️</span>
        {impersonatedEmail
          ? `Simulando: ${currentDip?.nome || impersonatedEmail}${isCurrentCessato ? ' ⛔ (CESSATO)' : ''}`
          : 'Simula Utente'}
      </button>

      {/* Popover / Panel */}
      {isOpen && (
        <div className="absolute bottom-14 right-0 w-84 bg-white rounded-3xl shadow-2xl border border-gray-200 p-5 animate-in slide-in-from-bottom duration-200">
          <div className="flex justify-between items-center mb-3">
            <h5 className="font-extrabold text-sm text-gray-900 flex items-center gap-1.5">
              <span>🛠️</span> Impersonificazione Dev
            </h5>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600 font-bold text-xs p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>

          <p className="text-[10px] text-gray-500 font-semibold mb-4 leading-normal">
            Seleziona una risorsa per simulare le sue esatte autorizzazioni (Admin, HR, Dipendente o Collaboratore) nel frontend dell'app.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">
                Seleziona Utente ({availableDipendenti.length} disponibili)
              </label>
              <select
                value={impersonatedEmail || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  impersonateUser(val || null);
                }}
                className="w-full p-2.5 border border-gray-200 rounded-xl bg-gray-50 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-400 transition cursor-pointer"
              >
                <option value="">-- Ripristina (Admin Reale) --</option>
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
              <div className={`border text-[10px] p-3 rounded-2xl font-semibold space-y-1 ${
                isCurrentCessato ? 'bg-red-50 border-red-200 text-red-900' : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <div>
                  <strong>Stato attuale:</strong> {isCurrentCessato ? '⛔ Account Cessato (Simulazione Blocco)' : 'Modalità Simulazione Attiva'}
                </div>
                <div>
                  <strong>Risorsa:</strong> {currentDip?.nome || 'N/D'}
                </div>
                {isCurrentCessato && (
                  <div>
                    <strong>Data Cessazione:</strong> {currentDip?.dataCessazione?.split('-').reverse().join('/')}
                  </div>
                )}
                <div>
                  <strong>Ruolo:</strong> {currentDip?.tipo === 'collaboratore' ? 'Collaboratore P. IVA' : 'Dipendente'}
                </div>
                <button
                  onClick={() => {
                    impersonateUser(null);
                    setIsOpen(false);
                  }}
                  className={`w-full mt-2 py-1.5 px-3 text-white rounded-xl text-[10px] font-bold transition active:scale-95 cursor-pointer shadow-xs ${
                    isCurrentCessato ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  Ripristina Vista Sviluppatore Reale
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
