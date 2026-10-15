-- User IDs become unique across the whole platform (they were numbered per school, so every
-- school's first admin was ADM-<year>-0001 and sign-in by User ID on the main /login was ambiguous).

BEGIN;

-- One counter per prefix and year for every school (no RLS: it holds no school data).
CREATE TABLE "login_id_counters" (
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL,
    CONSTRAINT "login_id_counters_pkey" PRIMARY KEY ("prefix", "year")
);

-- Every User ID this migration changed, so the people can be told their new ID.
CREATE TABLE "login_id_renames" (
    "user_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "old_login_id" TEXT NOT NULL,
    "new_login_id" TEXT NOT NULL,
    "notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_id_renames_pkey" PRIMARY KEY ("user_id")
);

INSERT INTO "login_id_counters" ("prefix", "year", "last_seq")
SELECT "prefix", "year", MAX("seq") FROM "login_ids" GROUP BY "prefix", "year";

-- Duplicates: the earliest login keeps its ID, every later one gets the next free number.
CREATE TEMP TABLE "_renames" AS
WITH ranked AS (
  SELECT u."id", u."school_id", u."login_id", l."prefix", l."year",
         ROW_NUMBER() OVER (PARTITION BY u."login_id" ORDER BY u."created_at", u."id") AS holder
  FROM "users" u JOIN "login_ids" l ON l."user_id" = u."id"
), losers AS (
  SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r."prefix", r."year" ORDER BY r."login_id", r."holder") AS n
  FROM ranked r WHERE r."holder" > 1
)
SELECT lo."id" AS user_id, lo."school_id", lo."login_id" AS old_login_id, lo."prefix", lo."year",
       c."last_seq" + lo."n" AS seq,
       lo."prefix" || '-' || lo."year" || '-' || LPAD((c."last_seq" + lo."n")::text, 4, '0') AS new_login_id
FROM losers lo JOIN "login_id_counters" c ON c."prefix" = lo."prefix" AND c."year" = lo."year";

ALTER TABLE "users" DISABLE TRIGGER "users_login_id_immutable";
UPDATE "users" u SET "login_id" = r.new_login_id FROM "_renames" r WHERE u."id" = r.user_id;
ALTER TABLE "users" ENABLE TRIGGER "users_login_id_immutable";
ALTER TABLE "login_ids" DISABLE TRIGGER "login_ids_append_only";
UPDATE "login_ids" l SET "login_id" = r.new_login_id, "seq" = r.seq FROM "_renames" r WHERE l."user_id" = r.user_id;
ALTER TABLE "login_ids" ENABLE TRIGGER "login_ids_append_only";
UPDATE "teachers" t SET "login_id" = r.new_login_id FROM "_renames" r WHERE t."user_id" = r.user_id;
UPDATE "non_teaching_staff" s SET "login_id" = r.new_login_id FROM "_renames" r WHERE s."user_id" = r.user_id;
INSERT INTO "login_id_renames" ("user_id", "school_id", "old_login_id", "new_login_id")
SELECT user_id, school_id, old_login_id, new_login_id FROM "_renames";

UPDATE "login_id_counters" c SET "last_seq" = m.seq
FROM (SELECT "prefix", "year", MAX("seq") AS seq FROM "login_ids" GROUP BY "prefix", "year") m
WHERE c."prefix" = m."prefix" AND c."year" = m."year";

-- Never again: one User ID, one login, platform-wide.
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");
CREATE UNIQUE INDEX "login_ids_login_id_key" ON "login_ids"("login_id");

DROP TABLE "_renames";

COMMIT;
