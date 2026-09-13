-- CBD233-NAME-BOUND-001: the approved name rule counts grapheme clusters
-- (CBD-231 section 9 correction, applied by CBD-233 confirmation), which
-- PostgreSQL cannot count. The application rule (1..100 graphemes) is
-- authoritative; the database keeps a code-point ceiling as defence in depth,
-- widened so that a valid 100-grapheme name with combining sequences no
-- longer fails at COMMIT. btrim and non-empty checks are unchanged.
-- scope: budget-space
DO $$
DECLARE
    existing text;
BEGIN
    SELECT conname INTO existing
    FROM pg_constraint
    WHERE conrelid = 'budget_space'::regclass
      AND pg_get_constraintdef(oid) LIKE '%char_length(name)%';
    IF existing IS NOT NULL THEN
        EXECUTE format('ALTER TABLE budget_space DROP CONSTRAINT %I', existing);
    END IF;
END
$$;

ALTER TABLE budget_space
    ADD CONSTRAINT budget_space_name_code_point_bound
    CHECK (char_length(name) BETWEEN 1 AND 400);
