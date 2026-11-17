// Алгоритмічний скоринг та стоп-фільтр акцій.
const DEAL_SIGNAL = /знижк|акці[яюїє]|\d{1,3}\s?%|\b\d\s?\+\s?\d\b|безкоштовн|подарунок|грн|₴|кешбек|комбо|ланч/i;
const BAD = /хуй|хуї|пизд|бляд|бляц|ебан|єбан|ёбан|йоб|залуп|мудак|гондон|шлюх|підор|підар|пидор/i;
const SPAM_OR_BETTING = /казино|casino|букмекер|ставк[иа]|фріспін|freespin|слот[иі]|беттінг|betting|parimatch|favbet|cosmolot|pin-?up|ggbet|vbet|1xbet|крипт[аоу]|бінарн|мікрозайм|кредит\s+онлайн|розіграш\s+айфон|підпишись\s+і\s+виграй/i;
const DELIVERY_ONLY = /(?:безкоштовн\w*|знижк\w*|акці\w*)\s+(?:на\s+)?доставк|тільки\s+на\s+доставк|лише\s+на\s+доставк|доставк[аиу]\s+безкоштовн/i;
const CONTACTS = /(https?:\/\/|www\.|t\.me\/|\.com|\.ua|@\w{3,}|(\+?38)?0\d{9}|\d{3}[\s-]\d{2}[\s-]\d{2})/i;

export const hasProfanity = text => BAD.test(text || '');
export const isBannedPromo = text => SPAM_OR_BETTING.test(text || '') || DELIVERY_ONLY.test(text || '');

export function scoreDeal({ title = '', description = '', conditions = '', ends_on, today }) {
  const reasons = [];
  const t = title.trim();
  const all = `${t} ${description || ''} ${conditions || ''}`.trim();
  let score = 40, hard = false;

  if (BAD.test(all)) { reasons.push('нецензурна лексика'); hard = true; }
  if (SPAM_OR_BETTING.test(all)) { reasons.push('азартні ігри, ставки або спам'); hard = true; }
  if (DELIVERY_ONLY.test(all)) { reasons.push('акція стосується лише доставки'); hard = true; }

  if (t.length < 5) { reasons.push('назва занадто коротка'); score -= 30; }
  else if (t.length > 80) { reasons.push('назва задовга'); score -= 10; }
  else score += 10;
  if ((description || '').trim().length >= 10) score += 5;

  if (DEAL_SIGNAL.test(all)) score += 35;
  else reasons.push('не схоже на акцію: немає знижки, відсотка чи ціни');

  const pct = [...all.matchAll(/(\d{1,3})\s?%/g)].map(m => +m[1]);
  if (pct.some(p => p > 90) && !/безкоштовн/i.test(all)) { reasons.push('підозріло велика знижка'); score -= 30; }
  if (CONTACTS.test(all)) { reasons.push('посилання або контакти в тексті'); score -= 40; }
  if (/(.)\1{4,}/u.test(all)) { reasons.push('повторювані символи'); score -= 30; }
  if (/\S{25,}/.test(all.replace(CONTACTS, ''))) { reasons.push('схоже на випадковий набір літер'); score -= 30; }

  const letters = all.match(/\p{L}/gu) || [];
  const nonSpace = all.replace(/\s/g, '').length || 1;
  if (letters.length / nonSpace < 0.5) { reasons.push('замало літер у тексті'); score -= 25; }
  const upper = (all.match(/\p{Lu}/gu) || []).length;
  if (letters.length >= 8 && upper / letters.length > 0.7) { reasons.push('текст великими літерами'); score -= 15; }

  if (ends_on && today && (Date.parse(ends_on) - Date.parse(today)) / 864e5 > 120) {
    reasons.push('дата завершення задалеко'); score -= 20;
  }
  score = Math.max(0, Math.min(100, score));
  const verdict = hard || score < 30 ? 'reject' : score >= 60 ? 'ok' : 'review';
  return { score, verdict, reasons };
}
