import React from 'react';
import { ShieldCheck, Lock, Activity, Eye, CheckCircle2 } from 'lucide-react';

export default function CompliancePage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-24 max-w-5xl">
      <div className="text-center mb-20">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mb-6">
          <ShieldCheck size={32} />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4 text-foreground">Security & Compliance</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Enterprise-grade security built into every form. Formora meets the strictest regulatory requirements so you can collect data with confidence.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
        <div className="bg-card border border-border rounded-2xl p-8 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
              <Activity size={24} />
            </div>
            <h2 className="text-2xl font-bold text-foreground">HIPAA Compliant</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Formora is fully HIPAA compliant. We offer Business Associate Agreements (BAAs) for enterprise customers in the healthcare sector. All PHI (Protected Health Information) is encrypted at rest using AES-256 and in transit using TLS 1.3.
          </p>
          <ul className="space-y-2">
            {['Business Associate Agreements', 'PHI encryption at rest & in transit', 'Audit logging for all data access', 'Automatic data retention policies'].map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
              <Eye size={24} />
            </div>
            <h2 className="text-2xl font-bold text-foreground">WCAG 2.1 AA</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Forms created with Formora meet WCAG 2.1 Level AA standards out of the box. We ensure full screen-reader compatibility, keyboard navigation, and color contrast requirements are met automatically.
          </p>
          <ul className="space-y-2">
            {['Screen reader compatible forms', 'Full keyboard navigation', 'Color contrast compliance', 'ARIA labels on all interactive elements'].map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
              <ShieldCheck size={24} />
            </div>
            <h2 className="text-2xl font-bold text-foreground">SOC 2 Type II</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed mb-4">
            We undergo annual independent third-party audits to maintain our SOC 2 Type II certification. This ensures our internal security practices, change management, and infrastructure access controls meet the highest industry standards.
          </p>
          <ul className="space-y-2">
            {['Annual third-party audits', 'Continuous monitoring', 'Change management controls', 'Employee background checks'].map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
              <Lock size={24} />
            </div>
            <h2 className="text-2xl font-bold text-foreground">GDPR & CCPA</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed mb-4">
            We provide built-in tools to help you manage consent, handle data deletion requests (right to be forgotten), and maintain compliance with global privacy regulations including GDPR and CCPA.
          </p>
          <ul className="space-y-2">
            {['EU data residency options', 'Consent management built-in', 'Data deletion workflows', 'Data Processing Agreements available'].map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="bg-muted/30 border border-border rounded-2xl p-8 text-center">
        <h3 className="text-xl font-bold text-foreground mb-2">Need a custom DPA or BAA?</h3>
        <p className="text-muted-foreground mb-6">Our enterprise sales team is ready to help you with your compliance requirements.</p>
        <a href="/contact" className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">
          Contact Enterprise Sales
        </a>
      </div>
    </div>
  );
}
