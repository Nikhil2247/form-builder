'use client';

import React, { useState } from 'react';
import { CheckCircle2, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import Link from 'next/link';

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(true);

  const plans = [
    {
      name: "Starter",
      description: "Perfect for individuals and small projects.",
      monthlyPrice: 0,
      annualPrice: 0,
      buttonText: "Start for Free",
      href: "/signup",
      popular: false,
      features: [
        "Up to 3 forms",
        "100 submissions/month",
        "Basic form elements",
        "Community support",
        "Standard analytics"
      ]
    },
    {
      name: "Pro",
      description: "For growing teams needing more power.",
      monthlyPrice: 29,
      annualPrice: 24,
      buttonText: "Upgrade to Pro",
      href: "/signup?plan=pro",
      popular: true,
      features: [
        "Unlimited forms",
        "5,000 submissions/month",
        "Advanced logic & branching",
        "File uploads (up to 1GB)",
        "Priority email support",
        "Custom branding",
        "Webhooks & integrations"
      ]
    },
    {
      name: "Enterprise",
      description: "Advanced security and control for large organizations.",
      monthlyPrice: 99,
      annualPrice: 79,
      buttonText: "Contact Sales",
      href: "/contact",
      popular: false,
      features: [
        "Unlimited everything",
        "100,000+ submissions/month",
        "HIPAA & SOC2 Compliance",
        "SSO (SAML, OIDC)",
        "Dedicated Success Manager",
        "Custom SLAs",
        "Audit logs"
      ]
    }
  ];

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-24 max-w-7xl font-sans">
      <div className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
          Simple, transparent pricing
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Start for free, upgrade when you need to. No hidden fees.
        </p>
        
        <div className="flex items-center justify-center gap-3">
          <Label htmlFor="billing-toggle" className={`text-sm font-medium ${!isAnnual ? 'text-foreground' : 'text-muted-foreground'}`}>Monthly</Label>
          <Switch 
            id="billing-toggle" 
            checked={isAnnual} 
            onCheckedChange={setIsAnnual} 
          />
          <Label htmlFor="billing-toggle" className={`text-sm font-medium flex items-center gap-2 ${isAnnual ? 'text-foreground' : 'text-muted-foreground'}`}>
            Annually <span className="bg-emerald-100 text-emerald-700 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">Save 20%</span>
          </Label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {plans.map((plan) => (
          <div key={plan.name} className={`relative flex flex-col p-8 rounded-3xl bg-card border ${plan.popular ? 'border-primary shadow-xl shadow-primary/10' : 'border-border shadow-sm'} transition-transform hover:-translate-y-1 duration-300`}>
            {plan.popular && (
              <div className="absolute -top-4 left-0 right-0 flex justify-center">
                <div className="bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider py-1.5 px-4 rounded-full">
                  Most Popular
                </div>
              </div>
            )}
            
            <div className="mb-6">
              <h3 className="text-2xl font-bold text-foreground mb-2">{plan.name}</h3>
              <p className="text-sm text-muted-foreground min-h-[40px]">{plan.description}</p>
            </div>
            
            <div className="mb-8 flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-foreground">${isAnnual ? plan.annualPrice : plan.monthlyPrice}</span>
              <span className="text-sm font-medium text-muted-foreground">/mo</span>
            </div>
            
            <Link href={plan.href} className="w-full mb-8">
              <Button variant={plan.popular ? 'default' : 'outline'} className={`w-full h-12 rounded-xl text-base ${plan.popular ? 'shadow-md shadow-primary/20' : ''}`}>
                {plan.buttonText}
              </Button>
            </Link>
            
            <div className="space-y-4 flex-1">
              <p className="text-sm font-semibold text-foreground mb-4">What's included:</p>
              {plan.features.map((feature, i) => (
                <div key={i} className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-primary shrink-0 mt-0.5" />
                  <span className="text-sm text-muted-foreground">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-32 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl font-bold text-foreground mb-6">Frequently asked questions</h2>
        <div className="space-y-6 text-left">
          {[
            { q: "Can I switch plans later?", a: "Absolutely. You can upgrade or downgrade your plan at any time. Prorated charges will be applied automatically." },
            { q: "What happens if I exceed my submission limit?", a: "We'll never block your forms without warning. We'll send you an email when you hit 80% and 100% of your limit, giving you time to upgrade." },
            { q: "Do you offer discounts for non-profits?", a: "Yes! We offer a 50% discount for registered non-profit organizations. Contact our support team to apply." }
          ].map((faq, i) => (
            <div key={i} className="bg-muted/30 p-6 rounded-2xl border border-border">
              <h4 className="font-semibold text-foreground flex items-center gap-2 mb-2"><HelpCircle size={18} className="text-primary"/> {faq.q}</h4>
              <p className="text-sm text-muted-foreground pl-7">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
