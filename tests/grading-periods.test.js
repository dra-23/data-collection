// Run with: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const GP = require('../grading-periods.js');

const QS = {
  Q1: { start: '2026-08-12', end: '2026-10-09' },
  Q2: { start: '2026-10-13', end: '2026-12-18' },
  Q3: { start: '2027-01-05', end: '2027-03-12' },
  Q4: { start: '2027-03-23', end: '2027-05-28' },
};

test('school year rolls over on July 1', () => {
  assert.equal(GP.schoolYearOf('2026-06-30'), 2025);
  assert.equal(GP.schoolYearOf('2026-07-01'), 2026);
  assert.equal(GP.schoolYearOf('2027-01-15'), 2026);
  assert.equal(GP.yearLabel(2026), '2026–2027');
  assert.deepEqual(GP.yearBounds(2026), { start: '2026-07-01', end: '2027-06-30' });
});

test('semesters derive from their two quarters', () => {
  assert.deepEqual(GP.deriveSemester(QS, 'S1'), { start: '2026-08-12', end: '2026-12-18' });
  assert.deepEqual(GP.deriveSemester(QS, 'S2'), { start: '2027-01-05', end: '2027-05-28' });
  assert.equal(GP.deriveSemester({ Q1: QS.Q1 }, 'S1'), null);
});

test('a full, ordered calendar is valid; blanks are allowed', () => {
  assert.deepEqual(GP.validate(2026, { ...QS, S1: GP.deriveSemester(QS, 'S1'), S2: GP.deriveSemester(QS, 'S2') }), []);
  assert.deepEqual(GP.validate(2026, {}), []);
  assert.deepEqual(GP.validate(2026, { Q1: QS.Q1, Q3: QS.Q3 }), []);
});

test('validation catches half-filled, reversed, out-of-year, and overlapping periods', () => {
  const keys = periods => GP.validate(2026, periods).map(e => e.key);
  assert.deepEqual(keys({ Q1: { start: '2026-08-12', end: '' } }), ['Q1']);
  assert.deepEqual(keys({ Q2: { start: '2026-12-01', end: '2026-11-01' } }), ['Q2']);
  assert.deepEqual(keys({ Q4: { start: '2027-05-01', end: '2027-07-15' } }), ['Q4']);
  assert.deepEqual(keys({ ...QS, Q2: { start: '2026-10-09', end: '2026-12-18' } }), ['Q2']); // starts the day Q1 ends
  assert.deepEqual(keys({ Q1: QS.Q2, Q2: QS.Q1 }), ['Q2']);                                     // out of order
  assert.deepEqual(keys({ S1: { start: '2026-08-12', end: '2027-01-10' }, S2: { start: '2027-01-05', end: '2027-05-28' } }), ['S2']);
});

test('rows group by school year; definedPeriods lists only complete ones in order', () => {
  const cal = GP.fromRows([
    { school_year: 2026, period: 'Q2', start_date: QS.Q2.start, end_date: QS.Q2.end },
    { school_year: 2026, period: 'S1', start_date: '2026-08-12', end_date: '2026-12-18' },
    { school_year: 2026, period: 'Q1', start_date: QS.Q1.start, end_date: QS.Q1.end },
    { school_year: 2025, period: 'Q1', start_date: '2025-08-13', end_date: '2025-10-10' },
  ]);
  assert.deepEqual(GP.definedPeriods(cal, 2026).map(p => p.key), ['Q1', 'Q2', 'S1']);
  assert.equal(GP.definedPeriods(cal, 2026)[0].label, 'Quarter 1');
  assert.deepEqual(GP.definedPeriods(cal, 2025).map(p => p.key), ['Q1']);
  assert.deepEqual(GP.definedPeriods(cal, 2027), []);
});

test('inRange is inclusive and a null range means everything', () => {
  assert.ok(GP.inRange('2026-08-12', QS.Q1));
  assert.ok(GP.inRange('2026-10-09', QS.Q1));
  assert.ok(!GP.inRange('2026-10-10', QS.Q1));
  assert.ok(GP.inRange('2020-01-01', null));
});

test('formatRange shows the year once when both dates share it', () => {
  assert.equal(GP.formatRange('2026-08-12', '2026-10-09'), 'Aug 12 – Oct 9, 2026');
  assert.equal(GP.formatRange('2026-12-01', '2027-01-09'), 'Dec 1, 2026 – Jan 9, 2027');
});
