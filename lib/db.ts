/**
 * Database layer barrel.
 *
 * The implementation lives in lib/db/:
 *   connection.ts        getDb, pragmas, DB_FILE, test hooks
 *   types.ts             row types for every table
 *   schema/core.ts       SCHEMA_VERSION, initSchema, core + Phase-4 DDL
 *   schema/entity.ts     canonical UUID entity layer
 *   schema/safety.ts     HACCP + CO/federal labor tables
 *   schema/management.ts management surfaces (PINs, reviews, KPIs)
 *   migrations.ts        additive ALTERs, indexes, default-location seed
 *   assertions.ts        schema-drift guard
 *   queries.ts           small shared read helpers
 *
 * Import from `@/lib/db` as before — this module re-exports the whole
 * public surface, so call sites did not change in the split.
 */

export {
  _resolveDbPathForTest,
  setDbPathForTest,
  getDb,
  DB_FILE,
} from './db/connection.ts';

export { SCHEMA_VERSION, initSchema } from './db/schema/core.ts';

export {
  todayISO,
  getServiceHours,
  todayServiceLabel,
  getPreshiftNote,
} from './db/queries.ts';

export type {
  LineCheckEntry,
  StationSignoff,
  EightySix,
  InventoryUpdate,
  Location,
  VendorPrice,
  PackSizeChange,
  RecipeCost,
  DishComponent,
  BomLine,
  IngredientMaster,
  IngredientDensity,
  IngredientYield,
  IngestRun,
  SalesLine,
  SpendMonthly,
  BeoEvent,
  BeoTask,
  BeoLineItem,
  Equipment,
  EquipmentMaintenance,
  EquipmentPart,
  EquipmentMaintenanceSchedule,
  GoldStar,
  PerformanceReview,
  TempLogEntry,
  ToastSalesDailyRow,
  ToastSalesDowRow,
  ToastSalesHourRow,
  CoolingLogEntry,
  DateMark,
  ReceivingEntry,
  SanitizerCheck,
  SickWorkerReport,
  ShiftPic,
  PreshiftNote,
  ServiceHoursRow,
  CleaningScheduleItem,
  CleaningLogEntry,
  PestControlEntry,
  ThermometerCalibration,
  TphcEntry,
  SdsEntry,
  ShiftBreak,
  PaidSickLeaveBalance,
  StaffCertification,
  TipPoolDistribution,
  StaffFlag,
  WageNotice,
  EmployeeHealthAcknowledgment,
  DishCoverageSnapshot,
  AuditEvent,
} from './db/types.ts';
