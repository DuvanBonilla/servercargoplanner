-- Añade índices en columnas de llave foránea que no tenían ninguno.
-- NOTA PARA PRODUCCIÓN: no correr esta migración con `prisma migrate deploy`
-- contra la base de datos productiva mientras esté bajo carga alta, ya que
-- CREATE INDEX (sin CONCURRENTLY) toma un lock que bloquea escrituras en la
-- tabla mientras se construye. Para producción usa en su lugar
-- prisma/manual-sql/2026-07-21-add-missing-indexes.sql (usa CONCURRENTLY) y
-- luego marca esta migración como aplicada con:
--   npx prisma migrate resolve --applied 20260721120000_add_fk_indexes
-- Para entornos de desarrollo/staging con poco tráfico, esta migración
-- normal es suficiente.

CREATE INDEX IF NOT EXISTS "User_id_site_idx" ON "User"("id_site");
CREATE INDEX IF NOT EXISTS "User_id_subsite_idx" ON "User"("id_subsite");

CREATE INDEX IF NOT EXISTS "JobArea_id_user_idx" ON "JobArea"("id_user");
CREATE INDEX IF NOT EXISTS "JobArea_id_site_idx" ON "JobArea"("id_site");
CREATE INDEX IF NOT EXISTS "JobArea_id_subsite_idx" ON "JobArea"("id_subsite");

CREATE INDEX IF NOT EXISTS "Zone_id_user_idx" ON "Zone"("id_user");
CREATE INDEX IF NOT EXISTS "Zone_id_site_idx" ON "Zone"("id_site");
CREATE INDEX IF NOT EXISTS "Zone_id_subsite_idx" ON "Zone"("id_subsite");

CREATE INDEX IF NOT EXISTS "Worker_id_area_idx" ON "Worker"("id_area");
CREATE INDEX IF NOT EXISTS "Worker_id_user_idx" ON "Worker"("id_user");
CREATE INDEX IF NOT EXISTS "Worker_id_site_idx" ON "Worker"("id_site");
CREATE INDEX IF NOT EXISTS "Worker_id_subsite_idx" ON "Worker"("id_subsite");

CREATE INDEX IF NOT EXISTS "Operation_id_user_idx" ON "Operation"("id_user");
CREATE INDEX IF NOT EXISTS "Operation_id_area_idx" ON "Operation"("id_area");
CREATE INDEX IF NOT EXISTS "Operation_id_task_idx" ON "Operation"("id_task");
CREATE INDEX IF NOT EXISTS "Operation_id_client_idx" ON "Operation"("id_client");
CREATE INDEX IF NOT EXISTS "Operation_id_clientProgramming_idx" ON "Operation"("id_clientProgramming");
CREATE INDEX IF NOT EXISTS "Operation_id_zone_idx" ON "Operation"("id_zone");
CREATE INDEX IF NOT EXISTS "Operation_id_site_idx" ON "Operation"("id_site");
CREATE INDEX IF NOT EXISTS "Operation_id_subsite_idx" ON "Operation"("id_subsite");
CREATE INDEX IF NOT EXISTS "Operation_status_id_site_id_subsite_idx" ON "Operation"("status", "id_site", "id_subsite");

CREATE INDEX IF NOT EXISTS "Operation_Worker_id_operation_idx" ON "Operation_Worker"("id_operation");
CREATE INDEX IF NOT EXISTS "Operation_Worker_id_worker_idx" ON "Operation_Worker"("id_worker");
CREATE INDEX IF NOT EXISTS "Operation_Worker_id_task_idx" ON "Operation_Worker"("id_task");
CREATE INDEX IF NOT EXISTS "Operation_Worker_id_subtask_idx" ON "Operation_Worker"("id_subtask");
CREATE INDEX IF NOT EXISTS "Operation_Worker_id_tariff_idx" ON "Operation_Worker"("id_tariff");

CREATE INDEX IF NOT EXISTS "Task_id_user_idx" ON "Task"("id_user");
CREATE INDEX IF NOT EXISTS "Task_id_site_idx" ON "Task"("id_site");
CREATE INDEX IF NOT EXISTS "Task_id_subsite_idx" ON "Task"("id_subsite");

CREATE INDEX IF NOT EXISTS "SubTask_id_task_idx" ON "SubTask"("id_task");
CREATE INDEX IF NOT EXISTS "SubTask_id_subsite_idx" ON "SubTask"("id_subsite");
CREATE INDEX IF NOT EXISTS "SubTask_id_client_idx" ON "SubTask"("id_client");

CREATE INDEX IF NOT EXISTS "Client_id_user_idx" ON "Client"("id_user");

CREATE INDEX IF NOT EXISTS "CalledAttention_id_user_idx" ON "CalledAttention"("id_user");

CREATE INDEX IF NOT EXISTS "InChargeOperation_id_operation_idx" ON "InChargeOperation"("id_operation");
CREATE INDEX IF NOT EXISTS "InChargeOperation_id_user_idx" ON "InChargeOperation"("id_user");

CREATE INDEX IF NOT EXISTS "WorkerFeeding_id_worker_idx" ON "WorkerFeeding"("id_worker");
CREATE INDEX IF NOT EXISTS "WorkerFeeding_id_operation_idx" ON "WorkerFeeding"("id_operation");
CREATE INDEX IF NOT EXISTS "WorkerFeeding_id_user_idx" ON "WorkerFeeding"("id_user");
CREATE INDEX IF NOT EXISTS "WorkerFeeding_dateFeeding_idx" ON "WorkerFeeding"("dateFeeding");

CREATE INDEX IF NOT EXISTS "Inability_id_worker_idx" ON "Inability"("id_worker");
CREATE INDEX IF NOT EXISTS "Inability_id_user_idx" ON "Inability"("id_user");

CREATE INDEX IF NOT EXISTS "Permission_id_worker_idx" ON "Permission"("id_worker");
CREATE INDEX IF NOT EXISTS "Permission_id_user_idx" ON "Permission"("id_user");

CREATE INDEX IF NOT EXISTS "ClientProgramming_id_user_idx" ON "ClientProgramming"("id_user");
CREATE INDEX IF NOT EXISTS "ClientProgramming_id_site_idx" ON "ClientProgramming"("id_site");
CREATE INDEX IF NOT EXISTS "ClientProgramming_id_subsite_idx" ON "ClientProgramming"("id_subsite");

CREATE INDEX IF NOT EXISTS "SubSite_id_site_idx" ON "SubSite"("id_site");

CREATE INDEX IF NOT EXISTS "CostCenter_id_user_idx" ON "CostCenter"("id_user");
CREATE INDEX IF NOT EXISTS "CostCenter_id_client_idx" ON "CostCenter"("id_client");
CREATE INDEX IF NOT EXISTS "CostCenter_id_subsite_idx" ON "CostCenter"("id_subsite");

CREATE INDEX IF NOT EXISTS "UnitOfMeasure_id_user_idx" ON "UnitOfMeasure"("id_user");

CREATE INDEX IF NOT EXISTS "Tariff_id_subtask_idx" ON "Tariff"("id_subtask");
CREATE INDEX IF NOT EXISTS "Tariff_id_costCenter_idx" ON "Tariff"("id_costCenter");
CREATE INDEX IF NOT EXISTS "Tariff_id_unidOfMeasure_idx" ON "Tariff"("id_unidOfMeasure");
CREATE INDEX IF NOT EXISTS "Tariff_id_facturation_unit_idx" ON "Tariff"("id_facturation_unit");
CREATE INDEX IF NOT EXISTS "Tariff_id_user_idx" ON "Tariff"("id_user");

CREATE INDEX IF NOT EXISTS "Configuration_id_user_idx" ON "Configuration"("id_user");

CREATE INDEX IF NOT EXISTS "Bill_id_operation_idx" ON "Bill"("id_operation");
CREATE INDEX IF NOT EXISTS "Bill_id_user_idx" ON "Bill"("id_user");
CREATE INDEX IF NOT EXISTS "Bill_id_group_idx" ON "Bill"("id_group");

CREATE INDEX IF NOT EXISTS "BillDetail_id_bill_idx" ON "BillDetail"("id_bill");
CREATE INDEX IF NOT EXISTS "BillDetail_id_operation_worker_idx" ON "BillDetail"("id_operation_worker");

CREATE INDEX IF NOT EXISTS "Token_id_confirmation_idx" ON "Token"("id_confirmation");
