export interface PendingUserNotifications {
  email: string;
  variazioni: Record<string, string[]>; // e.g. { "Sett. 25": ["Aggiunto a Commessa A (100%)"] }
}

const STORAGE_KEY = 'pending_planning_notifications';

export function getPendingNotifications(): Record<string, PendingUserNotifications> {
  return {};
}

export function savePendingNotifications(_notifications: Record<string, PendingUserNotifications>) {
  // Disattivato
}

export function addPendingNotification(
  _dipendenteNome: string, 
  _email: string, 
  _weekLabel: string, 
  _description: string,
  _currentUserEmail?: string,
  _currentUserName?: string
) {
  // Notifiche email per assegnazioni ordinarie di calendario eliminate
}

export function clearPendingNotifications() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function sendAllPendingNotifications() {
  clearPendingNotifications();
}
