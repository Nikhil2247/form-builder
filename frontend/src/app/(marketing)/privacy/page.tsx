import React from 'react';
import { LegalLayout } from '@/components/marketing/LegalLayout';

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="July 30, 2026">
      <h2>1. Information We Collect</h2>
      <p>
        We collect information you provide directly to us when you create an account, build a form, submit a form, or communicate with us. This may include your name, email address, password, organization name, and any other information you choose to provide.
      </p>

      <h2>2. How We Use Your Information</h2>
      <p>
        We use the information we collect to provide, maintain, and improve our services, to process transactions, to send you related information including confirmations, invoices, and technical notices, and to monitor and analyze trends and usage.
      </p>

      <h2>3. Data Processing for Form Respondents</h2>
      <p>
        When you respond to a form created by one of our users, Formora acts as a data processor. The creator of the form is the data controller. We only process respondent data according to the instructions of the form creator. If you have questions about a specific form, please contact the form creator directly.
      </p>

      <h2>4. Data Security</h2>
      <p>
        We implement appropriate technical and organizational security measures designed to protect the security of any personal information we process. This includes AES-256 encryption at rest, TLS 1.3 in transit, and regular third-party penetration testing. However, no electronic transmission over the internet can be guaranteed 100% secure.
      </p>

      <h2>5. Your Privacy Rights (GDPR / CCPA)</h2>
      <p>
        Depending on your location, you may have the right to request access to, correction of, or deletion of your personal information. You may also have the right to data portability and the right to restrict or object to our processing of your data. To exercise these rights, please contact our privacy team at privacy@formora.io.
      </p>

      <h2>6. Cookies and Tracking</h2>
      <p>
        Formora uses strictly necessary cookies for authentication and session management. We use privacy-friendly analytics that do not track individual users across websites. We do not sell your data to third parties under any circumstances.
      </p>

      <h2>7. Contact Us</h2>
      <p>
        If you have any questions about this Privacy Policy, please contact us at privacy@formora.io.
      </p>
    </LegalLayout>
  );
}
