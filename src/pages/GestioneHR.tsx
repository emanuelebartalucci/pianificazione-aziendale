import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, deleteDoc, setDoc, getDocs, getDoc } from 'firebase/firestore';
import { MessageSquare, Plus, Trash2, Edit, HeartPulse, Lightbulb, FileText, RefreshCw, Download, Smile, Eye, Users, CheckCircle2, Clock, FolderPlus, Tag } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import QuestionnaireModal from '../components/QuestionnaireModal';
import AnagraficaRisorseSection from '../components/AnagraficaRisorseSection';
import { DEFAULT_QUESTIONS } from '../utils/defaultQuestionnaire';
import { markNotificationsAsReadByFilter } from '../utils/userNotificationService';

interface Suggerimento {
  id: string;
  categoria?: string;
  testo?: string;
  messaggio?: string;
  data?: string;
  stato?: string;
}

interface RispostaClima {
  id: string;
  risposta: string;
  voto: number;
  data: string;
  createdAt: string;
}

const ClimaTrendChart = ({ responses, days, onDaysChange }: { responses: RispostaClima[]; days: number; onDaysChange: (d: number) => void }) => {
  const dailyAverages = useMemo(() => {
    const groups: Record<string, { sum: number; count: number }> = {};
    responses.forEach(r => {
      const dateKey = r.data;
      if (!groups[dateKey]) {
        groups[dateKey] = { sum: 0, count: 0 };
      }
      groups[dateKey].sum += r.voto;
      groups[dateKey].count += 1;
    });

    const sortedDates = Object.keys(groups).sort();
    const lastDates = sortedDates.slice(-days);
    return lastDates.map(date => {
      const avg = Number((groups[date].sum / groups[date].count).toFixed(1));
      const parts = date.split('-');
      const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : date;
      return { date, label, value: avg };
    });
  }, [responses, days]);

  if (dailyAverages.length === 0) {
    return (
      <div className="bg-white rounded-3xl p-6 border border-gray-200 text-center text-gray-400 font-bold italic py-12">
        Nessun dato sufficiente per tracciare il grafico dell'andamento benessere.
      </div>
    );
  }

  const width = 500;
  const height = 180;
  const padding = 30;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const yMax = 10;
  const yMin = 1;

  const points = dailyAverages.map((item, index) => {
    const x = padding + (index / (dailyAverages.length - 1 || 1)) * chartWidth;
    const y = padding + chartHeight - ((item.value - yMin) / (yMax - yMin)) * chartHeight;
    return { x, y, ...item };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = points.length > 0 
    ? `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
    : '';

  return (
    <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h4 className="text-sm font-extrabold text-indigo-950 flex items-center gap-2">
          <span>📈 Andamento Benessere Medio</span>
        </h4>
        <select
          value={days}
          onChange={e => onDaysChange(Number(e.target.value))}
          className="px-3 py-1.5 border border-gray-200 bg-gray-50 rounded-xl text-xs font-bold text-gray-700 focus:ring-2 focus:ring-indigo-400 outline-none cursor-pointer"
        >
          <option value={7}>Ultimi 7 giorni attivi</option>
          <option value={15}>Ultimi 15 giorni attivi</option>
          <option value={30}>Ultimo mese attivo (30gg)</option>
          <option value={90}>Ultimi 3 mesi attivi (90gg)</option>
        </select>
      </div>
      <div className="relative w-full">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          <defs>
            <linearGradient id="climaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          
          {[2, 4, 6, 8, 10].map(val => {
            const y = padding + chartHeight - ((val - yMin) / (yMax - yMin)) * chartHeight;
            return (
              <g key={val} className="opacity-40">
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 4" />
                <text x={padding - 8} y={y + 3} textAnchor="end" className="text-[9px] font-bold fill-gray-400">{val}</text>
              </g>
            );
          })}

          {areaPath && <path d={areaPath} fill="url(#climaGrad)" />}

          {linePath && (
            <path d={linePath} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {points.map((p, i) => {
            const showLabel = i % Math.ceil(points.length / 10) === 0 || i === points.length - 1;
            const r = points.length > 45 ? 1.5 : points.length > 20 ? 2.5 : 4;
            const sw = points.length > 45 ? 1 : points.length > 20 ? 1.5 : 2;
            return (
              <g key={i} className="group cursor-pointer">
                <circle cx={p.x} cy={p.y} r={r} fill="#ffffff" stroke="#4f46e5" strokeWidth={sw} />
                <text x={p.x} y={p.y - 8} textAnchor="middle" className="text-[8px] font-black fill-indigo-700 opacity-0 group-hover:opacity-100 transition-opacity bg-white px-1">
                  {p.value}
                </text>
                {showLabel && (
                  <text x={p.x} y={height - padding + 15} textAnchor="middle" className="text-[8px] font-bold fill-gray-400">
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default function GestioneHR() {
  const { isHR, isDev, userEmail } = useAuth();
  const [activeTab, setActiveTab] = useState<'greetings' | 'wellness' | 'surveys' | 'ideas' | 'risorse'>('greetings');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  // 1. Frasi Benvenuto
  const [greetingsList, setGreetingsList] = useState<{ id: string; testo: string; createdAt?: string }[]>([]);
  const [newGreetingText, setNewGreetingText] = useState('');
  const [editingGreetingId, setEditingGreetingId] = useState<string | null>(null);
  const [editingGreetingText, setEditingGreetingText] = useState('');

  // 2. Benessere & Stress
  const [climaResponses, setClimaResponses] = useState<RispostaClima[]>([]);
  const [climaDays, setClimaDays] = useState<number>(30);

  // 3. Altri Questionari
  const [activeQuestionnaire, setActiveQuestionnaire] = useState<{ id: string; questions: any[]; active: boolean; sentAt?: string } | null>(null);
  const [questionAnswers, setQuestionAnswers] = useState<any[]>([]);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newQuestionType, setNewQuestionType] = useState<'choice' | 'checkbox' | 'text'>('choice');
  const [newQuestionOptionsStr, setNewQuestionOptionsStr] = useState('');
  const [newQuestionSection, setNewQuestionSection] = useState<number>(1);
  const [isTestQuestionnaireOpen, setIsTestQuestionnaireOpen] = useState(false);

  // 4. Cassetta Idee / Suggerimenti
  const [suggerimenti, setSuggerimenti] = useState<Suggerimento[]>([]);
  const [categories, setCategories] = useState<{ id: string; nome: string }[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const triggerConfirm = (title: string, message: string, onConfirm: () => void, type: 'danger' | 'warning' | 'info' = 'danger') => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      },
      type
    });
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

  // Caricamento Dati Generali HR
  const loadData = async () => {
    if (!isHR && !isDev) return;

    // 1. Frasi di Benvenuto
    try {
      const greetSnap = await getDocs(collection(db, 'dashboard_greetings'));
      const greetList: { id: string; testo: string; time: number; createdAt?: string }[] = [];

      const parseGreetingTime = (data: any): number => {
        const c = data.createdAt || data.timestamp || data.data;
        if (!c) return 0;
        if (typeof c === 'number') return c;
        if (typeof c === 'string') {
          const t = new Date(c).getTime();
          return isNaN(t) ? 0 : t;
        }
        if (typeof c === 'object') {
          if (typeof c.toMillis === 'function') return c.toMillis();
          if (typeof c.seconds === 'number') return c.seconds * 1000;
        }
        return 0;
      };

      greetSnap.forEach(d => {
        const data = d.data();
        greetList.push({
          id: d.id,
          testo: data.testo || '',
          time: parseGreetingTime(data),
          createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined
        });
      });

      greetList.sort((a, b) => b.time - a.time);
      setGreetingsList(greetList);
    } catch (err) {
      console.error("Errore caricamento frasi benvenuto:", err);
    }

    // 2. Clima
    try {
      const climaSnap = await getDocs(collection(db, 'risposte_clima'));
      const climaList: RispostaClima[] = [];
      climaSnap.forEach(d => climaList.push({ id: d.id, ...d.data() } as RispostaClima));
      climaList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setClimaResponses(climaList.slice(0, 100));
    } catch (err) {
      console.error("Errore caricamento risposte clima:", err);
    }

    // 3. Questionario Config
    try {
      const questDoc = await getDoc(doc(db, 'configurazioni', 'questionario'));
      if (questDoc.exists()) {
        setActiveQuestionnaire(questDoc.data() as any);
      } else {
        const initialConfig = { id: 'initial_survey', questions: DEFAULT_QUESTIONS, active: false, sentAt: '' };
        await setDoc(doc(db, 'configurazioni', 'questionario'), initialConfig);
        setActiveQuestionnaire(initialConfig);
      }
    } catch (err) {
      console.error("Errore configurazione questionario:", err);
    }

    // 4. Risposte Questionario
    try {
      const ansSnap = await getDocs(collection(db, 'risposte_questionario'));
      const ansList: any[] = [];
      ansSnap.forEach(d => ansList.push({ id: d.id, ...d.data() }));
      setQuestionAnswers(ansList);
    } catch (err) {
      console.error("Errore risposte questionario:", err);
    }

    // 5. Categorie Suggerimenti
    try {
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
    } catch (err) {
      console.error("Errore caricamento categorie suggerimenti:", err);
    }

    // 6. Suggerimenti
    try {
      const sugSnap = await getDocs(collection(db, 'suggerimenti'));
      const sugList: Suggerimento[] = [];
      sugSnap.forEach(d => {
        const data = d.data();
        sugList.push({
          id: d.id,
          categoria: data.categoria || 'Generale',
          testo: data.testo || data.messaggio || '',
          data: data.data || data.timestamp || '',
          stato: data.stato || 'Nuovo'
        });
      });
      sugList.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
      setSuggerimenti(sugList);
    } catch (err) {
      console.error("Errore caricamento suggerimenti:", err);
    }
  };

  useEffect(() => {
    loadData();
    if (userEmail) {
      markNotificationsAsReadByFilter(userEmail, { linkContains: '/gestione-hr' });
      markNotificationsAsReadByFilter(userEmail, { tipo: 'suggerimento_ricevuto' });
    }
  }, [isHR, isDev, userEmail]);

  // Handlers Frasi Benvenuto
  const handleAddGreeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGreetingText.trim()) return;
    try {
      await addDoc(collection(db, 'dashboard_greetings'), {
        testo: newGreetingText.trim(),
        createdAt: new Date().toISOString()
      });
      setNewGreetingText('');
      await loadData();
      showToast("Frase di benvenuto aggiunta!");
    } catch (err) {
      showToast("Errore durante l'aggiunta", "error");
    }
  };

  const handlePopulateDefaultGreetings = async () => {
    const defaultPhrases = [
      "Felici di collaborare con te anche oggi.",
      "Ti auguriamo una splendida giornata di lavoro.",
      "Il tuo spazio di lavoro è pronto.",
      "Ti diamo il benvenuto nel tuo portale aziendale.",
      "Buon lavoro e buona giornata da parte nostra.",
      "Felici di ritrovarti, ti auguriamo una buona giornata.",
      "Ti auguriamo il meglio per le attività di oggi.",
      "Grazie per il tuo prezioso contributo quotidiano."
    ];
    try {
      const now = Date.now();
      for (let i = 0; i < defaultPhrases.length; i++) {
        await addDoc(collection(db, 'dashboard_greetings'), {
          testo: defaultPhrases[i],
          createdAt: new Date(now + i * 1000).toISOString()
        });
      }
      await loadData();
      showToast("Frasi predefinite caricate!");
    } catch (err) {
      showToast("Errore caricamento frasi", "error");
    }
  };

  const handleSaveEditGreeting = async (id: string) => {
    if (!editingGreetingText.trim()) return;
    try {
      await setDoc(doc(db, 'dashboard_greetings', id), {
        testo: editingGreetingText.trim(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setEditingGreetingId(null);
      await loadData();
      showToast("Frase modificata!");
    } catch (err) {
      showToast("Errore salvataggio", "error");
    }
  };

  const handleDeleteGreeting = async (id: string) => {
    triggerConfirm(
      "Elimina Frase",
      "Sei sicuro di voler eliminare questa frase di benvenuto?",
      async () => {
        try {
          await deleteDoc(doc(db, 'dashboard_greetings', id));
          await loadData();
          showToast("Frase eliminata!");
        } catch (err) {
          showToast("Errore eliminazione", "error");
        }
      }
    );
  };

  // Handlers Questionari

  const handleDeleteQuestion = (qId: string) => {
    if (!activeQuestionnaire) return;
    triggerConfirm(
      "Elimina Domanda",
      "Sei sicuro di voler eliminare questa domanda?",
      async () => {
        const updated = activeQuestionnaire.questions.filter(q => q.id !== qId);
        try {
          await setDoc(doc(db, 'configurazioni', 'questionario'), { ...activeQuestionnaire, questions: updated });
          loadData();
          showToast("Domanda eliminata!");
        } catch (err) {
          showToast("Errore eliminazione", "error");
        }
      }
    );
  };

  const handleAddQuestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuestionnaire || !newQuestionText.trim()) return;
    const opts = newQuestionOptionsStr.split(',').map(o => o.trim()).filter(Boolean);
    const newQ = {
      id: `q_${Date.now()}`,
      text: newQuestionText.trim(),
      type: newQuestionType,
      options: newQuestionType !== 'text' ? opts : [],
      section: newQuestionSection
    };
    try {
      await setDoc(doc(db, 'configurazioni', 'questionario'), {
        ...activeQuestionnaire,
        questions: [...activeQuestionnaire.questions, newQ]
      });
      setNewQuestionText('');
      setNewQuestionOptionsStr('');
      setNewQuestionSection(1);
      loadData();
      showToast("Nuova domanda aggiunta!");
    } catch (err) {
      showToast("Errore aggiunta domanda", "error");
    }
  };

  const handleToggleQuestionnaireActive = async () => {
    if (!activeQuestionnaire) return;
    const newStatus = !activeQuestionnaire.active;
    try {
      await setDoc(doc(db, 'configurazioni', 'questionario'), {
        ...activeQuestionnaire,
        active: newStatus,
        sentAt: newStatus ? new Date().toISOString() : activeQuestionnaire.sentAt
      });
      loadData();
      showToast(`Questionario ${newStatus ? 'ATTIVATO' : 'DISATTIVATO'} con successo!`);
    } catch (err) {
      showToast("Errore cambio stato questionario", "error");
    }
  };

  // Statistiche Risposte Questionario
  const questionnaireStats = useMemo(() => {
    if (!activeQuestionnaire) return { totalSubmissions: 0, questionStats: {} };
    const activeResponses = questionAnswers.filter(a => a.questionnaireId === activeQuestionnaire.id);
    const totalSubmissions = activeResponses.length;
    const qStats: Record<string, { type: string; optionsCounts?: Record<string, { count: number; pct: number }>; textResponses?: string[] }> = {};

    activeQuestionnaire.questions.forEach(q => {
      if (q.type === 'choice' || q.type === 'checkbox') {
        const counts: Record<string, number> = {};
        q.options?.forEach((opt: string) => { counts[opt] = 0; });
        activeResponses.forEach(resp => {
          const ans = resp.answers?.[q.id];
          if (q.type === 'choice' && typeof ans === 'string') {
            if (counts[ans] !== undefined) counts[ans]++;
            else if (ans) counts[ans] = 1;
          } else if (q.type === 'checkbox' && Array.isArray(ans)) {
            ans.forEach(opt => { counts[opt] = (counts[opt] || 0) + 1; });
          }
        });
        const optionsCounts: Record<string, { count: number; pct: number }> = {};
        Object.entries(counts).forEach(([opt, count]) => {
          optionsCounts[opt] = { count, pct: totalSubmissions > 0 ? Math.round((count / totalSubmissions) * 100) : 0 };
        });
        qStats[q.id] = { type: q.type, optionsCounts };
      } else if (q.type === 'text') {
        const textResponses: string[] = [];
        activeResponses.forEach(resp => {
          const ans = resp.answers?.[q.id];
          if (typeof ans === 'string' && ans.trim()) textResponses.push(ans.trim());
        });
        qStats[q.id] = { type: q.type, textResponses };
      }
    });

    return { totalSubmissions, questionStats: qStats };
  }, [activeQuestionnaire, questionAnswers]);

  // Download Risposte Aperte in TXT
  const handleDownloadOpenAnswers = () => {
    if (!activeQuestionnaire) return;
    let content = `RISPOSTE APERTE QUESTIONARIO SODDISFAZIONE HR\r\n`;
    content += `ID Questionario: ${activeQuestionnaire.id}\r\nData estrazione: ${new Date().toLocaleString('it-IT')}\r\n`;
    content += `Risposte totali: ${questionnaireStats.totalSubmissions}\r\n========================================================================\r\n\r\n`;

    activeQuestionnaire.questions.forEach((q, idx) => {
      if (q.type === 'text') {
        const qStat = questionnaireStats.questionStats[q.id];
        const answers = qStat?.textResponses || [];
        content += `${idx + 1}. DOMANDA: ${q.text}\r\n------------------------------------------------------------------------\r\n`;
        if (answers.length === 0) content += `(Nessuna risposta scritta pervenuta)\r\n`;
        else answers.forEach((ans, aIdx) => { content += `- [Risposta #${aIdx + 1}] ${ans}\r\n`; });
        content += `\n========================================================================\r\n\r\n`;
      }
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Risposte_Aperte_Questionario_HR_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleUpdateIdeaStatus = async (id: string, newStato: string) => {
    try {
      await setDoc(doc(db, 'suggerimenti', id), { stato: newStato }, { merge: true });
      loadData();
      if (userEmail) {
        markNotificationsAsReadByFilter(userEmail, { linkContains: '/gestione-hr' });
        markNotificationsAsReadByFilter(userEmail, { tipo: 'suggerimento_ricevuto' });
      }
      showToast(newStato === 'Letto' ? "Suggerimento contrassegnato come Letto!" : "Suggerimento ripristinato come Non Letto!");
    } catch (err) {
      showToast("Errore aggiornamento stato", "error");
    }
  };

  const handleDeleteIdea = (id: string) => {
    triggerConfirm(
      "Elimina Suggerimento",
      "Sei sicuro di voler eliminare questo suggerimento?",
      async () => {
        try {
          await deleteDoc(doc(db, 'suggerimenti', id));
          loadData();
          showToast("Suggerimento eliminato!");
        } catch (err) {
          showToast("Errore eliminazione", "error");
        }
      }
    );
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newCategoryName.trim();
    if (!clean) return;

    if (categories.some(c => c.nome.toLowerCase() === clean.toLowerCase())) {
      showToast("Questa categoria è già presente!", "warning");
      return;
    }

    try {
      await addDoc(collection(db, 'categorie_suggerimenti'), { nome: clean });
      setNewCategoryName('');
      await loadData();
      showToast("Categoria aggiunta con successo!");
    } catch (err) {
      console.error("Errore aggiunta categoria:", err);
      showToast("Errore durante l'aggiunta della categoria", "error");
    }
  };

  const handleDeleteCategory = (id: string, nome: string) => {
    triggerConfirm(
      "Elimina Categoria",
      `Sei sicuro di voler eliminare la categoria "${nome}"? Non sarà più selezionabile per i nuovi suggerimenti.`,
      async () => {
        try {
          await deleteDoc(doc(db, 'categorie_suggerimenti', id));
          await loadData();
          showToast("Categoria eliminata con successo!");
        } catch (err) {
          console.error("Errore eliminazione categoria:", err);
          showToast("Errore eliminazione categoria", "error");
        }
      }
    );
  };

  if (!isHR && !isDev) {
    return (
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] p-8 border border-white/50 text-center">
        <h3 className="text-xl font-bold text-red-600">Accesso Riservato</h3>
        <p className="text-sm text-gray-600 mt-2">Questa sezione è riservata esclusivamente al personale HR ed agli sviluppatori.</p>
      </div>
    );
  }

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print space-y-8">
      
      {/* Header Pagina */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-gray-150">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-3 py-1 bg-purple-100 text-purple-800 border border-purple-200 text-xs font-black rounded-full uppercase tracking-wider">
              👑 Area Gestionale HR
            </span>
          </div>
          <h2 className="text-3xl font-black text-gray-900 flex items-center gap-3 tracking-tight">
            <div className="p-3 bg-purple-100 rounded-2xl"><HeartPulse className="w-8 h-8 text-purple-700" /></div>
            Gestione HR & Benessere Organizzativo
          </h2>
          <p className="text-xs font-bold text-gray-500 mt-1">
            Gestisci le frasi di benvenuto, la rilevazione del clima, i questionari di soddisfazione ed i suggerimenti.
          </p>
        </div>

        <button
          onClick={loadData}
          className="p-3 text-gray-600 hover:text-purple-700 bg-gray-100 hover:bg-purple-50 rounded-2xl transition cursor-pointer flex items-center gap-2 font-bold text-xs shadow-xs"
        >
          <RefreshCw className="w-4 h-4" /> Aggiorna Dati
        </button>
      </div>

      {/* Tabs Menu (Coerenza Grafica con Impostazioni.tsx) */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-4">
        <button
          onClick={() => setActiveTab('greetings')}
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
            activeTab === 'greetings'
              ? 'bg-purple-700 text-white shadow-md shadow-purple-200'
              : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Frasi di Benvenuto ({greetingsList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('wellness')}
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
            activeTab === 'wellness'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-200'
              : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
          }`}
        >
          <Smile className="w-4 h-4" />
          <span>Benessere & Stress Lavorativo</span>
        </button>

        <button
          onClick={() => setActiveTab('surveys')}
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
            activeTab === 'surveys'
              ? 'bg-teal-600 text-white shadow-md shadow-teal-200'
              : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Altri Questionari</span>
        </button>

        <button
          onClick={() => setActiveTab('ideas')}
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
            activeTab === 'ideas'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-200'
              : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
          }`}
        >
          <Lightbulb className="w-4 h-4" />
          <span>Cassetta delle Idee</span>
          {suggerimenti.filter(s => s.stato !== 'Letto' && s.stato !== 'Archiviato').length > 0 ? (
            <span className="px-2 py-0.5 bg-red-500 text-white text-[10.5px] font-black rounded-full shadow-xs animate-pulse">
              {suggerimenti.filter(s => s.stato !== 'Letto' && s.stato !== 'Archiviato').length}
            </span>
          ) : (
            <span className="text-xs opacity-75 font-semibold">({suggerimenti.length})</span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('risorse')}
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
            activeTab === 'risorse'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
              : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Anagrafica Risorse</span>
        </button>
      </div>

      {/* TAB 1: FRASI DI BENVENUTO */}
      {activeTab === 'greetings' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="bg-gradient-to-br from-purple-50 to-indigo-50 p-6 sm:p-8 rounded-3xl border border-purple-150 space-y-4">
            <div>
              <h3 className="text-xl font-black text-purple-950 flex items-center gap-2">
                <MessageSquare className="w-6 h-6 text-purple-700" /> Gestione Frasi di Benvenuto Dashboard
              </h3>
              <p className="text-xs text-purple-800 mt-1 font-medium">
                Le frasi inserite qui compaiono in modo dinamico e casuale nella parte superiore della Dashboard di ciascun dipendente.
              </p>
            </div>

            <form onSubmit={handleAddGreeting} className="flex flex-col sm:flex-row gap-3 pt-2">
              <input
                type="text"
                required
                placeholder="Es. Felici di collaborare con te anche oggi."
                value={newGreetingText}
                onChange={e => setNewGreetingText(e.target.value)}
                className="flex-1 p-3.5 rounded-2xl border border-purple-200 bg-white font-bold text-sm text-purple-950 focus:ring-2 focus:ring-purple-500 outline-none shadow-inner"
              />
              <button
                type="submit"
                className="bg-purple-700 hover:bg-purple-800 text-white font-extrabold px-6 py-3.5 rounded-2xl transition text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95 shrink-0"
              >
                <Plus className="w-4 h-4" /> Aggiungi Frase
              </button>
            </form>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-black text-gray-500 uppercase tracking-wider">
                Elenco Frasi Attive ({greetingsList.length})
              </h4>
              {greetingsList.length === 0 && (
                <button
                  type="button"
                  onClick={handlePopulateDefaultGreetings}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow"
                >
                  <Plus className="w-4 h-4" /> Carica Frasi Predefinite
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3">
              {greetingsList.map(g => (
                <div key={g.id} className="bg-white p-4 rounded-2xl border border-gray-200 flex items-center justify-between gap-4 shadow-xs">
                  {editingGreetingId === g.id ? (
                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={editingGreetingText}
                        onChange={e => setEditingGreetingText(e.target.value)}
                        className="flex-1 p-2.5 border border-purple-300 rounded-xl bg-purple-50 font-bold text-xs text-purple-950"
                      />
                      <button
                        onClick={() => handleSaveEditGreeting(g.id)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl transition text-xs cursor-pointer"
                      >
                        Salva
                      </button>
                      <button
                        onClick={() => setEditingGreetingId(null)}
                        className="bg-gray-400 hover:bg-gray-500 text-white font-bold px-4 py-2 rounded-xl transition text-xs cursor-pointer"
                      >
                        Annulla
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="font-bold text-gray-800 text-sm flex-1">"{g.testo}"</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            setEditingGreetingId(g.id);
                            setEditingGreetingText(g.testo);
                          }}
                          className="p-2 text-purple-600 hover:bg-purple-50 rounded-xl transition cursor-pointer"
                          title="Modifica frase"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteGreeting(g.id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition cursor-pointer"
                          title="Elimina frase"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BENESSERE & STRESS LAVORATIVO */}
      {activeTab === 'wellness' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="bg-gradient-to-br from-rose-50 to-amber-50 p-6 sm:p-8 rounded-3xl border border-rose-150 space-y-4">
            <h3 className="text-xl font-black text-rose-950 flex items-center gap-2">
              <Smile className="w-6 h-6 text-rose-600" /> Monitoraggio Clima & Benessere Organizzativo
            </h3>
            <p className="text-xs text-rose-800 font-semibold">
              Rilevazione e metriche sintetiche delle valutazioni giornaliere inviate dai dipendenti.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 bg-white rounded-2xl border border-rose-100 text-center">
                <div className="text-3xl font-black text-rose-600">{climaResponses.length}</div>
                <div className="text-xs font-extrabold text-gray-600 uppercase tracking-wider mt-1">Valutazioni Totali</div>
              </div>
              <div className="p-4 bg-white rounded-2xl border border-rose-100 text-center">
                <div className="text-3xl font-black text-emerald-600">
                  {climaResponses.length > 0 ? (climaResponses.reduce((a, b) => a + Number(b.voto), 0) / climaResponses.length).toFixed(1) : 'N/D'} / 10
                </div>
                <div className="text-xs font-extrabold text-gray-600 uppercase tracking-wider mt-1">Media Complessiva</div>
              </div>
            </div>
          </div>

          <ClimaTrendChart responses={climaResponses} days={climaDays} onDaysChange={setClimaDays} />
        </div>
      )}

      {/* TAB 3: ALTRI QUESTIONARI */}
      {activeTab === 'surveys' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="bg-gradient-to-br from-indigo-50 to-slate-50 p-6 sm:p-8 rounded-3xl border border-indigo-150 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-xl font-black text-indigo-950 flex items-center gap-2">
                <FileText className="w-6 h-6 text-indigo-600" /> Questionari di Soddisfazione HR
              </h3>
              <p className="text-xs text-indigo-800 mt-1 font-semibold">
                Configura ed invia l'indagine periodica sul clima aziendale. Risposte ricevute finora: <strong>{questionnaireStats.totalSubmissions}</strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIsTestQuestionnaireOpen(true)}
                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs rounded-xl transition flex items-center gap-2 shadow cursor-pointer"
              >
                <Eye className="w-4 h-4" /> Prova / Anteprima Questionario
              </button>
              <button
                type="button"
                onClick={handleDownloadOpenAnswers}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition flex items-center gap-2 shadow cursor-pointer"
              >
                <Download className="w-4 h-4" /> Download Risposte Aperte TXT
              </button>
              <button
                type="button"
                onClick={handleToggleQuestionnaireActive}
                className={`px-4 py-2.5 font-extrabold text-xs rounded-xl transition text-white shadow cursor-pointer ${
                  activeQuestionnaire?.active ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {activeQuestionnaire?.active ? '⏸ Disattiva Questionario' : '▶ Attiva Questionario'}
              </button>
            </div>
          </div>

          {/* Form Aggiunta Domanda */}
          <form onSubmit={handleAddQuestionSubmit} className="bg-white p-6 rounded-3xl border border-gray-200 space-y-4 shadow-xs">
            <h4 className="text-sm font-extrabold text-gray-900">Aggiungi Nuova Domanda al Questionario</h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-600 mb-1">Testo Domanda</label>
                <input
                  type="text"
                  required
                  placeholder="Inserisci la domanda..."
                  value={newQuestionText}
                  onChange={e => setNewQuestionText(e.target.value)}
                  className="w-full p-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Tipologia Domanda</label>
                <select
                  value={newQuestionType}
                  onChange={e => setNewQuestionType(e.target.value as any)}
                  className="w-full p-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-800 outline-none cursor-pointer"
                >
                  <option value="choice">Scelta Singola (Radio)</option>
                  <option value="checkbox">Scelta Multipla (Checkbox)</option>
                  <option value="text">Testo Aperto</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Sezione Questionario</label>
                <select
                  value={newQuestionSection}
                  onChange={e => setNewQuestionSection(Number(e.target.value))}
                  className="w-full p-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-800 outline-none cursor-pointer"
                >
                  <option value={1}>Sezione 1: Soddisfazione e Strumenti</option>
                  <option value={2}>Sezione 2: Ambiente e Relazioni</option>
                  <option value={3}>Sezione 3: Coinvolgimento e Valore</option>
                  <option value={4}>Sezione 4: Benefit e Opinioni</option>
                </select>
              </div>
            </div>

            {newQuestionType !== 'text' && (
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Opzioni (separate da virgola)</label>
                <input
                  type="text"
                  placeholder="Es. Molto Soddisfatto, Soddisfatto, Poco, Per Niente"
                  value={newQuestionOptionsStr}
                  onChange={e => setNewQuestionOptionsStr(e.target.value)}
                  className="w-full p-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            )}

            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-5 py-2.5 rounded-xl transition text-xs flex items-center gap-2 cursor-pointer shadow"
            >
              <Plus className="w-4 h-4" /> Inserisci Domanda
            </button>
          </form>

          {/* Elenco Domande Esistenti */}
          <div className="space-y-3">
            <h4 className="text-xs font-black text-gray-500 uppercase tracking-wider">Domande del Questionario Attivo</h4>
            <div className="space-y-3">
              {activeQuestionnaire?.questions.map((q: any, idx: number) => (
                <div key={q.id} className="bg-white p-4 rounded-2xl border border-gray-200 flex items-center justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <span className="px-2.5 py-1 bg-indigo-100 text-indigo-900 rounded-lg text-xs font-black shrink-0">#{idx + 1}</span>
                    <div>
                      <div className="text-sm font-bold text-gray-900">{q.text}</div>
                      <div className="text-[11px] font-semibold text-gray-500">Tipo: {q.type} {q.options?.length ? `(${q.options.join(', ')})` : ''}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteQuestion(q.id)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition cursor-pointer shrink-0"
                    title="Elimina Domanda"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: CASSETTA DELLE IDEE & SUGGERIMENTI */}
      {activeTab === 'ideas' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Sezione Gestione Categorie Suggerimenti */}
          <div className="bg-gradient-to-br from-purple-50 to-pink-50/40 p-6 sm:p-7 rounded-3xl border border-purple-150 space-y-4 shadow-xs">
            <div className="flex justify-between items-start flex-wrap gap-2">
              <div>
                <h3 className="text-lg font-black text-purple-950 flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-purple-700" /> Gestione Categorie Suggerimenti
                </h3>
                <p className="text-xs text-purple-800 mt-0.5 font-medium">
                  Aggiungi o rimuovi le categorie selezionabili dai dipendenti quando aprono la Cassetta delle Idee.
                </p>
              </div>
            </div>

            <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row gap-3 pt-1">
              <input
                type="text"
                required
                placeholder="Nuova categoria (es. Benessere, Spazi di lavoro, Strumenti software...)"
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                className="flex-1 p-3 rounded-2xl border border-purple-200 bg-white font-bold text-xs text-purple-950 focus:ring-2 focus:ring-purple-500 outline-none shadow-inner"
              />
              <button
                type="submit"
                className="bg-purple-700 hover:bg-purple-800 text-white font-extrabold px-5 py-3 rounded-2xl transition text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95 shrink-0"
              >
                <Plus className="w-4 h-4" /> Aggiungi Categoria
              </button>
            </form>

            <div className="space-y-2 pt-1">
              <div className="text-[11px] font-black text-purple-900/70 uppercase tracking-wider">
                Categorie Attive ({categories.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.length === 0 ? (
                  <span className="text-xs text-gray-400 italic">Nessuna categoria presente.</span>
                ) : (
                  categories.map(cat => (
                    <div 
                      key={cat.id} 
                      className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-xl border border-purple-200 shadow-xs hover:border-purple-300 transition"
                    >
                      <Tag className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                      <span className="text-xs font-bold text-purple-950">{cat.nome}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat.id, cat.nome)}
                        className="text-gray-400 hover:text-red-600 transition p-1 rounded-lg hover:bg-red-50 cursor-pointer ml-1"
                        title={`Elimina categoria "${cat.nome}"`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Sezione Ricezione Suggerimenti Dipendenti */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 sm:p-8 rounded-3xl border border-amber-150 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-xl font-black text-amber-950 flex items-center gap-2">
                <Lightbulb className="w-6 h-6 text-amber-600" /> Ricezione Suggerimenti Dipendenti
              </h3>
              <p className="text-xs text-amber-800 mt-1 font-semibold">
                Suggerimenti e proposte inviate dal personale in forma anonima.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {suggerimenti.length === 0 ? (
              <div className="bg-white p-8 rounded-3xl border border-gray-200 text-center text-xs font-bold text-gray-400 italic">
                Nessun suggerimento presente nella cassetta delle idee.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {suggerimenti.map(s => (
                  <div key={s.id} className="bg-white p-5 rounded-2xl border border-gray-200 space-y-2 shadow-xs">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-3 py-1 bg-amber-100 text-amber-900 font-extrabold text-[11px] rounded-full">
                          📂 {s.categoria || 'Generale'}
                        </span>
                        <span className="text-xs font-bold text-gray-400">📅 {s.data}</span>
                        {(s.stato === 'Letto' || s.stato === 'Archiviato') ? (
                          <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 font-extrabold text-[10.5px] rounded-full flex items-center gap-1 border border-slate-200">
                            ✓ Letto
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 bg-rose-100 text-rose-700 font-black text-[10.5px] rounded-full flex items-center gap-1 border border-rose-200 animate-pulse">
                            🔴 Nuovo
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {(s.stato === 'Letto' || s.stato === 'Archiviato') ? (
                          <button
                            onClick={() => handleUpdateIdeaStatus(s.id, 'Nuovo')}
                            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                            title="Segna come da leggere"
                          >
                            <Clock className="w-3.5 h-3.5 text-gray-500" />
                            <span>Segna come da leggere</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUpdateIdeaStatus(s.id, 'Letto')}
                            className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-extrabold rounded-xl transition flex items-center gap-1.5 cursor-pointer border border-emerald-200 shadow-xs"
                            title="Segna come letto"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Segna come letto</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteIdea(s.id)}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded-xl transition cursor-pointer"
                          title="Elimina"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs font-semibold text-gray-800 leading-relaxed pt-1">
                      {s.testo}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: ANAGRAFICA RISORSE */}
      {activeTab === 'risorse' && (
        <div className="animate-in fade-in duration-200">
          <AnagraficaRisorseSection />
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[999999] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className={`px-5 py-3 rounded-2xl shadow-xl font-extrabold text-xs text-white ${
            toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
          }`}>
            {toast.message}
          </div>
        </div>
      )}

      {/* Modal Anteprima Prova Questionario per HR */}
      {isTestQuestionnaireOpen && activeQuestionnaire && (
        <QuestionnaireModal
          isOpen={isTestQuestionnaireOpen}
          onClose={() => setIsTestQuestionnaireOpen(false)}
          activeQuestionnaire={activeQuestionnaire}
          userId="preview_hr"
          isPreview={true}
        />
      )}
    </div>
  );
}
