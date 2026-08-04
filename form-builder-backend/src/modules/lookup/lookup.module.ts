import { Module, Global } from '@nestjs/common';
import { LookupService } from './lookup.service';

@Global()
@Module({
  providers: [LookupService],
  exports: [LookupService],
})
export class LookupModule {}
