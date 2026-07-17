import { db } from '../services/firebase';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { wrapMailTemplate } from './mailTemplate';

/**
 * Accoda un'email in Firestore nella collezione 'mail'.
 * Se l'email appartiene a una risorsa non abilitata in anagrafica, l'email viene scartata (senza accumulare code pendenti).
 */
export async function queueMail(toEmail: string, subject: string, htmlBody: string, plainText?: string) {
  try {
    // Verifica se l'email di destinazione è valida
    if (!toEmail || !toEmail.trim()) {
      console.warn("Destinatario e-mail non valido.");
      return;
    }

    const normalizedEmail = toEmail.toLowerCase().trim();
    const bypassedEmails = ['synergiesflow@ingegno06.it'];

    if (!bypassedEmails.includes(normalizedEmail)) {
      // Controlla se il destinatario ha le notifiche e-mail abilitate nel suo profilo dipendente
      const dipendentiRef = collection(db, 'dipendenti');
      const q = query(dipendentiRef, where('email', '==', normalizedEmail));
      const querySnap = await getDocs(q);

      if (querySnap.empty) {
        console.log(`[PAUSA EMAIL PER RISORSA] Destinatario ${toEmail} non censito in anagrafica dipendenti. E-mail scartata.`);
        return;
      }

      const dipData = querySnap.docs[0].data();
      if (dipData.notificheEmail !== true) {
        console.log(`[PAUSA EMAIL PER RISORSA] Notifiche e-mail non abilitate per ${toEmail}. E-mail scartata.`);
        return;
      }
    }

    const payload: any = {
      to: toEmail.toLowerCase().trim(),
      message: {
        subject,
        html: wrapMailTemplate(subject, htmlBody)
      }
    };

    if (plainText) {
      payload.message.text = plainText;
    }

    await addDoc(collection(db, 'mail'), payload);
    console.log(`[EMAIL] Accodata con successo per: ${toEmail}`);
  } catch (err) {
    console.error("Errore durante l'accodamento dell'email:", err);
  }
}
