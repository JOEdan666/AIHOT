-- Topic digest: what happened in a topic over the last seven days, written from its selected items.
-- One row per rewrite; the page reads the latest. Inputs are recorded so an unchanged set is not rewritten.
CREATE TABLE topic_digests (
  topic_slug   text NOT NULL REFERENCES topics (slug) ON DELETE CASCADE,
  version      integer NOT NULL,
  headline     text NOT NULL,
  digest       text NOT NULL,
  window_from  timestamptz NOT NULL,
  window_to    timestamptz NOT NULL,
  article_ids  text[] NOT NULL,
  inputs_hash  text NOT NULL,
  receipt_id   bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_slug, version)
);
