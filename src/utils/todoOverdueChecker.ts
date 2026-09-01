import { db } from '../services/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { createUserNotification } from './userNotificationService';

const areNamesEqual = (n1?: string | null, n2?: string | null): boolean => {
  if (!n1 || !n2) return false;
  const clean1 = n1.toLowerCase().trim().replace(/\s+/g, ' ');
  const clean2 = n2.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean1 === clean2) return true;
  const p1 = clean1.split(' ').sort().join(' ');
  const p2 = clean2.split(' ').sort().join(' ');
  return p1 === p2;
};

/**
 * Controlla tutte le attività ToDo / PunchList delle commesse.
 * Se un compito ha una data di scadenza superata e non è completato:
 * - Se la scadenza era ieri: invia l'avviso a partire dalle ore 09:00 del giorno successivo.
 * - Se la scadenza era di 2 o più giorni fa: invia l'avviso in qualsiasi momento.
 * 
 * Destinatari:
 * 1. La risorsa a cui è assegnata l'attività
 * 2. Chi ha creato l'attività (o il Responsabile della Commessa se il creatore non è esplicitato)
 */
export async function checkAndNotifyOverdueTasks(dipendentiList: any[] = []) {
  if (!dipendentiList || dipendentiList.length === 0) return;

  try {
    const now = new Date();
    const currentHour = now.getHours();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const commesseSnap = await getDocs(collection(db, 'commesse'));
    if (commesseSnap.empty) return;

    for (const commDoc of commesseSnap.docs) {
      const comm = { id: commDoc.id, ...commDoc.data() } as any;
      const punchList = comm.punchList;
      if (!punchList || !Array.isArray(punchList) || punchList.length === 0) continue;

      for (const task of punchList) {
        if (!task.scadenza) continue;
        if (task.done || task.categoria === 'completato' || task.categoria === 'approvato') continue;

        // Verifica condizione di scadenza
        const scadenzaStr = task.scadenza;
        if (scadenzaStr >= todayStr) {
          // La scadenza è oggi o futura: non ancora scaduta
          continue;
        }

        if (scadenzaStr === yesterdayStr && currentHour < 9) {
          // Scaduto ieri, ma non sono ancora le ore 09:00 del giorno successivo
          continue;
        }

        const formattedScadenza = scadenzaStr.split('-').reverse().join('/');
        const catLabel = (task.categoria || 'da fare').toUpperCase();
        const taskTitle = task.titolo || 'Attività';
        const commName = comm.nome || 'Commessa';
        const commLink = `/commesse?todoCommessaId=${encodeURIComponent(comm.id)}`;

        // 1. Destinatario: Risorsa assegnata
        if (task.assegnatoA && task.assegnatoA.trim()) {
          const assigneeDip = dipendentiList.find(d => areNamesEqual(d.nome, task.assegnatoA));
          if (assigneeDip?.email) {
            await createUserNotification({
              destinatarioEmail: assigneeDip.email,
              destinatarioNome: assigneeDip.nome,
              titolo: `⚠️ Attività ToDo scaduta: ${commName}`,
              messaggio: `L'attività [${catLabel}] "${taskTitle}" nella commessa ${commName} è scaduta il ${formattedScadenza} e risulta ancora da completare.`,
              tipo: 'todo_scaduto',
              link: commLink
            });
          }
        }

        // 2. Destinatario: Chi ha creato il compito (SOLO ed esclusivamente se indicato in task.creatoDa)
        const creatorName = (task.creatoDa && task.creatoDa.trim()) ? task.creatoDa.trim() : null;
        if (creatorName && !areNamesEqual(creatorName, task.assegnatoA)) {
          const creatorDip = dipendentiList.find(d => 
            areNamesEqual(d.nome, creatorName) || 
            (d.email && d.email.toLowerCase() === creatorName.toLowerCase())
          );
          const creatorEmail = creatorDip?.email || (creatorName.includes('@') ? creatorName : null);
          const creatorDisplayName = creatorDip?.nome || creatorName;

          if (creatorEmail) {
            await createUserNotification({
              destinatarioEmail: creatorEmail,
              destinatarioNome: creatorDisplayName,
              titolo: `⚠️ Attività ToDo scaduta: ${commName}`,
              messaggio: `L'attività [${catLabel}] "${taskTitle}" assegnata a ${task.assegnatoA || 'Collaboratore'} nella commessa ${commName} è scaduta il ${formattedScadenza} e risulta ancora da completare.`,
              tipo: 'todo_scaduto',
              link: commLink
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("Errore controllo attività ToDo scadute:", err);
  }
}
