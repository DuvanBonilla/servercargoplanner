import { Module } from '@nestjs/common';
import { InabilityService } from './inability.service';
import { InabilityController } from './inability.controller';
import { ValidationService } from 'src/common/validation/validation.service';
// import { ExcelExportService } from 'src/common/validation/services/excel-export.service';
import { AuthModule } from 'src/auth/auth.module';
import { UpdateInabilityService } from './service/update-inability.service';
import { CertificateExtractionService } from './service/certificate-extraction.service';
import { AiUsageModule } from 'src/ai-usage/ai-usage.module';
import { CertificateStorageService } from './service/certificate-storage.service';
import { InabilityRegistrationService } from './service/inability-registration.service';
import { InabilityTrackingService } from './service/inability-tracking.service';

@Module({
  imports: [AuthModule, AiUsageModule],
  controllers: [InabilityController],
  providers: [
    InabilityService,
    ValidationService,
    UpdateInabilityService,
    CertificateExtractionService,
    CertificateStorageService,
    InabilityRegistrationService,
    InabilityTrackingService,
  ],
  // providers: [InabilityService, ValidationService, ExcelExportService, UpdateInabilityService],
})
export class InabilityModule {}

