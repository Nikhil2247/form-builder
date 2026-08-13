import { Module } from '@nestjs/common';

import { FormAppsController } from './form-apps.controller';
import { FormAppStepsController } from './form-app-steps.controller';
import { PublicAppsController } from './public-apps.controller';
import { SubjectEntriesController } from './subject-entries.controller';
import { FormAppsService } from './form-apps.service';
import { FormAppSessionsService } from './form-app-sessions.service';
import { SubmissionsModule } from '../submissions/submissions.module';

/**
 * SubmissionsModule is imported so a session submit can run each entry through
 * `SubmissionsService.prepareAnswers` — the SAME pipeline a lone form
 * submission uses. Re-implementing validation here would have been the obvious
 * shortcut and the obvious mistake: which door a respondent came through must
 * never change what gets stored.
 */
@Module({
  imports: [SubmissionsModule],
  controllers: [
    FormAppsController,
    FormAppStepsController,
    PublicAppsController,
    SubjectEntriesController,
  ],
  providers: [FormAppsService, FormAppSessionsService],
  exports: [FormAppsService, FormAppSessionsService],
})
export class FormAppsModule {}
