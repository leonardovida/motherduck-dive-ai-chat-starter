// Defense in depth for assistant-written SQL. The real boundary is the read-only
// service account token, scoped to one share, that runs these queries.
export const MAX_ROWS = 200;
const LEADING = /^(SELECT|WITH|FROM|DESCRIBE|SUMMARIZE|SHOW)\b/i;
const FORBIDDEN_WORDS = /\b(ATTACH|DETACH|COPY|INSTALL|LOAD|PRAGMA|SET|RESET|CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|EXPORT|IMPORT|CALL|USE|CHECKPOINT|VACUUM|TRUNCATE|MERGE|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|REPLACE\s+INTO)\b/i;
const FORBIDDEN_FUNCTIONS = /\b(read_\w+|\w+_scan|\w+_query|glob|sniff_csv|query|query_table|getenv|http_get|http_post)\s*\(/i;
const EXTERNAL = /\b[a-z][a-z0-9+.-]*:\/\//i;

// Splits SQL into code (strings and quoted identifiers blanked) and full text, without comments.
function scan(sql) {
  let code = '', functions = '', text = '', ended = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (c === '-' && next === '-') { while (i < sql.length && sql[i] !== '\n') i++; code += ' '; functions += ' '; text += ' '; continue; }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unterminated comment.');
      i = end + 1; code += ' '; functions += ' '; text += ' '; continue;
    }
    if (/\s/.test(c)) { code += c; functions += c; text += c; continue; }
    // Anything but whitespace or comments after a semicolon is a second statement.
    if (ended) throw new Error('Only one statement is allowed.');
    if (c === "'" || c === '"') {
      if (c === "'" && /\b(?:E|U&)$/i.test(code)) throw new Error('Escaped string syntax is not supported.');
      let j = i + 1;
      for (; j < sql.length; j++) { if (sql[j] === c) { if (sql[j + 1] === c) { j++; continue; } break; } }
      if (j >= sql.length) throw new Error('Unterminated quote.');
      const literal = sql.slice(i, j + 1);
      const identifier = literal.slice(1, -1).replaceAll('""', '"');
      const fileIdentifier = /[\\/:]|\.(?:csv|tsv|parquet|json|ndjson|jsonl|xlsx|orc|avro|arrow|feather|duckdb|sqlite)$/i.test(identifier);
      code += c === "'" ? "''" : fileIdentifier ? '__external_relation__' : '""';
      functions += c === "'" ? "''" : literal.slice(1, -1).replaceAll('""', '"');
      text += literal; i = j; continue;
    }
    if (c === ';') { ended = true; code += ' '; functions += ' '; text += ' '; continue; }
    code += c; functions += c; text += c;
  }
  return { code: code.trim(), functions: functions.trim(), text: text.trim() };
}

// DuckDB accepts a filename in a table position (including comma joins) without read_*().
function hasLiteralRelation(code) {
  let depth = 0, expecting = false;
  const fromDepths = new Set();
  for (const token of code.match(/''|""|[A-Za-z_][A-Za-z0-9_$]*|[(),]/g) || []) {
    const word = token.toUpperCase();
    if (token === '(') { depth++; continue; }
    if (token === ')') { fromDepths.delete(depth--); expecting = false; continue; }
    if (word === 'FROM' || word === 'JOIN') { fromDepths.add(depth); expecting = true; continue; }
    if (word === 'DESCRIBE' || word === 'SUMMARIZE') { expecting = true; continue; }
    if (['WHERE', 'GROUP', 'ORDER', 'HAVING', 'QUALIFY', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW'].includes(word)) fromDepths.delete(depth);
    if (token === ',' && fromDepths.has(depth)) { expecting = true; continue; }
    if ((token === "''" || token === '__external_relation__') && expecting) return true;
    expecting = false;
  }
  return false;
}

export function guardQuery(sql, limit = 50) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('Query is empty.');
  if (sql.length > 8000) throw new Error('Query is too long.');
  if (/\$[A-Za-z0-9_]*\$/.test(sql)) throw new Error('Dollar-quoted SQL is not supported.');
  const { code, functions, text } = scan(sql);
  if (!LEADING.test(code)) throw new Error('Only SELECT, WITH, FROM, DESCRIBE, SUMMARIZE or SHOW queries are allowed.');
  if (FORBIDDEN_WORDS.test(code)) throw new Error('Only read-only queries are allowed.');
  if (FORBIDDEN_FUNCTIONS.test(functions) || hasLiteralRelation(code)) throw new Error('File and URL readers are not allowed.');
  if (EXTERNAL.test(text)) throw new Error('External locations are not allowed.');
  const rows = Math.min(MAX_ROWS, Math.max(1, Math.floor(Number(limit) || 50)));
  // One extra row tells the caller whether the result was cut off.
  return { sql: text, wrapped: `SELECT * FROM (${text}) AS assistant_query LIMIT ${rows + 1}`, limit: rows };
}

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,99}$/;
export const quoteIdentifier = name => `"${String(name).replaceAll('"', '""')}"`;
