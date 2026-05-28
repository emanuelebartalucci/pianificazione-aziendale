import { useState } from 'react';
import { type Commessa } from '../contexts/AuthContext';
import { X, Plus, Trash2 } from 'lucide-react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

interface Assegnazione {
  commessaId: string;
  commessaName: string;
  percentuale: number;
  colore: string;
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
}

export default function AssegnazioneModal({ isOpen, onClose, dipendente, weekId, weekLabel, weekSub, commesseCatalog, currentAssignments }: AssegnazioneModalProps) {
  const [selectedCommessa, setSelectedCommessa] = useState('');
  const [percentuale, setPercentuale] = useState<number>(100);

  if (!isOpen) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommessa || !percentuale) return;

    const comm = commesseCatalog.find(c => c.id === selectedCommessa);
    if (!comm) return;

    const newAss: Assegnazione = {
      commessaId: comm.id,
      commessaName: comm.nome,
      percentuale: Number(percentuale),
      colore: comm.colore
    };

    const updatedList = [...currentAssignments, newAss];
    await setDoc(doc(db, 'assegnazioni', `${dipendente}-${weekId}`), { lista: updatedList });
    
    setSelectedCommessa('');
    setPercentuale(100);
  };

  const handleRemove = async (index: number) => {
    const updatedList = [...currentAssignments];
    updatedList.splice(index, 1);
    
    if (updatedList.length === 0) {
      await deleteDoc(doc(db, 'assegnazioni', `${dipendente}-${weekId}`));
    } else {
      await setDoc(doc(db, 'assegnazioni', `${dipendente}-${weekId}`), { lista: updatedList });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print transition-all">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden transform scale-100 transition-all">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 flex justify-between items-center text-white">
          <h3 className="font-extrabold text-xl">Gestisci Turno</h3>
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
                      <span className="w-3 h-3 rounded-full shadow-sm" style={{backgroundColor: ass.colore}}></span>
                      <span className="font-bold text-gray-700 text-sm">{ass.commessaName}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-bold text-blue-600 text-sm">{ass.percentuale}%</span>
                      <button onClick={() => handleRemove(i)} className="text-gray-300 hover:text-red-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
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
                <label className="block text-xs font-bold text-gray-600 mb-1 ml-1">Catalogo</label>
                <select 
                  required
                  value={selectedCommessa}
                  onChange={e => setSelectedCommessa(e.target.value)}
                  className="w-full p-3 text-sm border-none rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500 shadow-sm font-medium"
                >
                  <option value="">-- Seleziona --</option>
                  {commesseCatalog.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 ml-1">Impegno (%)</label>
                <input 
                  type="number" 
                  min="1" max="100" 
                  required
                  value={percentuale}
                  onChange={e => setPercentuale(Number(e.target.value))}
                  className="w-full p-3 text-sm border-none rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500 shadow-sm font-bold text-blue-900"
                />
              </div>
              <button type="submit" className="w-full bg-gray-900 text-white font-bold py-3 rounded-xl hover:bg-gray-800 transition-colors shadow-md active:scale-95">
                Conferma Aggiunta
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
