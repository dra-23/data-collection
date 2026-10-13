// School Calendar — user-defined Quarters 1–4 and Semesters 1–2, shared by
// SPEDsheet (Yearly Summary range picker) and SPEDsight (Analyze quick
// ranges). Each account keeps its own dates in the grading_periods table
// (sql/004_grading_periods.sql), one row per school year + period.
//
// Three layers:
//   • pure date helpers (no DOM/Supabase — covered by tests/grading-periods.test.js)
//   • load/save against Supabase
//   • the "School Calendar" editor modal, built from the host page's own
//     .modal-bg/.modal/.fin/.mbtn classes so it matches each tool's look
//
// Dates are 'YYYY-MM-DD' strings throughout (they compare correctly as
// strings). A school year is named by the calendar year it starts in:
// 2026 = 2026–2027, running Jul 1 – Jun 30 like the Yearly Summary.
(function (root) {
  'use strict';

  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  const SEMESTERS = ['S1', 'S2'];
  const KEYS = [...QUARTERS, ...SEMESTERS];
  const LABELS = { Q1: 'Quarter 1', Q2: 'Quarter 2', Q3: 'Quarter 3', Q4: 'Quarter 4', S1: 'Semester 1', S2: 'Semester 2' };
  // Which quarters each semester spans (for auto-fill).
  const SEMESTER_QUARTERS = { S1: ['Q1', 'Q2'], S2: ['Q3', 'Q4'] };

  // ── Pure helpers ─────────────────────────────────────────────────────
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Roll over on July 1, matching SPEDsheet's getSchoolYear().
  function schoolYearOf(dateStr) {
    const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7));
    return m >= 7 ? y : y - 1;
  }
  const currentSchoolYear = (today = new Date()) => schoolYearOf(isoDate(today));
  const yearLabel = sy => `${sy}–${sy + 1}`;
  const yearBounds = sy => ({ start: `${sy}-07-01`, end: `${sy + 1}-06-30` });

  // { start, end } when both are set, else null.
  function complete(p) { return p && p.start && p.end ? { start: p.start, end: p.end } : null; }

  // S1 = Q1 start → Q2 end, S2 = Q3 start → Q4 end (null if either is missing).
  function deriveSemester(quarters, key) {
    const [a, b] = SEMESTER_QUARTERS[key];
    const qa = complete(quarters[a]), qb = complete(quarters[b]);
    return qa && qb ? { start: qa.start, end: qb.end } : null;
  }

  // Returns a list of { key, message } problems; empty means valid.
  // Periods may be left blank (both dates empty) — a half-filled one is not.
  function validate(sy, periods) {
    const errors = [];
    const { start: yStart, end: yEnd } = yearBounds(sy);
    for (const k of KEYS) {
      const p = periods[k] || {};
      if (!p.start && !p.end) continue;
      if (!p.start || !p.end) { errors.push({ key: k, message: `${LABELS[k]} needs both a start and an end date.` }); continue; }
      if (p.start > p.end) { errors.push({ key: k, message: `${LABELS[k]} ends before it starts.` }); continue; }
      if (p.start < yStart || p.end > yEnd) errors.push({ key: k, message: `${LABELS[k]} must fall within the ${yearLabel(sy)} school year (Jul 1 – Jun 30).` });
    }
    if (errors.length) return errors;
    // Quarters (and semesters) must run in order without overlapping. Blank
    // ones are skipped, so e.g. Q1 + Q3 alone is still checked against each other.
    for (const group of [QUARTERS, SEMESTERS]) {
      const set = group.filter(k => complete(periods[k]));
      for (let i = 1; i < set.length; i++) {
        const prev = periods[set[i - 1]], cur = periods[set[i]];
        if (cur.start <= prev.end) errors.push({ key: set[i], message: `${LABELS[set[i]]} must start after ${LABELS[set[i - 1]]} ends.` });
      }
    }
    return errors;
  }

  // Supabase rows → { [schoolYear]: { Q1: {start, end}, … } }
  function fromRows(rows) {
    const out = {};
    for (const r of rows || []) {
      (out[r.school_year] ||= {})[r.period] = { start: r.start_date, end: r.end_date };
    }
    return out;
  }

  // The defined periods of a school year, in display order, for range pickers.
  function definedPeriods(calendar, sy) {
    const year = (calendar && calendar[sy]) || {};
    return KEYS.filter(k => complete(year[k])).map(k => ({ key: k, label: LABELS[k], start: year[k].start, end: year[k].end }));
  }

  const inRange = (dateStr, range) => !range || (dateStr >= range.start && dateStr <= range.end);

  // "Aug 12 – Oct 10, 2026" / "Dec 1, 2026 – Jan 9, 2027"
  function formatRange(start, end) {
    const d = s => new Date(s + 'T12:00:00');
    const md = { month: 'short', day: 'numeric' }, mdy = { month: 'short', day: 'numeric', year: 'numeric' };
    const a = d(start), b = d(end);
    return a.getFullYear() === b.getFullYear()
      ? `${a.toLocaleDateString('en-US', md)} – ${b.toLocaleDateString('en-US', mdy)}`
      : `${a.toLocaleDateString('en-US', mdy)} – ${b.toLocaleDateString('en-US', mdy)}`;
  }

  // ── Supabase ─────────────────────────────────────────────────────────
  // RLS limits both calls to the signed-in account's own rows.
  async function load(sb) {
    const { data, error } = await sb.from('grading_periods').select('school_year, period, start_date, end_date');
    if (error) throw error;
    return fromRows(data);
  }

  // Replaces one school year's calendar: upserts the filled-in periods and
  // deletes any that were cleared.
  async function saveYear(sb, ownerId, sy, periods) {
    const filled = KEYS.filter(k => complete(periods[k]));
    const cleared = KEYS.filter(k => !complete(periods[k]));
    if (filled.length) {
      const { error } = await sb.from('grading_periods').upsert(
        filled.map(k => ({ owner_id: ownerId, school_year: sy, period: k, start_date: periods[k].start, end_date: periods[k].end })),
        { onConflict: 'owner_id,school_year,period' });
      if (error) throw error;
    }
    if (cleared.length) {
      const { error } = await sb.from('grading_periods').delete().eq('school_year', sy).in('period', cleared);
      if (error) throw error;
    }
  }

  // ── Editor modal ─────────────────────────────────────────────────────
  const CSS = `
.gp-modal { width: 560px; }
.gp-year { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 14px 0 6px; }
.gp-year-lbl { min-width: 120px; text-align: center; font-size: 16px; font-weight: 700; color: var(--brand); }
.gp-year-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--border-mid); background: var(--surface2); color: var(--text-2); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.gp-year-btn:hover { background: var(--border); }
.gp-section { margin-top: 16px; }
.gp-section-hdr { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); margin-bottom: 6px; }
.gp-section-note { font-size: 12px; font-weight: 400; letter-spacing: 0; text-transform: none; }
.gp-row { display: grid; grid-template-columns: 110px 1fr 1fr 30px; gap: 10px; align-items: center; padding: 5px 0; }
.gp-row-lbl { font-size: 14px; font-weight: 600; color: var(--text); }
.gp-colhdr { padding: 0; font-size: 12px; font-weight: 600; color: var(--text-3); }
.gp-row-auto { display: block; font-size: 11px; font-weight: 500; color: var(--text-3); }
.gp-row .fin { padding: 7px 8px; min-width: 0; }
.gp-row .fin.gp-bad { border-color: var(--danger); }
.gp-clear { width: 28px; height: 28px; border: none; border-radius: 6px; background: transparent; color: var(--text-3); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.gp-clear:hover { background: var(--surface2); color: var(--text); }
.gp-link { border: none; background: none; padding: 0; color: var(--brand); font: inherit; font-size: 12px; font-weight: 600; letter-spacing: 0; text-transform: none; cursor: pointer; }
.gp-link:hover { text-decoration: underline; }
.gp-errors { margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: var(--danger-bg); border: 1px solid var(--danger-border); color: var(--danger); font-size: 13px; line-height: 1.5; }
.gp-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
@media (max-width: 560px) {
  .gp-row { grid-template-columns: 1fr 1fr 30px; row-gap: 4px; }
  .gp-row-lbl { grid-column: 1 / -1; }
}`;

  const X_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const CHEV = d => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="${d}"/></svg>`;

  let _styled = false, _modal = null;

  // Static markup only — every date value is set through .value below.
  function rowHTML(k) {
    const auto = k[0] === 'S' ? `<span class="gp-row-auto" data-gp-auto="${k}">Matches quarters</span>` : '';
    return `<div class="gp-row">
      <div class="gp-row-lbl">${LABELS[k]}${auto}</div>
      <input class="fin" type="date" data-gp-key="${k}" data-gp-end="0" aria-label="${LABELS[k]} start date">
      <input class="fin" type="date" data-gp-key="${k}" data-gp-end="1" aria-label="${LABELS[k]} end date">
      <button type="button" class="gp-clear" data-gp-clear="${k}" title="Clear ${LABELS[k]}" aria-label="Clear ${LABELS[k]}">${X_ICON}</button>
    </div>`;
  }

  // opts: { sb, ownerId, calendar, year, onSaved(calendar) }
  function openEditor(opts) {
    if (!_styled) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); _styled = true; }
    if (_modal) _modal.remove();

    let calendar = JSON.parse(JSON.stringify(opts.calendar || {}));
    let sy = opts.year ?? currentSchoolYear();
    let draft, auto, dirty = false, saving = false;

    const bg = document.createElement('div');
    bg.className = 'modal-bg open';
    bg.innerHTML = `<div class="modal gp-modal" role="dialog" aria-modal="true" aria-labelledby="gp-title">
      <div class="modal-title" id="gp-title">School Calendar</div>
      <div class="modal-sub">Set your quarter and semester dates. Summaries can then be filtered to any of them. Leave a period blank if you don't use it.</div>
      <div class="gp-year">
        <button type="button" class="gp-year-btn" data-gp-year="-1" aria-label="Previous school year">${CHEV('15 18 9 12 15 6')}</button>
        <div class="gp-year-lbl" aria-live="polite"></div>
        <button type="button" class="gp-year-btn" data-gp-year="1" aria-label="Next school year">${CHEV('9 18 15 12 9 6')}</button>
      </div>
      <div class="gp-section">
        <div class="gp-section-hdr"><span>Quarters</span></div>
        <div class="gp-row gp-colhdr" aria-hidden="true"><span class="gp-row-lbl"></span><span>Start</span><span>End</span><span></span></div>
        ${QUARTERS.map(rowHTML).join('')}
      </div>
      <div class="gp-section">
        <div class="gp-section-hdr"><span>Semesters</span><span class="gp-section-note">Filled in from the quarters — change them if yours differ</span></div>
        ${SEMESTERS.map(rowHTML).join('')}
      </div>
      <div class="gp-errors" role="alert" hidden></div>
      <div class="gp-actions">
        <button type="button" class="mbtn mbtn-ghost" data-gp-cancel>Cancel</button>
        <button type="button" class="mbtn mbtn-brand" data-gp-save>Save</button>
      </div>
    </div>`;
    document.body.appendChild(bg);
    _modal = bg;
    const $ = sel => bg.querySelector(sel);
    const errBox = $('.gp-errors');

    function loadYear() {
      const stored = calendar[sy] || {};
      draft = {};
      KEYS.forEach(k => { draft[k] = { start: stored[k]?.start || '', end: stored[k]?.end || '' }; });
      // A semester keeps following its quarters unless it was saved with
      // dates of its own.
      auto = {};
      SEMESTERS.forEach(k => {
        const derived = deriveSemester(stored, k);
        const own = complete(stored[k]);
        auto[k] = !own || (derived && derived.start === own.start && derived.end === own.end);
      });
      dirty = false;
      applyAuto();
      paint();
    }

    function applyAuto() {
      SEMESTERS.forEach(k => {
        if (!auto[k]) return;
        const d = deriveSemester(draft, k);
        draft[k] = d ? { ...d } : { start: '', end: '' };
      });
    }

    function paint(badKeys = new Set()) {
      $('.gp-year-lbl').textContent = yearLabel(sy);
      const { start: min, end: max } = yearBounds(sy);
      bg.querySelectorAll('input[data-gp-key]').forEach(inp => {
        const p = draft[inp.dataset.gpKey];
        inp.value = inp.dataset.gpEnd === '1' ? p.end : p.start;
        inp.min = min; inp.max = max;
        inp.classList.toggle('gp-bad', badKeys.has(inp.dataset.gpKey));
      });
      SEMESTERS.forEach(k => {
        const tag = bg.querySelector(`[data-gp-auto="${k}"]`);
        tag.textContent = '';
        if (auto[k]) tag.textContent = 'Matches quarters';
        else {
          const link = document.createElement('button');
          link.type = 'button'; link.className = 'gp-link'; link.dataset.gpReauto = k;
          link.textContent = 'Match quarters';
          tag.appendChild(link);
        }
      });
    }

    function showErrors(errors) {
      errBox.hidden = !errors.length;
      errBox.textContent = '';
      errors.forEach(e => { const div = document.createElement('div'); div.textContent = e.message; errBox.appendChild(div); });
    }

    function close() {
      document.removeEventListener('keydown', onKey, true);
      bg.remove();
      if (_modal === bg) _modal = null;
    }
    const confirmDiscard = () => !dirty || confirm('Discard your unsaved calendar changes?');

    async function save() {
      if (saving) return;
      const errors = validate(sy, draft);
      showErrors(errors);
      paint(new Set(errors.map(e => e.key)));
      if (errors.length) return;
      saving = true;
      const btn = $('[data-gp-save]');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await saveYear(opts.sb, opts.ownerId, sy, draft);
        const year = {};
        KEYS.forEach(k => { const p = complete(draft[k]); if (p) year[k] = p; });
        calendar[sy] = year;
        close();
        opts.onSaved && opts.onSaved(calendar);
      } catch (e) {
        console.error('save grading periods:', e);
        showErrors([{ key: '', message: "Couldn't save the calendar. Check your connection and try again. (If this is a new setup, make sure sql/004 has been run in Supabase.)" }]);
      } finally {
        saving = false;
        if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Save'; }
      }
    }

    bg.addEventListener('input', e => {
      const inp = e.target.closest('input[data-gp-key]');
      if (!inp) return;
      const k = inp.dataset.gpKey;
      draft[k][inp.dataset.gpEnd === '1' ? 'end' : 'start'] = inp.value;
      if (k[0] === 'S') auto[k] = false;
      dirty = true;
      applyAuto();
      paint();
    });
    bg.addEventListener('click', e => {
      if (e.target === bg) { if (confirmDiscard()) close(); return; }
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.gpYear) {
        if (!confirmDiscard()) return;
        sy += Number(t.dataset.gpYear);
        showErrors([]);
        loadYear();
      } else if (t.dataset.gpClear) {
        const k = t.dataset.gpClear;
        draft[k] = { start: '', end: '' };
        if (k[0] === 'S') auto[k] = false;
        dirty = true; applyAuto(); paint();
      } else if (t.dataset.gpReauto) {
        auto[t.dataset.gpReauto] = true;
        dirty = true; applyAuto(); paint();
      } else if ('gpCancel' in t.dataset) { if (confirmDiscard()) close(); }
      else if ('gpSave' in t.dataset) save();
    });
    // Capture phase so the host page's own Escape handling doesn't also run.
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); if (confirmDiscard()) close(); }
    }
    document.addEventListener('keydown', onKey, true);

    loadYear();
    bg.querySelector('input[data-gp-key]').focus();
  }

  const api = {
    QUARTERS, SEMESTERS, KEYS, LABELS,
    schoolYearOf, currentSchoolYear, yearLabel, yearBounds,
    deriveSemester, validate, fromRows, definedPeriods, inRange, formatRange,
    load, saveYear, openEditor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GradingPeriods = api;
})(typeof window !== 'undefined' ? window : globalThis);
