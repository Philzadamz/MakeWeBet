-- Ledger guards: the database itself enforces double-entry invariants,
-- so even a buggy code path (or a rogue SQL session) cannot corrupt money.

-- 1. Journal tables are append-only.
CREATE OR REPLACE FUNCTION forbid_journal_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % on % is forbidden', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_append_only
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION forbid_journal_mutation();

CREATE TRIGGER journal_lines_append_only
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION forbid_journal_mutation();

-- 2. Every journal entry's lines must sum to zero, checked at COMMIT
--    (deferred), so multi-line inserts within a transaction are fine.
CREATE OR REPLACE FUNCTION check_journal_balance() RETURNS trigger AS $$
DECLARE
  line_sum BIGINT;
BEGIN
  SELECT COALESCE(SUM("amountMinor"), 0) INTO line_sum
  FROM "journal_lines"
  WHERE "entryId" = NEW."entryId";

  IF line_sum <> 0 THEN
    RAISE EXCEPTION 'journal entry % is unbalanced (sum = %)', NEW."entryId", line_sum;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
