import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ROWS, guardQuery } from '../lib/sql-guard.mjs';

test('read-only queries pass and are wrapped with a row limit', () => {
  for (const sql of [
    'SELECT 1',
    'select count(*) from main.orders',
    'WITH t AS (SELECT 1 AS x) SELECT * FROM t',
    'FROM main.orders WHERE status = \'open\'',
    'DESCRIBE main.orders',
    'SUMMARIZE main.orders',
    'SHOW TABLES',
    'SELECT 1;',
    'SELECT 1; -- trailing comment',
    "SELECT 'drop table; delete' AS words",
    'SELECT "update" FROM t',
    'SELECT * FROM "Orders"',
    'SELECT created_at, updated_at FROM t',
  ]) {
    const guarded = guardQuery(sql, 10);
    assert.match(guarded.wrapped, /^SELECT \* FROM \(.+\) AS assistant_query LIMIT 11$/s, sql);
  }
});

test('writes, multiple statements and external readers are rejected', () => {
  for (const sql of [
    'DROP TABLE t',
    'INSERT INTO t VALUES (1)',
    'SELECT 1; DROP TABLE t',
    "SELECT 1; SELECT 'x'",
    'WITH x AS (SELECT 1) DELETE FROM t',
    "ATTACH 'md:other'",
    'COPY t TO \'out.csv\'',
    'SET threads = 1',
    'PRAGMA database_list',
    "SELECT * FROM read_csv('data.csv')",
    "SELECT * FROM read_parquet ('x.parquet')",
    'SELECT * FROM "read_csv"(\'missing.csv\')',
    'SELECT * FROM "read_parquet"(\'missing.parquet\')',
    "SELECT * FROM 'missing.csv'",
    "SELECT * FROM main.orders, 'missing.csv'",
    'SELECT * FROM "missing.parquet"',
    'SELECT * FROM "data/missing.csv"',
    "DESCRIBE 'missing.parquet'",
    "SELECT * FROM query('SELECT 1')",
    "SELECT * FROM postgres_scan('connection', 'schema', 'table')",
    "SELECT 'gs://bucket/data'",
    "SELECT 'abfs://container/data'",
    "SELECT $$SELECT 1;$$",
    "SELECT E'escaped'",
    "SELECT * FROM 's3://bucket/file.parquet'",
    "SELECT * FROM 'https://example.com/x.csv'",
    "SELECT getenv('HOME')",
    'SELECT 1 /* unterminated',
    "SELECT 'unterminated",
    '',
    'x'.repeat(8001),
  ]) {
    assert.throws(() => guardQuery(sql), undefined, sql.slice(0, 60));
  }
});

test('limit is clamped to the allowed range', () => {
  assert.equal(guardQuery('SELECT 1', 10000).limit, MAX_ROWS);
  assert.equal(guardQuery('SELECT 1', 0).limit, 50);
  assert.equal(guardQuery('SELECT 1', -5).limit, 1);
  assert.equal(guardQuery('SELECT 1').limit, 50);
});

test('comments are stripped and quoted text is kept in the executed SQL', () => {
  const guarded = guardQuery("-- why\nSELECT 'a;b' AS v /* note */");
  assert.equal(guarded.sql.includes("'a;b'"), true);
  assert.equal(guarded.sql.includes('note'), false);
});
