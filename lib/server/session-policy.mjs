export const SESSION_HOURS = 12;
export const SESSION_IDLE_MINUTES = 30;

export const SESSION_USER_QUERY = `
  WITH active_session AS (
    SELECT s.id AS session_id,
           u.id, u.clinic_id, u.branch_id, u.name, u.username, u.phone, u.role,
           u.permissions, u.active, u.must_change_password,
           c.name AS clinic_name, c.slug AS clinic_slug,
           b.name AS branch_name
      FROM app_sessions s
      JOIN app_users u ON u.id = s.user_id AND u.clinic_id = s.clinic_id
      JOIN clinics c ON c.id = s.clinic_id
      LEFT JOIN branches b ON b.id = u.branch_id AND b.clinic_id = u.clinic_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND s.last_seen_at > now() - interval '${SESSION_IDLE_MINUTES} minutes'
       AND u.active = TRUE
     LIMIT 1
  ), touch_session AS (
    UPDATE app_sessions s
       SET last_seen_at = now()
      FROM active_session a
     WHERE s.id = a.session_id
       AND s.last_seen_at <= now() - interval '1 minute'
    RETURNING s.id
  )
  SELECT id, clinic_id, branch_id, name, username, phone, role,
         permissions, active, must_change_password, clinic_name, clinic_slug, branch_name
    FROM active_session
`;
