import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter | null = null;
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    const smtpConfig = this.configService.get('smtp');
    if (smtpConfig && smtpConfig.host) {
      this.transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.port === 465,
        auth: (smtpConfig.user && smtpConfig.pass) ? {
          user: smtpConfig.user,
          pass: smtpConfig.pass,
        } : undefined,
      });
      this.logger.log('SMTP transporter initialized');
    } else {
      this.logger.warn('SMTP configuration not found. Email sending will be skipped.');
    }
  }

  async sendInvitationEmail(to: string, inviterName: string, orgName: string, inviteUrl: string) {
    if (!this.transporter) {
      this.logger.warn(`Skipping invitation email to ${to} (SMTP not configured)`);
      return;
    }

    const from = this.configService.get('smtp.from');
    
    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: `You've been invited to join ${orgName} on FormBuilder`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: #333; text-align: center;">Welcome to FormBuilder!</h2>
            <p style="font-size: 16px; color: #555;">Hi there,</p>
            <p style="font-size: 16px; color: #555;">
              <strong>${inviterName}</strong> has invited you to join the <strong>${orgName}</strong> organization on FormBuilder.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">
                Accept Invitation
              </a>
            </div>
            <p style="font-size: 14px; color: #777;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="${inviteUrl}">${inviteUrl}</a>
            </p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; text-align: center;">
              FormBuilder - The easiest way to build forms.
            </p>
          </div>
        `,
      });
      this.logger.log(`Invitation email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send invitation email to ${to}`, error);
    }
  }

  async sendPasswordResetEmail(to: string, resetUrl: string) {
    if (!this.transporter) {
      this.logger.warn(`Skipping password reset email to ${to} (SMTP not configured)`);
      return;
    }

    const from = this.configService.get('smtp.from');
    
    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: `Reset your FormBuilder password`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
            <p style="font-size: 16px; color: #555;">Hi there,</p>
            <p style="font-size: 16px; color: #555;">
              We received a request to reset your password. Click the button below to choose a new password.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">
                Reset Password
              </a>
            </div>
            <p style="font-size: 14px; color: #777;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="${resetUrl}">${resetUrl}</a>
            </p>
            <p style="font-size: 14px; color: #777;">If you did not request this, please ignore this email.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; text-align: center;">
              FormBuilder - The easiest way to build forms.
            </p>
          </div>
        `,
      });
      this.logger.log(`Password reset email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${to}`, error);
    }
  }

  async sendSubmissionNotificationEmail(to: string[], formTitle: string, submissionId: string, answers: any) {
    if (!this.transporter || to.length === 0) {
      return;
    }

    const from = this.configService.get('smtp.from');
    
    // Create a simple HTML table of the top 10 answers
    const answersHtml = Object.entries(answers || {})
      .slice(0, 10)
      .map(([key, value]) => `<tr><td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">${key}</td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${typeof value === 'object' ? JSON.stringify(value) : value}</td></tr>`)
      .join('');

    try {
      await this.transporter.sendMail({
        from,
        to: to.join(','),
        subject: `New submission for form: ${formTitle}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: #333; text-align: center;">New Form Submission</h2>
            <p style="font-size: 16px; color: #555;">You have received a new submission for the form <strong>${formTitle}</strong>.</p>
            <p style="font-size: 14px; color: #777;">Submission ID: ${submissionId}</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tbody>
                ${answersHtml}
              </tbody>
            </table>
            
            ${Object.keys(answers || {}).length > 10 ? '<p style="font-size: 14px; color: #777;">(Log in to view the complete submission)</p>' : ''}
            
            <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; text-align: center;">
              FormBuilder - The easiest way to build forms.
            </p>
          </div>
        `,
      });
      this.logger.log(`Submission notification email sent to ${to.join(', ')}`);
    } catch (error) {
      this.logger.error(`Failed to send submission notification email to ${to.join(', ')}`, error);
    }
  }
}
