import { Injectable, BadRequestException, Logger, ForbiddenException } from '@nestjs/common';
import { SubmissionProducer, SubmissionPayload } from './queues/submission.producer';
import { SubmitFormDto } from './dto/submit-form.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly producer: SubmissionProducer,
    private readonly prisma: PrismaService,
  ) {}

  async submitForm(formId: string, dto: SubmitFormDto, ip: string, userAgent?: string, userId?: string) {
    // 1. Honeypot check
    if (dto.honeypot && dto.honeypot.trim() !== '') {
      this.logger.warn(`Spam detected via honeypot on form ${formId} from IP ${ip}`);
      throw new BadRequestException('Spam detected');
    }

    // 2. CAPTCHA verification (if configured)
    const turnstileSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET;
    if (turnstileSecret) {
      if (!dto.captchaToken) {
        throw new BadRequestException('CAPTCHA verification required');
      }
      try {
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: turnstileSecret, response: dto.captchaToken, remoteip: ip }),
        });
        const data = await res.json();
        if (!data.success) {
          this.logger.warn(`CAPTCHA failed for form ${formId} from IP ${ip}`);
          throw new BadRequestException('CAPTCHA verification failed');
        }
      } catch (err) {
        this.logger.error('Error verifying CAPTCHA', err);
        throw new BadRequestException('CAPTCHA verification failed');
      }
    }

    // 3. Enforce monthly submission limit
    const form = await this.prisma.reader.form.findUnique({
      where: { id: formId },
      select: { 
        organizationId: true,
        organization: { select: { maxSubmissionsMonth: true } } 
      }
    });

    if (form?.organization) {
      const monthStart = new Date(); 
      monthStart.setDate(1); 
      monthStart.setHours(0,0,0,0);

      const monthlyCount = await this.prisma.reader.formSubmission.count({
        where: { 
          form: { organizationId: form.organizationId }, 
          submittedAt: { gte: monthStart } 
        }
      });
      if (monthlyCount >= form.organization.maxSubmissionsMonth) {
        throw new ForbiddenException('Monthly submission limit reached for this organization');
      }
    }

    const submissionId = randomUUID();
    
    const payload: SubmissionPayload = {
      submissionId,
      formId,
      answers: dto.answers,
      completionTimeMs: dto.completionTimeMs ?? 0,
      respondentIp: ip,
      userAgent,
      respondentId: userId,
      submittedAt: new Date().toISOString(),
    };

    await this.producer.enqueue(payload);

    return { submissionId, status: 'ENQUEUED' };
  }
  async listSubmissions(orgId: string, page = 1, limit = 50, search?: string) {
    const skip = (page - 1) * limit;
    
    // We only fetch submissions for forms in this org
    const where: any = {
      form: {
        organizationId: orgId
      }
    };

    if (search) {
      where.OR = [
        { submissionId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [submissions, total] = await Promise.all([
      this.prisma.reader.formSubmission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { submittedAt: 'desc' },
        include: {
          form: {
            select: { id: true, title: true }
          },
          respondent: {
            select: { id: true, email: true, firstName: true, lastName: true }
          }
        }
      }),
      this.prisma.reader.formSubmission.count({ where }),
    ]);

    return {
      submissions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}

