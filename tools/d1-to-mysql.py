#!/usr/bin/env python3
"""Convert a `wrangler d1 export` dump into MySQL-compatible INSERT statements.

    wrangler d1 export studyzone-db --remote --output d1.sql
    python tools/d1-to-mysql.py d1.sql > data.sql
    mysql -u user -p dbname < docs/mysql-schema.sql
    mysql -u user -p dbname < data.sql

Only the data is converted -- the schema comes from docs/mysql-schema.sql,
because the SQLite DDL does not translate cleanly (TEXT cannot carry a UNIQUE
index in MySQL without a prefix length, AUTOINCREMENT differs, and so on).

The traps this handles:

* Two INSERT shapes. Depending on the exporter you get either
  `INSERT INTO "t" ("a","b") VALUES (1,2);` or the sqlite .dump shape
  `INSERT INTO "t" VALUES(1,2);`. Handling only the first silently produced an
  empty file with exit code 0 -- an empty database that looks like a success.
* Column order. The second shape is positional, so it quietly depends on D1 and
  docs/mysql-schema.sql declaring columns in the same order -- if two adjacent
  columns share a type, a mismatch misfiles the data instead of erroring. The
  column names are read out of the dump's own CREATE TABLE and written into
  every INSERT, so the import is explicit and order stops mattering.
* SQLite quotes identifiers with "double quotes". MySQL reads those as string
  literals unless ANSI_QUOTES is set, so `INSERT INTO "users"` silently means
  something else. Rewritten to backticks.
* Backslashes. SQLite escapes only the single quote, so a backslash in
  brand_json ("\\/" or "\\u0633") is literal data. MySQL treats it as an escape
  character and would eat it, so the output sets NO_BACKSLASH_ESCAPES to match
  SQLite's semantics exactly.
* Values containing newlines split a statement across lines. Parsed by
  accumulating until the quotes balance, not one line at a time.
* `sessions` is skipped: those rows are bearer tokens being replaced by cookies,
  and their expires_at is ISO-8601 with T/Z which MySQL DATETIME rejects anyway.
  `login_attempts` is skipped too -- it is rate-limiting scratch data inside a
  15-minute window that the app deletes on its own, so carrying it across adds
  import risk and no value.
* CREATE/PRAGMA/transaction lines are dropped.
* Windows consoles default to cp1252 and would raise UnicodeEncodeError on the
  Arabic project names, so both streams are forced to UTF-8.
"""
import io
import re
import sys

SKIP_TABLES = {"sessions", "login_attempts", "_cf_KV", "d1_migrations",
               "sqlite_sequence"}
INSERT_RE = re.compile(r'^INSERT\s+INTO\s+["`\[]?(\w+)["`\]]?\s*(.*)$', re.I | re.S)
# Splits the column list from the values on the first ") VALUES" -- a column
# list cannot itself contain a parenthesis, so the first match is the right one.
COLS_RE = re.compile(r'^\((.*?)\)\s*VALUES\s*(.*)$', re.I | re.S)
VALUES_RE = re.compile(r'^VALUES\s*(.*)$', re.I | re.S)
CREATE_RE = re.compile(r'^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?'
                       r'["`\[]?(\w+)["`\]]?\s*\((.*)\)\s*;?\s*$', re.I | re.S)
# Lines inside CREATE TABLE that declare a constraint, not a column.
NOT_A_COLUMN = re.compile(r'^(PRIMARY|UNIQUE|FOREIGN|KEY|CONSTRAINT|CHECK|INDEX)\b', re.I)


def table_columns(body):
    """Column names, in order, from the inside of a CREATE TABLE."""
    parts, depth, current = [], 0, ""
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        # Only a comma at the top level separates definitions; the ones inside
        # NUMERIC(10,2) or a CHECK expression must not split anything.
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)

    cols = []
    for part in parts:
        part = part.strip()
        if not part or NOT_A_COLUMN.match(part):
            continue
        name = part.split()[0].strip('"`[]')
        if name:
            cols.append(name)
    return cols


def statements(fh):
    """Yield whole SQL statements, joining values that contain newlines.

    A statement is complete when it ends in ';' and every string literal has
    been closed. SQLite escapes an embedded quote by doubling it, so a complete
    statement always holds an even number of ' characters.
    """
    buf = ""
    for line in fh:
        buf += line
        stripped = buf.rstrip()
        if stripped.endswith(";") and stripped.count("'") % 2 == 0:
            yield stripped
            buf = ""
    if buf.strip():
        yield buf.strip()


def convert(stmt, schema):
    """Return (table, mysql_statement), or (table, None) / (None, None)."""
    m = INSERT_RE.match(stmt.strip())
    if not m:
        return None, None
    table, rest = m.group(1), m.group(2).strip()
    if table in SKIP_TABLES:
        return table, None

    cols = COLS_RE.match(rest)
    if cols:
        # Identifiers only in the column list; the values use ' quotes.
        collist = cols.group(1).replace('"', "`")
        return table, "INSERT INTO `%s` (%s) VALUES %s" % (table, collist, cols.group(2))

    vals = VALUES_RE.match(rest)
    if vals:
        # No column list. Name the columns from the dump's own CREATE TABLE so
        # the insert stops depending on both schemas ordering columns alike.
        names = schema.get(table)
        if names:
            collist = ",".join("`%s`" % c for c in names)
            return table, "INSERT INTO `%s` (%s) VALUES %s" % (table, collist, vals.group(1))
        return table, "INSERT INTO `%s` VALUES %s" % (table, vals.group(1))

    return table, None


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 1

    # Force UTF-8 out regardless of the console codepage.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except AttributeError:      # Python < 3.7
            pass

    rows, kept, skipped, unparsed = [], {}, {}, []
    schema, positional = {}, set()
    with io.open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        for stmt in statements(fh):
            create = CREATE_RE.match(stmt.strip())
            if create:
                schema[create.group(1)] = table_columns(create.group(2))
                continue

            table, sql = convert(stmt, schema)
            if table is None:
                continue                       # PRAGMA / BEGIN / COMMIT
            if table in SKIP_TABLES:
                skipped[table] = skipped.get(table, 0) + 1
                continue
            if sql and "` VALUES" in sql:
                positional.add(table)          # no CREATE TABLE to name them
            if sql is None:
                unparsed.append(stmt[:120])    # an INSERT we failed to read
                continue
            rows.append((table, sql))
            kept[table] = kept.get(table, 0) + 1

    if unparsed:
        print("ERROR: %d INSERT statement(s) could not be parsed:" % len(unparsed),
              file=sys.stderr)
        for u in unparsed[:5]:
            print("  " + u, file=sys.stderr)
        return 2

    if not rows:
        print("ERROR: no INSERT statements found in %s -- refusing to write an "
              "empty dump. Check that the file is a d1 export." % sys.argv[1],
              file=sys.stderr)
        return 2

    print("SET NAMES utf8mb4;")
    # Match SQLite: a backslash is data, not an escape character.
    print("SET @old_sql_mode = @@sql_mode;")
    print("SET sql_mode = CONCAT(@@sql_mode, ',NO_BACKSLASH_ESCAPES');")
    print("SET FOREIGN_KEY_CHECKS = 0;")
    # projects first: users.project_id references it
    for table in sorted(kept, key=lambda t: (t != "projects", t)):
        for t, sql in rows:
            if t == table:
                print(sql)
    print("SET FOREIGN_KEY_CHECKS = 1;")
    print("SET sql_mode = @old_sql_mode;")

    for table, n in sorted(kept.items()):
        cols = len(schema.get(table, []))
        note = " (%d columns named)" % cols if cols else ""
        print("-- kept %-15s %d row(s)%s" % (table, n, note), file=sys.stderr)
    for table, n in sorted(skipped.items()):
        print("-- skipped %-12s %d row(s)" % (table, n), file=sys.stderr)
    for table in sorted(positional):
        print("-- WARNING %s: no CREATE TABLE in the dump, so its rows are "
              "inserted positionally. Check the column order against "
              "docs/mysql-schema.sql before importing." % table, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
