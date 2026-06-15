import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, onSnapshot, doc, deleteDoc, query, orderBy, setDoc, where, getDocs } from 'firebase/firestore';
import { Send, MessageSquare, Shield, Star, Filter, Trash2, LayoutList, Plus, ShieldCheck, FileText, Download, Edit3, BarChart3, Smile, Meh, Frown, ChevronUp, ChevronDown } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { DEFAULT_QUESTIONS, getQuestionSection } from '../utils/defaultQuestionnaire';
import QuestionnaireModal from '../components/QuestionnaireModal';
import ClimaModal from '../components/ClimaModal';
import { isSoci } from './Impostazioni';

interface Suggerimento {
  id: string;
  categoria: string;
  testo: string;
  data: string;
}

interface RispostaClima {
  id: string;
  risposta: string;
  voto: number;
  data: string;
  createdAt: string;
}

const getOptionStyle = (label: string) => {
  const l = label.toLowerCase();
  if (l.includes('🟢') || l.includes('ottimo') || l.includes('sereno') || l.includes('bene') || l.includes('motivato')) {
    return {
      icon: Smile,
      color: 'text-green-600 bg-green-50 border-green-200'
    };
  }
  if (l.includes('🔴') || l.includes('stress') || l.includes('sovraccarico') || l.includes('male') || l.includes('pessimo')) {
    return {
      icon: Frown,
      color: 'text-red-600 bg-red-50 border-red-200'
    };
  }
  if (l.includes('🟡') || l.includes('gestibile') || l.includes('stanchezza') || l.includes('stanco') || l.includes('così così')) {
    return {
      icon: Meh,
      color: 'text-amber-600 bg-amber-50 border-amber-200'
    };
  }
  return {
    icon: Smile,
    color: 'text-indigo-600 bg-indigo-50 border-indigo-200'
  };
};

const ClimaTrendChart = ({ responses }: { responses: RispostaClima[] }) => {
  const [days, setDays] = useState<number>(30); // Default to last month (30 days)

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
        Nessun dato sufficiente per tracciare il grafico dell'andamento.
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
          onChange={e => setDays(Number(e.target.value))}
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

export default function Suggerimenti() {
  const { isAdmin, isHR, myAssociatedName, user } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'invia' | 'suggerimenti' | 'clima' | 'questionario'>('invia');
  const [questionnaireSubTab, setQuestionnaireSubTab] = useState<'risultati' | 'configura'>('risultati');

  // Categorie Suggerimenti
  const [categories, setCategories] = useState<{ id: string; nome: string }[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [catLoading, setCatLoading] = useState(false);

  // Opzioni Clima
  const [climaOptions, setClimaOptions] = useState<{ id: string; label: string; order?: number }[]>([]);
  const [newClimaOptionName, setNewClimaOptionName] = useState('');
  const [climaOptLoading, setClimaOptLoading] = useState(false);

  // Stato Form Suggerimenti
  const [categoria, setCategoria] = useState('');
  const [testo, setTesto] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Dati da database
  const [suggerimenti, setSuggerimenti] = useState<Suggerimento[]>([]);
  const [climaResponses, setClimaResponses] = useState<RispostaClima[]>([]);
  const [filterCat, setFilterCat] = useState('');

  // Questionario HR
  const [activeQuestionnaire, setActiveQuestionnaire] = useState<{ id: string; questions: any[]; active: boolean; sentAt?: string } | null>(null);
  const [questionAnswers, setQuestionAnswers] = useState<any[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Stato compilazione/anteprima dipendente & clima
  const [isEmployeeSurveyOpen, setIsEmployeeSurveyOpen] = useState(false);
  const [isTestClimaOpen, setIsTestClimaOpen] = useState(false);
  const [hasCompletedSurvey, setHasCompletedSurvey] = useState(true);
  
  // Modifica Domande
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingOptionsStr, setEditingOptionsStr] = useState('');
  const [editingSection, setEditingSection] = useState<number>(1);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newQuestionType, setNewQuestionType] = useState<'choice' | 'checkbox' | 'text'>('choice');
  const [newQuestionOptionsStr, setNewQuestionOptionsStr] = useState('');
  const [newQuestionSection, setNewQuestionSection] = useState<number>(1);

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

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
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

  // Caricamento categorie suggerimenti
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'categorie_suggerimenti'), (snapshot) => {
      if (snapshot.empty) {
        const defaultCats = ['Ambiente di lavoro', 'Strumenti e Risorse', 'Processi e Organizzazione', 'Altro'];
        defaultCats.forEach(async (catName) => {
          await addDoc(collection(db, 'categorie_suggerimenti'), { nome: catName });
        });
      } else {
        const list: { id: string; nome: string }[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          if (data.nome) list.push({ id: docSnap.id, nome: data.nome });
        });
        list.sort((a, b) => a.nome.localeCompare(b.nome));
        setCategories(list);
      }
    });
    return () => unsub();
  }, []);

  // Caricamento opzioni clima
  useEffect(() => {
    if (!isAdmin && !isHR) return;
    const unsub = onSnapshot(collection(db, 'opzioni_clima'), (snapshot) => {
      if (snapshot.empty) {
        const defaultOpts = [
          '🟢 Ottimo, sono sereno e motivato',
          '🟡 Gestibile, ma sento un po\' di stanchezza',
          '🔴 Stressante, mi sento in sovraccarico'
        ];
        defaultOpts.forEach(async (optName, index) => {
          await addDoc(collection(db, 'opzioni_clima'), { label: optName, order: index });
        });
      } else {
        const list: { id: string; label: string; order: number }[] = [];
        let index = 0;
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            label: data.label || '',
            order: data.order !== undefined ? data.order : index
          });
          index++;
        });
        list.sort((a, b) => a.order - b.order);
        setClimaOptions(list);
      }
    });
    return () => unsub();
  }, [isAdmin, isHR]);

  // Caricamento configurazione questionario attivo (per tutti gli utenti, per consentire la compilazione)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'configurazioni', 'questionario'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.active || isAdmin || isHR) {
          setActiveQuestionnaire(data as any);
        } else {
          setActiveQuestionnaire(null);
        }
      } else {
        if (isAdmin || isHR) {
          const initialConfig = {
            id: 'initial_survey',
            questions: DEFAULT_QUESTIONS,
            active: false,
            sentAt: ''
          };
          setDoc(doc(db, 'configurazioni', 'questionario'), initialConfig);
          setActiveQuestionnaire(initialConfig);
        }
      }
    });
    return () => unsub();
  }, [isAdmin, isHR]);

  // Verifica se il dipendente ha completato il questionario attivo
  useEffect(() => {
    if (isSoci(myAssociatedName)) {
      setHasCompletedSurvey(true);
      return;
    }
    if (!activeQuestionnaire || !user?.uid) {
      setHasCompletedSurvey(true);
      return;
    }

    const q = query(
      collection(db, 'questionari_completati'),
      where('userId', '==', user.uid),
      where('questionnaireId', '==', activeQuestionnaire.id)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      setHasCompletedSurvey(!snapshot.empty);
    });

    return () => unsub();
  }, [activeQuestionnaire, user?.uid, myAssociatedName]);

  // Caricamento risposte al questionario
  useEffect(() => {
    if (!isAdmin && !isHR) return;
    const unsub = onSnapshot(collection(db, 'risposte_questionario'), (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setQuestionAnswers(list);
    });
    return () => unsub();
  }, [isAdmin, isHR]);

  // Sincronizza tab predefinita per gli HR
  useEffect(() => {
    if (isAdmin || isHR) {
      setActiveTab('suggerimenti');
    } else {
      setActiveTab('invia');
    }
  }, [isAdmin, isHR]);

  // Caricamento suggerimenti in tempo reale
  useEffect(() => {
    if (!isAdmin && !isHR) return;
    const q = query(collection(db, 'suggerimenti'), orderBy('data', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: Suggerimento[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Suggerimento);
      });
      setSuggerimenti(list);
    });
    return () => unsub();
  }, [isAdmin, isHR]);

  // Caricamento risposte clima in tempo reale
  useEffect(() => {
    if (!isAdmin && !isHR) return;
    const q = query(collection(db, 'risposte_clima'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: RispostaClima[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as RispostaClima);
      });
      setClimaResponses(list);
    });
    return () => unsub();
  }, [isAdmin, isHR]);

  // Pulizia automatica delle risposte clima più vecchie di 90 giorni (solo per HR/Admin)
  useEffect(() => {
    if (!isAdmin && !isHR) return;
    
    const cleanupOldResponses = async () => {
      try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const ninetyDaysAgoISO = ninetyDaysAgo.toISOString();

        const q = query(
          collection(db, 'risposte_clima'),
          where('createdAt', '<', ninetyDaysAgoISO)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          console.log(`[PULIZIA CLIMA] Trovati ${snap.size} elementi più vecchi di 90 giorni. Eliminazione in corso...`);
          const promises = snap.docs.map(docSnap => deleteDoc(doc(db, 'risposte_clima', docSnap.id)));
          await Promise.all(promises);
          console.log("[PULIZIA CLIMA] Eliminazione completata.");
        }
      } catch (err) {
        console.error("Errore durante la pulizia dei dati clima:", err);
      }
    };

    cleanupOldResponses();
  }, [isAdmin, isHR]);

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
        data: todayStr
      });

      // Notifica e-mail all'HR rimossa a favore del sistema di badge di notifica

      setCategoria('');
      setTesto('');
      setSuccessMsg('Suggerimento inviato con successo e in forma completamente anonima!');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      console.error("Errore nell'invio:", err);
      showToast("Si è verificato un errore durante l'invio. Riprova più tardi.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    triggerConfirm(
      "Elimina Suggerimento",
      "Sei sicuro di voler eliminare questo suggerimento? L'azione è irreversibile.",
      async () => {
        try {
          await deleteDoc(doc(db, 'suggerimenti', id));
        } catch (err) {
          console.error("Errore nell'eliminazione:", err);
        }
      },
      'danger'
    );
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    
    if (categories.some(c => c.nome.toLowerCase() === newCategoryName.trim().toLowerCase())) {
      showToast("Questa categoria esiste già!", "warning");
      return;
    }
    
    setCatLoading(true);
    try {
      await addDoc(collection(db, 'categorie_suggerimenti'), { nome: newCategoryName.trim() });
      setNewCategoryName('');
    } catch (err) {
      console.error(err);
    } finally {
      setCatLoading(false);
    }
  };

  const handleDeleteCategory = (catId: string, catNome: string) => {
    triggerConfirm(
      "Elimina Categoria",
      `Sei sicuro di voler eliminare la categoria "${catNome}"? I suggerimenti esistenti rimarranno nel database ma senza categoria.`,
      async () => {
        try {
          await deleteDoc(doc(db, 'categorie_suggerimenti', catId));
        } catch (err) {
          console.error(err);
        }
      },
      'danger'
    );
  };

  // Opzioni Clima Handlers
  const handleAddClimaOption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClimaOptionName.trim()) return;

    if (climaOptions.some(o => o.label.toLowerCase() === newClimaOptionName.trim().toLowerCase())) {
      showToast("Questa opzione esiste già!", "warning");
      return;
    }

    setClimaOptLoading(true);
    try {
      const maxOrder = climaOptions.reduce((max, opt) => (opt.order !== undefined && opt.order > max ? opt.order : max), -1);
      await addDoc(collection(db, 'opzioni_clima'), { 
        label: newClimaOptionName.trim(),
        order: maxOrder + 1
      });
      setNewClimaOptionName('');
    } catch (err) {
      console.error(err);
    } finally {
      setClimaOptLoading(false);
    }
  };

  const handleMoveClimaOption = async (optId: string, direction: 'up' | 'down') => {
    const index = climaOptions.findIndex(o => o.id === optId);
    if (index === -1) return;

    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === climaOptions.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const optionA = climaOptions[index];
    const optionB = climaOptions[targetIndex];

    try {
      const orderA = optionA.order !== undefined ? optionA.order : index;
      const orderB = optionB.order !== undefined ? optionB.order : targetIndex;

      await setDoc(doc(db, 'opzioni_clima', optionA.id), { label: optionA.label, order: orderB });
      await setDoc(doc(db, 'opzioni_clima', optionB.id), { label: optionB.label, order: orderA });
    } catch (err) {
      console.error("Errore nello spostamento dell'opzione clima:", err);
    }
  };

  const handleDeleteClimaOption = (optId: string, optLabel: string) => {
    triggerConfirm(
      "Elimina Opzione Clima",
      `Sei sicuro di voler eliminare l'opzione "${optLabel}"? I dipendenti non la visualizzeranno più nel questionario random.`,
      async () => {
        try {
          await deleteDoc(doc(db, 'opzioni_clima', optId));
        } catch (err) {
          console.error(err);
        }
      },
      'danger'
    );
  };

  // Questionario HR Domande Handlers
  const saveEditing = async (qId: string) => {
    const opts = editingOptionsStr.split(',').map(o => o.trim()).filter(Boolean);
    const q = activeQuestionnaire?.questions.find(x => x.id === qId);
    await handleSaveQuestion(qId, editingText, q?.type !== 'text' ? opts : [], editingSection);
  };

  const handleSaveQuestion = async (qId: string, text: string, options?: string[], section?: number) => {
    if (!activeQuestionnaire) return;
    const updated = activeQuestionnaire.questions.map(q => {
      if (q.id === qId) {
        return { 
          ...q, 
          text: text.trim(), 
          options: options || q.options || [],
          section: section !== undefined ? section : getQuestionSection(q)
        };
      }
      return q;
    });
    try {
      await setDoc(doc(db, 'configurazioni', 'questionario'), {
        ...activeQuestionnaire,
        questions: updated
      });
      setEditingQuestionId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteQuestion = (qId: string) => {
    if (!activeQuestionnaire) return;
    triggerConfirm(
      "Elimina Domanda Questionario",
      "Sei sicuro di voler eliminare questa domanda dal questionario? Questa modifica si rifletterà sul questionario attivo.",
      async () => {
        const updated = activeQuestionnaire.questions.filter(q => q.id !== qId);
        try {
          await setDoc(doc(db, 'configurazioni', 'questionario'), {
            ...activeQuestionnaire,
            questions: updated
          });
        } catch (err) {
          console.error(err);
        }
      },
      'danger'
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
    } catch (err) {
      console.error(err);
    }
  };

  const handleMoveQuestion = async (qId: string, direction: 'up' | 'down') => {
    if (!activeQuestionnaire) return;
    const questions = [...activeQuestionnaire.questions];
    
    const index = questions.findIndex(q => q.id === qId);
    if (index === -1) return;
    
    const qSection = getQuestionSection(questions[index]);
    
    // Filtra le domande appartenenti alla stessa sezione
    const sectionQuestions = questions.filter(q => getQuestionSection(q) === qSection);
    const secIndex = sectionQuestions.findIndex(q => q.id === qId);
    
    if (direction === 'up' && secIndex > 0) {
      const temp = sectionQuestions[secIndex - 1];
      sectionQuestions[secIndex - 1] = sectionQuestions[secIndex];
      sectionQuestions[secIndex] = temp;
    } else if (direction === 'down' && secIndex < sectionQuestions.length - 1) {
      const temp = sectionQuestions[secIndex + 1];
      sectionQuestions[secIndex + 1] = sectionQuestions[secIndex];
      sectionQuestions[secIndex] = temp;
    } else {
      return; // Impossibile muovere oltre
    }
    
    // Ricostruisci mantenendo le sezioni separate ma ordinando quella corrente
    const updatedQuestions: any[] = [];
    for (let s = 1; s <= 4; s++) {
      if (s === qSection) {
        updatedQuestions.push(...sectionQuestions);
      } else {
        updatedQuestions.push(...questions.filter(q => getQuestionSection(q) === s));
      }
    }
    
    try {
      await setDoc(doc(db, 'configurazioni', 'questionario'), {
        ...activeQuestionnaire,
        questions: updatedQuestions
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleActivateQuestionnaire = () => {
    if (!activeQuestionnaire) return;
    triggerConfirm(
      "Invia / Attiva Questionario",
      "Inviando il questionario, verrà azzerato lo stato di completamento per tutti i dipendenti e richiesto di compilarlo al prossimo accesso. Le risposte passate verranno comunque archiviate nel database. Procedere?",
      async () => {
        try {
          const newSurveyId = `survey_${Date.now()}`;
          await setDoc(doc(db, 'configurazioni', 'questionario'), {
            ...activeQuestionnaire,
            id: newSurveyId,
            active: true,
            sentAt: new Date().toISOString()
          });
        } catch (err) {
          console.error(err);
        }
      },
      'info'
    );
  };

  const handleDeactivateQuestionnaire = () => {
    if (!activeQuestionnaire) return;
    triggerConfirm(
      "Disattiva Questionario",
      "Vuoi disattivare la comparsa automatica del questionario per i dipendenti? Le risposte già date rimarranno visibili.",
      async () => {
        try {
          await setDoc(doc(db, 'configurazioni', 'questionario'), {
            ...activeQuestionnaire,
            active: false
          });
        } catch (err) {
          console.error(err);
        }
      },
      'warning'
    );
  };

  // Statistiche Suggerimenti
  const stats = useMemo(() => {
    return {
      conteggio: suggerimenti.length
    };
  }, [suggerimenti]);

  // Statistiche Clima Dinamico
  const climaStatsDynamic = useMemo(() => {
    const total = climaResponses.length;
    if (total === 0) {
      return { media: 0, count: 0, distribution: {} as Record<string, { count: number; pct: number }> };
    }
    const sommaVoti = climaResponses.reduce((acc, curr) => acc + Number(curr.voto), 0);
    const media = Number((sommaVoti / total).toFixed(1));

    const counts: Record<string, number> = {};
    // Inizializza i conteggi per le opzioni attualmente configurate
    climaOptions.forEach(o => {
      counts[o.label] = 0;
    });

    climaResponses.forEach(r => {
      const respText = r.risposta ? r.risposta.trim() : '';
      if (!respText) return;

      const matchedOption = climaOptions.find(o => {
        const oL = o.label.toLowerCase().trim();
        const rL = respText.toLowerCase();
        // Cerca corrispondenze (es. "Ottimo" corrisponde a "🟢 Ottimo, sono sereno e motivato")
        return oL === rL || oL.includes(rL) || rL.includes(oL);
      });

      if (matchedOption) {
        counts[matchedOption.label] = (counts[matchedOption.label] || 0) + 1;
      } else {
        counts[respText] = (counts[respText] || 0) + 1;
      }
    });

    const distribution: Record<string, { count: number; pct: number }> = {};
    const allKeys = Array.from(new Set([
      ...climaOptions.map(o => o.label),
      ...Object.keys(counts)
    ]));

    allKeys.forEach(key => {
      if (!key) return;
      const cnt = counts[key] || 0;
      distribution[key] = {
        count: cnt,
        pct: total > 0 ? Math.round((cnt / total) * 100) : 0
      };
    });

    return {
      media,
      count: total,
      distribution
    };
  }, [climaResponses, climaOptions]);

  // Statistiche Questionario HR (Auto-aggiornanti)
  const questionnaireStats = useMemo(() => {
    if (!activeQuestionnaire) return { totalSubmissions: 0, questionStats: {} };
    
    const activeResponses = questionAnswers.filter(a => a.questionnaireId === activeQuestionnaire.id);
    const totalSubmissions = activeResponses.length;
    
    const qStats: Record<string, {
      type: string;
      optionsCounts?: Record<string, { count: number; pct: number }>;
      textResponses?: string[];
    }> = {};

    activeQuestionnaire.questions.forEach(q => {
      if (q.type === 'choice' || q.type === 'checkbox') {
        const counts: Record<string, number> = {};
        q.options?.forEach((opt: string) => {
          counts[opt] = 0;
        });

        activeResponses.forEach(resp => {
          const ans = resp.answers?.[q.id];
          if (q.type === 'choice' && typeof ans === 'string') {
            if (counts[ans] !== undefined) counts[ans]++;
            else if (ans) counts[ans] = 1;
          } else if (q.type === 'checkbox' && Array.isArray(ans)) {
            ans.forEach(opt => {
              counts[opt] = (counts[opt] || 0) + 1;
            });
          }
        });

        const optionsCounts: Record<string, { count: number; pct: number }> = {};
        Object.entries(counts).forEach(([opt, count]) => {
          optionsCounts[opt] = {
            count,
            pct: totalSubmissions > 0 ? Math.round((count / totalSubmissions) * 100) : 0
          };
        });

        qStats[q.id] = { type: q.type, optionsCounts };
      } else if (q.type === 'text') {
        const textResponses: string[] = [];
        activeResponses.forEach(resp => {
          const ans = resp.answers?.[q.id];
          if (typeof ans === 'string' && ans.trim()) {
            textResponses.push(ans.trim());
          }
        });
        qStats[q.id] = { type: q.type, textResponses };
      }
    });

    return {
      totalSubmissions,
      questionStats: qStats
    };
  }, [activeQuestionnaire, questionAnswers]);

  // Download risposte aperte in TXT
  const handleDownloadOpenAnswers = () => {
    if (!activeQuestionnaire) return;
    
    let content = `RISPOSTE APERTE QUESTIONARIO SODDISFAZIONE HR\r\n`;
    content += `ID Questionario Attivo: ${activeQuestionnaire.id}\r\n`;
    content += `Data estrazione: ${new Date().toLocaleString('it-IT')}\r\n`;
    content += `Risposte ricevute: ${questionnaireStats.totalSubmissions}\r\n`;
    content += `========================================================================\r\n\r\n`;

    activeQuestionnaire.questions.forEach((q, idx) => {
      if (q.type === 'text') {
        const qStat = questionnaireStats.questionStats[q.id];
        const answers = qStat?.textResponses || [];
        
        content += `${idx + 1}. DOMANDA: ${q.text}\r\n`;
        content += `------------------------------------------------------------------------\r\n`;
        if (answers.length === 0) {
          content += `(Nessuna risposta ricevuta per questa domanda)\r\n`;
        } else {
          answers.forEach((ans, aIdx) => {
            content += `- [Risposta #${aIdx + 1}] ${ans}\r\n`;
          });
        }
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

  // Suggerimenti filtrati per categoria
  const filteredSuggerimenti = useMemo(() => {
    if (!filterCat) return suggerimenti;
    return suggerimenti.filter(s => s.categoria === filterCat);
  }, [suggerimenti, filterCat]);

  return (
    <div className="flex flex-col gap-6">
      
      {/* HEADER E TABS PRINCIPALI */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-4 sm:p-6 border border-white/50 flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-2xl"><MessageSquare className="text-indigo-600 w-8 h-8" /></div>
          <span>Cassetta delle Idee</span>
        </h2>

        {(isAdmin || isHR) && (
          <div className="flex bg-gray-100/80 p-1.5 rounded-2xl shadow-inner flex-wrap gap-1">
            <button 
              onClick={() => setActiveTab('suggerimenti')}
              className={`px-4 sm:px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'suggerimenti' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <LayoutList className="w-4 h-4" /> 
              <span>Suggerimenti Anonimi</span>
              {isHR && suggerimenti.length > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ml-1 min-w-[1.25rem] text-center inline-block">
                  {suggerimenti.length}
                </span>
              )}
            </button>
            <button 
              onClick={() => setActiveTab('clima')}
              className={`px-4 sm:px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'clima' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Smile className="w-4 h-4" /> Benessere & Stress
            </button>
            <button 
              onClick={() => setActiveTab('questionario')}
              className={`px-4 sm:px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'questionario' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <FileText className="w-4 h-4" /> Questionario
            </button>
            <button 
              onClick={() => setActiveTab('invia')}
              className={`px-4 sm:px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'invia' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Plus className="w-4 h-4" /> Invia Idee
            </button>
          </div>
        )}
      </div>

      {/* SEZIONE COMPILAZIONE/RIPRESA QUESTIONARIO PENDENTE */}
      {!isSoci(myAssociatedName) && activeQuestionnaire && activeQuestionnaire.active && !hasCompletedSurvey && (
        <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white rounded-[2rem] p-6 sm:p-8 shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-6 animate-fadeIn border border-indigo-500/20">
          <div className="space-y-2 text-left">
            <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 text-white px-3 py-1 rounded-full inline-block">
              📋 Questionario Dipendenti Pendente
            </span>
            <h3 className="text-xl sm:text-2xl font-black">
              {localStorage.getItem(`survey_draft_${user?.uid}_${activeQuestionnaire.id}`) 
                ? 'Riprendi il questionario da dove eri rimasto!' 
                : 'Hai un questionario di soddisfazione da compilare!'}
            </h3>
            <p className="text-xs text-indigo-100 font-semibold max-w-xl">
              La tua opinione è preziosa per migliorare il clima aziendale. Il questionario è al 100% anonimo e richiede solo pochi minuti.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsEmployeeSurveyOpen(true)}
            className="px-6 py-4 bg-white text-indigo-600 hover:bg-indigo-50 font-black text-sm rounded-2xl shadow-lg active:scale-95 transition whitespace-nowrap cursor-pointer shrink-0"
          >
            {localStorage.getItem(`survey_draft_${user?.uid}_${activeQuestionnaire.id}`) 
              ? '📝 Riprendi Questionario' 
              : '🚀 Inizia Questionario'}
          </button>
        </div>
      )}

      {/* COMPILAZIONE SUGGERIMENTO DIPENDENTE */}
      {activeTab === 'invia' && (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 max-w-3xl mx-auto w-full">
          <div className="bg-blue-50/60 border border-blue-100 rounded-3xl p-6 mb-8 flex gap-4 items-start shadow-sm">
            <Shield className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-3">
              <h4 className="font-extrabold text-blue-950 text-base">La tua privacy è al sicuro (Anonimato Garantito)</h4>
              <p className="text-sm text-blue-900/80 leading-relaxed">
                Questa sezione è stata programmata per garantire la massima riservatezza ed anonimato nell'invio dei suggerimenti e feedback aziendali:
              </p>
              <ul className="list-disc pl-4 text-xs text-blue-900/85 space-y-2 leading-relaxed">
                <li><strong>Disaccoppiamento dei dati</strong>: Il sistema registra solo che hai partecipato, ma le risposte e il testo sono scritti in un database separato, privo di nome, email o ID account.</li>
                <li><strong>Zero tracciamento temporale</strong>: L'ora esatta di sottomissione non viene memorizzata per evitare incroci dei log.</li>
                <li><strong>Nessun dato digitale memorizzato</strong>: Non vengono registrati IP, informazioni sul browser o cookies identificativi.</li>
              </ul>
            </div>
          </div>

          {successMsg && (
            <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-2xl mb-6 font-bold text-center text-sm">
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
                className="w-full p-4 border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 transition"
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
                className="w-full p-4 border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-medium text-gray-900 placeholder-gray-400 transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white font-extrabold py-4 rounded-xl hover:bg-indigo-700 transition shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Send className="w-5 h-5" />
              {loading ? 'Invio in corso...' : 'Invia in Forma Anonima'}
            </button>
          </form>
        </div>
      )}

      {/* SEZIONE SUGGERIMENTI ANONIMI (HR/ADMIN) */}
      {activeTab === 'suggerimenti' && (isAdmin || isHR) && (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 flex flex-col mb-10 animate-fadeIn">
          {/* STATS OVERVIEW & CATEGORIES MANAGEMENT */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-3xl border border-emerald-100 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-emerald-950/70 uppercase tracking-wider mb-1">Totale Suggerimenti</h4>
                <div className="text-4xl font-black text-emerald-900">{stats.conteggio}</div>
              </div>
              <div className="p-4 bg-emerald-600 text-white rounded-2xl"><MessageSquare className="w-6 h-6" /></div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-6 rounded-3xl border border-purple-100 flex flex-col justify-between gap-4 lg:col-span-2">
              <div>
                <h4 className="text-sm font-bold text-purple-950/70 uppercase tracking-wider mb-2">Gestione Categorie</h4>
                <div className="max-h-[120px] overflow-y-auto pr-1 space-y-2 mb-3">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex justify-between items-center bg-white/60 p-2 rounded-xl border border-purple-100/50">
                      <span className="text-xs font-bold text-purple-950">{cat.nome}</span>
                      <button 
                        onClick={() => handleDeleteCategory(cat.id, cat.nome)}
                        className="text-gray-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition cursor-pointer"
                        title="Elimina categoria"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <form onSubmit={handleAddCategory} className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="Nuova categoria..."
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  disabled={catLoading}
                  className="flex-1 px-3 py-2 text-xs font-bold text-purple-950 border border-purple-200/50 bg-white rounded-xl focus:ring-2 focus:ring-purple-400 outline-none placeholder-gray-400"
                />
                <button
                  type="submit"
                  disabled={catLoading}
                  className="bg-purple-600 text-white p-2 rounded-xl hover:bg-purple-700 active:scale-95 disabled:opacity-50 transition flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          {/* FILTERS TOOLBAR */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-50/50 rounded-2xl border border-gray-100 mb-6">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={filterCat}
                onChange={e => setFilterCat(e.target.value)}
                className="pl-3 pr-8 py-2 border-none bg-white rounded-xl shadow-inner text-sm font-bold text-gray-700 focus:ring-2 focus:ring-indigo-400 outline-none w-52"
              >
                <option value="">Tutte le categorie</option>
                {categories.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              </select>
            </div>
            <div className="text-xs font-bold text-gray-500">
              Visualizzati: <strong>{filteredSuggerimenti.length}</strong> suggerimenti
            </div>
          </div>

          {/* LISTA SUGGERIMENTI */}
          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
            {filteredSuggerimenti.length === 0 ? (
              <p className="text-center text-gray-400 py-10 font-bold italic">Nessun suggerimento presente.</p>
            ) : (
              filteredSuggerimenti.map(s => (
                <div key={s.id} className="p-5 border border-gray-100 rounded-3xl bg-white shadow-sm hover:shadow-md transition flex justify-between items-start gap-4 animate-fadeIn">
                  <div className="space-y-3 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-extrabold bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full">{s.categoria}</span>
                      <span className="text-xs font-bold text-gray-400">{s.data}</span>
                    </div>
                    <p className="text-sm text-gray-800 leading-relaxed font-medium whitespace-pre-wrap">{s.testo}</p>
                  </div>

                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-gray-300 hover:text-red-600 hover:bg-red-50 p-2 rounded-xl transition cursor-pointer"
                    title="Elimina suggerimento"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SEZIONE BENESSERE & STRESS (HR/ADMIN) */}
      {activeTab === 'clima' && (isAdmin || isHR) && (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 flex flex-col mb-10 animate-fadeIn">
          {/* STATS OVERVIEW CLIMA */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-6 rounded-3xl border border-indigo-100 flex flex-col justify-between gap-4">
              <div>
                <h4 className="text-sm font-bold text-indigo-950/70 uppercase tracking-wider mb-1">Livello Benessere Medio</h4>
                <div className="text-4xl font-black text-indigo-900 flex items-baseline gap-2">
                  {climaStatsDynamic.media}
                  <span className="text-sm font-bold opacity-75">/ 10</span>
                </div>
              </div>
              <div className="flex gap-0.5 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(star => (
                  <Star key={star} className={`w-3.5 h-3.5 ${Math.round(climaStatsDynamic.media) >= star ? 'text-indigo-600 fill-indigo-600' : 'text-gray-300'}`} />
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-3xl border border-emerald-100 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-emerald-950/70 uppercase tracking-wider mb-1">Totale Test Giornalieri</h4>
                <div className="text-4xl font-black text-emerald-900">{climaStatsDynamic.count}</div>
              </div>
              <div className="p-4 bg-emerald-600 text-white rounded-2xl"><ShieldCheck className="w-6 h-6" /></div>
            </div>

            {/* GESTIONE OPZIONI CLIMA */}
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-6 rounded-3xl border border-purple-200 flex flex-col justify-between gap-4 col-span-1 lg:col-span-2">
              <div>
                <div className="flex justify-between items-center mb-2 gap-2">
                  <h4 className="text-sm font-bold text-purple-950/80 uppercase tracking-wider">Opzioni Questionario Clima</h4>
                  <button 
                    type="button"
                    onClick={() => setIsTestClimaOpen(true)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer border border-indigo-700"
                  >
                    👁️ Prova (Anteprima)
                  </button>
                </div>
                <div className="max-h-[140px] overflow-y-auto pr-1 space-y-1.5 mb-2">
                  {climaOptions.map((opt, idx) => (
                    <div key={opt.id} className="flex justify-between items-center bg-white p-2 rounded-xl border border-purple-100 shadow-sm gap-2">
                      <span className="text-xs font-bold text-purple-950 truncate flex-1">{opt.label}</span>
                      <div className="flex items-center gap-1">
                        <div className="flex items-center gap-0.5 bg-gray-50 p-0.5 rounded-lg border border-gray-200">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveClimaOption(opt.id, 'up')}
                            className="text-gray-400 hover:text-indigo-600 p-1 rounded-lg hover:bg-gray-200 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            title="Sposta su"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === climaOptions.length - 1}
                            onClick={() => handleMoveClimaOption(opt.id, 'down')}
                            className="text-gray-400 hover:text-indigo-600 p-1 rounded-lg hover:bg-gray-200 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            title="Sposta giù"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <button 
                          type="button"
                          onClick={() => handleDeleteClimaOption(opt.id, opt.label)}
                          className="text-gray-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition cursor-pointer"
                          title="Elimina opzione"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <form onSubmit={handleAddClimaOption} className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="Nuova opzione (es. 🟢 Ottimo)..."
                  value={newClimaOptionName}
                  onChange={e => setNewClimaOptionName(e.target.value)}
                  disabled={climaOptLoading}
                  className="flex-1 px-3 py-2 text-xs font-bold text-purple-950 border border-purple-200/50 bg-white rounded-xl focus:ring-2 focus:ring-purple-400 outline-none placeholder-gray-400"
                />
                <button
                  type="submit"
                  disabled={climaOptLoading}
                  className="bg-purple-600 text-white p-2 rounded-xl hover:bg-purple-700 active:scale-95 disabled:opacity-50 transition flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          {/* RIPARTIZIONE & ANDAMENTO GRAPHICS */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-gradient-to-br from-slate-50 to-zinc-100 p-6 rounded-3xl border border-slate-200 flex flex-col justify-start gap-4 shadow-inner">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Distribuzione Risposte</h4>
              <div className="space-y-3.5">
                {Object.keys(climaStatsDynamic.distribution).length === 0 ? (
                  <p className="text-xs text-gray-450 font-bold italic text-center py-6">Nessuna opzione caricata.</p>
                ) : (
                  Object.entries(climaStatsDynamic.distribution).map(([label, info]) => {
                    const style = getOptionStyle(label);
                    return (
                      <div key={label} className="space-y-1">
                        <div className="flex justify-between text-[11px] font-bold text-gray-700">
                          <span className="truncate pr-2">{label}</span>
                          <span className="shrink-0">{info.count} ({info.pct}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden border border-gray-300/30">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${
                              style.color.includes('text-green') ? 'bg-green-500' :
                              style.color.includes('text-red') ? 'bg-red-500' :
                              style.color.includes('text-amber') ? 'bg-amber-500' :
                              'bg-indigo-500'
                            }`} 
                            style={{ width: `${info.pct}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="lg:col-span-2">
              <ClimaTrendChart responses={climaResponses} />
            </div>
          </div>
        </div>
      )}

      {/* SEZIONE 3: QUESTIONARIO HR (EDITING & RISULTATI AUTO-AGGIORNANTI) */}
      {activeTab === 'questionario' && (isAdmin || isHR) && (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 flex flex-col mb-10">
          
          {/* HEADER E SUB-TABS INTERNI */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-gray-200 pb-4 mb-6 gap-4">
            <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
              <button 
                onClick={() => setQuestionnaireSubTab('risultati')}
                className={`px-4 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${questionnaireSubTab === 'risultati' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Risultati Real-Time
              </button>
              <button 
                onClick={() => setQuestionnaireSubTab('configura')}
                className={`px-4 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${questionnaireSubTab === 'configura' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Configura & Invia
              </button>
            </div>

            {/* STATUS QUESTIONARIO CORRENTE */}
            <div className="flex items-center gap-3">
              {activeQuestionnaire?.active ? (
                <>
                  <span className="text-[11px] font-extrabold bg-green-50 text-green-700 px-3 py-1.5 rounded-full border border-green-200 flex items-center gap-1.5 animate-pulse">
                    <span className="w-2 h-2 bg-green-600 rounded-full"></span> Questionario Attivo
                  </span>
                  <button 
                    onClick={handleDeactivateQuestionnaire}
                    className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100/50 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Disattiva
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[11px] font-extrabold bg-gray-100 text-gray-500 px-3 py-1.5 rounded-full border border-gray-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-gray-400 rounded-full"></span> Disattivato
                  </span>
                  <button 
                    onClick={handleActivateQuestionnaire}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer border border-indigo-700 shadow-md"
                  >
                    Attiva e Invia ai Dipendenti
                  </button>
                </>
              )}
            </div>
          </div>

          {/* SOTTO-TAB 1: RISULTATI QUESTIONARIO */}
          {questionnaireSubTab === 'risultati' && (
            <div className="space-y-8">
              
              {/* STATS SUMMARY BAR */}
              <div className="bg-gradient-to-br from-indigo-50 to-blue-50/50 p-6 rounded-3xl border border-indigo-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h4 className="text-sm font-bold text-indigo-950/70 uppercase tracking-wider mb-0.5">Partecipazione Questionario Corrente</h4>
                  <p className="text-[11px] text-gray-400 font-semibold">
                    Versione: <strong className="text-gray-500">
                      {activeQuestionnaire?.id === 'initial_survey' ? 'Modello Iniziale' : 'Questionario Personalizzato'}
                    </strong>
                    {activeQuestionnaire?.sentAt && ` | Data invio: ${new Date(activeQuestionnaire.sentAt).toLocaleString('it-IT')}`}
                  </p>
                  <div className="text-4xl font-black text-indigo-900 mt-2 flex items-baseline gap-1.5">
                    {questionnaireStats.totalSubmissions}
                    <span className="text-sm font-extrabold text-indigo-900/60">risposte completate</span>
                  </div>
                </div>

                <button
                  onClick={handleDownloadOpenAnswers}
                  disabled={questionnaireStats.totalSubmissions === 0}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-2xl text-xs font-extrabold shadow-md hover:shadow-indigo-600/20 transition flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Download className="w-4 h-4" /> Scarica Risposte Aperte (TXT)
                </button>
              </div>

              {/* LISTA DEI GRAFICI DOMANDE CHIUSE */}
              {activeQuestionnaire && activeQuestionnaire.questions.length > 0 && (
                <div className="space-y-6">
                  <h3 className="text-lg font-extrabold text-indigo-950 border-b pb-2 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-indigo-600" />
                    <span>Riepilogo Grafici Risposte Chiuse (Auto-aggiornanti)</span>
                  </h3>
                  
                  {questionnaireStats.totalSubmissions === 0 ? (
                    <div className="p-12 text-center text-gray-400 font-bold italic bg-gray-50/50 border border-gray-150 rounded-3xl">
                      Nessun dipendente ha ancora risposto a questo questionario.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {activeQuestionnaire.questions.map(q => {
                        if (q.type === 'text') return null;
                        const statsObj = questionnaireStats.questionStats[q.id];
                        if (!statsObj || !statsObj.optionsCounts) return null;

                        return (
                          <div key={q.id} className="bg-white p-5 rounded-3xl border border-gray-200 space-y-4 shadow-sm flex flex-col justify-between hover:shadow-md transition">
                            <h5 className="font-extrabold text-[12px] text-gray-800 leading-normal">{q.text}</h5>
                            <div className="space-y-3">
                              {Object.entries(statsObj.optionsCounts).map(([opt, info]) => (
                                <div key={opt} className="space-y-1">
                                  <div className="flex justify-between text-xs font-semibold text-gray-700">
                                    <span className="truncate pr-4">{opt}</span>
                                    <span className="font-black text-indigo-600 shrink-0">{info.count} ({info.pct}%)</span>
                                  </div>
                                  <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden border border-gray-200">
                                    <div 
                                      className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                                      style={{ width: `${info.pct}%` }}
                                    ></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* LISTA RISPOSTE DOMANDE APERTE */}
              {activeQuestionnaire && activeQuestionnaire.questions.some(q => q.type === 'text') && (
                <div className="space-y-6 pt-6">
                  <h3 className="text-lg font-extrabold text-indigo-950 border-b pb-2 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    <span>Risposte Aperte per Domanda</span>
                  </h3>
                  
                  {questionnaireStats.totalSubmissions === 0 ? (
                    <div className="p-12 text-center text-gray-400 font-bold italic bg-gray-50/50 border border-gray-150 rounded-3xl">
                      Nessuna risposta compilata finora.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {activeQuestionnaire.questions.map((q, idx) => {
                        if (q.type !== 'text') return null;
                        const statsObj = questionnaireStats.questionStats[q.id];
                        const textAns = statsObj?.textResponses || [];
                        
                        return (
                          <details key={q.id} className="group bg-white border border-gray-150 rounded-3xl p-5 shadow-sm open:shadow-md transition duration-200">
                            <summary className="flex justify-between items-center font-extrabold text-sm text-gray-800 cursor-pointer list-none select-none">
                              <span className="pr-4">{idx + 1}. {q.text}</span>
                              <span className="text-xs font-extrabold bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full shrink-0 group-open:bg-indigo-600 group-open:text-white transition-colors">
                                {textAns.length} risposte
                              </span>
                            </summary>
                            <div className="mt-4 pt-4 border-t border-gray-100 space-y-3 max-h-60 overflow-y-auto pr-1">
                              {textAns.length === 0 ? (
                                <p className="text-xs text-gray-400 italic font-bold">Nessun testo fornito per questo quesito.</p>
                              ) : (
                                textAns.map((ans, aIdx) => (
                                  <div key={aIdx} className="bg-slate-50 p-3.5 rounded-2xl border border-gray-100/50 text-xs font-medium text-gray-800 whitespace-pre-wrap leading-relaxed shadow-inner">
                                    {ans}
                                  </div>
                                ))
                              )}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

          {/* SOTTO-TAB 2: CONFIGURA E MODIFICA QUESTIONARIO */}
          {questionnaireSubTab === 'configura' && (
            <div className="space-y-8">
              
              {/* MODULO ANTEPRIMA / PROVA QUESTIONARIO */}
              <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4 animate-fadeIn">
                <div className="space-y-1 text-center sm:text-left">
                  <h4 className="text-sm font-extrabold text-indigo-950">Visualizza Anteprima Questionario</h4>
                  <p className="text-xs text-gray-500">Controlla come si presenterà il questionario ai dipendenti prima di attivarlo.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-2xl text-xs font-extrabold shadow-md hover:shadow-indigo-600/10 transition flex items-center gap-2 cursor-pointer shrink-0 border border-indigo-700 shadow-sm"
                >
                  👁️ Prova Questionario (Anteprima)
                </button>
              </div>

              {/* MODULO AGGIUNGI NUOVA DOMANDA */}
              <div className="bg-gradient-to-br from-indigo-50/60 to-purple-50/60 p-6 rounded-3xl border border-indigo-100 shadow-sm">
                <h4 className="text-sm font-extrabold text-indigo-950 mb-4 flex items-center gap-1.5">
                  <Plus className="w-5 h-5 text-indigo-600" /> Aggiungi Nuova Domanda al Questionario
                </h4>
                <form onSubmit={handleAddQuestionSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                  <div className="md:col-span-2 space-y-4">
                    <div>
                      <label className="block text-xs font-black text-indigo-950 mb-1 ml-1 uppercase tracking-wider">Testo Domanda</label>
                      <input 
                        type="text" 
                        required 
                        placeholder="Scrivi qui la domanda..."
                        value={newQuestionText}
                        onChange={e => setNewQuestionText(e.target.value)}
                        className="w-full p-3 border-none bg-white rounded-xl text-sm font-bold text-gray-700 shadow-sm focus:ring-2 focus:ring-indigo-400 outline-none"
                      />
                    </div>
                    {newQuestionType !== 'text' && (
                      <div>
                        <label className="block text-xs font-black text-indigo-950 mb-1 ml-1 uppercase tracking-wider">Opzioni (separate da virgola)</label>
                        <input 
                          type="text" 
                          required 
                          placeholder="Es. Assolutamente sì, Sì, No, Assolutamente no"
                          value={newQuestionOptionsStr}
                          onChange={e => setNewQuestionOptionsStr(e.target.value)}
                          className="w-full p-3 border-none bg-white rounded-xl text-xs font-bold text-gray-700 shadow-sm focus:ring-2 focus:ring-indigo-400 outline-none placeholder-gray-400"
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-black text-indigo-950 mb-1 ml-1 uppercase tracking-wider">Sezione del Questionario</label>
                      <select
                        value={newQuestionSection}
                        onChange={e => setNewQuestionSection(Number(e.target.value))}
                        className="w-full p-3 border-none bg-white rounded-xl text-sm font-bold text-gray-700 shadow-sm focus:ring-2 focus:ring-indigo-400 outline-none transition"
                      >
                        <option value={1}>Sezione 1: Soddisfazione e Strumenti</option>
                        <option value={2}>Sezione 2: Ambiente e Relazioni</option>
                        <option value={3}>Sezione 3: Coinvolgimento e Valore</option>
                        <option value={4}>Sezione 4: Benefit e Opinioni</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-black text-indigo-950 mb-1 ml-1 uppercase tracking-wider">Tipo Domanda</label>
                      <select
                        value={newQuestionType}
                        onChange={e => setNewQuestionType(e.target.value as any)}
                        className="w-full p-3 border-none bg-white rounded-xl text-sm font-bold text-gray-700 shadow-sm focus:ring-2 focus:ring-indigo-400 outline-none transition"
                      >
                        <option value="choice">Scelta Singola (Radio)</option>
                        <option value="checkbox">Scelta Multipla (Checkbox)</option>
                        <option value="text">Risposta Aperta (Testo)</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3.5 rounded-xl transition shadow-md active:scale-95 cursor-pointer border border-indigo-700"
                    >
                      Aggiungi Domanda
                    </button>
                  </div>
                </form>
              </div>

              {/* LISTA EDITABILE DELLE DOMANDE CORRENTI */}
              {activeQuestionnaire && (
                <div className="space-y-6">
                  <h3 className="text-lg font-extrabold text-indigo-950 border-b pb-2">Domande nel Questionario ({activeQuestionnaire.questions.length})</h3>
                  
                  <div className="space-y-8 max-h-[600px] overflow-y-auto pr-1">
                    {[
                      { num: 1, title: 'Sezione 1: Soddisfazione e Strumenti' },
                      { num: 2, title: 'Sezione 2: Ambiente e Relazioni' },
                      { num: 3, title: 'Sezione 3: Coinvolgimento e Valore' },
                      { num: 4, title: 'Sezione 4: Benefit e Opinioni' }
                    ].map(sectionInfo => {
                      const sectionQuestions = activeQuestionnaire.questions.filter(q => getQuestionSection(q) === sectionInfo.num);
                      return (
                        <div key={sectionInfo.num} className="space-y-3">
                          <h4 className="text-xs font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl inline-block shadow-sm">
                            {sectionInfo.title} ({sectionQuestions.length})
                          </h4>
                          {sectionQuestions.length === 0 ? (
                            <p className="text-xs text-gray-450 italic pl-3">Nessuna domanda inserita in questa sezione.</p>
                          ) : (
                            <div className="space-y-3 pl-3 border-l-2 border-indigo-50">
                              {sectionQuestions.map((q, sIdx) => {
                                const isEditing = editingQuestionId === q.id;
                                return (
                                  <div key={q.id} className="p-4 border border-gray-200 rounded-2xl bg-white shadow-sm hover:shadow-md transition flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fadeIn">
                                    <div className="space-y-2 flex-1 min-w-0">
                                      {isEditing ? (
                                        <div className="space-y-3">
                                          <input
                                            type="text"
                                            value={editingText}
                                            onChange={e => setEditingText(e.target.value)}
                                            className="w-full p-3 border border-indigo-200 bg-indigo-50/20 rounded-xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500"
                                          />
                                          {q.type !== 'text' && (
                                            <input
                                              type="text"
                                              value={editingOptionsStr}
                                              onChange={e => setEditingOptionsStr(e.target.value)}
                                              placeholder="Opzioni separate da virgola..."
                                              className="w-full p-2.5 border border-indigo-200 bg-indigo-50/20 rounded-xl text-xs font-bold text-gray-800 outline-none placeholder-gray-400"
                                            />
                                          )}
                                          <div className="flex items-center gap-2">
                                            <label className="text-xs font-bold text-gray-500">Sposta in Sezione:</label>
                                            <select
                                              value={editingSection}
                                              onChange={e => setEditingSection(Number(e.target.value))}
                                              className="p-1 px-2 border border-indigo-200 bg-indigo-50/20 rounded-lg text-xs font-bold text-gray-900 outline-none focus:ring-1 focus:ring-indigo-500"
                                            >
                                              <option value={1}>Sezione 1: Soddisfazione e Strumenti</option>
                                              <option value={2}>Sezione 2: Ambiente e Relazioni</option>
                                              <option value={3}>Sezione 3: Coinvolgimento e Valore</option>
                                              <option value={4}>Sezione 4: Benefit e Opinioni</option>
                                            </select>
                                          </div>
                                        </div>
                                      ) : (
                                        <>
                                          <h5 className="font-extrabold text-sm text-gray-800 flex items-center gap-2">
                                            <span className="text-xs font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md shrink-0">#{sIdx + 1}</span>
                                            <span className="truncate">{q.text}</span>
                                          </h5>
                                          <div className="flex flex-wrap items-center gap-3">
                                            <span className="text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                                              {q.type === 'choice' ? 'Scelta Singola' : q.type === 'checkbox' ? 'Scelta Multipla' : 'Risposta Aperta'}
                                            </span>
                                            {q.options && q.options.length > 0 && (
                                              <span className="text-[10px] font-semibold text-gray-500 truncate">
                                                Opzioni: {q.options.join(' | ')}
                                              </span>
                                            )}
                                          </div>
                                        </>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                                      {isEditing ? (
                                        <>
                                          <button
                                            onClick={() => saveEditing(q.id)}
                                            className="bg-green-600 hover:bg-green-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer"
                                          >
                                            Salva
                                          </button>
                                          <button
                                            onClick={() => setEditingQuestionId(null)}
                                            className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer"
                                          >
                                            Annulla
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          <div className="flex items-center gap-0.5 bg-gray-50 p-1 rounded-xl border border-gray-200 mr-1 animate-fadeIn">
                                            <button
                                              type="button"
                                              disabled={sIdx === 0}
                                              onClick={() => handleMoveQuestion(q.id, 'up')}
                                              className="text-gray-400 hover:text-indigo-600 p-1 rounded-lg hover:bg-gray-200 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                                              title="Sposta su"
                                            >
                                              <ChevronUp className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                              type="button"
                                              disabled={sIdx === sectionQuestions.length - 1}
                                              onClick={() => handleMoveQuestion(q.id, 'down')}
                                              className="text-gray-400 hover:text-indigo-600 p-1 rounded-lg hover:bg-gray-200 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                                              title="Sposta giù"
                                            >
                                              <ChevronDown className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                          <button
                                            onClick={() => {
                                              setEditingQuestionId(q.id);
                                              setEditingText(q.text);
                                              setEditingOptionsStr(q.options ? q.options.join(', ') : '');
                                              setEditingSection(getQuestionSection(q));
                                            }}
                                            className="text-gray-400 hover:text-indigo-600 p-2 rounded-xl hover:bg-indigo-50 transition cursor-pointer"
                                            title="Modifica domanda"
                                          >
                                            <Edit3 className="w-5 h-5" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteQuestion(q.id)}
                                            className="text-gray-455 hover:text-red-600 p-2 rounded-xl hover:bg-red-50 transition cursor-pointer"
                                            title="Elimina domanda"
                                          >
                                            <Trash2 className="w-5 h-5" />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      )}

      {/* MODALE CONFERMA PERSONALIZZATA */}
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />

      {activeQuestionnaire && (
        <QuestionnaireModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          activeQuestionnaire={activeQuestionnaire}
          userId="preview_hr"
          isPreview={true}
        />
      )}

      {activeQuestionnaire && !isSoci(myAssociatedName) && (
        <QuestionnaireModal
          isOpen={isEmployeeSurveyOpen}
          onClose={() => setIsEmployeeSurveyOpen(false)}
          activeQuestionnaire={activeQuestionnaire}
          userId={user?.uid || ''}
        />
      )}

      <ClimaModal 
        isOpen={isTestClimaOpen}
        onClose={() => setIsTestClimaOpen(false)}
        isPreview={true}
      />

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
