import { db } from '../services/firebase';
import { collection, addDoc, doc, getDoc } from 'firebase/firestore';
import { wrapMailTemplate } from './mailTemplate';

/**
 * Accoda un'email in Firestore nella collezione 'mail'.
 * Se la pausa globale delle e-mail è attiva in 'configurazione_sistema/email', l'email viene scartata.
 */
export async function queueMail(toEmail: string, subject: string, htmlBody: string, plainText?: string) {
  try {
    // Verifica se l'email di destinazione è valida
    if (!toEmail || !toEmail.trim()) {
      console.warn("Destinatario e-mail non valido.");
      return;
    }

    // Controlla lo stato di pausa globale delle notifiche e-mail
    const emailConfigRef = doc(db, 'configurazione_sistema', 'email');
    const emailConfigSnap = await getDoc(emailConfigRef);
    if (emailConfigSnap.exists() && emailConfigSnap.data().paused === true) {
      console.log(`[PAUSA EMAIL] Notifica a ${toEmail} bloccata (l'invio automatico è disattivato nelle impostazioni).`);
      return;
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
