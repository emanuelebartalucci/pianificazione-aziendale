import { useState, useEffect } from 'react';
import { type Commessa, type Dipendente } from '../contexts/AuthContext';
import { X, Plus, Trash2 } from 'lucide-react';
import { doc, setDoc, deleteDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { queueMail } from '../utils/mailSender';

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
}

export default function AssegnazioneModal({ isOpen, onClose, dipendente, weekId, weekLabel, weekSub, commesseCatalog, currentAssignments, dipendentiList }: AssegnazioneModalProps) {
  const [selectedCommessa, setSelectedCommessa] = useState('');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [approvedAbsences, setApprovedAbsences] = useState<Record<string, { tipo: string; oraInizio?: string; oraFine?: string }>>({});

  useEffect(() => {
    if (!isOpen || !dipendente) return;

    const q = query(
      collection(db, 'richieste_ferie'),
      where('dipendenteName', '==', dipendente),
      where('stato', '==', 'Approvato')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const absences: Record<string, { tipo: string; oraInizio?: string; oraFine?: string }> = {};
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        const start = d.dataInizio || d.data;
        const end = d.dataFine || d.data;
        if (start && end) {
          const [startYear, startMonth, startDay] = start.split('-').map(Number);
          const [endYear, endMonth, endDay] = end.split('-').map(Number);

          const currDate = new Date(startYear, startMonth - 1, startDay);
          const lastDate = new Date(endYear, endMonth - 1, endDay);

          while (currDate <= lastDate) {
            const y = currDate.getFullYear();
            const m = String(currDate.getMonth() + 1).padStart(2, '0');
            const dStr = String(currDate.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${dStr}`;
            absences[dateStr] = {
              tipo: d.tipo,
              oraInizio: d.oraInizio,
              oraFine: d.oraFine
            };
            currDate.setDate(currDate.getDate() + 1);
          }
        }
      });
      setApprovedAbsences(absences);
    });

    return () => unsub();
  }, [isOpen, dipendente]);

  // Helper to calculate date of a weekday
  const getWeekdayDate = (dayKey: string): string => {
    const parts = weekId.split('-W');
    if (parts.length !== 2) return '';
    const year = parseInt(parts[0]);
    const week = parseInt(parts[1]);

    const simple = new Date(year, 0, 4);
    const dayOfWeek = simple.getDay();
    const dayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const firstMonday = new Date(simple.setDate(simple.getDate() + dayOffset));
    const monday = new Date(firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7));

    const dayMap: Record<string, number> = { 'Lun': 0, 'Mar': 1, 'Mer': 2, 'Gio': 3, 'Ven': 4 };
    const offset = dayMap[dayKey] ?? 0;
    const targetDate = new Date(monday);
    targetDate.setDate(monday.getDate() + offset);

    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dStr = String(targetDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${dStr}`;
  };

  const getActiveDays = () => {
    return ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'].filter(day => {
      const dayDate = getWeekdayDate(day);
      const absence = approvedAbsences[dayDate];
      const isBlocked = absence && (absence.tipo === 'ferie' || absence.tipo === 'malattia' || absence.tipo === 'mattina' || absence.tipo === 'pomeriggio');
      return !isBlocked;
    });
  };

  if (!isOpen) return null;

  const handleDayToggle = (day: string) => {
    setSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleSelectAllDays = () => {
    const activeDays = getActiveDays();
    const blockedCount = 5 - activeDays.length;
    if (blockedCount > 0 && selectedDays.length !== activeDays.length) {
      alert(`Attenzione: ${dipendente} ha ${blockedCount} giorno/i di ferie o assenza approvati in questa settimana. Verranno selezionati solo i giorni di lavoro disponibili.`);
    }
    if (selectedDays.length === activeDays.length) {
      setSelectedDays([]);
    } else {
      setSelectedDays(activeDays);
    }
  };

  // Helper to send assignment email
  const sendAssignmentEmail = async (newList: Assegnazione[]) => {
    try {
      const targetDip = dipendentiList.find(d => d.nome === dipendente);
      if (!targetDip || !targetDip.email) return;

      const formatDays = (giorni?: string[]) => {
        if (!giorni || giorni.length === 0) return 'Nessun giorno';
        if (giorni.length === 5) return 'Tutta la settimana';
        return giorni.join(', ');
      };

      const listText = newList.length === 0 
        ? "Nessuna commessa assegnata (settimana libera)." 
        : newList.map(a => `- ${a.commessaName}: ${a.percentuale}% (${formatDays(a.giorni)})`).join('\n');

      const listHtml = newList.length === 0
        ? "<p style=\"font-style: italic;\">Nessuna commessa assegnata (settimana libera).</p>"
        : `
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 20px 0; font-family: Arial, Helvetica, sans-serif; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; width: 100%;">
            <tr style="background-color: #f9fafb;">
              <th align="left" style="padding: 10px 16px; font-size: 12px; font-weight: bold; color: #374151; border-bottom: 1px solid #e5e7eb; width: 45%;">Commessa</th>
              <th align="right" style="padding: 10px 16px; font-size: 12px; font-weight: bold; color: #374151; border-bottom: 1px solid #e5e7eb; width: 20%;">Percentuale</th>
              <th align="left" style="padding: 10px 16px; font-size: 12px; font-weight: bold; color: #374151; border-bottom: 1px solid #e5e7eb; padding-left: 24px; width: 35%;">Giorni</th>
            </tr>
            ${newList.map(a => `
              <tr>
                <td align="left" style="padding: 12px 16px; font-size: 14px; color: #111827; border-bottom: 1px solid #f3f4f6;"><strong>${a.commessaName}</strong></td>
                <td align="right" style="padding: 12px 16px; font-size: 14px; color: #111827; border-bottom: 1px solid #f3f4f6;">${a.percentuale}%</td>
                <td align="left" style="padding: 12px 16px; font-size: 13px; color: #4b5563; border-bottom: 1px solid #f3f4f6; padding-left: 24px;">${formatDays(a.giorni)}</td>
              </tr>
            `).join('')}
          </table>
        `;

      const subject = `[Pianificazione] Aggiornamento commesse - ${weekLabel}`;
      const htmlBody = `
        <p>Ciao <strong>${dipendente}</strong>,</p>
        <p>Ci sono stati degli aggiornamenti sulle tue commesse assegnate per la <strong>${weekLabel}</strong> (${weekSub}).</p>
        <p>Ecco le tue assegnazioni correnti:</p>
        ${listHtml}
        <p>Accedi alla piattaforma per vedere la pianificazione completa.</p>
      `;

      const plainText = `Ciao ${dipendente},\n\nCi sono stati degli aggiornamenti sulle tue commesse per la settimana ${weekLabel} (${weekSub}).\n\nEcco le tue assegnazioni correnti:\n${listText}\n\nAccedi alla piattaforma per maggiori dettagli.\n\n---\nQuesta è una notifica automatica, si prega di non rispondere a questo messaggio.`;
      await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
      console.log(`Email di pianificazione accodata per ${targetDip.email}`);
    } catch (e) {
      console.error("Errore nell'invio dell'email di assegnazione:", e);
    }
  };;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommessa || selectedDays.length === 0) {
      alert("Seleziona una commessa e almeno un giorno!");
      return;
    }

    const comm = commesseCatalog.find(c => c.id === selectedCommessa);
    if (!comm) return;

    const newAss: Assegnazione = {
      commessaId: comm.id,
      commessaName: comm.nome,
      percentuale: selectedDays.length * 20,
      colore: comm.colore,
      giorni: [...selectedDays]
    };

    const updatedList = [...currentAssignments, newAss];
    await setDoc(doc(db, 'assegnazioni', `${dipendente}-${weekId}`), { lista: updatedList });
    await sendAssignmentEmail(updatedList);
    
    setSelectedCommessa('');
    setSelectedDays([]);
  };

  const handleRemove = async (index: number) => {
    const updatedList = [...currentAssignments];
    updatedList.splice(index, 1);
    
    if (updatedList.length === 0) {
      await deleteDoc(doc(db, 'assegnazioni', `${dipendente}-${weekId}`));
    } else {
      await setDoc(doc(db, 'assegnazioni', `${dipendente}-${weekId}`), { lista: updatedList });
    }
    await sendAssignmentEmail(updatedList);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm overflow-y-auto flex items-start sm:items-center justify-center z-50 p-4 no-print transition-all">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md my-8 overflow-hidden transform scale-100 transition-all">
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
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-blue-600 text-sm">{ass.percentuale}%</span>
                        <button onClick={() => handleRemove(i)} className="text-gray-300 hover:text-red-500 transition-colors p-1" title="Rimuovi"><Trash2 className="w-4 h-4"/></button>
                      </div>
                      {ass.giorni && (
                        <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-md font-bold">
                          {ass.giorni.length === 5 ? 'Sett. Completa' : ass.giorni.join(', ')}
                        </span>
                      )}
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
                <label className="block text-xs font-bold text-gray-600 mb-2 ml-1">Seleziona Giorni Assegnati</label>
                <div className="flex justify-between gap-1.5 mb-3">
                  {['Lun', 'Mar', 'Mer', 'Gio', 'Ven'].map(day => {
                    const isSelected = selectedDays.includes(day);
                    const dayDate = getWeekdayDate(day);
                    const absence = approvedAbsences[dayDate];
                    
                    const isBlocked = absence && (
                      absence.tipo === 'ferie' || 
                      absence.tipo === 'malattia' || 
                      absence.tipo === 'mattina' || 
                      absence.tipo === 'pomeriggio'
                    );

                    let buttonLabel = day;
                    let subLabel = '';
                    if (absence) {
                      if (absence.tipo === 'ferie') {
                        buttonLabel = 'Ferie';
                        subLabel = 'Ferie';
                      } else if (absence.tipo === 'malattia') {
                        buttonLabel = 'Malattia';
                        subLabel = 'Malattia';
                      } else if (absence.tipo === 'mattina') {
                        buttonLabel = 'Ass. Matt.';
                        subLabel = 'Ass. Matt.';
                      } else if (absence.tipo === 'pomeriggio') {
                        buttonLabel = 'Ass. Pom.';
                        subLabel = 'Ass. Pom.';
                      } else if (absence.tipo === 'permesso') {
                        subLabel = `Perm. (${absence.oraInizio}-${absence.oraFine})`;
                      } else if (absence.tipo === 'smart') {
                        subLabel = 'Smart';
                      }
                    }

                    return (
                      <button
                        key={day}
                        type="button"
                        disabled={isBlocked}
                        onClick={() => handleDayToggle(day)}
                        className={`flex-1 py-2 rounded-xl font-extrabold text-[10px] sm:text-xs transition-all active:scale-95 border flex flex-col items-center justify-center ${
                          isBlocked 
                            ? 'bg-red-50 text-red-500 border-red-200 cursor-not-allowed opacity-70' 
                            : isSelected 
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-100' 
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                        title={absence ? `Assenza approvata: ${absence.tipo}` : ''}
                      >
                        <span className="font-extrabold">{buttonLabel}</span>
                        {subLabel && <span className={`text-[8px] mt-0.5 ${isSelected ? 'text-indigo-200' : 'text-gray-400'}`}>{subLabel}</span>}
                      </button>
                    );
                  })}
                </div>
                
                <button
                  type="button"
                  onClick={handleSelectAllDays}
                  className="w-full py-2 bg-white hover:bg-gray-50 text-indigo-600 border border-indigo-100 rounded-xl text-xs font-extrabold transition-colors active:scale-98 shadow-sm mb-4"
                >
                  {selectedDays.length === getActiveDays().length && getActiveDays().length > 0 ? 'Deseleziona Tutta la Settimana' : 'Seleziona Tutta la Settimana'}
                </button>
                
                {selectedDays.length > 0 && (
                  <div className="text-right text-[11px] font-bold text-indigo-700 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100/30">
                    Impegno calcolato: {selectedDays.length * 20}% ({selectedDays.length} {selectedDays.length === 1 ? 'giorno' : 'giorni'} su 5)
                  </div>
                )}
              </div>

              <button type="submit" className="w-full bg-gray-900 text-white font-bold py-3 rounded-xl hover:bg-gray-800 transition-colors shadow-md active:scale-95">
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
