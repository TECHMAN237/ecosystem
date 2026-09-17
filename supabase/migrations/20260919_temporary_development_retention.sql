-- ==============================================================================
-- RAYDAR TEMPORARY DEVELOPMENT RETENTION POLICY
-- TARGET: public.missing_reports (MAX 4), public.found_reports (MAX 4)
-- ==============================================================================
-- NOTE: This rule is strictly intended for the current development and testing
-- environment to minimize database and storage egress before moving to a higher
-- production plan. It is NOT the final permanent business rule of RAYDAR.
-- ==============================================================================

-- 1. Helper function to inspect surplus reports older than retention limit
CREATE OR REPLACE FUNCTION public.get_retention_candidates(
    p_report_type TEXT,
    p_max_retained INT DEFAULT 4
)
RETURNS TABLE (
    id UUID,
    child_full_name TEXT,
    child_photo_url TEXT,
    created_at TIMESTAMPTZ,
    row_num BIGINT,
    total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total BIGINT;
BEGIN
    IF p_report_type = 'missing' THEN
        SELECT COUNT(*) INTO v_total FROM public.missing_reports;
        IF v_total <= p_max_retained THEN
            RETURN;
        END IF;

        RETURN QUERY
        WITH numbered AS (
            SELECT 
                m.id, 
                m.child_full_name, 
                m.child_photo_url, 
                m.created_at, 
                ROW_NUMBER() OVER (ORDER BY m.created_at ASC, m.id ASC) AS rn
            FROM public.missing_reports m
        )
        SELECT 
            n.id, 
            n.child_full_name, 
            n.child_photo_url, 
            n.created_at, 
            n.rn,
            v_total
        FROM numbered n
        WHERE n.rn <= (v_total - p_max_retained);

    ELSIF p_report_type = 'found' THEN
        SELECT COUNT(*) INTO v_total FROM public.found_reports;
        IF v_total <= p_max_retained THEN
            RETURN;
        END IF;

        RETURN QUERY
        WITH numbered AS (
            SELECT 
                f.id, 
                f.child_full_name, 
                f.child_photo_url, 
                f.created_at, 
                ROW_NUMBER() OVER (ORDER BY f.created_at ASC, f.id ASC) AS rn
            FROM public.found_reports f
        )
        SELECT 
            n.id, 
            n.child_full_name, 
            n.child_photo_url, 
            n.created_at, 
            n.rn,
            v_total
        FROM numbered n
        WHERE n.rn <= (v_total - p_max_retained);
    END IF;
END;
$$;

-- 2. PostgreSQL RPC function to delete surplus database rows beyond retention limit
CREATE OR REPLACE FUNCTION public.enforce_development_report_retention(
    p_report_type TEXT,
    p_max_retained INT DEFAULT 4
)
RETURNS TABLE (
    deleted_id UUID,
    deleted_child_name TEXT,
    deleted_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total BIGINT;
    v_surplus BIGINT;
BEGIN
    IF p_report_type = 'missing' THEN
        SELECT COUNT(*) INTO v_total FROM public.missing_reports;
        v_surplus := v_total - p_max_retained;
        
        IF v_surplus > 0 THEN
            RETURN QUERY
            WITH surplus_rows AS (
                SELECT m.id
                FROM public.missing_reports m
                ORDER BY m.created_at ASC, m.id ASC
                LIMIT v_surplus
            )
            DELETE FROM public.missing_reports
            WHERE id IN (SELECT id FROM surplus_rows)
            RETURNING id, child_full_name, created_at;
        END IF;

    ELSIF p_report_type = 'found' THEN
        SELECT COUNT(*) INTO v_total FROM public.found_reports;
        v_surplus := v_total - p_max_retained;

        IF v_surplus > 0 THEN
            RETURN QUERY
            WITH surplus_rows AS (
                SELECT f.id
                FROM public.found_reports f
                ORDER BY f.created_at ASC, f.id ASC
                LIMIT v_surplus
            )
            DELETE FROM public.found_reports
            WHERE id IN (SELECT id FROM surplus_rows)
            RETURNING id, child_full_name, created_at;
        END IF;
    END IF;
END;
$$;

-- Grant execute permissions to service role and authenticated users
GRANT EXECUTE ON FUNCTION public.get_retention_candidates(TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_development_report_retention(TEXT, INT) TO service_role;
