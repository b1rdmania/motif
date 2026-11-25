-- Usage events for wario.style (2.1.0).
-- No IP addresses are stored. `visitor` is an HMAC of IP + user agent keyed
-- with the STATS_SALT secret and the UTC day, so it changes every day and
-- cannot link one person across days.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,          -- unix seconds
  day TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  type TEXT NOT NULL,           -- search | play | share | open | save
  song_id TEXT,                 -- BitMidi id, when there is one
  title TEXT,
  query TEXT,                   -- search text (lower case)
  detail TEXT,                  -- search: result count; share: link | x; play: bitmidi | url | upload; open: link | top
  page TEXT,                    -- home | play
  visitor TEXT NOT NULL
);
CREATE INDEX events_type_ts ON events (type, ts);
CREATE INDEX events_song ON events (song_id, type, ts);
