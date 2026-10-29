// Run from the repo root:  node --test "tests/*.test.js"
// All data here is fictional — goal definitions and scores only.
const test = require('node:test');
const assert = require('node:assert/strict');
const PR = require('../progress-report.js');
const { loadReference } = require('./load-seed.js');

// Weekday dates starting Monday 2026-08-17.
function schoolDays(n, start = '2026-08-17') {
  const out = [];
  for (let d = new Date(start + 'T12:00:00Z'); out.length < n; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const ACC = { id: 'gAcc', name: 'Reading accuracy', type: 'acc', tracking: 'ondemand', target: 90, baseline: 65 };

test('accuracy: totals across sessions, skips absent/excluded days and out-of-range rows', () => {
  const rows = [
    { date: '2026-08-17', g: { gAcc_sessions: [{ v: '8|10|0' }, { v: '9|10|1' }] } },
    { date: '2026-08-18', g: { gAcc_sessions: [{ v: '7|10|0' }] } },
    { date: '2026-08-19', g: { gAcc_sessions: [{ v: '0|10|0' }] }, absent: true },
    { date: '2026-08-20', g: { gAcc_sessions: [{ v: '0|10|0' }] }, excluded: true },
    { date: '2026-10-20', g: { gAcc_sessions: [{ v: '0|10|0' }] } }, // after range
  ];
  const s = PR.summarizeGoal(rows, ACC, 0, { start: '2026-08-12', end: '2026-10-09' });
  assert.equal(s.entries, 3);
  assert.equal(s.days, 2);
  assert.equal(s.sum, 24);
  assert.equal(s.max, 30);
  assert.equal(Math.round(s.value), 80);
});

test('legacy index-keyed scores are read when the goal has no id-keyed value', () => {
  const g = { id: 'gYN', type: 'yn', tracking: 'period' };
  const rows = [{ date: '2026-08-17', g: { '2_0': '1', '2_1': '0', gYN_2: '1' } }];
  const s = PR.summarizeGoal(rows, g, 2, {});
  assert.equal(s.entries, 3); // periods 0,1 from legacy keys, period 2 from the id key
  assert.equal(s.sum, 2);
});

test('count goals average each week\'s per-entry average (a busy week does not dominate)', () => {
  const g = { id: 'gC', type: 'count', tracking: 'period' };
  const rows = [
    // Week 1: 1 entry of 10 → weekly avg 10
    { date: '2026-08-17', g: { gC_0: '10' } },
    // Week 2: 4 entries of 2 → weekly avg 2
    { date: '2026-08-24', g: { gC_0: '2', gC_1: '2', gC_2: '2', gC_3: '2' } },
  ];
  const s = PR.summarizeGoal(rows, g, 0, {});
  assert.equal(s.value, 6);   // (10 + 2) / 2, not 18 / 5
  assert.equal(s.sum, 18);
  assert.deepEqual(s.weeks.map(w => w.week), ['2026-08-17', '2026-08-24']);
});

test('zero is a recorded count; blanks are not', () => {
  const g = { id: 'gC', type: 'count' };
  const s = PR.summarizeGoal([{ date: '2026-08-17', g: { gC_0: '0', gC_1: '' } }], g, 0, {});
  assert.equal(s.entries, 1);
  assert.equal(s.value, 0);
});

test('no data: empty summary, "not addressed" suggestion, neutral narrative', () => {
  const s = PR.summarizeGoal([], ACC, 0, {});
  assert.equal(s.entries, 0);
  assert.equal(s.value, null);
  assert.equal(PR.suggestRating({ goal: ACC, summary: s }).code, 'not_addressed');
  assert.equal(PR.draftGoalNarrative({ firstName: 'Avery', periodLabel: 'Quarter 1', goal: ACC, summary: s }),
    'Progress on this goal was not measured during Quarter 1.');
});

// Steady weekly improvement: 60%, 65%, ... over 8 weeks.
function risingAcc(weeksN = 8, startPct = 60, step = 5) {
  return schoolDays(weeksN * 5).filter((_, i) => i % 5 === 0)
    .map((date, k) => ({ date, g: { gAcc_sessions: [{ v: `${startPct + step * k}|100|0` }] } }));
}

test('suggested rating: met at or beyond target', () => {
  const s = PR.summarizeGoal([{ date: '2026-08-17', g: { gAcc_sessions: [{ v: '19|20|0' }] } }], ACC, 0, {});
  assert.equal(PR.suggestRating({ goal: ACC, summary: s }).code, 'met');
});

test('suggested rating: improving trend projected to reach the target → on track; too slow → not on track', () => {
  const s = PR.summarizeGoal(risingAcc(), ACC, 0, {});
  assert.ok(s.slope > 4.9 && s.slope < 5.1, `slope ${s.slope}`);
  const asOf = '2026-10-09';
  assert.equal(PR.suggestRating({ goal: ACC, summary: s, iepEnd: '2027-05-28', asOf }).code, 'on_track');
  // 1 point/week from ~64% can't reach 90% in the 4 weeks left.
  const slow = PR.summarizeGoal(risingAcc(8, 60, 1), ACC, 0, {});
  assert.equal(PR.suggestRating({ goal: ACC, summary: slow, iepEnd: '2026-11-06', asOf }).code, 'not_on_track');
});

test('suggested rating: flat or worsening trend → not progressing; "decrease" goals flip direction', () => {
  const flat = PR.summarizeGoal(risingAcc(8, 70, 0), ACC, 0, {});
  assert.equal(PR.suggestRating({ goal: ACC, summary: flat }).code, 'not_progressing');
  // A behavior count that should go DOWN, and is going down.
  const g = { id: 'gB', type: 'count', target: 2, direction: 'decrease' };
  const rows = schoolDays(30).filter((_, i) => i % 5 === 0).map((date, k) => ({ date, g: { gB_0: String(12 - 2 * k) } }));
  const s = PR.summarizeGoal(rows, g, 0, {});
  assert.ok(s.slope < 0);
  assert.equal(PR.suggestRating({ goal: g, summary: s }).code, 'on_track');
});

test('no target → no suggestion, with an explanation', () => {
  const s = PR.summarizeGoal(risingAcc(), { ...ACC, target: '' }, 0, {});
  const r = PR.suggestRating({ goal: { ...ACC, target: '' }, summary: s });
  assert.equal(r.code, null);
  assert.match(r.reason, /Set a target/);
});

test('duration targets are entered in minutes and narratives format time in words', () => {
  const g = { id: 'gD', type: 'dur', target: 5 };
  const s = PR.summarizeGoal([{ date: '2026-08-17', g: { gD_0: '0|2|30|0', gD_1: '0|3|30|0' } }], g, 0, {});
  assert.equal(s.value, 180);
  assert.equal(PR.targetValue(g), 300);
  assert.equal(PR.formatValue('dur', s.value), '3 min');
  assert.match(PR.draftGoalNarrative({ firstName: 'Avery', periodLabel: 'Quarter 1', goal: g, summary: s }),
    /averaged 3 min per recorded instance across 2 instances on 1 day\. The goal target is 5 min\./);
});

test('accuracy narrative: data, comparison, target, rating — plain ASCII for pasting', () => {
  const rows = [{ date: '2026-08-17', g: { gAcc_sessions: [{ v: '84|100|0' }] } },
    { date: '2026-08-18', g: { gAcc_sessions: [{ v: '42|50|0' }] } }];
  const s = PR.summarizeGoal(rows, ACC, 0, {});
  const text = PR.draftGoalNarrative({
    firstName: 'Avery', periodLabel: 'Quarter 2', goal: ACC, summary: s,
    comparison: { label: 'Quarter 1', value: 71 }, ratingCode: 'on_track',
  });
  assert.equal(text,
    'During Quarter 2, Avery averaged 84% accuracy (126 of 150 correct) across 2 days of data collection. ' +
    'This is up from 71% in Quarter 1. The goal target is 90%. ' +
    'Avery is making progress and is on track to meet this goal.');
  assert.ok(/^[\x20-\x7E]*$/.test(text), 'narrative is plain ASCII');
  const base = PR.draftGoalNarrative({ firstName: 'Avery', periodLabel: 'Quarter 1', goal: ACC, summary: s,
    comparison: { label: 'baseline', value: 65 } });
  assert.match(base, /This is up from 65% at baseline\./);
});

test('rating labels are plain text (no em dashes) for pasting', () => {
  for (const r of PR.RATINGS) assert.ok(/^[\x20-\x7E]*$/.test(r.label), r.label);
});

test('behavior summary from SPEDsight entries: counts, top antecedents/consequences, likely function', () => {
  const ref = loadReference();
  const entries = Array.from({ length: 30 }, (_, k) => ({
    behaviorId: 'beh-refusal', date: schoolDays(10)[Math.floor(k / 3)],
    activityCode: null, activityOther: '',
    antecedentCodes: ['ant_demand', ...(k < 14 ? ['ant_correction'] : []), ...(k < 4 ? ['ant_alone'] : [])], antecedentOther: '',
    consequenceCodes: ['cons_adult_attention', ...(k < 20 ? ['cons_redirected'] : [])], consequenceOther: '',
  }));
  const out = PR.draftBehaviorSummary({
    firstName: 'Avery', periodLabel: 'Quarter 1', behaviorName: 'Refusal',
    entries, ref, behaviorId: 'beh-refusal', start: '2026-08-12', end: '2026-10-09',
  });
  assert.equal(out.count, 30);
  assert.equal(out.days, 10);
  assert.match(out.text, /^During Quarter 1, staff recorded 30 observations of Refusal on 10 days\./);
  assert.match(out.text, /most often occurred when Avery was given a demand or work \(30 of 30\)/);
  assert.match(out.text, /Avery most often received adult attention \(30\)/);
  assert.match(out.text, /appears to occur (for|to) /);
  assert.equal(PR.draftBehaviorSummary({ firstName: 'Avery', periodLabel: 'Q1', behaviorName: 'Refusal',
    entries, ref, behaviorId: 'beh-refusal', start: '2027-01-01', end: '2027-02-01' }), null);
});
