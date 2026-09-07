import { db } from './firebase';
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where
} from 'firebase/firestore';
import { createUserNotification } from '../utils/userNotificationService';
import { areNamesEqual } from '../contexts/AuthContext';

export const TODO_CATEGORIE = [
  'aggiornare',
  'archiviare',
  'attesa feedback',
  'chiamare',
  'consegnare',
  'da fare',
  'effettuare revisione',
  'fatturare',
  'firmare',
  'fissare appuntamento',
  'inviare mail',
  'ordinare',
  'pagare',
  'prenotare',
  'registrare',
  'rispondere',
  'scansionare',
  'stampare'
] as const;

export type ToDoCategoria = typeof TODO_CATEGORIE[number];

export interface UnifiedTodoItem {
  id: string;
  tipo: 'commessa' | 'generico';
  commessaId?: string;
  commessaNome?: string;
  commessaCodice?: string;
  titolo: string;
  descrizione?: string;
  categoria: string;
  scadenza?: string; // YYYY-MM-DD
  assegnatiA: string[]; // Lista multi-assegnatari
  assegnatoA: string;   // Stringa retrocompatibile
  creatoDa: string;
  creatoDaEmail?: string;
  creatoIl: string;
  stato: 'da_fare' | 'completato';
  completatoDa?: string;
  completatoIl?: string;
}

export interface NotaPersonale {
  id: string;
  userEmail: string;
  titolo: string;
  contenuto: string;
  colore: 'giallo' | 'blu' | 'verde' | 'rosa' | 'viola' | 'grigio';
  fissata?: boolean;
  creataIl: string;
  aggiornataIl: string;
}

// Configurazione grafica e colori per le 18 categorie
export function getCategoryBadgeProps(cat?: string): { label: string; bg: string; text: string; border: string; icon: string } {
  const c = (cat || 'da fare').toLowerCase().trim();
  switch (c) {
    case 'chiamare':
      return { label: 'Chiamare', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '📞' };
    case 'inviare mail':
      return { label: 'Inviare Mail', bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', icon: '✉️' };
    case 'consegnare':
      return { label: 'Consegnare', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: '📦' };
    case 'firmare':
      return { label: 'Firmare', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: '✍️' };
    case 'fatturare':
      return { label: 'Fatturare', bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', icon: '💶' };
    case 'pagare':
      return { label: 'Pagare', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', icon: '💳' };
    case 'effettuare revisione':
      return { label: 'Revisione', bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: '🔍' };
    case 'aggiornare':
      return { label: 'Aggiornare', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: '🔄' };
    case 'ordinare':
      return { label: 'Ordinare', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: '🛒' };
    case 'prenotare':
      return { label: 'Prenotare', bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', icon: '📅' };
    case 'fissare appuntamento':
      return { label: 'Appuntamento', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', icon: '🤝' };
    case 'attesa feedback':
      return { label: 'Attesa Feedback', bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200', icon: '⏳' };
    case 'archiviare':
      return { label: 'Archiviare', bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', icon: '📁' };
    case 'registrare':
      return { label: 'Registrare', bg: 'bg-lime-50', text: 'text-lime-700', border: 'border-lime-200', icon: '📝' };
    case 'rispondere':
      return { label: 'Rispondere', bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200', icon: '💬' };
    case 'stampare':
      return { label: 'Stampare', bg: 'bg-stone-50', text: 'text-stone-700', border: 'border-stone-200', icon: '🖨️' };
    case 'scansionare':
      return { label: 'Scansionare', bg: 'bg-zinc-50', text: 'text-zinc-700', border: 'border-zinc-200', icon: '📄' };
    case 'da fare':
    default:
      return { label: 'Da Fare', bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', icon: '📋' };
  }
}

// ==========================================
// HELPER DI AUTORIZZAZIONE E INCLUSIONE
// ==========================================

/**
 * Verifica se un utente è assegnatario di un compito
 */
export function isTaskAssignee(
  task: { assegnatiA?: string[]; assegnatoA?: string },
  myAssociatedName?: string | null
): boolean {
  if (!myAssociatedName || !myAssociatedName.trim()) return false;
  const list: string[] = [];
  if (Array.isArray(task.assegnatiA) && task.assegnatiA.length > 0) {
    list.push(...task.assegnatiA);
  } else if (task.assegnatoA && typeof task.assegnatoA === 'string') {
    task.assegnatoA.split(',').forEach(s => {
      const trimmed = s.trim();
      if (trimmed) list.push(trimmed);
    });
  }
  return list.some(a => areNamesEqual(a, myAssociatedName));
}

/**
 * Verifica se un utente è il creatore originario di un compito
 */
export function isTaskCreator(
  task: { creatoDa?: string; creatoDaEmail?: string },
  myAssociatedName?: string | null,
  userEmail?: string | null
): boolean {
  const cleanEmail = (userEmail || '').toLowerCase().trim();
  if (cleanEmail && task.creatoDaEmail && task.creatoDaEmail.toLowerCase().trim() === cleanEmail) {
    return true;
  }
  if (myAssociatedName && task.creatoDa && areNamesEqual(task.creatoDa, myAssociatedName)) {
    return true;
  }
  if (cleanEmail && task.creatoDa && task.creatoDa.toLowerCase().trim() === cleanEmail) {
    return true;
  }
  return false;
}

/**
 * Verifica se l'utente è coinvolto su una commessa:
 * - Responsabile della commessa
 * - Project Manager (PM)
 * - Abilitato extra
 * - Presente nella griglia pianificazione/assegnazioni
 * - Inserito in comm.assegnati
 * - Assegnatario o creatore di almeno un ToDo nella punchList della commessa
 */
export function isUserInvolvedInCommessa(
  comm: any,
  myAssociatedName?: string | null,
  userEmail?: string | null,
  assegnazioni?: Record<string, any[]>
): boolean {
  if (!comm) return false;
  const cleanName = (myAssociatedName || '').trim();
  const cleanEmail = (userEmail || '').toLowerCase().trim();

  // 1. Responsabile di Commessa
  if (comm.responsabile && cleanName && areNamesEqual(comm.responsabile, cleanName)) {
    return true;
  }

  // 2. Project Manager (PM) (singolo o multiplo)
  const pms: string[] = Array.isArray(comm.pm) ? comm.pm : (comm.pm ? [comm.pm] : []);
  if (cleanName && pms.some(p => areNamesEqual(p, cleanName))) {
    return true;
  }

  // 3. Abilitati Extra
  const extraList: string[] = Array.isArray(comm.abilitatiExtra) ? comm.abilitatiExtra : (comm.abilitatiExtra ? [comm.abilitatiExtra] : []);
  if (cleanName && extraList.some(e => areNamesEqual(e, cleanName) || (cleanEmail && String(e).toLowerCase().includes(cleanEmail)))) {
    return true;
  }

  // 4. Assegnati direttamente nel record commessa
  if (Array.isArray(comm.assegnati) && cleanName) {
    if (comm.assegnati.some((a: any) => {
      const aName = typeof a === 'string' ? a : (a?.nome || a?.name);
      return aName && areNamesEqual(aName, cleanName);
    })) {
      return true;
    }
  }

  // 5. Pianificato nella griglia assegnazioni settimanali
  if (assegnazioni && cleanName) {
    for (const [key, list] of Object.entries(assegnazioni)) {
      if (!Array.isArray(list)) continue;
      const dipName = key.split('-')[0];
      if (areNamesEqual(dipName, cleanName)) {
        if (list.some(a => a && a.commessaId === comm.id && Number(a.percentuale) > 0)) {
          return true;
        }
      }
    }
  }

  // 6. Assegnatario o creatore di almeno un ToDo dentro la punchList di questa commessa
  if (Array.isArray(comm.punchList) && (cleanName || cleanEmail)) {
    if (comm.punchList.some((p: any) => {
      const isAss = isTaskAssignee(p, cleanName);
      const isCre = isTaskCreator(p, cleanName, cleanEmail);
      return isAss || isCre;
    })) {
      return true;
    }
  }

  return false;
}

/**
 * Verifica se l'utente ha diritto di modificare o eliminare un ToDo:
 * - Per i task generici: SOLO chi ha creato il task.
 * - Per i task di commessa: il creatore del task, OPPURE il Responsabile di commessa, OPPURE il PM di commessa.
 */
export function canUserManageTask(
  task: { tipo?: string; commessaId?: string | null; creatoDa?: string; creatoDaEmail?: string },
  myAssociatedName?: string | null,
  userEmail?: string | null,
  commesseList: any[] = []
): boolean {
  // Il creatore può sempre modificare ed eliminare
  if (isTaskCreator(task, myAssociatedName, userEmail)) {
    return true;
  }

  // Se è un task legato a una commessa, possono modificare/eliminare anche il Responsabile e il PM
  if (task.commessaId) {
    const comm = commesseList.find(c => c.id === task.commessaId);
    if (comm) {
      const cleanName = (myAssociatedName || '').trim();
      if (cleanName) {
        if (comm.responsabile && areNamesEqual(comm.responsabile, cleanName)) {
          return true;
        }
        const pms: string[] = Array.isArray(comm.pm) ? comm.pm : (comm.pm ? [comm.pm] : []);
        if (pms.some(p => areNamesEqual(p, cleanName))) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Recupera tutti i ToDo unificati visibili per l'utente attivo:
 * - Per le commesse: solo quelle su cui l'utente è coinvolto (o se il task è assegnato/creato dall'utente).
 * - Per i compiti generici: solo quelli assegnati all'utente o da lui creati.
 * (La regola si applica a tutti i profili).
 */
// ==========================================
// CACHE IN-MEMORY RAPIDA (ZERO-DELAY)
// ==========================================
let cachedGenericTodosRaw: Array<{ id: string; data: any }> | null = null;
let lastGenericTodosFetch = 0;
const GENERIC_TODOS_CACHE_TTL = 60 * 1000; // 60 secondi di validità cache

export function invalidateGenericTodosCache() {
  cachedGenericTodosRaw = null;
  lastGenericTodosFetch = 0;
}

/**
 * Costruisce l'elenco dei ToDo unificati a partire dai dati già in memoria
 */
export function buildUnifiedTodosFromData(
  commesseList: any[],
  genericDocs: Array<{ id: string; data: any }>,
  myAssociatedName?: string | null,
  userEmail?: string | null,
  assegnazioni?: Record<string, any[]>
): UnifiedTodoItem[] {
  const unified: UnifiedTodoItem[] = [];

  // 1. Estrai i ToDo dalle sole commesse abilitate per l'utente
  commesseList.forEach(c => {
    const userInvolved = isUserInvolvedInCommessa(c, myAssociatedName, userEmail, assegnazioni);
    const pList = c.punchList;
    if (Array.isArray(pList)) {
      pList.forEach(p => {
        if (!p || !p.titolo) return;

        const isAss = isTaskAssignee(p, myAssociatedName);
        const isCre = isTaskCreator(p, myAssociatedName, userEmail);

        if (!userInvolved && !isAss && !isCre) {
          return;
        }

        const statoClean = (p.stato === 'completato' || p.stato === 'eseguito') ? 'completato' : 'da_fare';
        
        let assegnatiList: string[] = [];
        if (Array.isArray(p.assegnatiA) && p.assegnatiA.length > 0) {
          assegnatiList = p.assegnatiA.map((a: any) => String(a).trim()).filter(Boolean);
        } else if (p.assegnatoA && typeof p.assegnatoA === 'string') {
          assegnatiList = p.assegnatoA.split(',').map((s: string) => s.trim()).filter(Boolean);
        }

        unified.push({
          id: p.id || `task_${Math.random()}`,
          tipo: 'commessa',
          commessaId: c.id,
          commessaNome: c.nome || 'Commessa',
          commessaCodice: c.codiceCommessa || '',
          titolo: p.titolo,
          descrizione: p.descrizione,
          categoria: p.categoria || 'da fare',
          scadenza: p.scadenza,
          assegnatiA: assegnatiList,
          assegnatoA: assegnatiList.length > 0 ? assegnatiList.join(', ') : (p.assegnatoA || 'Non assegnato'),
          creatoDa: p.creatoDa || 'Utente',
          creatoDaEmail: p.creatoDaEmail,
          creatoIl: p.creatoIl || new Date().toISOString(),
          stato: statoClean,
          completatoDa: p.completatoDa,
          completatoIl: p.completatoIl
        });
      });
    }
  });

  // 2. Estrai i ToDo Generici
  genericDocs.forEach(docSnap => {
    const d = docSnap.data;

    let assegnatiList: string[] = [];
    if (Array.isArray(d.assegnatiA) && d.assegnatiA.length > 0) {
      assegnatiList = d.assegnatiA.map((a: any) => String(a).trim()).filter(Boolean);
    } else if (d.assegnatoA && typeof d.assegnatoA === 'string') {
      assegnatiList = d.assegnatoA.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    const isAssignee = isTaskAssignee({ assegnatiA: assegnatiList, assegnatoA: d.assegnatoA }, myAssociatedName);
    const isCreator = isTaskCreator(d, myAssociatedName, userEmail);

    if (isAssignee || isCreator) {
      const statoClean = (d.stato === 'completato' || d.stato === 'eseguito') ? 'completato' : 'da_fare';
      unified.push({
        id: docSnap.id,
        tipo: 'generico',
        titolo: d.titolo || '',
        descrizione: d.descrizione,
        categoria: d.categoria || 'da fare',
        scadenza: d.scadenza,
        assegnatiA: assegnatiList,
        assegnatoA: assegnatiList.length > 0 ? assegnatiList.join(', ') : (d.assegnatoA || 'Non assegnato'),
        creatoDa: d.creatoDa || 'Utente',
        creatoDaEmail: d.creatoDaEmail,
        creatoIl: d.creatoIl || new Date().toISOString(),
        stato: statoClean,
        completatoDa: d.completatoDa,
        completatoIl: d.completatoIl
      });
    }
  });

  // 3. Ordinamento globale
  return unified.sort((a, b) => {
    if (a.stato === 'da_fare' && b.stato === 'completato') return -1;
    if (a.stato === 'completato' && b.stato === 'da_fare') return 1;

    if (a.stato === 'da_fare' && b.stato === 'da_fare') {
      if (a.scadenza && !b.scadenza) return -1;
      if (!a.scadenza && b.scadenza) return 1;
      if (a.scadenza && b.scadenza) {
        return a.scadenza.localeCompare(b.scadenza);
      }
      return (b.creatoIl || '').localeCompare(a.creatoIl || '');
    }

    const dateA = a.completatoIl || a.creatoIl || '';
    const dateB = b.completatoIl || b.creatoIl || '';
    return dateB.localeCompare(dateA);
  });
}

/**
 * Ritorna istantaneamente i ToDo sincronizzati se la cache in memoria è già pronta (0ms)
 */
export function getCachedUnifiedTodos(options: {
  userEmail?: string | null;
  myAssociatedName?: string | null;
  commesseList?: any[];
  assegnazioni?: Record<string, any[]>;
}): UnifiedTodoItem[] | null {
  if (!cachedGenericTodosRaw || !options.userEmail) return null;
  return buildUnifiedTodosFromData(
    options.commesseList || [],
    cachedGenericTodosRaw,
    options.myAssociatedName,
    options.userEmail,
    options.assegnazioni
  );
}

/**
 * Recupera tutti i ToDo unificati visibili per l'utente attivo:
 * - Per le commesse: solo quelle su cui l'utente è coinvolto (o se il task è assegnato/creato dall'utente).
 * - Per i compiti generici: solo quelli assegnati all'utente o da lui creati.
 * (Sfrutta la cache in-memory con TTL 60s per abbattere la latenza di rete a zero).
 */
export async function fetchUnifiedTodos(options: {
  userEmail: string;
  myAssociatedName?: string;
  commesseList: any[];
  assegnazioni?: Record<string, any[]>;
  isAdmin?: boolean;
  isSoci?: boolean;
  forceRefresh?: boolean;
}): Promise<UnifiedTodoItem[]> {
  const { userEmail, myAssociatedName, commesseList, assegnazioni, forceRefresh } = options;

  const now = Date.now();
  let rawDocs = cachedGenericTodosRaw;
  if (!rawDocs || forceRefresh || (now - lastGenericTodosFetch > GENERIC_TODOS_CACHE_TTL)) {
    try {
      const snap = await getDocs(collection(db, 'todos_generici'));
      rawDocs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
      cachedGenericTodosRaw = rawDocs;
      lastGenericTodosFetch = now;
    } catch (err) {
      console.error("Errore fetch todos_generici:", err);
      rawDocs = rawDocs || [];
    }
  }

  return buildUnifiedTodosFromData(
    commesseList || [],
    rawDocs,
    myAssociatedName,
    userEmail,
    assegnazioni
  );
}

/**
 * Salva o aggiorna un ToDo (sia legato a commessa che generico)
 */
export async function saveUnifiedTodo(
  task: {
    id?: string;
    commessaId?: string | null;
    titolo: string;
    descrizione?: string;
    categoria: string;
    scadenza?: string;
    assegnatiA?: string[];
    assegnatoA?: string;
    stato?: 'da_fare' | 'completato';
  },
  currentUser: {
    name: string;
    email: string;
  },
  dipendentiList: any[] = [],
  commesseList: any[] = []
): Promise<UnifiedTodoItem> {
  const taskId = task.id || `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const nowIso = new Date().toISOString();
  const stato = task.stato || 'da_fare';

  // Calcola array assegnatari e stringa retrocompatibile
  let assignedArray: string[] = [];
  if (Array.isArray(task.assegnatiA) && task.assegnatiA.length > 0) {
    assignedArray = task.assegnatiA.map(a => String(a).trim()).filter(Boolean);
  } else if (task.assegnatoA && typeof task.assegnatoA === 'string') {
    assignedArray = task.assegnatoA.split(',').map(s => s.trim()).filter(Boolean);
  }
  const assignedStr = assignedArray.length > 0 ? assignedArray.join(', ') : (task.assegnatoA?.trim() || 'Non assegnato');

  if (task.commessaId && task.commessaId.trim()) {
    // === 1. TASK DI COMMESSA: Salva dentro catalogo_commesse/{commessaId}.punchList ===
    const commDocRef = doc(db, 'catalogo_commesse', task.commessaId);
    const commSnap = await getDoc(commDocRef);
    if (!commSnap.exists()) {
      throw new Error(`Commessa non trovata: ${task.commessaId}`);
    }
    const commData = commSnap.data();
    const existingList: any[] = Array.isArray(commData.punchList) ? commData.punchList : [];

    let isNew = true;
    const existingItem = existingList.find(item => item.id === taskId);
    if (existingItem) {
      isNew = false;
      // Controllo permessi modifica: Creatore, Responsabile o PM
      if (!canUserManageTask(existingItem, currentUser.name, currentUser.email, [commData, ...commesseList])) {
        throw new Error("Non hai i permessi per modificare questa attività di commessa.");
      }
    }

    const updatedList = existingList.map(item => {
      if (item.id === taskId) {
        const updatedItem = {
          ...item,
          titolo: task.titolo.trim(),
          categoria: task.categoria,
          assegnatiA: assignedArray,
          assegnatoA: assignedStr,
          stato: task.stato || item.stato || 'da_fare'
        };
        if (task.descrizione?.trim()) updatedItem.descrizione = task.descrizione.trim();
        else delete updatedItem.descrizione;
        if (task.scadenza) updatedItem.scadenza = task.scadenza;
        else delete updatedItem.scadenza;
        return updatedItem;
      }
      return item;
    });

    let finalItem: any;
    if (isNew) {
      finalItem = {
        id: taskId,
        titolo: task.titolo.trim(),
        categoria: task.categoria,
        assegnatiA: assignedArray,
        assegnatoA: assignedStr,
        stato: 'da_fare',
        creatoDa: currentUser.name || currentUser.email,
        creatoDaEmail: currentUser.email,
        creatoIl: nowIso
      };
      if (task.descrizione?.trim()) finalItem.descrizione = task.descrizione.trim();
      if (task.scadenza) finalItem.scadenza = task.scadenza;
      updatedList.unshift(finalItem);
    } else {
      finalItem = updatedList.find(i => i.id === taskId);
    }

    await updateDoc(commDocRef, { punchList: updatedList });

    // Invia notifica se assegnato ad altri colleghi
    await sendTaskAssignedNotification(finalItem, commData.nome, dipendentiList, currentUser);

    return {
      id: taskId,
      tipo: 'commessa',
      commessaId: task.commessaId,
      commessaNome: commData.nome,
      commessaCodice: commData.codiceCommessa,
      titolo: finalItem.titolo,
      descrizione: finalItem.descrizione,
      categoria: finalItem.categoria,
      scadenza: finalItem.scadenza,
      assegnatiA: assignedArray,
      assegnatoA: finalItem.assegnatoA,
      creatoDa: finalItem.creatoDa,
      creatoDaEmail: finalItem.creatoDaEmail,
      creatoIl: finalItem.creatoIl,
      stato: finalItem.stato
    };
  } else {
    // === 2. TASK GENERICO (senza commessa): Salva in todos_generici/{taskId} ===
    const todoDocRef = doc(db, 'todos_generici', taskId);
    const existingSnap = await getDoc(todoDocRef);
    const isNew = !existingSnap.exists();

    if (!isNew) {
      const existingData = existingSnap.data();
      if (!canUserManageTask({ tipo: 'generico', ...existingData }, currentUser.name, currentUser.email, [])) {
        throw new Error("Non hai i permessi per modificare questa attività generica.");
      }
    }

    const payload: any = {
      titolo: task.titolo.trim(),
      categoria: task.categoria,
      assegnatiA: assignedArray,
      assegnatoA: assignedStr,
      stato
    };
    if (task.descrizione?.trim()) payload.descrizione = task.descrizione.trim();
    else payload.descrizione = null;
    if (task.scadenza) payload.scadenza = task.scadenza;
    else payload.scadenza = null;

    if (isNew) {
      payload.creatoDa = currentUser.name || currentUser.email;
      payload.creatoDaEmail = currentUser.email;
      payload.creatoIl = nowIso;
      await setDoc(todoDocRef, payload);
    } else {
      await updateDoc(todoDocRef, payload);
    }

    invalidateGenericTodosCache();

    // Invia notifica se assegnato ad altri colleghi
    await sendTaskAssignedNotification(payload, 'Attività Generica (senza commessa)', dipendentiList, currentUser);

    return {
      id: taskId,
      tipo: 'generico',
      titolo: payload.titolo,
      descrizione: payload.descrizione,
      categoria: payload.categoria,
      scadenza: payload.scadenza,
      assegnatiA: assignedArray,
      assegnatoA: payload.assegnatoA,
      creatoDa: isNew ? payload.creatoDa : (existingSnap.data()?.creatoDa || currentUser.name),
      creatoDaEmail: isNew ? payload.creatoDaEmail : existingSnap.data()?.creatoDaEmail,
      creatoIl: isNew ? payload.creatoIl : existingSnap.data()?.creatoIl,
      stato: payload.stato
    };
  }
}

/**
 * Cambia lo stato (spunta completato o riapri a 'da_fare')
 * SOLO le persone assegnate possono completare o riaprire!
 */
export async function toggleUnifiedTodoStatus(
  task: UnifiedTodoItem,
  nextStatus: 'da_fare' | 'completato',
  updater: { name: string; email: string },
  dipendentiList: any[] = []
): Promise<void> {
  // Verifica permesso di completamento: SOLO le persone a cui è stato assegnato il compito
  if (!isTaskAssignee(task, updater.name)) {
    throw new Error("Solo le persone a cui è stato assegnato il compito possono segnarlo come completato o riaprirlo.");
  }

  const nowIso = new Date().toISOString();

  if (task.tipo === 'commessa' && task.commessaId) {
    const commDocRef = doc(db, 'catalogo_commesse', task.commessaId);
    const commSnap = await getDoc(commDocRef);
    if (!commSnap.exists()) return;
    const commData = commSnap.data();
    const list: any[] = Array.isArray(commData.punchList) ? commData.punchList : [];

    const updatedList = list.map(item => {
      if (item.id === task.id) {
        const u = { ...item, stato: nextStatus };
        if (nextStatus === 'completato') {
          u.completatoDa = updater.name || updater.email;
          u.completatoIl = nowIso;
        } else {
          delete u.completatoDa;
          delete u.completatoIl;
        }
        return u;
      }
      return item;
    });

    await updateDoc(commDocRef, { punchList: updatedList });

    if (nextStatus === 'completato') {
      await sendTaskCompletedNotification(task, commData.nome, dipendentiList, updater);
    }
  } else {
    const todoDocRef = doc(db, 'todos_generici', task.id);
    const updatePayload: any = {
      stato: nextStatus
    };
    if (nextStatus === 'completato') {
      updatePayload.completatoDa = updater.name || updater.email;
      updatePayload.completatoIl = nowIso;
    } else {
      updatePayload.completatoDa = null;
      updatePayload.completatoIl = null;
    }

    await updateDoc(todoDocRef, updatePayload);
    invalidateGenericTodosCache();

    if (nextStatus === 'completato') {
      await sendTaskCompletedNotification(task, 'Attività Generica', dipendentiList, updater);
    }
  }
}

/**
 * Elimina un ToDo
 * - Generici: solo creatore
 * - Commesse: creatore, Responsabile o PM
 */
export async function deleteUnifiedTodo(
  task: UnifiedTodoItem,
  currentUser?: { name: string; email: string },
  commesseList: any[] = []
): Promise<void> {
  if (currentUser) {
    if (!canUserManageTask(task, currentUser.name, currentUser.email, commesseList)) {
      throw new Error("Non hai i permessi per eliminare questa attività.");
    }
  }

  if (task.tipo === 'commessa' && task.commessaId) {
    const commDocRef = doc(db, 'catalogo_commesse', task.commessaId);
    const commSnap = await getDoc(commDocRef);
    if (!commSnap.exists()) return;
    const commData = commSnap.data();
    const list: any[] = Array.isArray(commData.punchList) ? commData.punchList : [];
    const filtered = list.filter(i => i.id !== task.id);
    await updateDoc(commDocRef, { punchList: filtered });
  } else {
    await deleteDoc(doc(db, 'todos_generici', task.id));
    invalidateGenericTodosCache();
  }
}

// Helpers notifiche interne
async function sendTaskAssignedNotification(
  task: any,
  contextTitle: string,
  dipendentiList: any[],
  creator: { name: string; email: string }
) {
  let assignees: string[] = [];
  if (Array.isArray(task.assegnatiA) && task.assegnatiA.length > 0) {
    assignees = task.assegnatiA;
  } else if (task.assegnatoA && typeof task.assegnatoA === 'string') {
    assignees = task.assegnatoA.split(',').map((s: string) => s.trim()).filter(Boolean);
  }
  if (assignees.length === 0) return;

  const catProps = getCategoryBadgeProps(task.categoria);
  const deadlineStr = task.scadenza ? ` (Scadenza: ${task.scadenza.split('-').reverse().join('/')})` : '';

  for (const assigneeName of assignees) {
    const targetDip = dipendentiList.find(d => areNamesEqual(d.nome, assigneeName));
    if (!targetDip?.email) continue;

    const isSelf = targetDip.email.toLowerCase() === (creator.email || '').toLowerCase() ||
                   areNamesEqual(targetDip.nome, creator.name);
    if (isSelf) continue;

    try {
      await createUserNotification({
        destinatarioEmail: targetDip.email,
        destinatarioNome: targetDip.nome,
        titolo: `📋 Nuova attività ToDo: ${contextTitle}`,
        messaggio: `${creator.name || 'Un collega'} ti ha assegnato [${catProps.label}] "${task.titolo}"${deadlineStr}.`,
        tipo: 'todo_assegnato',
        link: '/todo'
      });
    } catch (err) {
      console.error("Errore invio notifica assegnazione:", err);
    }
  }
}

async function sendTaskCompletedNotification(
  task: UnifiedTodoItem,
  contextTitle: string,
  dipendentiList: any[],
  updater: { name: string; email: string }
) {
  if (!task.creatoDa || !task.creatoDa.trim()) return;

  const creatorDip = dipendentiList.find(d => 
    areNamesEqual(d.nome, task.creatoDa) || 
    (d.email && d.email.toLowerCase() === task.creatoDa.toLowerCase())
  );
  const targetEmail = creatorDip?.email || (task.creatoDaEmail || (task.creatoDa.includes('@') ? task.creatoDa : null));
  const targetName = creatorDip?.nome || task.creatoDa;

  if (!targetEmail) return;

  const isSelf = targetEmail.toLowerCase() === (updater.email || '').toLowerCase() ||
                 areNamesEqual(targetName, updater.name);
  if (isSelf) return;

  const catProps = getCategoryBadgeProps(task.categoria);

  try {
    await createUserNotification({
      destinatarioEmail: targetEmail,
      destinatarioNome: targetName,
      titolo: `✅ Attività ToDo completata: ${contextTitle}`,
      messaggio: `${updater.name || 'Un collega'} ha completato l'attività [${catProps.label}] "${task.titolo}".`,
      tipo: 'todo_completato',
      link: '/todo'
    });
  } catch (err) {
    console.error("Errore invio notifica completamento:", err);
  }
}

// ==========================================
// SEZIONE NOTE PERSONALI (PRIVATE AL 100%)
// ==========================================

interface PersonalNotesCache {
  userEmail: string;
  notes: NotaPersonale[];
  timestamp: number;
}
let personalNotesCache: PersonalNotesCache | null = null;
const PERSONAL_NOTES_CACHE_TTL = 60 * 1000; // 60 secondi di validità cache

export function invalidatePersonalNotesCache() {
  personalNotesCache = null;
}

export function getCachedPersonalNotes(userEmail?: string | null): NotaPersonale[] | null {
  if (!userEmail) return null;
  const cleanEmail = userEmail.toLowerCase().trim();
  if (personalNotesCache && personalNotesCache.userEmail === cleanEmail) {
    return personalNotesCache.notes;
  }
  return null;
}

export async function fetchPersonalNotes(userEmail: string, forceRefresh = false): Promise<NotaPersonale[]> {
  if (!userEmail || !userEmail.trim()) return [];
  const cleanEmail = userEmail.toLowerCase().trim();

  const now = Date.now();
  if (!forceRefresh && personalNotesCache && personalNotesCache.userEmail === cleanEmail && (now - personalNotesCache.timestamp < PERSONAL_NOTES_CACHE_TTL)) {
    return personalNotesCache.notes;
  }

  try {
    const q = query(
      collection(db, 'note_personali'),
      where('userEmail', '==', cleanEmail)
    );
    const snap = await getDocs(q);
    const notes: NotaPersonale[] = [];
    snap.forEach(docSnap => {
      notes.push({ id: docSnap.id, ...docSnap.data() } as NotaPersonale);
    });

    // Ordina: prima le fissate (pin), poi per data aggiornamento decrescente
    const sorted = notes.sort((a, b) => {
      if (a.fissata && !b.fissata) return -1;
      if (!a.fissata && b.fissata) return 1;
      return (b.aggiornataIl || b.creataIl).localeCompare(a.aggiornataIl || a.creataIl);
    });

    personalNotesCache = {
      userEmail: cleanEmail,
      notes: sorted,
      timestamp: now
    };

    return sorted;
  } catch (err) {
    console.error("Errore fetch note personali:", err);
    return personalNotesCache?.notes || [];
  }
}

export async function savePersonalNote(
  note: {
    id?: string;
    titolo: string;
    contenuto: string;
    colore?: 'giallo' | 'blu' | 'verde' | 'rosa' | 'viola' | 'grigio';
    fissata?: boolean;
  },
  userEmail: string
): Promise<NotaPersonale> {
  const cleanEmail = userEmail.toLowerCase().trim();
  const noteId = note.id || `note_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const nowIso = new Date().toISOString();

  const noteRef = doc(db, 'note_personali', noteId);
  const existing = await getDoc(noteRef);

  const payload: any = {
    userEmail: cleanEmail,
    titolo: note.titolo.trim(),
    contenuto: note.contenuto.trim(),
    colore: note.colore || 'giallo',
    fissata: !!note.fissata,
    aggiornataIl: nowIso
  };

  if (!existing.exists()) {
    payload.creataIl = nowIso;
    await setDoc(noteRef, payload);
  } else {
    await updateDoc(noteRef, payload);
  }

  invalidatePersonalNotesCache();

  return {
    id: noteId,
    userEmail: cleanEmail,
    titolo: payload.titolo,
    contenuto: payload.contenuto,
    colore: payload.colore,
    fissata: payload.fissata,
    creataIl: existing.exists() ? existing.data()?.creataIl : nowIso,
    aggiornataIl: nowIso
  };
}

export async function deletePersonalNote(noteId: string): Promise<void> {
  await deleteDoc(doc(db, 'note_personali', noteId));
  invalidatePersonalNotesCache();
}
