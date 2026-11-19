-- Lecturers may edit student records (e.g. correct a misspelt name), and get
-- the read permissions the seed's role matrix always intended for them.
--
-- Production's role permissions were seeded once, long ago; the seed never
-- runs on deploy, so later additions to the LECTURER matrix (program:read,
-- among others) never reached it — which left the student form's required
-- Program list empty for lecturers. This grants them idempotently: missing
-- permission rows are created, and existing grants are left alone.

INSERT INTO "permissions" ("id", "code", "resource", "action")
SELECT gen_random_uuid()::text, r || ':' || a, r, a
FROM (VALUES
  ('student', 'update'),
  ('student', 'read'), ('lecturer', 'read'), ('subject', 'read'), ('course', 'read'),
  ('room', 'read'), ('building', 'read'), ('department', 'read'), ('program', 'read')
) AS p(r, a)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT ro."id", pe."id"
FROM "roles" ro
JOIN "permissions" pe ON pe."code" IN (
  'student:update',
  'student:read', 'lecturer:read', 'subject:read', 'course:read',
  'room:read', 'building:read', 'department:read', 'program:read'
)
WHERE ro."code" = 'LECTURER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
