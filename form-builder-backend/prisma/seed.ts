import { PrismaClient, SystemRole, OrgRole, FormStatus, InviteStatus, FileUploadStatus, StorageProvider } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting comprehensive seeding...');

  // 1. Hash the password
  const passwordHash = await argon2.hash('Password123');

  // 2. Create a SuperAdmin User
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@formbuilder.com' },
    update: {},
    create: {
      email: 'admin@formbuilder.com',
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      systemRole: SystemRole.SUPER_ADMIN,
      emailVerified: true,
    },
  });
  console.log(`Created SuperAdmin: ${superAdmin.email}`);

  // 3. Create a Regular User
  const regularUser = await prisma.user.upsert({
    where: { email: 'user@formbuilder.com' },
    update: {},
    create: {
      email: 'user@formbuilder.com',
      passwordHash,
      firstName: 'Regular',
      lastName: 'User',
      systemRole: SystemRole.USER,
      emailVerified: true,
    },
  });
  console.log(`Created Regular User: ${regularUser.email}`);

  // User Tokens & API Keys
  await prisma.emailVerificationToken.create({
    data: {
      userId: regularUser.id,
      tokenHash: 'dummy_hash_email_verification',
      expiresAt: new Date(Date.now() + 86400000),
    }
  });

  await prisma.passwordResetToken.create({
    data: {
      userId: regularUser.id,
      tokenHash: 'dummy_hash_password_reset',
      expiresAt: new Date(Date.now() + 86400000),
    }
  });

  await prisma.refreshToken.create({
    data: {
      userId: regularUser.id,
      tokenHash: 'dummy_hash_refresh_token',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      ipAddress: '192.168.1.1',
      expiresAt: new Date(Date.now() + 86400000),
    }
  });

  // Notifications
  await prisma.notification.create({
    data: {
      userId: superAdmin.id,
      type: 'system_alert',
      title: 'Welcome to FormBuilder!',
      body: 'Get started by creating your first form.',
      isRead: false,
    }
  });
  await prisma.notification.create({
    data: {
      userId: regularUser.id,
      type: 'new_submission',
      title: 'New Submission Received',
      body: 'You have a new response on your form.',
      isRead: false,
    }
  });

  // 4. Create Organizations
  const orgs = [
    { name: 'Acme Corp', slug: 'acme-corp' },
    { name: 'Global Tech', slug: 'global-tech' },
    { name: 'Stark Industries', slug: 'stark-industries' }
  ];

  const createdOrgs = [];
  for (const o of orgs) {
    const org = await prisma.organization.upsert({
      where: { slug: o.slug },
      update: {},
      create: {
        name: o.name,
        slug: o.slug,
        maxForms: 100,
        maxSubmissionsMonth: 10000,
      },
    });
    createdOrgs.push(org);
    console.log(`Created Organization: ${org.name}`);

    // Audit Logs
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: superAdmin.id,
        action: 'org.created',
        resource: 'org',
        resourceId: org.id,
        metadata: { "orgName": org.name },
        ipAddress: '127.0.0.1'
      }
    });
  }

  // API Key for first org
  await prisma.apiKey.create({
    data: {
      userId: superAdmin.id,
      organizationId: createdOrgs[0].id,
      name: 'Production API Key',
      keyHash: 'dummy_hash_api_key',
      scopes: 'forms:read,submissions:read',
    }
  });

  // 5. Add Members to Organizations
  for (const org of createdOrgs) {
    await prisma.organizationMember.upsert({
      where: { userId: superAdmin.id },
      update: {},
      create: {
        userId: superAdmin.id,
        organizationId: org.id,
        role: OrgRole.ADMIN,
      },
    });
    
    // Put regular user in acme-corp only
    if (org.slug === 'acme-corp') {
      await prisma.organizationMember.upsert({
        where: { userId: regularUser.id },
        update: {},
        create: {
          userId: regularUser.id,
          organizationId: org.id,
          role: OrgRole.EDITOR,
        },
      });

      // Org Invitations
      await prisma.organizationInvitation.create({
        data: {
          organizationId: org.id,
          email: 'pending_user@formbuilder.com',
          role: OrgRole.VIEWER,
          token: 'dummy_hash_invitation_token',
          status: InviteStatus.PENDING,
          invitedById: superAdmin.id,
          expiresAt: new Date(Date.now() + 86400000),
        }
      });
    }
  }
  console.log('Added members to Organizations');

  const pages = [
    { pageNumber: 1, title: 'General Info' },
    { pageNumber: 2, title: 'Detailed Feedback' }
  ];

  const questions = [
    { id: 'q1', type: 'SHORT_TEXT', label: 'What is your name?', pageNumber: 1, validation: { required: true } },
    { id: 'q2', type: 'EMAIL', label: 'Email Address', pageNumber: 1, validation: { required: true } },
    { id: 'q3', type: 'STAR_RATING', label: 'How would you rate our service?', pageNumber: 2, validation: { required: true } },
    { id: 'q4', type: 'LONG_TEXT', label: 'Any additional comments?', pageNumber: 2, validation: { required: false } },
    { id: 'q5', type: 'FILE_UPLOAD', label: 'Upload receipt', pageNumber: 2, validation: { required: false } }
  ];

  const theme = {
    preset: 'indigo', primaryColor: '#4f46e5', backgroundColor: '#f9fafb',
    cardColor: '#ffffff', textColor: '#111827', fontFamily: 'Inter',
    borderRadius: 'md', cardVariant: 'elevated'
  };

  // Form Template
  await prisma.formTemplate.create({
    data: {
      name: 'Customer Satisfaction',
      description: 'Standard customer satisfaction survey',
      category: 'survey',
      formData: { pages, questions, logic: [], theme },
      isPublic: true,
      usageCount: 15,
    }
  });

  // 6. Create Multiple Forms
  const forms = [
    { title: 'Customer Feedback Survey', slug: 'customer-feedback-survey', status: FormStatus.PUBLISHED, orgIdx: 0 },
    { title: 'Employee Satisfaction', slug: 'employee-satisfaction', status: FormStatus.PUBLISHED, orgIdx: 0 },
    { title: 'Event Registration', slug: 'event-registration', status: FormStatus.DRAFT, orgIdx: 0 },
    { title: 'Product Beta Signup', slug: 'beta-signup', status: FormStatus.PUBLISHED, orgIdx: 1 },
    { title: 'Support Ticket', slug: 'support-ticket', status: FormStatus.CLOSED, orgIdx: 2 },
  ];

  for (const formInput of forms) {
    const form = await prisma.form.upsert({
      where: { slug: formInput.slug },
      update: {},
      create: {
        organizationId: createdOrgs[formInput.orgIdx].id,
        createdById: superAdmin.id,
        title: formInput.title,
        description: `This is the ${formInput.title} form.`,
        slug: formInput.slug,
        status: formInput.status,
        layoutMode: 'DOCUMENT',
        pagesJson: pages,
        questionsJson: questions,
        logicJson: [],
        themeConfig: theme,
      }
    });
    console.log(`Created Form: ${form.title}`);

    // Form Draft
    if (form.status === FormStatus.DRAFT) {
      await prisma.formDraft.create({
        data: {
          formId: form.id,
          fingerprint: 'dummy_browser_fingerprint',
          answers: { q1: 'Draft Name' },
          progress: 50,
        }
      });
    }

    // Form Comment
    await prisma.formComment.create({
      data: {
        formId: form.id,
        userId: superAdmin.id,
        content: 'Looks good to me!',
      }
    });

    if (form.status === FormStatus.PUBLISHED || form.status === FormStatus.CLOSED) {
      // Form Webhook & Integration Config
      const webhook = await prisma.formWebhook.create({
        data: {
          formId: form.id,
          url: 'https://example.com/webhook',
          secret: 'dummy_webhook_secret',
          name: 'Zapier Integration',
          isActive: true,
        }
      });

      await prisma.integrationConfig.create({
        data: {
          organizationId: form.organizationId,
          formId: form.id,
          provider: 'airtable',
          credentials: { apiKey: 'dummy_airtable_key' },
          syncRules: { mapping: { q1: 'Name', q2: 'Email' } },
        }
      });

      // 7. Create a Form Version
      const formVersion = await prisma.formVersion.upsert({
        where: { formId_version: { formId: form.id, version: 1 } },
        update: {},
        create: {
          formId: form.id,
          version: 1,
          pagesJson: pages,
          questionsJson: questions,
          logicJson: [],
          themeJson: theme,
          publishedAt: new Date(),
        }
      });
      console.log(`Created FormVersion v${formVersion.version} for ${form.title}`);

      // Analytics
      await prisma.formAnalytics.create({
        data: {
          formId: form.id,
          date: new Date(),
          views: 100,
          starts: 80,
          submissions: 50,
          avgCompletionMs: 45000,
        }
      });

      // 8. Create Multiple Form Submissions
      const submissionCount = Math.floor(Math.random() * 5) + 3;
      for (let i = 0; i < submissionCount; i++) {
        const submission = await prisma.formSubmission.create({
          data: {
            formId: form.id,
            formVersionId: formVersion.id,
            answers: {
              q1: `User ${i}`,
              q2: `user${i}@example.com`,
              q3: Math.floor(Math.random() * 5) + 1,
              q4: 'No comments'
            },
            submittedAt: new Date(Date.now() - Math.floor(Math.random() * 10000000000)),
            completionTimeMs: Math.floor(Math.random() * 60000) + 10000,
          }
        });

        // FormSubmissionFile (only for first submission to avoid clutter)
        if (i === 0) {
          await prisma.formSubmissionFile.create({
            data: {
              submissionId: submission.id,
              questionId: 'q5',
              provider: StorageProvider.MINIO,
              bucket: 'uploads',
              objectKey: `uploads/${form.organizationId}/${form.id}/${submission.id}/dummy_file_id/receipt.pdf`,
              originalName: 'receipt.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 102456,
              status: FileUploadStatus.VERIFIED,
              verifiedAt: new Date(),
            }
          });
        }

        // Webhook Delivery Log
        await prisma.webhookDelivery.create({
          data: {
            webhookId: webhook.id,
            submissionId: submission.id,
            statusCode: 200,
            responseBody: '{"status": "ok"}',
            success: true,
          }
        });
      }
      console.log(`Created ${submissionCount} Submissions for ${form.title}`);
    }
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
