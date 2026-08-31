import { db } from '../services/firebase';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { wrapMailTemplate } from './mailTemplate';

/**
 * Accoda un'email in Firestore nella collezione 'mail'.
 * Se l'email appartiene a una risorsa non abilitata in anagrafica, l'email viene scartata (senza accumulare code pendenti).
 */
export async function queueMail(
  toEmail: string, 
  subject: string, 
  htmlBody: string, 
  plainText?: string,
  _options?: { isSystemNotification?: boolean }
) {
  try {
    // Verifica se l'email di destinazione è valida
    if (!toEmail || !toEmail.trim()) {
      console.warn("Destinatario e-mail non valido.");
      return;
    }

    const normalizedEmail = toEmail.toLowerCase().trim();

    // Controlla se l'indirizzo appartiene a una risorsa censita in anagrafica dipendenti
    const dipendentiRef = collection(db, 'dipendenti');
    const q = query(dipendentiRef, where('email', '==', normalizedEmail));
    const querySnap = await getDocs(q);

    if (!querySnap.empty) {
      const dipData = querySnap.docs[0].data();
      const todayStr = new Date().toISOString().split('T')[0];
      
      // Se il dipendente è cessato, blocca sempre le e-mail
      if (dipData.dataCessazione && dipData.dataCessazione <= todayStr) {
        console.log(`[DIPENDENTE CESSATO] Risorsa ${toEmail} cessata in data ${dipData.dataCessazione}. E-mail bloccata e scartata.`);
        return;
      }

      // Se non è una notifica di sistema obbligatoria e l'interruttore della risorsa è disabilitato, blocca la mail personale
      const isSystemNotification = _options?.isSystemNotification === true;
      if (!isSystemNotification && dipData.notificheEmail !== true) {
        console.log(`[NOTIFICHE EMAIL DISABILITATE] Interruttore disabilitato per la risorsa ${toEmail}. E-mail bloccata e scartata.`);
        return;
      }
    }
    // Se l'indirizzo non appartiene a un dipendente censito (es. synergieflow o mail esterna), viene inviata regolarmente

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
