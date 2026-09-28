-- A case must always keep at least one admin. Enforced in Postgres, so it also holds for edits made
-- directly in Directus and for any future client. The app checks the same rule and gives a friendly
-- error first; this is the backstop.
--
-- Apply (Directus host):
--   docker exec -i directus-test-db psql -U <db user> <db name> < directus/sql/case-keep-one-admin.sql
-- A schema snapshot does not carry triggers, so run this on every Directus server.

CREATE OR REPLACE FUNCTION case_keep_one_admin() RETURNS trigger AS $$
BEGIN
    -- Only an admin row that stops being an admin on that case matters: deleted, demoted or moved.
    IF OLD.role = 'admin'
       AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'admin' OR NEW.case_id IS DISTINCT FROM OLD.case_id)
    THEN
        -- Deleting the case itself cascades to its rows; that is allowed.
        IF EXISTS (SELECT 1 FROM "case" WHERE id = OLD.case_id)
           AND NOT EXISTS (
               SELECT 1 FROM case_directus_users
               WHERE case_id = OLD.case_id AND role = 'admin' AND id <> OLD.id
           )
        THEN
            RAISE EXCEPTION 'A case must keep at least one admin (case %)', OLD.case_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS case_keep_one_admin ON case_directus_users;
CREATE TRIGGER case_keep_one_admin
    BEFORE UPDATE OR DELETE ON case_directus_users
    FOR EACH ROW EXECUTE FUNCTION case_keep_one_admin();
