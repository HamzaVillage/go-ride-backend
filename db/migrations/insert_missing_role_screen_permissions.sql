-- Apply only after can_view, can_add, can_edit and can_delete exist.
-- Add missing rows with NO rights; preserve all existing assignments/grants.
INSERT INTO assign_role_function
    (role_id, function_id, can_view, can_add, can_edit, can_delete)
SELECT r.role_id, f.function_id, 0, 0, 0, 0
FROM employee_role AS r
CROSS JOIN employee_function AS f
WHERE r.is_deleted = 0
  AND f.is_deleted = 0
  AND NOT EXISTS (
      SELECT 1 FROM assign_role_function AS existing
      WHERE existing.role_id = r.role_id
        AND existing.function_id = f.function_id
  );
