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
  description: string;
  placeholder: string;
}[] = [
  {
    id: 'Distributore Caffè',
    label: 'Distributore Caffè & Bevande',
    icon: Coffee,
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    description: 'Segnala cosa è terminato o eventuali guasti per il rifornitore',
    placeholder: 'Es. Manca il caffè, mancano i bicchierini/palette, lo zucchero, oppure segnalazione guasto distributore...'
  },
  {
    id: 'Boccioni Acqua',
    label: 'Boccioni Acqua',
    icon: Droplet,
    color: 'text-cyan-700',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-200',
    description: 'Rifornimento boccioni d\'acqua o bicchieri dedicati',
    placeholder: 'Es. Finiti i boccioni d\'acqua al piano, mancano i bicchieri, guasto erogatore...'
  },
  {
    id: 'Stoviglie Monouso',
    label: 'Stoviglie Monouso',
    icon: Utensils,
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    description: 'Bicchieri, piatti, posate e tovaglioli per le aree ristoro',
    placeholder: 'Es. Mancano forchette, coltelli, piatti monouso, bicchieri o tovaglioli...'
  },
  {
    id: 'Cancelleria Varia',
    label: 'Cancelleria Varia',
    icon: FileText,
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    description: 'Carta per stampanti, toner, penne, blocchi note e cancelleria',
    placeholder: 'Es. Carta da stampa A4 / A3, penne, evidenziatori, toner, blocchi note, post-it...'
  },
  {
    id: 'Materiale Pulizie & Igiene',
    label: 'Materiale Pulizie & Igiene',
    icon: Sparkles,
    color: 'text-teal-700',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
    description: 'Sapone, carta igienica, asciugamani, sacchi e prodotti pulizia',
    placeholder: 'Es. Carta igienica, carta asciugamani, sapone mani, sacchi spazzatura, detersivi...'
  },
  {
    id: 'Acquisto Strumenti & Accessori',
    label: 'Acquisto Strumenti & Accessori',
    icon: Wrench,
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    description: 'Richiesta di acquisto accessori (mouse, tastiere, adattatori...)',
    placeholder: 'Es. Mouse ergonomico per postazione 04, adattatore HDMI, cavo di rete...'
  },
  {
    id: 'Varie / Altro',
    label: 'Varie / Altro',
    icon: Box,
    color: 'text-slate-700',
    bgColor: 'bg-slate-100',
    borderColor: 'border-slate-300',
    description: 'Altre richieste di rifornimento o segnalazioni generali',
    placeholder: 'Es. Descrivere la richiesta di materiale o segnalazione per la sede...'
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

  // Filters for Gestione Tab
  const [filterSede, setFilterSede] = useState<string>('Tutte');
  const [filterCategoria, setFilterCategoria] = useState<string>('Tutte');
  const [filterStato, setFilterStato] = useState<string>('In attesa');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [managingTicket, setManagingTicket] = useState<{
    ticket: RichiestaFornitura;
    action: 'in_lavorazione' | 'completato' | 'rifiutato';
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
      let nuovoStato: 'In lavorazione' | 'Completato' | 'Rifiutato' = 'In lavorazione';
      if (action === 'completato') nuovoStato = 'Completato';
      if (action === 'rifiutato') nuovoStato = 'Rifiutato';

      await updateDoc(docRef, {
        stato: nuovoStato,
        notaRiscontro: modalNotaRiscontro.trim() || null,
        gestitoDa: myAssociatedName || userEmail || 'Gestore Forniture',
        dataGestione: new Date().toISOString()
      });

      // Notifica interna all'utente richiedente
      if (ticket.richiedenteEmail) {
        const dipTarget = dipendenti.find(d => d.email?.toLowerCase().trim() === ticket.richiedenteEmail.toLowerCase().trim());
        let msg = `La tua richiesta di forniture per "${ticket.categoria}" (${ticket.sede}) è stata aggiornata a: ${nuovoStato}.`;
        if (modalNotaRiscontro.trim()) {
          msg += ` Nota: "${modalNotaRiscontro.trim()}"`;
        }
        const titoloNotifica = nuovoStato === 'Completato' 
          ? 'Forniture: Richiesta Completata' 
          : (nuovoStato === 'In lavorazione' ? 'Forniture: Richiesta in Lavorazione' : 'Forniture: Richiesta Non Accoglibile');

        await createUserNotification({
          destinatarioEmail: ticket.richiedenteEmail,
          destinatarioNome: dipTarget?.nome || ticket.richiedenteNome || 'Collaboratore',
          titolo: titoloNotifica,
          messaggio: msg,
          tipo: 'info',
          link: '/forniture?tab=mie'
        });
      }

      showToast(`Richiesta aggiornata a stato: ${nuovoStato}`, "success");
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

  // Conteggi e filtri per Gestori
  const filteredTutteRichieste = useMemo(() => {
    return tutteRichieste.filter(r => {
      if (filterSede !== 'Tutte' && r.sede !== filterSede) return false;
      if (filterCategoria !== 'Tutte' && r.categoria !== filterCategoria) return false;
      if (filterStato !== 'Tutte' && r.stato !== filterStato) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inName = (r.richiedenteNome || '').toLowerCase().includes(q);
        const inEmail = (r.richiedenteEmail || '').toLowerCase().includes(q);
        const inCosaManca = (r.cosaManca || '').toLowerCase().includes(q);
        const inArticoli = (r.articoliSelezionati || []).some(a => a.toLowerCase().includes(q));
        const inAltro = (r.altroDettaglio || '').toLowerCase().includes(q);
        const inNote = (r.note || '').toLowerCase().includes(q);
        if (!inName && !inEmail && !inCosaManca && !inArticoli && !inAltro && !inNote) return false;
      }
      return true;
    });
  }, [tutteRichieste, filterSede, filterCategoria, filterStato, searchQuery]);

  const statsGestore = useMemo(() => {
    const inAttesa = tutteRichieste.filter(r => r.stato === 'In attesa').length;
    const inLavorazione = tutteRichieste.filter(r => r.stato === 'In lavorazione').length;
    const completate = tutteRichieste.filter(r => r.stato === 'Completato').length;
    return { inAttesa, inLavorazione, completate, total: tutteRichieste.length };
  }, [tutteRichieste]);

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
              {statsGestore.inAttesa > 0 && (
                <span className="bg-white text-orange-600 text-[10px] px-1.5 py-0.5 rounded-full font-black animate-pulse">
                  {statsGestore.inAttesa}
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
                    className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                      isSelected 
                        ? `${cat.borderColor} ${cat.bgColor} ring-2 ring-orange-400 shadow-md` 
                        : 'border-gray-150 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cat.bgColor} ${cat.color}`}>
                        <IconComponent className="w-5 h-5" />
                      </div>
                      {isSelected && (
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-black text-gray-900">{cat.label}</div>
                      <div className="text-[10.5px] font-semibold text-gray-500 leading-tight mt-0.5">{cat.description}</div>
                    </div>
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
                Descrivi Cosa Manca per "{currentCatConfig.label}"
              </h2>
            </div>

            {/* Campo Cosa Manca */}
            <div className="space-y-2">
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                Cosa manca / Materiale o segnalazione richiesta *
              </label>
              <textarea
                rows={4}
                required
                placeholder={currentCatConfig.placeholder}
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
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex justify-between items-center bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
            <div>
              <h2 className="text-lg font-extrabold text-gray-900">Le mie Richieste di Rifornimento</h2>
              <p className="text-xs font-semibold text-gray-500">Monitora lo stato di avanzamento delle richieste inoltrate al reparto fornitori</p>
            </div>
            <button
              onClick={() => setActiveTab('nuova')}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl shadow-md transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Nuova Richiesta
            </button>
          </div>

          {loadingMie ? (
            <div className="p-12 text-center text-gray-400 font-bold text-xs bg-white rounded-3xl border border-gray-100">
              Caricamento richieste in corso...
            </div>
          ) : mieRichieste.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-100 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center mx-auto text-xl font-bold">
                📦
              </div>
              <h3 className="text-sm font-bold text-gray-800">Nessuna richiesta inviata</h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                Non hai ancora inviato richieste di rifornimento o materiali. Clicca su "Nuova Richiesta" per inviarne una.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mieRichieste.map(req => {
                const catCfg = CATEGORIE_CONFIG.find(c => c.id === req.categoria) || CATEGORIE_CONFIG[0];
                const IconComp = catCfg.icon;

                let statoColor = 'bg-amber-100 text-amber-800 border-amber-200';
                if (req.stato === 'In lavorazione') statoColor = 'bg-blue-100 text-blue-800 border-blue-200';
                if (req.stato === 'Completato') statoColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                if (req.stato === 'Rifiutato') statoColor = 'bg-red-100 text-red-800 border-red-200';

                return (
                  <div key={req.id} className="bg-white p-5 rounded-2xl border border-gray-150 shadow-sm space-y-3 flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${catCfg.bgColor} ${catCfg.color}`}>
                            <IconComp className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-xs font-black text-gray-900 block">{req.categoria}</span>
                            <span className="text-[11px] font-bold text-gray-500 flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-gray-400" /> {req.sede}
                            </span>
                          </div>
                        </div>

                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${statoColor}`}>
                          {req.stato}
                        </span>
                      </div>

                      {/* Descrizione cosa serve */}
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-150 space-y-1">
                        <div className="text-xs font-semibold text-gray-800">
                          <strong>Cosa serve:</strong> {req.cosaManca || req.altroDettaglio || (req.articoliSelezionati && req.articoliSelezionati.join(', '))}
                        </div>
                        {req.note && (
                          <div className="text-[11px] text-gray-500 italic">
                            "{req.note}"
                          </div>
                        )}
                      </div>

                      {/* Nota di Riscontro del Gestore (se presente) */}
                      {req.notaRiscontro && (
                        <div className="bg-indigo-50/70 p-2.5 rounded-xl border border-indigo-150 text-xs text-indigo-950 font-medium">
                          <span className="font-bold text-indigo-700 block text-[10.5px] uppercase">Riscontro Gestore:</span>
                          {req.notaRiscontro}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[10.5px] text-gray-400 font-semibold">
                      <span>Inviata il: {new Date(req.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
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
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
              <span className="text-[11px] font-bold text-gray-400 uppercase">In Attesa</span>
              <span className="text-3xl font-black text-amber-600 mt-1">{statsGestore.inAttesa}</span>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
              <span className="text-[11px] font-bold text-gray-400 uppercase">In Lavorazione</span>
              <span className="text-3xl font-black text-blue-600 mt-1">{statsGestore.inLavorazione}</span>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
              <span className="text-[11px] font-bold text-gray-400 uppercase">Completate</span>
              <span className="text-3xl font-black text-emerald-600 mt-1">{statsGestore.completate}</span>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
              <span className="text-[11px] font-bold text-gray-400 uppercase">Totale Storico</span>
              <span className="text-3xl font-black text-gray-800 mt-1">{statsGestore.total}</span>
            </div>
          </div>

          {/* Filtri Cruscotto */}
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cerca per richiedente, cosa serve o note..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 focus:bg-white rounded-xl text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-orange-400 border border-gray-200 shadow-inner"
                />
              </div>

              <div className="flex flex-wrap gap-2 w-full md:w-auto">
                <select
                  value={filterSede}
                  onChange={e => setFilterSede(e.target.value)}
                  className="p-2.5 bg-slate-50 rounded-xl text-xs font-bold text-gray-700 outline-none border border-gray-200 cursor-pointer"
                >
                  <option value="Tutte">Tutte le Sedi</option>
                  <option value="Sede Via Diaz">Sede Via Diaz</option>
                  <option value="Sede Via Gramsci">Sede Via Gramsci</option>
                </select>

                <select
                  value={filterCategoria}
                  onChange={e => setFilterCategoria(e.target.value)}
                  className="p-2.5 bg-slate-50 rounded-xl text-xs font-bold text-gray-700 outline-none border border-gray-200 cursor-pointer"
                >
                  <option value="Tutte">Tutte le Categorie</option>
                  {CATEGORIE_CONFIG.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>

                <select
                  value={filterStato}
                  onChange={e => setFilterStato(e.target.value)}
                  className="p-2.5 bg-slate-50 rounded-xl text-xs font-bold text-gray-700 outline-none border border-gray-200 cursor-pointer"
                >
                  <option value="In attesa">Solo In Attesa</option>
                  <option value="In lavorazione">In Lavorazione</option>
                  <option value="Completato">Completate</option>
                  <option value="Tutte">Tutti gli Stati</option>
                </select>
              </div>
            </div>
          </div>

          {/* Elenco Ticket Gestori */}
          {loadingTutte ? (
            <div className="p-12 text-center text-gray-400 font-bold text-xs bg-white rounded-3xl border border-gray-100">
              Caricamento richieste forniture in corso...
            </div>
          ) : filteredTutteRichieste.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-100 text-gray-400 font-bold text-xs">
              Nessuna richiesta fornitura trovata con i filtri selezionati.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTutteRichieste.map(ticket => {
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

                    {/* Azioni Rapide per il Gestore */}
                    <div className="flex flex-wrap md:flex-col gap-2 w-full md:w-auto shrink-0">
                      {ticket.stato === 'In attesa' && (
                        <button
                          onClick={() => {
                            setManagingTicket({ ticket, action: 'in_lavorazione' });
                            setModalNotaRiscontro(ticket.notaRiscontro || '');
                          }}
                          className="flex-1 md:flex-none px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition active:scale-95 cursor-pointer text-center"
                        >
                          Prendi in Carico / Ordina
                        </button>
                      )}

                      {ticket.stato !== 'Completato' && (
                        <button
                          onClick={() => {
                            setManagingTicket({ ticket, action: 'completato' });
                            setModalNotaRiscontro(ticket.notaRiscontro || '');
                          }}
                          className="flex-1 md:flex-none px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition active:scale-95 cursor-pointer text-center"
                        >
                          ✓ Segna Completato
                        </button>
                      )}

                      {ticket.stato !== 'Rifiutato' && ticket.stato !== 'Completato' && (
                        <button
                          onClick={() => {
                            setManagingTicket({ ticket, action: 'rifiutato' });
                            setModalNotaRiscontro(ticket.notaRiscontro || '');
                          }}
                          className="flex-1 md:flex-none px-3 py-1.5 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-700 font-bold text-[11px] rounded-xl transition cursor-pointer text-center"
                        >
                          Non accoglibile
                        </button>
                      )}

                      <button
                        onClick={() => setConfirmDeleteTicket(ticket)}
                        className="px-3 py-1 text-gray-400 hover:text-red-600 font-bold text-[10.5px] transition cursor-pointer text-center"
                      >
                        Elimina
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODALE DI GESTIONE TICKET (Prendi in carico / Completa / Rifiuta) */}
      {managingTicket && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 bg-gradient-to-r from-orange-600 to-amber-600 text-white flex justify-between items-center">
              <div>
                <h3 className="text-base font-extrabold">
                  {managingTicket.action === 'in_lavorazione' && 'Prendi in Carico Richiesta'}
                  {managingTicket.action === 'completato' && 'Conferma Evasione Fornitura'}
                  {managingTicket.action === 'rifiutato' && 'Segna come Non Accoglibile'}
                </h3>
                <p className="text-xs text-orange-100 mt-0.5">
                  {managingTicket.ticket.categoria} • {managingTicket.ticket.sede}
                </p>
              </div>
              <button 
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
                  Nota di Riscontro per il Richiedente (Opzionale)
                </label>
                <textarea
                  rows={3}
                  placeholder={
                    managingTicket.action === 'in_lavorazione' 
                      ? 'Es. Ordinato dal fornitore, consegna prevista giovedì mattina...'
                      : (managingTicket.action === 'completato' 
                        ? 'Es. Rifornimento effettuato / materiale posizionato...' 
                        : 'Es. Materiale già presente in magazzino oppure...')
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
                  className="flex-1 py-3 bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs rounded-xl shadow-md transition active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {modalLoading ? 'Salvataggio...' : 'Conferma'}
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
