// Development & production release - v1.0.14
export const APP_VERSION = "v1.0.14";
export const APP_RELEASE_DATE = "27/08/2026";

export const getPrintDateString = () => {
  try {
    const formatter = new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return formatter.format(new Date()).replace(',', '');
  } catch (_e) {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }
};

export const getPrintFooterHtml = () => `
  <div style="position: fixed; bottom: 0.1cm; right: 0.2cm; left: 0.2cm; display: flex; justify-content: space-between; align-items: center; font-size: 7.5pt; color: #6b7280; font-family: system-ui, -apple-system, sans-serif; pointer-events: none; z-index: 99999;">
    <span>Piattaforma Pianificazione Aziendale</span>
    <span>${APP_VERSION} — Data Stampa: ${getPrintDateString()}</span>
  </div>
`;
