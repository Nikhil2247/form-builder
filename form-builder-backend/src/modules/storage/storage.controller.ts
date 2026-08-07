import { Controller, Post, Get, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StorageService } from './storage.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Issue a presigned upload URL for a FILE_UPLOAD question on a published form.
   *
   * This endpoint is intentionally public — anonymous respondents must be able
   * to attach files — but it is now heavily constrained:
   *   • rate limited per IP (was completely unthrottled)
   *   • the form must be published, undeleted, unexpired, and in an active org
   *   • the questionId must exist in the published version AND be FILE_UPLOAD
   *   • MIME type and file extension are allowlisted
   *   • size is bounded by MAX_FILE_SIZE_MB and re-verified against storage
   *
   * Previously it had no guards, no throttle, and no validation of any kind:
   * anyone with a formId could mint unlimited 50MB write URLs into the bucket.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('presigned-url')
  async getPresignedUrl(@Body() dto: PresignedUrlDto) {
    return this.storageService.generatePresignedUrl(
      dto.formId,
      dto.questionId,
      dto.filename,
      dto.mimeType,
      dto.fileSizeBytes,
    );
  }

  /**
   * Short-lived download URL for a submission attachment.
   * Org-scoped: members can only fetch files belonging to their own tenant.
   */
  @Get('organizations/:orgId/files/:fileId/download')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  async download(
    @OrgId() orgId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ) {
    return this.storageService.generateDownloadUrl(orgId, fileId);
  }
}
