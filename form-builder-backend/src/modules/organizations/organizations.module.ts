import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // NotificationsModule exports NotificationsService, which acceptInvitation
  // uses to tell the org's admins that somebody joined. Not global on purpose:
  // a module that emits notifications should say so in its imports.
  imports: [NotificationsModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
