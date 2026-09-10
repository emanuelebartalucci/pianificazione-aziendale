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
  where,
  writeBatch
} from 'firebase/firestore';
import { createUserNotification, markOverdueNotificationsAsReadForTask } from '../utils/userNotificationService';
import { areNamesEqual } from '../contexts/AuthContext';

export const TODO_CATEGORIE = [
  'aggiornare',
  'archiviare',
  'attesa feedback',
  'bim/cad',
  'chiamare',
  'consegnare',
  'da fare',
  'effettuare revisione',
  'fatturare',
  'firmare',
  'fissare appuntamento',
  'intervento it',
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

export interface TodoAttachment {
  id: string;
  percorso: string;
  nome: string;
  tipo: 'file' | 'cartella';
  estensione?: string;
}

export interface UnifiedTodoItem {
  id: string;
  tipo: 'commessa' | 'generico';
  commessaId?: string;
  commessaNome?: string;
  commessaCodice?: string;
  titolo: string;
  descrizione?: string;
  categoria: string;
  priorita?: 'Alta' | 'Standard' | 'Bassa'; // Priorità operativa (default: Standard)
  scadenza?: string; // YYYY-MM-DD
  assegnatiA: string[]; // Lista multi-assegnatari
  assegnatoA: string;   // Stringa retrocompatibile
  creatoDa: string;
  creatoDaEmail?: string;
  creatoIl: string;
  stato: 'da_fare' | 'completato';
  completatoDa?: string;
  completatoIl?: string;
  // Collegamento a file o cartella su server / locale (retrocompatibile)
  allegatoPercorso?: string;
  allegatoNome?: string;
  allegatoTipo?: 'file' | 'cartella';
  allegatoEstensione?: string;
  // Nuovo supporto allegati multipli
  allegati?: TodoAttachment[];
}

export interface NotaPersonale {
  id: string;
  userEmail: string;
  titolo: string;
  contenuto: string;
  colore: 'giallo' | 'blu' | 'verde' | 'rosa' | 'viola' | 'grigio';
  fissata?: boolean;
  ordine?: number;
  pilaId?: string;
  creataIl: string;
  aggiornataIl: string;
  // Collegamento a file o cartella su server / locale (retrocompatibile)
  allegatoPercorso?: string;
  allegatoNome?: string;
  allegatoTipo?: 'file' | 'cartella';
  allegatoEstensione?: string;
  // Nuovo supporto allegati multipli
  allegati?: TodoAttachment[];
}

/**
 * Ritorna un array normalizzato di allegati a partire dall'array allegati o dai campi singoli legacy
 */
export function getTodoAttachments(item?: {
  allegati?: TodoAttachment[];
  allegatoPercorso?: string;
  allegatoNome?: string;
  allegatoTipo?: 'file' | 'cartella';
  allegatoEstensione?: string;
} | null): TodoAttachment[] {
  if (!item) return [];
  if (Array.isArray(item.allegati) && item.allegati.length > 0) {
    return item.allegati.filter(a => a && a.percorso && a.percorso.trim());
  }
  if (item.allegatoPercorso && item.allegatoPercorso.trim()) {
    const p = item.allegatoPercorso.trim();
    return [{
      id: 'legacy_0',
      percorso: p,
      nome: item.allegatoNome || p.split(/[\\/]/).filter(Boolean).pop() || p,
      tipo: item.allegatoTipo || 'file',
      estensione: item.allegatoEstensione || ''
    }];
  }
  return [];
}

/**
 * Punteggio numerico per ordinamento priorità: Alta = 3, Standard = 2, Bassa = 1
 */
export function getPriorityScore(priorita?: string): number {
  if (priorita === 'Alta') return 3;
  if (priorita === 'Bassa') return 1;
  return 2; // Default per 'Standard' o valori non impostati
}

/**
 * Verifica se un percorso risiede sul server di rete aziendale o percorso condiviso accessibile al team
 * (es. \\srvapp\home\... o percorsi UNC \\..., oppure unità di rete mappate)
 * Esclude esplicitamente i dischi locali di sistema come C:\
 */
export function isSharedNetworkPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  let clean = path.trim();
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.substring(1, clean.length - 1).trim();
  }
  if (clean.toLowerCase().startsWith('file:///')) {
    clean = decodeURIComponent(clean.substring(8)).replace(/\//g, '\\');
  }

  // Percorsi UNC di rete (es. \\srvapp\home\... o //srvapp/home/...)
  if (clean.startsWith('\\\\') || clean.startsWith('//')) {
    return true;
  }

  // Lettere di unità disco (es. Z:\, Y:\, C:\)
  if (/^[a-zA-Z]:[\\/]/.test(clean)) {
    const driveLetter = clean.charAt(0).toUpperCase();
    // C:\ è rigorosamente il disco locale del singolo PC, mai condiviso tra colleghi
    if (driveLetter === 'C') return false;
    // Altre lettere di unità (es. Z:\) possono essere unità di rete mappate sul server
    return true;
  }

  return false;
}

export function parseAttachmentPath(raw: string, explicitMode?: 'file' | 'cartella'): {
  percorso: string;
  nome: string;
  tipo: 'file' | 'cartella';
  estensione: string;
  isCondiviso: boolean;
} | null {
  if (!raw || typeof raw !== 'string') return null;
  let clean = raw.trim();

  // Rimuovi apici o virgolette avvolgenti (es. "C:\percorso" o 'C:\percorso')
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.substring(1, clean.length - 1).trim();
  }

  // Rimuovi eventuale prefisso file:///
  if (clean.toLowerCase().startsWith('file:///')) {
    clean = decodeURIComponent(clean.substring(8)).replace(/\//g, '\\');
  }

  // Se è vuoto dopo la pulizia
  if (!clean) return null;

  // Normalizza separatori: se è un percorso di rete che inizia con /, converti in \
  if (clean.startsWith('//')) {
    clean = '\\\\' + clean.substring(2).replace(/\//g, '\\');
  }

  // Estrai il nome dell'elemento (ultimo segmento)
  const segments = clean.split(/[\\/]/).filter(Boolean);
  const nome = segments.length > 0 ? segments[segments.length - 1] : clean;

  // Determina estensione
  let estensione = '';
  const lastDot = nome.lastIndexOf('.');
  if (lastDot > 0 && lastDot < nome.length - 1) {
    estensione = nome.substring(lastDot + 1).toLowerCase();
  }

  // Determina se è cartella o file
  let tipo: 'file' | 'cartella' = 'file';
  if (explicitMode) {
    tipo = explicitMode;
  } else if (!estensione || clean.endsWith('\\') || clean.endsWith('/')) {
    tipo = 'cartella';
  }

  const isCondiviso = isSharedNetworkPath(clean);

  return {
    percorso: clean,
    nome,
    tipo,
    estensione,
    isCondiviso
  };
}

export type AttachmentIconKey = 'folder' | 'cad' | 'pdf' | 'excel' | 'word' | 'image' | 'archive' | 'generic';

export function getFileTypeVisualProps(tipo?: 'file' | 'cartella', ext?: string): {
  label: string;
  bg: string;
  text: string;
  border: string;
  badge: string;
  iconKey: AttachmentIconKey;
} {
  const e = (ext || '').toLowerCase().trim();

  if (tipo === 'cartella' || (!e && tipo !== 'file')) {
    return {
      label: 'Cartella',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-200 dark:border-amber-800',
      badge: 'DIR',
      iconKey: 'folder'
    };
  }

  // CAD e BIM
  if (['dwg', 'dxf', 'ifc', 'rvt', 'dgn', 'step', 'stp', 'iges', 'igs', 'nwd', 'nwc'].includes(e)) {
    return {
      label: 'CAD / BIM',
      bg: 'bg-cyan-50 dark:bg-cyan-950/40',
      text: 'text-cyan-700 dark:text-cyan-300',
      border: 'border-cyan-200 dark:border-cyan-800',
      badge: e.toUpperCase(),
      iconKey: 'cad'
    };
  }

  // PDF
  if (e === 'pdf') {
    return {
      label: 'PDF',
      bg: 'bg-red-50 dark:bg-red-950/40',
      text: 'text-red-700 dark:text-red-300',
      border: 'border-red-200 dark:border-red-800',
      badge: 'PDF',
      iconKey: 'pdf'
    };
  }

  // Excel / CSV
  if (['xlsx', 'xls', 'csv', 'ods', 'xlsm'].includes(e)) {
    return {
      label: 'Excel / CSV',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-200 dark:border-emerald-800',
      badge: e.toUpperCase(),
      iconKey: 'excel'
    };
  }

  // Word / Testo
  if (['docx', 'doc', 'odt', 'rtf', 'txt'].includes(e)) {
    return {
      label: 'Word / Testo',
      bg: 'bg-indigo-50 dark:bg-indigo-950/40',
      text: 'text-indigo-700 dark:text-indigo-300',
      border: 'border-indigo-200 dark:border-indigo-800',
      badge: e.toUpperCase(),
      iconKey: 'word'
    };
  }

  // Immagini
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'tif', 'tiff', 'webp'].includes(e)) {
    return {
      label: 'Immagine',
      bg: 'bg-purple-50 dark:bg-purple-950/40',
      text: 'text-purple-700 dark:text-purple-300',
      border: 'border-purple-200 dark:border-purple-800',
      badge: 'IMG',
      iconKey: 'image'
    };
  }

  // Archivi
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) {
    return {
      label: 'Archivio',
      bg: 'bg-orange-50 dark:bg-orange-950/40',
      text: 'text-orange-700 dark:text-orange-300',
      border: 'border-orange-200 dark:border-orange-800',
      badge: 'ZIP',
      iconKey: 'archive'
    };
  }

  // Generico
  return {
    label: 'File',
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-300 dark:border-slate-700',
    badge: e ? e.toUpperCase() : 'FILE',
    iconKey: 'generic'
  };
}

/**
 * Apre un file o una cartella in locale/rete invocando il protocollo ingegno-path:
 */
export function openAttachedPath(path: string) {
  if (!path || !path.trim()) return;
  const cleanPath = path.trim().replace(/^file:\/{2,3}/i, '');
  const url = `ingegno-path:${encodeURIComponent(cleanPath)}`;

  try {
    const tempLink = document.createElement('a');
    tempLink.href = url;
    tempLink.style.display = 'none';
    document.body.appendChild(tempLink);
    tempLink.click();
    setTimeout(() => {
      if (document.body.contains(tempLink)) {
        document.body.removeChild(tempLink);
      }
    }, 1500);
  } catch (err) {
    console.error("Errore protocollo ingegno-path:", err);
  }
}

/**
 * Avvia il selettore nativo Windows Forms via protocollo ingegno-pick:
 * Ritorna un listener per acquisire automaticamente il percorso copiato negli appunti
 */
export async function triggerNativePicker(
  mode: 'file' | 'folder',
  onPathAcquired?: (path: string) => void
) {
  // 1. Memorizziamo il contenuto attuale degli appunti per non incollare un valore vecchio/stale
  let initialClipboard = '';
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      initialClipboard = (await navigator.clipboard.readText()) || '';
    }
  } catch (_) {}

  // 2. Proviamo a svuotare gli appunti all'avvio: se ha successo, qualsiasi nuova selezione sarà rilevata all'istante
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText('');
      initialClipboard = '';
    }
  } catch (_) {}

  const url = `ingegno-pick://${mode}`;

  // 3. Lancio del protocollo nativo Windows tramite iframe invisibile
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);
  setTimeout(() => {
    try {
      document.body.removeChild(iframe);
    } catch (_) {}
  }, 2500);

  // 4. Acquisizione intelligente e continua del nuovo percorso
  if (onPathAcquired) {
    let completed = false;
    let attempts = 0;
    const maxAttempts = 120; // 60 secondi massimi (120 * 500ms)

    const cleanup = () => {
      completed = true;
      window.removeEventListener('focus', onWindowFocus);
      if (pollInterval) clearInterval(pollInterval);
    };

    const tryAcquire = async () => {
      if (completed) return;
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) return;
        const clipText = await navigator.clipboard.readText();
        const trimmed = (clipText || '').trim();

        // Accetta il percorso solo se:
        // - Non è vuoto
        // - È diverso dal vecchio contenuto iniziale
        // - Corrisponde a una sintassi di percorso Windows valida (\ o C:)
        if (trimmed && trimmed !== initialClipboard && (trimmed.startsWith('\\\\') || /^[a-zA-Z]:\\/.test(trimmed))) {
          const parsed = parseAttachmentPath(trimmed, mode === 'folder' ? 'cartella' : undefined);
          if (parsed && parsed.percorso) {
            cleanup();
            onPathAcquired(parsed.percorso);
          }
        }
      } catch (err) {
        // Ignora eccezioni momentanee di permessi browser
      }
    };

    // Controllo a scaglioni ogni volta che la finestra del browser riacquista il focus
    const onWindowFocus = () => {
      setTimeout(tryAcquire, 250);
      setTimeout(tryAcquire, 700);
      setTimeout(tryAcquire, 1500);
    };

    window.addEventListener('focus', onWindowFocus);

    // Polling di supporto ogni 500ms se l'utente ha la finestra attiva
    const pollInterval: any = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts || completed) {
        cleanup();
        return;
      }
      if (document.hasFocus()) {
        await tryAcquire();
      }
    }, 500);

    // Timeout di pulizia automatica dopo 90 secondi
    setTimeout(cleanup, 90000);
  }
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
    case 'intervento it':
      return { label: 'Intervento IT', bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: '💻' };
    case 'bim/cad':
      return { label: 'BIM/CAD', bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-300', icon: '📐' };
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
// HELPER FORMATTAZIONE COMMESSA
// ==========================================

/**
 * Rimuove il codice commessa ridondante dall'inizio del titolo della commessa.
 * Es: "U260000A - Gestione ufficio e attività varie" → "Gestione ufficio e attività varie"
 * Se il codice non è presente nel titolo, restituisce il titolo invariato.
 */
export function getCommessaTitleWithoutCode(nome?: string, codice?: string): string {
  if (!nome) return '';
  if (!codice) return nome;
  const clean = nome.trim();
  const codePrefix1 = `${codice} - `;
  const codePrefix2 = `${codice} — `;
  if (clean.startsWith(codePrefix1)) return clean.slice(codePrefix1.length).trim();
  if (clean.startsWith(codePrefix2)) return clean.slice(codePrefix2.length).trim();
  if (clean.startsWith(codice)) return clean.slice(codice.length).replace(/^[\s\-—]+/, '').trim();
  return clean;
}

/**
 * Formatta la commessa nel formato uniforme "[Codice] Titolo" senza mai
 * ripetere il codice due volte.
 * Es: nome="U260000A - Gestione ufficio", codice="U260000A"
 *  → "[U260000A] Gestione ufficio e attività varie"
 */
export function formatCommessaDisplay(nome?: string, codice?: string): string {
  if (!nome) return '';
  const title = getCommessaTitleWithoutCode(nome, codice);
  if (codice) return `[${codice}] ${title}`;
  return title;
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
  // Tolleranza per prefisso email / username (es. e.bartalucci o p.taddei)
  if (cleanEmail && task.creatoDa) {
    const uName = cleanEmail.split('@')[0];
    const cLower = task.creatoDa.toLowerCase().trim();
    if (uName && (cLower === uName || cLower.includes(uName) || uName.includes(cLower))) {
      return true;
    }
  }
  // Tolleranza per singoli token significativi del nome (es. cognome o nome composti)
  if (myAssociatedName && task.creatoDa) {
    const tokensUser = myAssociatedName.toLowerCase().trim().split(/\s+/).filter(t => t.length > 2);
    const tokensTask = task.creatoDa.toLowerCase().trim().split(/\s+/).filter(t => t.length > 2);
    if (tokensUser.length > 0 && tokensTask.length > 0) {
      const allMatch = tokensUser.every(u => tokensTask.some(t => t.includes(u) || u.includes(t)));
      if (allMatch) return true;
    }
  }
  return false;
}

/**
 * Precalcola il Set degli ID commessa su cui l'utente ha ore pianificate in griglia
 */
export function getAssignedCommessaIdsForUser(
  myAssociatedName?: string | null,
  assegnazioni?: Record<string, any[]>
): Set<string> {
  const set = new Set<string>();
  if (!assegnazioni || !myAssociatedName) return set;
  const cleanName = myAssociatedName.trim();
  for (const [key, list] of Object.entries(assegnazioni)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const dipName = key.split('-')[0];
    if (areNamesEqual(dipName, cleanName)) {
      for (const a of list) {
        if (a && a.commessaId && Number(a.percentuale) > 0) {
          set.add(a.commessaId);
        }
      }
    }
  }
  return set;
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
  assegnazioni?: Record<string, any[]>,
  precomputedAssignedIds?: Set<string>
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

  // 5. Pianificato nella griglia assegnazioni settimanali (O(1) se precalcolato)
  if (precomputedAssignedIds) {
    if (precomputedAssignedIds.has(comm.id)) {
      return true;
    }
  } else if (assegnazioni && cleanName) {
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
  if (Array.isArray(comm.punchList) && comm.punchList.length > 0 && (cleanName || cleanEmail)) {
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
 * Ritorna l'elenco dei dipendenti che lavorano o sono collegati a una specifica commessa:
 * - Risorse con ore pianificate nella griglia assegnazioni settimanali
 * - Responsabile della commessa
 * - Project Manager (PM)
 * - Abilitati Extra
 * - Inseriti nel campo comm.assegnati
 * - Assegnatari o creatori di ToDo nella punchList della commessa
 */
export function getEligibleAssigneesForCommessa(
  comm: any,
  dipendentiList: Array<{ id?: string; nome: string }>,
  assegnazioni?: Record<string, any[]>
): Array<{ id?: string; nome: string }> {
  if (!comm) return dipendentiList;
  const assignedNamesSet = new Set<string>();

  // 1. Risorse con ore pianificate nella griglia assegnazioni settimanali
  if (assegnazioni) {
    Object.entries(assegnazioni).forEach(([key, listAss]) => {
      if (!listAss || !Array.isArray(listAss)) return;
      const match = key.match(/^(.*)-(\d{4}-W\d{1,2})$/);
      const dipName = match ? match[1] : key.split('-')[0];
      if (!dipName) return;

      const hasAssignment = listAss.some(ass => ass && ass.commessaId === comm.id && Number(ass.percentuale) > 0);
      if (hasAssignment) {
        const foundDip = (dipendentiList || []).find(d => areNamesEqual(d.nome, dipName));
        assignedNamesSet.add(foundDip ? foundDip.nome : dipName);
      }
    });
  }

  // 2. Risorse assegnate direttamente nel catalogo commessa (comm.assegnati)
  if (Array.isArray(comm.assegnati)) {
    comm.assegnati.forEach((a: any) => {
      const aName = typeof a === 'string' ? a : (a?.nome || a?.name);
      if (aName) {
        const found = (dipendentiList || []).find(d => areNamesEqual(d.nome, aName));
        assignedNamesSet.add(found ? found.nome : aName);
      }
    });
  }

  // 3. Responsabile di Commessa
  if (comm.responsabile) {
    const foundResp = (dipendentiList || []).find(d => areNamesEqual(d.nome, comm.responsabile));
    assignedNamesSet.add(foundResp ? foundResp.nome : comm.responsabile);
  }

  // 4. Project Manager (PM)
  const pms = Array.isArray(comm.pm) ? comm.pm : (comm.pm ? [comm.pm] : []);
  pms.forEach((pm: string) => {
    if (pm) {
      const foundPm = (dipendentiList || []).find(d => areNamesEqual(d.nome, pm));
      assignedNamesSet.add(foundPm ? foundPm.nome : pm);
    }
  });

  // 5. Abilitati Extra
  const extraList = Array.isArray(comm.abilitatiExtra) ? comm.abilitatiExtra : (comm.abilitatiExtra ? [comm.abilitatiExtra] : []);
  extraList.forEach((extra: string) => {
    if (extra) {
      const foundExtra = (dipendentiList || []).find(d => areNamesEqual(d.nome, extra));
      assignedNamesSet.add(foundExtra ? foundExtra.nome : extra);
    }
  });

  // 6. Assegnatari o creatori nei ToDo della punchList
  if (Array.isArray(comm.punchList)) {
    comm.punchList.forEach((p: any) => {
      if (p.assegnatoA) {
        p.assegnatoA.split(',').forEach((s: string) => {
          const trimmed = s.trim();
          if (trimmed) {
            const found = (dipendentiList || []).find(d => areNamesEqual(d.nome, trimmed));
            assignedNamesSet.add(found ? found.nome : trimmed);
          }
        });
      }
      if (Array.isArray(p.assegnatiA)) {
        p.assegnatiA.forEach((s: string) => {
          const trimmed = String(s).trim();
          if (trimmed) {
            const found = (dipendentiList || []).find(d => areNamesEqual(d.nome, trimmed));
            assignedNamesSet.add(found ? found.nome : trimmed);
          }
        });
      }
      if (p.creatoDa) {
        const found = (dipendentiList || []).find(d => areNamesEqual(d.nome, p.creatoDa));
        if (found) assignedNamesSet.add(found.nome);
      }
    });
  }

  // Filtra la lista dei dipendenti mantenendo l'oggetto Dipendente
  const filtered = (dipendentiList || []).filter(d => 
    Array.from(assignedNamesSet).some(name => areNamesEqual(d.nome, name))
  );

  return filtered;
}

/**
 * Verifica se l'utente ha diritto di modificare o eliminare un ToDo:
 * Regola rigorosa: SOLO ed esclusivamente chi ha creato il task può modificarlo o eliminarlo!
 * Chi è assegnato o coinvolto nella commessa può visualizzarlo e completarlo, ma non modificarlo o eliminarlo.
 */
export function canUserManageTask(
  task: { tipo?: string; commessaId?: string | null; creatoDa?: string; creatoDaEmail?: string },
  myAssociatedName?: string | null,
  userEmail?: string | null,
  _commesseList: any[] = []
): boolean {
  return isTaskCreator(task, myAssociatedName, userEmail);
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
interface UnifiedTodosCache {
  userEmail: string;
  myAssociatedName: string;
  includeOlderCompleted: boolean;
  includeClosedCommesse: boolean;
  commesseCount: number;
  todos: UnifiedTodoItem[];
  timestamp: number;
}

let cachedGenericTodosUser = '';
let cachedGenericTodosRaw: Array<{ id: string; data: any }> | null = null;
let lastGenericTodosFetch = 0;
let unifiedTodosCache: UnifiedTodosCache | null = null;
const GENERIC_TODOS_CACHE_TTL = 60 * 1000; // 60 secondi di validità cache

export function invalidateGenericTodosCache(clearRaw: boolean = false) {
  unifiedTodosCache = null;
  if (clearRaw) {
    cachedGenericTodosRaw = null;
    cachedGenericTodosUser = '';
    lastGenericTodosFetch = 0;
  }
}

/**
 * Costruisce l'elenco dei ToDo unificati a partire dai dati già in memoria:
 * - Esclude le commesse chiuse (salvo includeClosedCommesse = true).
 * - Per i compiti completati, include solo quelli degli ultimi 30 giorni (salvo includeOlderCompleted = true).
 * - I compiti da fare vengono SEMPRE inclusi tutti.
 */
export function buildUnifiedTodosFromData(
  commesseList: any[],
  genericDocs: Array<{ id: string; data: any }>,
  myAssociatedName?: string | null,
  userEmail?: string | null,
  assegnazioni?: Record<string, any[]>,
  options?: {
    includeOlderCompleted?: boolean;
    includeClosedCommesse?: boolean;
    cutoffDays?: number;
  }
): UnifiedTodoItem[] {
  const includeOlderCompleted = !!options?.includeOlderCompleted;
  const includeClosedCommesse = !!options?.includeClosedCommesse;
  const cutoffDays = options?.cutoffDays ?? 30;
  const cutoffTime = Date.now() - (cutoffDays * 24 * 60 * 60 * 1000);

  const unified: UnifiedTodoItem[] = [];

  // Precalcola in O(M) il Set delle commesse assegnate all'utente in griglia una sola volta
  const precomputedAssignedIds = getAssignedCommessaIdsForUser(myAssociatedName, assegnazioni);

  // 1. Estrai i ToDo dalle sole commesse abilitate per l'utente
  commesseList.forEach(c => {
    // Escludi le commesse con stato 'Chiusa' a meno che non sia richiesto esplicitamente
    if (!includeClosedCommesse && c.stato === 'Chiusa') {
      return;
    }

    const pList = c.punchList;
    // OTTIMIZZAZIONE CRITICA: Se la commessa non ha attività in punchList, salta immediatamente!
    if (!Array.isArray(pList) || pList.length === 0) {
      return;
    }

    const userInvolved = isUserInvolvedInCommessa(c, myAssociatedName, userEmail, assegnazioni, precomputedAssignedIds);

    pList.forEach(p => {
      if (!p || !p.titolo) return;

      const isAss = isTaskAssignee(p, myAssociatedName);
      const isCre = isTaskCreator(p, myAssociatedName, userEmail);

      if (!userInvolved && !isAss && !isCre) {
        return;
      }

      const statoClean = (p.stato === 'completato' || p.stato === 'eseguito') ? 'completato' : 'da_fare';

      // NOTA DIRETTIVA: Le attività di una commessa aperta rimangono sempre tutte visibili
      // (sia da fare che completate) fino a quando la commessa non viene chiusa.
      // Il cutoff temporale a 30 giorni si applica esclusivamente alle attività generiche.

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
        priorita: (p.priorita || 'Standard') as 'Alta' | 'Standard' | 'Bassa',
        scadenza: p.scadenza,
        assegnatiA: assegnatiList,
        assegnatoA: assegnatiList.length > 0 ? assegnatiList.join(', ') : (p.assegnatoA || 'Non assegnato'),
        creatoDa: p.creatoDa || 'Utente',
        creatoDaEmail: p.creatoDaEmail,
        creatoIl: p.creatoIl || new Date().toISOString(),
        stato: statoClean,
        completatoDa: p.completatoDa,
        completatoIl: p.completatoIl,
        allegatoPercorso: p.allegatoPercorso,
        allegatoNome: p.allegatoNome,
        allegatoTipo: p.allegatoTipo,
        allegatoEstensione: p.allegatoEstensione,
        allegati: getTodoAttachments(p)
      });
    });
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

      // Finestra mobile: se completato e non si richiede lo storico vecchio, escludi se > 30 giorni fa
      if (statoClean === 'completato' && !includeOlderCompleted) {
        const completedDateStr = d.completatoIl || d.creatoIl;
        if (completedDateStr) {
          const completedTime = new Date(completedDateStr).getTime();
          if (!isNaN(completedTime) && completedTime < cutoffTime) {
            return;
          }
        }
      }

      unified.push({
        id: docSnap.id,
        tipo: 'generico',
        titolo: d.titolo || '',
        descrizione: d.descrizione,
        categoria: d.categoria || 'da fare',
        priorita: (d.priorita || 'Standard') as 'Alta' | 'Standard' | 'Bassa',
        scadenza: d.scadenza,
        assegnatiA: assegnatiList,
        assegnatoA: assegnatiList.length > 0 ? assegnatiList.join(', ') : (d.assegnatoA || 'Non assegnato'),
        creatoDa: d.creatoDa || 'Utente',
        creatoDaEmail: d.creatoDaEmail,
        creatoIl: d.creatoIl || new Date().toISOString(),
        stato: statoClean,
        completatoDa: d.completatoDa,
        completatoIl: d.completatoIl,
        allegatoPercorso: d.allegatoPercorso,
        allegatoNome: d.allegatoNome,
        allegatoTipo: d.allegatoTipo,
        allegatoEstensione: d.allegatoEstensione,
        allegati: getTodoAttachments(d)
      });
    }
  });

  // 3. Ordinamento globale predefinito (per Scadenza e Priorità)
  return unified.sort((a, b) => {
    if (a.stato === 'da_fare' && b.stato === 'completato') return -1;
    if (a.stato === 'completato' && b.stato === 'da_fare') return 1;

    if (a.stato === 'da_fare' && b.stato === 'da_fare') {
      if (a.scadenza && !b.scadenza) return -1;
      if (!a.scadenza && b.scadenza) return 1;
      if (a.scadenza && b.scadenza) {
        const cmpDate = a.scadenza.localeCompare(b.scadenza);
        if (cmpDate !== 0) return cmpDate;
      }
      // A parità di data (o entrambe senza scadenza): prima priorità più alta
      const scoreA = getPriorityScore(a.priorita);
      const scoreB = getPriorityScore(b.priorita);
      if (scoreA !== scoreB) return scoreB - scoreA;

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
  includeOlderCompleted?: boolean;
  includeClosedCommesse?: boolean;
}): UnifiedTodoItem[] | null {
  if (!options.userEmail) return null;
  const cleanEmail = options.userEmail.toLowerCase().trim();
  const cleanName = (options.myAssociatedName || '').trim();
  const isIncludeOlder = !!options.includeOlderCompleted;
  const isIncludeClosed = !!options.includeClosedCommesse;

  // 1. Ritorno immediato se l'array finale è già memorizzato con gli stessi filtri e stesso numero di commesse
  if (
    unifiedTodosCache &&
    unifiedTodosCache.userEmail === cleanEmail &&
    unifiedTodosCache.myAssociatedName === cleanName &&
    unifiedTodosCache.includeOlderCompleted === isIncludeOlder &&
    unifiedTodosCache.includeClosedCommesse === isIncludeClosed &&
    unifiedTodosCache.commesseCount === (options.commesseList || []).length
  ) {
    return unifiedTodosCache.todos;
  }

  // 2. Se non abbiamo l'array finale ma abbiamo i documenti raw in memoria, costruisci e memorizza
  if (!cachedGenericTodosRaw || cachedGenericTodosUser !== cleanEmail) return null;

  const result = buildUnifiedTodosFromData(
    options.commesseList || [],
    cachedGenericTodosRaw,
    options.myAssociatedName,
    options.userEmail,
    options.assegnazioni,
    { includeOlderCompleted: isIncludeOlder, includeClosedCommesse: isIncludeClosed }
  );

  unifiedTodosCache = {
    userEmail: cleanEmail,
    myAssociatedName: cleanName,
    includeOlderCompleted: isIncludeOlder,
    includeClosedCommesse: isIncludeClosed,
    commesseCount: (options.commesseList || []).length,
    todos: result,
    timestamp: Date.now()
  };

  return result;
}

/**
 * Recupera tutti i ToDo unificati visibili per l'utente attivo:
 * - Per le commesse: solo quelle su cui l'utente è coinvolto (o se il task è assegnato/creato dall'utente).
 *   Esclude di default le commesse con stato 'Chiusa' (salvo includeClosedCommesse = true).
 * - Per i compiti generici: SOLO quelli assegnati all'utente o da lui creati (query mirata su Firestore).
 * - Per i compiti completati: include di default solo gli ultimi 30 giorni (salvo includeOlderCompleted = true).
 * (Sfrutta la cache in-memory con TTL 60s per abbattere la latenza di rete e computazionale a zero).
 */
export async function fetchUnifiedTodos(options: {
  userEmail: string;
  myAssociatedName?: string;
  commesseList: any[];
  assegnazioni?: Record<string, any[]>;
  isAdmin?: boolean;
  isSoci?: boolean;
  forceRefresh?: boolean;
  includeOlderCompleted?: boolean;
  includeClosedCommesse?: boolean;
}): Promise<UnifiedTodoItem[]> {
  const { userEmail, myAssociatedName, commesseList, assegnazioni, forceRefresh, includeOlderCompleted, includeClosedCommesse } = options;
  const cleanEmail = (userEmail || '').toLowerCase().trim();
  const cleanName = (myAssociatedName || '').trim();
  const now = Date.now();

  const isIncludeOlder = !!includeOlderCompleted;
  const isIncludeClosed = !!includeClosedCommesse;

  // Ritorno istantaneo dalla cache senza alcuna lettura Firestore né cicli pesanti
  // (Invalida se il numero di commesse in memoria è cambiato, es. caricamento asincrono iniziale)
  if (
    !forceRefresh &&
    unifiedTodosCache &&
    unifiedTodosCache.userEmail === cleanEmail &&
    unifiedTodosCache.myAssociatedName === cleanName &&
    unifiedTodosCache.includeOlderCompleted === isIncludeOlder &&
    unifiedTodosCache.includeClosedCommesse === isIncludeClosed &&
    unifiedTodosCache.commesseCount === (commesseList || []).length &&
    (now - unifiedTodosCache.timestamp < GENERIC_TODOS_CACHE_TTL)
  ) {
    return unifiedTodosCache.todos;
  }

  let rawDocs = cachedGenericTodosRaw;
  const userChanged = cachedGenericTodosUser !== cleanEmail;

  if (!rawDocs || userChanged || forceRefresh || (now - lastGenericTodosFetch > GENERIC_TODOS_CACHE_TTL)) {
    try {
      // Scarica i documenti della collezione todos_generici con cache 60s
      // Il filtro per utente viene eseguito in memoria con areNamesEqual per garantire tolleranza totale su inversioni Nome/Cognome
      const colRef = collection(db, 'todos_generici');
      const snap = await getDocs(colRef);
      rawDocs = snap.docs.map((d: any) => ({ id: d.id, data: d.data() }));

      cachedGenericTodosRaw = rawDocs;
      cachedGenericTodosUser = cleanEmail;
      lastGenericTodosFetch = now;
    } catch (err) {
      console.error("Errore fetch todos_generici:", err);
      rawDocs = rawDocs || [];
    }
  }

  const result = buildUnifiedTodosFromData(
    commesseList || [],
    rawDocs || [],
    myAssociatedName,
    userEmail,
    assegnazioni,
    { includeOlderCompleted: isIncludeOlder, includeClosedCommesse: isIncludeClosed }
  );

  unifiedTodosCache = {
    userEmail: cleanEmail,
    myAssociatedName: cleanName,
    includeOlderCompleted: isIncludeOlder,
    includeClosedCommesse: isIncludeClosed,
    commesseCount: (commesseList || []).length,
    todos: result,
    timestamp: now
  };

  return result;
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
    priorita?: 'Alta' | 'Standard' | 'Bassa';
    scadenza?: string;
    assegnatiA?: string[];
    assegnatoA?: string;
    stato?: 'da_fare' | 'completato';
    allegatoPercorso?: string;
    allegatoNome?: string;
    allegatoTipo?: 'file' | 'cartella';
    allegatoEstensione?: string;
    allegati?: TodoAttachment[];
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

  // Normalizza lista allegati
  let normalizedAllegati: TodoAttachment[] = [];
  if (Array.isArray(task.allegati) && task.allegati.length > 0) {
    normalizedAllegati = task.allegati
      .filter(a => a && a.percorso && a.percorso.trim())
      .map((a, idx) => {
        const parsed = parseAttachmentPath(a.percorso.trim(), a.tipo);
        return {
          id: a.id || `att_${Date.now()}_${idx}`,
          percorso: parsed ? parsed.percorso : a.percorso.trim(),
          nome: (a.nome && a.nome.trim()) || (parsed ? parsed.nome : a.percorso.trim()),
          tipo: a.tipo || (parsed ? parsed.tipo : 'file'),
          estensione: (a.estensione && a.estensione.trim()) || (parsed ? parsed.estensione : '')
        };
      });
  } else if (task.allegatoPercorso && task.allegatoPercorso.trim()) {
    const parsed = parseAttachmentPath(task.allegatoPercorso.trim(), task.allegatoTipo);
    if (parsed) {
      normalizedAllegati = [{
        id: `att_${Date.now()}_0`,
        percorso: parsed.percorso,
        nome: (task.allegatoNome && task.allegatoNome.trim()) || parsed.nome,
        tipo: parsed.tipo,
        estensione: parsed.estensione
      }];
    }
  }

  const firstAtt = normalizedAllegati[0] || null;
  const legacyPercorso = firstAtt ? firstAtt.percorso : null;
  const legacyNome = firstAtt ? firstAtt.nome : null;
  const legacyTipo = firstAtt ? firstAtt.tipo : null;
  const legacyEstensione = firstAtt ? firstAtt.estensione : null;

  const todayIsoStr = new Date().toISOString().split('T')[0];

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
      // Controllo permessi modifica: SOLO Creatore
      if (!canUserManageTask(existingItem, currentUser.name, currentUser.email, [commData, ...commesseList])) {
        throw new Error("Non puoi modificare questa attività perché è stata creata da un altro collega.");
      }
    }

    const updatedList = existingList.map(item => {
      if (item.id === taskId) {
        const updatedItem: any = {
          ...item,
          titolo: task.titolo.trim(),
          categoria: task.categoria,
          priorita: task.priorita || item.priorita || 'Standard',
          assegnatiA: assignedArray,
          assegnatoA: assignedStr,
          stato: task.stato || item.stato || 'da_fare'
        };
        if (task.descrizione?.trim()) updatedItem.descrizione = task.descrizione.trim();
        else delete updatedItem.descrizione;
        if (task.scadenza) updatedItem.scadenza = task.scadenza;
        else delete updatedItem.scadenza;

        if (normalizedAllegati.length > 0) {
          updatedItem.allegati = normalizedAllegati;
          updatedItem.allegatoPercorso = legacyPercorso;
          updatedItem.allegatoNome = legacyNome;
          updatedItem.allegatoTipo = legacyTipo;
          updatedItem.allegatoEstensione = legacyEstensione;
        } else {
          delete updatedItem.allegati;
          delete updatedItem.allegatoPercorso;
          delete updatedItem.allegatoNome;
          delete updatedItem.allegatoTipo;
          delete updatedItem.allegatoEstensione;
        }

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
        priorita: task.priorita || 'Standard',
        assegnatiA: assignedArray,
        assegnatoA: assignedStr,
        stato: 'da_fare',
        creatoDa: currentUser.name || currentUser.email,
        creatoDaEmail: currentUser.email,
        creatoIl: nowIso
      };
      if (task.descrizione?.trim()) finalItem.descrizione = task.descrizione.trim();
      if (task.scadenza) finalItem.scadenza = task.scadenza;
      if (normalizedAllegati.length > 0) {
        finalItem.allegati = normalizedAllegati;
        finalItem.allegatoPercorso = legacyPercorso;
        finalItem.allegatoNome = legacyNome;
        finalItem.allegatoTipo = legacyTipo;
        finalItem.allegatoEstensione = legacyEstensione;
      }
      updatedList.unshift(finalItem);
    } else {
      finalItem = updatedList.find(i => i.id === taskId);
    }

    await updateDoc(commDocRef, { punchList: updatedList });

    // Sincronizza immediatamente la commessa nell'array in-memory commesseList (se passato dal chiamante)
    const targetComm = (commesseList || []).find(c => c.id === task.commessaId);
    if (targetComm) {
      targetComm.punchList = updatedList;
    }

    invalidateGenericTodosCache();

    // Invia notifica se assegnato ad altri colleghi
    await sendTaskAssignedNotification(finalItem, commData.nome, dipendentiList, currentUser);

    const isDoneComm = finalItem.stato === 'completato';
    const isNotOverdueComm = !finalItem.scadenza || finalItem.scadenza >= todayIsoStr;
    if (isDoneComm || isNotOverdueComm) {
      await markOverdueNotificationsAsReadForTask(taskId, finalItem.titolo);
    }

    return {
      id: taskId,
      tipo: 'commessa',
      commessaId: task.commessaId,
      commessaNome: commData.nome,
      commessaCodice: commData.codiceCommessa,
      titolo: finalItem.titolo,
      descrizione: finalItem.descrizione,
      categoria: finalItem.categoria,
      priorita: finalItem.priorita || 'Standard',
      scadenza: finalItem.scadenza,
      assegnatiA: assignedArray,
      assegnatoA: finalItem.assegnatoA,
      creatoDa: finalItem.creatoDa,
      creatoDaEmail: finalItem.creatoDaEmail,
      creatoIl: finalItem.creatoIl,
      stato: finalItem.stato,
      allegatoPercorso: finalItem.allegatoPercorso,
      allegatoNome: finalItem.allegatoNome,
      allegatoTipo: finalItem.allegatoTipo,
      allegatoEstensione: finalItem.allegatoEstensione,
      allegati: normalizedAllegati
    };
  } else {
    // === 2. TASK GENERICO (senza commessa): Salva in todos_generici/{taskId} ===
    const todoDocRef = doc(db, 'todos_generici', taskId);
    const existingSnap = await getDoc(todoDocRef);
    const isNew = !existingSnap.exists();

    if (!isNew) {
      const existingData = existingSnap.data();
      if (!canUserManageTask({ tipo: 'generico', ...existingData }, currentUser.name, currentUser.email, [])) {
        throw new Error("Non puoi modificare questa attività perché è stata creata da un altro collega.");
      }
    }

    const payload: any = {
      titolo: task.titolo.trim(),
      categoria: task.categoria,
      priorita: task.priorita || (existingSnap.exists() ? existingSnap.data()?.priorita : undefined) || 'Standard',
      assegnatiA: assignedArray,
      assegnatoA: assignedStr,
      stato
    };
    if (task.descrizione?.trim()) payload.descrizione = task.descrizione.trim();
    else payload.descrizione = null;
    if (task.scadenza) payload.scadenza = task.scadenza;
    else payload.scadenza = null;

    if (normalizedAllegati.length > 0) {
      payload.allegati = normalizedAllegati;
      payload.allegatoPercorso = legacyPercorso;
      payload.allegatoNome = legacyNome;
      payload.allegatoTipo = legacyTipo;
      payload.allegatoEstensione = legacyEstensione;
    } else {
      payload.allegati = [];
      payload.allegatoPercorso = null;
      payload.allegatoNome = null;
      payload.allegatoTipo = null;
      payload.allegatoEstensione = null;
    }

    if (isNew) {
      payload.creatoDa = currentUser.name || currentUser.email;
      payload.creatoDaEmail = currentUser.email;
      payload.creatoIl = nowIso;
      await setDoc(todoDocRef, payload);
    } else {
      await updateDoc(todoDocRef, payload);
    }

    if (cachedGenericTodosRaw) {
      const itemData = { ...payload, id: taskId };
      if (isNew) {
        cachedGenericTodosRaw = [{ id: taskId, data: itemData }, ...cachedGenericTodosRaw];
      } else {
        cachedGenericTodosRaw = cachedGenericTodosRaw.map(d => d.id === taskId ? { id: taskId, data: itemData } : d);
      }
    }

    invalidateGenericTodosCache();

    // Invia notifica se assegnato ad altri colleghi
    await sendTaskAssignedNotification(payload, 'Attività Generica (senza commessa)', dipendentiList, currentUser);

    const isDoneGen = payload.stato === 'completato';
    const isNotOverdueGen = !payload.scadenza || payload.scadenza >= todayIsoStr;
    if (isDoneGen || isNotOverdueGen) {
      await markOverdueNotificationsAsReadForTask(taskId, payload.titolo);
    }

    return {
      id: taskId,
      tipo: 'generico',
      titolo: payload.titolo,
      descrizione: payload.descrizione,
      categoria: payload.categoria,
      priorita: payload.priorita || 'Standard',
      scadenza: payload.scadenza,
      assegnatiA: assignedArray,
      assegnatoA: payload.assegnatoA,
      creatoDa: isNew ? payload.creatoDa : (existingSnap.data()?.creatoDa || currentUser.name),
      creatoDaEmail: isNew ? payload.creatoDaEmail : existingSnap.data()?.creatoDaEmail,
      creatoIl: isNew ? payload.creatoIl : existingSnap.data()?.creatoIl,
      stato: payload.stato,
      allegatoPercorso: payload.allegatoPercorso || undefined,
      allegatoNome: payload.allegatoNome || undefined,
      allegatoTipo: payload.allegatoTipo || undefined,
      allegatoEstensione: payload.allegatoEstensione || undefined,
      allegati: normalizedAllegati
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
  dipendentiList: any[] = [],
  commesseList: any[] = []
): Promise<void> {
  // Verifica permesso di completamento: SOLO le persone a cui è stato assegnato il compito
  if (!isTaskAssignee(task, updater.name)) {
    throw new Error("Solo le persone a cui è stato assegnato il compito possono segnarlo come completato o riaprirlo.");
  }

  // Risoluzione robusta del nome reale del completatore
  let resolvedUpdaterName = updater.name && updater.name.trim() && updater.name !== 'Utente' ? updater.name : '';
  if (!resolvedUpdaterName && updater.email && dipendentiList.length > 0) {
    const dip = dipendentiList.find(d => d.email && d.email.toLowerCase() === updater.email.toLowerCase());
    if (dip?.nome) resolvedUpdaterName = dip.nome;
  }
  if (!resolvedUpdaterName) resolvedUpdaterName = updater.name || updater.email || 'Utente';
  const resolvedUpdater = { ...updater, name: resolvedUpdaterName };

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
          u.completatoDa = resolvedUpdaterName;
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

    const targetComm = (commesseList || []).find(c => c.id === task.commessaId);
    if (targetComm) {
      targetComm.punchList = updatedList;
    }

    invalidateGenericTodosCache();

    if (nextStatus === 'completato') {
      await sendTaskCompletedNotification(task, commData.nome, dipendentiList, resolvedUpdater);
      await markOverdueNotificationsAsReadForTask(task.id, task.titolo);
    }
  } else {
    const todoDocRef = doc(db, 'todos_generici', task.id);
    const updatePayload: any = {
      stato: nextStatus
    };
    if (nextStatus === 'completato') {
      updatePayload.completatoDa = resolvedUpdaterName;
      updatePayload.completatoIl = nowIso;
    } else {
      updatePayload.completatoDa = null;
      updatePayload.completatoIl = null;
    }

    await updateDoc(todoDocRef, updatePayload);

    if (cachedGenericTodosRaw) {
      cachedGenericTodosRaw = cachedGenericTodosRaw.map(d => {
        if (d.id === task.id) {
          return { ...d, data: { ...d.data, ...updatePayload } };
        }
        return d;
      });
    }

    invalidateGenericTodosCache();

    if (nextStatus === 'completato') {
      await sendTaskCompletedNotification(task, 'Attività Generica', dipendentiList, resolvedUpdater);
      await markOverdueNotificationsAsReadForTask(task.id, task.titolo);
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
      throw new Error("Non puoi eliminare questa attività perché è stata creata da un altro collega.");
    }
  }

  // Risolve eventuali notifiche di scadenza per questa attività eliminata
  await markOverdueNotificationsAsReadForTask(task.id, task.titolo);

  if (task.tipo === 'commessa' && task.commessaId) {
    const commDocRef = doc(db, 'catalogo_commesse', task.commessaId);
    const commSnap = await getDoc(commDocRef);
    if (!commSnap.exists()) return;
    const commData = commSnap.data();
    const list: any[] = Array.isArray(commData.punchList) ? commData.punchList : [];
    const filtered = list.filter(i => i.id !== task.id);
    await updateDoc(commDocRef, { punchList: filtered });

    const targetComm = (commesseList || []).find(c => c.id === task.commessaId);
    if (targetComm) {
      targetComm.punchList = filtered;
    }

    invalidateGenericTodosCache();
  } else {
    await deleteDoc(doc(db, 'todos_generici', task.id));

    if (cachedGenericTodosRaw) {
      cachedGenericTodosRaw = cachedGenericTodosRaw.filter(d => d.id !== task.id);
    }

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

    const notifLink = `/todo?notifTime=${Date.now()}&taskId=${task.id || ''}${task.commessaId ? `&commessaId=${task.commessaId}` : ''}`;

    try {
      await createUserNotification({
        destinatarioEmail: targetDip.email,
        destinatarioNome: targetDip.nome,
        titolo: `📋 Nuova attività ToDo: ${contextTitle}`,
        messaggio: `${creator.name || 'Un collega'} ti ha assegnato [${catProps.label}] "${task.titolo}"${deadlineStr}.`,
        tipo: 'todo_assegnato',
        link: notifLink
      });
    } catch (err) {
      console.error("Errore invio notifica assegnazione:", err);
    }
  }
}

async function sendTaskCompletedNotification(
  task: UnifiedTodoItem,
  _contextTitle: string,
  dipendentiList: any[],
  updater: { name: string; email: string }
) {

  if (!task.creatoDa || !task.creatoDa.trim()) return;

  // Risoluzione robusta: cerca il nome reale del completatore dall'array dipendenti (lookup per email)
  let updaterName = updater.name && updater.name.trim() && updater.name !== 'Utente' ? updater.name : '';
  if (!updaterName && updater.email) {
    const updaterDip = dipendentiList.find(d =>
      d.email && d.email.toLowerCase() === updater.email.toLowerCase()
    );
    if (updaterDip?.nome) updaterName = updaterDip.nome;
  }
  if (!updaterName) updaterName = updater.name || updater.email || 'Un collega';

  const creatorDip = dipendentiList.find(d => 
    areNamesEqual(d.nome, task.creatoDa) || 
    (d.email && d.email.toLowerCase() === task.creatoDa.toLowerCase())
  );
  const targetEmail = creatorDip?.email || (task.creatoDaEmail || (task.creatoDa.includes('@') ? task.creatoDa : null));
  const targetName = creatorDip?.nome || task.creatoDa;

  if (!targetEmail) return;

  const isSelf = targetEmail.toLowerCase() === (updater.email || '').toLowerCase() ||
                 areNamesEqual(targetName, updaterName);
  if (isSelf) return;

  const catProps = getCategoryBadgeProps(task.categoria);
  const commessaInfo = task.commessaNome ? ` (Commessa: ${getCommessaTitleWithoutCode(task.commessaNome, task.commessaCodice)})` : '';
  const notifLink = `/todo?notifTime=${Date.now()}&taskId=${task.id || ''}${task.commessaId ? `&commessaId=${task.commessaId}` : ''}`;

  try {
    await createUserNotification({
      destinatarioEmail: targetEmail,
      destinatarioNome: targetName,
      titolo: `✅ ${updaterName} ha completato un'attività: ${task.titolo}`,
      messaggio: `${updaterName} ha completato l'attività [${catProps.label}] "${task.titolo}"${commessaInfo}.`,
      tipo: 'todo_completato',
      link: notifLink
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
      const d = docSnap.data();
      notes.push({
        id: docSnap.id,
        ...d,
        allegati: getTodoAttachments(d)
      } as NotaPersonale);
    });

    // Ordina: se hanno ordine definito, rispetta ordine crescente; altrimenti data decrescente
    const sorted = notes.sort((a, b) => {
      if (typeof a.ordine === 'number' && typeof b.ordine === 'number') {
        return a.ordine - b.ordine;
      }
      if (typeof a.ordine === 'number') return -1;
      if (typeof b.ordine === 'number') return 1;
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
    ordine?: number;
    pilaId?: string;
    allegatoPercorso?: string;
    allegatoNome?: string;
    allegatoTipo?: 'file' | 'cartella';
    allegatoEstensione?: string;
    allegati?: TodoAttachment[];
  },
  userEmail: string
): Promise<NotaPersonale> {
  const cleanEmail = userEmail.toLowerCase().trim();
  const noteId = note.id || `note_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const nowIso = new Date().toISOString();

  const noteRef = doc(db, 'note_personali', noteId);
  const existing = await getDoc(noteRef);

  // Normalizza lista allegati
  let normalizedAllegati: TodoAttachment[] = [];
  if (Array.isArray(note.allegati) && note.allegati.length > 0) {
    normalizedAllegati = note.allegati
      .filter(a => a && a.percorso && a.percorso.trim())
      .map((a, idx) => {
        const parsed = parseAttachmentPath(a.percorso.trim(), a.tipo);
        return {
          id: a.id || `att_${Date.now()}_${idx}`,
          percorso: parsed ? parsed.percorso : a.percorso.trim(),
          nome: (a.nome && a.nome.trim()) || (parsed ? parsed.nome : a.percorso.trim()),
          tipo: a.tipo || (parsed ? parsed.tipo : 'file'),
          estensione: (a.estensione && a.estensione.trim()) || (parsed ? parsed.estensione : '')
        };
      });
  } else if (note.allegatoPercorso && note.allegatoPercorso.trim()) {
    const parsed = parseAttachmentPath(note.allegatoPercorso.trim(), note.allegatoTipo);
    if (parsed) {
      normalizedAllegati = [{
        id: `att_${Date.now()}_0`,
        percorso: parsed.percorso,
        nome: (note.allegatoNome && note.allegatoNome.trim()) || parsed.nome,
        tipo: parsed.tipo,
        estensione: parsed.estensione
      }];
    }
  }

  const firstAtt = normalizedAllegati[0] || null;

  const payload: any = {
    userEmail: cleanEmail,
    titolo: note.titolo.trim(),
    contenuto: note.contenuto.trim(),
    colore: note.colore || 'giallo',
    fissata: !!note.fissata,
    aggiornataIl: nowIso
  };

  if (note.pilaId !== undefined) {
    payload.pilaId = note.pilaId || null;
  }
  if (typeof note.ordine === 'number') {
    payload.ordine = note.ordine;
  } else if (!existing.exists()) {
    payload.ordine = 0;
  }

  if (normalizedAllegati.length > 0) {
    payload.allegati = normalizedAllegati;
    payload.allegatoPercorso = firstAtt ? firstAtt.percorso : null;
    payload.allegatoNome = firstAtt ? firstAtt.nome : null;
    payload.allegatoTipo = firstAtt ? firstAtt.tipo : null;
    payload.allegatoEstensione = firstAtt ? firstAtt.estensione : null;
  } else {
    payload.allegati = [];
    payload.allegatoPercorso = null;
    payload.allegatoNome = null;
    payload.allegatoTipo = null;
    payload.allegatoEstensione = null;
  }

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
    ordine: typeof payload.ordine === 'number' ? payload.ordine : undefined,
    pilaId: payload.pilaId || undefined,
    creataIl: existing.exists() ? existing.data()?.creataIl : nowIso,
    aggiornataIl: nowIso,
    allegatoPercorso: payload.allegatoPercorso || undefined,
    allegatoNome: payload.allegatoNome || undefined,
    allegatoTipo: payload.allegatoTipo || undefined,
    allegatoEstensione: payload.allegatoEstensione || undefined,
    allegati: normalizedAllegati
  };
}

export async function reorderPersonalNotes(notes: NotaPersonale[], userEmail: string): Promise<void> {
  if (!userEmail || !notes || notes.length === 0) return;
  const cleanEmail = userEmail.toLowerCase().trim();

  // Aggiorna subito la cache in memoria per massima reattività
  if (personalNotesCache && personalNotesCache.userEmail === cleanEmail) {
    personalNotesCache.notes = notes;
    personalNotesCache.timestamp = Date.now();
  }

  try {
    const batch = writeBatch(db);
    notes.forEach((note, index) => {
      const noteRef = doc(db, 'note_personali', note.id);
      batch.update(noteRef, {
        ordine: index,
        pilaId: note.pilaId || null
      });
    });
    await batch.commit();
  } catch (err) {
    console.error("Errore salvataggio riordinamento note:", err);
    throw err;
  }
}

export async function deletePersonalNote(noteId: string): Promise<void> {
  await deleteDoc(doc(db, 'note_personali', noteId));
  invalidatePersonalNotesCache();
}
