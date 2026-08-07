'use client';

import React from 'react';
import { Mail, MessageSquare, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function ContactPage() {
  return (
    <div className="flex flex-col relative font-sans bg-background min-h-screen">
      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            
            {/* Left Info */}
            <div className="flex flex-col justify-center">
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6 text-foreground">
                Get in touch
              </h1>
              <p className="text-lg text-muted-foreground mb-12">
                Have questions about enterprise pricing, custom integrations, or need technical support? Our team is here to help.
              </p>

              <div className="space-y-8">
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Mail size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-lg">Email us</h3>
                    <p className="text-sm text-muted-foreground mb-1">For general inquiries and support.</p>
                    <a href="mailto:hello@formora.app" className="text-primary font-medium hover:underline">hello@formora.app</a>
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <MessageSquare size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-lg">Sales</h3>
                    <p className="text-sm text-muted-foreground mb-1">Talk to our enterprise sales team.</p>
                    <a href="mailto:sales@formora.app" className="text-primary font-medium hover:underline">sales@formora.app</a>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-lg">Office</h3>
                    <p className="text-sm text-muted-foreground">
                      123 Innovation Drive<br/>
                      San Francisco, CA 94103<br/>
                      United States
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Form */}
            <div className="bg-card rounded-3xl p-8 md:p-10 border border-border shadow-xl shadow-primary/5">
              <h2 className="text-2xl font-bold text-foreground mb-6">Send us a message</h2>
              <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First name</Label>
                    <Input id="firstName" placeholder="Jane" className="bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input id="lastName" placeholder="Doe" className="bg-background" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input id="email" type="email" placeholder="jane@company.com" className="bg-background" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <select id="subject" className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                    <option value="general">General Inquiry</option>
                    <option value="sales">Sales & Enterprise</option>
                    <option value="support">Technical Support</option>
                    <option value="partnership">Partnership</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <textarea 
                    id="message" 
                    rows={4} 
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="How can we help you?"
                  />
                </div>

                <Button type="button" className="w-full h-12 text-base rounded-xl shadow-md shadow-primary/20">
                  Send Message
                </Button>
                <p className="text-xs text-center text-muted-foreground mt-4">
                  By submitting this form, you agree to our <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>.
                </p>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
