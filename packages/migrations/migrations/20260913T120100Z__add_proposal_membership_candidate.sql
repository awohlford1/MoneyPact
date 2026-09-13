-- CBD233-IMPL-003: retain both server-owned bootstrap identifiers across retries.
ALTER TABLE budget_creation_proposal
    ADD COLUMN candidate_primary_membership_id uuid NOT NULL DEFAULT gen_random_uuid();
