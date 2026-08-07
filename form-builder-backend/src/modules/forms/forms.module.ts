import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { PublicFormsController } from './public-forms.controller';
import { FormsService } from './forms.service';

/**
 * NOTE: PrismaService and RedisService are intentionally NOT listed as providers
 * here. PrismaModule and RedisModule are both @Global — re-declaring their
 * services in a feature module makes Nest instantiate a SECOND copy, which for
 * PrismaService means two extra PostgreSQL connection pools per module.
 */
@Module({
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
