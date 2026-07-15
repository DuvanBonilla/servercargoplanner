INSERT INTO "Zone" (name, id_site, id_user, status)
SELECT
  o.zone::text AS name,
  o.id_site,
  MIN(o.id_user) AS id_user,
  'ACTIVE'
FROM "Operation" o
WHERE o.zone IS NOT NULL AND o.zone <> 0
GROUP BY o.zone, o.id_site;