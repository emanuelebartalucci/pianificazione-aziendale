import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isSoci } from './Impostazioni';
import ConfirmModal from '../components/ConfirmModal';
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
  ChevronDown,
  Briefcase, 
  User, 
  Check, 
  X, 
  Tag,
  Paperclip,
  FolderOpen,
  Archive,
  File,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { 
  type UnifiedTodoItem, 
  type NotaPersonale, 
  type TodoAttachment,
  TODO_CATEGORIE, 
  fetchUnifiedTodos, 
  getCachedUnifiedTodos,
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
  canUserManageTask,
  getAssignedCommessaIdsForUser,
  parseAttachmentPath,
  openAttachedPath,
  triggerNativePicker,
  isSharedNetworkPath,
  getTodoAttachments
} from '../services/todoService';
import TaskModal from '../components/TaskModal';
import AttachmentBadge from '../components/AttachmentBadge';
import { markNotificationsAsReadByFilter, markOverdueNotificationsAsReadForTask } from '../utils/userNotificationService';


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
  const { userEmail, myAssociatedName, dipendenti, commesse, assegnazioni, isAdmin, loadPlanningData, isPlanningLoaded } = useAuth();
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
      assegnazioni,
      includeOlderCompleted: false,
      includeClosedCommesse: false
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
      assegnazioni,
      includeOlderCompleted: false,
      includeClosedCommesse: false
    });
    return !cached;
  });

  // Filtri ToDo
  const [filterAssignee, setFilterAssignee] = useState<'all' | 'mine' | 'assigned_by_me'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'da_fare' | 'completato'>('da_fare');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterCommessa, setFilterCommessa] = useState<string>('all');
  const [isCommessaFilterOpen, setIsCommessaFilterOpen] = useState<boolean>(false);
  const [commessaFilterSearch, setCommessaFilterSearch] = useState<string>('');
  const commessaFilterDropdownRef = useRef<HTMLDivElement>(null);
  const [showOlderCompleted, setShowOlderCompleted] = useState<boolean>(false);

  // Navigazione e Selezione Calendario
  const [calDate, setCalDate] = useState<Date>(new Date());
  const [selectedCalDay, setSelectedCalDay] = useState<string | null>(null);
  const dayDetailsRef = useRef<HTMLDivElement>(null);

  // Modale Attività ToDo
  const [isTaskModalOpen, setIsTaskModalOpen] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<UnifiedTodoItem | null>(null);
  const [taskDefaultDate, setTaskDefaultDate] = useState<string>('');

  // Modale Note Personali
  const [isNoteModalOpen, setIsNoteModalOpen] = useState<boolean>(false);
  const [editingNote, setEditingNote] = useState<NotaPersonale | null>(null);
  const [noteTitolo, setNoteTitolo] = useState<string>('');
  const [noteContenuto, setNoteContenuto] = useState<string>('');
  const [noteColore, setNoteColore] = useState<'giallo' | 'blu' | 'verde' | 'rosa' | 'viola' | 'grigio'>('giallo');
  const [noteFissata, setNoteFissata] = useState<boolean>(false);
  const [noteAllegati, setNoteAllegati] = useState<TodoAttachment[]>([]);
  const [noteInputPercorso, setNoteInputPercorso] = useState<string>('');
  const [isPickingNoteAttachment, setIsPickingNoteAttachment] = useState<boolean>(false);
  const [noteSearch, setNoteSearch] = useState<string>('');
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Modale di conferma moderno (sostituisce i vecchi window.confirm)
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  // Caricamento dati iniziale e sincronizzazione
  const commesseRef = useRef(commesse);
  commesseRef.current = commesse;
  const initialDataLoadedRef = useRef(false);

  const loadData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      if (userEmail) {
        // 1. Carica i ToDo (esclusione commesse chiuse e finestra mobile 30gg per completati)
        const fetchedTodos = await fetchUnifiedTodos({
          userEmail,
          myAssociatedName: myAssociatedName || undefined,
          commesseList: commesseRef.current || [],
          assegnazioni,
          isAdmin,
          isSoci: userIsSoci,
          includeOlderCompleted: showOlderCompleted,
          includeClosedCommesse: false
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
  }, [userEmail, myAssociatedName, isAdmin, userIsSoci, assegnazioni, showOlderCompleted]);

  useEffect(() => {
    loadPlanningData?.();
  }, []);

  // Pulizia notifiche ToDo all'ingresso nella sezione ToDo List (escluse quelle di scadenza che restano attive finché non risolte)
  useEffect(() => {
    if (userEmail) {
      markNotificationsAsReadByFilter(userEmail, { tipo: 'todo_assegnato' });
      markNotificationsAsReadByFilter(userEmail, { tipo: 'todo_completato' });
      // NOTA: 'todo_scaduto' NON viene marcato come letto all'ingresso!
      // Rimane attivo finché l'attività non viene contrassegnata come completata
      // o la sua data di scadenza non viene spostata più in avanti.
    }

    const params = new URLSearchParams(window.location.search);
    const commessaIdParam = params.get('commessaId');
    if (commessaIdParam) {
      setFilterCommessa(commessaIdParam);
    }
  }, [userEmail]);

  useEffect(() => {
    if (!userEmail) return;
    const hasCached = !!getCachedUnifiedTodos({
      userEmail,
      myAssociatedName: myAssociatedName || undefined,
      commesseList: commesse,
      assegnazioni,
      includeOlderCompleted: showOlderCompleted,
      includeClosedCommesse: false
    });
    const needSpinner = !initialDataLoadedRef.current && !hasCached;
    initialDataLoadedRef.current = true;
    loadData(needSpinner);
  }, [userEmail, myAssociatedName, commesse.length, isPlanningLoaded, loadData]);

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
    // Precalcola in O(M) il Set delle commesse assegnate all'utente in griglia una sola volta
    const precomputedAssignedIds = getAssignedCommessaIdsForUser(myAssociatedName, assegnazioni);
    // ID commesse presenti nei ToDo attualmente caricati e visibili per l'utente
    const commesseIdsInTodos = new Set(todos.map(t => t.commessaId).filter(Boolean));

    return (commesse || []).filter(c => {
      // Se l'utente ha già un ToDo su questa commessa, deve poterla selezionare nel filtro
      if (commesseIdsInTodos.has(c.id)) return true;
      // Escludi le commesse chiuse e verifica se l'utente è abilitato/coinvolto
      if (c.stato === 'Chiusa') return false;
      return isUserInvolvedInCommessa(c, myAssociatedName, userEmail, assegnazioni, precomputedAssignedIds);
    });
  }, [commesse, todos, myAssociatedName, userEmail, assegnazioni]);



  // Se la commessa selezionata nel filtro non è più presente tra quelle abilitate, ripristina su 'all'
  useEffect(() => {
    if (filterCommessa !== 'all' && filterCommessa !== 'generic_only') {
      const exists = availableCommesse.some(c => c.id === filterCommessa);
      if (!exists) {
        setFilterCommessa('all');
      }
    }
  }, [filterCommessa, availableCommesse]);

  // Commesse per il menu a tendina con ricerca testuale
  const filteredCommesseForFilter = useMemo(() => {
    const q = commessaFilterSearch.toLowerCase().trim();
    if (!q) return availableCommesse;
    return availableCommesse.filter(c => {
      const matchName = (c.nome || '').toLowerCase().includes(q);
      const matchCod = (c.codiceCommessa || '').toLowerCase().includes(q);
      const matchClient = (c.cliente || '').toLowerCase().includes(q);
      return matchName || matchCod || matchClient;
    });
  }, [availableCommesse, commessaFilterSearch]);

  const selectedFilterCommessaObj = useMemo(() => {
    if (filterCommessa === 'all' || filterCommessa === 'generic_only') return null;
    return availableCommesse.find(c => c.id === filterCommessa) || null;
  }, [availableCommesse, filterCommessa]);

  // Click outside per chiudere il menu commesse
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        commessaFilterDropdownRef.current &&
        !commessaFilterDropdownRef.current.contains(event.target as Node)
      ) {
        setIsCommessaFilterOpen(false);
      }
    }
    if (isCommessaFilterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isCommessaFilterOpen]);

  // Chiudi menu commesse se si cambia vista o tab
  useEffect(() => {
    setIsCommessaFilterOpen(false);
  }, [viewMode, activeTab]);

  // Filtraggio ToDo per Vista Lista
  const filteredTodos = useMemo(() => {
    return todos.filter(t => {
      // 1. Filtro Assegnazione
      if (filterAssignee === 'mine') {
        if (!isTaskAssignee(t, myAssociatedName)) return false;
      } else if (filterAssignee === 'assigned_by_me') {
        if (!isTaskCreator(t, myAssociatedName, userEmail)) return false;
      }

      // 2. Filtro Stato
      if (filterStatus !== 'all' && t.stato !== filterStatus) {
        return false;
      }

      // 3. Filtro Categoria
      if (filterCategory !== 'all' && t.categoria !== filterCategory) {
        return false;
      }

      // 4. Filtro Commessa
      if (filterCommessa === 'generic_only') {
        if (t.tipo !== 'generico') return false;
      } else if (filterCommessa !== 'all') {
        if (t.commessaId !== filterCommessa) return false;
      }

      return true;
    });
  }, [todos, filterAssignee, filterStatus, filterCategory, filterCommessa, myAssociatedName, userEmail]);

  // Apertura modale nuovo task
  const handleOpenNewTaskModal = (defaultDate?: string) => {
    setEditingTask(null);
    setTaskDefaultDate(defaultDate || '');
    setIsTaskModalOpen(true);
  };

  // Apertura modale modifica task
  const handleOpenEditTaskModal = (task: UnifiedTodoItem) => {
    if (!canUserManageTask(task, myAssociatedName, userEmail, commesse)) {
      showToast("Non puoi modificare questa attività perché è stata creata da un altro collega.", "warning");
      return;
    }
    setEditingTask(task);
    setTaskDefaultDate('');
    setIsTaskModalOpen(true);
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
  const handleDeleteTask = (task: UnifiedTodoItem) => {
    if (!canUserManageTask(task, myAssociatedName, userEmail, commesse)) {
      showToast("Non puoi eliminare questa attività perché è stata creata da un altro collega.", "warning");
      return;
    }

    setConfirmConfig({
      isOpen: true,
      title: "Elimina Attività",
      message: `Sei sicuro di voler eliminare l'attività "${task.titolo}"? L'operazione non può essere annullata.`,
      confirmText: "Elimina",
      cancelText: "Annulla",
      type: "danger",
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
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
      }
    });
  };

  // ==========================================
  // NOTE PERSONALI
  // ==========================================

  // Gestori Allegato Nota Personale (File / Cartella)
  const handlePickNoteAttachment = (mode: 'file' | 'folder') => {
    setIsPickingNoteAttachment(true);
    showToast(mode === 'folder' ? "📁 Seleziona la cartella nella finestra di Windows (\\srvapp\\home)..." : "📄 Seleziona il file nella finestra di Windows (\\srvapp\\home)...", "info");
    triggerNativePicker(mode, (path) => {
      const parsed = parseAttachmentPath(path, mode === 'folder' ? 'cartella' : undefined);
      if (parsed) {
        if (!parsed.isCondiviso) {
          showToast("⚠️ Il percorso si trova su un disco locale (C:\\) e non sul server. Seleziona file o cartelle su \\\\srvapp\\home", "warning");
          setIsPickingNoteAttachment(false);
          return;
        }
        setNoteAllegati(prev => {
          const exists = prev.some(a => a.percorso.toLowerCase() === parsed.percorso.toLowerCase());
          if (exists) {
            showToast("Elemento già presente nell'elenco.", "warning");
            return prev;
          }
          const newAtt: TodoAttachment = {
            id: `att_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            percorso: parsed.percorso,
            nome: parsed.nome,
            tipo: parsed.tipo,
            estensione: parsed.estensione
          };
          showToast(`Aggiunto alla nota: ${parsed.nome}`, "success");
          return [...prev, newAtt];
        });
      }
      setIsPickingNoteAttachment(false);
    });
  };

  const handleAddManualNoteAttachment = () => {
    const raw = noteInputPercorso.trim();
    if (!raw) return;
    const parsed = parseAttachmentPath(raw);
    if (!parsed) {
      showToast("Percorso non valido.", "warning");
      return;
    }
    if (!parsed.isCondiviso) {
      showToast("⚠️ Il percorso risiede su un disco locale (C:\\). I collegamenti devono trovarsi sul server (\\\\srvapp\\home).", "warning");
      return;
    }
    setNoteAllegati(prev => {
      const exists = prev.some(a => a.percorso.toLowerCase() === parsed.percorso.toLowerCase());
      if (exists) {
        showToast("Elemento già presente nell'elenco.", "warning");
        return prev;
      }
      const newAtt: TodoAttachment = {
        id: `att_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        percorso: parsed.percorso,
        nome: parsed.nome,
        tipo: parsed.tipo,
        estensione: parsed.estensione
      };
      showToast(`Aggiunto alla nota: ${parsed.nome}`, "success");
      return [...prev, newAtt];
    });
    setNoteInputPercorso('');
  };

  const handleRemoveNoteAttachment = (id: string) => {
    setNoteAllegati(prev => prev.filter(a => a.id !== id));
  };

  const handleOpenNewNoteModal = () => {
    setEditingNote(null);
    setNoteTitolo('');
    setNoteContenuto('');
    setNoteColore('giallo');
    setNoteFissata(false);
    setNoteAllegati([]);
    setNoteInputPercorso('');
    setIsPickingNoteAttachment(false);
    setIsNoteModalOpen(true);
  };

  const handleOpenEditNoteModal = (note: NotaPersonale) => {
    setEditingNote(note);
    setNoteTitolo(note.titolo);
    setNoteContenuto(note.contenuto);
    setNoteColore(note.colore || 'giallo');
    setNoteFissata(!!note.fissata);
    setNoteAllegati(getTodoAttachments(note));
    setNoteInputPercorso('');
    setIsPickingNoteAttachment(false);
    setIsNoteModalOpen(true);
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitolo.trim() && !noteContenuto.trim() && noteAllegati.length === 0) {
      showToast("Inserisci un titolo, del testo o collega un file/cartella alla nota.", "warning");
      return;
    }
    const hasLocal = noteAllegati.some(a => !isSharedNetworkPath(a.percorso));
    if (hasLocal) {
      showToast("⚠️ I file o le cartelle collegate devono risiedere sul server aziendale (\\\\srvapp\\home) e non su un disco locale (C:\\).", "warning");
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
          fissata: noteFissata,
          allegati: noteAllegati
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

  const handleDeleteNote = (noteId: string) => {
    setConfirmConfig({
      isOpen: true,
      title: "Elimina Nota Personale",
      message: "Sei sicuro di voler eliminare questa nota personale? L'operazione non può essere annullata.",
      confirmText: "Elimina",
      cancelText: "Annulla",
      type: "danger",
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        setNotes(prev => prev.filter(n => n.id !== noteId));
        try {
          await deletePersonalNote(noteId);
          showToast("Nota eliminata.", "success");
        } catch (err) {
          console.error("Errore cancellazione nota:", err);
          showToast("Errore durante l'eliminazione della nota.", "error");
          loadData();
        }
      }
    });
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
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-gray-100">
                  {/* 1. Filtro Assegnazione */}
                  <select
                    value={filterAssignee}
                    onChange={e => setFilterAssignee(e.target.value as any)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300 cursor-pointer"
                  >
                    <option value="all">Tutte le risorse</option>
                    <option value="mine">Assegnate a me</option>
                    <option value="assigned_by_me">Assegnate da me</option>
                  </select>

                  {/* 2. Filtro Stato */}
                  <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300 cursor-pointer"
                  >
                    <option value="da_fare">Da fare (Aperte)</option>
                    <option value="completato">Completate</option>
                    <option value="all">Tutti gli stati</option>
                  </select>

                  {/* 3. Filtro Categoria */}
                  <select
                    value={filterCategory}
                    onChange={e => setFilterCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300 cursor-pointer"
                  >
                    <option value="all">Tutte le categorie</option>
                    {TODO_CATEGORIE.map(cat => (
                      <option key={cat} value={cat}>{cat.toUpperCase()}</option>
                    ))}
                  </select>

                  {/* 4. Filtro Commessa / Generico con Ricerca Integrata */}
                  <div className="relative" ref={commessaFilterDropdownRef}>
                    <button
                      type="button"
                      title={
                        selectedFilterCommessaObj
                          ? `${selectedFilterCommessaObj.codiceCommessa ? `[${selectedFilterCommessaObj.codiceCommessa}] ` : ''}${selectedFilterCommessaObj.nome}${selectedFilterCommessaObj.cliente ? ` (Cliente: ${selectedFilterCommessaObj.cliente})` : ''}`
                          : filterCommessa === 'generic_only'
                            ? 'Solo Attività Generiche'
                            : 'Tutte le commesse e generici'
                      }
                      onClick={() => {
                        setIsCommessaFilterOpen(prev => !prev);
                        if (!isCommessaFilterOpen) {
                          setCommessaFilterSearch('');
                        }
                      }}
                      className={`w-full px-3 py-2 bg-gray-50 border ${
                        isCommessaFilterOpen
                          ? 'border-indigo-400 ring-2 ring-indigo-200 bg-white'
                          : filterCommessa !== 'all'
                            ? 'border-indigo-300 bg-indigo-50/50 text-indigo-900'
                            : 'border-gray-200 hover:border-gray-300'
                      } rounded-xl text-xs font-bold text-gray-800 outline-none flex items-center justify-between transition cursor-pointer text-left`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
                        {selectedFilterCommessaObj ? (
                          <>
                            <Briefcase className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="truncate">
                              {selectedFilterCommessaObj.codiceCommessa ? (
                                <span className="font-mono text-indigo-600 mr-1 font-extrabold">
                                  [{selectedFilterCommessaObj.codiceCommessa}]
                                </span>
                              ) : null}
                              {selectedFilterCommessaObj.nome}
                            </span>
                          </>
                        ) : filterCommessa === 'generic_only' ? (
                          <>
                            <Tag className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            <span className="truncate text-indigo-900">Solo Attività Generiche</span>
                          </>
                        ) : (
                          <span className="truncate text-gray-700">Tutte le commesse e generici</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {filterCommessa !== 'all' && (
                          <span
                            role="button"
                            title="Azzera filtro commessa"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilterCommessa('all');
                              setCommessaFilterSearch('');
                            }}
                            className="text-gray-400 hover:text-gray-600 p-0.5 rounded hover:bg-gray-200/60 transition cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </span>
                        )}
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                            isCommessaFilterOpen ? 'rotate-180 text-indigo-600' : ''
                          }`}
                        />
                      </div>
                    </button>

                    {/* Menu a Tendina Dropdown */}
                    {isCommessaFilterOpen && (
                      <div className="absolute right-0 left-0 sm:left-auto sm:w-84 md:w-96 top-full mt-1.5 bg-white border border-indigo-200 rounded-2xl shadow-2xl z-50 p-2.5 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
                        {/* Campo di Ricerca */}
                        <div className="relative shrink-0">
                          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Cerca per codice, nome o cliente..."
                            value={commessaFilterSearch}
                            onChange={e => setCommessaFilterSearch(e.target.value)}
                            autoFocus
                            className="w-full pl-8.5 pr-7 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 placeholder-gray-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                          />
                          {commessaFilterSearch && (
                            <button
                              type="button"
                              onClick={() => setCommessaFilterSearch('')}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Lista Opzioni */}
                        <div className="max-h-60 overflow-y-auto custom-scrollbar divide-y divide-gray-100 flex flex-col">
                          {/* Opzione 1: Tutte le commesse e generici */}
                          <button
                            type="button"
                            onClick={() => {
                              setFilterCommessa('all');
                              setIsCommessaFilterOpen(false);
                              setCommessaFilterSearch('');
                            }}
                            className={`px-3 py-2 text-left text-xs rounded-xl flex items-center justify-between transition cursor-pointer ${
                              filterCommessa === 'all'
                                ? 'bg-indigo-50/80 text-indigo-900 font-bold'
                                : 'hover:bg-gray-50 text-gray-700 font-medium'
                            }`}
                          >
                            <span>Tutte le commesse e generici</span>
                            {filterCommessa === 'all' && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                          </button>

                          {/* Opzione 2: Solo Attività Generiche */}
                          <button
                            type="button"
                            onClick={() => {
                              setFilterCommessa('generic_only');
                              setIsCommessaFilterOpen(false);
                              setCommessaFilterSearch('');
                            }}
                            className={`px-3 py-2 text-left text-xs rounded-xl flex items-center justify-between transition cursor-pointer ${
                              filterCommessa === 'generic_only'
                                ? 'bg-indigo-50/80 text-indigo-900 font-bold'
                                : 'hover:bg-gray-50 text-gray-700 font-medium'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <Tag className="w-3 h-3 text-indigo-500 shrink-0" />
                              <span>Solo Attività Generiche</span>
                            </div>
                            {filterCommessa === 'generic_only' && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                          </button>

                          {/* Elenco Commesse Filtrate */}
                          {filteredCommesseForFilter.length === 0 ? (
                            <div className="p-3 text-center text-xs text-gray-400 italic">
                              Nessuna commessa trovata{commessaFilterSearch ? ` per "${commessaFilterSearch}"` : ''}
                            </div>
                          ) : (
                            filteredCommesseForFilter.map(c => {
                              const isSelected = filterCommessa === c.id;
                              const fullText = `${c.codiceCommessa ? `[${c.codiceCommessa}] ` : ''}${c.nome}${c.cliente ? ` — Cliente: ${c.cliente}` : ''}`;
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  title={fullText}
                                  onClick={() => {
                                    setFilterCommessa(c.id);
                                    setIsCommessaFilterOpen(false);
                                    setCommessaFilterSearch('');
                                  }}
                                  className={`px-3 py-2 text-left text-xs rounded-xl flex items-center justify-between gap-2 transition cursor-pointer ${
                                    isSelected ? 'bg-indigo-50/80 text-indigo-900 font-bold' : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      {c.codiceCommessa && (
                                        <span className="font-mono text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold shrink-0">
                                          {c.codiceCommessa}
                                        </span>
                                      )}
                                      <span className="truncate font-semibold">{c.nome}</span>
                                    </div>
                                    {c.cliente && (
                                      <div className="text-[10px] text-gray-400 truncate mt-0.5">
                                        Cliente: {c.cliente}
                                      </div>
                                    )}
                                  </div>
                                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Opzione Storico Completati > 30gg per sole attività generiche */}
                {filterStatus !== 'da_fare' && (
                  <div className="flex items-center gap-2 pt-2 px-1 text-xs text-gray-600 border-t border-gray-100/60 mt-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showOlderCompleted}
                        onChange={e => setShowOlderCompleted(e.target.checked)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="font-bold text-gray-700">
                        Includi attività generiche completate oltre 30 giorni fa
                      </span>
                    </label>
                    <span className="text-[11px] text-gray-400 hidden sm:inline">
                      (le attività delle commesse aperte rimangono sempre visibili fino alla chiusura)
                    </span>
                  </div>
                )}
              </>
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
                  <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
                    <button
                      type="button"
                      onClick={() => handleOpenNewTaskModal()}
                      className="inline-flex items-center gap-1.5 bg-indigo-600 text-white font-bold text-xs px-4 py-2 rounded-xl hover:bg-indigo-700 transition"
                    >
                      <Plus className="w-3.5 h-3.5" /> Aggiungi Attività
                    </button>
                    {!showOlderCompleted && filterStatus !== 'da_fare' && (
                      <button
                        type="button"
                        onClick={() => setShowOlderCompleted(true)}
                        className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
                      >
                        <Archive className="w-3.5 h-3.5" /> Mostra attività generiche completate più vecchie di 30 giorni
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
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
                              {/* Riconoscimento a colpo d'occhio: Assegnato a te */}
                              {isAssignedToMe && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-300 shadow-2xs">
                                  <User className="w-3 h-3 text-indigo-600" />
                                  <span>Assegnato a te</span>
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

                            {/* Allegati File / Cartella */}
                            {getTodoAttachments(task).length > 0 && (
                              <div className="pt-1 flex flex-wrap gap-2">
                                {getTodoAttachments(task).map(att => (
                                  <AttachmentBadge
                                    key={att.id}
                                    percorso={att.percorso}
                                    nome={att.nome}
                                    tipo={att.tipo}
                                    estensione={att.estensione}
                                  />
                                ))}
                              </div>
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

                {/* Pulsante rapido a fondo lista per caricare completati > 30gg */}
                {!showOlderCompleted && filterStatus !== 'da_fare' && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setShowOlderCompleted(true)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition cursor-pointer shadow-2xs"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      Mostra anche le attività generiche completate più vecchie di 30 giorni
                    </button>
                  </div>
                )}
              </>
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

                <div className="flex items-center gap-2.5">
                  {/* Legenda rapida visuale */}
                  <div className="hidden md:flex items-center gap-3 text-[11px] font-semibold text-gray-500 mr-2 bg-white px-3 py-1.5 rounded-xl border border-gray-200/80 shadow-2xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-indigo-100 border border-indigo-400 border-l-[3px] border-l-indigo-600"></span>
                      <span className="text-indigo-900 font-bold">Assegnate a te</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-slate-100 border border-slate-300 border-l-[3px] border-l-slate-400"></span>
                      <span>Colleghi</span>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCalDate(new Date())}
                    className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-xl transition border border-indigo-100 cursor-pointer"
                  >
                    Oggi
                  </button>
                </div>
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
                          const isAssignedToMe = isTaskAssignee(t, myAssociatedName);

                          let pillStyle = '';
                          if (isDone) {
                            pillStyle = isAssignedToMe
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 border-l-[3px] border-l-emerald-600 line-through opacity-75'
                              : 'bg-gray-50 text-gray-400 border-gray-200 border-l-[3px] border-l-gray-300 line-through opacity-60';
                          } else if (isOverdue) {
                            pillStyle = isAssignedToMe
                              ? 'bg-red-50 text-red-950 border-red-300 border-l-[3px] border-l-red-600 font-black shadow-2xs'
                              : 'bg-red-50/50 text-red-700 border-red-200 border-l-[3px] border-l-red-300 font-medium';
                          } else {
                            pillStyle = isAssignedToMe
                              ? 'bg-indigo-50/95 text-indigo-950 border-indigo-300 border-l-[3px] border-l-indigo-600 font-black shadow-2xs hover:bg-indigo-100/90'
                              : 'bg-slate-50/80 text-slate-600 border-slate-200 border-l-[3px] border-l-slate-300 font-medium hover:bg-slate-100';
                          }

                          return (
                            <div
                              key={t.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectCalDay(cell.dateStr);
                              }}
                              className={`text-[10px] p-1 px-1.5 rounded-md cursor-pointer truncate border transition-all flex items-center gap-1 ${pillStyle}`}
                              title={`${t.titolo} — ${isAssignedToMe ? '👤 Assegnata a TE' : `Assegnata a: ${t.assegnatoA || 'Non specificato'}`}${t.scadenza ? ` (Scadenza: ${t.scadenza.split('-').reverse().join('/')})` : ''} — Clicca per visualizzare sotto`}
                            >
                              <span className="shrink-0">
                                {isDone ? (
                                  <Check className="w-2.5 h-2.5 text-emerald-600 stroke-[3]" />
                                ) : isAssignedToMe ? (
                                  <User className="w-2.5 h-2.5 text-indigo-600 shrink-0" />
                                ) : (
                                  <span className="text-slate-400 font-black leading-none">•</span>
                                )}
                              </span>
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
                                  {/* Riconoscimento a colpo d'occhio: Assegnato a te */}
                                  {isAssignedToMe && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-300 shadow-2xs">
                                      <User className="w-3 h-3 text-indigo-600" />
                                      <span>Assegnato a te</span>
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

                                {/* Allegati File / Cartella */}
                                {getTodoAttachments(task).length > 0 && (
                                  <div className="pt-1 flex flex-wrap gap-2">
                                    {getTodoAttachments(task).map(att => (
                                      <AttachmentBadge
                                        key={att.id}
                                        percorso={att.percorso}
                                        nome={att.nome}
                                        tipo={att.tipo}
                                        estensione={att.estensione}
                                      />
                                    ))}
                                  </div>
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

                      {/* Allegati File / Cartella */}
                      {getTodoAttachments(note).length > 0 && (
                        <div className="pt-2 flex flex-wrap gap-1.5">
                          {getTodoAttachments(note).map(att => (
                            <AttachmentBadge
                              key={att.id}
                              percorso={att.percorso}
                              nome={att.nome}
                              tipo={att.tipo}
                              estensione={att.estensione}
                            />
                          ))}
                        </div>
                      )}
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
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setEditingTask(null);
        }}
        editingTask={editingTask}
        defaultDate={taskDefaultDate}
        onTaskSaved={(saved) => {
          const todayIsoStr = new Date().toISOString().split('T')[0];
          if (saved.stato === 'completato' || !saved.scadenza || saved.scadenza >= todayIsoStr) {
            markOverdueNotificationsAsReadForTask(saved.id, saved.titolo);
          }
          setTodos(prev => {
            if (editingTask) {
              return prev.map(t => t.id === saved.id ? saved : t);
            } else {
              return [saved, ...prev];
            }
          });
          showToast(editingTask ? "Attività aggiornata con successo!" : "Nuova attività registrata!", "success");
        }}
      />

      {/* ========================================================================= */}
      {/* MODALE NUOVA / MODIFICA NOTA PERSONALE */}
      {/* ========================================================================= */}
      {isNoteModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
          <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col overflow-hidden">
            {/* Header Fisso */}
            <div className="px-6 py-4 sm:px-8 sm:py-5 border-b border-gray-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
                  <StickyNote className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900 leading-tight">
                    {editingNote ? 'Modifica Nota Personale' : 'Nuova Nota Personale'}
                  </h3>
                  <p className="text-xs text-gray-400 font-medium">
                    {editingNote ? 'Aggiorna i tuoi appunti o promemoria personali' : 'Crea un nuovo appunto o promemoria personale'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNoteModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNote} className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Contenuto Scrollabile Internamente */}
              <div className="p-6 sm:p-8 overflow-y-auto custom-scrollbar flex-1 space-y-4">
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

                {/* Collegamento a File o Cartelle (Server) */}
                <div className="bg-amber-50/60 p-3.5 rounded-2xl border border-amber-200/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5 text-amber-600" />
                      <span>File o Cartelle Collegate (Opzionale)</span>
                      {noteAllegati.length > 0 && (
                        <span className="text-[10px] font-extrabold bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-full">
                          {noteAllegati.length}
                        </span>
                      )}
                    </label>
                    {noteAllegati.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setNoteAllegati([])}
                        className="text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
                      >
                        Rimuovi tutti
                      </button>
                    )}
                  </div>

                  {/* Lista degli elementi collegati (se presenti) */}
                  {noteAllegati.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                      {noteAllegati.map(att => (
                        <div
                          key={att.id}
                          className="flex items-center justify-between gap-2 p-2 bg-white rounded-xl border border-amber-200 shadow-2xs group"
                        >
                          <AttachmentBadge
                            percorso={att.percorso}
                            nome={att.nome}
                            tipo={att.tipo}
                            estensione={att.estensione}
                            clickable={true}
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openAttachedPath(att.percorso)}
                              className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-[11px] rounded-md transition cursor-pointer flex items-center gap-1"
                              title="Verifica apertura in Windows"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Apri</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveNoteAttachment(att.id)}
                              className="p-1 hover:text-rose-600 text-gray-400 hover:bg-rose-50 rounded-md transition cursor-pointer"
                              title="Rimuovi questo collegamento"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Controlli per aggiungere altri file / cartelle */}
                  <div className="space-y-2 pt-0.5">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handlePickNoteAttachment('file')}
                        className="h-9 flex items-center justify-center gap-1.5 px-3 bg-white hover:bg-amber-100/80 text-amber-900 border border-amber-200 hover:border-amber-300 rounded-xl text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer whitespace-nowrap"
                        title="Sfoglia file sul server aziendale (\\srvapp\home)"
                      >
                        <File className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>{noteAllegati.length > 0 ? '+ Altro File...' : 'Sfoglia File...'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePickNoteAttachment('folder')}
                        className="h-9 flex items-center justify-center gap-1.5 px-3 bg-white hover:bg-amber-100/80 text-amber-900 border border-amber-200 hover:border-amber-300 rounded-xl text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer whitespace-nowrap"
                        title="Sfoglia cartelle sul server aziendale (\\srvapp\home)"
                      >
                        <FolderOpen className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>{noteAllegati.length > 0 ? '+ Altra Cartella...' : 'Sfoglia Cartella...'}</span>
                      </button>
                    </div>

                    {isPickingNoteAttachment && (
                      <div className="flex items-center gap-2 text-xs font-bold text-amber-800 bg-amber-100/70 p-2 rounded-xl border border-amber-200 animate-pulse">
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span>Finestra aperta in Windows... Seleziona l'elemento e tornerai qui automaticamente!</span>
                      </div>
                    )}

                    {/* Barra inserimento manuale percorso */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={noteInputPercorso}
                        onChange={e => setNoteInputPercorso(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddManualNoteAttachment();
                          }
                        }}
                        placeholder="Oppure incolla percorso server (es. \\srvapp\home\...)"
                        className="flex-1 px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-mono text-gray-700 placeholder-gray-400 outline-none focus:ring-1 focus:ring-amber-400"
                      />
                      <button
                        type="button"
                        onClick={handleAddManualNoteAttachment}
                        disabled={!noteInputPercorso.trim()}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition shrink-0 cursor-pointer shadow-2xs"
                      >
                        Aggiungi
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Fisso con Bottoni Azione */}
              <div className="px-6 py-4 sm:px-8 sm:py-4 border-t border-gray-100 flex justify-end items-center gap-3 shrink-0 bg-gray-50/80">
                <button
                  type="button"
                  onClick={() => setIsNoteModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl font-bold text-xs text-gray-600 hover:bg-gray-200/70 transition cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isSavingNote}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-xs transition shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {isSavingNote ? 'Salvataggio...' : editingNote ? 'Salva Modifiche' : 'Crea Nota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale di Conferma Moderno */}
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmText={confirmConfig.confirmText}
        cancelText={confirmConfig.cancelText}
        type={confirmConfig.type || 'danger'}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />

    </div>
  );
}

