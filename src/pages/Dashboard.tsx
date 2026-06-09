import { useState, useEffect, useMemo } from 'react';
import { Briefcase, Calendar, Settings, FileText, MessageSquare, Plus, Trash2, Megaphone, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, deleteDoc, onSnapshot, query, orderBy } from 'firebase/firestore';
import ConfirmModal from '../components/ConfirmModal';

interface Announcement {
  id: string;
  titolo: string;
  contenuto: string;
  autore: 'HR' | 'Direzione';
  data: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin, isHR, myAssociatedName, user } = useAuth();

  // States per le comunicazioni
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newAuthor, setNewAuthor] = useState<'HR' | 'Direzione'>('Direzione');
  const [loading, setLoading] = useState(false);

  // Stato per la modale di conferma
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Caricamento comunicazioni in tempo reale
  useEffect(() => {
    const q = query(collection(db, 'comunicazioni'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: Announcement[] = [];
      snapshot.forEach(docSnap => {
        list.push({
          id: docSnap.id,
          ...docSnap.data()
        } as Announcement);
      });
      setAnnouncements(list);
    });
    return () => unsub();
  }, []);

  const handleCreateNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setLoading(true);
    try {
      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
      
      await addDoc(collection(db, 'comunicazioni'), {
        titolo: newTitle.trim(),
        contenuto: newContent.trim(),
        autore: newAuthor,
        data: dateStr,
        createdAt: new Date().toISOString()
      });

      setNewTitle('');
      setNewContent('');
      setNewAuthor('Direzione');
      setIsModalOpen(false);
    } catch (err) {
      console.error("Errore nella pubblicazione dell'avviso:", err);
      alert("Errore durante la pubblicazione.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNotice = (id: string, titolo: string) => {
    triggerConfirm(
      "Elimina Comunicazione",
      `Sei sicuro di voler eliminare la comunicazione "${titolo}"?`,
      async () => {
        try {
          await deleteDoc(doc(db, 'comunicazioni', id));
        } catch (err) {
          console.error("Errore nell'eliminazione della comunicazione:", err);
        }
      }
    );
  };

  // Promemoria automatico registro presenze (ultimi 2 giorni del mese e fino al 5 del mese successivo)
  const displayAnnouncements = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    
    // Mostra il promemoria negli ultimi 2 giorni del mese (daysInMonth - 2, es. dal 28 in un mese di 30 giorni)
    // o nei primi 5 giorni del mese successivo (fino al 5 compreso)
    const showReminder = (d >= daysInMonth - 2) || (d <= 5);
    
    if (showReminder) {
      // Se siamo nei primi 5 giorni, ricordiamo il mese precedente. Altrimenti il mese in corso.
      const targetMonthIndex = d <= 5 ? (m === 0 ? 11 : m - 1) : m;
      const targetYear = d <= 5 && m === 0 ? y - 1 : y;
      const nomeMese = [
        'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
      ][targetMonthIndex];

      const reminder: Announcement = {
        id: 'system-reminder-presenze',
        titolo: '⚠️ Promemoria: Compilazione Registro Presenze',
        contenuto: `Si ricorda a tutti i dipendenti di compilare, verificare ed inviare il proprio foglio presenze per il mese di ${nomeMese} ${targetYear} all'HR per l'approvazione delle buste paga.`,
        autore: 'HR',
        data: `${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`
      };
      
      return [reminder, ...announcements];
    }
    
    return announcements;
  }, [announcements]);

  const welcomeName = myAssociatedName || user?.email || 'Utente';
  const showAdminSettings = isAdmin;
  const canPublish = isAdmin || isHR;

  return (
    <div className="max-w-7xl mx-auto px-4 mt-8 flex flex-col gap-6">
      
      {/* Intestazione di benvenuto */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-6 sm:p-8 border border-white/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Pianificazione Aziendale</h1>
          <p className="text-sm font-bold text-indigo-600/80 mt-1">Ciao, {welcomeName}! Benvenuto nel tuo portale di lavoro.</p>
        </div>
      </div>

      {/* Griglia a due colonne: Operational links a sinistra, News a destra */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* COLONNA SINISTRA: SEZIONI OPERATIVE (2/3 di larghezza) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            
            {/* Pianificazione Commesse */}
            <div 
              onClick={() => navigate('/commesse')} 
              className="bg-white/80 backdrop-blur-xl p-8 rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between min-h-[180px]"
            >
              <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <Briefcase className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-gray-800 mt-4">Pianificazione Commesse</h2>
                <p className="text-xs font-semibold text-gray-400 mt-1">Gestisci e visualizza i tuoi impegni settimanali e i progetti.</p>
              </div>
            </div>
            
            {/* Piano Ferie */}
            <div 
              onClick={() => navigate('/ferie')} 
              className="bg-white/80 backdrop-blur-xl p-8 rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between min-h-[180px]"
            >
              <div className="w-14 h-14 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors">
                <Calendar className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-gray-800 mt-4">Piano Ferie</h2>
                <p className="text-xs font-semibold text-gray-400 mt-1">Richiedi giorni di ferie o assenze e controlla il calendario.</p>
              </div>
            </div>

            {/* Registro Presenze */}
            <div 
              onClick={() => navigate('/presenze')} 
              className="bg-white/80 backdrop-blur-xl p-8 rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between min-h-[180px]"
            >
              <div className="w-14 h-14 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <FileText className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-gray-800 mt-4">Registro Presenze</h2>
                <p className="text-xs font-semibold text-gray-400 mt-1">Compila il rapportino mensile delle ore e dei rimborsi trasferte.</p>
              </div>
            </div>

            {/* Cassetta delle Idee */}
            <div 
              onClick={() => navigate('/suggerimenti')} 
              className="bg-white/80 backdrop-blur-xl p-8 rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between min-h-[180px]"
            >
              <div className="w-14 h-14 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors">
                <MessageSquare className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-gray-800 mt-4">Cassetta delle Idee</h2>
                <p className="text-xs font-semibold text-gray-400 mt-1">Invia suggerimenti e partecipa in forma anonima alla valutazione clima.</p>
              </div>
            </div>

            {/* Impostazioni Admin */}
            {showAdminSettings && (
              <div 
                onClick={() => navigate('/impostazioni')} 
                className="bg-white/80 backdrop-blur-xl p-8 rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between min-h-[180px]"
              >
                <div className="w-14 h-14 bg-gray-100 text-gray-600 rounded-2xl flex items-center justify-center group-hover:bg-gray-800 group-hover:text-white transition-colors">
                  <Settings className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-gray-800 mt-4">Impostazioni Admin</h2>
                  <p className="text-xs font-semibold text-gray-400 mt-1">Gestisci ruoli, anagrafica dipendenti e catalogo commesse.</p>
                </div>
              </div>
            )}
            
          </div>
        </div>

        {/* COLONNA DESTRA: BACHECA NEWS (1/3 di larghezza) */}
        <div className="lg:col-span-1">
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-lg border border-white/50 p-6 flex flex-col min-h-[400px]">
            <div className="flex justify-between items-center pb-4 border-b border-gray-100 mb-4">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-indigo-600" />
                <span>Bacheca News</span>
              </h3>
              {canPublish && (
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-xl transition shadow active:scale-95 flex items-center justify-center"
                  title="Nuova Comunicazione"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Elenco comunicazioni */}
            <div className="space-y-4 overflow-y-auto max-h-[500px] pr-1 flex-1">
              {displayAnnouncements.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-12 text-gray-400">
                  <Megaphone className="w-10 h-10 stroke-[1.5] opacity-50 mb-2" />
                  <p className="text-sm font-bold italic">Nessuna comunicazione pubblicata.</p>
                </div>
              ) : (
                displayAnnouncements.map(ann => {
                  const isHRAuthor = ann.autore === 'HR';
                  const isReminder = ann.id === 'system-reminder-presenze';
                  return (
                    <div 
                      key={ann.id} 
                      className={`p-5 rounded-2xl shadow-sm hover:shadow-md transition flex flex-col justify-between gap-3 relative group/item ${
                        isReminder 
                          ? 'bg-amber-50/80 border-l-4 border-l-amber-500 border-y border-r border-amber-200/70' 
                          : 'bg-white/60 border border-gray-100'
                      }`}
                    >
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                            isReminder 
                              ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                              : isHRAuthor 
                                ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                                : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                          }`}>
                            {ann.autore}
                          </span>
                          <span className="text-[10px] font-bold text-gray-400">{ann.data}</span>
                        </div>
                        <h4 className="text-base font-extrabold text-gray-900 mt-2">{ann.titolo}</h4>
                        <p className="text-sm text-gray-600 leading-relaxed font-medium whitespace-pre-wrap mt-1.5">{ann.contenuto}</p>
                      </div>

                      {canPublish && !isReminder && (
                        <button
                          onClick={() => handleDeleteNotice(ann.id, ann.titolo)}
                          className="absolute top-4 right-4 text-gray-300 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition opacity-0 group-hover/item:opacity-100"
                          title="Elimina avviso"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>

      {/* MODALE DI CREAZIONE NEWS */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-lg w-full border border-gray-100 p-8 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                <Megaphone className="w-6 h-6 text-indigo-600" />
                <span>Nuova Comunicazione</span>
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNotice} className="space-y-4">
              <div>
                <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Titolo dell'Avviso</label>
                <input
                  required
                  type="text"
                  placeholder="Es. Chiusura Estiva Uffici"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full p-3.5 border-none rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-inner font-bold text-gray-700"
                />
              </div>

              <div>
                <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Firma / Autore</label>
                <select
                  value={newAuthor}
                  onChange={e => setNewAuthor(e.target.value as 'HR' | 'Direzione')}
                  className="w-full p-3.5 border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700"
                >
                  <option value="Direzione">Direzione</option>
                  <option value="HR">HR</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Testo della Comunicazione</label>
                <textarea
                  required
                  rows={5}
                  placeholder="Scrivi qui l'avviso ufficiale..."
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  className="w-full p-4 border-none rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-medium text-gray-800 transition placeholder-gray-400"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3.5 px-4 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3.5 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition active:scale-95 disabled:opacity-50"
                >
                  {loading ? 'Pubblicazione...' : 'Pubblica Avviso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ConfirmModal per l'eliminazione */}
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
