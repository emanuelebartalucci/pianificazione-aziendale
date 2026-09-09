import { db } from '../services/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { createUserNotification, markOverdueNotificationsAsReadForTask } from './userNotificationService';

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
    const period = currentHour >= 9 ? 'after9' : 'before9';
    const checkKey = `overdue_check_performed_${todayStr}_${period}`;

    // Evita scansioni pesanti del database se il controllo è già stato effettuato per questa fascia oraria
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        if (window.sessionStorage.getItem(checkKey)) {
          return;
        }
        window.sessionStorage.setItem(checkKey, 'true');
      }
    } catch {}

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    // 1. Controlla catalogo_commesse (o commesse)
    let commesseSnap = await getDocs(collection(db, 'catalogo_commesse'));
    if (commesseSnap.empty) {
      commesseSnap = await getDocs(collection(db, 'commesse'));
    }

    if (!commesseSnap.empty) {
      for (const commDoc of commesseSnap.docs) {
        const comm = { id: commDoc.id, ...commDoc.data() } as any;
        if (comm.stato === 'Chiusa') continue;
        const punchList = comm.punchList;
        if (!punchList || !Array.isArray(punchList) || punchList.length === 0) continue;

        for (const task of punchList) {
          const isDone = task.stato === 'completato' || task.stato === 'eseguito' || task.done || task.categoria === 'completato' || task.categoria === 'approvato';
          const isNotOverdue = !task.scadenza || task.scadenza >= todayStr;

          if (isDone || isNotOverdue) {
            // Se l'attività è stata completata o la sua scadenza è stata posticipata ad oggi o oltre,
            // risolvi/segna come lette eventuali notifiche di scadenza ancora attive
            await markOverdueNotificationsAsReadForTask(task.id, task.titolo);
            continue;
          }

          // Verifica condizione di scadenza
          const scadenzaStr = task.scadenza;
          if (scadenzaStr === yesterdayStr && currentHour < 9) {
            continue;
          }

          const formattedScadenza = scadenzaStr.split('-').reverse().join('/');
          const catLabel = (task.categoria || 'da fare').toUpperCase();
          const taskTitle = task.titolo || 'Attività';
          const commName = comm.nome || 'Commessa';
          const taskLink = `/todo?commessaId=${encodeURIComponent(comm.id)}&taskId=${encodeURIComponent(task.id)}`;

          const assignees: string[] = Array.isArray(task.assegnatiA) && task.assegnatiA.length > 0
            ? task.assegnatiA.map((a: any) => String(a).trim()).filter(Boolean)
            : (task.assegnatoA ? String(task.assegnatoA).split(',').map((s: string) => s.trim()).filter(Boolean) : []);

          // 1. Destinatari: Tutte le risorse assegnate
          for (const assignee of assignees) {
            const assigneeDip = dipendentiList.find(d => areNamesEqual(d.nome, assignee));
            if (assigneeDip?.email) {
              await createUserNotification({
                destinatarioEmail: assigneeDip.email,
                destinatarioNome: assigneeDip.nome,
                titolo: `⚠️ Attività ToDo scaduta: ${commName}`,
                messaggio: `L'attività [${catLabel}] "${taskTitle}" nella commessa ${commName} è scaduta il ${formattedScadenza} e risulta ancora da completare.`,
                tipo: 'todo_scaduto',
                link: taskLink,
                taskId: task.id,
                commessaId: comm.id
              });
            }
          }

          // 2. Destinatario: Chi ha creato il compito
          const creatorName = (task.creatoDa && task.creatoDa.trim()) ? task.creatoDa.trim() : null;
          if (creatorName && !assignees.some((a: string) => areNamesEqual(creatorName, a))) {
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
                messaggio: `L'attività [${catLabel}] "${taskTitle}" assegnata a ${assignees.join(', ') || 'Collaboratori'} nella commessa ${commName} è scaduta il ${formattedScadenza} e risulta ancora da completare.`,
                tipo: 'todo_scaduto',
                link: taskLink,
                taskId: task.id,
                commessaId: comm.id
              });
            }
          }
        }
      }
    }

    // 2. Controlla todos_generici
    try {
      const genericSnap = await getDocs(collection(db, 'todos_generici'));
      for (const tDoc of genericSnap.docs) {
        const task = { id: tDoc.id, ...tDoc.data() } as any;
        const isDone = task.stato === 'completato' || task.stato === 'eseguito';
        const isNotOverdue = !task.scadenza || task.scadenza >= todayStr;

        if (isDone || isNotOverdue) {
          await markOverdueNotificationsAsReadForTask(task.id, task.titolo);
          continue;
        }

        const scadenzaStr = task.scadenza;
        if (scadenzaStr === yesterdayStr && currentHour < 9) {
          continue;
        }

        const formattedScadenza = scadenzaStr.split('-').reverse().join('/');
        const catLabel = (task.categoria || 'da fare').toUpperCase();
        const taskTitle = task.titolo || 'Attività Generica';
        const taskLink = `/todo?taskId=${encodeURIComponent(task.id)}`;

        const assignees: string[] = Array.isArray(task.assegnatiA) && task.assegnatiA.length > 0
          ? task.assegnatiA.map((a: any) => String(a).trim()).filter(Boolean)
          : (task.assegnatoA ? String(task.assegnatoA).split(',').map((s: string) => s.trim()).filter(Boolean) : []);

        // Destinatari: Tutte le risorse assegnate
        for (const assignee of assignees) {
          const assigneeDip = dipendentiList.find(d => areNamesEqual(d.nome, assignee));
          if (assigneeDip?.email) {
            await createUserNotification({
              destinatarioEmail: assigneeDip.email,
              destinatarioNome: assigneeDip.nome,
              titolo: `⚠️ Attività Generica scaduta`,
              messaggio: `L'attività generica [${catLabel}] "${taskTitle}" a te assegnata è scaduta il ${formattedScadenza} ed è ancora da completare.`,
              tipo: 'todo_scaduto',
              link: taskLink,
              taskId: task.id
            });
          }
        }

        // Destinatario: Creatore
        const creatorEmail = task.creatoDaEmail || (task.creatoDa?.includes('@') ? task.creatoDa : null);
        const creatorName = task.creatoDa || 'Creatore';
        if (creatorEmail && !assignees.some((a: string) => areNamesEqual(a, creatorName))) {
          await createUserNotification({
            destinatarioEmail: creatorEmail,
            destinatarioNome: creatorName,
            titolo: `⚠️ Attività Generica scaduta`,
            messaggio: `L'attività generica [${catLabel}] "${taskTitle}" assegnata a ${assignees.join(', ') || 'Collaboratori'} è scaduta il ${formattedScadenza} ed è ancora da completare.`,
            tipo: 'todo_scaduto',
            link: taskLink,
            taskId: task.id
          });
        }
      }
    } catch (e) {
      console.error("Errore controllo todos_generici scaduti:", e);
    }

    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(checkKey, 'true');
      }
    } catch {}
  } catch (err) {
    console.error("Errore controllo attività ToDo scadute:", err);
  }
}
