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
        {/* Dot grid background */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.04)_1px,transparent_0)] bg-[size:32px_32px]" />
        {/* Radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        
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
      <section className="py-24 relative">
        {/* Grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
        
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

      {/* ═══════════════════ CTA ═══════════════════ */}
      <section className="py-32 relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.03)_1px,transparent_0)] bg-[size:24px_24px]" />
        
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
