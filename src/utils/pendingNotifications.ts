import { queueMail } from './mailSender';

export interface PendingUserNotifications {
  email: string;
  variazioni: Record<string, string[]>; // e.g. { "Sett. 25": ["Aggiunto a Commessa A (100%)"] }
}

const STORAGE_KEY = 'pending_planning_notifications';

export function getPendingNotifications(): Record<string, PendingUserNotifications> {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error("Errore parse pending notifications:", e);
    return {};
  }
}

export function savePendingNotifications(notifications: Record<string, PendingUserNotifications>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
}

export function addPendingNotification(
  dipendenteNome: string, 
  email: string, 
  weekLabel: string, 
  description: string,
  currentUserEmail?: string,
  currentUserName?: string
) {
  if (!email || !email.trim()) return;

  const targetEmail = email.toLowerCase().trim();
  const activeUserEmail = currentUserEmail?.toLowerCase().trim();

  // Blocco auto-notifica se l'utente che sta salvando modifica la propria pianificazione
  if (activeUserEmail && targetEmail === activeUserEmail) {
    console.log(`[PAUSA NOTIFICA AUTO-ASSEGNAZIONE] Ignorata notifica per se stessi (${email})`);
    return;
  }
  if (currentUserName && dipendenteNome.toLowerCase().trim() === currentUserName.toLowerCase().trim()) {
    console.log(`[PAUSA NOTIFICA AUTO-ASSEGNAZIONE] Ignorata notifica per se stessi (${dipendenteNome})`);
    return;
  }
  
  const current = getPendingNotifications();
  if (!current[dipendenteNome]) {
    current[dipendenteNome] = {
      email: targetEmail,
      variazioni: {}
    };
  }
  
  if (!current[dipendenteNome].variazioni[weekLabel]) {
    current[dipendenteNome].variazioni[weekLabel] = [];
  }
  
  // Evita duplicati identici nella stessa settimana
  if (!current[dipendenteNome].variazioni[weekLabel].includes(description)) {
    current[dipendenteNome].variazioni[weekLabel].push(description);
    savePendingNotifications(current);
  }
}

export function clearPendingNotifications() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function sendAllPendingNotifications() {
  const notifications = getPendingNotifications();
  const names = Object.keys(notifications);
  if (names.length === 0) return;

  for (const name of names) {
    const data = notifications[name];
    if (!data.email) continue;

    // Costruiamo il corpo HTML ed il testo semplice
    let htmlContent = `<p>Ciao <strong>${name}</strong>,</p>`;
    htmlContent += `<p>Ti comunichiamo che sono state apportate delle modifiche alla tua pianificazione delle commesse:</p>`;
    
    let plainContent = `Ciao ${name},\n\nTi comunichiamo che sono state apportate delle modifiche alla tua pianificazione delle commesse:\n\n`;

    const weeks = Object.keys(data.variazioni);
    // Ordiniamo le settimane in modo alfabetico/temporale
    weeks.sort().forEach(wk => {
      htmlContent += `
        <div style="margin-top: 15px; padding: 12px 16px; background-color: #f9fafb; border-left: 4px solid #4f46e5; border-radius: 8px; border: 1px solid #e5e7eb; border-left: 4px solid #4f46e5;">
          <strong style="color: #111827; font-size: 14px;">${wk}</strong>
          <ul style="margin: 8px 0 0 20px; padding: 0; color: #374151; font-size: 13px; line-height: 1.5;">
      `;

      plainContent += `* ${wk}:\n`;

      data.variazioni[wk].forEach(desc => {
        htmlContent += `<li style="margin-bottom: 4px;">${desc}</li>`;
        plainContent += `  - ${desc}\n`;
      });

      htmlContent += `
          </ul>
        </div>
      `;
      plainContent += `\n`;
    });

    htmlContent += `<p style="margin-top: 20px;">Accedi alla piattaforma per visualizzare la tua pianificazione completa.</p>`;
    plainContent += `Accedi alla piattaforma per visualizzare la tua pianificazione completa.`;

    const subject = `[Pianificazione] Aggiornamento Calendario Commesse`;
    
    // Inviamo la mail
    await queueMail(data.email, subject, htmlContent, plainContent);
  }

  clearPendingNotifications();
}
