UPDATE "Operation" o
SET id_zone = z.id
FROM "Zone" z
WHERE z.name = o.zone::text
  AND z.id_site = o.id_site
  AND o.zone IS NOT NULL
  AND o.zone <> 0;