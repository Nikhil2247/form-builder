import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { PublicFormsController } from './public-forms.controller';
import { FormsService } from './forms.service';
import { ChoiceListsModule } from '../choice-lists/choice-lists.module';
import { AssistantModule } from '../assistant/assistant.module';

/**
 * NOTE: PrismaService and RedisService are intentionally NOT listed as providers
 * here. PrismaModule and RedisModule are both @Global — re-declaring their
 * services in a feature module makes Nest instantiate a SECOND copy, which for
 * PrismaService means two extra PostgreSQL connection pools per module.
 */
@Module({
  // Choice lists are needed to check optionsSource bindings on save and to
  // give the rule compiler the slugs a lookup() may name at publish.
  // AssistantModule provides IdeaService, which backs POST .../forms/generate
  // (Claude, replacing the previous Gemini-backed FormsService method).
  imports: [ChoiceListsModule, AssistantModule],
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
