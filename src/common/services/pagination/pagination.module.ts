import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PaginationService } from './pagination.service';
import { PaginateOperationService } from './operation/paginate-operation.service';
import { PaginationCalledService } from './called-attention/pagination-called.service';
import { PaginationFeedingService } from './feeding/pagination-feeding.service';

@Module({
  imports: [
    CacheModule.register({
      ttl: 300, // 5 minutos para stats
      max: 500, // 500 items en caché
    }),
  ],
  providers: [
    PaginationService,
    PaginateOperationService,
    PaginationCalledService,
    PaginationFeedingService,
  ],
  exports: [
    PaginationService,
    PaginateOperationService,
    PaginationCalledService,
    PaginationFeedingService,
  ],
})
export class PaginationModule {}
