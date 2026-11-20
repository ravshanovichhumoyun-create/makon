// Safe calculator for the amount keypad: digits and + − × ÷ with normal precedence (no eval).
export const OPS = ['+', '−', '×', '÷'];

export function tokenize(expr) {
  const tokens = [];
  let num = '';
  for (const ch of String(expr)) {
    if (/\d/.test(ch)) num += ch;
    else if (OPS.includes(ch)) {
      if (num) { tokens.push(Number(num)); num = ''; }
      tokens.push(ch);
    }
  }
  if (num) tokens.push(Number(num));
  return tokens;
}

/** Returns an integer result, or null when the expression is incomplete/invalid. */
export function evaluate(expr) {
  const tokens = tokenize(expr);
  while (tokens.length && typeof tokens[tokens.length - 1] !== 'number') tokens.pop();
  if (!tokens.length || typeof tokens[0] !== 'number') return null;
  // first pass: × ÷
  const sum = [tokens[0]];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = tokens[i + 1];
    if (typeof n !== 'number') return null;
    if (op === '×') sum[sum.length - 1] *= n;
    else if (op === '÷') {
      if (n === 0) return null;
      sum[sum.length - 1] /= n;
    } else sum.push(op, n);
  }
  let total = sum[0];
  for (let i = 1; i < sum.length; i += 2) total = sum[i] === '+' ? total + sum[i + 1] : total - sum[i + 1];
  if (!Number.isFinite(total)) return null;
  return Math.round(total);
}

export const hasOperator = (expr) => tokenize(expr).some((tk) => typeof tk !== 'number');

/** Append a key to the expression, keeping it well-formed. */
export function press(expr, key) {
  const s = String(expr || '');
  if (key === 'C') return '';
  if (key === '⌫') return s.slice(0, -1);
  if (OPS.includes(key)) {
    if (!s) return '';
    return OPS.includes(s.slice(-1)) ? s.slice(0, -1) + key : s + key;
  }
  if (key === '=') {
    const v = evaluate(s);
    return v === null || v < 0 ? s : String(v);
  }
  if (!/^\d+$/.test(key)) return s;
  const lastNum = s.split(/[+−×÷]/).pop();
  if (lastNum === '0' && key !== '0') return s.slice(0, -1) + key;
  if (lastNum === '0' || (lastNum === '' && /^0+$/.test(key))) return s;
  if ((lastNum + key).length > 13) return s;
  return s + key;
}

/** "80000+5000" → "80 000 + 5 000" */
export function pretty(expr, sep = ' ') {
  return String(expr || '')
    .replace(/\d+/g, (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, sep))
    .replace(/([+−×÷])/g, ' $1 ');
}
