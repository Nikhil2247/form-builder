import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsFlushService } from './analytics-flush.service';

// PrismaService omitted from providers on purpose — PrismaModule is @Global,
// and re-declaring it here would spin up an extra connection pool.
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsFlushService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
