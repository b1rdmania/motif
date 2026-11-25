#!/usr/bin/env bash
# Usage stats from the wario-stats D1 database.
#   npm run stats          last 30 days
#   npm run stats -- 7     last 7 days
set -euo pipefail
DAYS="${1:-30}"
[[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "Days must be a number" >&2; exit 1; }
SINCE="strftime('%s','now','-${DAYS} days')"

q() {
  echo; echo "== $1"
  npx wrangler d1 execute wario-stats --remote --json --command "$2" \
    | node -e 'const r=JSON.parse(require("fs").readFileSync(0))[0].results; console.table(r)'
}

q "Events by type (last ${DAYS} days)" \
  "SELECT type, COUNT(*) AS events, COUNT(DISTINCT day||visitor) AS visitor_days FROM events WHERE ts >= ${SINCE} GROUP BY type ORDER BY events DESC"
q "Top played songs" \
  "SELECT song_id, MAX(title) AS title, COUNT(DISTINCT day||visitor) AS plays FROM events WHERE type='play' AND song_id IS NOT NULL AND ts >= ${SINCE} GROUP BY song_id ORDER BY plays DESC LIMIT 20"
q "Top searches" \
  "SELECT query, COUNT(*) AS searches, MIN(CAST(detail AS INTEGER)) AS min_results FROM events WHERE type='search' AND ts >= ${SINCE} GROUP BY query ORDER BY searches DESC LIMIT 20"
q "Searches with no results" \
  "SELECT query, COUNT(*) AS searches FROM events WHERE type='search' AND detail='0' AND ts >= ${SINCE} GROUP BY query ORDER BY searches DESC LIMIT 20"
q "Most shared songs" \
  "SELECT song_id, MAX(title) AS title, SUM(detail='link') AS link, SUM(detail='x') AS x, COUNT(*) AS total FROM events WHERE type='share' AND ts >= ${SINCE} GROUP BY song_id ORDER BY total DESC LIMIT 20"
q "Opens from shared links and the chart" \
  "SELECT detail AS via, page, COUNT(*) AS opens FROM events WHERE type='open' AND ts >= ${SINCE} GROUP BY detail, page ORDER BY opens DESC"
q "Plays per day" \
  "SELECT day, COUNT(*) AS plays, COUNT(DISTINCT visitor) AS visitors FROM events WHERE type='play' AND ts >= ${SINCE} GROUP BY day ORDER BY day DESC"
