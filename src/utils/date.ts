export function getStartOfWeek(d: Date): Date {
  const date = new Date(d);
  if (isNaN(date.getTime())) {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(today.setDate(diff));
  }
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

export function addDays(date: Date, days: number): Date {
  const res = new Date(date);
  if (isNaN(res.getTime())) return new Date();
  res.setDate(res.getDate() + days);
  return res;
}

export function getWeekNumber(d: Date): number {
  const input = new Date(d);
  const date = isNaN(input.getTime()) ? new Date() : new Date(input.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

export interface WeekInfo {
  id: string;
  label: string;
  sub: string;
  dateObj?: Date;
}

export function generateWeeks(baseDate: Date): WeekInfo[] {
  const weeks: WeekInfo[] = [];
  let currentStart = getStartOfWeek(baseDate);
  for(let i=0; i<5; i++) {
      const end = addDays(currentStart, 6);
      const wkNum = getWeekNumber(currentStart);
      weeks.push({
          id: `${currentStart.getFullYear()}-W${wkNum}`,
          label: `Sett. ${wkNum}`,
          sub: `${currentStart.toLocaleDateString('it-IT', {day:'2-digit', month:'short'})} - ${end.toLocaleDateString('it-IT', {day:'2-digit', month:'short'})}`,
          dateObj: new Date(currentStart)
      });
      currentStart = addDays(currentStart, 7);
  }
  return weeks;
}

export function isItalianHoliday(dateStr: string): boolean {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return false;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  // Festività fisse
  if (month === 1 && day === 1) return true; // Capodanno
  if (month === 1 && day === 6) return true; // Epifania
  if (month === 4 && day === 25) return true; // Liberazione
  if (month === 5 && day === 1) return true; // Festa del Lavoro
  if (month === 6 && day === 2) return true; // Festa della Repubblica
  if (month === 8 && day === 15) return true; // Ferragosto
  if (month === 11 && day === 1) return true; // Tutti i Santi
  if (month === 12 && day === 8) return true; // Immacolata
  if (month === 12 && day === 25) return true; // Natale
  if (month === 12 && day === 26) return true; // Santo Stefano

  // Pasquetta (Meeus/Jones/Butcher algorithm)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;

  const easterDate = new Date(year, easterMonth - 1, easterDay);
  const easterMonday = new Date(easterDate);
  easterMonday.setDate(easterDate.getDate() + 1);

  if (month === (easterMonday.getMonth() + 1) && day === easterMonday.getDate()) {
    return true;
  }

  return false;
}

export function isWeekend(date: Date | string): boolean {
  if (typeof date === 'string') {
    const parts = date.split('-');
    if (parts.length === 3) {
      const y = Number(parts[0]);
      const m = Number(parts[1]) - 1;
      const dy = Number(parts[2]);
      const dObj = new Date(y, m, dy);
      const day = dObj.getDay();
      return day === 0 || day === 6;
    }
  }
  const d = new Date(date);
  const day = d.getDay();
  return day === 0 || day === 6;
}

