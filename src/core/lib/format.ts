import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { brand } from '@core/config';

const toDate = (d: string | Date | null | undefined) => {
  if (!d) return null;
  const x = typeof d === 'string' ? (d.length === 10 ? parseISO(d + 'T12:00:00') : parseISO(d)) : d;
  return isValid(x) ? x : null;
};

export const fmtDate = (d: string | Date | null | undefined) => { const x = toDate(d); return x ? format(x, 'dd/MM/yyyy') : '—'; };
export const fmtDateTime = (d: string | Date | null | undefined) => { const x = toDate(d); return x ? format(x, 'dd/MM/yyyy HH:mm') : '—'; };
export const fmtTime = (d: string | Date | null | undefined) => { const x = toDate(d); return x ? format(x, 'HH:mm') : '—'; };
export const fmtLongDate = (d: string | Date) => format(toDate(d)!, "EEEE d 'de' MMMM", { locale: es });
export const fmtAgo = (d: string | Date | null | undefined) => {
  const x = toDate(d); return x ? 'hace ' + formatDistanceToNowStrict(x, { locale: es }) : '—';
};

const money = new Intl.NumberFormat(brand.locale, { style: 'currency', currency: brand.currency });
const num = new Intl.NumberFormat(brand.locale, { maximumFractionDigits: 2 });
export const fmtMoney = (n: number | string | null | undefined) => (n == null || n === '' ? '—' : money.format(Number(n)));
export const fmtNum = (n: number | string | null | undefined) => (n == null || n === '' ? '—' : num.format(Number(n)));
export const fmtHours = (n: number | string | null | undefined) => (n == null ? '—' : `${num.format(Number(n))} h`);

/** Valor para <input type="datetime-local"> en hora local */
export const toLocalInput = (d: Date = new Date()) => format(d, "yyyy-MM-dd'T'HH:mm");
export const today = () => format(new Date(), 'yyyy-MM-dd');
