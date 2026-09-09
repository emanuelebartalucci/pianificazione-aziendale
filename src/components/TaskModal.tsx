import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth, getAssociatedNameFromEmail } from '../contexts/AuthContext';
import { 
  ListTodo, 
  X, 
  Briefcase, 
  ChevronDown, 
  Check, 
  User, 
  Users, 
  Paperclip, 
  File, 
  FolderOpen, 
  Loader2, 
  ExternalLink, 
  Lock, 
  Search, 
  AlertCircle
} from 'lucide-react';
import { 
  type UnifiedTodoItem, 
  type TodoAttachment, 
  TODO_CATEGORIE, 
  saveUnifiedTodo, 
  isSharedNetworkPath, 
  parseAttachmentPath, 
  triggerNativePicker, 
  openAttachedPath, 
  getTodoAttachments, 
  getEligibleAssigneesForCommessa, 
  isUserInvolvedInCommessa, 
  getAssignedCommessaIdsForUser,
  formatCommessaDisplay,
  getCommessaTitleWithoutCode
} from '../services/todoService';

import AttachmentBadge from './AttachmentBadge';

export interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingTask?: UnifiedTodoItem | null;
  fixedCommessaId?: string | null;
  isCommessaLocked?: boolean;
  defaultDate?: string;
  onTaskSaved?: (savedTask: UnifiedTodoItem) => void;
}

export default function TaskModal({
  isOpen,
  onClose,
  editingTask = null,
  fixedCommessaId = null,
  isCommessaLocked = false,
  defaultDate = '',
  onTaskSaved
}: TaskModalProps) {
  const { userEmail, myAssociatedName, dipendenti = [], commesse = [], assegnazioni = {}, updateCommessaPunchList } = useAuth();

  // Stati del form attività
  const [taskCategoria, setTaskCategoria] = useState<string>(TODO_CATEGORIE[0] || 'da fare');
  const [taskPriorita, setTaskPriorita] = useState<'Alta' | 'Standard' | 'Bassa'>('Standard');
  const [taskCommessaId, setTaskCommessaId] = useState<string>('');
  const [taskTitolo, setTaskTitolo] = useState('');
  const [taskDescrizione, setTaskDescrizione] = useState('');
  const [taskAssegnatiA, setTaskAssegnatiA] = useState<string[]>([]);
  const [taskScadenza, setTaskScadenza] = useState('');
  const [taskAllegati, setTaskAllegati] = useState<TodoAttachment[]>([]);
  const [taskInputPercorso, setTaskInputPercorso] = useState('');
  const [isPickingTaskAttachment, setIsPickingTaskAttachment] = useState(false);
  const [isCommessaDropdownOpen, setIsCommessaDropdownOpen] = useState(false);
  const [commessaSearchText, setCommessaSearchText] = useState('');
  const [isColleaguesDropdownOpen, setIsColleaguesDropdownOpen] = useState(false);
  const [colleagueSearchText, setColleagueSearchText] = useState('');
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [localToast, setLocalToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const commessaDropdownRef = useRef<HTMLDivElement>(null);
  const colleaguesDropdownRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setLocalToast({ message, type });
    setTimeout(() => {
      setLocalToast(null);
    }, 4000);
  };

  // Chiudi i menu a tendina se si clicca fuori
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (commessaDropdownRef.current && !commessaDropdownRef.current.contains(e.target as Node)) {
        setIsCommessaDropdownOpen(false);
      }
      if (colleaguesDropdownRef.current && !colleaguesDropdownRef.current.contains(e.target as Node)) {
        setIsColleaguesDropdownOpen(false);
        setColleagueSearchText('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Inizializzazione o reset all'apertura del modale
  useEffect(() => {
    if (!isOpen) return;

    if (editingTask) {
      setTaskCategoria(editingTask.categoria || TODO_CATEGORIE[0] || 'da fare');
      setTaskPriorita(editingTask.priorita || 'Standard');
      setTaskCommessaId(fixedCommessaId || editingTask.commessaId || '');
      setTaskTitolo(editingTask.titolo || '');
      setTaskDescrizione(editingTask.descrizione || '');
      let assignees: string[] = [];
      if (Array.isArray(editingTask.assegnatiA) && editingTask.assegnatiA.length > 0) {
        assignees = [...editingTask.assegnatiA];
      } else if (editingTask.assegnatoA) {
        assignees = editingTask.assegnatoA.split(',').map(s => s.trim()).filter(Boolean);
      }
      setTaskAssegnatiA(assignees);
      setTaskScadenza(editingTask.scadenza || '');
      setTaskAllegati(getTodoAttachments(editingTask));
    } else {
      setTaskCategoria(TODO_CATEGORIE[0] || 'da fare');
      setTaskPriorita('Standard'); // Default richiesto Standard
      setTaskCommessaId(fixedCommessaId || '');
      setTaskTitolo('');
      setTaskDescrizione('');
      setTaskAssegnatiA(myAssociatedName ? [myAssociatedName] : (dipendenti && dipendenti[0]?.nome ? [dipendenti[0].nome] : []));
      setTaskScadenza(defaultDate || '');
      setTaskAllegati([]);
    }

    setTaskInputPercorso('');
    setIsPickingTaskAttachment(false);
    setIsCommessaDropdownOpen(false);
    setCommessaSearchText('');
    setIsColleaguesDropdownOpen(false);
    setColleagueSearchText('');
    setLocalToast(null);
  }, [isOpen, editingTask, fixedCommessaId, defaultDate, myAssociatedName, dipendenti]);

  // Commesse aperte in cui l'utente è coinvolto (usate solo quando la commessa non è bloccata)
  const availableCommesseForTask = useMemo(() => {
    if (isCommessaLocked) return [];
    const precomputedAssignedIds = getAssignedCommessaIdsForUser(myAssociatedName, assegnazioni);
    return (commesse || []).filter(c => {
      if (editingTask && editingTask.commessaId === c.id) return true;
      if (c.stato === 'Chiusa') return false;
      return isUserInvolvedInCommessa(c, myAssociatedName, userEmail, assegnazioni, precomputedAssignedIds);
    });
  }, [commesse, editingTask, myAssociatedName, userEmail, assegnazioni, isCommessaLocked]);

  // Commessa attualmente selezionata
  const selectedTaskCommessaObj = useMemo(() => {
    const targetId = fixedCommessaId || taskCommessaId;
    if (!targetId) return null;
    return (commesse || []).find(c => c.id === targetId) || null;
  }, [commesse, fixedCommessaId, taskCommessaId]);

  // Risorse che lavorano alla commessa selezionata
  const eligibleDipendentiForTask = useMemo(() => {
    if (!selectedTaskCommessaObj) {
      return dipendenti || [];
    }
    const filtered = getEligibleAssigneesForCommessa(selectedTaskCommessaObj, dipendenti || [], assegnazioni);
    if (filtered.length === 0) {
      return dipendenti || [];
    }
    return filtered;
  }, [selectedTaskCommessaObj, dipendenti, assegnazioni]);

  // Risorse disponibili nel dropdown: strettamente limitate al team commessa se c'è una commessa
  const availableDipendentiForTask = useMemo(() => {
    if (!selectedTaskCommessaObj) {
      return dipendenti || [];
    }
    return eligibleDipendentiForTask;
  }, [selectedTaskCommessaObj, dipendenti, eligibleDipendentiForTask]);

  // Risorse non ancora selezionate
  const unselectedDipendenti = useMemo(() => {
    return availableDipendentiForTask.filter(d => !taskAssegnatiA.includes(d.nome));
  }, [availableDipendentiForTask, taskAssegnatiA]);

  // Risorse filtrate per ricerca testuale
  const filteredDipendentiForTaskModal = useMemo(() => {
    const q = colleagueSearchText.toLowerCase().trim();
    if (!q) return unselectedDipendenti;
    return unselectedDipendenti.filter(d => (d.nome || '').toLowerCase().includes(q));
  }, [unselectedDipendenti, colleagueSearchText]);

  // Commesse filtrate per ricerca testuale
  const filteredCommesseForTaskModal = useMemo(() => {
    const q = commessaSearchText.toLowerCase().trim();
    if (!q) return availableCommesseForTask;
    return availableCommesseForTask.filter(c => {
      const matchName = (c.nome || '').toLowerCase().includes(q);
      const matchCod = (c.codiceCommessa || '').toLowerCase().includes(q);
      const matchClient = (c.cliente || '').toLowerCase().includes(q);
      return matchName || matchCod || matchClient;
    });
  }, [availableCommesseForTask, commessaSearchText]);

  // Gestione allegati nativi Windows
  const handlePickTaskAttachment = (mode: 'file' | 'folder') => {
    setIsPickingTaskAttachment(true);
    showToast(mode === 'folder' ? "📁 Seleziona la cartella nella finestra di Windows (\\\\srvapp\\home)..." : "📄 Seleziona il file nella finestra di Windows (\\\\srvapp\\home)...", "warning");
    triggerNativePicker(mode, (path) => {
      const parsed = parseAttachmentPath(path, mode === 'folder' ? 'cartella' : undefined);
      if (parsed) {
        if (!parsed.isCondiviso) {
          showToast("⚠️ Il percorso si trova su un disco locale (C:\\). Seleziona file o cartelle su \\\\srvapp\\home", "warning");
          setIsPickingTaskAttachment(false);
          return;
        }
        setTaskAllegati(prev => {
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
          showToast(`Aggiunto: ${parsed.nome}`, "success");
          return [...prev, newAtt];
        });
      }
      setIsPickingTaskAttachment(false);
    });
  };

  const handleAddManualTaskAttachment = () => {
    const raw = taskInputPercorso.trim();
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
    setTaskAllegati(prev => {
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
      showToast(`Aggiunto: ${parsed.nome}`, "success");
      return [...prev, newAtt];
    });
    setTaskInputPercorso('');
  };

  const handleRemoveTaskAttachment = (id: string) => {
    setTaskAllegati(prev => prev.filter(a => a.id !== id));
  };

  // Salvataggio attività
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitolo.trim()) {
      showToast("Inserisci le istruzioni dell'attività.", "warning");
      return;
    }
    if (taskAssegnatiA.length === 0) {
      showToast("Seleziona almeno una persona incaricata.", "warning");
      return;
    }
    const hasLocal = taskAllegati.some(a => !isSharedNetworkPath(a.percorso));
    if (hasLocal) {
      showToast("⚠️ I file o le cartelle collegate devono risiedere sul server aziendale (\\\\srvapp\\home) e non su un disco locale (C:\\).", "warning");
      return;
    }

    const effectiveCommessaId = isCommessaLocked ? fixedCommessaId : (taskCommessaId ? taskCommessaId : null);

    setIsSavingTask(true);
    try {
      const effectiveName = myAssociatedName || getAssociatedNameFromEmail(userEmail, dipendenti) || userEmail || 'Utente';

      const saved = await saveUnifiedTodo(
          {
            id: editingTask?.id,
            commessaId: effectiveCommessaId,
            titolo: taskTitolo,
            descrizione: taskDescrizione,
            categoria: taskCategoria,
            priorita: taskPriorita,
            scadenza: taskScadenza || undefined,
            assegnatiA: taskAssegnatiA,
            assegnatoA: taskAssegnatiA.join(', '),
            stato: editingTask ? editingTask.stato : 'da_fare',
            allegati: taskAllegati
          },
          {
            name: effectiveName,
            email: userEmail || ''
          },
          dipendenti || [],
          commesse || []
        );

        if (saved.tipo === 'commessa' && saved.commessaId && updateCommessaPunchList) {
          const target = commesse.find(c => c.id === saved.commessaId);
          if (target && target.punchList) {
            updateCommessaPunchList(saved.commessaId, [...target.punchList]);
          }
        }

        if (onTaskSaved) {
          onTaskSaved(saved);
        }

      onClose();
    } catch (err: any) {
      console.error("Errore salvataggio task:", err);
      showToast("Errore durante il salvataggio: " + (err.message || 'Errore imprevisto'), "error");
    } finally {
      setIsSavingTask(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] flex items-center justify-center p-3 sm:p-5 overflow-hidden">
      <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200 max-h-[94vh] flex flex-col overflow-hidden relative">
        
        {/* Toast interno */}
        {localToast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100000] px-4 py-2 rounded-2xl shadow-xl text-xs font-black flex items-center gap-2 animate-in fade-in slide-in-from-top duration-200 bg-slate-900 text-white border border-slate-700">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{localToast.message}</span>
          </div>
        )}

        {/* Header Fisso */}
        <div className="px-6 py-4 sm:px-8 sm:py-5 border-b border-gray-150 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
              <ListTodo className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-gray-900 leading-tight truncate">
                  {editingTask ? 'Modifica Attività' : 'Nuova Attività ToDo'}
                </h3>
                {isCommessaLocked && selectedTaskCommessaObj && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-150 shrink-0">
                    <Lock className="w-3 h-3 text-indigo-500" />
                    <span>Commessa fissa</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 font-medium truncate">
                {selectedTaskCommessaObj 
                  ? formatCommessaDisplay(selectedTaskCommessaObj.nome, selectedTaskCommessaObj.codiceCommessa)
                  : (editingTask ? 'Aggiorna i dettagli o le scadenze del compito' : 'Crea un nuovo promemoria o compito operativo')}
              </p>

            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition cursor-pointer shrink-0 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSaveTask} className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Contenuto Scrollabile Internamente */}
          <div className="p-5 sm:p-7 overflow-y-auto custom-scrollbar flex-1 space-y-4">
            
            {/* 1. Riga Superiore: Categoria & Commessa di Riferimento */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              
              {/* Categoria */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Categoria
                </label>
                <select
                  value={taskCategoria}
                  onChange={e => setTaskCategoria(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300 cursor-pointer"
                >
                  {TODO_CATEGORIE.map(cat => (
                    <option key={cat} value={cat}>{cat.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              {/* Commessa di Riferimento */}
              <div className="relative" ref={commessaDropdownRef}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    {isCommessaLocked ? 'Commessa di riferimento' : 'Commessa di riferimento (Opzionale)'}
                  </label>
                  {!isCommessaLocked && taskCommessaId && (
                    <button
                      type="button"
                      onClick={() => {
                        setTaskCommessaId('');
                        setCommessaSearchText('');
                      }}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer flex items-center gap-0.5"
                    >
                      <X className="w-3 h-3" />
                      <span>Rimuovi</span>
                    </button>
                  )}
                </div>

                {isCommessaLocked ? (
                  /* Commessa Bloccata (Pianificazione Commesse): Sola Lettura con Icona Lucchetto */
                  <div className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-250 rounded-xl text-xs font-bold text-gray-800 flex items-center justify-between gap-2 shadow-2xs">
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                      <Briefcase className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span className="truncate">
                        {selectedTaskCommessaObj?.codiceCommessa && (
                          <span className="font-mono text-indigo-700 mr-1.5 font-black">
                            [{selectedTaskCommessaObj.codiceCommessa}]
                          </span>
                        )}
                        <span className="font-extrabold">{getCommessaTitleWithoutCode(selectedTaskCommessaObj?.nome, selectedTaskCommessaObj?.codiceCommessa) || 'Commessa selezionata'}</span>
                      </span>
                      {selectedTaskCommessaObj?.cliente && (
                        <span className="text-[10px] text-gray-500 font-normal truncate shrink-0">
                          ({selectedTaskCommessaObj.cliente})
                        </span>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-indigo-800 bg-indigo-100/70 border border-indigo-200 px-2 py-0.5 rounded-lg shrink-0">
                      <Lock className="w-3 h-3" />
                      <span>Bloccata</span>
                    </span>
                  </div>
                ) : (
                  /* Bottone Trigger Dropdown Normale (Nuova Sezione ToDo) */
                  <>
                    <button
                      type="button"
                      title={selectedTaskCommessaObj ? formatCommessaDisplay(selectedTaskCommessaObj.nome, selectedTaskCommessaObj.codiceCommessa) + (selectedTaskCommessaObj.cliente ? ` (Cliente: ${selectedTaskCommessaObj.cliente})` : '') : 'Nessuna commessa (Attività generica)'}
                      onClick={() => {
                        setIsCommessaDropdownOpen(prev => !prev);
                        setIsColleaguesDropdownOpen(false);
                        if (!isCommessaDropdownOpen) {
                          setCommessaSearchText('');
                        }
                      }}
                      className={`w-full px-3.5 py-2.5 bg-gray-50 border ${isCommessaDropdownOpen ? 'border-indigo-400 ring-2 ring-indigo-200 bg-white' : 'border-gray-200 hover:border-gray-300'} rounded-xl text-xs font-bold text-gray-900 outline-none flex items-center justify-between transition cursor-pointer text-left`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                        {selectedTaskCommessaObj ? (
                          <>
                            <Briefcase className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="truncate">
                              {selectedTaskCommessaObj.codiceCommessa ? (
                                <span className="font-mono text-indigo-600 mr-1.5 font-extrabold">[{selectedTaskCommessaObj.codiceCommessa}]</span>
                              ) : null}
                              {getCommessaTitleWithoutCode(selectedTaskCommessaObj.nome, selectedTaskCommessaObj.codiceCommessa)}
                            </span>
                            {selectedTaskCommessaObj.cliente && (
                              <span className="text-[10px] text-gray-400 font-normal truncate shrink-0">
                                ({selectedTaskCommessaObj.cliente})
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-500 font-normal">
                            Nessuna commessa (Attività generica)
                          </span>
                        )}
                      </div>

                      <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${isCommessaDropdownOpen ? 'rotate-180 text-indigo-600' : ''}`} />
                    </button>

                    {/* Menu a Tendina con Ricerca */}
                    {isCommessaDropdownOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-indigo-200 rounded-2xl shadow-2xl z-50 p-2.5 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
                        <div className="relative shrink-0">
                          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Cerca per codice, nome o cliente..."
                            value={commessaSearchText}
                            onChange={e => setCommessaSearchText(e.target.value)}
                            autoFocus
                            className="w-full pl-8.5 pr-7 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 placeholder-gray-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                          />
                          {commessaSearchText && (
                            <button
                              type="button"
                              onClick={() => setCommessaSearchText('')}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="max-h-52 overflow-y-auto custom-scrollbar divide-y divide-gray-100 flex flex-col">
                          <button
                            type="button"
                            title="Nessuna commessa (Attività generica)"
                            onClick={() => {
                              setTaskCommessaId('');
                              setIsCommessaDropdownOpen(false);
                              setCommessaSearchText('');
                            }}
                            className={`px-3 py-2 text-left text-xs rounded-xl flex items-center justify-between transition cursor-pointer ${!taskCommessaId ? 'bg-indigo-50/80 text-indigo-900 font-bold' : 'hover:bg-gray-50 text-gray-600 font-medium'}`}
                          >
                            <span className="italic">Nessuna commessa (Attività generica)</span>
                            {!taskCommessaId && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                          </button>

                          {filteredCommesseForTaskModal.length === 0 ? (
                            <div className="p-3 text-center text-xs text-gray-400 italic">
                              Nessuna commessa trovata per &quot;{commessaSearchText}&quot;
                            </div>
                          ) : (
                            filteredCommesseForTaskModal.map(c => {
                              const isSelected = taskCommessaId === c.id;
                              const fullText = `${c.codiceCommessa ? `[${c.codiceCommessa}] ` : ''}${c.nome}${c.cliente ? ` — Cliente: ${c.cliente}` : ''}`;
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  title={fullText}
                                  onClick={() => {
                                    setTaskCommessaId(c.id);
                                    setIsCommessaDropdownOpen(false);
                                    setCommessaSearchText('');
                                  }}
                                  className={`px-3 py-2 text-left text-xs rounded-xl flex items-center justify-between gap-2 transition cursor-pointer ${isSelected ? 'bg-indigo-50/80 text-indigo-900 font-bold' : 'hover:bg-gray-50 text-gray-700'}`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      {c.codiceCommessa && (
                                        <span className="font-mono text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold shrink-0">
                                          {c.codiceCommessa}
                                        </span>
                                      )}
                                      <span className="truncate font-semibold">{getCommessaTitleWithoutCode(c.nome, c.codiceCommessa)}</span>
                                    </div>

                                    {c.cliente && (
                                      <div className="text-[10px] text-gray-400 truncate mt-0.5">
                                        Cliente: {c.cliente}
                                      </div>
                                    )}
                                  </div>
                                  {isSelected && (
                                    <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0 ml-2" />
                                  )}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <span className="text-[10px] text-gray-400 font-medium block mt-1">
                  {isCommessaLocked 
                    ? 'Attività vincolata a questa commessa.'
                    : 'Mostra solo le commesse aperte in cui sei coinvolto.'}
                </span>
              </div>
            </div>

            {/* 2. Istruzioni (Titolo Attività) a piena larghezza */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Istruzioni *
              </label>
              <input
                type="text"
                required
                value={taskTitolo}
                onChange={e => setTaskTitolo(e.target.value)}
                placeholder="Scrivi qui le istruzioni..."
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300 transition"
              />
            </div>

            {/* 3. Sezione Inferiore Bilanciata a 2 Colonne */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 items-start">
              
              {/* Colonna Sinistra: Multi-Assegnatari & Scadenza */}
              <div className="space-y-3.5">
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
                  <div className="flex flex-wrap gap-1.5 p-2 bg-gray-50 border border-gray-200 rounded-xl min-h-[38px] items-center">
                    {taskAssegnatiA.length === 0 ? (
                      <span className="text-xs text-gray-400 font-medium italic pl-1">
                        Nessuna persona selezionata
                      </span>
                    ) : (
                      taskAssegnatiA.map(name => (
                        <span 
                          key={name}
                          className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-lg shadow-2xs"
                        >
                          <User className="w-3 h-3 text-indigo-500 shrink-0" />
                          <span>{name}</span>
                          <button
                            type="button"
                            onClick={() => setTaskAssegnatiA(prev => prev.filter(n => n !== name))}
                            className="hover:text-red-600 transition cursor-pointer p-0.5"
                            title={`Rimuovi ${name}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  {/* Dropdown per aggiungere colleghi con ricerca */}
                  <div className="mt-1.5 space-y-1 relative" ref={colleaguesDropdownRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsColleaguesDropdownOpen(prev => !prev);
                        setIsCommessaDropdownOpen(false);
                        if (!isColleaguesDropdownOpen) {
                          setColleagueSearchText('');
                        }
                      }}
                      className={`w-full px-3 py-2 bg-white border ${
                        isColleaguesDropdownOpen 
                          ? 'border-indigo-400 ring-2 ring-indigo-200' 
                          : 'border-gray-200 hover:border-gray-300'
                      } rounded-xl text-xs font-semibold text-gray-700 outline-none flex items-center justify-between transition cursor-pointer text-left`}
                    >
                      <span className="truncate text-gray-600">
                        {selectedTaskCommessaObj
                          ? `+ Aggiungi risorsa commessa (${unselectedDipendenti.length} disponibili)...`
                          : "+ Aggiungi un collega..."}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${isColleaguesDropdownOpen ? 'rotate-180 text-indigo-600' : ''}`} />
                    </button>

                    {isColleaguesDropdownOpen && (
                      <div className="absolute left-0 right-0 bottom-full mb-1.5 bg-white border border-indigo-200 rounded-2xl shadow-2xl z-50 p-2.5 flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150 origin-bottom">
                        <div className="relative shrink-0">
                          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Cerca collega per nome..."
                            value={colleagueSearchText}
                            onChange={e => setColleagueSearchText(e.target.value)}
                            autoFocus
                            className="w-full pl-8.5 pr-7 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 placeholder-gray-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300"
                          />
                          {colleagueSearchText && (
                            <button
                              type="button"
                              onClick={() => setColleagueSearchText('')}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="max-h-44 overflow-y-auto custom-scrollbar divide-y divide-gray-100 flex flex-col">
                          {filteredDipendentiForTaskModal.length === 0 ? (
                            <div className="p-3 text-xs text-gray-400 italic text-center font-medium">
                              {unselectedDipendenti.length === 0 
                                ? (selectedTaskCommessaObj 
                                    ? 'Tutte le risorse della commessa sono già state selezionate' 
                                    : 'Tutti i colleghi sono già stati selezionati')
                                : 'Nessun collega trovato'}
                            </div>
                          ) : (
                            filteredDipendentiForTaskModal.map(d => (
                              <button
                                key={d.id || d.nome}
                                type="button"
                                onClick={() => {
                                  if (!taskAssegnatiA.includes(d.nome)) {
                                    setTaskAssegnatiA(prev => [...prev, d.nome]);
                                  }
                                  setIsColleaguesDropdownOpen(false);
                                  setColleagueSearchText('');
                                }}
                                className="px-3 py-2 text-left text-xs rounded-xl flex items-center justify-between hover:bg-indigo-50/80 text-gray-800 hover:text-indigo-900 transition cursor-pointer group"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-6 h-6 rounded-full bg-indigo-50 group-hover:bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                                    <User className="w-3.5 h-3.5" />
                                  </div>
                                  <span className="truncate font-semibold">{d.nome}</span>
                                </div>
                                <span className="text-[10px] text-indigo-600 font-bold opacity-0 group-hover:opacity-100 transition">
                                  + Aggiungi
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Indicatore informativo team commessa (senza possibilità di mostrare altri colleghi) */}
                    {selectedTaskCommessaObj && (
                      <div className="flex items-center text-[11px] px-1 pt-0.5 text-indigo-700 font-medium">
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3 h-3 text-indigo-500" />
                          <span>Team commessa: <strong>{eligibleDipendentiForTask.length}</strong> {eligibleDipendentiForTask.length === 1 ? 'risorsa abilitata' : 'risorse abilitate'}</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Data di Scadenza & Priorità affiancate */}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.35fr] gap-3">
                  {/* Data di Scadenza */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                      Data di Scadenza
                    </label>
                    <input
                      type="date"
                      value={taskScadenza}
                      onChange={e => setTaskScadenza(e.target.value)}
                      className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-300 cursor-pointer"
                    />
                  </div>

                  {/* Priorità */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                        Priorità
                      </label>
                      <span className="text-[10px] text-gray-400 font-medium">
                        {taskPriorita === 'Alta' ? 'Urgente' : taskPriorita === 'Standard' ? 'Predefinita' : 'Differibile'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 bg-gray-100/80 p-1 rounded-xl border border-gray-200">
                      <button
                        type="button"
                        onClick={() => setTaskPriorita('Alta')}
                        className={`flex-1 py-1.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all cursor-pointer text-center whitespace-nowrap ${
                          taskPriorita === 'Alta'
                            ? 'bg-rose-600 text-white shadow-xs'
                            : 'text-gray-600 hover:text-rose-700 hover:bg-rose-50'
                        }`}
                        title="Priorità Alta: compito urgente"
                      >
                        Alta
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskPriorita('Standard')}
                        className={`flex-[1.3] py-1.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all cursor-pointer text-center whitespace-nowrap ${
                          taskPriorita === 'Standard'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-gray-600 hover:text-indigo-700 hover:bg-indigo-50'
                        }`}
                        title="Priorità Standard (predefinita)"
                      >
                        Standard
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskPriorita('Bassa')}
                        className={`flex-1 py-1.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold transition-all cursor-pointer text-center whitespace-nowrap ${
                          taskPriorita === 'Bassa'
                            ? 'bg-sky-600 text-white shadow-xs'
                            : 'text-gray-600 hover:text-sky-800 hover:bg-sky-50'
                        }`}
                        title="Priorità Bassa: compito secondario"
                      >
                        Bassa
                      </button>

                    </div>
                  </div>
                </div>
              </div>

              {/* Colonna Destra: File o Cartelle Collegate */}
              <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-indigo-600" />
                    <span>File o Cartelle Collegate (Opzionale)</span>
                    {taskAllegati.length > 0 && (
                      <span className="text-[10px] font-extrabold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">
                        {taskAllegati.length}
                      </span>
                    )}
                  </label>
                  {taskAllegati.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setTaskAllegati([])}
                      className="text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
                    >
                      Rimuovi tutti
                    </button>
                  )}
                </div>

                {/* Lista degli elementi collegati */}
                {taskAllegati.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto p-1 custom-scrollbar">
                    {taskAllegati.map(att => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between gap-2 p-2 bg-white rounded-xl border border-slate-200 shadow-2xs group"
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
                            className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] rounded-md transition cursor-pointer flex items-center gap-1"
                            title="Verifica apertura in Windows"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>Apri</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveTaskAttachment(att.id)}
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

                {/* Controlli per aggiungere file / cartelle */}
                <div className="space-y-2 pt-0.5">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handlePickTaskAttachment('file')}
                      className="h-9 flex items-center justify-center gap-1.5 px-3 bg-white hover:bg-indigo-50/70 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-300 rounded-xl text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer whitespace-nowrap"
                      title="Sfoglia file sul server aziendale (\\srvapp\home)"
                    >
                      <File className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>{taskAllegati.length > 0 ? '+ Altro File...' : 'Sfoglia File...'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePickTaskAttachment('folder')}
                      className="h-9 flex items-center justify-center gap-1.5 px-3 bg-white hover:bg-indigo-50/70 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-300 rounded-xl text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer whitespace-nowrap"
                      title="Sfoglia cartelle sul server aziendale (\\srvapp\home)"
                    >
                      <FolderOpen className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{taskAllegati.length > 0 ? '+ Altra Cartella...' : 'Sfoglia Cartella...'}</span>
                    </button>
                  </div>

                  {isPickingTaskAttachment && (
                    <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50 p-2 rounded-xl border border-indigo-100 animate-pulse">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>Finestra aperta in Windows... Seleziona l&apos;elemento e tornerai qui automaticamente!</span>
                    </div>
                  )}

                  {/* Barra inserimento manuale percorso */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={taskInputPercorso}
                      onChange={e => setTaskInputPercorso(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddManualTaskAttachment();
                        }
                      }}
                      placeholder="Oppure incolla percorso server (es. \\srvapp\home\...)"
                      className="flex-1 px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-mono text-gray-700 placeholder-gray-400 outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                    <button
                      type="button"
                      onClick={handleAddManualTaskAttachment}
                      disabled={!taskInputPercorso.trim()}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition shrink-0 cursor-pointer shadow-2xs"
                    >
                      Aggiungi
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Fisso con Bottoni */}
          <div className="px-6 py-4 sm:px-8 sm:py-4 border-t border-gray-150 flex justify-end items-center gap-3 shrink-0 bg-gray-50/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl font-bold text-xs text-gray-600 hover:bg-gray-200/70 transition cursor-pointer"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={isSavingTask}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-xs transition shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              {isSavingTask ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Salvataggio...</span>
                </>
              ) : (
                <span>{editingTask ? 'Salva Modifiche' : 'Crea Attività'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
