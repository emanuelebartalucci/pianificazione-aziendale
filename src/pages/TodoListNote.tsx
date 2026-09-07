import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isSoci } from './Impostazioni';
import { 
  ListTodo, 
  StickyNote, 
  Calendar as CalendarIcon, 
  ListFilter, 
  Plus, 
  Search, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Trash2, 
  Pencil, 
  Pin, 
  ChevronLeft, 
  ChevronRight, 
  Briefcase, 
  User, 
  Users,
  Check, 
  X, 
  Tag
} from 'lucide-react';
import { 
  type UnifiedTodoItem, 
  type NotaPersonale, 
  TODO_CATEGORIE, 
  fetchUnifiedTodos, 
  getCachedUnifiedTodos,
  saveUnifiedTodo, 
  toggleUnifiedTodoStatus, 
  deleteUnifiedTodo, 
  fetchPersonalNotes, 
  getCachedPersonalNotes,
  savePersonalNote, 
  deletePersonalNote, 
  getCategoryBadgeProps,
  isTaskAssignee,
  isTaskCreator,
  isUserInvolvedInCommessa,
  canUserManageTask
} from '../services/todoService';

const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

const GIORNI_SETTIMANA = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

const NOTE_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  giallo: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', label: 'Giallo Post-it' },
  blu: { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-900', label: 'Azzurro Cielo' },
  verde: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', label: 'Verde Menta' },
  rosa: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-900', label: 'Rosa Pastello' },
  viola: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', label: 'Lilla Lavanda' },
  grigio: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-900', label: 'Grigio Perla' },
};

export default function TodoListNote() {
  const { userEmail, myAssociatedName, dipendenti, commesse, assegnazioni, isAdmin, loadPlanningData } = useAuth();
  const userIsSoci = isSoci(myAssociatedName);

  // Tab di navigazione principale: 'todo' o 'note'
  const [activeTab, setActiveTab] = useState<'todo' | 'note'>('todo');

  // Modalità di visualizzazione Tab ToDo: 'lista' o 'calendario'
  const [viewMode, setViewMode] = useState<'lista' | 'calendario'>('lista');

  // Stati Dati (inizializzati istantaneamente da cache per abbattere i tempi di caricamento a zero)
  const [todos, setTodos] = useState<UnifiedTodoItem[]>(() => {
    return getCachedUnifiedTodos({
      userEmail,
      myAssociatedName: myAssociatedName || undefined,
      commesseList: commesse,
      assegnazioni
    }) || [];
  });
  const [notes, setNotes] = useState<NotaPersonale[]>(() => {
    return getCachedPersonalNotes(userEmail) || [];
  });
  const [loading, setLoading] = useState<boolean>(() => {
    const cached = getCachedUnifiedTodos({
      userEmail,
      myAssociatedName: myAssociatedName || undefined,
      commesseList: commesse,
      assegnazioni
    });
    return !cached;
  });

  // Filtri ToDo
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterAssignee, setFilterAssignee] = useState<'all' | 'mine' | 'assigned_by_me'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'da_fare' | 'completato'>('da_fare');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterCommessa, setFilterCommessa] = useState<string>('all');

  // Navigazione e Selezione Calendario
  const [calDate, setCalDate] = useState<Date>(new Date());
  const [selectedCalDay, setSelectedCalDay] = useState<string | null>(null);
  const dayDetailsRef = useRef<HTMLDivElement>(null);

  // Modale Attività ToDo
  const [isTaskModalOpen, setIsTaskModalOpen] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<UnifiedTodoItem | null>(null);
  const [taskTitolo, setTaskTitolo] = useState<string>('');
  const [taskDescrizione, setTaskDescrizione] = useState<string>('');
  const [taskCategoria, setTaskCategoria] = useState<string>(TODO_CATEGORIE[0]);
  const [taskAssegnatiA, setTaskAssegnatiA] = useState<string[]>([]);
  const [taskCommessaId, setTaskCommessaId] = useState<string>('');
  const [taskScadenza, setTaskScadenza] = useState<string>('');
  const [isSavingTask, setIsSavingTask] = useState<boolean>(false);

  // Modale Note Personali
  const [isNoteModalOpen, setIsNoteModalOpen] = useState<boolean>(false);
  const [editingNote, setEditingNote] = useState<NotaPersonale | null>(null);
  const [noteTitolo, setNoteTitolo] = useState<string>('');
  const [noteContenuto, setNoteContenuto] = useState<string>('');
  const [noteColore, setNoteColore] = useState<'giallo' | 'blu' | 'verde' | 'rosa' | 'viola' | 'grigio'>('giallo');
  const [noteFissata, setNoteFissata] = useState<boolean>(false);
  const [noteSearch, setNoteSearch] = useState<string>('');
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Caricamento dati iniziale e sincronizzazione
  const commesseRef = useRef(commesse);
  commesseRef.current = commesse;
  const initialDataLoadedRef = useRef(false);

  const loadData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      if (userEmail) {
        // 1. Carica i ToDo
        const fetchedTodos = await fetchUnifiedTodos({
          userEmail,
          myAssociatedName: myAssociatedName || undefined,
          commesseList: commesseRef.current || [],
          assegnazioni,
          isAdmin,
          isSoci: userIsSoci
        });
        setTodos(fetchedTodos);

        // 2. Carica le Note personali
        const fetchedNotes = await fetchPersonalNotes(userEmail);
        setNotes(fetchedNotes);
      }
    } catch (err) {
      console.error("Errore caricamento ToDo e Note:", err);
      showToast("Errore durante il caricamento dei dati.", "error");
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }, [userEmail, myAssociatedName, isAdmin, userIsSoci, assegnazioni]);

  useEffect(() => {
    loadPlanningData?.();
  }, []);

  useEffect(() => {
    if (!initialDataLoadedRef.current) {
      initialDataLoadedRef.current = true;
      const hasCached = !!getCachedUnifiedTodos({
        userEmail,
        myAssociatedName: myAssociatedName || undefined,
        commesseList: commesse,
        assegnazioni
      });
      loadData(!hasCached);
    } else {
      loadData(false);
    }
  }, [userEmail, myAssociatedName, commesse.length, loadData]);

  // Data odierna in formato YYYY-MM-DD
  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // Controllo task scaduti assegnati all'utente attivo
  const overdueTasksForMe = useMemo(() => {
    return todos.filter(t => {
      if (t.stato !== 'da_fare') return false;
      if (!t.scadenza) return false;
      return isTaskAssignee(t, myAssociatedName) && t.scadenza < todayIso;
    });
  }, [todos, myAssociatedName, todayIso]);

  // Commesse abilitate per l'utente (coinvolto come Resp, PM, assegnato/pianificato o con ToDo)
  const availableCommesse = useMemo(() => {
    // ID commesse presenti nei ToDo attualmente caricati e visibili per l'utente
    const commesseIdsInTodos = new Set(todos.map(t => t.commessaId).filter(Boolean));

    return (commesse || []).filter(c => {
      // Se l'utente ha già un ToDo su questa commessa, deve poterla selezionare nel filtro
      if (commesseIdsInTodos.has(c.id)) return true;
      // Escludi le commesse chiuse e verifica se l'utente è abilitato/coinvolto
      if (c.stato === 'Chiusa') return false;
      return isUserInvolvedInCommessa(c, myAssociatedName, userEmail, assegnazioni);
    });
  }, [commesse, todos, myAssociatedName, userEmail, assegnazioni]);

  // Commesse selezionabili nella creazione/modifica task (esclude chiuse a meno che non sia il task in modifica)
  const availableCommesseForTask = useMemo(() => {
    return availableCommesse.filter(c => {
      if (editingTask && editingTask.commessaId === c.id) return true;
      return c.stato !== 'Chiusa';
    });
  }, [availableCommesse, editingTask]);

  // Se la commessa selezionata nel filtro non è più presente tra quelle abilitate, ripristina su 'all'
  useEffect(() => {
    if (filterCommessa !== 'all' && filterCommessa !== 'generic_only') {
      const exists = availableCommesse.some(c => c.id === filterCommessa);
      if (!exists) {
        setFilterCommessa('all');
      }
    }
  }, [filterCommessa, availableCommesse]);

  // Filtraggio ToDo per Vista Lista
  const filteredTodos = useMemo(() => {
    return todos.filter(t => {
      // 1. Ricerca testuale
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = (t.titolo || '').toLowerCase().includes(q);
        const matchDesc = (t.descrizione || '').toLowerCase().includes(q);
        const matchComm = (t.commessaNome || '').toLowerCase().includes(q) || (t.commessaCodice || '').toLowerCase().includes(q);
        const matchAssignee = (t.assegnatoA || '').toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchComm && !matchAssignee) return false;
      }

      // 2. Filtro Assegnazione
      if (filterAssignee === 'mine') {
        if (!isTaskAssignee(t, myAssociatedName)) return false;
      } else if (filterAssignee === 'assigned_by_me') {
        if (!isTaskCreator(t, myAssociatedName, userEmail)) return false;
      }

      // 3. Filtro Stato
      if (filterStatus !== 'all' && t.stato !== filterStatus) {
        return false;
      }

      // 4. Filtro Categoria
      if (filterCategory !== 'all' && t.categoria !== filterCategory) {
        return false;
      }

      // 5. Filtro Commessa
      if (filterCommessa === 'generic_only') {
        if (t.tipo !== 'generico') return false;
      } else if (filterCommessa !== 'all') {
        if (t.commessaId !== filterCommessa) return false;
      }

      return true;
    });
  }, [todos, searchQuery, filterAssignee, filterStatus, filterCategory, filterCommessa, myAssociatedName, userEmail]);

  // Apertura modale nuovo task
  const handleOpenNewTaskModal = (defaultDate?: string) => {
    setEditingTask(null);
    setTaskTitolo('');
    setTaskDescrizione('');
    setTaskCategoria(TODO_CATEGORIE[0] || 'da fare');
    setTaskAssegnatiA(myAssociatedName ? [myAssociatedName] : (dipendenti && dipendenti[0]?.nome ? [dipendenti[0].nome] : []));
    setTaskCommessaId('');
    setTaskScadenza(defaultDate || '');
    setIsTaskModalOpen(true);
  };

  // Apertura modale modifica task
  const handleOpenEditTaskModal = (task: UnifiedTodoItem) => {
    if (!canUserManageTask(task, myAssociatedName, userEmail, commesse)) {
      showToast("Solo il creatore (o il Resp./PM per compiti di commessa) può modificare questa attività.", "warning");
      return;
    }
    setEditingTask(task);
    setTaskTitolo(task.titolo);
    setTaskDescrizione(task.descrizione || '');
    setTaskCategoria(task.categoria || TODO_CATEGORIE[0] || 'da fare');
    let assignees: string[] = [];
    if (Array.isArray(task.assegnatiA) && task.assegnatiA.length > 0) {
      assignees = [...task.assegnatiA];
    } else if (task.assegnatoA) {
      assignees = task.assegnatoA.split(',').map(s => s.trim()).filter(Boolean);
    }
    setTaskAssegnatiA(assignees);
    setTaskCommessaId(task.commessaId || '');
    setTaskScadenza(task.scadenza || '');
    setIsTaskModalOpen(true);
  };

  // Salvataggio Task
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitolo.trim()) {
      showToast("Inserisci un titolo per l'attività.", "warning");
      return;
    }
    if (taskAssegnatiA.length === 0) {
      showToast("Seleziona almeno una persona incaricata.", "warning");
      return;
    }

    setIsSavingTask(true);
    try {
      const saved = await saveUnifiedTodo(
        {
          id: editingTask?.id,
          commessaId: taskCommessaId ? taskCommessaId : null,
          titolo: taskTitolo,
          descrizione: taskDescrizione,
          categoria: taskCategoria,
          scadenza: taskScadenza || undefined,
          assegnatiA: taskAssegnatiA,
          assegnatoA: taskAssegnatiA.join(', '),
          stato: editingTask ? editingTask.stato : 'da_fare'
        },
        {
          name: myAssociatedName || 'Utente',
          email: userEmail || ''
        },
        dipendenti || [],
        commesse || []
      );

      // Aggiorna stato locale immediatamente
      setTodos(prev => {
        if (editingTask) {
          return prev.map(t => t.id === saved.id ? saved : t);
        } else {
          return [saved, ...prev];
        }
      });

      setIsTaskModalOpen(false);
      showToast(editingTask ? "Attività aggiornata con successo!" : "Nuova attività registrata!", "success");
    } catch (err: any) {
      console.error("Errore salvataggio task:", err);
      showToast("Errore durante il salvataggio: " + (err.message || 'Errore imprevisto'), "error");
    } finally {
      setIsSavingTask(false);
    }
  };

  // Toggle stato attività (spunta completata / riapri)
  const handleToggleTaskStatus = async (task: UnifiedTodoItem) => {
    if (!isTaskAssignee(task, myAssociatedName)) {
      showToast("Solo le persone a cui è stato assegnato il compito possono segnarlo come completato o riaprirlo.", "warning");
      return;
    }

    const nextStatus: 'da_fare' | 'completato' = task.stato === 'completato' ? 'da_fare' : 'completato';
    const nowIso = new Date().toISOString();

    // Aggiornamento ottimistico della UI
    setTodos(prev => prev.map(t => {
      if (t.id === task.id) {
        return {
          ...t,
          stato: nextStatus,
          completatoDa: nextStatus === 'completato' ? (myAssociatedName || userEmail || 'Utente') : undefined,
          completatoIl: nextStatus === 'completato' ? nowIso : undefined
        };
      }
      return t;
    }));

    try {
      await toggleUnifiedTodoStatus(
        task,
        nextStatus,
        { name: myAssociatedName || 'Utente', email: userEmail || '' },
        dipendenti || []
      );
      showToast(nextStatus === 'completato' ? "✓ Attività segnata come completata!" : "Attività riaperta in 'Da fare'.", "success");
    } catch (err: any) {
      console.error("Errore cambio stato:", err);
      showToast("Errore durante l'aggiornamento dello stato: " + (err.message || ''), "error");
      loadData(); // Ripristina in caso di errore
    }
  };

  // Eliminazione task
  const handleDeleteTask = async (task: UnifiedTodoItem) => {
    if (!canUserManageTask(task, myAssociatedName, userEmail, commesse)) {
      showToast("Non hai i permessi per eliminare questa attività.", "warning");
      return;
    }

    if (!window.confirm(`Sei sicuro di voler eliminare l'attività "${task.titolo}"?`)) {
      return;
    }

    setTodos(prev => prev.filter(t => t.id !== task.id));
    try {
      await deleteUnifiedTodo(
        task,
        { name: myAssociatedName || 'Utente', email: userEmail || '' },
        commesse || []
      );
      showToast("Attività eliminata.", "success");
    } catch (err: any) {
      console.error("Errore cancellazione task:", err);
      showToast("Errore durante l'eliminazione: " + (err.message || ''), "error");
      loadData();
    }
  };

  // ==========================================
  // NOTE PERSONALI
  // ==========================================

  const handleOpenNewNoteModal = () => {
    setEditingNote(null);
    setNoteTitolo('');
    setNoteContenuto('');
    setNoteColore('giallo');
    setNoteFissata(false);
    setIsNoteModalOpen(true);
  };

  const handleOpenEditNoteModal = (note: NotaPersonale) => {
    setEditingNote(note);
    setNoteTitolo(note.titolo);
    setNoteContenuto(note.contenuto);
    setNoteColore(note.colore || 'giallo');
    setNoteFissata(!!note.fissata);
    setIsNoteModalOpen(true);
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitolo.trim() && !noteContenuto.trim()) {
      showToast("Inserisci un titolo o del testo per la nota.", "warning");
      return;
    }

    setIsSavingNote(true);
    try {
      const saved = await savePersonalNote(
        {
          id: editingNote?.id,
          titolo: noteTitolo,
          contenuto: noteContenuto,
          colore: noteColore,
          fissata: noteFissata
        },
        userEmail || ''
      );

      setNotes(prev => {
        if (editingNote) {
          return prev.map(n => n.id === saved.id ? saved : n);
        } else {
          return [saved, ...prev];
        }
      });

      setIsNoteModalOpen(false);
      showToast(editingNote ? "Nota aggiornata!" : "Nuova nota salvata!", "success");
    } catch (err: any) {
      console.error("Errore salvataggio nota:", err);
      showToast("Errore salvataggio nota: " + err.message, "error");
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!window.confirm("Sei sicuro di voler eliminare questa nota personale?")) {
      return;
    }

    setNotes(prev => prev.filter(n => n.id !== noteId));
    try {
      await deletePersonalNote(noteId);
      showToast("Nota eliminata.", "success");
    } catch (err) {
      console.error("Errore cancellazione nota:", err);
      showToast("Errore durante l'eliminazione della nota.", "error");
      loadData();
    }
  };

  const handleToggleNotePin = async (note: NotaPersonale) => {
    const updatedFissata = !note.fissata;
    setNotes(prev => prev.map(n => n.id === note.id ? { ...n, fissata: updatedFissata } : n));
    try {
      await savePersonalNote({ ...note, fissata: updatedFissata }, userEmail || '');
    } catch (err) {
      console.error("Errore toggle pin:", err);
      loadData();
    }
  };

  const filteredNotes = useMemo(() => {
    if (!noteSearch.trim()) return notes;
    const q = noteSearch.toLowerCase().trim();
    return notes.filter(n => 
      (n.titolo || '').toLowerCase().includes(q) || 
      (n.contenuto || '').toLowerCase().includes(q)
    );
  }, [notes, noteSearch]);

  // ==========================================
  // LOGICA VISTA CALENDARIO
  // ==========================================
  const currentMonthYearLabel = useMemo(() => {
    return `${MESI[calDate.getMonth()]} ${calDate.getFullYear()}`;
  }, [calDate]);

  const calendarDays = useMemo(() => {
    const year = calDate.getFullYear();
    const month = calDate.getMonth();

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Dom, 1 = Lun...
    const adjustedFirstDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1; // Lunedì = 0

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells: { dateStr: string; dayNum: number; isCurrentMonth: boolean }[] = [];

    // Giorni mese precedente
    for (let i = adjustedFirstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevM = month === 0 ? 11 : month - 1;
      const prevY = month === 0 ? year - 1 : year;
      const dateStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dateStr, dayNum: d, isCurrentMonth: false });
    }

    // Giorni mese corrente
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dateStr, dayNum: d, isCurrentMonth: true });
    }

    // Giorni mese successivo per completare la griglia (multiplo di 7)
    const remaining = 42 - cells.length; // Griglia standard 6 righe x 7 colonne
    for (let d = 1; d <= remaining; d++) {
      const nextM = month === 11 ? 0 : month + 1;
      const nextY = month === 11 ? year + 1 : year;
      const dateStr = `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dateStr, dayNum: d, isCurrentMonth: false });
    }

    return cells;
  }, [calDate]);

  const tasksByDate = useMemo(() => {
    const map: Record<string, UnifiedTodoItem[]> = {};
    todos.forEach(t => {
      if (t.scadenza) {
        if (!map[t.scadenza]) map[t.scadenza] = [];
        map[t.scadenza].push(t);
      }
    });
    return map;
  }, [todos]);

  const formatFullDateItalian = (dateStr: string) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const daysOfWeek = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const dayName = daysOfWeek[dateObj.getDay()];
    const monthName = MESI[m - 1];
    return `${dayName} ${d} ${monthName} ${y}`;
  };

  const handleSelectCalDay = (dateStr: string) => {
    setSelectedCalDay(dateStr);
    setTimeout(() => {
      dayDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const selectedDayTasks = useMemo(() => {
    if (!selectedCalDay) return [];
    return tasksByDate[selectedCalDay] || [];
  }, [selectedCalDay, tasksByDate]);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
      
      {/* Toast Notifica */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[9999] px-4 py-3 rounded-xl shadow-2xl text-white font-bold text-sm flex items-center gap-2 animate-in slide-in-from-bottom-5 duration-300 ${
          toast.type === 'success' ? 'bg-emerald-600' :
          toast.type === 'error' ? 'bg-red-600' :
          toast.type === 'warning' ? 'bg-amber-600' : 'bg-blue-600'
        }`}>
          <span>{toast.message}</span>
        </div>
      )}

      {/* HEADER PRINCIPALE */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] p-6 sm:p-8 shadow-sm border border-white/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <ListTodo className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              ToDo List & Note
            </h1>
            <p className="text-xs sm:text-sm font-semibold text-gray-500 mt-0.5">
              Gestisci le attività quotidiane, le scadenze operative e i tuoi appunti personali.
            </p>
          </div>
        </div>

        {/* SWITCH TAB PRINCIPALE */}
        <div className="flex items-center bg-gray-100/90 p-1.5 rounded-2xl border border-gray-200/80 shrink-0 self-stretch md:self-auto justify-center">
          <button
            type="button"
            onClick={() => setActiveTab('todo')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all cursor-pointer ${
              activeTab === 'todo'
                ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <ListTodo className="w-4 h-4" />
            <span>Attività & Scadenze</span>
            {todos.filter(t => t.stato === 'da_fare').length > 0 && (
              <span className="ml-1 bg-indigo-100 text-indigo-700 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                {todos.filter(t => t.stato === 'da_fare').length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('note')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all cursor-pointer ${
              activeTab === 'note'
                ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <StickyNote className="w-4 h-4" />
            <span>Note Personali</span>
            {notes.length > 0 && (
              <span className="ml-1 bg-amber-100 text-amber-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                {notes.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: ATTIVITÀ & SCADENZE */}
      {/* ========================================================================= */}
      {activeTab === 'todo' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          
          {/* BANNER ALLERTA SCADENZE SUPERATE PER L'UTENTE ATTIVO */}
          {overdueTasksForMe.length > 0 && (
            <div className="bg-gradient-to-r from-red-500/10 via-rose-500/10 to-amber-500/10 backdrop-blur-xl border-2 border-red-300 rounded-[1.8rem] p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="p-3 bg-red-600 text-white rounded-2xl shadow-md shrink-0 animate-bounce">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black uppercase text-red-700 tracking-wider bg-red-100 px-2.5 py-0.5 rounded-full border border-red-200">
                      Attenzione: {overdueTasksForMe.length} {overdueTasksForMe.length === 1 ? 'Attività Scaduta' : 'Attività Scadute'}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-gray-800 mt-1">
                    Hai compiti assegnati con data di scadenza superata non ancora contrassegnati come completati.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFilterStatus('da_fare');
                  setFilterAssignee('mine');
                  setViewMode('lista');
                }}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-black transition shadow-md active:scale-95 shrink-0 cursor-pointer"
              >
                Filtra i Miei Compiti
              </button>
            </div>
          )}

          {/* BARRA AZIONI E FILTRI */}
          <div className="bg-white/90 backdrop-blur-xl p-5 rounded-[1.8rem] border border-white/60 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
              
              {/* Switch Vista Lista vs Calendario */}
              <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200 self-start">
                <button
                  type="button"
                  onClick={() => setViewMode('lista')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                    viewMode === 'lista'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  <ListFilter className="w-3.5 h-3.5" />
                  <span>Vista Lista</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('calendario')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                    viewMode === 'calendario'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  <CalendarIcon className="w-3.5 h-3.5" />
                  <span>Vista Calendario</span>
                </button>
              </div>

              {/* Tasto Primario Nuovo Task */}
              <button
                type="button"
                onClick={() => handleOpenNewTaskModal()}
                className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-5 py-2.5 rounded-xl text-sm transition shadow-md active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Nuova Attività</span>
              </button>
            </div>

            {/* FILTRI DETTAGLIATI (SOLO IN VISTA LISTA) */}
            {viewMode === 'lista' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-gray-100">
                {/* 1. Cerca testo */}
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Cerca attività o commessa..."
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 placeholder-gray-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* 2. Filtro Assegnazione */}
                <select
                  value={filterAssignee}
                  onChange={e => setFilterAssignee(e.target.value as any)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="all">Tutte le risorse</option>
                  <option value="mine">Assegnate a me</option>
                  <option value="assigned_by_me">Assegnate da me</option>
                </select>

                {/* 3. Filtro Stato */}
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value as any)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="da_fare">Da fare (Aperte)</option>
                  <option value="completato">Completate</option>
                  <option value="all">Tutti gli stati</option>
                </select>

                {/* 4. Filtro Categoria */}
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="all">Tutte le categorie</option>
                  {TODO_CATEGORIE.map(cat => (
                    <option key={cat} value={cat}>{cat.toUpperCase()}</option>
                  ))}
                </select>

                {/* 5. Filtro Commessa / Generico */}
                <select
                  value={filterCommessa}
                  onChange={e => setFilterCommessa(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="all">Tutte le commesse e generici</option>
                  <option value="generic_only">Solo Attività Generiche</option>
                  {availableCommesse.map(c => (
                    <option key={c.id} value={c.id}>{c.codiceCommessa ? `[${c.codiceCommessa}] ` : ''}{c.nome}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* VISTA LISTA */}
          {/* ========================================================================= */}
          {viewMode === 'lista' && (
            <div className="space-y-3">
              {loading ? (
                <div className="p-12 text-center text-gray-400 font-bold text-sm bg-white/50 rounded-2xl">
                  Caricamento attività...
                </div>
              ) : filteredTodos.length === 0 ? (
                <div className="bg-white/80 backdrop-blur-xl p-12 text-center rounded-[2rem] border border-white/60 shadow-sm space-y-3">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-extrabold text-gray-800">Nessuna attività trovata</h3>
                  <p className="text-xs text-gray-500 max-w-md mx-auto">
                    Non ci sono attività corrispondenti ai filtri selezionati. Modifica i filtri o aggiungi un nuovo compito!
                  </p>
                  <button
                    type="button"
                    onClick={() => handleOpenNewTaskModal()}
                    className="inline-flex items-center gap-1.5 bg-indigo-600 text-white font-bold text-xs px-4 py-2 rounded-xl hover:bg-indigo-700 transition"
                  >
                    <Plus className="w-3.5 h-3.5" /> Aggiungi Attività
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {filteredTodos.map(task => {
                    const catProps = getCategoryBadgeProps(task.categoria);
                    const isDone = task.stato === 'completato';
                    const isOverdue = !isDone && task.scadenza && task.scadenza < todayIso;
                    const isToday = !isDone && task.scadenza && task.scadenza === todayIso;
                    const isAssignedToMe = isTaskAssignee(task, myAssociatedName);
                    const canManage = canUserManageTask(task, myAssociatedName, userEmail, commesse);

                    return (
                      <div 
                        key={task.id}
                        className={`rounded-2xl p-4 border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm hover:shadow-md ${
                          isDone 
                            ? 'opacity-70 bg-gray-50/70 border-gray-200 border-l-4 border-l-gray-300' 
                            : isAssignedToMe
                              ? isOverdue 
                                ? 'border-red-300 bg-red-50/20 border-l-4 border-l-red-500 shadow-xs' 
                                : isToday 
                                  ? 'border-amber-300 bg-amber-50/20 border-l-4 border-l-amber-500 shadow-xs' 
                                  : 'border-indigo-100 bg-white border-l-4 border-l-indigo-600 hover:border-indigo-300 shadow-xs'
                              : 'bg-slate-50/60 border-slate-200 border-l-4 border-l-slate-300 text-slate-700'
                        }`}
                      >
                        {/* Sinistra: Checkbox e Info Task */}
                        <div className="flex items-start gap-3.5 flex-1 min-w-0">
                          {/* Checkbox di completamento: abilitato SOLO se assegnato all'utente */}
                          <button
                            type="button"
                            onClick={() => handleToggleTaskStatus(task)}
                            disabled={!isAssignedToMe}
                            className={`mt-0.5 w-6 h-6 rounded-lg border flex items-center justify-center transition-all shrink-0 ${
                              !isAssignedToMe
                                ? 'opacity-40 cursor-not-allowed border-gray-300 bg-gray-100'
                                : isDone
                                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs cursor-pointer'
                                  : 'border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 cursor-pointer'
                            }`}
                            title={
                              !isAssignedToMe 
                                ? "Solo la persona a cui è assegnato il compito può completarlo" 
                                : isDone 
                                  ? "Segna come da fare" 
                                  : "Segna come completato"
                            }
                          >
                            {isDone && <Check className="w-4 h-4 stroke-[3]" />}
                          </button>

                          {/* Dettagli Testuali */}
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Riconoscimento a colpo d'occhio: Assegnato a te vs Colleghi */}
                              {isAssignedToMe ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200 shadow-2xs">
                                  <User className="w-3 h-3" />
                                  <span>Assegnato a te</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                  <Users className="w-3 h-3 text-slate-400" />
                                  <span>Colleghi: {task.assegnatoA}</span>
                                </span>
                              )}

                              {/* Badge Categoria */}
                              <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${catProps.bg} ${catProps.text} ${catProps.border}`}>
                                <span>{catProps.icon}</span>
                                <span>{catProps.label}</span>
                              </span>

                              {/* Badge Commessa o Generico: NON TRONCARE MAI */}
                              {task.tipo === 'commessa' && task.commessaNome ? (
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md border border-blue-100">
                                  <Briefcase className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                                  <span>{task.commessaCodice ? `[${task.commessaCodice}] ` : ''}{task.commessaNome}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md border border-gray-200">
                                  <Tag className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                                  <span>Generico / Ufficio</span>
                                </span>
                              )}

                              {/* Badge Scadenza */}
                              {task.scadenza && (
                                <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-md border ${
                                  isDone 
                                    ? 'bg-gray-100 text-gray-500 border-gray-200' 
                                    : isOverdue 
                                      ? 'bg-red-100 text-red-700 border-red-200 animate-pulse' 
                                      : isToday 
                                        ? 'bg-amber-100 text-amber-800 border-amber-200' 
                                        : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                }`}>
                                  <Clock className="w-3 h-3" />
                                  <span>
                                    {isOverdue ? `Scaduto il ${task.scadenza.split('-').reverse().join('/')}` :
                                     isToday ? 'Scade Oggi!' :
                                     `Scadenza: ${task.scadenza.split('-').reverse().join('/')}`}
                                  </span>
                                </span>
                              )}
                            </div>

                            {/* Titolo e descrizione */}
                            <h4 className={`text-sm font-extrabold text-gray-900 leading-snug break-words ${isDone ? 'line-through text-gray-400' : ''}`}>
                              {task.titolo}
                            </h4>

                            {task.descrizione && (
                              <p className="text-xs text-gray-500 whitespace-pre-line leading-relaxed">
                                {task.descrizione}
                              </p>
                            )}

                            {/* Metadati (Assegnato a, Creato da) */}
                            <div className="flex items-center gap-3 text-[11px] text-gray-400 font-semibold pt-0.5 flex-wrap">
                              <span className="flex items-center gap-1 text-gray-600">
                                <User className="w-3 h-3 text-gray-400 shrink-0" />
                                <span>Assegnato a: <strong>{task.assegnatoA}</strong></span>
                              </span>
                              <span>·</span>
                              <span>Creato da: {task.creatoDa}</span>
                            </div>
                          </div>
                        </div>

                        {/* Destra: Azioni Modifica / Elimina (visibili solo a chi ha i permessi) */}
                        {canManage && (
                          <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenEditTaskModal(task)}
                              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                              title="Modifica attività"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTask(task)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                              title="Elimina attività"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* VISTA CALENDARIO MENSILE INTERATTIVO */}
          {/* ========================================================================= */}
          {viewMode === 'calendario' && (
            <div className="bg-white rounded-[2rem] p-6 border border-gray-200 shadow-sm space-y-4">
              
              {/* Barra navigazione mese */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const prev = new Date(calDate);
                      prev.setMonth(prev.getMonth() - 1);
                      setCalDate(prev);
                    }}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl transition"
                    title="Mese precedente"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <h3 className="text-lg font-black text-gray-900 min-w-[180px] text-center">
                    {currentMonthYearLabel}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Date(calDate);
                      next.setMonth(next.getMonth() + 1);
                      setCalDate(next);
                    }}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl transition"
                    title="Mese successivo"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setCalDate(new Date())}
                  className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-xl transition border border-indigo-100"
                >
                  Oggi
                </button>
              </div>

              {/* Griglia Calendario */}
              <div className="grid grid-cols-7 border-t border-l border-gray-200 rounded-xl overflow-hidden">
                {/* Intestazione giorni settimana */}
                {GIORNI_SETTIMANA.map(g => (
                  <div key={g} className="bg-gray-50 border-r border-b border-gray-200 py-2.5 text-center text-[11px] font-black uppercase text-gray-500 tracking-wider">
                    {g}
                  </div>
                ))}

                {/* Celle giorni */}
                {calendarDays.map((cell, idx) => {
                  const isToday = cell.dateStr === todayIso;
                  const isSelected = cell.dateStr === selectedCalDay;
                  const dayTasks = tasksByDate[cell.dateStr] || [];

                  return (
                    <div
                      key={idx}
                      onClick={() => handleSelectCalDay(cell.dateStr)}
                      className={`min-h-[115px] p-2 border-r border-b border-gray-200 flex flex-col justify-between transition-all group relative cursor-pointer ${
                        isSelected 
                          ? 'bg-indigo-50/70 ring-2 ring-indigo-500 ring-inset z-10' 
                          : cell.isCurrentMonth 
                            ? 'bg-white hover:bg-indigo-50/20' 
                            : 'bg-gray-50/40 text-gray-300 hover:bg-gray-50/70'
                      }`}
                    >
                      {/* Top cella: Numero giorno e tasto '+' per aggiungere rapido */}
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-extrabold w-6 h-6 flex items-center justify-center rounded-full ${
                          isToday 
                            ? 'bg-indigo-600 text-white shadow-xs' 
                            : isSelected
                              ? 'bg-indigo-100 text-indigo-700 font-black'
                              : cell.isCurrentMonth 
                                ? 'text-gray-800' 
                                : 'text-gray-300'
                        }`}>
                          {cell.dayNum}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenNewTaskModal(cell.dateStr);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition cursor-pointer"
                          title={`Aggiungi attività per il ${cell.dateStr.split('-').reverse().join('/')}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Pillole dei task in scadenza in questo giorno */}
                      <div className="space-y-1 mt-1 flex-1 overflow-y-auto max-h-[80px]">
                        {dayTasks.map(t => {
                          const isDone = t.stato === 'completato';
                          const isOverdue = !isDone && t.scadenza && t.scadenza < todayIso;

                          return (
                            <div
                              key={t.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectCalDay(cell.dateStr);
                              }}
                              className={`text-[10px] font-bold p-1 rounded-md cursor-pointer truncate border transition flex items-center gap-1 ${
                                isDone 
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 line-through opacity-70' 
                                  : isOverdue 
                                    ? 'bg-red-50 text-red-800 border-red-200' 
                                    : 'bg-indigo-50 text-indigo-900 border-indigo-200 hover:bg-indigo-100'
                              }`}
                              title={`${t.titolo} (${t.assegnatoA}) — Clicca per vedere la lista completa sotto`}
                            >
                              <span className="shrink-0">{isDone ? '✓' : '•'}</span>
                              <span className="truncate">{t.titolo}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* SEZIONE DETTAGLIO GIORNO SELEZIONATO (CON SCROLL AUTOMATICO) */}
              {selectedCalDay && (
                <div 
                  ref={dayDetailsRef}
                  className="mt-6 pt-6 border-t border-gray-100 space-y-4 animate-in fade-in slide-in-from-top-3 duration-200"
                >
                  {/* Header Dettaglio Giorno */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
                        <CalendarIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm sm:text-base font-extrabold text-gray-900">
                            {formatFullDateItalian(selectedCalDay)}
                          </h4>
                          {selectedCalDay === todayIso && (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                              Oggi
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 font-semibold mt-0.5">
                          {selectedDayTasks.length === 0
                            ? 'Nessuna attività in scadenza'
                            : selectedDayTasks.length === 1
                              ? '1 attività programmata'
                              : `${selectedDayTasks.length} attività programmate`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={() => handleOpenNewTaskModal(selectedCalDay)}
                        className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs px-3.5 py-2 rounded-xl transition shadow-xs active:scale-95 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Aggiungi Attività</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCalDay(null)}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white/80 rounded-xl transition cursor-pointer"
                        title="Chiudi dettaglio giorno"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Elenco dei compiti del giorno */}
                  {selectedDayTasks.length === 0 ? (
                    <div className="p-8 text-center bg-gray-50/50 rounded-2xl border border-gray-200/70 space-y-2">
                      <div className="w-10 h-10 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <p className="text-xs font-bold text-gray-700">
                        Nessun ToDo programmato per questa data.
                      </p>
                      <p className="text-[11px] text-gray-400">
                        Puoi pianificare una nuova attività per questo giorno cliccando sul tasto "Aggiungi Attività".
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {selectedDayTasks.map(task => {
                        const catProps = getCategoryBadgeProps(task.categoria);
                        const isDone = task.stato === 'completato';
                        const isOverdue = !isDone && task.scadenza && task.scadenza < todayIso;
                        const isToday = !isDone && task.scadenza && task.scadenza === todayIso;
                        const isAssignedToMe = isTaskAssignee(task, myAssociatedName);
                        const canManage = canUserManageTask(task, myAssociatedName, userEmail, commesse);

                        return (
                          <div
                            key={task.id}
                            className={`rounded-2xl p-4 border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm hover:shadow-md ${
                              isDone 
                                ? 'opacity-70 bg-gray-50/70 border-gray-200 border-l-4 border-l-gray-300' 
                                : isAssignedToMe
                                  ? isOverdue 
                                    ? 'border-red-300 bg-red-50/20 border-l-4 border-l-red-500 shadow-xs' 
                                    : isToday 
                                      ? 'border-amber-300 bg-amber-50/20 border-l-4 border-l-amber-500 shadow-xs' 
                                      : 'border-indigo-100 bg-white border-l-4 border-l-indigo-600 hover:border-indigo-300 shadow-xs'
                                  : 'bg-slate-50/60 border-slate-200 border-l-4 border-l-slate-300 text-slate-700'
                            }`}
                          >
                            {/* Sinistra: Checkbox e Info Task */}
                            <div className="flex items-start gap-3.5 flex-1 min-w-0">
                              {/* Checkbox di completamento: abilitato SOLO se assegnato all'utente */}
                              <button
                                type="button"
                                onClick={() => handleToggleTaskStatus(task)}
                                disabled={!isAssignedToMe}
                                className={`mt-0.5 w-6 h-6 rounded-lg border flex items-center justify-center transition-all shrink-0 ${
                                  !isAssignedToMe
                                    ? 'opacity-40 cursor-not-allowed border-gray-300 bg-gray-100'
                                    : isDone
                                      ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs cursor-pointer'
                                      : 'border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 cursor-pointer'
                                }`}
                                title={
                                  !isAssignedToMe 
                                    ? "Solo la persona a cui è assegnato il compito può completarlo" 
                                    : isDone 
                                      ? "Segna come da fare" 
                                      : "Segna come completato"
                                }
                              >
                                {isDone && <Check className="w-4 h-4 stroke-[3]" />}
                              </button>

                              {/* Dettagli Testuali */}
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {/* Riconoscimento a colpo d'occhio: Assegnato a te vs Colleghi */}
                                  {isAssignedToMe ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200 shadow-2xs">
                                      <User className="w-3 h-3" />
                                      <span>Assegnato a te</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                      <Users className="w-3 h-3 text-slate-400" />
                                      <span>Colleghi: {task.assegnatoA}</span>
                                    </span>
                                  )}

                                  {/* Badge Categoria */}
                                  <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${catProps.bg} ${catProps.text} ${catProps.border}`}>
                                    <span>{catProps.icon}</span>
                                    <span>{catProps.label}</span>
                                  </span>

                                  {/* Badge Commessa o Generico: NON TRONCARE MAI */}
                                  {task.tipo === 'commessa' && task.commessaNome ? (
                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md border border-blue-100">
                                      <Briefcase className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                                      <span>{task.commessaCodice ? `[${task.commessaCodice}] ` : ''}{task.commessaNome}</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md border border-gray-200">
                                      <Tag className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                                      <span>Generico / Ufficio</span>
                                    </span>
                                  )}

                                  {/* Badge Scadenza */}
                                  {task.scadenza && (
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-md border ${
                                      isDone 
                                        ? 'bg-gray-100 text-gray-500 border-gray-200' 
                                        : isOverdue 
                                          ? 'bg-red-100 text-red-700 border-red-200 animate-pulse' 
                                          : isToday 
                                            ? 'bg-amber-100 text-amber-800 border-amber-200' 
                                            : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                    }`}>
                                      <Clock className="w-3 h-3" />
                                      <span>
                                        {isOverdue ? `Scaduto il ${task.scadenza.split('-').reverse().join('/')}` :
                                         isToday ? 'Scade Oggi!' :
                                         `Scadenza: ${task.scadenza.split('-').reverse().join('/')}`}
                                      </span>
                                    </span>
                                  )}
                                </div>

                                {/* Titolo e descrizione */}
                                <h4 className={`text-sm font-extrabold text-gray-900 leading-snug break-words ${isDone ? 'line-through text-gray-400' : ''}`}>
                                  {task.titolo}
                                </h4>

                                {task.descrizione && (
                                  <p className="text-xs text-gray-500 whitespace-pre-line leading-relaxed">
                                    {task.descrizione}
                                  </p>
                                )}

                                {/* Metadati (Assegnato a, Creato da) */}
                                <div className="flex items-center gap-3 text-[11px] text-gray-400 font-semibold pt-0.5 flex-wrap">
                                  <span className="flex items-center gap-1 text-gray-600">
                                    <User className="w-3 h-3 text-gray-400 shrink-0" />
                                    <span>Assegnato a: <strong>{task.assegnatoA}</strong></span>
                                  </span>
                                  <span>·</span>
                                  <span>Creato da: {task.creatoDa}</span>
                                </div>
                              </div>
                            </div>

                            {/* Destra: Azioni Modifica / Elimina (visibili solo a chi ha i permessi) */}
                            {canManage && (
                              <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditTaskModal(task)}
                                  className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                                  title="Modifica attività"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task)}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                                  title="Elimina attività"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: NOTE PERSONALI (PRIVATE AL 100%) */}
      {/* ========================================================================= */}
      {activeTab === 'note' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          
          {/* Header Note: Ricerca e Tasto Nuova Nota */}
          <div className="bg-white/80 backdrop-blur-xl p-5 rounded-[1.8rem] border border-white/60 shadow-sm flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={noteSearch}
                onChange={e => setNoteSearch(e.target.value)}
                placeholder="Cerca nei tuoi appunti..."
                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 placeholder-gray-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
              />
              {noteSearch && (
                <button onClick={() => setNoteSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleOpenNewNoteModal}
              className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-extrabold px-5 py-2.5 rounded-xl text-sm transition shadow-md active:scale-95 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Nuova Nota Personale</span>
            </button>
          </div>

          {/* Griglia a Post-it Note Personali */}
          {filteredNotes.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-xl p-12 text-center rounded-[2rem] border border-white/60 shadow-sm space-y-3">
              <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                <StickyNote className="w-6 h-6" />
              </div>
              <h3 className="text-base font-extrabold text-gray-800">Nessuna nota personale presente</h3>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                Questo è il tuo spazio privato per promemoria veloci, testi da ricordare e appunti personali. Nessun altro utente può visualizzarli.
              </p>
              <button
                type="button"
                onClick={handleOpenNewNoteModal}
                className="inline-flex items-center gap-1.5 bg-amber-500 text-white font-bold text-xs px-4 py-2 rounded-xl hover:bg-amber-600 transition"
              >
                <Plus className="w-3.5 h-3.5" /> Crea la tua prima nota
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredNotes.map(note => {
                const colorConfig = NOTE_COLORS[note.colore || 'giallo'] || NOTE_COLORS.giallo;

                return (
                  <div
                    key={note.id}
                    className={`${colorConfig.bg} ${colorConfig.border} border-2 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[220px] relative group`}
                  >
                    {/* Top: Titolo e Pin */}
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className={`text-base font-black ${colorConfig.text} leading-tight break-words flex-1`}>
                          {note.titolo || 'Senza titolo'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => handleToggleNotePin(note)}
                          className={`p-1 rounded-md transition shrink-0 ${
                            note.fissata 
                              ? 'text-amber-600 bg-amber-200/50' 
                              : 'text-gray-400 opacity-0 group-hover:opacity-100 hover:text-gray-700'
                          }`}
                          title={note.fissata ? "Rimuovi da in alto" : "Fissa in alto"}
                        >
                          <Pin className={`w-4 h-4 ${note.fissata ? 'fill-amber-600 rotate-45' : ''}`} />
                        </button>
                      </div>

                      {/* Testo Nota */}
                      <p className="text-xs font-medium text-gray-700 whitespace-pre-line leading-relaxed break-words">
                        {note.contenuto}
                      </p>
                    </div>

                    {/* Footer: Data e Azioni */}
                    <div className="pt-4 mt-4 border-t border-gray-200/60 flex items-center justify-between text-[10px] text-gray-400 font-semibold">
                      <span>Aggiornata: {new Date(note.aggiornataIl || note.creataIl).toLocaleDateString('it-IT')}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditNoteModal(note)}
                          className="p-1 hover:text-indigo-600 hover:bg-white/60 rounded transition"
                          title="Modifica nota"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteNote(note.id)}
                          className="p-1 hover:text-red-600 hover:bg-white/60 rounded transition"
                          title="Elimina nota"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALE NUOVA / MODIFICA ATTIVITÀ TODO */}
      {/* ========================================================================= */}
      {isTaskModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-gray-100 space-y-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                  <ListTodo className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-black text-gray-900">
                  {editingTask ? 'Modifica Attività' : 'Nuova Attività ToDo'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsTaskModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTask} className="space-y-4">
              {/* Titolo */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Titolo Attività *
                </label>
                <input
                  type="text"
                  required
                  value={taskTitolo}
                  onChange={e => setTaskTitolo(e.target.value)}
                  placeholder="Es. Ritirare i bidoni della spazzatura, Chiamare il cliente..."
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              {/* Descrizione */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Note o Istruzioni (Opzionale)
                </label>
                <textarea
                  rows={2}
                  value={taskDescrizione}
                  onChange={e => setTaskDescrizione(e.target.value)}
                  placeholder="Dettagli aggiuntivi per chi svolgerà il compito..."
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              {/* Categoria */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Categoria
                </label>
                <select
                  value={taskCategoria}
                  onChange={e => setTaskCategoria(e.target.value)}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                >
                  {TODO_CATEGORIE.map(cat => (
                    <option key={cat} value={cat}>{cat.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              {/* Multi-Assegnatari */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Assegnato a * {taskAssegnatiA.length > 1 && `(${taskAssegnatiA.length} persone)`}
                  </label>
                  {myAssociatedName && !taskAssegnatiA.includes(myAssociatedName) && (
                    <button
                      type="button"
                      onClick={() => setTaskAssegnatiA(prev => [...prev, myAssociatedName])}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                    >
                      + Assegna a me
                    </button>
                  )}
                </div>

                {/* Badge delle persone selezionate */}
                <div className="flex flex-wrap gap-1.5 p-2.5 bg-gray-50 border border-gray-200 rounded-xl min-h-[44px] items-center">
                  {taskAssegnatiA.length === 0 ? (
                    <span className="text-xs text-gray-400 font-medium italic pl-1">
                      Nessuna persona selezionata. Scegli dal menu a tendina sotto.
                    </span>
                  ) : (
                    taskAssegnatiA.map(name => (
                      <span 
                        key={name}
                        className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-lg shadow-2xs"
                      >
                        <User className="w-3 h-3 text-indigo-500 shrink-0" />
                        <span>{name}</span>
                        <button
                          type="button"
                          onClick={() => setTaskAssegnatiA(prev => prev.filter(n => n !== name))}
                          className="hover:text-red-600 transition cursor-pointer p-0.5 ml-0.5"
                          title={`Rimuovi ${name}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {/* Dropdown per aggiungere colleghi */}
                <div className="mt-2">
                  <select
                    value=""
                    onChange={e => {
                      const val = e.target.value;
                      if (val && !taskAssegnatiA.includes(val)) {
                        setTaskAssegnatiA(prev => [...prev, val]);
                      }
                    }}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-300"
                  >
                    <option value="">+ Aggiungi una persona all'attività...</option>
                    {(dipendenti || [])
                      .filter(d => !taskAssegnatiA.includes(d.nome))
                      .map(d => (
                        <option key={d.id} value={d.nome}>{d.nome}</option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Commessa di riferimento (filtrata solo sulle commesse aperte in cui l'utente è coinvolto) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Commessa di riferimento
                </label>
                <select
                  value={taskCommessaId}
                  onChange={e => setTaskCommessaId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                >
                  <option value="">Nessuna commessa (Attività generica di studio/ufficio)</option>
                  {availableCommesseForTask.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.codiceCommessa ? `[${c.codiceCommessa}] ` : ''}{c.nome}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-gray-400 font-medium block mt-1">
                  Mostra solo le commesse aperte in cui sei pianificato, Responsabile o PM.
                </span>
              </div>

              {/* Data di Scadenza */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Data di Scadenza (Opzionale)
                </label>
                <input
                  type="date"
                  value={taskScadenza}
                  onChange={e => setTaskScadenza(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              {/* Bottoni di Salvataggio */}
              <div className="flex justify-end items-center gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsTaskModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl font-bold text-xs text-gray-600 hover:bg-gray-100 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isSavingTask}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-xs transition shadow-md active:scale-95 disabled:opacity-50"
                >
                  {isSavingTask ? 'Salvataggio...' : editingTask ? 'Salva Modifiche' : 'Crea Attività'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALE NUOVA / MODIFICA NOTA PERSONALE */}
      {/* ========================================================================= */}
      {isNoteModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-gray-100 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                  <StickyNote className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-black text-gray-900">
                  {editingNote ? 'Modifica Nota Personale' : 'Nuova Nota Personale'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsNoteModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNote} className="space-y-4">
              {/* Titolo Nota */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Titolo o Oggetto
                </label>
                <input
                  type="text"
                  value={noteTitolo}
                  onChange={e => setNoteTitolo(e.target.value)}
                  placeholder="Es. Promemoria riunione, Numeri utili, Idee..."
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-amber-300"
                />
              </div>

              {/* Contenuto Nota */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Testo della Nota
                </label>
                <textarea
                  rows={4}
                  value={noteContenuto}
                  onChange={e => setNoteContenuto(e.target.value)}
                  placeholder="Scrivi qui i tuoi appunti personali..."
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-amber-300"
                />
              </div>

              {/* Selezione Colore Post-it */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Colore Post-it
                </label>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {Object.entries(NOTE_COLORS).map(([colorKey, conf]) => (
                    <button
                      type="button"
                      key={colorKey}
                      onClick={() => setNoteColore(colorKey as any)}
                      className={`w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center cursor-pointer ${conf.bg} ${
                        noteColore === colorKey ? 'border-gray-900 scale-110 shadow-sm' : 'border-gray-300 hover:scale-105'
                      }`}
                      title={conf.label}
                    >
                      {noteColore === colorKey && <Check className="w-4 h-4 text-gray-800 stroke-[3]" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fissa in Alto (Pin) */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="pinNote"
                  checked={noteFissata}
                  onChange={e => setNoteFissata(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                />
                <label htmlFor="pinNote" className="text-xs font-bold text-gray-700 cursor-pointer flex items-center gap-1">
                  <Pin className="w-3.5 h-3.5 text-amber-600" />
                  <span>Fissa questa nota in cima</span>
                </label>
              </div>

              {/* Bottoni Azione */}
              <div className="flex justify-end items-center gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsNoteModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl font-bold text-xs text-gray-600 hover:bg-gray-100 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isSavingNote}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-xs transition shadow-md active:scale-95 disabled:opacity-50"
                >
                  {isSavingNote ? 'Salvataggio...' : editingNote ? 'Salva Modifiche' : 'Crea Nota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
