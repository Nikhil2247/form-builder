import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * AuditModule — Global module so any service can inject AuditService
 * without needing to import AuditModule in every feature module.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
