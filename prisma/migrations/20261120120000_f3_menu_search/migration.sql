-- F3: menu search.
--   * unaccent, and a text search configuration that ignores accents, case and English stop
--     words, so "pho" finds "Phở Bò" and "the" alone searches for nothing
--   * a generated search document on menu_items (title, cuisine name, description), GIN indexed
--   * a trigram index on the accent-free title, for "did you mean" suggestions
--
-- unaccent is a trusted extension, but the migrator has no CREATE right on the database, so the
-- database init script installs it as the superuser (docker/postgres/init/01-roles.sh). On a
-- hosted database the owner role can create it; there this statement does the work.
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- unaccent() is STABLE because its rules file could in principle change; generated columns and
-- index expressions need an IMMUTABLE function. The rules are fixed for a database, so this
-- wrapper may promise it. Both the function and the dictionary are named with their schema, so
-- the search path cannot swap them.
CREATE OR REPLACE FUNCTION foodz_unaccent(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, value) $$;

-- Words are matched as typed (no stemming), without accents or case. English stop words are
-- dropped, so a query of only "the" or "and" has nothing to search for.
CREATE TEXT SEARCH DICTIONARY foodz_simple (TEMPLATE = pg_catalog.simple, STOPWORDS = english);

CREATE TEXT SEARCH CONFIGURATION foodz_search (COPY = pg_catalog.simple);
ALTER TEXT SEARCH CONFIGURATION foodz_search
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart WITH foodz_simple;
ALTER TEXT SEARCH CONFIGURATION foodz_search
  ALTER MAPPING FOR word, hword, hword_part, numword, numhword, hword_numpart
  WITH unaccent, foodz_simple;

-- Title weighs most, then the cuisine name ("korean" finds every Korean dish), then the
-- description. The cuisine is spelled out here because enum-to-text casts are not immutable.
ALTER TABLE "menu_items"
  ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('public.foodz_search'::regconfig, "title"), 'A')
    || setweight(
      to_tsvector(
        'public.foodz_search'::regconfig,
        CASE "cuisine"
          WHEN 'KOREAN' THEN 'Korean'
          WHEN 'THAI' THEN 'Thai'
          WHEN 'VIETNAMESE' THEN 'Vietnamese'
          ELSE ''
        END
      ),
      'B'
    )
    || setweight(to_tsvector('public.foodz_search'::regconfig, "description"), 'C')
  ) STORED;

CREATE INDEX "menu_items_search_vector_idx" ON "menu_items" USING GIN ("search_vector");

-- The trigram index now covers the accent-free title instead of the raw one. Prisma can't
-- describe an expression index, so it lives only here (and Prisma leaves it alone).
DROP INDEX IF EXISTS "menu_items_title_idx";
CREATE INDEX "menu_items_title_unaccent_trgm_idx" ON "menu_items"
  USING GIN (foodz_unaccent("title") gin_trgm_ops);
