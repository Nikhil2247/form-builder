'use client';

import React, { useState } from 'react';
import { Search, ShieldAlert, FileText, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useAdminAuditLogs } from '@/hooks/use-admin';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function AdminAuditLogsPage() {
  const [search, setSearch] = useState('');
  
  const { data: logData, isLoading } = useAdminAuditLogs(1, 50, '');

  return (
    <div className="w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <FileText className="text-muted-foreground" size={24} /> 
            Audit Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">System-wide audit trail of all actions.</p>
        </div>
      </div>

      {/* Logs Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input 
              type="text" 
              placeholder="Search logs..." 
              className="pl-8 h-9 text-xs bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="font-medium text-muted-foreground">Action</TableHead>
                <TableHead className="font-medium text-muted-foreground">Actor</TableHead>
                <TableHead className="font-medium text-muted-foreground">Target</TableHead>
                <TableHead className="font-medium text-muted-foreground">IP Address</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Loading audit logs...
                  </TableCell>
                </TableRow>
              ) : (logData?.data || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No audit logs found.
                  </TableCell>
                </TableRow>
              ) : (logData?.data || []).map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <Badge variant="outline" className="text-xs uppercase bg-background font-mono">
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {log.actorId || 'System'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono text-xs">
                    {log.targetId || '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {log.ipAddress || 'Unknown'}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    <div className="flex items-center justify-end gap-1">
                      <Calendar size={12} />
                      {new Date(log.createdAt).toLocaleString()}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
