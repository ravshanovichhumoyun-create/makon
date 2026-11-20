// "Today's activity": how much of what was planned for a day got done.
// Counted: day plans, study tasks due that day (or finished that day), active challenges, books finished.
import * as D from './dates.js';
import * as store from './store.js';

/** Challenge helpers shared by the home screen and the challenges page. */
export function challengeEnd(c) {
  return D.addDays(c.start_date, Math.max(1, c.days) - 1);
}

export function challengeStatus(c, today = D.today()) {
  const done = (c.checkins || []).filter((d) => d >= c.start_date && d <= challengeEnd(c)).length;
  if (done >= c.days) return 'done';
  if (c.stopped) return 'stopped';
  if (today < c.start_date) return 'planned';
  if (today > challengeEnd(c)) return 'ended';
  return 'active';
}

export function challengeDone(c) {
  const end = challengeEnd(c);
  return (c.checkins || []).filter((d) => d >= c.start_date && d <= end).length;
}

/** Current streak ending today (or yesterday, if today is not checked yet) and the longest one. */
export function streaks(c, today = D.today()) {
  const set = new Set(c.checkins || []);
  let cur = 0;
  let day = set.has(today) ? today : D.addDays(today, -1);
  while (set.has(day) && day >= c.start_date) { cur += 1; day = D.addDays(day, -1); }
  let best = 0;
  let run = 0;
  const end = challengeEnd(c) < today ? challengeEnd(c) : today;
  for (let d = c.start_date; d <= end; d = D.addDays(d, 1)) {
    run = set.has(d) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return { current: cur, best };
}

/** Activity for one day: { done, total, pct, parts: {plans, tasks, challenges, books} } */
export function dayActivity(day = D.today()) {
  const parts = {
    plans: { done: 0, total: 0 },
    tasks: { done: 0, total: 0 },
    challenges: { done: 0, total: 0 },
    books: { done: 0, total: 0 },
  };
  for (const p of store.all('plans')) {
    if (p.date === day) {
      parts.plans.total += 1;
      if (p.done) parts.plans.done += 1;
    } else if (p.done && p.done_at === day) {
      // an older plan finished today counts as extra work done today
      parts.plans.total += 1;
      parts.plans.done += 1;
    }
  }
  for (const task of store.all('tasks')) {
    const finishedToday = task.done && task.done_at === day;
    const dueToday = task.due_date === day && (!task.done || task.done_at === day || !task.done_at);
    if (finishedToday || dueToday) {
      parts.tasks.total += 1;
      if (task.done && (finishedToday || !task.done_at)) parts.tasks.done += 1;
    }
  }
  for (const c of store.all('challenges')) {
    if (c.stopped || day < c.start_date || day > challengeEnd(c)) continue;
    parts.challenges.total += 1;
    if ((c.checkins || []).includes(day)) parts.challenges.done += 1;
  }
  for (const b of store.all('books')) {
    if (b.finished_at === day) { parts.books.total += 1; parts.books.done += 1; }
  }
  const done = Object.values(parts).reduce((s, p) => s + p.done, 0);
  const total = Object.values(parts).reduce((s, p) => s + p.total, 0);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, parts };
}

/** 0 nothing yet … 5 everything done. */
export function level(a) {
  if (!a.total || !a.done) return 0;
  if (a.done >= a.total) return 5;
  if (a.pct >= 75) return 4;
  if (a.pct >= 50) return 3;
  if (a.pct >= 25) return 2;
  return 1;
}

/** Done counts for the last n days (oldest first). */
export function recentDays(n = 7) {
  const today = D.today();
  return Array.from({ length: n }, (_, i) => {
    const day = D.addDays(today, i - n + 1);
    const a = dayActivity(day);
    return { day, done: a.done, total: a.total, pct: a.pct };
  });
}
