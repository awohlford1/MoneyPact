-- CBD-116-FX-17. The contract half of an expand-and-contract pair, carrying
-- the header CBD-116-AC04 requires.
-- contract-step: yes
-- completes-expand: 20260101T000000Z__create_plan_line
-- last-reader-removed-in: v0.4.2
ALTER TABLE budget_space_plan_line DROP COLUMN superseded_at;
