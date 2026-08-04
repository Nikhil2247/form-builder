import React from 'react';

export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-24 max-w-4xl">
      <h1 className="text-4xl font-bold mb-2 text-foreground">Privacy Policy</h1>
      <p className="text-muted-foreground mb-12">Last updated: July 30, 2026</p>
      
      <div className="space-y-10">
        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">1. Information We Collect</h2>
          <p className="text-muted-foreground leading-relaxed">
            We collect information you provide directly to us when you create an account, build a form, submit a form, or communicate with us. This may include your name, email address, password, organization name, and any other information you choose to provide.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">2. How We Use Your Information</h2>
          <p className="text-muted-foreground leading-relaxed">
            We use the information we collect to provide, maintain, and improve our services, to process transactions, to send you related information including confirmations, invoices, and technical notices, and to monitor and analyze trends and usage.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">3. Data Processing for Form Respondents</h2>
          <p className="text-muted-foreground leading-relaxed">
            When you respond to a form created by one of our users, Formora acts as a data processor. The creator of the form is the data controller. We only process respondent data according to the instructions of the form creator. If you have questions about a specific form, please contact the form creator directly.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">4. Data Security</h2>
          <p className="text-muted-foreground leading-relaxed">
            We implement appropriate technical and organizational security measures designed to protect the security of any personal information we process. This includes AES-256 encryption at rest, TLS 1.3 in transit, and regular third-party penetration testing. However, no electronic transmission over the internet can be guaranteed 100% secure.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">5. Your Privacy Rights (GDPR / CCPA)</h2>
          <p className="text-muted-foreground leading-relaxed">
            Depending on your location, you may have the right to request access to, correction of, or deletion of your personal information. You may also have the right to data portability and the right to restrict or object to our processing of your data. To exercise these rights, please contact our privacy team at privacy@formora.io.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">6. Cookies and Tracking</h2>
          <p className="text-muted-foreground leading-relaxed">
            Formora uses strictly necessary cookies for authentication and session management. We use privacy-friendly analytics that do not track individual users across websites. We do not sell your data to third parties under any circumstances.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">7. Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have any questions about this Privacy Policy, please contact us at privacy@formora.io.
          </p>
        </section>
      </div>
    </div>
  );
}
