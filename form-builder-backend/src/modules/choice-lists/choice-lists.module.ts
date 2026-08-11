import { Module } from '@nestjs/common';

import { ChoiceListsService } from './choice-lists.service';
import { ChoiceListsController } from './choice-lists.controller';
import { PlatformChoiceListsController } from './platform-choice-lists.controller';
import { PublicChoiceItemsController } from './public-choice-items.controller';

/**
 * Exported because two other modules depend on it and neither should reach
 * into the database itself:
 *
 *   • FormsModule — to check `optionsSource` bindings at save, and to give the
 *     rule compiler the slugs a `lookup()` may name at publish.
 *   • SubmissionsModule — to validate submitted values against their list and
 *     to fill the rules engine's lookup bag.
 */
@Module({
  providers: [ChoiceListsService],
  controllers: [
    ChoiceListsController,
    PlatformChoiceListsController,
    PublicChoiceItemsController,
  ],
  exports: [ChoiceListsService],
})
export class ChoiceListsModule {}
