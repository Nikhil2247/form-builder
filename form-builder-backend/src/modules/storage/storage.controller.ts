import { Controller, Post, Body } from '@nestjs/common';
import { StorageService } from './storage.service';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('presigned-url')
  async getPresignedUrl(
    @Body() body: { formId: string; questionId: string; filename: string; mimeType: string; fileSizeMb: number }
  ) {
    return this.storageService.generatePresignedUrl(
      body.formId,
      body.questionId,
      body.filename,
      body.mimeType,
      body.fileSizeMb
    );
  }
}

