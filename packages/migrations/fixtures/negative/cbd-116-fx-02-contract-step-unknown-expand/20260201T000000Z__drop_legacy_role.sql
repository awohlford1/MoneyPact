-- CBD-116-FX-02. Carries every required header key, but names an expand
-- migration that does not exist. A header that cannot be checked against the
-- directory is a header that can say anything.
-- contract-step: yes
-- completes-expand: 20250101T000000Z__no_such_migration
-- last-reader-removed-in: v1.2.3
ALTER TABLE budget_space_member DROP COLUMN legacy_role;
