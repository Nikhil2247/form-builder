'use client';

import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Daily views/responses area chart.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Split out of the analytics page so `recharts` sits behind a `next/dynamic`
 * boundary. It is by far the heaviest dependency on that route, and the four
 * summary tiles above it — the numbers most visits are actually there for —
 * used to wait on it before painting.
 *
 * Keep this the module's default export; `dynamic()` resolves it by identity.
 */

export interface ActivityPoint {
  date: string;
  label: string;
  submissions: number;
  views: number;
}

export default function ActivityChart({ data }: { data: ActivityPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="fill-submissions" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="fill-views" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            // A 365-day range would otherwise print 365 overlapping labels.
            interval={Math.max(0, Math.floor(data.length / 8) - 1)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)' }}
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: 12,
              color: 'var(--popover-foreground)',
            }}
            labelStyle={{ color: 'var(--muted-foreground)', marginBottom: 4 }}
          />
          <Area
            type="monotone"
            dataKey="views"
            name="Views"
            stroke="var(--chart-3)"
            fill="url(#fill-views)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="submissions"
            name="Responses"
            stroke="var(--chart-1)"
            fill="url(#fill-submissions)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
