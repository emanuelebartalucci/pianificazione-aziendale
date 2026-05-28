export function getStartOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

export function addDays(date: Date, days: number): Date {
  const res = new Date(date);
  res.setDate(res.getDate() + days);
  return res;
}

export function getWeekNumber(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

export interface WeekInfo {
  id: string;
  label: string;
  sub: string;
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
          sub: `${currentStart.toLocaleDateString('it-IT', {day:'2-digit', month:'short'})} - ${end.toLocaleDateString('it-IT', {day:'2-digit', month:'short'})}`
      });
      currentStart = addDays(currentStart, 7);
  }
  return weeks;
}
