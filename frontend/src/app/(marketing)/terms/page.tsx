import React from 'react';
import { LegalLayout } from '@/components/marketing/LegalLayout';

export default function TermsPage() {
  return (
    <LegalLayout title="Terms and Conditions" lastUpdated="July 30, 2026">
      <h2>1. Introduction</h2>
      <p>
        Welcome to ImpactLens. These Terms and Conditions govern your use of our platform and services. By accessing or using our services, you agree to be bound by these terms. If you disagree with any part of the terms, you may not access the service.
      </p>

      <h2>2. Use of Service</h2>
      <p>
        You must be at least 18 years old to use our service. You are responsible for safeguarding the password that you use to access the service and for any activities or actions under your password. You agree not to disclose your password to any third party.
      </p>

      <h2>3. Data Collection and Forms</h2>
      <p>
        As a creator of forms, you are solely responsible for the data you collect from your
        respondents: what you ask for, the basis on which you ask for it, and what you tell
        respondents about it. You must ensure your data collection practices comply with all
        applicable local, state, national and international laws, including GDPR and CCPA where
        they apply to you. ImpactLens acts as a data processor on behalf of form creators.
      </p>
      <p>
        <strong>Data you must not collect through ImpactLens.</strong> The platform is not built or
        certified for protected health information under HIPAA, and we do not sign Business
        Associate Agreements. Nor is it built to receive cardholder data — do not create forms that
        collect full payment card numbers. See our <a href="/compliance">security page</a> for the
        full list of certifications we do not hold.
      </p>

      <h2>4. Acceptable Use</h2>
      <p>
        You may not use ImpactLens to collect data unlawfully, to impersonate another organization, to
        run phishing or credential-harvesting forms, to distribute malware through file uploads, or
        to send unsolicited bulk messages. You may not attempt to access data belonging to another
        organization, probe or load-test the service without our written agreement, or use it in a
        way that degrades it for others. We may remove a form or suspend an account that does any
        of these.
      </p>

      <h2>5. Availability</h2>
      <p>
        We work to keep the service available and will give notice of planned maintenance where we
        reasonably can, but we do not currently offer a contractual uptime commitment. The service
        is provided on an &quot;as is&quot; and &quot;as available&quot; basis.
      </p>

      <h2>6. Intellectual Property</h2>
      <p>
        The service and its original content (excluding content provided by users), features, and functionality are and will remain the exclusive property of ImpactLens Inc and its licensors. Our trademarks and trade dress may not be used in connection with any product or service without the prior written consent of ImpactLens Inc.
      </p>

      <h2>7. Subscriptions and Billing</h2>
      <p>
        Some parts of the Service are billed on a subscription basis. You will be billed in advance on a recurring and periodic basis (monthly or annually). Billing cycles are set on a regular basis. At the end of each billing cycle, your subscription will automatically renew unless you cancel it or ImpactLens cancels it.
      </p>

      <h2>8. Termination</h2>
      <p>
        We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms. Upon termination, your right to use the Service will immediately cease. All data associated with your account may be deleted after a grace period of 30 days.
      </p>

      <h2>9. Limitation of Liability</h2>
      <p>
        In no event shall ImpactLens Inc, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the Service.
      </p>

      <h2>10. Contact Us</h2>
      <p>
        If you have any questions about these Terms, please contact us at legal@impactlens.app, or
        through our <a href="/contact">contact page</a>.
      </p>
    </LegalLayout>
  );
}
