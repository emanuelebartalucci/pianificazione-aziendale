import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  getDocs,
  writeBatch,
  onSnapshot 
} from 'firebase/firestore';
import { 
  Package, 
  Coffee, 
  Droplet, 
  Utensils, 
  FileText, 
  Sparkles, 
  Wrench, 
  Box, 
  Building2, 
  Send, 
  Plus, 
  Search, 
  Check, 
  ShoppingBag
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { createUserNotification } from '../utils/userNotificationService';

export type SedeAziendale = 'Sede Via Diaz' | 'Sede Via Gramsci';

export type CategoriaFornitura = 
  | 'Distributore Caffè'
  | 'Boccioni Acqua'
  | 'Stoviglie Monouso'
  | 'Cancelleria Varia'
  | 'Materiale Pulizie & Igiene'
  | 'Acquisto Strumenti & Accessori'
  | 'Varie / Altro';

export interface RichiestaFornitura {
  id: string;
  richiedenteNome: string;
  richiedenteEmail: string;
  sede: SedeAziendale;
  categoria: CategoriaFornitura;
  cosaManca: string;
  // Retrocompatibilità per record precedenti:
  articoliSelezionati?: string[];
  altroDettaglio?: string;
  note: string;
  stato: 'In attesa' | 'In lavorazione' | 'Completato' | 'Rifiutato';
  notaRiscontro?: string;
  gestitoDa?: string;
  dataGestione?: string;
  createdAt: string;
}

const CATEGORIE_CONFIG: {
  id: CategoriaFornitura;
  label: string;
  icon: any;
  color: string;
  bgColor: string;
  borderColor: string;
}[] = [
  {
    id: 'Distributore Caffè',
    label: 'Distributore Caffè & Bevande',
    icon: Coffee,
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200'
  },
  {
    id: 'Boccioni Acqua',
    label: 'Boccioni Acqua',
    icon: Droplet,
    color: 'text-cyan-700',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-200'
  },
  {
    id: 'Stoviglie Monouso',
    label: 'Stoviglie Monouso',
    icon: Utensils,
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200'
  },
  {
    id: 'Cancelleria Varia',
    label: 'Cancelleria Varia',
    icon: FileText,
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200'
  },
  {
    id: 'Materiale Pulizie & Igiene',
    label: 'Materiale Pulizie & Igiene',
    icon: Sparkles,
    color: 'text-teal-700',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200'
  },
  {
    id: 'Acquisto Strumenti & Accessori',
    label: 'Acquisto Strumenti & Accessori',
    icon: Wrench,
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200'
  },
  {
    id: 'Varie / Altro',
    label: 'Varie / Altro',
    icon: Box,
    color: 'text-slate-700',
    bgColor: 'bg-slate-100',
    borderColor: 'border-slate-300'
  }
];

export default function Forniture() {
  const { userEmail, myAssociatedName, isGestoreForniture, dipendenti } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<'nuova' | 'mie' | 'gestione'>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'gestione') return 'gestione';
    if (tabParam === 'mie') return 'mie';
    if (tabParam === 'nuova') return 'nuova';
    return isGestoreForniture ? 'gestione' : 'nuova';
  });

  // Form State
  const [selectedSede, setSelectedSede] = useState<SedeAziendale>('Sede Via Diaz');
  const [selectedCategoria, setSelectedCategoria] = useState<CategoriaFornitura>('Distributore Caffè');
  const [cosaManca, setCosaManca] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Data States
  const [mieRichieste, setMieRichieste] = useState<RichiestaFornitura[]>([]);
  const [tutteRichieste, setTutteRichieste] = useState<RichiestaFornitura[]>([]);
  const [loadingMie, setLoadingMie] = useState(false);
  const [loadingTutte, setLoadingTutte] = useState(false);

  // Sotto-tab Gestione ('da_gestire' | 'gestite') e ricerca
  const [subTabGestione, setSubTabGestione] = useState<'da_gestire' | 'gestite'>('da_gestire');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [managingTicket, setManagingTicket] = useState<{
    ticket: RichiestaFornitura;
    action: 'completato' | 'rifiutato';
  } | null>(null);
  const [modalNotaRiscontro, setModalNotaRiscontro] = useState('');
  const [modalLoading, setModalLoading] = useState(false);

  const [confirmDeleteTicket, setConfirmDeleteTicket] = useState<RichiestaFornitura | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Caricamento "Le mie Richieste"
  const loadMieRichieste = () => {
    if (!userEmail) return () => {};
    setLoadingMie(true);
    const qMy = query(
      collection(db, 'richieste_forniture'),
      where('richiedenteEmail', '==', userEmail.toLowerCase().trim())
    );

    const unsubscribe = onSnapshot(qMy, (snap) => {
      const list: RichiestaFornitura[] = [];
      snap.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as RichiestaFornitura);
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setMieRichieste(list);
      setLoadingMie(false);
    }, (err) => {
      console.error("Errore caricamento mie richieste forniture:", err);
      setLoadingMie(false);
    });

    return unsubscribe;
  };

  // Caricamento "Gestione Forniture" (Solo Gestori)
  const loadTutteRichieste = () => {
    if (!isGestoreForniture) return () => {};
    setLoadingTutte(true);
    const qAll = collection(db, 'richieste_forniture');

    const unsubscribe = onSnapshot(qAll, (snap) => {
      const list: RichiestaFornitura[] = [];
      snap.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as RichiestaFornitura);
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setTutteRichieste(list);
      setLoadingTutte(false);
    }, (err) => {
      console.error("Errore caricamento tutte richieste forniture:", err);
      setLoadingTutte(false);
    });

    return unsubscribe;
  };

  // Pulizia automatica richieste più vecchie di 60 giorni dallo storico
  const cleanupOldFornitureRequests = async () => {
    try {
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const qOld = query(
        collection(db, 'richieste_forniture'),
        where('createdAt', '<', sixtyDaysAgo)
      );
      const snap = await getDocs(qOld);
      if (snap.empty) return;

      const batch = writeBatch(db);
      snap.forEach(docSnap => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
      console.log(`[Forniture] Eliminate ${snap.size} richieste fornitura più vecchie di 60 giorni.`);
    } catch (err) {
      console.error("Errore durante la pulizia richieste fornitura > 60 giorni:", err);
    }
  };

  useEffect(() => {
    // Sincronizza il tab attivo quando cambia l'URL (es. clic su notifica con query param)
    const tabParam = searchParams.get('tab');
    if (tabParam === 'gestione' && isGestoreForniture) {
      setActiveTab('gestione');
    } else if (tabParam === 'mie') {
      setActiveTab('mie');
    } else if (tabParam === 'nuova') {
      setActiveTab('nuova');
    }
  }, [searchParams, isGestoreForniture]);

  useEffect(() => {
    // Esegui la pulizia in background delle richieste con più di 60 giorni
    cleanupOldFornitureRequests();

    const unsubMy = loadMieRichieste();
    let unsubAll = () => {};
    if (isGestoreForniture) {
      unsubAll = loadTutteRichieste();
    }
    return () => {
      unsubMy();
      unsubAll();
    };
  }, [userEmail, isGestoreForniture]);

  // Reset form quando si cambia categoria
  const handleSelectCategoria = (cat: CategoriaFornitura) => {
    setSelectedCategoria(cat);
  };

  // Invia Nuova Richiesta
  const handleSubmitRichiesta = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!cosaManca.trim()) {
      showToast("Specifica cosa manca o il materiale necessario.", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Omit<RichiestaFornitura, 'id'> = {
        richiedenteNome: myAssociatedName || userEmail || 'Utente',
        richiedenteEmail: userEmail.toLowerCase().trim(),
        sede: selectedSede,
        categoria: selectedCategoria,
        cosaManca: cosaManca.trim(),
        note: '',
        stato: 'In attesa',
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'richieste_forniture'), payload);

      showToast("Richiesta inviata con successo al reparto fornitori!", "success");
      
      // Reset form
      setCosaManca('');
      setActiveTab('mie');
    } catch (err) {
      console.error("Errore salvataggio richiesta fornitura:", err);
      showToast("Errore durante l'invio della richiesta.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Esegui azione su ticket (per Gestori)
  const handleConfirmActionTicket = async () => {
    if (!managingTicket) return;
    setModalLoading(true);
    const { ticket, action } = managingTicket;

    try {
      const docRef = doc(db, 'richieste_forniture', ticket.id);
      const nuovoStato: 'Completato' | 'Rifiutato' = action === 'completato' ? 'Completato' : 'Rifiutato';

      await updateDoc(docRef, {
        stato: nuovoStato,
        notaRiscontro: modalNotaRiscontro.trim() || null,
        gestitoDa: myAssociatedName || userEmail || 'Gestore Forniture',
        dataGestione: new Date().toISOString()
      });

      // Notifica interna all'utente richiedente
      if (ticket.richiedenteEmail) {
        const dipTarget = dipendenti.find(d => d.email?.toLowerCase().trim() === ticket.richiedenteEmail.toLowerCase().trim());
        let msg = nuovoStato === 'Completato'
          ? `La tua richiesta di forniture per "${ticket.categoria}" (${ticket.sede}) è stata completata.`
          : `La tua richiesta di forniture per "${ticket.categoria}" (${ticket.sede}) è stata rifiutata.`;
        if (modalNotaRiscontro.trim()) {
          msg += ` Nota del gestore: "${modalNotaRiscontro.trim()}"`;
        }
        const titoloNotifica = nuovoStato === 'Completato' 
          ? 'Forniture: Richiesta Completata' 
          : 'Forniture: Richiesta Rifiutata';

        await createUserNotification({
          destinatarioEmail: ticket.richiedenteEmail,
          destinatarioNome: dipTarget?.nome || ticket.richiedenteNome || 'Collaboratore',
          titolo: titoloNotifica,
          messaggio: msg,
          tipo: 'info',
          link: '/forniture?tab=mie'
        });
      }

      showToast(`Richiesta aggiornata a: ${nuovoStato}`, "success");
      setManagingTicket(null);
      setModalNotaRiscontro('');
    } catch (err) {
      console.error("Errore aggiornamento ticket fornitura:", err);
      showToast("Errore durante l'aggiornamento.", "error");
    } finally {
      setModalLoading(false);
    }
  };

  // Cancella richiesta (propria o da gestore)
  const handleDeleteTicket = async () => {
    if (!confirmDeleteTicket) return;
    try {
      await deleteDoc(doc(db, 'richieste_forniture', confirmDeleteTicket.id));
      showToast("Richiesta eliminata con successo.", "success");
      setConfirmDeleteTicket(null);
    } catch (err) {
      console.error("Errore eliminazione richiesta fornitura:", err);
      showToast("Errore durante l'eliminazione.", "error");
    }
  };

  // Partizione e conteggi per Gestori
  const richiesteDaGestire = useMemo(() => {
    return tutteRichieste.filter(r => r.stato === 'In attesa' || r.stato === 'In lavorazione' || !r.stato);
  }, [tutteRichieste]);

  const richiesteGestite = useMemo(() => {
    return tutteRichieste.filter(r => r.stato === 'Completato' || r.stato === 'Rifiutato');
  }, [tutteRichieste]);

  const displayedRichiesteGestione = useMemo(() => {
    const baseList = subTabGestione === 'da_gestire' ? richiesteDaGestire : richiesteGestite;
    if (!searchQuery.trim()) return baseList;
    const q = searchQuery.toLowerCase().trim();
    return baseList.filter(r => {
      const inName = (r.richiedenteNome || '').toLowerCase().includes(q);
      const inEmail = (r.richiedenteEmail || '').toLowerCase().includes(q);
      const inCosaManca = (r.cosaManca || '').toLowerCase().includes(q);
      const inArticoli = (r.articoliSelezionati || []).some(a => a.toLowerCase().includes(q));
      const inAltro = (r.altroDettaglio || '').toLowerCase().includes(q);
      const inNote = (r.note || '').toLowerCase().includes(q);
      const inSede = (r.sede || '').toLowerCase().includes(q);
      const inCategoria = (r.categoria || '').toLowerCase().includes(q);
      return inName || inEmail || inCosaManca || inArticoli || inAltro || inNote || inSede || inCategoria;
    });
  }, [subTabGestione, richiesteDaGestire, richiesteGestite, searchQuery]);

  const currentCatConfig = CATEGORIE_CONFIG.find(c => c.id === selectedCategoria) || CATEGORIE_CONFIG[0];

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-[99999] flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl text-xs font-black text-white animate-in slide-in-from-bottom-5 duration-200 ${
          toast.type === 'success' ? 'bg-emerald-600' : (toast.type === 'warning' ? 'bg-amber-600' : 'bg-red-600')
        }`}>
          <span>{toast.type === 'success' ? '✓' : (toast.type === 'warning' ? '⚠️' : '✕')}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/80 backdrop-blur-xl p-6 rounded-[2.5rem] shadow-sm border border-gray-100">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
            <Package className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
              Richieste Forniture & Materiali
            </h1>
            <p className="text-xs font-semibold text-gray-500 mt-0.5">
              Invia richieste di rifornimento materiali, cancelleria, igiene e distributori per le sedi aziendali
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex bg-gray-100 p-1.5 rounded-2xl w-full sm:w-auto overflow-x-auto gap-1">
          <button 
            onClick={() => { setActiveTab('nuova'); setSearchParams({ tab: 'nuova' }); }}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'nuova' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Plus className="w-4 h-4" /> Nuova Richiesta
          </button>
          <button 
            onClick={() => { setActiveTab('mie'); setSearchParams({ tab: 'mie' }); }}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'mie' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileText className="w-4 h-4" /> Le mie Richieste
            {mieRichieste.length > 0 && (
              <span className="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded-full font-black">
                {mieRichieste.length}
              </span>
            )}
          </button>
          {isGestoreForniture && (
            <button 
              onClick={() => { setActiveTab('gestione'); setSearchParams({ tab: 'gestione' }); }}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'gestione' ? 'bg-orange-600 text-white shadow-md' : 'text-orange-700 bg-orange-50 hover:bg-orange-100'
              }`}
            >
              <ShoppingBag className="w-4 h-4" /> Gestione Forniture
              {richiesteDaGestire.length > 0 && (
                <span className="bg-white text-orange-600 text-[10px] px-1.5 py-0.5 rounded-full font-black animate-pulse">
                  {richiesteDaGestire.length}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* --- TAB 1: NUOVA RICHIESTA --- */}
      {activeTab === 'nuova' && (
        <form onSubmit={handleSubmitRichiesta} className="space-y-6 animate-in fade-in duration-200">
          {/* STEP 1: Scelta Sede */}
          <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-sm border border-gray-100 space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-black">1</span>
              <h2 className="text-base font-extrabold text-gray-900">Seleziona la Sede di Riferimento</h2>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(['Sede Via Diaz', 'Sede Via Gramsci'] as const).map(sedeName => {
                const isSelected = selectedSede === sedeName;
                return (
                  <div
                    key={sedeName}
                    onClick={() => setSelectedSede(sedeName)}
                    className={`p-5 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                      isSelected 
                        ? 'border-orange-500 bg-orange-50/50 shadow-md shadow-orange-500/10' 
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-black text-gray-900">{sedeName}</div>
                        <div className="text-[11px] font-semibold text-gray-500">Destinazione rifornimento</div>
                      </div>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-300'}`}>
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* STEP 2: Scelta Macro-Sezione */}
          <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-sm border border-gray-100 space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-black">2</span>
              <h2 className="text-base font-extrabold text-gray-900">Seleziona la Sezione</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {CATEGORIE_CONFIG.map(cat => {
                const isSelected = selectedCategoria === cat.id;
                const IconComponent = cat.icon;
                return (
                  <div
                    key={cat.id}
                    onClick={() => handleSelectCategoria(cat.id)}
                    className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected 
                        ? `${cat.borderColor} ${cat.bgColor} ring-2 ring-orange-400 shadow-md` 
                        : 'border-gray-150 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cat.bgColor} ${cat.color}`}>
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <div className="text-xs font-black text-gray-900 leading-snug">{cat.label}</div>
                    </div>
                    {isSelected && (
                      <span className="w-2.5 h-2.5 rounded-full bg-orange-500 shrink-0"></span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* STEP 3: Dettaglio Richiesta */}
          <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-sm border border-gray-100 space-y-6">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-black">3</span>
              <h2 className="text-base font-extrabold text-gray-900">
                Dettaglio Richiesta per "{currentCatConfig.label}"
              </h2>
            </div>

            {/* Campo Cosa Manca */}
            <div className="space-y-2">
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                Cosa è necessario ordinare o segnalare *
              </label>
              <textarea
                rows={4}
                required
                placeholder="Inserisci qui i materiali, gli articoli mancanti o le segnalazioni da inoltrare al reparto acquisti e forniture..."
                value={cosaManca}
                onChange={e => setCosaManca(e.target.value)}
                className="w-full p-3.5 bg-slate-50 focus:bg-white rounded-xl text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-orange-400 border border-gray-200 shadow-inner resize-none"
              />
            </div>

            {/* Banner Riepilogo & Invio */}
            <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-gray-500 font-semibold">
                Destinazione: <strong className="text-gray-900">{selectedSede}</strong> • Categoria: <strong className="text-orange-600">{currentCatConfig.label}</strong>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-orange-600/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {isSubmitting ? 'Invio in corso...' : 'Invia Richiesta Forniture'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* --- TAB 2: LE MIE RICHIESTE --- */}
      {activeTab === 'mie' && (
        <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-sm border border-gray-100 space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b pb-4">
            <div>
              <h2 className="text-lg font-black text-gray-900">Le mie Richieste Inviate</h2>
              <p className="text-xs text-gray-500 font-semibold">Storico e stato di avanzamento delle tue richieste di fornitura</p>
            </div>
            <button
              onClick={() => { setActiveTab('nuova'); setSearchParams({ tab: 'nuova' }); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Nuova Richiesta
            </button>
          </div>

          {loadingMie ? (
            <div className="p-12 text-center text-gray-400 font-bold text-xs">
              Caricamento richieste in corso...
            </div>
          ) : mieRichieste.length === 0 ? (
            <div className="p-12 text-center text-gray-400 font-bold text-xs bg-slate-50 rounded-2xl border border-dashed border-gray-200">
              Non hai ancora inviato nessuna richiesta di fornitura.
            </div>
          ) : (
            <div className="space-y-3">
              {mieRichieste.map(req => {
                const catConfig = CATEGORIE_CONFIG.find(c => c.id === req.categoria) || CATEGORIE_CONFIG[0];
                const IconComponent = catConfig.icon;

                let statoBadge = 'bg-amber-100 text-amber-900 border-amber-200';
                if (req.stato === 'In lavorazione') statoBadge = 'bg-blue-100 text-blue-900 border-blue-200';
                if (req.stato === 'Completato') statoBadge = 'bg-emerald-100 text-emerald-900 border-emerald-200';
                if (req.stato === 'Rifiutato') statoBadge = 'bg-red-100 text-red-900 border-red-200';

                return (
                  <div key={req.id} className="p-4 rounded-2xl border border-gray-200 bg-white hover:border-gray-300 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5 flex-1">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${catConfig.bgColor} ${catConfig.color}`}>
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-black text-gray-900">{req.categoria}</span>
                          <span className="text-[11px] font-bold bg-slate-100 text-gray-600 px-2 py-0.5 rounded-md border border-slate-200">
                            {req.sede}
                          </span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${statoBadge}`}>
                            {req.stato}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-gray-700">
                          {req.cosaManca || req.altroDettaglio || (req.articoliSelezionati && req.articoliSelezionati.join(', '))}
                        </div>
                        {req.note && (
                          <div className="text-[11px] text-gray-500 italic">
                            "{req.note}"
                          </div>
                        )}
                        {req.notaRiscontro && (
                          <div className="text-xs text-indigo-700 font-semibold bg-indigo-50/70 p-2 rounded-lg border border-indigo-100 mt-1.5">
                            <strong>Riscontro ({req.gestitoDa}):</strong> {req.notaRiscontro}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto text-xs text-gray-400 gap-2">
                      <span>{new Date(req.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                      {req.stato === 'In attesa' && (
                        <button
                          onClick={() => setConfirmDeleteTicket(req)}
                          className="text-red-500 hover:text-red-700 font-bold hover:underline cursor-pointer"
                        >
                          Annulla
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* --- TAB 3: GESTIONE FORNITURE (Solo Gestori Forniture) --- */}
      {activeTab === 'gestione' && isGestoreForniture && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Switch Richieste da Gestire vs Richieste Gestite & Ricerca */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-3 sm:p-4 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex bg-gray-100 p-1.5 rounded-xl w-full sm:w-auto gap-1">
              <button
                type="button"
                onClick={() => setSubTabGestione('da_gestire')}
                className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-black rounded-lg transition-all cursor-pointer ${
                  subTabGestione === 'da_gestire'
                    ? 'bg-white text-orange-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>Richieste da Gestire</span>
                {richiesteDaGestire.length > 0 && (
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    subTabGestione === 'da_gestire' ? 'bg-orange-100 text-orange-700' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {richiesteDaGestire.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setSubTabGestione('gestite')}
                className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-black rounded-lg transition-all cursor-pointer ${
                  subTabGestione === 'gestite'
                    ? 'bg-white text-orange-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>Richieste Gestite</span>
                {richiesteGestite.length > 0 && (
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    subTabGestione === 'gestite' ? 'bg-orange-100 text-orange-700' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {richiesteGestite.length}
                  </span>
                )}
              </button>
            </div>

            {/* Ricerca Rapida */}
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cerca per richiedente o materiale..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 bg-slate-50 focus:bg-white rounded-xl text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-orange-400 border border-gray-200 shadow-inner"
              />
            </div>
          </div>

          {/* Elenco Richieste */}
          {loadingTutte ? (
            <div className="p-12 text-center text-gray-400 font-bold text-xs bg-white rounded-3xl border border-gray-100">
              Caricamento richieste forniture in corso...
            </div>
          ) : displayedRichiesteGestione.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-100 text-gray-400 font-bold text-xs">
              {subTabGestione === 'da_gestire' 
                ? 'Nessuna richiesta in attesa da gestire.' 
                : 'Nessuna richiesta archiviata tra quelle gestite.'}
            </div>
          ) : (
            <div className="space-y-3">
              {displayedRichiesteGestione.map(ticket => {
                const catCfg = CATEGORIE_CONFIG.find(c => c.id === ticket.categoria) || CATEGORIE_CONFIG[0];
                const IconComp = catCfg.icon;

                let statoBadge = 'bg-amber-100 text-amber-900 border-amber-200';
                if (ticket.stato === 'In lavorazione') statoBadge = 'bg-blue-100 text-blue-900 border-blue-200';
                if (ticket.stato === 'Completato') statoBadge = 'bg-emerald-100 text-emerald-900 border-emerald-200';
                if (ticket.stato === 'Rifiutato') statoBadge = 'bg-red-100 text-red-900 border-red-200';

                return (
                  <div key={ticket.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${catCfg.bgColor} ${catCfg.color}`}>
                          <IconComp className="w-4 h-4" />
                        </div>
                        <span className="text-xs font-black text-gray-900">{ticket.categoria}</span>
                        <span className="text-[11px] font-bold bg-slate-100 text-gray-700 px-2 py-0.5 rounded-md border border-slate-200">
                          {ticket.sede}
                        </span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${statoBadge}`}>
                          {ticket.stato}
                        </span>
                      </div>

                      {/* Richiedente & Data */}
                      <div className="text-xs text-gray-500 font-semibold">
                        Richiesto da: <strong className="text-gray-900">{ticket.richiedenteNome}</strong> ({ticket.richiedenteEmail}) • {new Date(ticket.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>

                      {/* Cosa Manca e Note */}
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                        <div className="text-xs font-semibold text-gray-800">
                          <strong>Cosa serve:</strong> {ticket.cosaManca || ticket.altroDettaglio || (ticket.articoliSelezionati && ticket.articoliSelezionati.join(', '))}
                        </div>
                        {ticket.note && (
                          <div className="text-[11px] text-gray-500 italic">
                            "{ticket.note}"
                          </div>
                        )}
                        {ticket.notaRiscontro && (
                          <div className="text-xs text-indigo-700 font-semibold mt-1">
                            <strong>Nota Gestore ({ticket.gestitoDa}):</strong> {ticket.notaRiscontro}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Azioni per il Gestore: SOLO Segna Completato o Rifiuta */}
                    <div className="flex flex-wrap md:flex-col gap-2 w-full md:w-auto shrink-0">
                      {subTabGestione === 'da_gestire' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setManagingTicket({ ticket, action: 'completato' });
                              setModalNotaRiscontro(ticket.notaRiscontro || '');
                            }}
                            className="flex-1 md:flex-none px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs transition active:scale-95 cursor-pointer text-center flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-4 h-4" /> Segna Completato
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setManagingTicket({ ticket, action: 'rifiutato' });
                              setModalNotaRiscontro(ticket.notaRiscontro || '');
                            }}
                            className="flex-1 md:flex-none px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-black text-xs rounded-xl transition cursor-pointer text-center"
                          >
                            Rifiuta
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteTicket(ticket)}
                          className="px-3 py-1.5 text-gray-400 hover:text-red-600 font-bold text-[11px] transition cursor-pointer text-center"
                        >
                          Elimina
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODALE DI GESTIONE TICKET (Solo Completa o Rifiuta) */}
      {managingTicket && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className={`p-6 text-white flex justify-between items-center ${
              managingTicket.action === 'completato' 
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600' 
                : 'bg-gradient-to-r from-rose-600 to-red-600'
            }`}>
              <div>
                <h3 className="text-base font-black">
                  {managingTicket.action === 'completato' ? '✓ Conferma Evasione Richiesta' : '✕ Rifiuta Richiesta'}
                </h3>
                <p className="text-xs text-white/80 mt-0.5">
                  {managingTicket.ticket.categoria} • {managingTicket.ticket.sede}
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setManagingTicket(null)}
                className="text-white/80 hover:text-white p-1 rounded-full cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-50 p-3.5 rounded-xl border text-xs space-y-1">
                <div>Richiedente: <strong>{managingTicket.ticket.richiedenteNome}</strong></div>
                <div>Cosa serve: <strong>{managingTicket.ticket.cosaManca || managingTicket.ticket.altroDettaglio || (managingTicket.ticket.articoliSelezionati && managingTicket.ticket.articoliSelezionati.join(', '))}</strong></div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                  {managingTicket.action === 'completato' 
                    ? 'Nota di Consegna / Riscontro (Opzionale)' 
                    : 'Motivo del Rifiuto / Nota per il Richiedente (Opzionale)'}
                </label>
                <textarea
                  rows={3}
                  placeholder={
                    managingTicket.action === 'completato' 
                      ? 'Es. Rifornimento effettuato / materiale posizionato in sede...' 
                      : 'Es. Articolo non autorizzato / già disponibile in magazzino...'
                  }
                  value={modalNotaRiscontro}
                  onChange={e => setModalNotaRiscontro(e.target.value)}
                  className="w-full p-3 bg-slate-50 focus:bg-white rounded-xl text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-orange-400 border border-gray-200 resize-none shadow-inner"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setManagingTicket(null)}
                  className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={modalLoading}
                  onClick={handleConfirmActionTicket}
                  className={`flex-1 py-3 text-white font-extrabold text-xs rounded-xl shadow-md transition active:scale-95 cursor-pointer disabled:opacity-50 ${
                    managingTicket.action === 'completato' 
                      ? 'bg-emerald-600 hover:bg-emerald-700' 
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {modalLoading ? 'Salvataggio...' : (managingTicket.action === 'completato' ? 'Conferma Completamento' : 'Conferma Rifiuto')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      <ConfirmModal
        isOpen={Boolean(confirmDeleteTicket)}
        title="Elimina Richiesta Fornitura"
        message="Sei sicuro di voler eliminare definitivamente questa richiesta di fornitura?"
        confirmText="Elimina"
        type="danger"
        onConfirm={handleDeleteTicket}
        onCancel={() => setConfirmDeleteTicket(null)}
      />
    </div>
  );
}
