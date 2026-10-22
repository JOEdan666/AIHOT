-- Inspiration notebook: the owner's own judgments on items, and a weekly review built from them.
-- Private to whoever wrote them (owner is "admin:<id>" today; reader accounts can use their own prefix later).
-- Nothing here is part of any public exit.
CREATE TABLE notes (
  id          bigserial PRIMARY KEY,
  owner       text NOT NULL,
  article_id  text REFERENCES articles (id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('thought', 'changed_mind', 'objection')),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_owner_created ON notes (owner, created_at DESC);
CREATE INDEX notes_article ON notes (article_id);

-- One review per owner and week (Monday, Beijing time). Regenerating refreshes the lists and the
-- model's connections; the next action is kept once the owner has edited or ticked it.
CREATE TABLE weekly_reviews (
  owner          text NOT NULL,
  week_start     date NOT NULL,
  recurring      jsonb NOT NULL,
  changed        jsonb NOT NULL,
  objections     jsonb NOT NULL,
  connections    jsonb NOT NULL DEFAULT '[]',
  next_action    text NOT NULL,
  action_edited  boolean NOT NULL DEFAULT false,
  action_done    boolean NOT NULL DEFAULT false,
  receipt_id     bigint,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, week_start)
);
