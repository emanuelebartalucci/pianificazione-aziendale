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
  tipo: 'ferie_approvate' | 'presenze_approvate' | 'pianificazione_aggiornata' | 'suggerimento_ricevuto' | 'todo_assegnato' | 'todo_completato' | 'info';
  link?: string;
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
  tipo: 'ferie_approvate' | 'presenze_approvate' | 'pianificazione_aggiornata' | 'suggerimento_ricevuto' | 'todo_assegnato' | 'todo_completato' | 'info';
  link?: string;
}) {
  if (!data.destinatarioEmail || !data.destinatarioEmail.trim()) return;
  const targetEmail = data.destinatarioEmail.toLowerCase().trim();
  try {
    // Controllo anti-duplicazione: evita di creare notifiche identiche non lette per lo stesso utente
    const qDuplicate = query(
      collection(db, 'notifiche_utenti'),
      where('destinatarioEmail', '==', targetEmail),
      where('letta', '==', false)
    );
    const existingSnap = await getDocs(qDuplicate);
    const isDuplicate = existingSnap.docs.some(docSnap => {
      const d = docSnap.data();
      return d.titolo === data.titolo && (d.messaggio || '').trim() === (data.messaggio || '').trim();
    });

    if (isDuplicate) {
      // Notifica identica già presente e non letta, non duplicare
      return;
    }

    await addDoc(collection(db, 'notifiche_utenti'), {
      destinatarioEmail: targetEmail,
      destinatarioNome: data.destinatarioNome || '',
      titolo: data.titolo,
      messaggio: data.messaggio,
      tipo: data.tipo,
      link: data.link || '',
      letta: false,
      createdAt: new Date().toISOString()
    });
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
 * Segna tutte le notifiche non lette dell'utente come lette
 */
export async function markAllNotificationsAsRead(userEmail: string) {
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
    snap.forEach(d => {
      batch.update(d.ref, { letta: true });
    });
    await batch.commit();
  } catch (err) {
    console.error("Errore segna tutte come lette:", err);
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
