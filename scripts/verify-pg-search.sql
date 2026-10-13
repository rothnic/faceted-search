-- Run only against a disposable test database with shared_preload_libraries=pg_search.
-- Everything here is rolled back, including the fixture schema and new extensions.
\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_search;
SELECT version();
SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pg_search') ORDER BY extname;
CREATE SCHEMA parade_smoke;
SET LOCAL search_path TO parade_smoke, public;
CREATE TABLE houses (id text PRIMARY KEY, price integer NOT NULL, embedding vector(3));
CREATE TABLE documents (house_id text PRIMARY KEY REFERENCES houses(id), search_text text NOT NULL, tags text[]);
-- These tiny fixture vectors test SQL plumbing, not a semantic model.
INSERT INTO houses VALUES ('a',500,'[1,0,0]'),('b',400,'[0.8,0.2,0]'),('c',300,'[0,0,1]');
INSERT INTO documents VALUES
 ('a','walkable family home near park',ARRAY['walkable','family friendly']),
 ('b','family garden house',ARRAY['garden','family friendly']),
 ('c','downtown apartment',ARRAY['city','apartment']);
CREATE INDEX documents_bm25 ON documents USING paradedb ((house_id::pdb.literal), search_text, (tags::pdb.literal));

DO $$
DECLARE actual integer;
BEGIN
  SELECT count(*) INTO actual FROM documents WHERE search_text ||| 'family';
  IF actual <> 2 THEN RAISE EXCEPTION 'BM25 match-any count: %', actual; END IF;
  SELECT count(*) INTO actual FROM documents WHERE search_text &&& 'family garden';
  IF actual <> 1 THEN RAISE EXCEPTION 'BM25 match-all count: %', actual; END IF;
  SELECT count(*) INTO actual FROM documents WHERE tags === 'family friendly';
  IF actual <> 2 THEN RAISE EXCEPTION 'Literal text-array matching count: %', actual; END IF;
END $$;

-- No ORDER BY is required for a real score-bearing search scan.
SELECT house_id, pdb.score(house_id) AS score FROM documents WHERE search_text ||| 'family';
DO $$
DECLARE positive_scores integer;
BEGIN
  WITH lexical AS MATERIALIZED (
    SELECT pdb.score(house_id) AS score FROM documents WHERE search_text ||| 'family'
  ) SELECT count(*) INTO positive_scores FROM lexical WHERE score > 0;
  IF positive_scores <> 2 THEN RAISE EXCEPTION 'Positive BM25 score count: %', positive_scores; END IF;
END $$;
PREPARE pg_search_smoke_query(text) AS
 SELECT house_id, pdb.score(house_id) AS score FROM documents WHERE search_text ||| $1::text ORDER BY score DESC, house_id;
EXECUTE pg_search_smoke_query('family (garden');
DEALLOCATE pg_search_smoke_query;

-- Isolate the score-bearing scan before joining ordinary relational/vector tables.
WITH lexical AS MATERIALIZED (
 SELECT house_id, pdb.score(house_id) AS raw_score FROM documents WHERE search_text ||| 'family'
)
SELECT h.id, raw_score, raw_score/(1+raw_score) AS normalized_score,
  1-(h.embedding <=> '[1,0,0]') AS cosine
FROM houses h LEFT JOIN lexical l ON l.house_id=h.id ORDER BY h.id;

EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
 SELECT house_id, pdb.score(house_id) AS score FROM documents
 WHERE search_text ||| 'family' ORDER BY score DESC, house_id LIMIT 2;

SAVEPOINT changed_document;
UPDATE documents SET search_text='new quartz bungalow' WHERE house_id='c';
DO $$ BEGIN
  IF (SELECT count(*) FROM documents WHERE search_text ||| 'quartz') <> 1 THEN
    RAISE EXCEPTION 'Search did not observe the transactional update';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT changed_document;
DO $$ BEGIN
  IF (SELECT count(*) FROM documents WHERE search_text ||| 'quartz') <> 0 THEN
    RAISE EXCEPTION 'Search did not observe the rollback';
  END IF;
END $$;
ROLLBACK;
