import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth, type PunchListItem } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
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
  Loader2,
  GripVertical,
  Layers,
  Maximize2
} from 'lucide-react';
import { 
  type UnifiedTodoItem, 
  type NotaPersonale, 
  type TodoAttachment,
  TODO_CATEGORIE, 
  fetchUnifiedTodos, 
  getCachedUnifiedTodos,
  invalidateGenericTodosCache,
  toggleUnifiedTodoStatus, 
  deleteUnifiedTodo, 
  fetchPersonalNotes, 
  getCachedPersonalNotes,
  savePersonalNote, 
  deletePersonalNote,
  reorderPersonalNotes,
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
  getTodoAttachments,
  getPriorityScore,
  formatCommessaDisplay
} from '../services/todoService';


import TaskModal from '../components/TaskModal';
import AttachmentBadge from '../components/AttachmentBadge';
import { markNotificationsAsReadByFilter, markOverdueNotificationsAsReadForTask } from '../utils/userNotificationService';

export const TODO_PRIORITA_CONFIG: Record<'Alta' | 'Standard' | 'Bassa', { bg: string; text: string; border: string; label: string; badge: string }> = {
  Alta: { 
    bg: 'bg-rose-600', 
    text: 'text-white', 
    border: 'border-rose-600', 
    label: 'Alta',
    badge: 'bg-rose-600 text-white font-black shadow-xs tracking-wider border-transparent'
  },
  Standard: { 
    bg: 'bg-indigo-50', 
    text: 'text-indigo-700', 
    border: 'border-indigo-200', 
    label: 'Standard',
    badge: 'bg-indigo-50 text-indigo-700 border border-indigo-200/80 font-bold'
  },
  Bassa: { 
    bg: 'bg-sky-50', 
    text: 'text-sky-700', 
    border: 'border-sky-200', 
    label: 'Bassa',
    badge: 'bg-sky-50 text-sky-700 border border-sky-200/80 font-bold'
  },
};

export const getTaskCardClasses = (
  task: { stato?: string; scadenza?: string; priorita?: 'Alta' | 'Standard' | 'Bassa' },
  isAssignedToMe: boolean,
  todayIso: string,
  isHighlighted: boolean = false
): string => {
  const isDone = task.stato === 'completato';
  const isOverdue = !isDone && Boolean(task.scadenza && task.scadenza < todayIso);
  const isToday = !isDone && Boolean(task.scadenza && task.scadenza === todayIso);
  const prio = task.priorita || 'Standard';

  const highlightClass = isHighlighted ? 'ring-4 ring-indigo-400 bg-indigo-50/70 shadow-lg' : '';

  if (isDone) {
    return `opacity-70 bg-gray-50/70 border-gray-200 border-l-4 border-l-gray-300 ${highlightClass}`;
  }

  if (prio === 'Alta') {
    if (isOverdue) {
      return `border-red-400 bg-red-50/30 border-l-[6px] border-l-rose-700 shadow-xs ${highlightClass}`;
    }
    if (isToday) {
      return `border-rose-300 bg-gradient-to-r from-rose-50/70 via-amber-50/20 to-white border-l-[6px] border-l-rose-600 shadow-xs ${highlightClass}`;
    }
    return `border-rose-200/90 bg-gradient-to-r from-rose-50/40 via-white to-white border-l-[5px] border-l-rose-600 hover:border-rose-300 shadow-xs ${highlightClass}`;
  }

  if (prio === 'Bassa') {
    if (isOverdue) {
      return `border-red-300 bg-red-50/20 border-l-4 border-l-red-500 shadow-xs ${highlightClass}`;
    }
    if (isToday) {
      return `border-amber-300 bg-amber-50/20 border-l-4 border-l-amber-500 shadow-xs ${highlightClass}`;
    }
    if (isAssignedToMe) {
      return `border-sky-200/90 bg-gradient-to-r from-sky-50/40 via-white to-white border-l-4 border-l-sky-500 hover:border-sky-300 shadow-xs ${highlightClass}`;
    }
    return `border-slate-200/80 bg-slate-50/40 border-l-4 border-l-slate-300 text-slate-700 hover:border-slate-300 shadow-xs ${highlightClass}`;
  }


  // Priorità Standard
  if (isAssignedToMe) {
    if (isOverdue) {
      return `border-red-300 bg-red-50/20 border-l-4 border-l-red-500 shadow-xs ${highlightClass}`;
    }
    if (isToday) {
      return `border-amber-300 bg-amber-50/20 border-l-4 border-l-amber-500 shadow-xs ${highlightClass}`;
    }
    return `border-indigo-100 bg-white border-l-4 border-l-indigo-600 hover:border-indigo-300 shadow-xs ${highlightClass}`;
  }

  return `bg-slate-50/60 border-slate-200 border-l-4 border-l-slate-300 text-slate-700 ${highlightClass}`;
};

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
  const { userEmail, myAssociatedName, dipendenti, commesse, assegnazioni, isAdmin, loadPlanningData, isPlanningLoaded, updateCommessaPunchList, refreshCommesse } = useAuth();
  const { userNotifications } = useNotifications();
  const location = useLocation();
  const userIsSoci = isSoci(myAssociatedName);

  // Tab di navigazione principale: 'todo' o 'note'
  const [activeTab, setActiveTab] = useState<'todo' | 'note'>('todo');

  // Task evidenziato (es. da clic su notifica)
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

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
  const [filterPriority, setFilterPriority] = useState<'all' | 'Alta' | 'Standard' | 'Bassa'>('all');
  const [filterDeadline, setFilterDeadline] = useState<'all' | 'scadute' | 'oggi' | 'settimana' | 'prossime' | 'senza_data'>('all');
  const [sortBy, setSortBy] = useState<'scadenza' | 'priorita' | 'creazione'>('scadenza');

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
  const [noteAllegati, setNoteAllegati] = useState<TodoAttachment[]>([]);
  const [noteInputPercorso, setNoteInputPercorso] = useState<string>('');
  const [isPickingNoteAttachment, setIsPickingNoteAttachment] = useState<boolean>(false);
  const [noteSearch, setNoteSearch] = useState<string>('');
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);

  // Stati Drag & Drop e Focus View Note Personali
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [isDraggingStack, setIsDraggingStack] = useState<boolean>(false);
  const [dragOverTarget, setDragOverTarget] = useState<{ id: string; action: 'reorder-before' | 'reorder-after' | 'stack'; slotIndex?: number; stackSlotIndex?: number; stackTargetNoteId?: string; stackPosition?: 'before' | 'after'; isStackEnd?: boolean; pilaId?: string } | null>(null);
  const [focusedNote, setFocusedNote] = useState<NotaPersonale | null>(null);
  const isDraggingRef = useRef<boolean>(false);


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

  const loadData = useCallback(async (showSpinner = false, forceRefresh = false) => {
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
          forceRefresh,
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
    refreshCommesse?.();
  }, [loadPlanningData, refreshCommesse]);

  // Listener real-time per nuove notifiche ToDo in arrivo mentre l'utente è già nella schermata
  const lastHandledNotifIdRef = useRef<string>('');
  useEffect(() => {
    if (!userNotifications || userNotifications.length === 0) return;
    const latestTodoNotif = userNotifications.find(n => 
      (n.tipo === 'todo_assegnato' || n.tipo === 'todo_completato') && !n.letta
    );
    if (latestTodoNotif && latestTodoNotif.id && latestTodoNotif.id !== lastHandledNotifIdRef.current) {
      lastHandledNotifIdRef.current = latestTodoNotif.id;
      // Una nuova notifica ToDo è appena arrivata: sincronizza commesse e ricarica i compiti senza bisogno di F5
      (async () => {
        if (refreshCommesse) await refreshCommesse();
        invalidateGenericTodosCache(true);
        await loadData(false, true);
        showToast(`🔔 ${latestTodoNotif.titolo}: ${latestTodoNotif.messaggio}`, "info");
      })();
    }
  }, [userNotifications, refreshCommesse, loadData]);

  // Pulizia notifiche ToDo all'ingresso nella sezione ToDo List (escluse quelle di scadenza che restano attive finché non risolte)
  useEffect(() => {
    if (userEmail) {
      markNotificationsAsReadByFilter(userEmail, { tipo: 'todo_assegnato' });
      markNotificationsAsReadByFilter(userEmail, { tipo: 'todo_completato' });
      // NOTA: 'todo_scaduto' NON viene marcato come letto all'ingresso!
      // Rimane attivo finché l'attività non viene contrassegnata come completata
      // o la sua data di scadenza non viene spostata più in avanti.
    }
  }, [userEmail]);

  // Gestione parametri URL (arrivo da clic su notifica o link diretto con taskId / notifTime)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const commessaIdParam = params.get('commessaId');
    const taskIdParam = params.get('taskId');
    const notifTimeParam = params.get('notifTime');

    if (commessaIdParam) {
      setFilterCommessa(commessaIdParam);
    }

    if (taskIdParam || notifTimeParam) {
      // Se si arriva da una notifica (click o deep-link), forza il refresh immediato dei dati da Firestore
      (async () => {
        if (refreshCommesse) await refreshCommesse();
        invalidateGenericTodosCache(true);
        await loadData(false, true);
      })();

      if (taskIdParam) {
        setFilterStatus('da_fare');
        setFilterAssignee('all');
        setHighlightedTaskId(taskIdParam);

        setTimeout(() => {
          const el = document.getElementById(`task-card-${taskIdParam}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 400);

        const timer = setTimeout(() => {
          setHighlightedTaskId(null);
        }, 4500);
        return () => clearTimeout(timer);
      }
    }
  }, [location.search, refreshCommesse, loadData]);

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

  // Fine settimana corrente (Domenica) in formato YYYY-MM-DD
  const endOfWeekIso = useMemo(() => {
    const d = new Date();
    const day = d.getDay(); // 0 è Domenica, 1 Lunedì, ..., 6 Sabato
    const diff = day === 0 ? 0 : 7 - day;
    const sunday = new Date(d);
    sunday.setDate(d.getDate() + diff);
    return `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
  }, []);

  // Fine delle prossime 4 settimane (Domenica della 4ª settimana a partire da quella corrente) in formato YYYY-MM-DD
  const endOf4WeeksIso = useMemo(() => {
    const d = new Date();
    const day = d.getDay(); // 0 è Domenica, 1 Lunedì, ..., 6 Sabato
    const diffToSunday = day === 0 ? 0 : 7 - day;
    const sunday4th = new Date(d);
    sunday4th.setDate(d.getDate() + diffToSunday + 21); // Domenica corrente + 3 settimane successive = 4 settimane totali
    return `${sunday4th.getFullYear()}-${String(sunday4th.getMonth() + 1).padStart(2, '0')}-${String(sunday4th.getDate()).padStart(2, '0')}`;
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

  // Conteggio dinamico delle scadenze per i chip rapidi
  const deadlineCounts = useMemo(() => {
    const base = todos.filter(t => {
      if (filterAssignee === 'mine' && !isTaskAssignee(t, myAssociatedName)) return false;
      if (filterAssignee === 'assigned_by_me' && !isTaskCreator(t, myAssociatedName, userEmail)) return false;
      if (filterStatus !== 'all' && t.stato !== filterStatus) return false;
      if (filterCategory !== 'all' && t.categoria !== filterCategory) return false;
      if (filterPriority !== 'all' && (t.priorita || 'Standard') !== filterPriority) return false;
      if (filterCommessa === 'generic_only' && t.tipo !== 'generico') return false;
      if (filterCommessa !== 'all' && filterCommessa !== 'generic_only' && t.commessaId !== filterCommessa) return false;
      return true;
    });

    let scadute = 0;
    let oggi = 0;
    let settimana = 0;
    let prossime = 0;
    let senzaData = 0;

    base.forEach(t => {
      if (t.stato === 'completato') return;
      if (!t.scadenza) {
        senzaData++;
        return;
      }
      if (t.scadenza < todayIso) {
        scadute++;
      } else {
        if (t.scadenza === todayIso) {
          oggi++;
        }
        if (t.scadenza <= endOfWeekIso) {
          settimana++;
        }
        // Prossime 4 settimane (compresa quella corrente, fino alla fine della 4ª settimana)
        if (t.scadenza <= endOf4WeeksIso) {
          prossime++;
        }
      }
    });

    return {
      all: base.length,
      scadute,
      oggi,
      settimana,
      prossime,
      senzaData
    };
  }, [todos, filterAssignee, filterStatus, filterCategory, filterPriority, filterCommessa, myAssociatedName, userEmail, todayIso, endOfWeekIso, endOf4WeeksIso]);

  // Filtraggio e Ordinamento Dinamico ToDo per Vista Lista
  const filteredTodos = useMemo(() => {
    const list = todos.filter(t => {
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

      // 5. Filtro Priorità
      if (filterPriority !== 'all') {
        const p = t.priorita || 'Standard';
        if (p !== filterPriority) return false;
      }

      // 6. Filtro Scadenza Temporale
      if (filterDeadline !== 'all') {
        if (t.stato === 'completato') return false;

        if (filterDeadline === 'senza_data') {
          if (t.scadenza) return false;
        } else if (filterDeadline === 'scadute') {
          if (!t.scadenza || t.scadenza >= todayIso) return false;
        } else if (filterDeadline === 'oggi') {
          if (!t.scadenza || t.scadenza !== todayIso) return false;
        } else if (filterDeadline === 'settimana') {
          if (!t.scadenza || t.scadenza < todayIso || t.scadenza > endOfWeekIso) return false;
        } else if (filterDeadline === 'prossime') {
          if (!t.scadenza || t.scadenza < todayIso || t.scadenza > endOf4WeeksIso) return false;
        }
      }

      return true;
    });

    // 7. Ordinamento Dinamico Rigoroso
    return list.sort((a, b) => {
      // Separazione stati: 'da_fare' sempre prima di 'completato'
      if (a.stato === 'da_fare' && b.stato === 'completato') return -1;
      if (a.stato === 'completato' && b.stato === 'da_fare') return 1;

      // Se entrambi completati: ordinamento per data di completamento decrescente
      if (a.stato === 'completato' && b.stato === 'completato') {
        const dateA = a.completatoIl || a.creatoIl || '';
        const dateB = b.completatoIl || b.creatoIl || '';
        return dateB.localeCompare(dateA);
      }

      // Entrambi 'da_fare':
      if (sortBy === 'priorita') {
        const scoreA = getPriorityScore(a.priorita);
        const scoreB = getPriorityScore(b.priorita);
        if (scoreA !== scoreB) return scoreB - scoreA; // 3 (Alta) > 2 (Standard) > 1 (Bassa)

        // A parità di priorità: prima compiti con scadenza più vicina
        if (a.scadenza && !b.scadenza) return -1;
        if (!a.scadenza && b.scadenza) return 1;
        if (a.scadenza && b.scadenza) {
          const cmp = a.scadenza.localeCompare(b.scadenza);
          if (cmp !== 0) return cmp;
        }
        return (b.creatoIl || '').localeCompare(a.creatoIl || '');
      }

      if (sortBy === 'creazione') {
        return (b.creatoIl || '').localeCompare(a.creatoIl || '');
      }

      // Predefinito: sortBy === 'scadenza'
      if (a.scadenza && !b.scadenza) return -1;
      if (!a.scadenza && b.scadenza) return 1;
      if (a.scadenza && b.scadenza) {
        const cmpDate = a.scadenza.localeCompare(b.scadenza);
        if (cmpDate !== 0) return cmpDate;
      }

      // A parità di scadenza (o entrambi senza scadenza): priorità più alta prima
      const scoreA = getPriorityScore(a.priorita);
      const scoreB = getPriorityScore(b.priorita);
      if (scoreA !== scoreB) return scoreB - scoreA;

      return (b.creatoIl || '').localeCompare(a.creatoIl || '');
    });
  }, [todos, filterAssignee, filterStatus, filterCategory, filterCommessa, filterPriority, filterDeadline, sortBy, myAssociatedName, userEmail, todayIso, endOfWeekIso, endOf4WeeksIso]);

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
        dipendenti || [],
        commesse || []
      );
      if (task.tipo === 'commessa' && task.commessaId && updateCommessaPunchList) {
        const target = commesse.find(c => c.id === task.commessaId);
        if (target && target.punchList) {
          updateCommessaPunchList(task.commessaId, [...target.punchList]);
        }
      }
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
          if (task.tipo === 'commessa' && task.commessaId && updateCommessaPunchList) {
            const target = commesse.find(c => c.id === task.commessaId);
            if (target && target.punchList) {
              updateCommessaPunchList(task.commessaId, [...target.punchList]);
            }
          }
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
          fissata: false,
          // Per le nuove note, assegna ordine = lunghezza attuale dell'array → finisce sempre in fondo
          ordine: editingNote ? editingNote.ordine : notes.length,
          allegati: noteAllegati
        },
        userEmail || ''
      );


      setNotes(prev => {
        if (editingNote) {
          return prev.map(n => n.id === saved.id ? saved : n);
        } else {
          // Nuova nota inserita in fondo (ultima posizione della griglia)
          return [...prev, saved];
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

  // ==========================================
  // LOGICA NOTE PERSONALI & PILE (STACKING)
  // ==========================================
  const filteredNotes = useMemo(() => {
    if (!noteSearch.trim()) return notes;
    const q = noteSearch.toLowerCase().trim();
    return notes.filter(n => 
      (n.titolo || '').toLowerCase().includes(q) || 
      (n.contenuto || '').toLowerCase().includes(q)
    );
  }, [notes, noteSearch]);

  // Raggruppa le note in elementi della griglia: singole o pile
  interface GridNoteItem {
    id: string; // id nota o pilaId
    isStack: boolean;
    pilaId?: string;
    notes: NotaPersonale[];
  }

  const noteGridItems = useMemo<GridNoteItem[]>(() => {
    const items: GridNoteItem[] = [];
    const stackMap = new Map<string, GridNoteItem>();

    filteredNotes.forEach(note => {
      if (note.pilaId) {
        let existingStack = stackMap.get(note.pilaId);
        if (!existingStack) {
          existingStack = {
            id: note.pilaId,
            isStack: true,
            pilaId: note.pilaId,
            notes: []
          };
          stackMap.set(note.pilaId, existingStack);
          items.push(existingStack);
        }
        existingStack.notes.push(note);
      } else {
        items.push({
          id: note.id,
          isStack: false,
          notes: [note]
        });
      }
    });

    return items;
  }, [filteredNotes]);

  // Gestione Drag & Drop Nativo HTML5 per Note e Pile
  const handleNoteDragStart = (e: React.DragEvent, noteId: string) => {
    e.dataTransfer.setData('text/plain', noteId);
    e.dataTransfer.effectAllowed = 'move';
    isDraggingRef.current = true;
    setIsDraggingStack(false);
    // Ritardo di 1 frame per scattare la drag image a piena opacità e non bloccare il rendering
    requestAnimationFrame(() => {
      setDraggedNoteId(noteId);
    });
  };

  // Drag dell'intera pila tramite il badge "Pila"
  const handleStackBadgeDragStart = (e: React.DragEvent, pilaId: string) => {
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', pilaId);
    e.dataTransfer.effectAllowed = 'move';
    isDraggingRef.current = true;
    setIsDraggingStack(true);
    requestAnimationFrame(() => {
      setDraggedNoteId(pilaId);
    });
  };

  const handleNoteDragEnd = () => {
    setDraggedNoteId(null);
    setDragOverTarget(null);
    setIsDraggingStack(false);
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 150);
  };

  // Pulizia globale su rilascio o interruzione drag per evitare qualsiasi blocco visivo o trasparenza orfana
  useEffect(() => {
    const handleGlobalDragClean = () => {
      setDraggedNoteId(null);
      setDragOverTarget(null);
      setIsDraggingStack(false);
      setTimeout(() => {
        isDraggingRef.current = false;
      }, 150);
    };

    window.addEventListener('dragend', handleGlobalDragClean);
    window.addEventListener('drop', handleGlobalDragClean);
    return () => {
      window.removeEventListener('dragend', handleGlobalDragClean);
      window.removeEventListener('drop', handleGlobalDragClean);
    };
  }, []);

  const handleNoteDragOver = (e: React.DragEvent, targetId: string, itemIdx?: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!draggedNoteId) return;

    // Se l'evento proviene da una scheda interna o dal container della pila, usa il container della pila
    const targetEl = (e.currentTarget as HTMLElement).closest('[data-stack-id]') || (e.currentTarget as HTMLElement);
    const rect = targetEl.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) / rect.width;
    const relativeY = (e.clientY - rect.top) / rect.height;

    // Se si trascina l'intera pila, non si fa mai stack di due pile, ma solo riordino nello slot
    if (isDraggingStack) {
      const slotIndex = itemIdx !== undefined ? (relativeX < 0.5 ? itemIdx : itemIdx + 1) : undefined;
      setDragOverTarget({ 
        id: targetId, 
        action: relativeX < 0.5 ? 'reorder-before' : 'reorder-after',
        slotIndex
      });
      return;
    }

    const targetItem = noteGridItems.find(it => it.id === targetId);
    const isSelf = draggedNoteId === targetId || Boolean(targetItem?.notes.some(n => n.id === draggedNoteId));

    // Se il cursore si trova nella zona utile centrale (20%-80% X e 10%-90% Y) e non è se stessa: azione di impilamento ('stack')!
    if (!isSelf && relativeX >= 0.20 && relativeX <= 0.80 && relativeY >= 0.10 && relativeY <= 0.90) {
      setDragOverTarget({ id: targetId, action: 'stack' });
    } else {
      const slotIndex = itemIdx !== undefined ? (relativeX < 0.5 ? itemIdx : itemIdx + 1) : undefined;
      setDragOverTarget({ 
        id: targetId, 
        action: relativeX < 0.5 ? 'reorder-before' : 'reorder-after',
        slotIndex
      });
    }
  };

  const handleNoteDragLeave = (e: React.DragEvent, targetId: string) => {
    const related = e.relatedTarget as Node | null;
    if (related) {
      if (e.currentTarget.contains(related)) return;
      // Previene sfarfallii nei micro-gap tra schede mantenendo attivo il target se ancora dentro il container della griglia
      if ((related as HTMLElement).closest?.('.notes-grid-container')) return;
    }
    if (dragOverTarget?.id === targetId) {
      setDragOverTarget(null);
    }
  };

  // Calcola in modo continuo e deterministico lo slot di inserimento nella pila in base alla posizione Y globale della pila
  const updateStackSlotFromPointer = (e: React.DragEvent, stackPilaId: string) => {
    if (!draggedNoteId || isDraggingStack) return;

    const draggedNote = notes.find(n => n.id === draggedNoteId);
    if (!draggedNote || draggedNote.pilaId !== stackPilaId) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const stackContainer = (e.currentTarget as HTMLElement).closest(`[data-stack-id="${stackPilaId}"]`) as HTMLElement || (e.currentTarget as HTMLElement);
    const rect = stackContainer.getBoundingClientRect();
    const pixelY = e.clientY - rect.top;

    const stackItem = noteGridItems.find(it => it.pilaId === stackPilaId);
    const stackNotes = stackItem?.notes || notes.filter(n => n.pilaId === stackPilaId);
    const totalNotes = stackNotes.length;

    let targetSlot: number;
    if (pixelY <= 17) {
      targetSlot = 0;
    } else if (pixelY >= (totalNotes - 1) * 34 + 26) {
      targetSlot = totalNotes;
    } else {
      targetSlot = Math.max(0, Math.min(totalNotes, Math.round(pixelY / 34)));
    }

    setDragOverTarget({
      id: stackPilaId,
      action: 'reorder-before',
      stackSlotIndex: targetSlot,
      isStackEnd: targetSlot === totalNotes,
      pilaId: stackPilaId
    });
  };

  const handleStackNoteDragLeave = (e: React.DragEvent, stackPilaId: string) => {
    const related = e.relatedTarget as Node | null;
    if (related) {
      // Se il puntatore è ancora all'interno dello stesso container pila, NON azzerare per evitare qualsiasi sfarfallio!
      const stackContainer = (e.currentTarget as HTMLElement).closest(`[data-stack-id="${stackPilaId}"]`);
      if (stackContainer && stackContainer.contains(related)) return;
    }
    if (dragOverTarget?.pilaId === stackPilaId) {
      setDragOverTarget(null);
    }
  };

  // Drop specifico su una scheda interna alla pila (per riordinare all'interno della pila)
  const handleStackNoteDrop = async (e: React.DragEvent, stackItem: GridNoteItem) => {
    const draggedId = draggedNoteId || e.dataTransfer.getData('text/plain');
    const stackPilaId = stackItem.pilaId;

    if (!draggedId || !stackPilaId) return;
    const draggedNote = notes.find(n => n.id === draggedId);
    if (!draggedNote || draggedNote.pilaId !== stackPilaId) return;

    e.preventDefault();
    e.stopPropagation();

    const targetSlot = dragOverTarget?.stackSlotIndex;
    if (targetSlot === undefined || targetSlot === null) {
      setDragOverTarget(null);
      return;
    }

    const currentStackNotes = notes.filter(n => n.pilaId === stackPilaId);
    const dragIdx = currentStackNotes.findIndex(n => n.id === draggedId);
    if (dragIdx === -1) return;

    // Se lo slot coincide con la posizione attuale, nessuna modifica
    if (targetSlot === dragIdx || targetSlot === dragIdx + 1) {
      setDragOverTarget(null);
      return;
    }

    // 1. Rimuovi la nota trascinata dalle note della pila
    const remainingStackNotes = currentStackNotes.filter(n => n.id !== draggedId);
    const draggedObj = currentStackNotes[dragIdx];

    // 2. Calcola l'indice di inserimento in remainingStackNotes
    const insertIdxInRemaining = Math.max(0, Math.min(remainingStackNotes.length, targetSlot > dragIdx ? targetSlot - 1 : targetSlot));

    // 3. Inserisci la nota nella nuova posizione esatta
    remainingStackNotes.splice(insertIdxInRemaining, 0, draggedObj);

    // 4. Ricostruisci l'array generale 'notes' sostituendo le note della pila nel nuovo ordine
    let stackOrderIdx = 0;
    let updatedNotes = notes.map(n => {
      if (n.pilaId === stackPilaId) {
        const reordered = remainingStackNotes[stackOrderIdx];
        stackOrderIdx++;
        return reordered;
      }
      return n;
    });

    updatedNotes = updatedNotes.map((n, idx) => ({ ...n, ordine: idx }));
    setNotes(updatedNotes);
    setDragOverTarget(null);
    try {
      await reorderPersonalNotes(updatedNotes, userEmail || '');
      showToast("Ordine delle note nella pila aggiornato!", "success");
    } catch (err) {
      console.error("Errore salvataggio ordine pila:", err);
      showToast("Errore durante il salvataggio dell'ordine.", "error");
    }
  };

  const handleNoteDrop = async (e: React.DragEvent, targetItem?: GridNoteItem, explicitSlot?: number) => {
    e.preventDefault();
    e.stopPropagation(); // Impedisce che l'evento risalga al container griglia
    const draggedId = draggedNoteId || e.dataTransfer.getData('text/plain');
    const wasDraggingStack = isDraggingStack;
    const currentDragTarget = dragOverTarget;

    setDraggedNoteId(null);
    setDragOverTarget(null);
    setIsDraggingStack(false);
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 150);

    if (!draggedId) return;

    // CASO A: Trascina INTERA PILA (tramite l'etichetta Pila)
    if (wasDraggingStack) {
      let targetSlot: number | undefined = explicitSlot ?? currentDragTarget?.slotIndex;

      if (targetSlot === undefined && targetItem) {
        const itemIdx = noteGridItems.findIndex(it => it.id === targetItem.id);
        if (itemIdx >= 0) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const relativeX = (e.clientX - rect.left) / rect.width;
          targetSlot = relativeX < 0.5 ? itemIdx : itemIdx + 1;
        }
      }

      if (targetSlot === undefined) {
        targetSlot = noteGridItems.length;
      }

      const stackNotesToMove = notes.filter(n => n.pilaId === draggedId);
      if (stackNotesToMove.length === 0) return;

      let updatedNotes = notes.filter(n => n.pilaId !== draggedId);
      const remainingGridItems = noteGridItems.filter(it => it.id !== draggedId);
      const safeSlot = Math.min(targetSlot, remainingGridItems.length);

      if (safeSlot < remainingGridItems.length) {
        const refNoteId = remainingGridItems[safeSlot].notes[0].id;
        const insertIdx = updatedNotes.findIndex(n => n.id === refNoteId);
        if (insertIdx >= 0) {
          updatedNotes.splice(insertIdx, 0, ...stackNotesToMove);
        } else {
          updatedNotes.push(...stackNotesToMove);
        }
      } else {
        updatedNotes.push(...stackNotesToMove);
      }

      updatedNotes = updatedNotes.map((n, idx) => ({ ...n, ordine: idx }));
      setNotes(updatedNotes);
      try {
        await reorderPersonalNotes(updatedNotes, userEmail || '');
        showToast("Pila spostata di posto!", "success");
      } catch (err) {
        console.error("Errore spostamento pila:", err);
        showToast("Errore durante lo spostamento della pila.", "error");
      }
      return;
    }

    // Da qui in avanti: trascina SINGOLA NOTA (libera o appartenente a una pila)
    const draggedNote = notes.find(n => n.id === draggedId);
    if (!draggedNote) return;

    // Se stiamo trascinando una nota all'interno della sua stessa pila, esegui il riordino interno
    if (draggedNote.pilaId && targetItem?.pilaId && draggedNote.pilaId === targetItem.pilaId) {
      await handleStackNoteDrop(e, targetItem);
      return;
    }

    // 1. Azione di impilamento (stack)
    const isStackAction = currentDragTarget?.action === 'stack' && targetItem;

    if (isStackAction && targetItem) {
      if (!targetItem.isStack && targetItem.notes[0]?.id === draggedId) return;

      const isSameStack = Boolean(draggedNote.pilaId && targetItem.pilaId && draggedNote.pilaId === targetItem.pilaId);
      if (isSameStack) return;

      let updatedNotes: NotaPersonale[] = [...notes];
      const targetNote = targetItem.notes[0];
      const targetPilaId = targetItem.pilaId || targetNote.pilaId || `pila_${Date.now()}`;

      updatedNotes = updatedNotes.map(n => {
        if (n.id === draggedId) {
          return { ...n, pilaId: targetPilaId };
        }
        if (targetItem.notes.some(tn => tn.id === n.id)) {
          return { ...n, pilaId: targetPilaId };
        }
        return n;
      });

      const draggedObj = updatedNotes.find(n => n.id === draggedId)!;
      updatedNotes = updatedNotes.filter(n => n.id !== draggedId);
      const targetIdx = updatedNotes.findIndex(n => targetItem.notes.some(tn => tn.id === n.id));
      if (targetIdx >= 0) {
        updatedNotes.splice(targetIdx + targetItem.notes.length, 0, draggedObj);
      } else {
        updatedNotes.push(draggedObj);
      }

      const oldPilaId = draggedNote.pilaId;
      if (oldPilaId) {
        const remainingInOldStack = updatedNotes.filter(n => n.pilaId === oldPilaId);
        if (remainingInOldStack.length === 1) {
          updatedNotes = updatedNotes.map(n => n.id === remainingInOldStack[0].id ? { ...n, pilaId: undefined } : n);
        }
      }

      updatedNotes = updatedNotes.map((n, idx) => ({ ...n, ordine: idx }));
      setNotes(updatedNotes);
      try {
        await reorderPersonalNotes(updatedNotes, userEmail || '');
        showToast("Post-it impilati nella stessa casella!", "success");
      } catch (err) {
        console.error("Errore salvataggio impilamento:", err);
        showToast("Errore durante il salvataggio dell'ordine.", "error");
      }
      return;
    }

    // 2. Azione di riordinamento nello slot condiviso della griglia per SINGOLA NOTA
    let targetSlot: number | undefined = explicitSlot ?? currentDragTarget?.slotIndex;

    if (targetSlot === undefined && targetItem) {
      const itemIdx = noteGridItems.findIndex(it => it.id === targetItem.id);
      if (itemIdx >= 0) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const relativeX = (e.clientX - rect.left) / rect.width;
        targetSlot = relativeX < 0.5 ? itemIdx : itemIdx + 1;
      }
    }

    if (targetSlot === undefined) {
      targetSlot = noteGridItems.length;
    }

    // CASO B: Trascina SINGOLA NOTA (libera o estratta da una pila)
    const oldPilaId = draggedNote.pilaId;
    const draggedObj: NotaPersonale = { ...draggedNote, pilaId: undefined };
    let updatedNotes = notes.filter(n => n.id !== draggedId);

    if (oldPilaId) {
      const remainingInOldStack = updatedNotes.filter(n => n.pilaId === oldPilaId);
      if (remainingInOldStack.length === 1) {
        updatedNotes = updatedNotes.map(n => n.id === remainingInOldStack[0].id ? { ...n, pilaId: undefined } : n);
      }
    }

    const remainingGridItems = noteGridItems
      .map(it => {
        if (!it.isStack && it.notes[0]?.id === draggedId) return null;
        if (it.isStack) {
          const notesWithoutDragged = it.notes.filter(n => n.id !== draggedId);
          if (notesWithoutDragged.length === 0) return null;
          return { ...it, notes: notesWithoutDragged };
        }
        return it;
      })
      .filter((it): it is GridNoteItem => it !== null);

    const safeSlot = Math.min(targetSlot, remainingGridItems.length);

    if (safeSlot < remainingGridItems.length) {
      const refNoteId = remainingGridItems[safeSlot].notes[0].id;
      const insertIdx = updatedNotes.findIndex(n => n.id === refNoteId);
      if (insertIdx >= 0) {
        updatedNotes.splice(insertIdx, 0, draggedObj);
      } else {
        updatedNotes.push(draggedObj);
      }
    } else {
      updatedNotes.push(draggedObj);
    }

    updatedNotes = updatedNotes.map((n, idx) => ({ ...n, ordine: idx }));
    setNotes(updatedNotes);

    try {
      await reorderPersonalNotes(updatedNotes, userEmail || '');
      showToast(oldPilaId ? "Post-it estratto dalla pila e riposizionato!" : "Post-it riordinati!", "success");
    } catch (err) {
      console.error("Errore salvataggio riordinamento note:", err);
      showToast("Errore durante il salvataggio dell'ordine.", "error");
    }
  };

  /**
   * Handler drop sull'area griglia (spazio vuoto): separa la nota impilata dalla sua pila
   * e la posiziona alla fine della griglia. Se si trascina l'intera pila, la sposta alla fine.
   */
  const handleDropOnGridContainer = async (e: React.DragEvent) => {
    // Verifica che il drop sia avvenuto effettivamente sullo sfondo della griglia
    // e non su un elemento figlio (nota o pila) che avrebbe già gestito l'evento con stopPropagation
    const target = e.target as HTMLElement;
    const isDirectGridTarget = e.currentTarget === target || target.classList.contains('notes-grid-container');
    if (!isDirectGridTarget) return;

    e.preventDefault();
    const draggedId = draggedNoteId || e.dataTransfer.getData('text/plain');
    const wasDraggingStack = isDraggingStack;
    setDraggedNoteId(null);
    setDragOverTarget(null);
    setIsDraggingStack(false);
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 150);

    if (!draggedId) return;

    if (wasDraggingStack) {
      // Sposta l'intera pila in fondo alla griglia
      const stackNotes = notes.filter(n => n.pilaId === draggedId);
      if (stackNotes.length === 0) return;
      let updatedNotes = notes.filter(n => n.pilaId !== draggedId);
      updatedNotes.push(...stackNotes);
      updatedNotes = updatedNotes.map((n, idx) => ({ ...n, ordine: idx }));
      setNotes(updatedNotes);
      try {
        await reorderPersonalNotes(updatedNotes, userEmail || '');
        showToast("Pila spostata in fondo alla griglia.", "success");
      } catch (err) {
        showToast("Errore durante lo spostamento della pila.", "error");
      }
      return;
    }

    const draggedNote = notes.find(n => n.id === draggedId);
    if (!draggedNote || !draggedNote.pilaId) return; // Separa solo note impilate

    const oldPilaId = draggedNote.pilaId;
    let updatedNotes = notes.map(n => n.id === draggedId ? { ...n, pilaId: undefined } : n);
    const remaining = updatedNotes.filter(n => n.pilaId === oldPilaId);
    if (remaining.length === 1) {
      updatedNotes = updatedNotes.map(n => n.id === remaining[0].id ? { ...n, pilaId: undefined } : n);
    }

    // Porta la nota estratta alla fine
    const extracted = updatedNotes.find(n => n.id === draggedId)!;
    updatedNotes = updatedNotes.filter(n => n.id !== draggedId);
    updatedNotes.push(extracted);

    updatedNotes = updatedNotes.map((n, idx) => ({ ...n, ordine: idx }));
    setNotes(updatedNotes);

    try {
      await reorderPersonalNotes(updatedNotes, userEmail || '');
      showToast("Post-it estratto dalla pila.", "success");
    } catch (err) {
      console.error("Errore separazione dalla pila:", err);
      showToast("Errore durante la separazione.", "error");
    }
  };


  const handleSeparateFromStack = async (noteId: string) => {
    const noteToSep = notes.find(n => n.id === noteId);
    if (!noteToSep || !noteToSep.pilaId) return;
    const oldPilaId = noteToSep.pilaId;

    let updatedNotes = notes.map(n => n.id === noteId ? { ...n, pilaId: undefined } : n);
    const remaining = updatedNotes.filter(n => n.pilaId === oldPilaId);
    if (remaining.length === 1) {
      updatedNotes = updatedNotes.map(n => n.id === remaining[0].id ? { ...n, pilaId: undefined } : n);
    }

    updatedNotes = updatedNotes.map((n, idx) => ({ ...n, ordine: idx }));
    setNotes(updatedNotes);
    if (focusedNote?.id === noteId) {
      setFocusedNote(prev => prev ? { ...prev, pilaId: undefined } : null);
    }

    try {
      await reorderPersonalNotes(updatedNotes, userEmail || '');
      showToast("Post-it separato dalla pila.", "success");
    } catch (err) {
      console.error("Errore separazione dalla pila:", err);
      showToast("Errore durante la separazione.", "error");
    }
  };

  // Gestione tastiera per Focus View
  useEffect(() => {
    if (!focusedNote) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFocusedNote(null);
      } else if (focusedNote.pilaId) {
        const stackNotes = notes.filter(n => n.pilaId === focusedNote.pilaId);
        const currIdx = stackNotes.findIndex(n => n.id === focusedNote.id);
        if (currIdx >= 0) {
          if (e.key === 'ArrowLeft' && currIdx > 0) {
            setFocusedNote(stackNotes[currIdx - 1]);
          } else if (e.key === 'ArrowRight' && currIdx < stackNotes.length - 1) {
            setFocusedNote(stackNotes[currIdx + 1]);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedNote, notes]);

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
          <div className={`bg-white/90 backdrop-blur-xl p-5 rounded-[1.8rem] border border-white/60 shadow-sm space-y-4 relative ${isCommessaFilterOpen ? 'z-30' : 'z-10'}`}>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-gray-100">
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

                  {/* 3. Filtro Priorità */}
                  <select
                    value={filterPriority}
                    onChange={e => setFilterPriority(e.target.value as any)}
                    className={`w-full px-3 py-2 border rounded-xl text-xs font-bold outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300 cursor-pointer ${
                      filterPriority !== 'all'
                        ? 'bg-rose-50/60 border-rose-200 text-rose-800'
                        : 'bg-gray-50 border-gray-200 text-gray-800'
                    }`}
                  >
                    <option value="all">Tutte le priorità</option>
                    <option value="Alta">Priorità Alta</option>
                    <option value="Standard">Priorità Standard</option>
                    <option value="Bassa">Priorità Bassa</option>
                  </select>

                  {/* 4. Filtro Categoria */}
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
                  <div className={`relative ${isCommessaFilterOpen ? 'z-50' : 'z-10'}`} ref={commessaFilterDropdownRef}>
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

                  {/* 6. Ordinamento */}
                  <div className="relative">
                    <select
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value as any)}
                      className="w-full px-3 py-2 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs font-bold text-indigo-950 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300 cursor-pointer"
                    >
                      <option value="scadenza">Ordina: Per Scadenza</option>
                      <option value="priorita">Ordina: Per Priorità</option>
                      <option value="creazione">Ordina: Per Creazione</option>
                    </select>
                  </div>
                </div>

                {/* Barra Filtri Rapidi Scadenza (Chips Orizzontali) */}
                <div className="flex items-center gap-1.5 flex-wrap pt-2.5 border-t border-gray-100">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400 mr-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                    <span>Scadenza:</span>
                  </span>

                  <button
                    type="button"
                    onClick={() => setFilterDeadline('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      filterDeadline === 'all'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80'
                    }`}
                  >
                    <span>Tutte</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-black ${filterDeadline === 'all' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
                      {deadlineCounts.all}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterDeadline('scadute')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      filterDeadline === 'scadute'
                        ? 'bg-red-600 text-white shadow-xs'
                        : deadlineCounts.scadute > 0
                          ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                          : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80'
                    }`}
                  >
                    <span>⚠️ Scadute</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-black ${filterDeadline === 'scadute' ? 'bg-white/20 text-white' : 'bg-red-100 text-red-800'}`}>
                      {deadlineCounts.scadute}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterDeadline('oggi')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      filterDeadline === 'oggi'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : deadlineCounts.oggi > 0
                          ? 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                          : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80'
                    }`}
                  >
                    <span>🔔 Oggi</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-black ${filterDeadline === 'oggi' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'}`}>
                      {deadlineCounts.oggi}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterDeadline('settimana')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      filterDeadline === 'settimana'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80'
                    }`}
                  >
                    <span>Questa settimana</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-black ${filterDeadline === 'settimana' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
                      {deadlineCounts.settimana}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterDeadline('prossime')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      filterDeadline === 'prossime'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80'
                    }`}
                    title="Filtra le attività in scadenza nelle prossime 4 settimane (compresa quella corrente)"
                  >
                    <span>Prossime 4 settimane</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-black ${filterDeadline === 'prossime' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
                      {deadlineCounts.prossime}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterDeadline('senza_data')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      filterDeadline === 'senza_data'
                        ? 'bg-slate-700 text-white shadow-xs'
                        : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200/80'
                    }`}
                  >
                    <span>Senza data</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-black ${filterDeadline === 'senza_data' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
                      {deadlineCounts.senzaData}
                    </span>
                  </button>
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
                        id={`task-card-${task.id}`}
                        className={`rounded-2xl p-4 border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm hover:shadow-md ${getTaskCardClasses(task, isAssignedToMe, todayIso, highlightedTaskId === task.id)}`}
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

                              {/* Badge Priorità */}
                              {(() => {
                                const prio = task.priorita || 'Standard';
                                const pConfig = TODO_PRIORITA_CONFIG[prio] || TODO_PRIORITA_CONFIG.Standard;
                                return (
                                  <span className={`inline-flex items-center gap-1 text-[10px] uppercase px-2 py-0.5 rounded-md ${pConfig.badge}`}>
                                    {prio === 'Alta' && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0" />}
                                    <span>{pConfig.label}</span>
                                  </span>
                                );
                              })()}

                              {/* Badge Categoria */}
                              <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${catProps.bg} ${catProps.text} ${catProps.border}`}>
                                <span>{catProps.icon}</span>
                                <span>{catProps.label}</span>
                              </span>

                              {/* Badge Commessa o Generico: NON TRONCARE MAI */}
                              {task.tipo === 'commessa' && task.commessaNome ? (
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md border border-blue-100">
                                  <Briefcase className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                                  <span>{formatCommessaDisplay(task.commessaNome, task.commessaCodice)}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md border border-gray-200">
                                  <Tag className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                                  <span>Generico / Ufficio</span>
                                </span>
                              )}

                              {/* Badge Completata da (visibile solo se completata) */}
                              {isDone && task.completatoDa && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md">
                                  <Check className="w-3 h-3 text-emerald-600 stroke-[2.5] shrink-0" />
                                  <span>Completata da: <strong className="font-extrabold">{task.completatoDa}</strong></span>
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
                              <div className="pt-1 flex flex-wrap gap-2 p-1 -m-1">
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
                          const prio = t.priorita || 'Standard';
                          if (isDone) {
                            pillStyle = isAssignedToMe
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 border-l-[3px] border-l-emerald-600 line-through opacity-75'
                              : 'bg-gray-50 text-gray-400 border-gray-200 border-l-[3px] border-l-gray-300 line-through opacity-60';
                          } else if (isOverdue) {
                            pillStyle = prio === 'Alta'
                              ? 'bg-rose-100 text-rose-950 border-rose-400 border-l-[4px] border-l-rose-700 font-black shadow-2xs ring-1 ring-rose-300'
                              : isAssignedToMe
                                ? 'bg-red-50 text-red-950 border-red-300 border-l-[3px] border-l-red-600 font-black shadow-2xs'
                                : 'bg-red-50/50 text-red-700 border-red-200 border-l-[3px] border-l-red-300 font-medium';
                          } else if (prio === 'Alta') {
                            pillStyle = isAssignedToMe
                              ? 'bg-rose-50 text-rose-950 border-rose-300 border-l-[4px] border-l-rose-600 font-black shadow-2xs hover:bg-rose-100'
                              : 'bg-rose-50/70 text-rose-800 border-rose-200 border-l-[3px] border-l-rose-500 font-bold hover:bg-rose-100/70';
                          } else if (prio === 'Bassa') {
                            pillStyle = isAssignedToMe
                              ? 'bg-sky-50/95 text-sky-950 border-sky-300 border-l-[3px] border-l-sky-500 font-bold shadow-2xs hover:bg-sky-100/90'
                              : 'bg-slate-50/80 text-slate-600 border-slate-200 border-l-[3px] border-l-slate-300 font-medium hover:bg-slate-100';
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
                            className={`rounded-2xl p-4 border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm hover:shadow-md ${getTaskCardClasses(task, isAssignedToMe, todayIso)}`}
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

                                  {/* Badge Priorità */}
                                  {(() => {
                                    const prio = task.priorita || 'Standard';
                                    const pConfig = TODO_PRIORITA_CONFIG[prio] || TODO_PRIORITA_CONFIG.Standard;
                                    return (
                                      <span className={`inline-flex items-center gap-1 text-[10px] uppercase px-2 py-0.5 rounded-md ${pConfig.badge}`}>
                                        {prio === 'Alta' && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0" />}
                                        <span>{pConfig.label}</span>
                                      </span>
                                    );
                                  })()}

                                  {/* Badge Categoria */}
                                  <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${catProps.bg} ${catProps.text} ${catProps.border}`}>
                                    <span>{catProps.icon}</span>
                                    <span>{catProps.label}</span>
                                  </span>

                                  {/* Badge Commessa o Generico: NON TRONCARE MAI */}
                                  {task.tipo === 'commessa' && task.commessaNome ? (
                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md border border-blue-100">
                                      <Briefcase className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                                      <span>{formatCommessaDisplay(task.commessaNome, task.commessaCodice)}</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md border border-gray-200">
                                      <Tag className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                                      <span>Generico / Ufficio</span>
                                    </span>
                                  )}

                                  {/* Badge Completata da (visibile solo se completata) */}
                                  {isDone && task.completatoDa && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md">
                                      <Check className="w-3 h-3 text-emerald-600 stroke-[2.5] shrink-0" />
                                      <span>Completata da: <strong className="font-extrabold">{task.completatoDa}</strong></span>
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
                                  <div className="pt-1 flex flex-wrap gap-2 p-1 -m-1">
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
          {noteGridItems.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-xl p-12 text-center rounded-[2rem] border border-white/60 shadow-sm space-y-3">
              <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                <StickyNote className="w-6 h-6" />
              </div>
              <h3 className="text-base font-extrabold text-gray-800">
                {noteSearch ? "Nessun appunto trovato per questa ricerca" : "Nessuna nota personale presente"}
              </h3>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                {noteSearch ? "Prova con un termine di ricerca diverso oppure pulisci la barra." : "Questo è il tuo spazio privato per promemoria veloci, testi da ricordare e appunti personali. Nessun altro utente può visualizzarli."}
              </p>
              <button
                type="button"
                onClick={handleOpenNewNoteModal}
                className="inline-flex items-center gap-1.5 bg-amber-500 text-white font-bold text-xs px-4 py-2 rounded-xl hover:bg-amber-600 transition cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" /> Crea la tua prima nota
              </button>
            </div>
          ) : (
            <div
              className="notes-grid-container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 items-start"
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDragLeave={e => {
                const related = e.relatedTarget as Node | null;
                if (!related || !e.currentTarget.contains(related)) {
                  setDragOverTarget(null);
                }
              }}
              onDrop={handleDropOnGridContainer}
            >

              {noteGridItems.map((item, itemIdx) => {
                const activeSlot = dragOverTarget?.action !== 'stack' ? dragOverTarget?.slotIndex : undefined;
                const isLeftSlotActive = activeSlot === itemIdx;
                const isRightSlotActive = activeSlot === itemIdx + 1;
                const isLastItem = itemIdx === noteGridItems.length - 1;
                const shiftClass = isLeftSlotActive 
                  ? 'sm:translate-x-2' 
                  : isRightSlotActive 
                  ? 'sm:-translate-x-2' 
                  : '';

                // CASO 1: NOTA SINGOLA
                if (!item.isStack) {
                  const note = item.notes[0];
                  const colorConfig = NOTE_COLORS[note.colore || 'giallo'] || NOTE_COLORS.giallo;
                  const isDragging = draggedNoteId === note.id;
                  const isOver = dragOverTarget?.id === note.id;
                  const isOverStack = isOver && dragOverTarget?.action === 'stack';
                  const attachments = getTodoAttachments(note);

                  return (
                    <div
                      key={note.id}
                      draggable={true}
                      onDragStart={e => handleNoteDragStart(e, note.id)}
                      onDragEnd={handleNoteDragEnd}
                      onDragOver={e => handleNoteDragOver(e, note.id, itemIdx)}
                      onDragLeave={e => handleNoteDragLeave(e, note.id)}
                      onDrop={e => handleNoteDrop(e, item, itemIdx)}
                      onClick={() => {
                        if (isDraggingRef.current) return;
                        setFocusedNote(note);
                      }}
                      className={`${colorConfig.bg} ${colorConfig.border} border-2 rounded-2xl p-4 sm:p-5 shadow-xs hover:shadow-md transition-[box-shadow,transform,border-color] duration-150 flex flex-col justify-between h-[250px] w-full relative group cursor-pointer select-none ${
                        isDragging ? 'opacity-40 scale-[0.98]' : 'opacity-100'
                      } ${
                        isOverStack ? 'ring-4 ring-amber-400 ring-dashed scale-[1.02] z-30' : ''
                      } ${shiftClass}`}
                    >
                      {/* Spazio condiviso illuminato tra le note (slot a sinistra di questo elemento) */}
                      {isLeftSlotActive && (
                        <div 
                          onDragOver={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={e => handleNoteDrop(e, item, itemIdx)}
                          className="absolute -left-5 sm:-left-[30px] top-0 bottom-0 w-5 sm:w-[24px] z-40 flex items-center justify-center cursor-pointer pointer-events-auto"
                          title="Rilascia qui per inserire la nota nello spazio condiviso"
                        >
                          <div className="w-full h-full rounded-xl bg-indigo-500/25 border-2 border-dashed border-indigo-500 shadow-[0_0_18px_rgba(99,102,241,0.7)] flex flex-col items-center justify-center animate-pulse">
                            <div className="w-1.5 h-16 bg-indigo-600 rounded-full shadow-md" />
                          </div>
                        </div>
                      )}

                      {/* Spazio condiviso illuminato in fondo (slot dopo l'ultimo elemento) */}
                      {isLastItem && isRightSlotActive && (
                        <div 
                          onDragOver={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={e => handleNoteDrop(e, item, itemIdx + 1)}
                          className="absolute -right-5 sm:-right-[30px] top-0 bottom-0 w-5 sm:w-[24px] z-40 flex items-center justify-center cursor-pointer pointer-events-auto"
                          title="Rilascia qui per inserire la nota in fondo"
                        >
                          <div className="w-full h-full rounded-xl bg-indigo-500/25 border-2 border-dashed border-indigo-500 shadow-[0_0_18px_rgba(99,102,241,0.7)] flex flex-col items-center justify-center animate-pulse">
                            <div className="w-1.5 h-16 bg-indigo-600 rounded-full shadow-md" />
                          </div>
                        </div>
                      )}

                      {/* Overlay di aiuto per impilamento */}
                      {isOverStack && (
                        <div className="absolute inset-0 bg-amber-500/15 backdrop-blur-[1px] rounded-2xl flex items-center justify-center pointer-events-none z-20">
                          <span className="bg-amber-600 text-white text-[11px] font-black uppercase px-2.5 py-1 rounded-xl shadow-md flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5" /> Rilascia per impilare
                          </span>
                        </div>
                      )}

                      {/* Header: Titolo e Grip per il trascinamento */}
                      <div className="flex items-start justify-between gap-2">
                        <h3 className={`text-sm font-black ${colorConfig.text} leading-tight truncate flex-1`} title={note.titolo || 'Senza titolo'}>
                          {note.titolo || 'Senza titolo'}
                        </h3>
                        <div 
                          className="p-0.5 text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing shrink-0"
                          title="Trascina per spostare o sovrapporre per impilare"
                          onClick={e => e.stopPropagation()}
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                      </div>

                      {/* Testo Nota: Altezza fissa con sfumatura elegante */}
                      <div className="flex-1 min-h-0 flex flex-col justify-between my-2 overflow-hidden">
                        <p className="text-xs font-medium text-gray-700 whitespace-pre-line leading-relaxed break-words line-clamp-4">
                          {note.contenuto || 'Nessun testo.'}
                        </p>

                        <div className="pt-2">
                          {attachments.length > 0 && (
                            <div className="flex items-center gap-1 text-[10px] text-gray-500 font-bold mb-1">
                              <Paperclip className="w-3 h-3 text-gray-400" />
                              <span>{attachments.length} {attachments.length === 1 ? 'allegato' : 'allegati'}</span>
                            </div>
                          )}
                          <span className="text-[10px] text-gray-400 font-semibold flex items-center gap-1 group-hover:text-amber-700 transition">
                            <Maximize2 className="w-2.5 h-2.5" /> Clicca per espandere
                          </span>
                        </div>
                      </div>

                      {/* Footer: Data e Azioni */}
                      <div className="pt-3 border-t border-gray-200/60 flex items-center justify-between text-[10px] text-gray-400 font-semibold shrink-0">
                        <span>{new Date(note.aggiornataIl || note.creataIl).toLocaleDateString('it-IT')}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditNoteModal(note);
                            }}
                            className="p-1 hover:text-indigo-600 hover:bg-white/60 rounded transition cursor-pointer"
                            title="Modifica nota"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteNote(note.id);
                            }}
                            className="p-1 hover:text-red-600 hover:bg-white/60 rounded transition cursor-pointer"
                            title="Elimina nota"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                // CASO 2: PILA / STACK DI NOTE (A Cascata Sfalsata)
                const stackHeight = 250 + (item.notes.length - 1) * 34;
                const isOverStack = dragOverTarget?.id === item.id && dragOverTarget?.action === 'stack';

                return (
                  <div
                    key={item.id}
                    data-stack-id={item.id}
                    onDragOver={e => {
                      const draggedNote = notes.find(n => n.id === draggedNoteId);
                      if (draggedNote?.pilaId === item.id && !isDraggingStack) {
                        updateStackSlotFromPointer(e, item.id);
                        return;
                      }
                      handleNoteDragOver(e, item.id, itemIdx);
                    }}
                    onDragLeave={e => {
                      const draggedNote = notes.find(n => n.id === draggedNoteId);
                      if (draggedNote?.pilaId === item.id && !isDraggingStack) {
                        handleStackNoteDragLeave(e, item.id);
                        return;
                      }
                      handleNoteDragLeave(e, item.id);
                    }}
                    onDrop={e => {
                      const draggedNote = notes.find(n => n.id === draggedNoteId);
                      if (draggedNote?.pilaId === item.id && !isDraggingStack) {
                        handleStackNoteDrop(e, item);
                        return;
                      }
                      handleNoteDrop(e, item, itemIdx);
                    }}
                    onDragEnd={handleNoteDragEnd}
                    style={{ minHeight: `${stackHeight}px` }}
                    className={`relative w-full transition-all select-none ${
                      isOverStack ? 'ring-4 ring-amber-400 ring-dashed rounded-2xl scale-[1.02] z-30' : ''
                    } ${shiftClass}`}
                  >
                    {/* Indicatore Laser Globale della Pila - SEMPRE VISIBILE IN CIMA A TUTTO (z-[80]) */}
                    {dragOverTarget?.pilaId === item.id && dragOverTarget?.stackSlotIndex !== undefined && (
                      <div 
                        style={{ 
                          top: dragOverTarget.stackSlotIndex === item.notes.length 
                            ? `${(item.notes.length - 1) * 34 + 36}px` 
                            : `${dragOverTarget.stackSlotIndex * 34 - 2}px` 
                        }}
                        className={`absolute left-2 ${
                          dragOverTarget.stackSlotIndex === 0 ? 'right-28 sm:right-32' : 'right-2'
                        } h-3 z-[80] pointer-events-none flex items-center transition-all duration-75`}
                      >
                        <div className="w-full h-1 bg-gradient-to-r from-indigo-500 via-indigo-600 to-indigo-500 rounded-full shadow-[0_0_12px_rgba(99,102,241,1)]" />
                        <span className="absolute left-4 bg-indigo-600 text-white text-[10px] font-black tracking-wide px-2.5 py-0.5 rounded-full shadow-lg border border-indigo-300 flex items-center gap-1 uppercase whitespace-nowrap animate-pulse">
                          {dragOverTarget.stackSlotIndex === 0 
                            ? '↑ In cima alla pila' 
                            : dragOverTarget.stackSlotIndex === item.notes.length 
                              ? '↓ Sposta in fondo (ultima)' 
                              : `Inserisci in posizione ${dragOverTarget.stackSlotIndex + 1}`}
                        </span>
                      </div>
                    )}

                    {/* Spazio condiviso illuminato tra le note (slot a sinistra della pila) */}
                    {isLeftSlotActive && (
                      <div 
                        onDragOver={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={e => handleNoteDrop(e, item, itemIdx)}
                        className="absolute -left-5 sm:-left-[30px] top-0 bottom-0 w-5 sm:w-[24px] z-40 flex items-center justify-center cursor-pointer pointer-events-auto"
                        title="Rilascia qui per inserire la nota nello spazio condiviso"
                      >
                        <div className="w-full h-full rounded-xl bg-indigo-500/25 border-2 border-dashed border-indigo-500 shadow-[0_0_18px_rgba(99,102,241,0.7)] flex flex-col items-center justify-center animate-pulse">
                          <div className="w-1.5 h-16 bg-indigo-600 rounded-full shadow-md" />
                        </div>
                      </div>
                    )}

                    {/* Spazio condiviso illuminato in fondo (slot dopo l'ultimo elemento) */}
                    {isLastItem && isRightSlotActive && (
                      <div 
                        onDragOver={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={e => handleNoteDrop(e, item, itemIdx + 1)}
                        className="absolute -right-5 sm:-right-[30px] top-0 bottom-0 w-5 sm:w-[24px] z-40 flex items-center justify-center cursor-pointer pointer-events-auto"
                        title="Rilascia qui per inserire la nota in fondo"
                      >
                        <div className="w-full h-full rounded-xl bg-indigo-500/25 border-2 border-dashed border-indigo-500 shadow-[0_0_18px_rgba(99,102,241,0.7)] flex flex-col items-center justify-center animate-pulse">
                          <div className="w-1.5 h-16 bg-indigo-600 rounded-full shadow-md" />
                        </div>
                      </div>
                    )}

                    {/* Badge Pila in evidenza in alto a destra - sempre visibile (z-[60]) e trascinabile per spostare l'intera pila */}
                    <div
                      draggable={true}
                      onDragStart={e => handleStackBadgeDragStart(e, item.id)}
                      onDragEnd={handleNoteDragEnd}
                      title="Trascina l'etichetta per spostare l'intera pila di posto nella griglia"
                      className={`absolute -top-2.5 right-3 z-[60] bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full shadow-md flex items-center gap-1.5 cursor-grab active:cursor-grabbing hover:scale-105 active:scale-95 transition-all select-none border border-amber-400 ${
                        isDraggingStack && draggedNoteId === item.id ? 'opacity-40 ring-2 ring-amber-300 ring-offset-1' : ''
                      }`}
                    >
                      <Layers className="w-3 h-3 shrink-0" />
                      <span>Pila ({item.notes.length} note)</span>
                      <GripVertical className="w-3 h-3 opacity-70 shrink-0" />
                    </div>

                    {/* Schede impilate a cascata */}
                    {item.notes.map((note, idx) => {
                      const colorConfig = NOTE_COLORS[note.colore || 'giallo'] || NOTE_COLORS.giallo;
                      const isDragging = draggedNoteId === note.id;
                      const attachments = getTodoAttachments(note);

                      // Bersaglio attivo per la scheda corrente
                      const isNearTargetSlot = dragOverTarget?.pilaId === item.id && (dragOverTarget?.stackSlotIndex === idx || dragOverTarget?.stackSlotIndex === idx + 1);

                      return (
                        <div
                          key={note.id}
                          draggable={true}
                          onDragStart={e => handleNoteDragStart(e, note.id)}
                          onDragEnd={handleNoteDragEnd}
                          onDragOver={e => {
                            const draggedNote = notes.find(n => n.id === draggedNoteId);
                            if (draggedNote?.pilaId === item.id && !isDraggingStack) {
                              updateStackSlotFromPointer(e, item.id);
                            } else {
                              handleNoteDragOver(e, item.id, itemIdx);
                            }
                          }}
                          onDrop={e => {
                            const draggedNote = notes.find(n => n.id === draggedNoteId);
                            if (draggedNote?.pilaId === item.id && !isDraggingStack) {
                              handleStackNoteDrop(e, item);
                            } else {
                              handleNoteDrop(e, item, itemIdx);
                            }
                          }}
                          onClick={() => {
                            if (isDraggingRef.current) return;
                            setFocusedNote(note);
                          }}
                          style={{
                            top: `${idx * 34}px`,
                            zIndex: 10 + idx * 5
                          }}
                          className={`absolute left-0 right-0 h-[240px] rounded-2xl pt-2 px-4 sm:px-5 pb-4 sm:pb-5 border-2 ${colorConfig.bg} ${
                            isNearTargetSlot ? 'border-indigo-500 ring-2 ring-indigo-400 ring-offset-1' : colorConfig.border
                          } shadow-sm transition-[box-shadow,transform,border-color] duration-150 cursor-pointer flex flex-col justify-between group/card hover:!z-50 ${
                            draggedNoteId ? '' : 'hover:-translate-y-2 hover:shadow-xl'
                          } ${isDragging ? 'opacity-40 scale-[0.98] pointer-events-none' : 'opacity-100'}`}
                        >
                          {/* Header della nota impilata - compatto per perfetta leggibilità nei 34px visibili */}
                          <div className="flex items-center justify-between gap-2 h-5 shrink-0">
                            <h3 className={`text-xs sm:text-sm font-black ${colorConfig.text} leading-none truncate flex-1`} title={note.titolo || 'Senza titolo'}>
                              {note.titolo || 'Senza titolo'}
                            </h3>
                            <div className="flex items-center gap-1 shrink-0">
                              <div 
                                className="p-0.5 text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing"
                                title="Trascina per riordinare nella pila o trascina fuori per estrarre"
                                onClick={e => e.stopPropagation()}
                              >
                                <GripVertical className="w-3.5 h-3.5" />
                              </div>
                            </div>
                          </div>



                          {/* Corpo: Visibile quando si va in hover o sulla scheda in cima */}
                          <div className="flex-1 min-h-0 flex flex-col justify-between my-2 overflow-hidden">
                            <p className="text-xs font-medium text-gray-700 whitespace-pre-line leading-relaxed break-words line-clamp-4">
                              {note.contenuto || 'Nessun testo.'}
                            </p>

                            <div className="pt-2">
                              {attachments.length > 0 && (
                                <div className="flex items-center gap-1 text-[10px] text-gray-500 font-bold mb-1">
                                  <Paperclip className="w-3 h-3 text-gray-400" />
                                  <span>{attachments.length} {attachments.length === 1 ? 'allegato' : 'allegati'}</span>
                                </div>
                              )}
                              <span className="text-[10px] text-gray-400 font-semibold flex items-center gap-1 group-hover/card:text-amber-700 transition">
                                <Maximize2 className="w-2.5 h-2.5" /> Clicca per espandere
                              </span>
                            </div>
                          </div>

                          {/* Footer: Data e Azioni */}
                          <div className="pt-3 border-t border-gray-200/60 flex items-center justify-between text-[10px] text-gray-400 font-semibold shrink-0">
                            <span>{new Date(note.aggiornataIl || note.creataIl).toLocaleDateString('it-IT')}</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEditNoteModal(note);
                                }}
                                className="p-1 hover:text-indigo-600 hover:bg-white/60 rounded transition cursor-pointer"
                                title="Modifica nota"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteNote(note.id);
                                }}
                                className="p-1 hover:text-red-600 hover:bg-white/60 rounded transition cursor-pointer"
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
              return [saved, ...prev.filter(t => t.id !== saved.id)];
            }
          });

          // Sincronizza lo stato in-memory della commessa in AuthContext per reattività istantanea
          if (saved.tipo === 'commessa' && saved.commessaId && updateCommessaPunchList) {
            const targetComm = commesse.find(c => c.id === saved.commessaId);
            const currentPunch = targetComm?.punchList || [];
            const exists = currentPunch.some(p => p.id === saved.id);
            const punchItem: PunchListItem = {
              id: saved.id,
              titolo: saved.titolo,
              descrizione: saved.descrizione,
              categoria: saved.categoria,
              priorita: saved.priorita || 'Standard',
              scadenza: saved.scadenza,
              assegnatiA: saved.assegnatiA,
              assegnatoA: saved.assegnatoA,
              stato: saved.stato,
              creatoDa: saved.creatoDa || myAssociatedName || 'Utente',
              creatoDaEmail: saved.creatoDaEmail || userEmail || undefined,
              creatoIl: saved.creatoIl || new Date().toISOString(),
              completatoDa: saved.completatoDa,
              completatoIl: saved.completatoIl,
              allegatoPercorso: saved.allegatoPercorso,
              allegatoNome: saved.allegatoNome,
              allegatoTipo: saved.allegatoTipo,
              allegatoEstensione: saved.allegatoEstensione,
              allegati: saved.allegati
            };
            const updatedPunch = exists
              ? currentPunch.map(p => p.id === saved.id ? punchItem : p)
              : [punchItem, ...currentPunch];
            updateCommessaPunchList(saved.commessaId, updatedPunch);
          }

          // Se si crea un nuovo task, allinea i filtri in modo da renderlo immediatamente visibile a video
          if (!editingTask) {
            const isAssignedToMe = isTaskAssignee(saved, myAssociatedName);
            if (!isAssignedToMe && filterAssignee === 'mine') {
              setFilterAssignee('all');
            }
            if (filterStatus === 'completato') {
              setFilterStatus('da_fare');
            }
            if (filterCommessa !== 'all' && saved.commessaId && filterCommessa !== saved.commessaId) {
              setFilterCommessa('all');
            }
            if (filterCategory !== 'all' && saved.categoria !== filterCategory) {
              setFilterCategory('all');
            }
            if (filterPriority !== 'all' && (saved.priorita || 'Standard') !== filterPriority) {
              setFilterPriority('all');
            }
            if (filterDeadline !== 'all') {
              setFilterDeadline('all');
            }
          }

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
                    <div className="space-y-1.5 max-h-40 overflow-y-auto p-1 custom-scrollbar">
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

      {/* ========================================================================= */}
      {/* MODALE FOCUS VIEW NOTA ESPANSA IN PRIMO PIANO */}
      {/* ========================================================================= */}
      {focusedNote && (() => {
        const colorConfig = NOTE_COLORS[focusedNote.colore || 'giallo'] || NOTE_COLORS.giallo;
        const stackSiblings = focusedNote.pilaId ? notes.filter(n => n.pilaId === focusedNote.pilaId) : [];
        const currentStackIndex = stackSiblings.findIndex(n => n.id === focusedNote.id);
        const hasPrev = currentStackIndex > 0;
        const hasNext = currentStackIndex >= 0 && currentStackIndex < stackSiblings.length - 1;

        return (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setFocusedNote(null)}
          >
            <div 
              className={`max-w-xl w-full max-h-[85vh] flex flex-col rounded-[2rem] p-6 sm:p-7 shadow-2xl border-2 ${colorConfig.bg} ${colorConfig.border} animate-in zoom-in-95 duration-150 relative`}
              onClick={e => e.stopPropagation()}
            >
              {/* Header Focus View */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-200/60 shrink-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/70 text-gray-600 border border-gray-200/80">
                      Nota Personale
                    </span>
                  </div>
                  <h2 className={`text-xl font-black ${colorConfig.text} leading-snug break-words`}>
                    {focusedNote.titolo || 'Senza titolo'}
                  </h2>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {focusedNote.pilaId && (
                    <button
                      type="button"
                      onClick={() => handleSeparateFromStack(focusedNote.id)}
                      className="px-2.5 py-1 text-xs font-bold text-gray-600 hover:text-amber-800 bg-white/70 hover:bg-white rounded-xl border border-gray-200 transition cursor-pointer"
                      title="Separa questa nota dalla pila"
                    >
                      Separa dalla pila
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setFocusedNote(null)}
                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-white/70 rounded-xl transition cursor-pointer"
                    title="Chiudi vista (Esc)"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Corpo del testo scrollabile */}
              <div className="flex-1 overflow-y-auto custom-scrollbar py-4 px-1.5 -mx-1.5 space-y-4">
                <p className="text-sm font-medium text-gray-800 whitespace-pre-line leading-relaxed break-words selection:bg-amber-200">
                  {focusedNote.contenuto || 'Nessun contenuto testuale.'}
                </p>

                {/* Allegati */}
                {getTodoAttachments(focusedNote).length > 0 && (
                  <div className="pt-3 border-t border-gray-200/60">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5 text-gray-400" />
                      <span>Allegati ({getTodoAttachments(focusedNote).length})</span>
                    </h4>
                    <div className="flex flex-wrap gap-2 p-1 -m-1">
                      {getTodoAttachments(focusedNote).map(att => (
                        <AttachmentBadge
                          key={att.id}
                          percorso={att.percorso}
                          nome={att.nome}
                          tipo={att.tipo}
                          estensione={att.estensione}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer con Azioni e Navigazione Pila */}
              <div className="pt-3 border-t border-gray-200/60 flex items-center justify-between gap-3 text-xs shrink-0">
                {/* Sfoglia Pila */}
                {focusedNote.pilaId && stackSiblings.length > 1 ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!hasPrev}
                      onClick={() => setFocusedNote(stackSiblings[currentStackIndex - 1])}
                      className="p-1.5 rounded-xl bg-white/70 hover:bg-white text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed border border-gray-200 transition flex items-center gap-1 font-bold text-xs cursor-pointer"
                      title="Nota precedente nella pila (←)"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span className="hidden sm:inline">Precedente</span>
                    </button>
                    <button
                      type="button"
                      disabled={!hasNext}
                      onClick={() => setFocusedNote(stackSiblings[currentStackIndex + 1])}
                      className="p-1.5 rounded-xl bg-white/70 hover:bg-white text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed border border-gray-200 transition flex items-center gap-1 font-bold text-xs cursor-pointer"
                      title="Nota successiva nella pila (→)"
                    >
                      <span className="hidden sm:inline">Successiva</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-gray-400 font-semibold">
                    Aggiornata il {new Date(focusedNote.aggiornataIl || focusedNote.creataIl).toLocaleDateString('it-IT')}
                  </span>
                )}

                {/* Azioni Modifica / Elimina */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const noteToEdit = focusedNote;
                      setFocusedNote(null);
                      handleOpenEditNoteModal(noteToEdit);
                    }}
                    className="px-3.5 py-1.5 bg-white/80 hover:bg-white text-indigo-700 rounded-xl font-bold border border-indigo-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Modifica</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const noteToDeleteId = focusedNote.id;
                      setFocusedNote(null);
                      handleDeleteNote(noteToDeleteId);
                    }}
                    className="px-3.5 py-1.5 bg-white/80 hover:bg-white text-rose-700 rounded-xl font-bold border border-rose-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Elimina</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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

