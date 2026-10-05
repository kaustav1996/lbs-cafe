import { SITE, DAY_NAMES, type DayHours } from '../data/site';

export const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** "22:00" -> "10 pm", "10:30" -> "10:30 am" */
export function clock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Current time in Kolkata, whatever the visitor's own timezone. */
function kolkataNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export interface OpenState {
  open: boolean;
  label: string;
  today: number;
}

export function openState(hours: DayHours[] = SITE.hours, now = new Date()): OpenState {
  const { day, minutes } = kolkataNow(now);
  const t = hours[day];
  if (minutes >= mins(t.open) && minutes < mins(t.close)) {
    return { open: true, today: day, label: `Open now until ${clock(t.close)}` };
  }
  if (minutes < mins(t.open)) {
    return { open: false, today: day, label: `Closed now. Opens today at ${clock(t.open)}` };
  }
  const next = hours[(day + 1) % 7];
  return { open: false, today: day, label: `Closed now. Opens tomorrow at ${clock(next.open)}` };
}

/** Groups consecutive days with identical hours: "Monday to Thursday". */
export function hourRows(hours: DayHours[] = SITE.hours) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows: { days: number[]; open: string; close: string }[] = [];
  for (const d of order) {
    const h = hours[d];
    const last = rows[rows.length - 1];
    if (last && last.open === h.open && last.close === h.close) last.days.push(d);
    else rows.push({ days: [d], open: h.open, close: h.close });
  }
  return rows.map(r => ({
    ...r,
    label:
      r.days.length === 1
        ? DAY_NAMES[r.days[0]]
        : `${DAY_NAMES[r.days[0]]} to ${DAY_NAMES[r.days[r.days.length - 1]]}`,
    time: `${clock(r.open)} to ${clock(r.close)}`,
  }));
}
