'use client';

import React, { useState } from 'react';
import { Bell, Check, FormInput, UserPlus, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';

const INITIAL_NOTIFICATIONS = [
  {
    id: '1',
    title: 'New form submission',
    description: 'You received a new submission on "Customer Feedback Survey".',
    type: 'submission',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: '2',
    title: 'Team invitation accepted',
    description: 'Sarah joined your organization as an Editor.',
    type: 'team',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: '3',
    title: 'System update',
    description: 'We have updated the form builder with new features.',
    type: 'system',
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
  }
];

const ICONS = {
  submission: FormInput,
  team: UserPlus,
  system: Info,
};

const COLORS = {
  submission: 'bg-emerald-500/10 text-emerald-600',
  team: 'bg-blue-500/10 text-blue-600',
  system: 'bg-purple-500/10 text-purple-600',
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="w-full max-w-4xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Bell className="text-primary" size={24} /> 
            Notifications
            {unreadCount > 0 && (
              <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {unreadCount}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Stay updated with activity across your organizations.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={markAllAsRead} disabled={unreadCount === 0}>
          <Check size={16} /> Mark all as read
        </Button>
      </div>

      <div className="space-y-3">
        {notifications.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50 border-dashed">
            <Bell size={32} className="mx-auto mb-3 opacity-20" />
            <p>You have no notifications.</p>
          </div>
        ) : (
          notifications.map((notif) => {
            const Icon = ICONS[notif.type as keyof typeof ICONS] || Bell;
            const colorClass = COLORS[notif.type as keyof typeof COLORS] || 'bg-muted text-muted-foreground';

            return (
              <Card 
                key={notif.id} 
                className={`p-4 transition-colors flex items-start gap-4 border-border shadow-sm ${!notif.read ? 'bg-primary/5' : 'bg-card'}`}
              >
                <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${colorClass}`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className={`text-sm font-semibold truncate ${!notif.read ? 'text-foreground' : 'text-foreground/80'}`}>
                      {notif.title}
                    </h3>
                    <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className={`mt-1 text-sm ${!notif.read ? 'text-foreground/90' : 'text-muted-foreground'}`}>
                    {notif.description}
                  </p>
                </div>
                {!notif.read && (
                  <button 
                    onClick={() => markAsRead(notif.id)}
                    className="shrink-0 mt-1 h-2.5 w-2.5 rounded-full bg-primary"
                    title="Mark as read"
                  />
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
