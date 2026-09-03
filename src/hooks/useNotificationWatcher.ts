import { useEffect, useRef, useState } from 'react';
import { db } from '../services/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { 
  setGlobalBadgeNotification, 
  sendDesktopNotification, 
  getNotificationPermission,
  requestNotificationPermission
} from '../utils/browserNotifications';
import { 
  markNotificationAsRead, 
  markAllNotificationsAsRead,
  markNotificationsAsReadByFilter,
  cleanupExpiredReadNotifications,
  type UserNotification 
} from '../utils/userNotificationService';
import { checkAndNotifyOverdueTasks } from '../utils/todoOverdueChecker';
import { areNamesEqual } from '../contexts/AuthContext';

interface UseNotificationWatcherParams {
  userEmail: string | null;
  myAssociatedName: string | null;
  isAdmin: boolean;
  isHR: boolean;
  isDev: boolean;
  impersonatedEmail: string | null;
  coordinatori: Array<{ email: string; area: string; nome?: string }>;
  isGestoreForniture?: boolean;
  dipendenti?: Array<{ id: string; nome: string; email?: string; macroArea?: string }>;
  commesse?: Array<{ id: string; nome: string; responsabile?: string; pm?: string | string[]; codiceCommessa?: string }>;
}

export interface SectionBadgeCounts {
  forniture: number;
  ferie: number;
  presenze: number;
  pianificazione: number;
  gestioneHr: number;
  commesse: number;
}

export interface OperativeNotificationItem {
  id: string;
  category: 'ferie' | 'presenze' | 'weekend' | 'disponibilita' | 'richiesta_personale' | 'sollecito_presenze' | 'forniture' | 'suggerimenti';
  titolo: string;
  messaggio: string;
  link: string;
  createdAt: string;
  badgeLabel?: string;
  isPending: boolean;
  stato?: string;
}

const formatShortDateRange = (start?: string, end?: string): string => {
  if (!start && !end) return '';
  const formatDate = (dStr: string) => {
    if (!dStr) return '';
    const parts = dStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dStr;
  };
  if (start && end) {
    return `${formatDate(start)} al ${formatDate(end)}`;
  }
  return formatDate(start || end || '');
};

const normalizeIsoDate = (val: any, fallbackDateStr?: string): string => {
  if (!val) {
    if (fallbackDateStr && typeof fallbackDateStr === 'string' && fallbackDateStr.length >= 10) {
      const parsedFallback = new Date(fallbackDateStr);
      if (!isNaN(parsedFallback.getTime())) {
        return parsedFallback.toISOString();
      }
    }
    return '';
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      try {
        return val.toDate().toISOString();
      } catch {}
    }
    if (typeof val.seconds === 'number') {
      return new Date(val.seconds * 1000).toISOString();
    }
  }
  if (fallbackDateStr && typeof fallbackDateStr === 'string' && fallbackDateStr.length >= 10) {
    const parsedFallback = new Date(fallbackDateStr);
    if (!isNaN(parsedFallback.getTime())) {
      return parsedFallback.toISOString();
    }
  }
  return '';
};

export function useNotificationWatcher({
  userEmail,
  myAssociatedName,
  isAdmin,
  isHR,
  isDev,
  impersonatedEmail,
  coordinatori,
  isGestoreForniture,
  dipendenti = [],
  commesse = []
}: UseNotificationWatcherParams) {
  const [totalPendingCount, setTotalPendingCount] = useState<number>(0);
  const [operativePendingCount, setOperativePendingCount] = useState<number>(0);
  const [operativeNotifications, setOperativeNotifications] = useState<OperativeNotificationItem[]>([]);
  const [permissionState, setPermissionState] = useState<NotificationPermission>(getNotificationPermission());
  const [userNotifications, setUserNotifications] = useState<UserNotification[]>([]);
  const [unreadUserNotificationsCount, setUnreadUserNotificationsCount] = useState<number>(0);
  const [sectionBadgeCounts, setSectionBadgeCounts] = useState<SectionBadgeCounts>({
    forniture: 0,
    ferie: 0,
    presenze: 0,
    pianificazione: 0,
    gestioneHr: 0,
    commesse: 0
  });
  
  // Traccia gli ID già noti per evitare di mandare notifiche desktop all'avvio su record vecchi già presenti
  const knownIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef<boolean>(true);

  const dipendentiRef = useRef(dipendenti);
  dipendentiRef.current = dipendenti;
  const commesseRef = useRef(commesse);
  commesseRef.current = commesse;
  const coordinatoriRef = useRef(coordinatori);
  coordinatoriRef.current = coordinatori;

  const coordKey = (coordinatori || []).map(c => `${(c.email || '').toLowerCase().trim()}_${c.area}`).sort().join(';');

  // Aggiorna lo stato dei permessi quando la finestra torna attiva
  useEffect(() => {
    const handleFocus = () => {
      setPermissionState(getNotificationPermission());
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const handleEnableNotifications = async () => {
    const granted = await requestNotificationPermission();
    setPermissionState(granted ? 'granted' : 'denied');
  };

  useEffect(() => {
    if (!userEmail) {
      setGlobalBadgeNotification(0);
      setTotalPendingCount(0);
      setOperativePendingCount(0);
      setOperativeNotifications([]);
      setUserNotifications([]);
      setUnreadUserNotificationsCount(0);
      setSectionBadgeCounts({
        forniture: 0,
        ferie: 0,
        presenze: 0,
        pianificazione: 0,
        gestioneHr: 0,
        commesse: 0
      });
      return;
    }

    const isPureDev = isDev && !impersonatedEmail;
    const unsubscribers: Array<() => void> = [];
    const normalizedEmail = userEmail.toLowerCase().trim();

    // Mappa per memorizzare i singoli elementi operativi
    const operativeItemsMap: Record<string, OperativeNotificationItem[]> = {
      ferie: [],
      presenze: [],
      weekend: [],
      disponibilita: [],
      richiestePersonale: [],
      solleciti: [],
      forniture: [],
      suggerimenti: []
    };

    const countsMap = {
      ferieHR: 0,
      presenzeHR: 0,
      weekendHR: 0,
      suggerimentiHR: 0,
      disponibilitaCoord: 0,
      richiesteDisegnatoriCoord: 0,
      sollecitiPresenzeUser: 0,
      fornitureGestore: 0,
      notifichePersonali: 0,
      personalUnreadForniture: 0,
      personalUnreadFerie: 0,
      personalUnreadPresenze: 0,
      personalUnreadCommesse: 0,
      personalUnreadGestioneHr: 0
    };

    const updateAndNotify = () => {
      const operativeCount = (
        countsMap.ferieHR + 
        countsMap.presenzeHR + 
        countsMap.weekendHR + 
        countsMap.suggerimentiHR +
        countsMap.disponibilitaCoord + 
        countsMap.richiesteDisegnatoriCoord + 
        countsMap.sollecitiPresenzeUser + 
        countsMap.fornitureGestore
      );
      const personalCount = countsMap.notifichePersonali;
      const total = operativeCount + personalCount;

      const combinedOperative = [
        ...operativeItemsMap.ferie,
        ...operativeItemsMap.presenze,
        ...operativeItemsMap.weekend,
        ...operativeItemsMap.disponibilita,
        ...operativeItemsMap.richiestePersonale,
        ...operativeItemsMap.solleciti,
        ...operativeItemsMap.forniture,
        ...operativeItemsMap.suggerimenti
      ];
      combinedOperative.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setOperativePendingCount(operativeCount);
      setOperativeNotifications(combinedOperative);
      setTotalPendingCount(total);

      // Conteggi specifici per singola sezione / card
      setSectionBadgeCounts({
        forniture: countsMap.fornitureGestore + countsMap.personalUnreadForniture,
        ferie: countsMap.ferieHR + countsMap.personalUnreadFerie,
        presenze: countsMap.presenzeHR + countsMap.weekendHR + countsMap.sollecitiPresenzeUser + countsMap.personalUnreadPresenze,
        pianificazione: countsMap.disponibilitaCoord + countsMap.richiesteDisegnatoriCoord,
        gestioneHr: countsMap.suggerimentiHR,
        commesse: countsMap.personalUnreadCommesse
      });

      if (operativeCount > 0) {
        // Badge Rosso: ci sono richieste operative da gestire
        setGlobalBadgeNotification(total, 'Richieste da Gestire', 'danger');
      } else if (personalCount > 0) {
        // Badge Blu: ci sono notifiche personali informative
        setGlobalBadgeNotification(personalCount, 'Nuove Notifiche', 'info');
      } else {
        // Nessun elemento pendente
        setGlobalBadgeNotification(0);
      }
    };

    // 1. ASCOLTO ESCLUSIVO PER UFFICIO HR (Ferie, Presenze inviate, Weekend)
    if (isHR && !isPureDev) {
      // Ferie in attesa di approvazione/gestione
      const qFerieHR = query(
        collection(db, 'richieste_ferie'),
        where('stato', 'in', ['In attesa', 'Richiesta Annullamento', 'Richiesta Modifica'])
      );
      const unsubFerie = onSnapshot(qFerieHR, (snap) => {
        let matchingCount = 0;
        const items: OperativeNotificationItem[] = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          const isPending = ['In attesa', 'Richiesta Annullamento', 'Richiesta Modifica'].includes(data.stato);
          const rawDate = data.createdAt || data.dataInserimento || data.dataRichiesta || data.timestamp;
          const created = normalizeIsoDate(rawDate, data.dataInizio) || (data.dataApprovazione ? normalizeIsoDate(data.dataApprovazione) : '') || '';

          if (isPending) matchingCount++;
          const dipName = data.dipendenteName || data.dipendenteNome || data.nome || 'Collaboratore';
          const statoLabel = data.stato === 'In attesa'
            ? 'Da Approvare'
            : (data.stato === 'Approvato' ? '✓ Approvata' : (data.stato === 'Rifiutato' ? '❌ Rifiutata' : data.stato));
          items.push({
            id: `ferie-${docSnap.id}`,
            category: 'ferie',
            titolo: `🌴 Richiesta Assenza: ${dipName}`,
            messaggio: `${data.tipo || 'Ferie'} per ${dipName} (${data.dataInizio || ''} - ${data.dataFine || ''})`,
            link: '/ferie',
            createdAt: created || new Date(0).toISOString(),
            badgeLabel: statoLabel,
            isPending,
            stato: data.stato
          });
        });
        operativeItemsMap.ferie = items;
        countsMap.ferieHR = matchingCount;

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data();
            const isPending = ['In attesa', 'Richiesta Annullamento', 'Richiesta Modifica'].includes(data.stato);
            if (isPending && !isInitialLoadRef.current && !knownIdsRef.current.has(docId)) {
              const dipName = data.dipendenteName || data.dipendenteNome || data.nome || 'Una risorsa';
              sendDesktopNotification("Pianificazione Aziendale: Nuova Richiesta Assenza", {
                body: `${dipName} ha inviato una richiesta di ${data.tipo || 'ferie/permesso'}.`,
                tag: `ferie-${docId}`
              });
            }
            knownIdsRef.current.add(docId);
          }
        });
        updateAndNotify();
      }, (err) => console.error("Errore listener ferie HR:", err));
      unsubscribers.push(unsubFerie);

      // Presenze / Bozza fattura inviate in attesa di approvazione
      const qPresenzeHR = query(
        collection(db, 'presenze'),
        where('stato', 'in', ['Inviato', 'Richiesta Sblocco'])
      );
      const unsubPresenze = onSnapshot(qPresenzeHR, (snap) => {
        let matchingCount = 0;
        const items: OperativeNotificationItem[] = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          const isPending = data.stato === 'Inviato' || data.stato === 'Richiesta Sblocco';

          const rawDate = data.dataInvio || data.updatedAt || data.createdAt || data.timestamp;
          const created = normalizeIsoDate(rawDate) || '';

          if (isPending) matchingCount++;
          const dipName = data.dipendenteNome || data.dipendenteName || data.nome || 'Collaboratore';
          const statoLabel = isPending
            ? (data.stato === 'Richiesta Sblocco' ? 'Richiesta Sblocco' : 'Inviato')
            : (data.stato === 'Approvato' ? '✓ Approvato' : data.stato);
          items.push({
            id: `presenze-${docSnap.id}`,
            category: 'presenze',
            titolo: `⏱️ Foglio Presenze: ${dipName}`,
            messaggio: `${data.stato === 'Richiesta Sblocco' ? 'Richiesta sblocco' : 'Presenze'} mese ${data.mese}/${data.anno} di ${dipName}`,
            link: '/presenze',
            createdAt: created || new Date(0).toISOString(),
            badgeLabel: statoLabel,
            isPending,
            stato: data.stato
          });
        });
        operativeItemsMap.presenze = items;
        countsMap.presenzeHR = matchingCount;

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data();
            if ((data.stato === 'Inviato' || data.stato === 'Richiesta Sblocco') && !isInitialLoadRef.current && !knownIdsRef.current.has(docId)) {
              const dipName = data.dipendenteNome || data.dipendenteName || data.nome || 'Una risorsa';
              sendDesktopNotification("Pianificazione Aziendale: Foglio Ore Inviato", {
                body: `${dipName} ha inviato il foglio presenze del mese per approvazione.`,
                tag: `presenze-${docId}`
              });
            }
            knownIdsRef.current.add(docId);
          }
        });
        updateAndNotify();
      }, (err) => console.error("Errore listener presenze HR:", err));
      unsubscribers.push(unsubPresenze);

      // Richieste lavoro festivo/weekend in attesa
      const qWeekendHR = query(
        collection(db, 'richieste_weekend'),
        where('stato', 'in', ['In attesa', 'Richiesta Annullamento', 'Richiesta Modifica'])
      );
      const unsubWeekend = onSnapshot(qWeekendHR, (snap) => {
        let matchingCount = 0;
        const items: OperativeNotificationItem[] = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          const isPending = ['In attesa', 'Richiesta Annullamento', 'Richiesta Modifica'].includes(data.stato);
          const rawDate = data.createdAt || data.richiestoIl || data.timestamp;
          const created = normalizeIsoDate(rawDate, data.data) || '';

          if (isPending) matchingCount++;
          const dipName = data.dipendenteName || data.dipendenteNome || data.nome || 'Collaboratore';
          const statoLabel = isPending
            ? 'Weekend'
            : (data.stato === 'Approvato' ? '✓ Approvato' : (data.stato === 'Rifiutato' ? '❌ Rifiutato' : data.stato));
          items.push({
            id: `weekend-${docSnap.id}`,
            category: 'weekend',
            titolo: `📅 Lavoro Festivo: ${dipName}`,
            messaggio: `Richiesta da ${dipName} per il ${data.data || ''} - ${data.motivo || 'Richiesta autorizzazione'}`,
            link: '/ferie',
            createdAt: created || new Date(0).toISOString(),
            badgeLabel: statoLabel,
            isPending,
            stato: data.stato
          });
        });
        operativeItemsMap.weekend = items;
        countsMap.weekendHR = matchingCount;

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data();
            const isPending = ['In attesa', 'Richiesta Annullamento', 'Richiesta Modifica'].includes(data.stato);
            if (isPending && !isInitialLoadRef.current && !knownIdsRef.current.has(docId)) {
              const dipName = data.dipendenteName || data.dipendenteNome || data.nome || 'Una risorsa';
              sendDesktopNotification("Pianificazione Aziendale: Lavoro Festivo", {
                body: `${dipName} richiede autorizzazione festivo per il ${data.data || ''}.`,
                tag: `weekend-${docId}`
              });
            }
            knownIdsRef.current.add(docId);
          }
        });
        updateAndNotify();
      }, (err) => console.error("Errore listener weekend HR:", err));
      unsubscribers.push(unsubWeekend);

      // Suggerimenti per HR / Gestione HR (Cassetta delle Idee)
      if (normalizedEmail) {
        // Pulisci in background eventuali vecchie notifiche duplicate personali
        markNotificationsAsReadByFilter(normalizedEmail, { tipo: 'suggerimento_ricevuto' });
      }

      const qSuggerimentiHR = collection(db, 'suggerimenti');
      const unsubSug = onSnapshot(qSuggerimentiHR, (snap) => {
        let unreadCount = 0;
        const items: OperativeNotificationItem[] = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          const st = (data.stato || 'Nuovo').trim();
          const isPending = st !== 'Letto' && st !== 'Archiviato';
          if (isPending) unreadCount++;

          const rawDate = data.createdAt || data.data || data.timestamp;
          const created = normalizeIsoDate(rawDate) || '';

          items.push({
            id: `suggerimento-${docSnap.id}`,
            category: 'suggerimenti',
            titolo: `💡 Suggerimento: ${data.categoria || 'Cassetta Idee'}`,
            messaggio: data.testo ? (data.testo.length > 120 ? data.testo.substring(0, 120) + '...' : data.testo) : 'Nuovo messaggio anonimo.',
            link: '/gestione-hr',
            createdAt: created || new Date(0).toISOString(),
            badgeLabel: isPending ? (st === 'Nuovo' ? 'Nuovo' : 'Da Leggere') : '✓ Letto',
            isPending,
            stato: st
          });
        });

        operativeItemsMap.suggerimenti = items;
        countsMap.suggerimentiHR = unreadCount;

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data();
            const st = (data.stato || 'Nuovo').trim();
            const isPending = st !== 'Letto' && st !== 'Archiviato';
            if (isPending && !isInitialLoadRef.current && !knownIdsRef.current.has(docId)) {
              sendDesktopNotification("Cassetta delle Idee: Nuovo Suggerimento", {
                body: `È arrivato un nuovo suggerimento anonimo (${data.categoria || 'Generale'}).`,
                tag: `suggerimento-${docId}`
              });
            }
            knownIdsRef.current.add(docId);
          }
        });

        updateAndNotify();
      }, (err) => console.error("Errore listener suggerimenti HR:", err));
      unsubscribers.push(unsubSug);
    }

    // 2. ASCOLTO ESCLUSIVO PER COORDINATORI (Segnalazioni disponibilità e richieste personale della PROPRIA AREA in attesa)
    const myCoordinatedAreas = (() => {
      if (isPureDev) return [];
      const areas = new Set<string>();
      const uClean = normalizedEmail || '';
      const nClean = (myAssociatedName || '').toLowerCase().trim();
      const uUser = uClean.split('@')[0];

      (coordinatori || []).forEach(c => {
        const cEmail = (c.email || '').toLowerCase().trim();
        const cNome = (c.nome || '').toLowerCase().trim();
        if (cEmail && uClean && (cEmail === uClean || cEmail.includes(uClean) || uClean.includes(cEmail))) {
          if (c.area) areas.add(c.area.trim());
        }
        if (cNome && nClean && areNamesEqual(cNome, nClean)) {
          if (c.area) areas.add(c.area.trim());
        }
        const cUser = cEmail.split('@')[0];
        if (cUser && uUser && (cUser.includes(uUser) || uUser.includes(cUser))) {
          if (c.area) areas.add(c.area.trim());
        }
      });

      if (uClean.includes('badalassi') || uClean.includes('taddei') || nClean.includes('badalassi') || nClean.includes('taddei')) {
        areas.add('Ingegneria');
      }
      if (uClean.includes('romanello') || nClean.includes('romanello')) {
        areas.add('Disegnatori');
      }
      if (uClean.includes('bondi') || nClean.includes('bondi')) {
        areas.add('Sicurezza Cantieri');
      }
      if (uClean.includes('votino') || nClean.includes('votino')) {
        areas.add('Consulenza Sicurezza');
      }
      if (uClean.includes('corbellini') || nClean.includes('corbellini')) {
        areas.add('Amministrazione');
      }

      return Array.from(areas);
    })();

    const isCoordinator = myCoordinatedAreas.length > 0;

    if (isCoordinator) {
      // Segnalazioni disponibilità (in attesa e storiche gestite)
      const qDispCoord = query(
        collection(db, 'segnalazioni_disponibilita')
      );
      const unsubDisp = onSnapshot(qDispCoord, (snap) => {
        let matchingCount = 0;
        const items: OperativeNotificationItem[] = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          if (myCoordinatedAreas.includes(data.macroArea)) {
            const isPending = data.stato === 'in_attesa';
            const rawDate = data.createdAt || data.timestamp;
            const created = normalizeIsoDate(rawDate, data.data || data.dataInizio) || '';

            if (isPending) matchingCount++;
            const resName = data.risorsaNome || data.dipendenteNome || data.nome || 'Collaboratore';
            const periodStr = data.settimanaLabel || formatShortDateRange(data.dataInizio, data.dataFine) || data.weekLabel || (data.settimana ? `Sett. ${data.settimana}` : '');
            const details = periodStr ? ` (${periodStr})` : '';
            const statoLabel = isPending
              ? 'Disponibilità'
              : (data.stato === 'gestita' ? '✓ Gestita' : (data.stato || 'Gestita'));

            items.push({
              id: `disp-${docSnap.id}`,
              category: 'disponibilita',
              titolo: `🙋 Chiedi Lavoro: ${resName}`,
              messaggio: `${resName} (Area ${data.macroArea || ''}) segnala disponibilità${details}`,
              link: '/pianificazione-personale',
              createdAt: created || new Date(0).toISOString(),
              badgeLabel: statoLabel,
              isPending,
              stato: data.stato
            });
          }
        });
        operativeItemsMap.disponibilita = items;
        countsMap.disponibilitaCoord = matchingCount;

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data();
            if (myCoordinatedAreas.includes(data.macroArea) && data.stato === 'in_attesa') {
              if (!isInitialLoadRef.current && !knownIdsRef.current.has(docId)) {
                const resName = data.risorsaNome || data.dipendenteNome || data.nome || 'Una risorsa';
                const periodStr = data.settimanaLabel || formatShortDateRange(data.dataInizio, data.dataFine) || data.weekLabel || (data.settimana ? `Sett. ${data.settimana}` : '');
                sendDesktopNotification("Pianificazione: Risorsa Disponibile (Chiedi Lavoro)", {
                  body: `${resName} (${data.macroArea || ''}) segnala disponibilità/scarico${periodStr ? ` (${periodStr})` : ''}.`,
                  tag: `disp-${docId}`
                });
              }
              knownIdsRef.current.add(docId);
            }
          }
        });
        updateAndNotify();
      }, (err) => console.error("Errore listener disponibilità coordinatore:", err));
      unsubscribers.push(unsubDisp);
    }

    // 2b. ASCOLTO RICHIESTE PERSONALE / INSERIMENTO COMMESSA (Coordinatori d'area e Responsabili/PM di Commessa)
    if (normalizedEmail) {
      const currentDip = (dipendenti || []).find(d => 
        (d.email && normalizedEmail && d.email.toLowerCase().trim() === normalizedEmail) ||
        (myAssociatedName && areNamesEqual(d.nome, myAssociatedName))
      );
      const effectiveName = myAssociatedName || currentDip?.nome || '';

      const checkNameMatch = (targetName?: string | null): boolean => {
        if (!targetName) return false;
        const tClean = targetName.toLowerCase().trim();
        if (effectiveName && areNamesEqual(effectiveName, targetName)) return true;
        if (currentDip?.nome && areNamesEqual(currentDip.nome, targetName)) return true;
        if (normalizedEmail) {
          const userOnly = normalizedEmail.split('@')[0].toLowerCase().trim();
          if (userOnly.length >= 3 && tClean.includes(userOnly)) return true;
          if (currentDip?.email && currentDip.email.toLowerCase().trim() === tClean) return true;
        }
        return false;
      };

      const commesseMap = new Map<string, { id: string; nome?: string; responsabile?: string; pm?: string | string[]; codiceCommessa?: string }>();
      (commesse || []).forEach(c => {
        if (c && c.id) {
          commesseMap.set(c.id, {
            id: c.id,
            nome: c.nome,
            responsabile: c.responsabile,
            pm: c.pm,
            codiceCommessa: c.codiceCommessa
          });
        }
      });

      const findCommData = (cId?: string, cName?: string, cCode?: string) => {
        if (cId && commesseMap.has(cId)) return commesseMap.get(cId);
        for (const c of commesseMap.values()) {
          if (cId && (c.id === cId || c.codiceCommessa === cId)) return c;
          if (cName && (c.nome === cName || areNamesEqual(c.nome || '', cName))) return c;
          if (cCode && (c.codiceCommessa === cCode || c.id === cCode)) return c;
        }
        return undefined;
      };

      let latestReqSnaps: any[] = [];

      const processRichieste = () => {
        let matchingCount = 0;
        const items: OperativeNotificationItem[] = [];

        latestReqSnaps.forEach(docSnap => {
          const data = docSnap.data();
          const docId = docSnap.id;
          const reqEmail = (data.richiedenteEmail || '').toLowerCase().trim();
          const reqName = data.richiedenteNome || data.richiedente;

          const isSelf = Boolean(
            (normalizedEmail && reqEmail && normalizedEmail === reqEmail) ||
            (effectiveName && reqName && areNamesEqual(effectiveName, reqName)) ||
            (currentDip?.nome && reqName && areNamesEqual(currentDip.nome, reqName))
          );

          // 1. Il richiedente NON riceve MAI la notifica operativa "Richiesta da Gestire" per la propria richiesta
          if (isSelf) return;

          const isPending = data.stato === 'in_attesa';

          // Lookup commessa per ID o Nome o Codice
          const commData = findCommData(data.commessaId, data.commessaName || data.commessaNome, data.codiceCommessa);

          const commResp = data.commessaResponsabile || commData?.responsabile;
          const commPM = data.commessaPM || commData?.pm;

          const isCommManager = checkNameMatch(commResp) || (
            typeof commPM === 'string' 
              ? checkNameMatch(commPM) 
              : Array.isArray(commPM) && commPM.some(p => checkNameMatch(p))
          );

          const isInserimentoCommessa = data.fonte === 'altre_commesse';
          let isTargetRecipient = false;

          if (isInserimentoCommessa) {
            // Richiesta di inserimento da "Altre Commesse": destinata al Responsabile e PM della commessa
            if (isCommManager) {
              isTargetRecipient = true;
            }
          } else {
            // Richiesta standard di personale per un'area: destinata ESCLUSIVAMENTE al Coordinatore di quell'Area
            const reqArea = (data.area || 'Disegnatori').toLowerCase().trim();
            if (myCoordinatedAreas.some(a => (a || '').toLowerCase().trim() === reqArea)) {
              isTargetRecipient = true;
            }
          }

          if (isTargetRecipient) {
            const rawDate = data.createdAt || data.dataCreazione || data.dataRichiesta || data.dataInvio || data.timestamp;
            const created = normalizeIsoDate(rawDate, data.dataInizio) || (data.dataApprovazione ? normalizeIsoDate(data.dataApprovazione) : '') || '';
            if (isPending) matchingCount++;

            const reqPerson = data.richiedenteNome || data.richiedente || '';
            const reqPrefix = reqPerson ? `Richiesta da ${reqPerson} • ` : '';
            const periodStr = formatShortDateRange(data.dataInizio, data.dataFine) || data.weekLabel || (data.settimana ? `Sett. ${data.settimana}` : '');
            const pctStr = data.percentuale ? ` • Carico ${data.percentuale}%` : '';
            const prefStr = data.risorsaPreferita ? ` • Preferenza: ${data.risorsaPreferita}` : '';
            const details = periodStr ? ` (${periodStr}${pctStr}${prefStr})` : (pctStr ? ` (${pctStr.slice(3)})` : '');
            const statoLabel = isPending
              ? (isCommManager ? 'Inserimento Risorsa' : 'Richiesta Personale')
              : (data.stato === 'approvata' ? '✓ Approvata' : (data.stato === 'rifiutata' ? '❌ Rifiutata' : data.stato));

            const title = isCommManager
              ? `💼 Inserimento Risorsa: ${data.commessaName || data.commessaNome || ''}`
              : `💼 Richiesta Personale: Area ${data.area || ''}`;

            const msg = isCommManager
              ? `${reqPrefix}Inserimento ${data.risorsaPreferita || 'personale'} su "${data.commessaName || data.commessaNome || ''}"${details}`
              : `${reqPrefix}Commessa "${data.commessaName || ''}"${details}`;

            items.push({
              id: `reqdis-${docId}`,
              category: 'richiesta_personale',
              titolo: title,
              messaggio: msg,
              link: '/pianificazione-personale',
              createdAt: created || new Date(0).toISOString(),
              badgeLabel: statoLabel,
              isPending,
              stato: data.stato
            });
          }
        });

        operativeItemsMap.richiestePersonale = items;
        countsMap.richiesteDisegnatoriCoord = matchingCount;
        updateAndNotify();
      };

      // Listener su catalogo_commesse per lookup responsabile/pm
      const qCommesse = collection(db, 'catalogo_commesse');
      const unsubCommesse = onSnapshot(qCommesse, (snap) => {
        snap.forEach(docSnap => {
          const d = docSnap.data();
          commesseMap.set(docSnap.id, {
            id: docSnap.id,
            nome: d.nome || d.denominazione || d.titolo || d.codiceCommessa,
            responsabile: d.responsabile || d.responsabileCommessa || d.pm,
            pm: d.pm || d.projectManager,
            codiceCommessa: d.codiceCommessa
          });
        });
        processRichieste();
      }, (err) => console.error("Errore listener catalogo_commesse watcher:", err));
      unsubscribers.push(unsubCommesse);

      // Listener su richieste disegnatori / personale
      const qReqDis = collection(db, 'richieste_disegnatori');
      const unsubReqDis = onSnapshot(qReqDis, (snap) => {
        latestReqSnaps = snap.docs;
        processRichieste();

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data();
            const reqEmail = (data.richiedenteEmail || '').toLowerCase().trim();
            const reqName = data.richiedenteNome || data.richiedente;
            const isSelf = Boolean(
              (normalizedEmail && reqEmail && normalizedEmail === reqEmail) ||
              (effectiveName && reqName && areNamesEqual(effectiveName, reqName)) ||
              (currentDip?.nome && reqName && areNamesEqual(currentDip.nome, reqName))
            );

            if (isSelf) return;

            const commData = findCommData(data.commessaId, data.commessaName || data.commessaNome, data.codiceCommessa);

            const commResp = data.commessaResponsabile || commData?.responsabile;
            const commPM = data.commessaPM || commData?.pm;
            const isCommManager = checkNameMatch(commResp) || (
              typeof commPM === 'string' 
                ? checkNameMatch(commPM) 
                : Array.isArray(commPM) && commPM.some(p => checkNameMatch(p))
            );

            const isInserimentoCommessa = data.fonte === 'altre_commesse';
            let isTargetRecipient = false;

            if (isInserimentoCommessa) {
              // Richiesta di inserimento da "Altre Commesse": destinata al Responsabile e PM della commessa
              if (isCommManager) {
                isTargetRecipient = true;
              }
            } else {
              // Richiesta standard di personale per un'area: destinata ESCLUSIVAMENTE al Coordinatore di quell'Area
              const reqArea = (data.area || 'Disegnatori').toLowerCase().trim();
              if (myCoordinatedAreas.some(a => (a || '').toLowerCase().trim() === reqArea)) {
                isTargetRecipient = true;
              }
            }

            if (isTargetRecipient && data.stato === 'in_attesa') {
              if (!isInitialLoadRef.current && !knownIdsRef.current.has(docId)) {
                const periodStr = formatShortDateRange(data.dataInizio, data.dataFine) || data.weekLabel || (data.settimana ? `Sett. ${data.settimana}` : '');
                sendDesktopNotification(
                  isCommManager ? "Pianificazione: Richiesta Inserimento Risorsa" : "Pianificazione: Nuova Richiesta Personale",
                  {
                    body: isCommManager
                      ? `Richiesta inserimento ${data.risorsaPreferita || 'personale'} da ${data.richiedenteNome || ''} sulla commessa "${data.commessaName || ''}"${periodStr ? ` (${periodStr})` : ''}.`
                      : `Richiesta risorsa per area ${data.area || ''} sulla commessa "${data.commessaName || ''}"${periodStr ? ` (${periodStr})` : ''}.`,
                    tag: `reqdis-${docId}`
                  }
                );
              }
              knownIdsRef.current.add(docId);
            }
          }
        });
      }, (err) => console.error("Errore listener richieste disegnatori coordinatore/PM:", err));
      unsubscribers.push(unsubReqDis);
    }

    // 3. ASCOLTO PER DIPENDENTI & COLLABORATORI (Solleciti modifiche sul proprio foglio ore dall'HR)
    if (normalizedEmail) {
      const qMyPresenze = query(
        collection(db, 'presenze'),
        where('dipendenteEmail', '==', normalizedEmail),
        where('stato', '==', 'Richiede Modifica')
      );
      const unsubMyPresenze = onSnapshot(qMyPresenze, (snap) => {
        countsMap.sollecitiPresenzeUser = snap.size;
        const items: OperativeNotificationItem[] = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          const rawDate = data.updatedAt || data.timestamp || data.createdAt;
          const created = normalizeIsoDate(rawDate) || '';
          items.push({
            id: `sollecito-${docSnap.id}`,
            category: 'sollecito_presenze',
            titolo: `⚠️ Revisione Presenze Richiesta`,
            messaggio: `L'HR ha richiesto modifiche sul tuo foglio ore (${data.mese}/${data.anno})`,
            link: '/presenze',
            createdAt: created || new Date(0).toISOString(),
            badgeLabel: 'Da Modificare',
            isPending: true,
            stato: data.stato
          });
        });
        operativeItemsMap.solleciti = items;

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data();
            if (!isInitialLoadRef.current && !knownIdsRef.current.has(docId)) {
              sendDesktopNotification("Pianificazione Aziendale: Modifica Richiesta Presenze", {
                body: `L'HR richiede verifiche/correzioni sul tuo foglio presenze (${data.mese}/${data.anno}).`,
                tag: `pres-corr-${docId}`
              });
            }
            knownIdsRef.current.add(docId);
          }
        });
        updateAndNotify();
      }, (err) => console.error("Errore listener solleciti dipendente:", err));
      unsubscribers.push(unsubMyPresenze);
    }

    // 4. ASCOLTO PER GESTORI FORNITURE & ACQUISTI
    if (isGestoreForniture) {
      const qForniture = query(
        collection(db, 'richieste_forniture'),
        where('stato', '==', 'In attesa')
      );
      const unsubForniture = onSnapshot(qForniture, (snap) => {
        let matchingCount = 0;
        const items: OperativeNotificationItem[] = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          const isPending = data.stato === 'In attesa';
          if (isPending) matchingCount++;
          const reqPerson = data.richiedenteNome || data.richiedenteEmail || 'Collaboratore';
          const artStr = data.cosaManca || (data.articoliSelezionati || []).join(', ') || data.altroDettaglio || '';
          const detailStr = artStr ? `: ${artStr}` : '';
          const rawDate = data.createdAt || data.dataRichiesta || data.timestamp;
          const created = normalizeIsoDate(rawDate) || '';

          items.push({
            id: `forniture-${docSnap.id}`,
            category: 'forniture',
            titolo: `📦 Richiesta Forniture: ${data.categoria || 'Materiali'}`,
            messaggio: `${reqPerson} (${data.sede || 'Sede'})${detailStr}`,
            link: '/forniture?tab=gestione',
            createdAt: created || new Date(0).toISOString(),
            badgeLabel: 'Da Rifornire',
            isPending,
            stato: data.stato
          });
        });

        operativeItemsMap.forniture = items;
        countsMap.fornitureGestore = matchingCount;

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data();
            if (data.stato === 'In attesa' && !isInitialLoadRef.current && !knownIdsRef.current.has(docId)) {
              const reqPerson = data.richiedenteNome || 'Un collaboratore';
              sendDesktopNotification("Forniture: Nuova Richiesta Materiali", {
                body: `${reqPerson} ha inviato una richiesta di materiali per "${data.categoria || 'Forniture'}" (${data.sede || 'Sede'}).`,
                tag: `forniture-${docId}`,
                onClick: () => {
                  window.location.href = '/forniture?tab=gestione';
                }
              });
            }
            knownIdsRef.current.add(docId);
          }
        });
        updateAndNotify();
      }, (err) => console.error("Errore listener richieste forniture gestore:", err));
      unsubscribers.push(unsubForniture);
    }

    // 5. ASCOLTO NOTIFICHE INFORMATIVE PERSONALI (Ferie Approvate, Presenze Approvate, Pianificazione Aggiornata)
    if (normalizedEmail) {
      // Esegui la pulizia in background delle sole notifiche lette più vecchie di 60 giorni
      cleanupExpiredReadNotifications(normalizedEmail);

      const qPersonalNotif = query(
        collection(db, 'notifiche_utenti'),
        where('destinatarioEmail', '==', normalizedEmail)
      );
      const unsubPersonal = onSnapshot(qPersonalNotif, (snap) => {
        const list: UserNotification[] = [];
        snap.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() } as UserNotification);
        });

        // Ordina per data decrescente
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const unreadList = list.filter(n => !n.letta);
        const unreadCount = unreadList.length;

        // Distribuzione notifiche personali non lette per sezione di destinazione
        let personalForniture = 0;
        let personalFerie = 0;
        let personalPresenze = 0;
        let personalCommesse = 0;
        let personalGestioneHr = 0;

        unreadList.forEach(n => {
          const l = (n.link || '').toLowerCase();
          if (l.includes('/forniture')) personalForniture++;
          else if (l.includes('/ferie')) personalFerie++;
          else if (l.includes('/presenze')) personalPresenze++;
          else if (l.includes('/commesse')) personalCommesse++;
          else if (l.includes('/gestione-hr')) personalGestioneHr++;
        });

        countsMap.personalUnreadForniture = personalForniture;
        countsMap.personalUnreadFerie = personalFerie;
        countsMap.personalUnreadPresenze = personalPresenze;
        countsMap.personalUnreadCommesse = personalCommesse;
        countsMap.personalUnreadGestioneHr = personalGestioneHr;

        setUserNotifications(list);
        setUnreadUserNotificationsCount(unreadCount);
        countsMap.notifichePersonali = unreadCount;
        updateAndNotify();

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data() as UserNotification;
            if (!isInitialLoadRef.current && !knownIdsRef.current.has(docId) && !data.letta) {
              sendDesktopNotification(data.titolo, {
                body: data.messaggio,
                tag: `notif-${docId}`
              });
            }
            knownIdsRef.current.add(docId);
          }
        });
      }, (err) => console.error("Errore listener notifiche personali:", err));
      unsubscribers.push(unsubPersonal);
    }

    // 6. CONTROLLO SCADENZE ATTIVITÀ TODO (Notifiche automatiche il giorno successivo alla scadenza alle ore 09:00)
    if (normalizedEmail) {
      checkAndNotifyOverdueTasks(dipendentiRef.current || dipendenti);
      const overdueInterval = setInterval(() => {
        checkAndNotifyOverdueTasks(dipendentiRef.current || dipendenti);
      }, 15 * 60 * 1000);
      unsubscribers.push(() => clearInterval(overdueInterval));
    }

    // Dopo il primo ciclo sincrono di attach dei listener, disabilita il flag di caricamento iniziale
    const timer = setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 1500);

    return () => {
      clearTimeout(timer);
      unsubscribers.forEach(unsub => unsub());
      setGlobalBadgeNotification(0);
    };
  }, [userEmail, myAssociatedName, isAdmin, isHR, isDev, impersonatedEmail, coordKey, isGestoreForniture]);

  return {
    totalPendingCount,
    operativePendingCount,
    operativeNotifications,
    permissionState,
    handleEnableNotifications,
    userNotifications,
    unreadUserNotificationsCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    sectionBadgeCounts
  };
}
