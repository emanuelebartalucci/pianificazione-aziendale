/**
 * browserNotifications.ts
 * Gestore centralizzato per le notifiche del browser:
 * 1. Notifiche Desktop Native di Windows (Notification API)
 * 2. Titolo Scheda Dinamico (document.title)
 * 3. Badge Numerico Rosso sulla Favicon (Canvas)
 * 4. Badge sull'Icona Barra delle Applicazioni (navigator.setAppBadge)
 */

const BASE_TITLE = "Pianificazione Aziendale";
const ORIGINAL_FAVICON_HREF = "/favicon.svg";

// Memorizzazione delle notifiche già inviate per evitare spam o duplicazioni
const sentNotificationTags = new Set<string>();

/**
 * Verifica se le notifiche desktop sono supportate dal browser
 */
export function isDesktopNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Restituisce lo stato attuale dei permessi di notifica
 */
export function getNotificationPermission(): NotificationPermission {
  if (!isDesktopNotificationSupported()) return 'denied';
  return Notification.permission;
}

/**
 * Richiede all'utente l'autorizzazione per le notifiche desktop
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isDesktopNotificationSupported()) return false;
  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (err) {
    console.error("Errore richiesta permessi notifiche:", err);
    return false;
  }
}

/**
 * Invia una notifica nativa desktop di Windows
 */
export function sendDesktopNotification(
  title: string,
  options?: {
    body?: string;
    icon?: string;
    tag?: string;
    onClick?: () => void;
  }
) {
  if (!isDesktopNotificationSupported() || Notification.permission !== 'granted') {
    return;
  }

  // Prevenzione duplicati tramite tag
  if (options?.tag) {
    if (sentNotificationTags.has(options.tag)) {
      return;
    }
    sentNotificationTags.add(options.tag);
  }

  try {
    const notif = new Notification(title, {
      body: options?.body,
      icon: options?.icon || '/favicon.svg',
      tag: options?.tag,
      badge: '/favicon.svg'
    });

    notif.onclick = () => {
      window.focus();
      if (options?.onClick) {
        options.onClick();
      }
      notif.close();
    };
  } catch (err) {
    console.error("Errore invio notifica desktop:", err);
  }
}

export type BadgeType = 'danger' | 'info';

/**
 * Aggiorna il titolo della scheda del browser
 */
export function updateTabTitle(count: number, customLabel?: string, type: BadgeType = 'danger') {
  if (typeof document === 'undefined') return;
  if (count > 0) {
    const icon = type === 'info' ? '🔵' : '🔴';
    const label = customLabel ? customLabel : (type === 'info' ? 'Nuove Notifiche' : 'Richieste da Gestire');
    document.title = `${icon} (${count}) ${label} — ${BASE_TITLE}`;
  } else {
    document.title = BASE_TITLE;
  }
}

/**
 * Disegna dinamicamente un badge a tutto campo in alta definizione (rosso per operative, blu per personali) con conteggio gigante sulla favicon
 */
export function updateFaviconBadge(count: number, type: BadgeType = 'danger') {
  if (typeof document === 'undefined') return;

  const setFaviconHref = (href: string, isSvg: boolean) => {
    // Rimuove tutti i link favicon esistenti per forzare il refresh immediato in Chrome/Edge/Firefox
    const existingLinks = document.querySelectorAll("link[rel*='icon']");
    existingLinks.forEach(el => el.remove());

    const newLink = document.createElement('link');
    newLink.rel = 'icon';
    newLink.type = isSvg ? 'image/svg+xml' : 'image/png';
    newLink.href = href;
    document.head.appendChild(newLink);
  };

  if (count <= 0) {
    setFaviconHref(ORIGINAL_FAVICON_HREF, true);
    return;
  }

  // Canvas 64x64 HD per rendering nitidissimo anche su schermi HiDPI / 4K e schede ridotte
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const badgeColor = type === 'info' ? '#2563eb' : '#dc2626'; // Blu elettrico per personali, Rosso vivo per operative

  ctx.clearRect(0, 0, 64, 64);

  // Badge a tutto campo (Squircle) per massima visibilità nella linguetta del browser
  const r = 16;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(2, 2, 60, 60, r);
  } else {
    ctx.arc(32, 32, 28, 0, 2 * Math.PI);
  }
  ctx.fillStyle = badgeColor;
  ctx.fill();

  // Bordo bianco per risaltare perfettamente su temi browser sia chiari che scuri
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Testo numerico gigante, centrato e ultra-leggibile
  const text = count > 99 ? '99+' : String(count);
  const fontSize = text.length === 1 ? 42 : text.length === 2 ? 34 : 24;
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);

  setFaviconHref(canvas.toDataURL('image/png'), false);
}

/**
 * Aggiorna il badge numerico sull'icona della barra delle applicazioni di Windows (Chromium / PWA)
 */
export function updateTaskbarBadge(count: number) {
  if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
    try {
      if (count > 0) {
        (navigator as any).setAppBadge(count).catch(() => {});
      } else {
        (navigator as any).clearAppBadge().catch(() => {});
      }
    } catch {
      // Ignora se non supportato
    }
  }
}

/**
 * Aggiorna contemporaneamente tutti i badge e indicatori del browser
 */
export function setGlobalBadgeNotification(count: number, label?: string, type: BadgeType = 'danger') {
  updateTabTitle(count, label, type);
  updateFaviconBadge(count, type);
  updateTaskbarBadge(count);
}
