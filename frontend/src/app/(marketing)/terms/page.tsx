import React from 'react';
import { LegalLayout } from '@/components/marketing/LegalLayout';

export default function TermsPage() {
  return (
    <LegalLayout title="Terms and Conditions" lastUpdated="July 30, 2026">
      <h2>1. Introduction</h2>
      <p>
        Welcome to Formora. These Terms and Conditions govern your use of our platform and services. By accessing or using our services, you agree to be bound by these terms. If you disagree with any part of the terms, you may not access the service.
      </p>

      <h2>2. Use of Service</h2>
      <p>
        You must be at least 18 years old to use our service. You are responsible for safeguarding the password that you use to access the service and for any activities or actions under your password. You agree not to disclose your password to any third party.
      </p>

      <h2>3. Data Collection and Forms</h2>
      <p>
        As a creator of forms, you are solely responsible for the data you collect from your respondents. You must ensure that your data collection practices comply with all applicable local, state, national, and international laws, including but not limited to GDPR, CCPA, and HIPAA where applicable. Formora acts as a data processor on behalf of form creators.
      </p>

      <h2>4. Intellectual Property</h2>
      <p>
        The service and its original content (excluding content provided by users), features, and functionality are and will remain the exclusive property of Formora Inc and its licensors. Our trademarks and trade dress may not be used in connection with any product or service without the prior written consent of Formora Inc.
      </p>

      <h2>5. Subscriptions & Billing</h2>
      <p>
        Some parts of the Service are billed on a subscription basis. You will be billed in advance on a recurring and periodic basis (monthly or annually). Billing cycles are set on a regular basis. At the end of each billing cycle, your subscription will automatically renew unless you cancel it or Formora cancels it.
      </p>

      <h2>6. Termination</h2>
      <p>
        We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms. Upon termination, your right to use the Service will immediately cease. All data associated with your account may be deleted after a grace period of 30 days.
      </p>

      <h2>7. Limitation of Liability</h2>
      <p>
        In no event shall Formora Inc, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the Service.
      </p>

      <h2>8. Contact Us</h2>
      <p>
        If you have any questions about these Terms, please contact us at legal@formora.io.
      </p>
    </LegalLayout>
  );
}
