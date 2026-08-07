'use client';

import React from 'react';
import { FeatureShowcase } from '@/components/marketing/FeatureShowcase';
import { LayoutGrid, Zap, BarChart3, ShieldCheck, Globe, Users, FileText, Sparkles, CheckCircle2 } from 'lucide-react';

export default function FeaturesPage() {
  return (
    <div className="flex flex-col relative font-sans bg-background">
      {/* Hero */}
      <section className="py-24 lg:py-32 bg-muted/30 border-b border-border/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center max-w-4xl">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-foreground">
            Everything you need to <span className="text-primary">collect data better</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            From simple contact forms to complex multi-page surveys with conditional logic, Formora gives you the tools to build it all without writing a single line of code.
          </p>
        </div>
      </section>

      {/* Main Showcase */}
      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
           <FeatureShowcase />
        </div>
      </section>

      {/* Feature Grid */}
      <section className="py-24 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 text-foreground">A platform built for scale</h2>
            <p className="text-muted-foreground">More than just a form builder. A complete data collection platform.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: LayoutGrid, title: "Multi-page Forms", desc: "Break long forms into easy-to-complete steps to increase conversion rates." },
              { icon: Zap, title: "Webhooks & APIs", desc: "Send submissions anywhere in real-time. Integrate with Zapier, Make, and custom APIs." },
              { icon: Globe, title: "Multi-language", desc: "Collect responses in any language with automatic right-to-left (RTL) support." },
              { icon: ShieldCheck, title: "Enterprise Security", desc: "HIPAA compliant, SOC 2 Type II certified, and end-to-end encrypted fields." },
              { icon: Users, title: "Team Collaboration", desc: "Work together with role-based access (Admin, Editor, Viewer)." },
              { icon: BarChart3, title: "Advanced Analytics", desc: "Track drop-offs, conversion rates, and completion times to optimize your forms." },
              { icon: FileText, title: "PDF Export", desc: "Automatically generate and email beautiful PDF reports upon submission." },
              { icon: Sparkles, title: "AI Generation", desc: "Describe the form you want, and let our AI build it for you in seconds." },
              { icon: CheckCircle2, title: "Custom Validation", desc: "Ensure data quality with regex patterns, ranges, and cross-field validation rules." }
            ].map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div key={i} className="bg-card rounded-2xl p-6 border border-border shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-5">
                    <Icon size={24} />
                  </div>
                  <h3 className="font-bold text-lg text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
