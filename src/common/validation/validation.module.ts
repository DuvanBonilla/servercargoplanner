import { Module } from '@nestjs/common';
import { ValidationService } from './validation.service';
// import { ExcelExportService } from './services/excel-export.service';
import { ValidationWorkerService } from './services/validation-worker/validation-worker.service';
import { ValidationClientProgrammingService } from './services/validation-client-programming/validation-client-programming.service';
import { ValidationTaskAndSubtaskService } from './services/validation-task-and-subtask/validation-task-and-subtask.service';
import { ValidationUserSiteService } from './services/validation-user-site/validation-user-site.service';

@Module({
  providers: [
    ValidationService,
    // ExcelExportService,
    ValidationWorkerService,
    ValidationClientProgrammingService,
    ValidationTaskAndSubtaskService,
    ValidationUserSiteService
  ],
  exports: [
    ValidationService,
    // ExcelExportService,
    ValidationWorkerService,
    ValidationClientProgrammingService,
    ValidationTaskAndSubtaskService,
    ValidationUserSiteService
  ],
})
export class ValidationModule {}
