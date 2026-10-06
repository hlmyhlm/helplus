-- agent was renamed staff; editor never matched a permission, treat it as staff too
UPDATE "Admin" SET "role" = 'staff' WHERE "role" IN ('agent', 'editor');

-- the earliest admin of each company becomes its owner
UPDATE "Admin" SET "role" = 'owner'
WHERE "id" IN (
  SELECT DISTINCT ON ("companyId") "id" FROM "Admin"
  WHERE "role" = 'admin'
  ORDER BY "companyId", "createdAt"
);
