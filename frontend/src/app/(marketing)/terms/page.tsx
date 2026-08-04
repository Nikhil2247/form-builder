import React from 'react';

export default function TermsPage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-24 max-w-4xl">
      <h1 className="text-4xl font-bold mb-2 text-foreground">Terms and Conditions</h1>
      <p className="text-muted-foreground mb-12">Last updated: July 30, 2026</p>
      
      <div className="space-y-10">
        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">1. Introduction</h2>
          <p className="text-muted-foreground leading-relaxed">
            Welcome to Formora. These Terms and Conditions govern your use of our platform and services. By accessing or using our services, you agree to be bound by these terms. If you disagree with any part of the terms, you may not access the service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">2. Use of Service</h2>
          <p className="text-muted-foreground leading-relaxed">
            You must be at least 18 years old to use our service. You are responsible for safeguarding the password that you use to access the service and for any activities or actions under your password. You agree not to disclose your password to any third party.
          </p>
        </section>
        
        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">3. Data Collection and Forms</h2>
          <p className="text-muted-foreground leading-relaxed">
            As a creator of forms, you are solely responsible for the data you collect from your respondents. You must ensure that your data collection practices comply with all applicable local, state, national, and international laws, including but not limited to GDPR, CCPA, and HIPAA where applicable. Formora acts as a data processor on behalf of form creators.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">4. Intellectual Property</h2>
          <p className="text-muted-foreground leading-relaxed">
            The service and its original content (excluding content provided by users), features, and functionality are and will remain the exclusive property of Formora Inc and its licensors. Our trademarks and trade dress may not be used in connection with any product or service without the prior written consent of Formora Inc.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">5. Subscriptions & Billing</h2>
          <p className="text-muted-foreground leading-relaxed">
            Some parts of the Service are billed on a subscription basis. You will be billed in advance on a recurring and periodic basis (monthly or annually). Billing cycles are set on a regular basis. At the end of each billing cycle, your subscription will automatically renew unless you cancel it or Formora cancels it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">6. Termination</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms. Upon termination, your right to use the Service will immediately cease. All data associated with your account may be deleted after a grace period of 30 days.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">7. Limitation of Liability</h2>
          <p className="text-muted-foreground leading-relaxed">
            In no event shall Formora Inc, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3 text-foreground">8. Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have any questions about these Terms, please contact us at legal@formora.io.
          </p>
        </section>
      </div>
    </div>
  );
}
