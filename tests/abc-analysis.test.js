// Run from the repo root:  node --test "tests/*.test.js"
// (Node 22+ won't search a bare directory argument; the quoted glob is
// expanded by Node itself, so it works the same in any shell.)
// All data here is fictional — behavior ids and counts only, no students.
const test = require('node:test');
const assert = require('node:assert/strict');
const ABC = require('../abc-analysis.js');
const { loadReference } = require('./load-seed.js');

const ref = loadReference();

// n blank entries for one behavior/date, then each code is marked on the
// first `count` entries — so a code's tally equals its count exactly.
function buildEntries({ behaviorId, date = '2026-03-02', n, antecedents = {}, consequences = {}, activity = null }) {
  const entries = Array.from({ length: n }, () => ({
    behaviorId, date, activityCode: activity, activityOther: '',
    antecedentCodes: [], antecedentOther: '', consequenceCodes: [], consequenceOther: '',
  }));
  const mark = (codes, field) => {
    for (const [code, count] of Object.entries(codes)) {
      assert.ok(count <= n, `${code} count ${count} exceeds ${n} entries`);
      for (let k = 0; k < count; k++) entries[k][field].push(code);
    }
  };
  mark(antecedents, 'antecedentCodes');
  mark(consequences, 'consequenceCodes');
  return entries;
}

// The paper form's worked example (behavior: Refusal).
const REFUSAL = 'beh-refusal';
const refusalEntries = () => buildEntries({
  behaviorId: REFUSAL, n: 30,
  antecedents: {
    ant_removal_attention: 0, ant_demand: 30, ant_correction: 14, ant_peer_provoked: 2,
    ant_environment: 0, ant_item_denied: 0, ant_transition: 0, ant_alone: 4,
  },
  consequences: {
    cons_adult_attention: 30, cons_peer_attention: 0, cons_terminated_demand: 4, cons_ignored: 5,
    cons_redirected: 20, cons_demand_followed: 0, cons_preferred_item: 3, cons_staff_walked_away: 1,
  },
});

const fn = (result, code) => result.functions.find(f => f.code === code);
const count = (rows, code) => rows.find(r => r.code === code)?.count;

test('seed: every mapped code is a real antecedent or consequence, 5/6/6/3 per function', () => {
  const categories = new Map(ref.options.map(o => [o.code, o.category]));
  assert.equal(categories.size, ref.options.length, 'option codes are unique');
  for (const m of ref.mapping) {
    assert.ok(['antecedent', 'consequence'].includes(categories.get(m.optionCode)), m.optionCode);
  }
  const perFunction = code => ref.mapping.filter(m => m.functionCode === code).length;
  assert.deepEqual(
    ['sensory', 'escape', 'attention', 'tangible'].map(perFunction),
    [5, 6, 6, 3],
  );
});

test('Refusal fixture: function scores are 12 / 51 / 54 / 23 out of 140', () => {
  const r = ABC.analyzeBehavior(refusalEntries(), ref, { behaviorId: REFUSAL });
  assert.equal(r.entryCount, 30);
  assert.equal(fn(r, 'sensory').score, 12);
  assert.equal(fn(r, 'escape').score, 51);
  assert.equal(fn(r, 'attention').score, 54);
  assert.equal(fn(r, 'tangible').score, 23);
  assert.equal(r.total, 140);
});

test('Refusal fixture: percentages truncate to 8 / 36 / 38 / 16', () => {
  const r = ABC.analyzeBehavior(refusalEntries(), ref, { behaviorId: REFUSAL });
  assert.deepEqual(r.functions.map(f => [f.code, f.percent]), [
    ['sensory', 8], ['escape', 36], ['attention', 38], ['tangible', 16],
  ]);
});

test('Refusal fixture: raw numbers are shown beside each percentage', () => {
  const r = ABC.analyzeBehavior(refusalEntries(), ref, { behaviorId: REFUSAL });
  assert.equal(ABC.formatScoreLine(fn(r, 'escape'), r.total), '51 / 140 = 36%');
  assert.equal(ABC.formatScoreLine(fn(r, 'sensory'), r.total), '12 / 140 = 8%');
});

test('Refusal fixture: a function grid lists each mapped item with its count', () => {
  const r = ABC.analyzeBehavior(refusalEntries(), ref, { behaviorId: REFUSAL });
  assert.deepEqual(
    fn(r, 'sensory').components.map(c => [c.code, c.count]),
    [['ant_peer_provoked', 2], ['ant_environment', 0], ['ant_alone', 4],
     ['cons_ignored', 5], ['cons_staff_walked_away', 1]],
  );
});

test('Refusal fixture: tallies list every option, including ones never observed', () => {
  const r = ABC.analyzeBehavior(refusalEntries(), ref, { behaviorId: REFUSAL });
  assert.equal(count(r.tallies.antecedent, 'ant_demand'), 30);
  assert.equal(count(r.tallies.antecedent, 'ant_environment'), 0);
  assert.equal(count(r.tallies.consequence, 'cons_adult_attention'), 30);
  assert.equal(r.tallies.antecedent.length, 9);
  assert.equal(r.tallies.consequence.length, 9);
  assert.equal(r.tallies.activity.length, 8);
});

test('Refusal fixture: draft function statement matches the paper form', () => {
  const r = ABC.analyzeBehavior(refusalEntries(), ref, { behaviorId: REFUSAL });
  assert.equal(
    ABC.draftFunctionStatement({ behaviorName: 'refusal', functions: r.functions }),
    'CHILD engages in refusal behavior for attention (38%), to escape (36%), ' +
    'for tangible access (16%) and for sensory reinforcement (8%).',
  );
});

test('Refusal fixture: hypothesis names the top function', () => {
  const r = ABC.analyzeBehavior(refusalEntries(), ref, { behaviorId: REFUSAL });
  assert.equal(
    ABC.draftHypothesis({ behaviorName: 'refusal', functions: r.functions }),
    'It is hypothesized that CHILD engages in refusal behavior for attention.',
  );
});

test('Refusal fixture: antecedent paragraph lists observed items, most frequent first', () => {
  const r = ABC.analyzeBehavior(refusalEntries(), ref, { behaviorId: REFUSAL });
  assert.equal(
    ABC.draftAntecedentsParagraph({ behaviorName: 'refusal', tallies: r.tallies, otherText: r.otherText }),
    'Direct observation of refusal behavior identified instances of antecedents when s/he was ' +
    'given a demand or work, when s/he was given a correction, when s/he was alone or doing ' +
    'nothing and when s/he was provoked by peers.',
  );
});

test('Refusal fixture: consequence paragraph lists observed items, most frequent first', () => {
  const r = ABC.analyzeBehavior(refusalEntries(), ref, { behaviorId: REFUSAL });
  assert.equal(
    ABC.draftConsequencesParagraph({ behaviorName: 'refusal', tallies: r.tallies, otherText: r.otherText }),
    'Consequences observed following refusal behavior included instances in which s/he received ' +
    'adult attention, was redirected to another activity, was ignored, had the demand terminated ' +
    '(e.g., allowed to escape or take a break), was given a preferred item or activity and had ' +
    'staff walk away.',
  );
});

test('zero data: no divide-by-zero, and every draft still reads sensibly', () => {
  const r = ABC.analyzeBehavior([], ref, { behaviorId: REFUSAL });
  assert.equal(r.entryCount, 0);
  assert.equal(r.total, 0);
  for (const f of r.functions) {
    assert.equal(f.score, 0);
    assert.equal(f.percent, null);
    assert.equal(ABC.formatScoreLine(f, r.total), '0 / 0 = —');
  }
  const texts = [
    ABC.draftFunctionStatement({ behaviorName: 'refusal', functions: r.functions }),
    ABC.draftHypothesis({ behaviorName: 'refusal', functions: r.functions }),
    ABC.draftAntecedentsParagraph({ behaviorName: 'refusal', tallies: r.tallies, otherText: r.otherText }),
    ABC.draftConsequencesParagraph({ behaviorName: 'refusal', tallies: r.tallies, otherText: r.otherText }),
  ];
  for (const t of texts) assert.doesNotMatch(t, /NaN|Infinity|undefined|null/);
});

test('marks that map to no function (activities, Other) leave every score at zero', () => {
  const entries = buildEntries({
    behaviorId: REFUSAL, n: 3, activity: 'act_recess',
    antecedents: { ant_other: 2 }, consequences: { cons_other: 1 },
  });
  entries[0].antecedentOther = 'Fire drill';
  entries[1].antecedentOther = 'fire drill '; // same text, different case/spacing
  const r = ABC.analyzeBehavior(entries, ref, { behaviorId: REFUSAL });
  assert.equal(r.total, 0);
  assert.ok(r.functions.every(f => f.percent === null));
  assert.equal(count(r.tallies.activity, 'act_recess'), 3);
  assert.deepEqual(r.otherText.antecedent, ['Fire drill']);
  assert.equal(
    ABC.draftAntecedentsParagraph({ behaviorName: 'refusal', tallies: r.tallies, otherText: r.otherText }),
    'Direct observation of refusal behavior did not identify any of the listed antecedents. ' +
    'Other antecedents noted by observers: Fire drill.',
  );
});

test('behaviors are analyzed separately', () => {
  const ELOPEMENT = 'beh-elopement';
  const elopement = buildEntries({
    behaviorId: ELOPEMENT, n: 10,
    antecedents: { ant_item_denied: 10 }, consequences: { cons_preferred_item: 10 },
  });
  const all = [...refusalEntries(), ...elopement];

  const refusal = ABC.analyzeBehavior(all, ref, { behaviorId: REFUSAL });
  assert.equal(refusal.entryCount, 30);
  assert.equal(refusal.total, 140);
  assert.equal(fn(refusal, 'tangible').score, 23, 'elopement marks must not leak into refusal');

  const elope = ABC.analyzeBehavior(all, ref, { behaviorId: ELOPEMENT });
  assert.equal(elope.entryCount, 10);
  assert.equal(elope.total, 20);
  assert.equal(fn(elope, 'tangible').percent, 100);
  assert.equal(fn(elope, 'escape').score, 0);
});

test('date range filtering is inclusive and drops entries outside it', () => {
  const on = (date, code) => ({
    behaviorId: REFUSAL, date, activityCode: null, activityOther: '',
    antecedentCodes: [code], antecedentOther: '', consequenceCodes: [], consequenceOther: '',
  });
  const entries = [
    on('2026-01-05', 'ant_demand'),     // before range
    on('2026-01-10', 'ant_correction'), // start day
    on('2026-01-15', 'ant_transition'), // end day
    on('2026-01-20', 'ant_demand'),     // after range
  ];
  const inRange = ABC.analyzeBehavior(entries, ref, { behaviorId: REFUSAL, start: '2026-01-10', end: '2026-01-15' });
  assert.equal(inRange.entryCount, 2);
  assert.equal(count(inRange.tallies.antecedent, 'ant_demand'), 0);
  assert.equal(count(inRange.tallies.antecedent, 'ant_correction'), 1);
  assert.equal(count(inRange.tallies.antecedent, 'ant_transition'), 1);
  assert.equal(fn(inRange, 'escape').score, 2);

  assert.equal(ABC.filterEntries(entries, { start: '2026-01-15' }).length, 2, 'open-ended end');
  assert.equal(ABC.filterEntries(entries, { end: '2026-01-10' }).length, 2, 'open-ended start');
  assert.equal(ABC.filterEntries(entries, {}).length, 4, 'no range');
});

test('a code stored twice on one entry counts as one observation', () => {
  const entries = buildEntries({ behaviorId: REFUSAL, n: 1 });
  entries[0].antecedentCodes = ['ant_demand', 'ant_demand'];
  const r = ABC.analyzeBehavior(entries, ref, { behaviorId: REFUSAL });
  assert.equal(count(r.tallies.antecedent, 'ant_demand'), 1);
});

test('retired options are hidden unless they have data in range', () => {
  const retired = { ...ref, options: ref.options.map(o => (o.code === 'ant_transition' ? { ...o, active: false } : o)) };
  const none = ABC.analyzeBehavior([], retired, { behaviorId: REFUSAL });
  assert.equal(count(none.tallies.antecedent, 'ant_transition'), undefined);

  const used = ABC.analyzeBehavior(
    buildEntries({ behaviorId: REFUSAL, n: 1, antecedents: { ant_transition: 1 } }),
    retired, { behaviorId: REFUSAL },
  );
  assert.equal(count(used.tallies.antecedent, 'ant_transition'), 1);
});

test('tied functions keep display order, and the hypothesis names every tied top function', () => {
  const r = ABC.analyzeBehavior(
    buildEntries({ behaviorId: REFUSAL, n: 5, antecedents: { ant_demand: 5, ant_removal_attention: 5 } }),
    ref, { behaviorId: REFUSAL },
  );
  assert.equal(
    ABC.draftFunctionStatement({ childName: 'Sam', behaviorName: 'refusal', functions: r.functions }),
    'Sam engages in refusal behavior to escape (50%) and for attention (50%).',
  );
  assert.equal(
    ABC.draftHypothesis({ childName: 'Sam', behaviorName: 'refusal', functions: r.functions }),
    'It is hypothesized that Sam engages in refusal behavior to escape and for attention.',
  );
});

test('joinList has no serial comma, matching the paper form', () => {
  assert.equal(ABC.joinList([]), '');
  assert.equal(ABC.joinList(['a']), 'a');
  assert.equal(ABC.joinList(['a', 'b']), 'a and b');
  assert.equal(ABC.joinList(['a', 'b', 'c']), 'a, b and c');
});
