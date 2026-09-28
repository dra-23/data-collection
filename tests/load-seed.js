// Loads the ABC reference data straight from the SQL seed files, so the
// tests exercise the same option lists and function mapping that were
// seeded into the database rather than a hand-copied duplicate.
const fs = require('node:fs');
const path = require('node:path');

// Parses the tuples of `insert into <table> (cols) values (...), (...)`.
// Handles '' escapes, -- comments between tuples, numbers and booleans —
// enough for these seed files, not a general SQL parser.
function parseInserts(sql, table) {
  const head = new RegExp(`insert\\s+into\\s+${table}\\s*\\(([^)]*)\\)\\s*values`, 'i').exec(sql);
  if (!head) throw new Error(`No "insert into ${table}" found`);
  const cols = head[1].split(',').map(c => c.trim());
  const rows = [];
  let i = head.index + head[0].length;

  const skipSeparators = () => {
    for (;;) {
      while (i < sql.length && /[\s,]/.test(sql[i])) i++;
      if (!sql.startsWith('--', i)) return;
      while (i < sql.length && sql[i] !== '\n') i++;
    }
  };

  for (;;) {
    skipSeparators();
    if (sql[i] !== '(') break; // reached "on conflict ..." / ";"
    i++;
    const vals = [];
    for (;;) {
      while (/\s/.test(sql[i])) i++;
      if (sql[i] === "'") {
        let s = '';
        i++;
        for (;;) {
          if (sql[i] === "'" && sql[i + 1] === "'") { s += "'"; i += 2; }
          else if (sql[i] === "'") { i++; break; }
          else s += sql[i++];
        }
        vals.push(s);
      } else {
        const tok = /^[^,)\s]+/.exec(sql.slice(i))[0];
        i += tok.length;
        vals.push(tok === 'true' ? true : tok === 'false' ? false : tok === 'null' ? null : Number(tok));
      }
      while (/\s/.test(sql[i])) i++;
      if (sql[i] === ',') { i++; continue; }
      if (sql[i] === ')') { i++; break; }
      throw new Error(`Unexpected "${sql[i]}" in ${table} values`);
    }
    if (vals.length !== cols.length) {
      throw new Error(`${table} row has ${vals.length} values, expected ${cols.length}`);
    }
    rows.push(Object.fromEntries(cols.map((c, k) => [c, vals[k]])));
  }
  return rows;
}

function loadReference() {
  const dir = path.join(__dirname, '..', 'sql');
  const options = fs.readFileSync(path.join(dir, '002_abc_seed_options.sql'), 'utf8');
  const mapping = fs.readFileSync(path.join(dir, '003_abc_seed_function_mapping.sql'), 'utf8');
  return {
    options: parseInserts(options, 'abc_options').map(r => ({
      category: r.category, code: r.code, label: r.label, narrative: r.narrative,
      hasText: r.has_text, displayOrder: r.display_order, active: true,
    })),
    functions: parseInserts(options, 'abc_functions').map(r => ({
      code: r.code, label: r.label, fbaPhrase: r.fba_phrase, displayOrder: r.display_order,
    })),
    mapping: parseInserts(mapping, 'abc_function_mapping').map(r => ({
      functionCode: r.function_code, optionCode: r.option_code,
    })),
  };
}

module.exports = { loadReference, parseInserts };
