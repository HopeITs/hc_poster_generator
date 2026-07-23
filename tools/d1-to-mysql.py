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

* SQLite quotes identifiers with "double quotes". MySQL reads those as string
  literals unless ANSI_QUOTES is set, so `INSERT INTO "users"` silently means
  something else. Rewritten to backticks.
* `sessions` is skipped: those rows are bearer tokens being replaced by cookies,
  and their expires_at is ISO-8601 with T/Z which MySQL DATETIME rejects anyway.
* CREATE/PRAGMA/transaction lines are dropped.
"""
import io
import re
import sys

SKIP_TABLES = {"sessions", "_cf_KV", "d1_migrations", "sqlite_sequence"}
INSERT_RE = re.compile(r'^INSERT INTO ["`\[]?(\w+)["`\]]?\s*(\(.*)$', re.I)


def convert(line):
    m = INSERT_RE.match(line.strip())
    if not m:
        return None
    table = m.group(1)
    if table in SKIP_TABLES:
        return None
    rest = m.group(2)

    # Only the column list is quoted with " in a D1 dump; values use ' quotes.
    # Rewrite just that leading parenthesised list.
    head, sep, tail = rest.partition(") VALUES")
    if not sep:
        return None
    head = head.replace('"', "`")
    return "INSERT INTO `%s` %s) VALUES%s" % (table, head, tail)


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 1
    out, kept, skipped = [], {}, {}
    with io.open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        for line in fh:
            m = INSERT_RE.match(line.strip())
            if m and m.group(1) in SKIP_TABLES:
                skipped[m.group(1)] = skipped.get(m.group(1), 0) + 1
                continue
            row = convert(line)
            if row:
                out.append(row)
                kept[m.group(1)] = kept.get(m.group(1), 0) + 1

    print("SET NAMES utf8mb4;")
    print("SET FOREIGN_KEY_CHECKS = 0;")
    # projects first: users.project_id references it
    for table in sorted(kept, key=lambda t: (t != "projects", t)):
        for row in out:
            if row.startswith("INSERT INTO `%s`" % table):
                print(row)
    print("SET FOREIGN_KEY_CHECKS = 1;")

    for table, n in sorted(kept.items()):
        print("-- kept %-15s %d row(s)" % (table, n), file=sys.stderr)
    for table, n in sorted(skipped.items()):
        print("-- skipped %-12s %d row(s)" % (table, n), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
