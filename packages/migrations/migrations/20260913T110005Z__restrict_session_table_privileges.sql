-- CBD-191 correction round (CBD191-SECURITY-002 finding 5, Manager ruling
-- CBD191-CORRECTION-001 item 2): the default privileges granted by
-- 20260912T170000Z__grant_application_roles.sql give both cobudget_api and
-- cobudget_worker SELECT/INSERT/UPDATE/DELETE on every table, including the
-- five CBD-191 identity tables this migration wave adds. That is far broader
-- than either role needs and lets the worker read session selectors,
-- verifier/CSRF digests, and sealed delivery envelopes it has no reason to
-- see.
--
-- This migration revokes the inherited default grants on all five tables
-- and re-grants exactly the operations each role's own code path in
-- packages/sessions performs:
--
--   * cobudget_worker only ever claims and updates revocation_outbox rows
--     (the drain job). It gets no access at all to account_session,
--     account_subject_authority, session_delivery_result, or
--     provider_security_event -- in particular, no access whatsoever to the
--     session/verifier/envelope secrets CBD-191 SS3.1 restricts.
--   * cobudget_api issues, resolves, and rotates sessions; bumps the subject
--     authority; records provider events; and enqueues (but does not claim
--     or complete) outbox actions. It never deletes from any of these
--     tables (DELETE was already revoked per-table by the CREATE TABLE
--     migrations; restated here for completeness now that the broad grant
--     itself is revoked).
--
-- This is table-grain least privilege, not the security-definer-function
-- design Security's finding also floats as an alternative ("or
-- security-definer function capabilities"); that is a deeper architectural
-- change this correction round does not attempt. Table grants are the
-- documented, provable-with-psql mechanism this migration delivers.

REVOKE ALL ON account_session FROM cobudget_worker, cobudget_api;
REVOKE ALL ON account_subject_authority FROM cobudget_worker, cobudget_api;
REVOKE ALL ON session_delivery_result FROM cobudget_worker, cobudget_api;
REVOKE ALL ON provider_security_event FROM cobudget_worker, cobudget_api;
REVOKE ALL ON revocation_outbox FROM cobudget_worker, cobudget_api;

-- cobudget_worker: revocation_outbox claim/attempt bookkeeping only.
GRANT SELECT, UPDATE ON revocation_outbox TO cobudget_worker;

-- cobudget_api: issuance, resolution, rotation, revocation, and provider-event
-- ingestion. No DELETE anywhere; no access to revocation_outbox beyond
-- enqueuing (claim/attempt state is the worker's job).
GRANT SELECT, INSERT, UPDATE ON account_session TO cobudget_api;
GRANT SELECT, INSERT, UPDATE ON account_subject_authority TO cobudget_api;
GRANT SELECT, INSERT, UPDATE ON session_delivery_result TO cobudget_api;
GRANT SELECT, INSERT, UPDATE ON provider_security_event TO cobudget_api;
GRANT SELECT, INSERT ON revocation_outbox TO cobudget_api;
