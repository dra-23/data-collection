// ABC Data Collection — analysis logic (tallies, function scores, draft text).
//
// Pure functions only: no DOM, no Supabase, no student data held here.
// Loaded by abc.html as a plain <script> (exposed as window.ABC) and by the
// Node tests via require(). Everything returned is plain text — callers
// must escape it before inserting into HTML.
//
// Shapes the caller maps Supabase rows into:
//   entry:  { behaviorId, date: 'YYYY-MM-DD', activityCode, activityOther,
//             antecedentCodes: [], antecedentOther,
//             consequenceCodes: [], consequenceOther }
//   ref:    { options:   [{ category, code, label, narrative, hasText, displayOrder, active }],
//             functions: [{ code, label, fbaPhrase, displayOrder }],
//             mapping:   [{ functionCode, optionCode }] }
(function (root) {
  'use strict';

  const byDisplayOrder = (a, b) => a.displayOrder - b.displayOrder;

  // "a", "a and b", "a, b and c" — no serial comma, matching the paper form's
  // example sentence.
  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  // Dates are 'YYYY-MM-DD' strings, which compare correctly as strings.
  // Both bounds are inclusive; either may be omitted for an open range.
  function filterEntries(entries, { behaviorId, start, end } = {}) {
    return entries.filter(e =>
      (behaviorId == null || e.behaviorId === behaviorId) &&
      (!start || e.date >= start) &&
      (!end || e.date <= end));
  }

  // 2A: how many entries selected each option. Every active option is listed
  // (zero counts included) so the tables show what was NOT observed too; a
  // retired option only appears if it still has data in range.
  function tallyOptions(entries, options) {
    const counts = new Map();
    const bump = code => counts.set(code, (counts.get(code) || 0) + 1);
    for (const e of entries) {
      if (e.activityCode) bump(e.activityCode);
      // Set: a code stored twice on one entry is still one observation.
      new Set(e.antecedentCodes || []).forEach(bump);
      new Set(e.consequenceCodes || []).forEach(bump);
    }
    const tallies = { activity: [], antecedent: [], consequence: [] };
    for (const o of [...options].sort(byDisplayOrder)) {
      const count = counts.get(o.code) || 0;
      if (!tallies[o.category] || (o.active === false && count === 0)) continue;
      tallies[o.category].push({
        code: o.code, label: o.label, narrative: o.narrative || '',
        hasText: !!o.hasText, count,
      });
    }
    return tallies;
  }

  // 2B: each function's score is the sum of the counts of its mapped
  // antecedents and consequences. Because one option can count toward
  // several functions, percentages are taken over the sum of all function
  // scores — not over the number of marks — and truncated (not rounded) to
  // match the paper form, so they may total slightly under 100.
  function scoreFunctions(tallies, functions, mapping) {
    const mappedTo = new Map();
    for (const m of mapping) {
      if (!mappedTo.has(m.functionCode)) mappedTo.set(m.functionCode, new Set());
      mappedTo.get(m.functionCode).add(m.optionCode);
    }
    const rows = [...tallies.antecedent, ...tallies.consequence];
    const scored = [...functions].sort(byDisplayOrder).map(f => {
      const codes = mappedTo.get(f.code) || new Set();
      const components = rows.filter(r => codes.has(r.code))
        .map(r => ({ code: r.code, label: r.label, count: r.count }));
      const score = components.reduce((sum, c) => sum + c.count, 0);
      return { code: f.code, label: f.label, fbaPhrase: f.fbaPhrase, score, components };
    });
    const total = scored.reduce((sum, f) => sum + f.score, 0);
    for (const f of scored) f.percent = total > 0 ? Math.floor((f.score * 100) / total) : null;
    return { functions: scored, total };
  }

  // Free text typed for "Other"/"Special" choices, de-duplicated
  // case-insensitively (first spelling wins).
  function collectOtherText(entries) {
    const pick = field => {
      const seen = new Map();
      for (const e of entries) {
        const t = (e[field] || '').trim();
        if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
      }
      return [...seen.values()];
    };
    return {
      activity: pick('activityOther'),
      antecedent: pick('antecedentOther'),
      consequence: pick('consequenceOther'),
    };
  }

  // Everything the analysis screen needs for one student's behavior over one
  // date range. Callers pass only that student's entries; behaviors are
  // always analyzed separately because each has its own function.
  function analyzeBehavior(entries, ref, filter) {
    const scoped = filterEntries(entries, filter);
    const tallies = tallyOptions(scoped, ref.options);
    const { functions, total } = scoreFunctions(tallies, ref.functions, ref.mapping);
    return { entryCount: scoped.length, tallies, functions, total, otherText: collectOtherText(scoped) };
  }

  // "51 / 140 = 36%" — the raw numbers always shown beside a percentage.
  function formatScoreLine(fn, total) {
    return `${fn.score} / ${total} = ${fn.percent == null ? '—' : fn.percent + '%'}`;
  }

  // Functions that actually scored, highest first; ties keep display order.
  function rankFunctions(functions) {
    return functions.filter(f => f.score > 0)
      .map((f, i) => ({ f, i }))
      .sort((a, b) => b.f.score - a.f.score || a.i - b.i)
      .map(x => x.f);
  }

  function draftFunctionStatement({ childName = 'CHILD', behaviorName, functions }) {
    const ranked = rankFunctions(functions);
    if (!ranked.length) {
      return `No function could be identified for ${behaviorName} behavior: no antecedents or consequences that map to a function were observed.`;
    }
    const parts = ranked.map(f => `${f.fbaPhrase} (${f.percent}%)`);
    return `${childName} engages in ${behaviorName} behavior ${joinList(parts)}.`;
  }

  // "Top" = every function tied for the highest score. Close seconds are
  // left for the analyst to add when editing the draft.
  function draftHypothesis({ childName = 'CHILD', behaviorName, functions }) {
    const ranked = rankFunctions(functions);
    if (!ranked.length) {
      return `There is not yet enough data to form a hypothesis for ${behaviorName} behavior.`;
    }
    const top = ranked.filter(f => f.score === ranked[0].score);
    return `It is hypothesized that ${childName} engages in ${behaviorName} behavior ${joinList(top.map(f => f.fbaPhrase))}.`;
  }

  // Observed (nonzero) options, most frequent first; options with free-text
  // ("Other") are summarized separately from the narrative list.
  function observedNarratives(rows) {
    return rows.filter(r => r.count > 0 && !r.hasText)
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.count - a.r.count || a.i - b.i)
      .map(x => x.r.narrative || x.r.label.toLowerCase());
  }

  function otherSentence(rows, texts, noun) {
    if (!rows.some(r => r.hasText && r.count > 0)) return '';
    return texts.length
      ? ` Other ${noun} noted by observers: ${texts.join('; ')}.`
      : ` Other ${noun} were also noted.`;
  }

  function draftAntecedentsParagraph({ behaviorName, tallies, otherText }) {
    const clauses = observedNarratives(tallies.antecedent).map(n => `when ${n}`);
    const other = otherSentence(tallies.antecedent, otherText.antecedent, 'antecedents');
    if (!clauses.length) {
      return other
        ? `Direct observation of ${behaviorName} behavior did not identify any of the listed antecedents.${other}`
        : `Direct observation of ${behaviorName} behavior did not identify any antecedents.`;
    }
    return `Direct observation of ${behaviorName} behavior identified instances of antecedents ${joinList(clauses)}.${other}`;
  }

  function draftConsequencesParagraph({ behaviorName, tallies, otherText }) {
    const clauses = observedNarratives(tallies.consequence);
    const other = otherSentence(tallies.consequence, otherText.consequence, 'consequences');
    if (!clauses.length) {
      return other
        ? `Direct observation of ${behaviorName} behavior did not identify any of the listed consequences.${other}`
        : `Direct observation of ${behaviorName} behavior did not identify any consequences.`;
    }
    return `Consequences observed following ${behaviorName} behavior included instances in which s/he ${joinList(clauses)}.${other}`;
  }

  const api = {
    joinList, filterEntries, tallyOptions, scoreFunctions, collectOtherText,
    analyzeBehavior, formatScoreLine, rankFunctions,
    draftFunctionStatement, draftHypothesis,
    draftAntecedentsParagraph, draftConsequencesParagraph,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ABC = api;
})(typeof window !== 'undefined' ? window : globalThis);
