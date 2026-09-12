-- CBD-116-FX-03. Names its expand step, but records the deployment that
-- removed the last reader as prose rather than as a version.
-- contract-step: yes
-- completes-expand: 20260101T000000Z__add_role
-- last-reader-removed-in: last week's release
ALTER TABLE budget_space_member DROP COLUMN legacy_role;
