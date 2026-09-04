import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { Send, MessageSquare, Shield, RefreshCw, HeartPulse } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import QuestionnaireModal from '../components/QuestionnaireModal';
import { isSoci } from './Impostazioni';

export default function Suggerimenti() {
  const navigate = useNavigate();
  const { isHR, myAssociatedName, user } = useAuth();
  
  // Categorie Suggerimenti
  const [categories, setCategories] = useState<{ id: string; nome: string }[]>([]);

  // Form States
  const [categoria, setCategoria] = useState('');
  const [testo, setTesto] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Questionario Pendente Dipendenti
  const [activeQuestionnaire, setActiveQuestionnaire] = useState<{ id: string; questions: any[]; active: boolean; sentAt?: string } | null>(null);
  const [isEmployeeSurveyOpen, setIsEmployeeSurveyOpen] = useState(false);
  const [hasCompletedSurvey, setHasCompletedSurvey] = useState(true);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  const sortCategoriesWithAltroLast = (list: { id: string; nome: string }[]): { id: string; nome: string }[] => {
    return [...list].sort((a, b) => {
      const isAltroA = a.nome.trim().toLowerCase() === 'altro';
      const isAltroB = b.nome.trim().toLowerCase() === 'altro';
      if (isAltroA && !isAltroB) return 1;
      if (!isAltroA && isAltroB) return -1;
      return a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' });
    });
  };

  const loadData = async () => {
    try {
      // 1. Categorie suggerimenti
      const catSnap = await getDocs(collection(db, 'categorie_suggerimenti'));
      if (catSnap.empty) {
        const defaultCats = ['Ambiente di lavoro', 'Strumenti e Risorse', 'Processi e Organizzazione', 'Altro'];
        await Promise.all(defaultCats.map(catName => addDoc(collection(db, 'categorie_suggerimenti'), { nome: catName })));
        const reloadSnap = await getDocs(collection(db, 'categorie_suggerimenti'));
        const list: { id: string; nome: string }[] = [];
        reloadSnap.forEach(d => {
          const name = d.data().nome || d.data().name || d.data().categoria || d.data().titolo || '';
          if (name) list.push({ id: d.id, nome: name });
        });
        setCategories(sortCategoriesWithAltroLast(list));
      } else {
        const list: { id: string; nome: string }[] = [];
        catSnap.forEach(d => {
          const name = d.data().nome || d.data().name || d.data().categoria || d.data().titolo || '';
          if (name) list.push({ id: d.id, nome: name });
        });
        setCategories(sortCategoriesWithAltroLast(list));
      }

      // 2. Questionario Attivo per Dipendenti
      const questDoc = await getDoc(doc(db, 'configurazioni', 'questionario'));
      if (questDoc.exists()) {
        const data = questDoc.data();
        if (data.active) {
          setActiveQuestionnaire(data as any);
        } else {
          setActiveQuestionnaire(null);
        }
      }

      // 3. Verifica Questionario Completato da Utente
      if (isSoci(myAssociatedName) || !user?.uid) {
        setHasCompletedSurvey(true);
      } else {
        const questData = questDoc.exists() ? questDoc.data() : null;
        if (questData && questData.active) {
          const qComp = query(
            collection(db, 'questionari_completati'),
            where('userId', '==', user.uid),
            where('questionnaireId', '==', questData.id)
          );
          const compSnap = await getDocs(qComp);
          setHasCompletedSurvey(!compSnap.empty);
        } else {
          setHasCompletedSurvey(true);
        }
      }
    } catch (err) {
      console.error("Errore caricamento dati Cassetta Idee:", err);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.uid, myAssociatedName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoria || !testo.trim()) {
      showToast("Compila tutti i campi!", "warning");
      return;
    }

    setLoading(true);
    setSuccessMsg('');

    try {
      const todayStr = new Date().toISOString().split('T')[0];
      await addDoc(collection(db, 'suggerimenti'), {
        categoria,
        testo: testo.trim(),
        data: todayStr,
        stato: 'Nuovo'
      });

      setCategoria('');
      setTesto('');
      setSuccessMsg('Suggerimento inviato con successo e in forma completamente anonima!');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      console.error("Errore invio suggerimento:", err);
      showToast("Si è verificato un errore durante l'invio. Riprova più tardi.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 no-print">
      
      {/* HEADER PRINCIPALE */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-4 sm:p-6 border border-white/50 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-2xl"><MessageSquare className="text-purple-600 w-8 h-8" /></div>
            <span>Cassetta delle Idee</span>
          </h2>
          <button 
            onClick={loadData}
            title="Aggiorna Dati"
            className="p-3 text-gray-500 hover:text-purple-600 bg-gray-50 hover:bg-purple-50 border border-gray-100 rounded-2xl transition-all cursor-pointer hover:rotate-180 duration-500"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Link Diretto a Gestione HR per HR */}
        {isHR && (
          <button
            onClick={() => navigate('/gestione-hr')}
            className="px-5 py-3 bg-purple-700 hover:bg-purple-800 text-white font-extrabold text-xs rounded-2xl transition flex items-center gap-2 shadow-md cursor-pointer active:scale-95 shrink-0"
          >
            <HeartPulse className="w-4 h-4" />
            <span>👑 Vai alla Gestione HR & Suggerimenti Ricevuti →</span>
          </button>
        )}
      </div>

      {/* BANNER QUESTIONARIO PENDENTE DIPENDENTI */}
      {!isSoci(myAssociatedName) && activeQuestionnaire && activeQuestionnaire.active && !hasCompletedSurvey && (
        <div className="bg-gradient-to-r from-purple-700 to-indigo-800 text-white rounded-[2rem] p-6 sm:p-8 shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-6 animate-fadeIn border border-purple-500/20">
          <div className="space-y-2 text-left">
            <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 text-white px-3 py-1 rounded-full inline-block">
              📋 Questionario Dipendenti Pendente
            </span>
            <h3 className="text-xl sm:text-2xl font-black">
              {localStorage.getItem(`survey_draft_${user?.uid}_${activeQuestionnaire.id}`) 
                ? 'Riprendi il questionario da dove eri rimasto!' 
                : 'Hai un questionario di soddisfazione da compilare!'}
            </h3>
            <p className="text-xs text-purple-100 font-semibold max-w-xl">
              La tua opinione è preziosa per migliorare il clima aziendale. Il questionario è al 100% anonimo e richiede solo pochi minuti.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsEmployeeSurveyOpen(true)}
            className="px-6 py-4 bg-white text-purple-800 hover:bg-purple-50 font-black text-sm rounded-2xl shadow-lg active:scale-95 transition whitespace-nowrap cursor-pointer shrink-0"
          >
            {localStorage.getItem(`survey_draft_${user?.uid}_${activeQuestionnaire.id}`) 
              ? '📝 Riprendi Questionario' 
              : '🚀 Inizia Questionario'}
          </button>
        </div>
      )}

      {/* FORM COMPILAZIONE SUGGERIMENTO ANONIMO */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 max-w-3xl mx-auto w-full">
        <div className="bg-blue-50/60 border border-blue-100 rounded-3xl p-6 mb-8 flex gap-4 items-start shadow-sm">
          <Shield className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-3">
            <h4 className="font-extrabold text-blue-950 text-base">La tua privacy è al sicuro (Anonimato Garantito)</h4>
            <p className="text-sm text-blue-900/80 leading-relaxed">
              Questa sezione è stata programmata per garantire la massima riservatezza ed anonimato nell'invio dei suggerimenti e feedback aziendali:
            </p>
            <ul className="list-disc pl-4 text-xs text-blue-900/85 space-y-2 leading-relaxed">
              <li><strong>Disaccoppiamento dei dati</strong>: Il sistema registra solo che hai partecipato, ma le risposte ed il testo sono inviati in modo totalmente anonimo.</li>
              <li><strong>Zero tracciamento temporale</strong>: L'ora esatta di sottomissione non viene memorizzata per evitare incroci dei log.</li>
              <li><strong>Nessun dato digitale memorizzato</strong>: Non vengono registrati IP, informazioni sul browser o cookies identificativi.</li>
            </ul>
          </div>
        </div>

        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl mb-6 font-bold text-center text-sm">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Categoria</label>
            <select
              required
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
              className="w-full p-4 border-none rounded-2xl bg-gray-50 outline-none focus:ring-2 focus:ring-purple-500 shadow-inner font-bold text-gray-700 transition"
            >
              <option value="">-- Seleziona Categoria --</option>
              {categories.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Il tuo Suggerimento o Consiglio</label>
            <textarea
              required
              rows={6}
              value={testo}
              onChange={e => setTesto(e.target.value)}
              placeholder="Scrivi qui liberamente il tuo consiglio o la tua segnalazione..."
              className="w-full p-4 border-none rounded-2xl bg-gray-50 outline-none focus:ring-2 focus:ring-purple-500 shadow-inner font-medium text-gray-900 placeholder-gray-400 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-700 text-white font-extrabold py-4 rounded-2xl hover:bg-purple-800 transition shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Send className="w-5 h-5" />
            {loading ? 'Invio in corso...' : 'Invia in Forma Anonima'}
          </button>
        </form>
      </div>

      {/* Modal Questionario Dipendenti */}
      {isEmployeeSurveyOpen && activeQuestionnaire && (
        <QuestionnaireModal
          isOpen={isEmployeeSurveyOpen}
          onClose={() => {
            setIsEmployeeSurveyOpen(false);
            loadData();
          }}
          activeQuestionnaire={activeQuestionnaire}
          userId={user?.uid || ''}
        />
      )}

      {/* Toast Notification */}
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
    </div>
  );
}
