'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, ArrowRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export default function TemplatesPage() {
  const [activeCategory, setActiveCategory] = useState('All');
  
  const categories = ['All', 'Surveys', 'Registration', 'Feedback', 'Contact', 'Application'];
  
  const templates = [
    { name: "Customer Satisfaction Survey", category: "Surveys", uses: "12.4k", tags: ["CSAT", "NPS"] },
    { name: "Event Registration", category: "Registration", uses: "8.2k", tags: ["Events", "Ticketing"] },
    { name: "Job Application", category: "Application", uses: "15.1k", tags: ["HR", "Recruiting"] },
    { name: "Product Feedback", category: "Feedback", uses: "5.6k", tags: ["Product", "SaaS"] },
    { name: "General Contact Form", category: "Contact", uses: "24.3k", tags: ["Basic", "Lead Gen"] },
    { name: "Employee Onboarding", category: "Application", uses: "3.2k", tags: ["HR", "Internal"] },
    { name: "Website Feedback", category: "Feedback", uses: "9.8k", tags: ["UX", "Web"] },
    { name: "Newsletter Signup", category: "Registration", uses: "18.5k", tags: ["Marketing", "Leads"] }
  ];

  const filteredTemplates = activeCategory === 'All' 
    ? templates 
    : templates.filter(t => t.category === activeCategory);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-24 max-w-7xl font-sans min-h-screen">
      <div className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6 text-foreground">
          Start building faster with <span className="text-primary">Templates</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Choose from dozens of professionally designed, conversion-optimized form templates. Ready to use in one click.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar Categories */}
        <div className="w-full md:w-64 shrink-0 space-y-1">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-3">Categories</h3>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeCategory === cat 
                  ? 'bg-primary/10 text-primary' 
                  : 'text-foreground hover:bg-muted/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Template Grid */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((template, i) => (
            <div key={i} className="group relative flex flex-col bg-card border border-border rounded-2xl overflow-hidden hover:shadow-lg hover:border-primary/50 transition-all duration-300">
              <div className="h-40 bg-muted/40 p-4 flex flex-col justify-end border-b border-border relative overflow-hidden">
                <div className="absolute top-4 left-4 right-4 h-32 bg-background rounded-t-xl border border-border shadow-sm flex flex-col gap-3 p-4 opacity-50 group-hover:opacity-100 transition-opacity">
                   <div className="h-3 w-1/2 bg-muted-foreground/20 rounded-full" />
                   <div className="h-8 bg-muted/50 rounded-md border border-border/50" />
                   <div className="h-8 bg-muted/50 rounded-md border border-border/50" />
                </div>
              </div>
              <div className="p-5 flex-1 flex flex-col">
                <h3 className="font-bold text-foreground mb-1 group-hover:text-primary transition-colors">{template.name}</h3>
                <div className="text-xs text-muted-foreground mb-4">Used by {template.uses} teams</div>
                <div className="flex gap-2 mb-6 flex-wrap">
                  {template.tags.map(tag => (
                    <span key={tag} className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">{template.category}</span>
                  <Link href="/signup" className="text-primary text-sm font-bold flex items-center gap-1 hover:gap-2 transition-all">
                    Use Template <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
