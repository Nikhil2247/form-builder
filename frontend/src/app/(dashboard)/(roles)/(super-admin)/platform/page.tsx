'use client';

import React from 'react';
import Link from 'next/link';
import {
  Globe, Building2, Users, FileBox, BarChart2, TrendingUp,
  ArrowUpRight, ChevronRight, Shield, Activity,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminDashboard } from '@/hooks/use-admin';

export default function PlatformOverviewPage() {
  const { data, isLoading } = useAdminDashboard();

  const stats = [
    {
      label: 'Total Organizations',
      value: data?.stats?.totalOrgs ?? data?.totalOrganizations ?? '—',
      icon: Building2,
      href: '/platform/organizations',
      color: 'bg-card border-border hover:border-primary/50',
      iconColor: 'text-primary',
    },
    {
      label: 'Total Users',
      value: data?.stats?.totalUsers ?? data?.totalUsers ?? '—',
      icon: Users,
      href: '/platform/users',
      color: 'bg-card border-border hover:border-primary/50',
      iconColor: 'text-primary',
    },
    {
      label: 'Total Forms',
      value: data?.stats?.totalForms ?? data?.totalForms ?? '—',
      icon: FileBox,
      color: 'bg-card border-border',
      iconColor: 'text-primary',
    },
    {
      label: 'Total Submissions',
      value: data?.stats?.totalSubmissions ?? data?.totalSubmissions ?? '—',
      icon: BarChart2,
      color: 'bg-card border-border',
      iconColor: 'text-primary',
    },
  ];

  const quickLinks = [
    { label: 'Manage Organizations', href: '/platform/organizations', icon: Building2, desc: 'View, suspend, and manage quotas' },
    { label: 'Manage Users', href: '/platform/users', icon: Users, desc: 'Browse all platform users' },
    { label: 'Global Audit Logs', href: '/global-audit', icon: Shield, desc: 'Full platform activity trail' },
  ];

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Globe size={22} className="text-primary" /> Platform Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Real-time health and metrics across all organizations.</p>
        </div>
        <div className="flex h-9 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3">
          <Activity size={13} className="text-emerald-600 animate-pulse" />
          <span className="text-xs font-semibold text-emerald-600">Platform Healthy</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const CardContent = (
            <Card className={`group rounded-xl border p-5 shadow-sm transition-all ${stat.href ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : ''} ${stat.color}`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{stat.label}</span>
                <Icon size={16} className={stat.iconColor} />
              </div>
              <div className="mt-4">
                {isLoading ? (
                  <Skeleton className="h-8 w-20 rounded" />
                ) : (
                  <span className="text-3xl font-black text-foreground">
                    {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                  </span>
                )}
              </div>
              {stat.href && (
                <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                  View all <ChevronRight size={12} />
                </div>
              )}
            </Card>
          );

          if (stat.href) {
            return (
              <Link key={stat.label} href={stat.href}>
                {CardContent}
              </Link>
            );
          }

          return <div key={stat.label}>{CardContent}</div>;
        })}
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.label} href={link.href}>
                <Card className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-primary/30 hover:bg-primary/5 cursor-pointer">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{link.label}</p>
                    <p className="text-xs text-muted-foreground">{link.desc}</p>
                  </div>
                  <ChevronRight size={16} className="ml-auto text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
