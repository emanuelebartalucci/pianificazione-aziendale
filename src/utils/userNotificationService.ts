import { db } from '../services/firebase';
import { 
  collection, 
  addDoc, 
  doc, 
  updateDoc, 
  query, 
  where, 
  getDocs, 
  writeBatch 
} from 'firebase/firestore';

export interface UserNotification {
  id?: string;
  destinatarioEmail: string;
  destinatarioNome: string;
  titolo: string;
  messaggio: string;
  tipo: 'ferie_approvate' | 'presenze_approvate' | 'pianificazione_aggiornata' | 'suggerimento_ricevuto' | 'todo_assegnato' | 'todo_completato' | 'todo_scaduto' | 'info';
  link?: string;
  taskId?: string;
  commessaId?: string;
  letta: boolean;
  createdAt: string;
}

/**
 * Crea un record di notifica informativa personale per un dipendente/collaboratore
 */
export async function createUserNotification(data: {
  destinatarioEmail: string;
  destinatarioNome: string;
  titolo: string;
  messaggio: string;
  tipo: 'ferie_approvate' | 'presenze_approvate' | 'pianificazione_aggiornata' | 'suggerimento_ricevuto' | 'todo_assegnato' | 'todo_completato' | 'todo_scaduto' | 'info';
  link?: string;
  taskId?: string;
  commessaId?: string;
}) {
  if (!data.destinatarioEmail || !data.destinatarioEmail.trim()) return;
  const targetEmail = data.destinatarioEmail.toLowerCase().trim();
  try {
    // Controllo anti-duplicazione tra le non lette
    const qDuplicate = query(
      collection(db, 'notifiche_utenti'),
      where('destinatarioEmail', '==', targetEmail),
      where('letta', '==', false)
    );

    const existingSnap = await getDocs(qDuplicate);
    const isDuplicate = existingSnap.docs.some(docSnap => {
      const d = docSnap.data();
      if (data.tipo === 'todo_scaduto') {
        if (data.taskId && d.taskId === data.taskId) return true;
        if (d.titolo === data.titolo && (d.messaggio || '').trim() === (data.messaggio || '').trim()) return true;
        return false;
      }
      return d.titolo === data.titolo && (d.messaggio || '').trim() === (data.messaggio || '').trim();
    });

    if (isDuplicate) {
      // Notifica identica non ancora letta già presente, non duplicare
      return;
    }

    const payload: any = {
      destinatarioEmail: targetEmail,
      destinatarioNome: data.destinatarioNome || '',
      titolo: data.titolo,
      messaggio: data.messaggio,
      tipo: data.tipo,
      link: data.link || '',
      letta: false,
      createdAt: new Date().toISOString()
    };
    if (data.taskId) payload.taskId = data.taskId;
    if (data.commessaId) payload.commessaId = data.commessaId;

    await addDoc(collection(db, 'notifiche_utenti'), payload);
  } catch (err) {
    console.error("Errore salvataggio notifica informativa utente:", err);
  }
}

/**
 * Segna una notifica specifica come letta
 */
export async function markNotificationAsRead(id: string) {
  if (!id) return;
  try {
    await updateDoc(doc(db, 'notifiche_utenti', id), { letta: true });
  } catch (err) {
    console.error("Errore aggiornamento lettura notifica:", err);
  }
}

/**
 * Segna tutte le notifiche non lette dell'utente come lette.
 * Di default preserva le notifiche 'todo_scaduto', affinché rimangano attive
 * fino al reale completamento o posticipo della scadenza dell'attività.
 */
export async function markAllNotificationsAsRead(userEmail: string, preserveOverdue: boolean = true) {
  if (!userEmail || !userEmail.trim()) return;
  try {
    const q = query(
      collection(db, 'notifiche_utenti'),
      where('destinatarioEmail', '==', userEmail.toLowerCase().trim()),
      where('letta', '==', false)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const batch = writeBatch(db);
    let count = 0;
    snap.forEach(d => {
      const data = d.data();
      if (preserveOverdue && data.tipo === 'todo_scaduto') {
        return;
      }
      batch.update(d.ref, { letta: true });
      count++;
    });
    if (count > 0) {
      await batch.commit();
    }
  } catch (err) {
    console.error("Errore segna tutte come lette:", err);
  }
}

/**
 * Risolve/segna come lette le notifiche di attività scaduta ('todo_scaduto') per un compito specifico.
 * Viene invocata quando l'attività viene contrassegnata come completata, eliminata
 * o quando la data di scadenza viene posticipata ad oggi o nel futuro.
 */
export async function markOverdueNotificationsAsReadForTask(taskId: string, taskTitle?: string) {
  if (!taskId && !taskTitle) return;
  try {
    const q = query(
      collection(db, 'notifiche_utenti'),
      where('tipo', '==', 'todo_scaduto'),
      where('letta', '==', false)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const batch = writeBatch(db);
    let count = 0;
    const cleanTitle = taskTitle?.trim().toLowerCase();

    snap.forEach(docSnap => {
      const d = docSnap.data();
      let match = false;
      if (taskId && d.taskId === taskId) {
        match = true;
      } else if (taskId && d.link && (d.link.includes(`taskId=${encodeURIComponent(taskId)}`) || d.link.includes(`taskId=${taskId}`))) {
        match = true;
      } else if (cleanTitle && d.messaggio && d.messaggio.toLowerCase().includes(`"${cleanTitle}"`)) {
        match = true;
      }

      if (match) {
        batch.update(docSnap.ref, { letta: true });
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
    }
  } catch (err) {
    console.error("Errore pulizia notifiche scadenza per task:", err);
  }
}

/**
 * Elimina automaticamente dal database le notifiche personali già lette più vecchie di 60 giorni.
 * IMPORTANTE: Le notifiche NON lette (letta === false) NON vengono MAI cancellate,
 * garantendo la piena visibilità a chi rientra da lunghi periodi di malattia o assenza.
 */
export async function cleanupExpiredReadNotifications(userEmail: string) {
  if (!userEmail || !userEmail.trim()) return;
  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const q = query(
      collection(db, 'notifiche_utenti'),
      where('destinatarioEmail', '==', userEmail.toLowerCase().trim()),
      where('letta', '==', true),
      where('createdAt', '<', sixtyDaysAgo)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const batch = writeBatch(db);
    snap.forEach(d => {
      batch.delete(d.ref);
    });
    await batch.commit();
  } catch (err) {
    console.error("Errore pulizia automatica notifiche lette scadute:", err);
  }
}

/**
 * Segna come lette tutte le notifiche non lette che corrispondono a un tipo o contengono un percorso link
 */
export async function markNotificationsAsReadByFilter(
  userEmail: string, 
  filter: { tipo?: string; linkContains?: string }
) {
  if (!userEmail || !userEmail.trim()) return;
  try {
    const q = query(
      collection(db, 'notifiche_utenti'),
      where('destinatarioEmail', '==', userEmail.toLowerCase().trim()),
      where('letta', '==', false)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const batch = writeBatch(db);
    let count = 0;
    snap.forEach(docSnap => {
      const data = docSnap.data();
      let match = true;
      if (filter.tipo && data.tipo !== filter.tipo) match = false;
      if (filter.linkContains && !(data.link || '').toLowerCase().includes(filter.linkContains.toLowerCase())) match = false;
      if (match) {
        batch.update(docSnap.ref, { letta: true });
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
    }
  } catch (err) {
    console.error("Errore marcatura notifiche come lette da filtro:", err);
  }
}
