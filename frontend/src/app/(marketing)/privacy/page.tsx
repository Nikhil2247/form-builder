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
        When you respond to a form created by one of our users, ImpactLens acts as a data processor. The creator of the form is the data controller. We only process respondent data according to the instructions of the form creator. If you have questions about a specific form, please contact the form creator directly.
      </p>

      <h2>4. Data Security</h2>
      <p>
        We implement technical and organizational measures designed to protect the personal
        information we process. Secrets such as webhook signing keys and two-factor seeds are
        encrypted at rest with AES-256-GCM, traffic is served over TLS, access is scoped to a
        single organization and checked on every request, and administrative actions are recorded
        in an audit log. A full description is on our{' '}
        <a href="/compliance">security page</a>, including an explicit list of the certifications
        we do <em>not</em> hold. No transmission over the internet can be guaranteed completely
        secure.
      </p>

      <h2>5. Data Retention</h2>
      <p>
        We keep your account and workspace data for as long as the account exists. Responses are
        kept until you delete them or delete the form they belong to; deletion removes them from
        the live system, and they age out of routine backups afterwards. You can export responses
        to CSV at any time without contacting us.
      </p>

      <h2>6. Your Privacy Rights (GDPR / CCPA)</h2>
      <p>
        Depending on where you are, you may have the right to request access to, correction of, or
        deletion of your personal information, and the rights to portability and to object to or
        restrict processing. Much of this you can exercise yourself from within the product —
        profile details, response export and response deletion. For anything else, write to
        privacy@impactlens.app and we will respond within the period the applicable law allows.
      </p>
      <p>
        If you are a respondent rather than an account holder, the organization that created the
        form decides what is collected and why. We act on their instructions, so requests about a
        specific form are best directed to them first; if you cannot reach them, contact us and we
        will help you identify who to ask.
      </p>

      <h2>7. Service Providers</h2>
      <p>
        We rely on third parties to host the application and its database, store uploaded files,
        and deliver transactional email. They process data on our instructions only, and we do not
        sell personal information or share it for cross-context behavioural advertising. Ask us and
        we will tell you who our current providers are and where they operate.
      </p>

      <h2>8. Cookies and Tracking</h2>
      <p>
        ImpactLens uses strictly necessary cookies for authentication and session management. We do
        not use advertising cookies and do not track individuals across other websites.
      </p>

      <h2>9. Contact Us</h2>
      <p>
        Questions about this Privacy Policy can go to privacy@impactlens.app, or through our{' '}
        <a href="/contact">contact page</a>.
      </p>
    </LegalLayout>
  );
}
