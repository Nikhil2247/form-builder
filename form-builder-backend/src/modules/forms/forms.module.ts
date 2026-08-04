import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { PublicFormsController } from './public-forms.controller';
import { FormsService } from './forms.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@Module({
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService, PrismaService, RedisService],
  exports: [FormsService],
})
export class FormsModule {}
