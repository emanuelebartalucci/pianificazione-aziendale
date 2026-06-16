import { useState } from 'react';
import { type Commessa, type Dipendente } from '../contexts/AuthContext';
import { X, Plus, Trash2 } from 'lucide-react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { addPendingNotification } from '../utils/pendingNotifications';
import { TIPOLOGIA_COLORS } from '../utils/commesseIniziali';

interface Assegnazione {
  commessaId: string;
  commessaName: string;
  percentuale: number;
  colore: string;
  giorni?: string[];
}

interface AssegnazioneModalProps {
  isOpen: boolean;
  onClose: () => void;
  dipendente: string;
  weekId: string;
  weekLabel: string;
  weekSub: string;
  commesseCatalog: Commessa[];
  currentAssignments: Assegnazione[];
  dipendentiList: Dipendente[];
  onAssignmentsChanged?: () => void;
}

export default function AssegnazioneModal({ isOpen, onClose, dipendente, weekId, weekLabel, weekSub, commesseCatalog, currentAssignments, dipendentiList, onAssignmentsChanged }: AssegnazioneModalProps) {
  const [selectedCommessa, setSelectedCommessa] = useState('');
  const [selectedPercent, setSelectedPercent] = useState<string>('100');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  if (!isOpen) return null;



  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommessa || !selectedPercent) {
      showToast("Seleziona una commessa e una percentuale!", "warning");
      return;
    }

    const comm = commesseCatalog.find(c => c.id === selectedCommessa);
    if (!comm) return;

    const newAss: Assegnazione = {
      commessaId: comm.id,
      commessaName: comm.nome,
      percentuale: Number(selectedPercent),
      colore: TIPOLOGIA_COLORS[comm.tipologia || ''] || comm.colore || '#64748b',
      giorni: [] // No days specified, self-managed by employee/manager
    };

    try {
      const updatedList = [...currentAssignments, newAss];
      await setDoc(doc(db, 'assegnazioni', `${dipendente}-${weekId}`), { lista: updatedList });
      
      const targetDip = dipendentiList.find(d => d.nome === dipendente);
      if (targetDip && targetDip.email) {
        addPendingNotification(
          dipendente,
          targetDip.email,
          `Settimana ${weekLabel.split('Sett. ')[1] || weekLabel}`,
          `Assegnata commessa: ${comm.nome} (${selectedPercent}%)`
        );
        onAssignmentsChanged?.();
      }
      
      setSelectedCommessa('');
      setSelectedPercent('100');
      showToast("Commessa assegnata con successo!", "success");
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'inserimento dell'assegnazione.", "error");
    }
  };

  const handleRemove = async (index: number) => {
    try {
      const updatedList = [...currentAssignments];
      const removedAss = currentAssignments[index];
      updatedList.splice(index, 1);
      
      if (updatedList.length === 0) {
        await deleteDoc(doc(db, 'assegnazioni', `${dipendente}-${weekId}`));
      } else {
        await setDoc(doc(db, 'assegnazioni', `${dipendente}-${weekId}`), { lista: updatedList });
      }
      
      const targetDip = dipendentiList.find(d => d.nome === dipendente);
      if (targetDip && targetDip.email) {
        addPendingNotification(
          dipendente,
          targetDip.email,
          `Settimana ${weekLabel.split('Sett. ')[1] || weekLabel}`,
          `Rimossa commessa: ${removedAss.commessaName}`
        );
        onAssignmentsChanged?.();
      }
      
      showToast("Assegnazione rimossa con successo!", "success");
    } catch (err) {
      console.error(err);
      showToast("Errore durante la rimozione dell'assegnazione.", "error");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm overflow-y-auto flex items-start sm:items-center justify-center z-50 p-4 no-print transition-all">
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[99999] animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl shadow-2xl border font-bold text-sm ${
            toast.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : toast.type === 'warning'
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}>
            <span>{toast.type === 'success' ? '✅' : toast.type === 'warning' ? '⚠️' : '❌'}</span>
            <span>{toast.message}</span>
            <button 
              onClick={() => setToast(null)} 
              className="ml-2 hover:opacity-70 text-xs font-black"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md my-8 overflow-hidden transform scale-100 transition-all">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 flex justify-between items-center text-white">
          <h3 className="font-extrabold text-xl">Gestisci Assegnazioni</h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1.5 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 sm:p-8">
          <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 mb-6">
            <p className="text-blue-900 text-sm mb-1">Dipendente: <strong className="text-base font-extrabold">{dipendente}</strong></p>
            <p className="text-blue-900/80 text-sm">Settimana: <strong>{weekLabel}</strong> <span className="text-xs opacity-75">({weekSub})</span></p>
          </div>

          <div className="mb-8">
            <h4 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider">Assegnazioni Attuali</h4>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
              {currentAssignments.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Nessuna commessa assegnata.</p>
              ) : (
                currentAssignments.map((ass, i) => (
                  <div key={i} className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100 group hover:border-gray-200 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="w-3 h-3 rounded-full shadow-sm" style={{backgroundColor: (() => { const c = commesseCatalog.find(x => x.id === ass.commessaId); return c ? (TIPOLOGIA_COLORS[c.tipologia || ''] || c.colore || '#64748b') : (ass.colore || '#64748b'); })()}}></span>
                      <span className="font-bold text-gray-700 text-sm">{ass.commessaName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-blue-600 text-sm">{ass.percentuale}%</span>
                      <button onClick={() => handleRemove(i)} className="text-gray-300 hover:text-red-500 transition-colors p-1" title="Rimuovi"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <form onSubmit={handleAdd} className="bg-gradient-to-br from-gray-50 to-gray-100 p-5 rounded-2xl border border-gray-200">
            <h4 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600"/> Aggiungi Commessa</h4>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 ml-1">Commessa</label>
                <select 
                  required
                  value={selectedCommessa}
                  onChange={e => setSelectedCommessa(e.target.value)}
                  className="w-full p-3 text-sm border-none rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500 shadow-sm font-semibold text-gray-700"
                >
                  <option value="">-- Seleziona --</option>
                  {commesseCatalog.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 ml-1">Percentuale Impegno</label>
                <select
                  required
                  value={selectedPercent}
                  onChange={e => setSelectedPercent(e.target.value)}
                  className="w-full p-3 text-sm border-none rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500 shadow-sm font-semibold text-gray-700"
                >
                  <option value="10">10%</option>
                  <option value="20">20%</option>
                  <option value="30">30%</option>
                  <option value="40">40%</option>
                  <option value="50">50%</option>
                  <option value="60">60%</option>
                  <option value="70">70%</option>
                  <option value="80">80%</option>
                  <option value="90">90%</option>
                  <option value="100">100%</option>
                </select>
              </div>

              <button type="submit" className="w-full bg-gray-900 text-white font-bold py-3 rounded-xl hover:bg-gray-800 transition-colors shadow-md active:scale-95 mt-2">
                Conferma Aggiunta
              </button>
            </div>
          </form>
          
          <button 
            type="button" 
            onClick={onClose} 
            className="w-full mt-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold py-3 rounded-xl transition-all active:scale-95 border border-gray-200"
          >
            Chiudi Finestra
          </button>
        </div>
      </div>
    </div>
  );
}
