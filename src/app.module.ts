import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { UserModule } from './user/user.module';
import { PrismaService } from './prisma/prisma.service';
import { AreaModule } from './area/area.module';
import { LoginModule } from './login/login.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { WorkerModule } from './worker/worker.module';
import { TaskModule } from './task/task.module';
import { OperationModule } from './operation/operation.module';
import { CronJobModule } from './cron-job/cron-job.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ClientModule } from './client/client.module';
import { ValidationModule } from './common/validation/validation.module';
import { CalledAttentionModule } from './called-attention/called-attention.module';
import { OperationWorkerModule } from './operation-worker/operation-worker.module';
import { OperationInChargeModule } from './in-charged/in-charged.module';
import { DocsController } from './docs/docs.controller';
import { DocsModule } from './docs/docs.module';
import { DocsAuthMiddleware } from './common/middleware/docs-auth.middleware';
import { CommonModule } from './common/common.module';
import { FeedingModule } from './feeding/feeding.module';
import { InabilityModule } from './inability/inability.module';
import { PaginationModule } from './common/services/pagination/pagination.module';
import { ClientProgrammingModule } from './client-programming/client-programming.module';
import { SiteModule } from './site/site.module';
import { SubsiteModule } from './subsite/subsite.module';
import { SubtaskModule } from './subtask/subtask.module';
import { CostCenterModule } from './cost-center/cost-center.module';
import { UnitOfMeasureModule } from './unit-of-measure/unit-of-measure.module';
import { TariffModule } from './tariff/tariff.module';
import { ConfigurationModule } from './configuration/configuration.module';
import { BillModule } from './bill/bill.module';
import { PermissionModule } from './permission/permission.module';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    CronJobModule,
    UserModule,
    AreaModule,
    LoginModule,
    AuthModule,
    WorkerModule,
    TaskModule,
    OperationModule,
    CronJobModule,
    ClientModule,
    ValidationModule,
    CalledAttentionModule,
    OperationWorkerModule,
    OperationInChargeModule,
    DocsModule,
    CommonModule,
    FeedingModule,
    InabilityModule,
    PaginationModule,
    ClientProgrammingModule,
    SiteModule,
    SubsiteModule,
    SubtaskModule,
    CostCenterModule,
    UnitOfMeasureModule,
    TariffModule,
    ConfigurationModule,
    BillModule,
    PermissionModule,
  ],
  providers: [
    PrismaService,
    DocsAuthMiddleware
  ],
  controllers: [AppController, DocsController],
  exports: [PrismaService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(DocsAuthMiddleware)
      .exclude(
        { path: 'login', method: RequestMethod.ALL },
        { path: 'login.html', method: RequestMethod.ALL },
      )
      .forRoutes('docs', 'docs/*path', 'api', 'api/*path');
  }
}
