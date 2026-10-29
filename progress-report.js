// SPEDreport — progress-report logic: per-goal summaries of SPEDsheet data,
// trend, suggested progress rating, and copy/paste-ready narratives; plus a
// behavior summary of SPEDsight (ABC) data.
//
// Pure functions only: no DOM, no Supabase, no student data held here.
// Loaded by progress.html as a plain <script> (window.ProgressReport) and by
// the Node tests via require(). Everything returned is plain text — callers
// must escape it before inserting into HTML.
//
// Narratives are deliberately plain ASCII-friendly text (straight quotes,
// hyphens, no em dashes) so they paste cleanly into the district's progress
// report system.
//
// Shapes the caller maps Supabase rows into:
//   row:  { date: 'YYYY-MM-DD', g: <daily_points.goal_scores>, absent, excluded }
//   goal: an element of students.goals — { id, name, type, tracking,
//         target?, baseline?, direction? ('increase' | 'decrease') }
//   gi:   the goal's index in students.goals (legacy score keys use it)
(function (root) {
  'use strict';

  const ABC = typeof module !== 'undefined' && module.exports ? require('./abc-analysis.js') : root.ABC;

  const MAX_PERIODS = 9; // SPEDsheet's PER list — scan every possible period

  // ── Score access (mirrors gRead in index.html) ───────────────────────
  // Scores are keyed "<goalId>_<period|sessions>"; rows written before goal
  // ids existed used the goal's array index instead.
  function gRead(bag, g, gi, suffix) {
    if (!bag) return undefined;
    if (g && g.id) { const v = bag[g.id + '_' + suffix]; if (v !== undefined) return v; }
    return bag[gi + '_' + suffix];
  }

  function parseDur(v) {
    const p = String(v || '').split('|').map(x => parseInt(x, 10) || 0);
    return { h: p[0] || 0, m: p[1] || 0, s: p[2] || 0 };
  }
  const durToSec = v => { const { h, m, s } = parseDur(v); return h * 3600 + m * 60 + s; };

  // "2 min 30 sec" / "1 hr 5 min" / "45 sec"
  function fmtDuration(sec) {
    sec = Math.round(sec || 0);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return m ? `${h} hr ${m} min` : `${h} hr`;
    if (m) return s ? `${m} min ${s} sec` : `${m} min`;
    return `${s} sec`;
  }

  // One day's values for a goal — by-period cells and on-demand sessions
  // both count (a goal's tracking mode can change mid-year). Same per-type
  // rules as the Yearly Summary.
  function dayTotals(bag, g, gi) {
    const t = { sum: 0, max: 0, cnt: 0 };
    const add = v => {
      if (v === undefined || v === null || v === '') return;
      if (g.type === 'acc') {
        const p = String(v).split('|'); const c = parseInt(p[0], 10) || 0, n = parseInt(p[1], 10) || 0;
        if (n > 0) { t.sum += c; t.max += n; t.cnt++; }
      } else if (g.type === 'dur') {
        const sec = durToSec(v); if (sec > 0) { t.sum += sec; t.cnt++; }
      } else if (g.type === 'count') {
        const n = parseInt(v, 10) || 0; if (n > 0 || String(v) === '0') { t.sum += n; t.cnt++; }
      } else if (g.type === '1to4') {
        const n = parseInt(v, 10) || 0; if (n >= 1 && n <= 5) { t.sum += n; t.max += 5; t.cnt++; }
      } else { // yn, on
        t.sum += parseInt(v, 10) || 0; t.max++; t.cnt++;
      }
    };
    for (let pi = 0; pi < MAX_PERIODS; pi++) add(gRead(bag, g, gi, pi));
    const ses = gRead(bag, g, gi, 'sessions');
    if (Array.isArray(ses)) ses.forEach(s => add(s && s.v));
    return t;
  }

  // The goal's headline number for a set of totals, in display units:
  // percent (acc, yn, on), average rating (1to4), average per entry
  // (count), average seconds per entry (dur).
  function metric(type, t) {
    if (!t.cnt) return null;
    if (type === 'acc' || type === 'yn' || type === 'on') return t.max > 0 ? (t.sum / t.max) * 100 : null;
    return t.sum / t.cnt;
  }

  function mondayOf(date) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  const weeksBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / (7 * 864e5));

  // Least-squares slope (units per week) through the weekly values; null
  // with fewer than 3 weeks of data — too few to call a trend.
  function weeklySlope(weeks) {
    const pts = weeks.filter(w => w.value !== null);
    if (pts.length < 3) return null;
    const xs = pts.map(w => weeksBetween(pts[0].week, w.week)), ys = pts.map(w => w.value);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    return den ? num / den : null;
  }

  // Everything the report needs about one goal over one date range.
  // Absent and excluded days are skipped, like the Yearly Summary.
  function summarizeGoal(rows, g, gi, { start, end } = {}) {
    const total = { sum: 0, max: 0, cnt: 0 };
    const weekMap = new Map();
    let days = 0, first = null, last = null;
    for (const r of rows) {
      if (r.absent || r.excluded) continue;
      if ((start && r.date < start) || (end && r.date > end)) continue;
      const t = dayTotals(r.g, g, gi);
      if (!t.cnt) continue;
      days++;
      if (!first || r.date < first) first = r.date;
      if (!last || r.date > last) last = r.date;
      total.sum += t.sum; total.max += t.max; total.cnt += t.cnt;
      const wk = mondayOf(r.date);
      const w = weekMap.get(wk) || { sum: 0, max: 0, cnt: 0 };
      w.sum += t.sum; w.max += t.max; w.cnt += t.cnt;
      weekMap.set(wk, w);
    }
    const weeks = [...weekMap.keys()].sort().map(wk => ({ week: wk, value: metric(g.type, weekMap.get(wk)) }));
    // Counts: average each week's own per-entry average, then average those
    // (a busy week doesn't outweigh a quiet one) — same as the Yearly tab.
    let value = metric(g.type, total);
    if (g.type === 'count' && weeks.length) value = weeks.reduce((a, w) => a + w.value, 0) / weeks.length;
    return {
      type: g.type, entries: total.cnt, days, sum: total.sum, max: total.max,
      value, weeks, slope: weeklySlope(weeks), firstDate: first, lastDate: last,
    };
  }

  // ── Targets and formatting ───────────────────────────────────────────
  // Targets are entered in display units; duration targets are minutes.
  function targetValue(g) {
    if (g.target === undefined || g.target === null || g.target === '') return null;
    const n = Number(g.target);
    if (!Number.isFinite(n)) return null;
    return g.type === 'dur' ? n * 60 : n;
  }
  function baselineValue(g) {
    if (g.baseline === undefined || g.baseline === null || g.baseline === '') return null;
    const n = Number(g.baseline);
    if (!Number.isFinite(n)) return null;
    return g.type === 'dur' ? n * 60 : n;
  }
  const dirSign = g => (g.direction === 'decrease' ? -1 : 1);

  const trim1 = n => (Math.round(n * 10) / 10).toString();
  function formatValue(type, v) {
    if (v === null || v === undefined) return '-';
    if (type === 'acc' || type === 'yn' || type === 'on') return `${Math.round(v)}%`;
    if (type === 'dur') return fmtDuration(v);
    return trim1(v);
  }

  // ── Suggested rating ─────────────────────────────────────────────────
  const RATINGS = [
    { code: 'met', label: 'Goal met' },
    { code: 'on_track', label: 'Progressing - on track to meet goal' },
    { code: 'not_on_track', label: 'Progressing - may not meet goal' },
    { code: 'not_progressing', label: 'Not progressing' },
    { code: 'not_addressed', label: 'Not addressed this period' },
  ];

  // Returns { code, reason } — code is null when no suggestion can be made
  // (no target set). reason explains the suggestion in plain words so the
  // teacher can judge it. prev is the comparison value (previous period or
  // baseline), iepEnd the IEP end date, asOf the period's end date.
  function suggestRating({ goal, summary, prev = null, iepEnd = null, asOf = null }) {
    if (!summary.entries) return { code: 'not_addressed', reason: 'No data recorded this period.' };
    const target = targetValue(goal);
    if (target === null) return { code: null, reason: 'Set a target for this goal to get a suggested rating.' };
    const sign = dirSign(goal), v = summary.value, fmt = x => formatValue(goal.type, x);
    if (sign * (v - target) >= 0) return { code: 'met', reason: `${fmt(v)} meets the target of ${fmt(target)}.` };

    // Improving? Use the weekly trend when there's enough of it, otherwise
    // the change from the comparison value.
    const tol = Math.max(Math.abs(target) * 0.005, 1e-9);
    let improving = null, rate = null;
    if (summary.slope !== null) { rate = summary.slope; improving = sign * rate > tol; }
    else if (prev !== null) improving = sign * (v - prev) > 0;
    if (improving === null) return { code: 'on_track', reason: `${fmt(v)} vs target ${fmt(target)}; not enough data yet to judge the trend.` };
    if (!improving) {
      return { code: 'not_progressing', reason: rate !== null
        ? `${fmt(v)} vs target ${fmt(target)}; weekly trend is flat or moving away from the target.`
        : `${fmt(v)} vs target ${fmt(target)}; no improvement over ${fmt(prev)}.` };
    }
    if (rate === null || !iepEnd || !asOf) {
      return { code: 'on_track', reason: `${fmt(v)} vs target ${fmt(target)}; improving.` };
    }
    // Compare the weeks needed at the current rate with the weeks left —
    // rather than quoting a straight-line projection, which overshoots
    // into impossible values (e.g. 181%) over a long IEP.
    const weeksLeft = Math.max(0, weeksBetween(asOf, iepEnd));
    const perWeek = Math.abs(rate);
    const weeksNeeded = Math.ceil(Math.abs(target - v) / perWeek);
    const rateTxt = goal.type === 'dur' ? fmtDuration(perWeek)
      : (goal.type === 'acc' || goal.type === 'yn' || goal.type === 'on') ? `${trim1(perWeek)} percentage points`
      : trim1(perWeek);
    const onTrack = weeksNeeded <= weeksLeft;
    return {
      code: onTrack ? 'on_track' : 'not_on_track',
      reason: `${fmt(v)} vs target ${fmt(target)}; improving about ${rateTxt} per week, so the target would be reached in about ${weeksNeeded} week${weeksNeeded !== 1 ? 's' : ''} (${weeksLeft} week${weeksLeft !== 1 ? 's' : ''} until the IEP end date).`,
    };
  }

  // ── Narratives (plain text, copy/paste-ready) ────────────────────────
  function dataSentence(firstName, periodLabel, g, s) {
    const v = formatValue(g.type, s.value), days = `${s.days} day${s.days !== 1 ? 's' : ''}`;
    switch (g.type) {
      case 'acc': return `During ${periodLabel}, ${firstName} averaged ${v} accuracy (${s.sum} of ${s.max} correct) across ${days} of data collection.`;
      case 'yn': return `During ${periodLabel}, ${firstName} was successful in ${v} of recorded opportunities (${s.sum} of ${s.max}) across ${days} of data collection.`;
      case 'on': return `During ${periodLabel}, ${firstName} was observed demonstrating the skill in ${v} of recorded opportunities (${s.sum} of ${s.max}) across ${days} of data collection.`;
      case '1to4': return `During ${periodLabel}, ${firstName} received an average rating of ${v} on a 1-5 scale across ${s.entries} ratings on ${days}.`;
      case 'count': return `During ${periodLabel}, ${firstName} averaged ${v} per recorded period or session (${s.sum} total) across ${days} of data collection.`;
      case 'dur': return `During ${periodLabel}, ${firstName} averaged ${v} per recorded instance across ${s.entries} instance${s.entries !== 1 ? 's' : ''} on ${days}.`;
      default: return `During ${periodLabel}, data were collected on ${days}.`;
    }
  }

  const RATING_SENTENCE = {
    met: n => `${n} has met this goal.`,
    on_track: n => `${n} is making progress and is on track to meet this goal.`,
    not_on_track: n => `${n} is making progress but may not meet this goal by the end of the IEP.`,
    not_progressing: n => `${n} is not currently making progress toward this goal.`,
  };

  // comparison: { label: 'the previous quarter' | 'baseline', value } or null
  function draftGoalNarrative({ firstName = 'The student', periodLabel, goal, summary, comparison = null, ratingCode = null }) {
    if (!summary.entries) {
      return `Progress on this goal was not measured during ${periodLabel}.`;
    }
    const parts = [dataSentence(firstName, periodLabel, goal, summary)];
    if (comparison && comparison.value !== null && comparison.value !== undefined) {
      const fmt = x => formatValue(goal.type, x);
      const a = fmt(summary.value), b = fmt(comparison.value);
      const verb = a === b ? 'unchanged from' : summary.value > comparison.value ? 'up from' : 'down from';
      parts.push(`This is ${verb} ${b} ${comparison.label === 'baseline' ? 'at baseline' : 'in ' + comparison.label}.`);
    }
    const target = targetValue(goal);
    if (target !== null) parts.push(`The goal target is ${formatValue(goal.type, target)}.`);
    if (ratingCode && RATING_SENTENCE[ratingCode]) parts.push(RATING_SENTENCE[ratingCode](firstName));
    return parts.join(' ');
  }

  // ── SPEDsight behavior summary ───────────────────────────────────────
  // entries/ref: the shapes abc-analysis.js expects. Returns null when the
  // behavior wasn't observed in range.
  function draftBehaviorSummary({ firstName = 'The student', periodLabel, behaviorName, entries, ref, start, end, behaviorId }) {
    const a = ABC.analyzeBehavior(entries, ref, { behaviorId, start, end });
    if (!a.entryCount) return null;
    const scoped = ABC.filterEntries(entries, { behaviorId, start, end });
    const days = new Set(scoped.map(e => e.date)).size;
    const who = s => s.replace(/^s\/he\b/, firstName);
    const top = rows => rows.filter(r => r.count > 0 && !r.hasText)
      .map((r, i) => ({ r, i })).sort((x, y) => y.r.count - x.r.count || x.i - y.i)
      .slice(0, 3).map(x => x.r);
    const parts = [`During ${periodLabel}, staff recorded ${a.entryCount} observation${a.entryCount !== 1 ? 's' : ''} of ${behaviorName} on ${days} day${days !== 1 ? 's' : ''}.`];
    const ants = top(a.tallies.antecedent);
    if (ants.length) parts.push(`${behaviorName} most often occurred ${ABC.joinList(ants.map(r => `when ${who(r.narrative || r.label.toLowerCase())} (${r.count} of ${a.entryCount})`))}.`);
    const cons = top(a.tallies.consequence);
    if (cons.length) parts.push(`Following the behavior, ${firstName} most often ${ABC.joinList(cons.map(r => `${r.narrative || r.label.toLowerCase()} (${r.count})`))}.`);
    const fns = ABC.rankFunctions(a.functions).slice(0, 2);
    if (fns.length) parts.push(`Based on these observations, ${behaviorName} appears to occur ${ABC.joinList(fns.map(f => `${f.fbaPhrase} (${f.percent}%)`))}.`);
    return { text: parts.join(' '), count: a.entryCount, days };
  }

  const api = {
    gRead, dayTotals, summarizeGoal, weeklySlope, mondayOf,
    targetValue, baselineValue, formatValue, fmtDuration,
    RATINGS, suggestRating, draftGoalNarrative, draftBehaviorSummary,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProgressReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
