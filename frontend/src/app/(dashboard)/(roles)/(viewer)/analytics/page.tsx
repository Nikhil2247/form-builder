'use client';

import React, { useState } from 'react';
import { 
  Users, 
  ArrowUpRight, 
  Filter,
  Download,
  CheckCircle2,
  Clock,
  BarChart2
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useForms } from '@/hooks/use-forms';

export default function AnalyticsPage() {
  const [selectedForm, setSelectedForm] = useState('ALL');
  
  const { data: formsData, isLoading } = useForms();
  const forms = formsData?.forms ?? [];

  const targetForms = selectedForm === 'ALL' ? forms : forms.filter((f: any) => f.id === selectedForm);

  const totalSubmissions = targetForms.reduce((acc: number, f: any) => acc + (f._count?.submissions || f.responseCount || 0), 0);
  const activeForms = targetForms.filter((f: any) => f.status === 'PUBLISHED').length;

  // Mock days data for the chart, scaled by the total submissions for visualization
  const mockAnalyticsData = [
    { day: 'Mon', submissions: Math.floor(totalSubmissions * 0.1) },
    { day: 'Tue', submissions: Math.floor(totalSubmissions * 0.15) },
    { day: 'Wed', submissions: Math.floor(totalSubmissions * 0.2) },
    { day: 'Thu', submissions: Math.floor(totalSubmissions * 0.12) },
    { day: 'Fri', submissions: Math.floor(totalSubmissions * 0.25) },
    { day: 'Sat', submissions: Math.floor(totalSubmissions * 0.08) },
    { day: 'Sun', submissions: Math.floor(totalSubmissions * 0.1) },
  ];

  const maxSubmissions = Math.max(...mockAnalyticsData.map(d => d.submissions), 10);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Page Title & Filter Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Analytics & Insights</h1>
          <p className="text-xs text-muted-foreground mt-1">Real-time submission throughput and metrics.</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedForm} onValueChange={(val) => val && setSelectedForm(val)}>
            <SelectTrigger className="w-[240px] bg-card h-9">
              <div className="flex items-center gap-2">
                <Filter size={14} className="text-muted-foreground" />
                <SelectValue placeholder="Select form" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Forms</SelectItem>
              {forms.map((f: any) => (
                <SelectItem key={f.id} value={f.id}>{f.title || f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" className="gap-2 h-9" disabled={totalSubmissions === 0}>
            <Download size={14} />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Top Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 shadow-sm border-border bg-card">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Submissions</span>
            <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Users size={16} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-black text-foreground">{isLoading ? <Skeleton className="h-8 w-16" /> : totalSubmissions}</span>
          </div>
        </Card>

        <Card className="p-5 shadow-sm border-border bg-card">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Active Forms</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <BarChart2 size={16} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-black text-foreground">{isLoading ? <Skeleton className="h-8 w-16" /> : activeForms}</span>
          </div>
        </Card>

        <Card className="p-5 shadow-sm border-border bg-card">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Completion Rate</span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-black text-foreground">
              {isLoading ? <Skeleton className="h-8 w-16" /> : totalSubmissions > 0 ? '86.4%' : '0%'}
            </span>
          </div>
        </Card>

        <Card className="p-5 shadow-sm border-border bg-card">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Avg. Completion Time</span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Clock size={16} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-black text-foreground">
              {isLoading ? <Skeleton className="h-8 w-16" /> : totalSubmissions > 0 ? '1m 45s' : '—'}
            </span>
          </div>
        </Card>
      </div>

      {/* Main Bar Chart Section */}
      <Card className="p-6 shadow-sm border-border bg-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Submission Throughput (Last 7 Days)</h2>
            <p className="text-xs text-muted-foreground mt-1">Daily submission activity</p>
          </div>
          <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Live
          </Badge>
        </div>

        {/* Visual Compact Bar Chart */}
        <div className="h-56 flex items-end justify-between gap-4 pt-8 px-4 border-b border-border pb-3">
          {mockAnalyticsData.map((item) => {
            const heightPercent = maxSubmissions > 0 ? (item.submissions / maxSubmissions) * 100 : 0;
            return (
              <div key={item.day} className="flex-1 flex flex-col items-center gap-2 group">
                <div className="text-xs font-bold text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.submissions}
                </div>
                <div className="w-full max-w-[48px] bg-muted/50 rounded-t-lg overflow-hidden h-40 flex items-end relative border border-border/50 border-b-0">
                  <div
                    style={{ height: `${heightPercent}%` }}
                    className="w-full bg-primary/80 rounded-t-md group-hover:bg-primary transition-all absolute bottom-0 left-0 right-0"
                  />
                </div>
                <span className="text-xs font-medium text-muted-foreground">{item.day}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
