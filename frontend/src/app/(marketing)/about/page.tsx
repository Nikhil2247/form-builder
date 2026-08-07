'use client';

import React from 'react';
import { Layers, Users, Globe, Target } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="flex flex-col relative font-sans bg-background">
      {/* Hero */}
      <section className="py-24 lg:py-32 bg-muted/30 border-b border-border/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center max-w-4xl">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-foreground">
            We're building the future of <span className="text-primary">data collection</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Formora was founded on a simple belief: collecting data shouldn't be painful for the creator, and it shouldn't be ugly for the respondent.
          </p>
        </div>
      </section>

      {/* Story */}
      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl">
          <div className="prose prose-lg dark:prose-invert max-w-none text-muted-foreground">
            <h2 className="text-3xl font-bold text-foreground mb-6">Our Story</h2>
            <p>
              In 2023, our founders were working at a fast-growing startup and found themselves constantly frustrated by the existing form building tools. They were either too simple and lacked the logical power needed for enterprise workflows, or they were incredibly powerful but looked like they were built in the 1990s.
            </p>
            <p>
              We wanted a tool that respected the user experience of both the form creator and the person filling it out. A tool that could handle complex conditional branching, HIPAA-compliant data, and API webhooks—while still looking like a premium, modern software product.
            </p>
            <p>
              So we built Formora. Today, we're proud to power data collection for thousands of innovative teams around the globe, from small non-profits to Fortune 500 enterprises.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-foreground">Our Core Values</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              { icon: Target, title: "Design Matters", desc: "A beautiful form converts better. We prioritize aesthetics as a core feature, not an afterthought." },
              { icon: Layers, title: "Powerful simplicity", desc: "Complexity should be hidden until it's needed. The tool should scale with your needs seamlessly." },
              { icon: Globe, title: "Accessible to all", desc: "We build for everyone. That means WCAG compliance, multi-language support, and keyboard navigation." },
              { icon: Users, title: "Privacy first", desc: "Your data is yours. We build with security and compliance at the foundation of our architecture." }
            ].map((val, i) => {
              const Icon = val.icon;
              return (
                <div key={i} className="bg-card p-8 rounded-2xl border border-border shadow-sm flex gap-6">
                  <div className="w-12 h-12 shrink-0 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
                    <Icon size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl text-foreground mb-2">{val.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">{val.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
