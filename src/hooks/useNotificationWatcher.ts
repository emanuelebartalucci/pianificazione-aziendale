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
  cleanupExpiredReadNotifications,
  type UserNotification 
} from '../utils/userNotificationService';

interface UseNotificationWatcherParams {
  userEmail: string | null;
  myAssociatedName: string | null;
  isAdmin: boolean;
  isHR: boolean;
  isDev: boolean;
  impersonatedEmail: string | null;
  coordinatori: Array<{ email: string; area: string }>;
  isGestoreForniture?: boolean;
}

export interface OperativeNotificationItem {
  id: string;
  category: 'ferie' | 'presenze' | 'weekend' | 'disponibilita' | 'richiesta_personale' | 'sollecito_presenze' | 'forniture';
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

export function useNotificationWatcher({
  userEmail,
  myAssociatedName,
  isHR,
  isDev,
  impersonatedEmail,
  coordinatori,
  isGestoreForniture
}: UseNotificationWatcherParams) {
  const [totalPendingCount, setTotalPendingCount] = useState<number>(0);
  const [operativePendingCount, setOperativePendingCount] = useState<number>(0);
  const [operativeNotifications, setOperativeNotifications] = useState<OperativeNotificationItem[]>([]);
  const [permissionState, setPermissionState] = useState<NotificationPermission>(getNotificationPermission());
  const [userNotifications, setUserNotifications] = useState<UserNotification[]>([]);
  const [unreadUserNotificationsCount, setUnreadUserNotificationsCount] = useState<number>(0);
  
  // Traccia gli ID già noti per evitare di mandare notifiche desktop all'avvio su record vecchi già presenti
  const knownIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef<boolean>(true);

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
      forniture: []
    };

    const countsMap = {
      ferieHR: 0,
      presenzeHR: 0,
      weekendHR: 0,
      disponibilitaCoord: 0,
      richiesteDisegnatoriCoord: 0,
      sollecitiPresenzeUser: 0,
      fornitureGestore: 0,
      notifichePersonali: 0
    };

    const updateAndNotify = () => {
      const operativeCount = (countsMap.ferieHR + countsMap.presenzeHR + countsMap.weekendHR + countsMap.disponibilitaCoord + countsMap.richiesteDisegnatoriCoord + countsMap.sollecitiPresenzeUser + countsMap.fornitureGestore);
      const personalCount = countsMap.notifichePersonali;
      const total = operativeCount + personalCount;

      const combinedOperative = [
        ...operativeItemsMap.ferie,
        ...operativeItemsMap.presenze,
        ...operativeItemsMap.weekend,
        ...operativeItemsMap.disponibilita,
        ...operativeItemsMap.richiestePersonale,
        ...operativeItemsMap.solleciti,
        ...operativeItemsMap.forniture
      ];
      combinedOperative.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setOperativePendingCount(operativeCount);
      setOperativeNotifications(combinedOperative);
      setTotalPendingCount(total);

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
          const created = data.createdAt || data.dataInserimento || '';

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
            createdAt: created || new Date().toISOString(),
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

          const created = data.dataInvio || data.updatedAt || '';

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
            createdAt: created || new Date().toISOString(),
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
          const created = data.createdAt || '';

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
            createdAt: created || new Date().toISOString(),
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
    }

    // 2. ASCOLTO ESCLUSIVO PER COORDINATORI (Segnalazioni disponibilità e richieste personale della PROPRIA AREA in attesa)
    const myCoordinatedAreas = isPureDev ? [] : coordinatori
      .filter(c => c.email && c.email.toLowerCase().trim() === normalizedEmail)
      .map(c => c.area);

    const isCoordinator = myCoordinatedAreas.length > 0;

    if (isCoordinator) {
      // Segnalazioni disponibilità (solo in_attesa)
      const qDispCoord = query(
        collection(db, 'segnalazioni_disponibilita'),
        where('stato', '==', 'in_attesa')
      );
      const unsubDisp = onSnapshot(qDispCoord, (snap) => {
        let matchingCount = 0;
        const items: OperativeNotificationItem[] = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          if (myCoordinatedAreas.includes(data.macroArea)) {
            const isPending = data.stato === 'in_attesa';
            const created = data.createdAt || data.timestamp || '';

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
              createdAt: created || new Date().toISOString(),
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

      // Richieste disegnatori / personale d'area (solo in_attesa)
      const qReqDisCoord = query(
        collection(db, 'richieste_disegnatori'),
        where('stato', '==', 'in_attesa')
      );
      const unsubReqDis = onSnapshot(qReqDisCoord, (snap) => {
        let matchingCount = 0;
        const items: OperativeNotificationItem[] = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          if (myCoordinatedAreas.includes(data.area)) {
            const isPending = data.stato === 'in_attesa';
            const created = data.createdAt || data.dataApprovazione || '';

            if (isPending) matchingCount++;
            const reqPerson = data.richiedenteNome || data.richiedente || '';
            const reqPrefix = reqPerson ? `Richiesta da ${reqPerson} • ` : '';
            const periodStr = formatShortDateRange(data.dataInizio, data.dataFine) || data.weekLabel || (data.settimana ? `Sett. ${data.settimana}` : '');
            const pctStr = data.percentuale ? ` • Carico ${data.percentuale}%` : '';
            const prefStr = data.risorsaPreferita ? ` • Preferenza: ${data.risorsaPreferita}` : '';
            const details = periodStr ? ` (${periodStr}${pctStr}${prefStr})` : (pctStr ? ` (${pctStr.slice(3)})` : '');
            const statoLabel = isPending
              ? 'Richiesta Personale'
              : (data.stato === 'approvata' ? '✓ Approvata' : (data.stato === 'rifiutata' ? '❌ Rifiutata' : data.stato));

            items.push({
              id: `reqdis-${docSnap.id}`,
              category: 'richiesta_personale',
              titolo: `💼 Richiesta Personale: Area ${data.area || ''}`,
              messaggio: `${reqPrefix}Commessa "${data.commessaName || ''}"${details}`,
              link: '/pianificazione-personale',
              createdAt: created || new Date().toISOString(),
              badgeLabel: statoLabel,
              isPending,
              stato: data.stato
            });
          }
        });
        operativeItemsMap.richiestePersonale = items;
        countsMap.richiesteDisegnatoriCoord = matchingCount;

        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;
            const data = change.doc.data();
            if (myCoordinatedAreas.includes(data.area) && data.stato === 'in_attesa') {
              if (!isInitialLoadRef.current && !knownIdsRef.current.has(docId)) {
                const periodStr = formatShortDateRange(data.dataInizio, data.dataFine) || data.weekLabel || (data.settimana ? `Sett. ${data.settimana}` : '');
                sendDesktopNotification("Pianificazione: Nuova Richiesta Personale", {
                  body: `Richiesta risorsa per area ${data.area || ''} sulla commessa "${data.commessaName || ''}"${periodStr ? ` (${periodStr})` : ''}.`,
                  tag: `reqdis-${docId}`
                });
              }
              knownIdsRef.current.add(docId);
            }
          }
        });
        updateAndNotify();
      }, (err) => console.error("Errore listener richieste disegnatori coordinatore:", err));
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
          items.push({
            id: `sollecito-${docSnap.id}`,
            category: 'sollecito_presenze',
            titolo: `⚠️ Revisione Presenze Richiesta`,
            messaggio: `L'HR ha richiesto modifiche sul tuo foglio ore (${data.mese}/${data.anno})`,
            link: '/presenze',
            createdAt: data.updatedAt || new Date().toISOString(),
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

          items.push({
            id: `forniture-${docSnap.id}`,
            category: 'forniture',
            titolo: `📦 Richiesta Forniture: ${data.categoria || 'Materiali'}`,
            messaggio: `${reqPerson} (${data.sede || 'Sede'})${detailStr}`,
            link: '/forniture?tab=gestione',
            createdAt: data.createdAt || new Date().toISOString(),
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
        const unreadCount = list.filter(n => !n.letta).length;
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

    // Dopo il primo ciclo sincrono di attach dei listener, disabilita il flag di caricamento iniziale
    const timer = setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 1500);

    return () => {
      clearTimeout(timer);
      unsubscribers.forEach(unsub => unsub());
      setGlobalBadgeNotification(0);
    };
  }, [userEmail, myAssociatedName, isHR, isDev, impersonatedEmail, coordinatori, isGestoreForniture]);

  return {
    totalPendingCount,
    operativePendingCount,
    operativeNotifications,
    permissionState,
    handleEnableNotifications,
    userNotifications,
    unreadUserNotificationsCount,
    markNotificationAsRead,
    markAllNotificationsAsRead
  };
}
