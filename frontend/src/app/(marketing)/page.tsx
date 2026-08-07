'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, LayoutGrid, Zap, BarChart3, ShieldCheck, Globe, Sparkles, Users, FileText } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { FeatureShowcase } from '@/components/marketing/FeatureShowcase';

/* ─── SVG Underline component ─── */
function HeadingUnderline({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 12" fill="none" xmlns="http://www.w3.org/2000/svg" className={`absolute -bottom-2 left-0 w-full ${className}`} preserveAspectRatio="none">
      <path d="M2 8C50 2 100 2 150 6C200 10 250 4 298 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const fadeInUp: any = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
};

const staggerContainer: any = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12 }
  }
};

export default function LandingPage() {
  return (
    <div className="flex flex-col relative font-sans">
      
      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="relative overflow-hidden py-28 lg:py-44 bg-background">
        {/* Elegant Grid Background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        {/* Radial glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/10 rounded-full blur-3xl pointer-events-none opacity-60" />
        
        <motion.div 
          className="container mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10"
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8 border border-primary/20">
            <Sparkles size={14} />
            Trusted by 10,000+ teams worldwide
          </motion.div>
          
          <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl font-bold tracking-tight max-w-4xl mx-auto leading-[1.1] mb-6 text-foreground">
            Collect data,{' '}
            <span className="relative inline-block text-primary">
              effortlessly
              <HeadingUnderline className="text-primary/40" />
            </span>
          </motion.h1>
          
          <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12 leading-relaxed">
            Formora is the modern form builder for teams who care about design, conversions, and user experience. Create beautiful forms in seconds — no code required.
          </motion.p>
          
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup" className={buttonVariants({ size: 'lg', className: 'h-14 px-8 text-base w-full sm:w-auto rounded-full shadow-lg shadow-primary/25' })}>
              Start for free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link href="/login" className={buttonVariants({ variant: 'outline', size: 'lg', className: 'h-14 px-8 text-base w-full sm:w-auto rounded-full' })}>
              See it in action
            </Link>
          </motion.div>

          {/* Trusted logos strip */}
          <motion.div variants={fadeInUp} className="mt-20 flex flex-col items-center gap-4">
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Trusted by innovative teams at</p>
            <div className="flex flex-wrap items-center justify-center gap-8 opacity-40">
              {['Acme Corp', 'GlobalTech', 'Quantum', 'Vertex', 'Nova Inc'].map((name) => (
                <span key={name} className="text-lg font-bold tracking-tight text-foreground">{name}</span>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ═══════════════════ FEATURE SHOWCASE ═══════════════════ */}
      <section className="py-32 relative bg-muted/10 border-t border-border/50">
        {/* Grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background opacity-80" />
        
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl relative z-10">
          <motion.div 
            className="text-center mb-20"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
              Powerful features,{' '}
              <span className="relative inline-block text-primary">
                beautifully simple
                <HeadingUnderline className="text-primary/30" />
              </span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-lg mx-auto">Everything you need to collect data, without the clutter.</p>
          </motion.div>
          
          <FeatureShowcase />
        </div>
      </section>

      {/* ═══════════════════ MORE FEATURES GRID ═══════════════════ */}
      <section id="features" className="py-24 relative bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
          <motion.div 
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 text-foreground">And so much more.</h2>
            <p className="text-muted-foreground">Everything an enterprise needs, out of the box.</p>
          </motion.div>
          
          <motion.div 
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
          >
            {[
              { icon: LayoutGrid, title: "Multi-page Forms", desc: "Break long forms into easy-to-complete steps." },
              { icon: Zap, title: "Webhooks & APIs", desc: "Send submissions anywhere in real-time." },
              { icon: Globe, title: "Multi-language", desc: "Collect responses in any language." },
              { icon: ShieldCheck, title: "HIPAA & WCAG", desc: "Enterprise compliance out of the box." },
              { icon: Users, title: "Team Collaboration", desc: "Work together with role-based access." },
              { icon: BarChart3, title: "Conversion Analytics", desc: "Track drop-offs and optimize." },
              { icon: FileText, title: "PDF Export", desc: "Generate beautiful PDF reports." },
              { icon: Sparkles, title: "AI Suggestions", desc: "Smart field recommendations." }
            ].map((feature, i) => {
              const Icon = feature.icon;
              return (
                <motion.div key={i} variants={fadeInUp} className="bg-background rounded-2xl p-5 border border-border hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                    <Icon size={20} />
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.desc}</p>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════ HOW IT WORKS ═══════════════════ */}
      <section className="py-32 relative overflow-hidden bg-background">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-50" />
        
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl relative z-10">
          <motion.div 
            className="text-center mb-20"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
              From idea to data in <span className="text-primary">minutes</span>
            </h2>
            <p className="text-muted-foreground text-lg">A simple, streamlined workflow designed for modern teams.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
            {/* Connecting line (desktop only) */}
            <div className="hidden md:block absolute top-12 h-[2px] bg-border/60 -z-10" style={{ left: '16%', right: '16%' }} />
            
            {[
              { step: "01", title: "Build visually", desc: "Drag and drop fields to create exactly what you need. Add complex conditional logic with a few clicks." },
              { step: "02", title: "Style your brand", desc: "Apply custom colors, rounded corners, and fonts so the form perfectly matches your website's aesthetic." },
              { step: "03", title: "Share & Analyze", desc: "Embed on your site or share a direct link. Watch responses roll in with real-time analytics." }
            ].map((s, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.2, duration: 0.6 }}
                className="flex flex-col items-center text-center"
              >
                <div className="w-24 h-24 rounded-full bg-background border-4 border-muted flex items-center justify-center mb-6 shadow-xl shadow-primary/5">
                  <span className="text-3xl font-extrabold text-primary">{s.step}</span>
                </div>
                <h3 className="text-2xl font-bold mb-3 text-foreground">{s.title}</h3>
                <p className="text-muted-foreground leading-relaxed px-4">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ INTEGRATIONS ═══════════════════ */}
      <section className="py-32 relative bg-primary/5 border-y border-border/50 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.05)_1px,transparent_0)] bg-[size:24px_24px]" />
        
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl relative z-10 text-center">
          <motion.h2 
            initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}
            className="text-3xl md:text-4xl font-bold tracking-tight mb-6 text-foreground"
          >
            Plays nice with the tools you already use
          </motion.h2>
          <motion.p 
            initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}
            className="text-lg text-muted-foreground mb-16 max-w-2xl mx-auto"
          >
            Connect Formora to thousands of apps via Webhooks, Zapier, or our native integrations to automate your workflow.
          </motion.p>

          <motion.div 
            initial="hidden" whileInView="visible" viewport={{ once: true }} variants={staggerContainer}
            className="flex flex-wrap justify-center gap-6 md:gap-8"
          >
            {['Slack', 'Notion', 'Salesforce', 'HubSpot', 'Airtable', 'Google Sheets', 'Zapier', 'Mailchimp'].map((tool, i) => (
              <motion.div 
                key={i} variants={fadeInUp}
                className="px-6 py-4 bg-background rounded-2xl border border-border shadow-sm font-semibold text-foreground hover:-translate-y-1 hover:shadow-md transition-all cursor-default"
              >
                {tool}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════ TESTIMONIALS ═══════════════════ */}
      <section className="py-32 bg-background relative overflow-hidden">
        {/* Subtle dot grid for testimonials */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.03)_1px,transparent_0)] bg-[size:32px_32px]" />
        
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl relative z-10">
          <motion.div 
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 text-foreground">Loved by builders everywhere</h2>
            <p className="text-muted-foreground">Don't just take our word for it.</p>
          </motion.div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { text: "Formora replaced three different tools in our stack. The conditional logic is incredibly powerful, yet the builder remains fast and intuitive.", author: "Sarah Jenkins", role: "Product Manager at Vertex" },
              { text: "We were able to build a fully HIPAA-compliant patient intake flow in less than an hour. The peace of mind is invaluable to our team.", author: "Dr. Michael Chen", role: "CTO at NovaHealth" },
              { text: "The custom theming capabilities mean our forms finally look like they belong on our website. Conversion rates are up 40%.", author: "Emily Rodriguez", role: "Marketing Director at Quantum" }
            ].map((t, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="bg-card p-8 rounded-3xl border border-border flex flex-col justify-between shadow-sm"
              >
                <div className="mb-8">
                  <div className="flex text-amber-400 mb-4 gap-1">
                    {[...Array(5)].map((_, i) => <Sparkles key={i} size={16} className="fill-amber-400" />)}
                  </div>
                  <p className="text-foreground leading-relaxed font-medium">"{t.text}"</p>
                </div>
                <div>
                  <div className="font-bold text-foreground">{t.author}</div>
                  <div className="text-sm text-muted-foreground">{t.role}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ CTA ═══════════════════ */}
      <section className="py-32 relative overflow-hidden bg-primary/5">
        {/* Deep Grid pattern for CTA */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.04)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_40%,transparent_100%)]" />
        
        <motion.div 
          className="container mx-auto px-4 sm:px-6 lg:px-8 text-center max-w-3xl relative z-10"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeInUp}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-foreground">
            Ready to{' '}
            <span className="relative inline-block text-primary">
              get started
              <HeadingUnderline className="text-primary/40" />
            </span>
            ?
          </h2>
          <p className="text-muted-foreground text-lg mb-10">
            Join thousands of teams building better forms with Formora.
          </p>
          <Link href="/signup" className={buttonVariants({ size: 'lg', className: 'h-14 px-10 text-base rounded-full shadow-lg shadow-primary/25' })}>
            Create your first form
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
