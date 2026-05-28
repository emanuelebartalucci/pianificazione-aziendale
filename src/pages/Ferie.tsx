import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { Calendar, CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

interface RichiestaFerie {
  id: string;
  dipendenteName: string;
  data: string;
  tipo: string;
  stato: 'In attesa' | 'Approvato' | 'Rifiutato';
}

export default function Ferie() {
  const { isHR, isAdmin, myAssociatedName } = useAuth();
  
  // State per la nuova richiesta
  const [dataRichiesta, setDataRichiesta] = useState('');
  const [tipoRichiesta, setTipoRichiesta] = useState('ferie');
  
  // State per calendario
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  // Lista richieste
  const [richieste, setRichieste] = useState<RichiestaFerie[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'richieste_ferie'), (snapshot) => {
      const list: RichiestaFerie[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (!isAdmin && !isHR && data.dipendenteName !== myAssociatedName) return;
        
        list.push({
          id: docSnap.id,
          dipendenteName: data.dipendenteName,
          data: data.data,
          tipo: data.tipo,
          stato: data.stato || 'In attesa'
        });
      });
      setRichieste(list.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()));
    });
    return () => unsub();
  }, [isAdmin, isHR, myAssociatedName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myAssociatedName || !dataRichiesta) {
      alert(myAssociatedName ? "Seleziona una data" : "Devi avere un profilo associato nell'anagrafica per richiedere ferie.");
      return;
    }
    
    setLoading(true);
    try {
      await addDoc(collection(db, 'richieste_ferie'), {
        dipendenteName: myAssociatedName,
        data: dataRichiesta,
        tipo: tipoRichiesta,
        stato: 'In attesa',
        timestamp: new Date().toISOString()
      });
      setDataRichiesta('');
    } catch (err) {
      alert("Errore nell'invio della richiesta.");
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (id: string, approva: boolean) => {
    try {
      await updateDoc(doc(db, 'richieste_ferie', id), {
        stato: approva ? 'Approvato' : 'Rifiutato'
      });
    } catch (e) {
      console.error("Errore aggiornamento:", e);
    }
  };

  const getStatusBadge = (stato: string) => {
    switch(stato) {
      case 'Approvato': return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full"><CheckCircle className="w-3 h-3"/> {stato}</span>;
      case 'Rifiutato': return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full"><XCircle className="w-3 h-3"/> {stato}</span>;
      default: return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full"><Clock className="w-3 h-3"/> {stato}</span>;
    }
  };

  const getTipoData = (tipo: string) => {
    const tipi: Record<string, {label: string, color: string}> = {
      ferie: {label: 'Ferie / Malattia', color: 'bg-red-500'},
      smart: {label: 'Lavora da Casa', color: 'bg-blue-500'},
      mattina: {label: 'Assenza Mattina', color: 'bg-yellow-400'},
      pomeriggio: {label: 'Assenza Pomeriggio', color: 'bg-orange-400'}
    };
    return tipi[tipo] || {label: tipo, color: 'bg-gray-500'};
  };

  const getTipoLabel = (tipo: string) => {
    const t = getTipoData(tipo);
    return (
      <span className="flex items-center gap-2 text-sm font-medium text-gray-700 capitalize">
        <span className={`w-3 h-3 rounded-full ${t.color} shadow-sm`}></span>
        {t.label}
      </span>
    );
  };

  // --- LOGICA CALENDARIO ---
  const shiftMonth = (delta: number) => {
    const d = new Date(currentMonth);
    d.setMonth(d.getMonth() + delta);
    setCurrentMonth(d);
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayIndex = (new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay() + 6) % 7; // Lunedi = 0
  
  const monthName = currentMonth.toLocaleString('it-IT', { month: 'long', year: 'numeric' });
  const calendarCells = [];
  
  // Celle vuote iniziali
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push(<div key={`empty-${i}`} className="min-h-[100px] bg-gray-50/50 rounded-xl border border-transparent"></div>);
  }
  
  // Giorni effettivi
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayRequests = richieste.filter(r => r.data === dateStr);

    calendarCells.push(
      <div key={day} className="min-h-[100px] bg-white rounded-xl border border-gray-200 p-2 shadow-sm hover:shadow-md transition-shadow flex flex-col">
        <div className="font-bold text-gray-700 mb-1 text-right">{day}</div>
        <div className="flex-1 flex flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
          {dayRequests.map(req => {
            const t = getTipoData(req.tipo);
            let bg = 'bg-gray-100 border-gray-200 text-gray-800';
            if(req.stato === 'Approvato') bg = 'bg-green-50 border-green-200 text-green-800';
            if(req.stato === 'Rifiutato') bg = 'bg-red-50 border-red-200 text-red-800 opacity-50 line-through';
            if(req.stato === 'In attesa') bg = 'bg-yellow-50 border-yellow-200 text-yellow-800';

            return (
              <div key={req.id} className={`text-[10px] p-1.5 rounded border ${bg} flex items-center gap-1.5 font-medium leading-tight shadow-sm`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.color}`}></span>
                <span className="truncate" title={`${isAdmin || isHR ? req.dipendenteName + ' - ' : ''}${t.label}`}>
                  {(isAdmin || isHR) ? req.dipendenteName : t.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
            <div className="p-3 bg-green-100 rounded-2xl"><Calendar className="w-8 h-8 text-green-600" /></div>
            Piano Ferie e Assenze
          </h2>
          <button onClick={() => window.print()} className="hidden md:flex items-center gap-2 bg-gray-900 text-white hover:bg-gray-800 px-5 py-2.5 rounded-xl font-bold transition shadow-lg active:scale-95">
            Stampa
          </button>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          
          {/* FORM NUOVA RICHIESTA */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-8 rounded-3xl border border-green-100 shadow-sm h-fit">
            <h3 className="font-extrabold text-2xl mb-6 text-green-950">Nuova Richiesta Personale</h3>
            {!myAssociatedName ? (
              <div className="bg-yellow-100 text-yellow-800 p-4 rounded-xl text-sm font-medium">
                Il tuo profilo non è associato ad un nome nell'anagrafica. Contatta un amministratore per poter richiedere le ferie.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-green-900 mb-1.5 ml-1">Giorno di assenza</label>
                  <input 
                    type="date" 
                    required 
                    value={dataRichiesta}
                    onChange={e => setDataRichiesta(e.target.value)}
                    className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-green-900 mb-1.5 ml-1">Tipo di assenza</label>
                  <select 
                    value={tipoRichiesta} 
                    onChange={e => setTipoRichiesta(e.target.value)}
                    className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900"
                  >
                    <option value="ferie">Ferie / Malattia</option>
                    <option value="smart">Lavora da Casa</option>
                    <option value="mattina">Assenza Mattina</option>
                    <option value="pomeriggio">Assenza Pomeriggio</option>
                  </select>
                </div>
                
                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full bg-green-600 text-white font-bold py-4 rounded-xl hover:bg-green-700 transition shadow-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100 mt-4"
                >
                  {loading ? 'Invio in corso...' : 'Invia Richiesta'}
                </button>
              </form>
            )}
          </div>

          {/* LISTA RICHIESTE */}
          <div className="bg-white/60 p-8 rounded-3xl border border-gray-100 shadow-inner">
            <h3 className="font-extrabold text-2xl mb-6 text-gray-900">
              {(isAdmin || isHR) ? "Richieste da Gestire" : "Le tue richieste"}
            </h3>
            
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {richieste.length === 0 ? (
                <p className="text-center text-gray-400 py-10 font-medium">Nessuna richiesta presente.</p>
              ) : (
                richieste.map(req => (
                  <div key={req.id} className="p-4 sm:p-5 border border-gray-100 rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 group">
                    <div className="space-y-1.5">
                      <div className="font-bold text-base sm:text-lg text-gray-900">{req.dipendenteName}</div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                        <span className="text-xs sm:text-sm font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">{req.data}</span>
                        {getTipoLabel(req.tipo)}
                      </div>
                    </div>
                    
                    <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3">
                      {getStatusBadge(req.stato)}
                      
                      {(isAdmin || isHR) && req.stato === 'In attesa' && (
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleDecision(req.id, true)} 
                            className="px-3 py-1.5 text-xs font-bold bg-green-500 text-white rounded-lg hover:bg-green-600 transition shadow-sm active:scale-95"
                          >
                            Approva
                          </button>
                          <button 
                            onClick={() => handleDecision(req.id, false)} 
                            className="px-3 py-1.5 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 transition shadow-sm active:scale-95"
                          >
                            Rifiuta
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CALENDARIO VIEW */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-extrabold text-2xl text-gray-900 capitalize">{monthName}</h3>
          <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
            <button onClick={() => shiftMonth(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronLeft className="w-5 h-5" /></button>
            <button onClick={() => setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="px-4 py-2 text-sm font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
            <button onClick={() => shiftMonth(1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronRight className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
            <div key={d} className="text-center font-bold text-gray-400 text-sm py-2">{d}</div>
          ))}
        </div>
        
        <div className="grid grid-cols-7 gap-2">
          {calendarCells}
        </div>

        <div className="mt-8 flex flex-wrap gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 justify-center">
          <div className="text-sm font-bold text-gray-500 mr-2">Legenda Colori:</div>
          <div className="flex items-center gap-2 text-xs font-bold text-gray-700"><span className="w-3 h-3 rounded-full bg-yellow-300 shadow-sm"></span> In attesa</div>
          <div className="flex items-center gap-2 text-xs font-bold text-gray-700"><span className="w-3 h-3 rounded-full bg-green-400 shadow-sm"></span> Approvato</div>
          <div className="flex items-center gap-2 text-xs font-bold text-gray-700"><span className="w-3 h-3 rounded-full bg-red-400 shadow-sm"></span> Rifiutato</div>
        </div>
      </div>
    </div>
  );
}
