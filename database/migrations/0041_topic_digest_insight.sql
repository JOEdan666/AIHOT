-- Topic digest: one line on what a builder could take from the week (and whether it carries over to
-- China). Empty when the model saw nothing worth saying; older rows have none.
ALTER TABLE topic_digests ADD COLUMN insight text;
