'use client';

import { useEffect, useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { History, Plus, Send, Sparkles, X } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Message, MessageContent, MessageGroup } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { MarkdownLite } from './MarkdownLite';
import { formatCost } from '@/components/shared/formatters';
import { useUser } from '@/hooks/use-auth';
import { atLeastOrgRole } from '@/config/roles';
import {
  useAskAssistant,
  useAskPlatformAssistant,
  useAssistantSessions,
  useLoadAssistantSession,
  useLoadPlatformAssistantSession,
  usePlatformAssistantSessions,
  type AskAssistantResult,
  type AssistantCreated,
  type AssistantClarify,
  type AssistantPlan,
  type AssistantSession,
  type AssistantTimeseriesPoint,
} from '@/hooks/use-assistant';
import type { ActivityPoint } from '@/components/analytics/ActivityChart';

// Same next/dynamic boundary the dashboard uses — recharts stays out of the
// initial bundle for everyone who never opens this panel.
const ActivityChart = dynamic(() => import('@/components/analytics/ActivityChart'), {
  loading: () => <Skeleton className="h-48 w-full" />,
});

type Mode = 'auto' | 'help' | 'insights' | 'build' | 'platform';

const MODE_META: Record<
  Mode,
  { label: string; hint?: string; placeholder: string; empty: string }
> = {
  auto: {
    label: 'Auto',
    placeholder: 'Ask anything…',
    empty:
      "Ask how to do something, what your data shows, or describe a form to create — I'll figure out how to help.",
  },
  help: {
    label: 'Help',
    hint: 'the user selected Help mode — favor how-to guidance over data or generation',
    placeholder: 'Ask how to do something…',
    empty: 'Ask how to build a form, add a validation or calculation rule, or set up a Form App.',
  },
  insights: {
    label: 'Insights',
    hint: "the user selected Insights mode — favor this organization's form and response data over how-to guidance",
    placeholder: 'Ask about your data…',
    empty:
      'Ask about response counts, completion rates, trends, or your busiest forms. Answers are always based on aggregated numbers, never individual responses.',
  },
  build: {
    label: 'Build',
    hint: 'the user selected Build mode — favor creating or reviewing forms over how-to guidance or data questions',
    placeholder: 'Describe a form or program…',
    empty:
      'Describe a form or multi-step program to get a draft, ask for a matching template, or ask for a review of a form you already have.',
  },
  platform: {
    label: 'Platform',
    placeholder: 'Ask across organizations…',
    empty: 'Ask about platform-wide totals, compare organizations, or check quota usage.',
  },
};

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  clarify?: AssistantClarify;
  chartData?: AssistantTimeseriesPoint[];
  plan?: AssistantPlan;
  created?: AssistantCreated;
  costUsd?: number;
}

export interface AssistantPanelProps {
  /**
   * The form currently open in the builder, if any. Passed through so
   * explain_rule/propose_rule work on "this form" without the user having to
   * name it.
   */
  currentFormId?: string;
}

/**
 * The one assistant panel (AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.6, Phase C) —
 * replaces HelpChatPanel/InsightsChatPanel/IdeaChatPanel. Every capability is
 * available regardless of the mode chip selected; the chips only change the
 * placeholder/empty copy and a short hint line sent with the turn
 * (`modeHint`) — never the tool list or system prompt the backend uses, so
 * switching chips mid-conversation cannot fork the cached prefix.
 *
 * Feature-flag- and permission-gated by the caller — see the Header trigger.
 */
export function AssistantPanel({ currentFormId }: AssistantPanelProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('auto');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();

  const { data: userSession } = useUser();
  const isSuperAdmin = userSession?.user.systemRole === 'SUPER_ADMIN';
  const isOrgAdmin = atLeastOrgRole(userSession?.activeOrganization?.role, 'ADMIN');
  const isPlatform = mode === 'platform';

  const askOrg = useAskAssistant();
  const askPlatform = useAskPlatformAssistant();
  const asking = isPlatform ? askPlatform : askOrg;

  const orgSessions = useAssistantSessions({ enabled: open && historyOpen && !isPlatform });
  const platformSessions = usePlatformAssistantSessions({ enabled: open && historyOpen && isPlatform });
  const sessionsQuery = isPlatform ? platformSessions : orgSessions;

  const loadOrgSession = useLoadAssistantSession();
  const loadPlatformSession = useLoadPlatformAssistantSession();
  const loadingSession = isPlatform ? loadPlatformSession : loadOrgSession;

  function resumeSession(id: string) {
    const loader = isPlatform ? loadPlatformSession : loadOrgSession;
    loader.mutate(id, {
      onSuccess: (loaded) => {
        setTurns(sessionToTurns(loaded));
        setSessionId(loaded.id);
        setHistoryOpen(false);
      },
    });
  }

  useEffect(() => {
    // Cancel an in-flight turn when the panel closes, rather than leaving it
    // to land on a closed panel (AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.7, R8).
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    // ⌘J / Ctrl+J — ⌘K is already the global command menu (command-menu.tsx).
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'j' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const meta = MODE_META[mode];
  const sessionCost = isOrgAdmin ? sumCost(turns) : undefined;

  function startNewChat() {
    abortRef.current?.abort();
    setTurns([]);
    setSessionId(undefined);
    setInput('');
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || asking.isPending) return;

    setTurns((prev) => [...prev, { id: `turn-${prev.length}-u`, role: 'user', text: trimmed }]);
    setInput('');

    const controller = new AbortController();
    abortRef.current = controller;

    const onDone = (result: AskAssistantResult) => {
      abortRef.current = null;
      setSessionId(result.sessionId);
      setTurns((prev) => [
        ...prev,
        {
          id: `turn-${prev.length}-a`,
          role: 'assistant',
          text: result.reply,
          clarify: result.clarify,
          chartData: result.chartData,
          plan: result.plan,
          created: result.created,
          costUsd: result.costUsd,
        },
      ]);
    };
    const onFail = (error: unknown) => {
      abortRef.current = null;
      // The user cancelled — don't show an error bubble for that.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setTurns((prev) => [
        ...prev,
        {
          id: `turn-${prev.length}-err`,
          role: 'assistant',
          text: "I couldn't reach the assistant just now — please try again.",
        },
      ]);
    };

    if (isPlatform) {
      askPlatform.mutate(
        { message: trimmed, sessionId, signal: controller.signal },
        { onSuccess: onDone, onError: onFail },
      );
    } else {
      askOrg.mutate(
        {
          message: trimmed,
          sessionId,
          currentFormId,
          modeHint: meta.hint,
          signal: controller.signal,
        },
        { onSuccess: onDone, onError: onFail },
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" aria-label="Ask AI" title="Ask AI (⌘J)" />}
      >
        <Sparkles className="size-4" strokeWidth={1.5} />
      </SheetTrigger>

      <SheetContent side="right" className="flex flex-col sm:max-w-md">
        <SheetHeader className="gap-3">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>Ask AI</SheetTitle>
            <div className="flex items-center gap-1">
              <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon" aria-label="Chat history" />}
                >
                  <History className="size-4" strokeWidth={1.5} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Recent chats</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {sessionsQuery.isLoading && (
                    <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>
                  )}
                  {sessionsQuery.data?.sessions.length === 0 && (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      No previous chats yet.
                    </div>
                  )}
                  {sessionsQuery.data?.sessions.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      disabled={loadingSession.isPending}
                      onClick={() => resumeSession(s.id)}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="w-full truncate text-sm">{s.title || 'Untitled chat'}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(s.updatedAt), { addSuffix: true })}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="icon"
                aria-label="New chat"
                onClick={startNewChat}
                disabled={turns.length === 0}
              >
                <Plus className="size-4" strokeWidth={1.5} />
              </Button>
            </div>
          </div>

          <ModeToggle mode={mode} onChange={setMode} showPlatform={!!isSuperAdmin} />
        </SheetHeader>

        <MessageScrollerProvider>
          <MessageScroller className="min-h-0 flex-1 px-4">
            <MessageScrollerViewport>
              <MessageScrollerContent>
                {turns.length === 0 && (
                  <p className="px-1 text-sm text-muted-foreground">{meta.empty}</p>
                )}

                {turns.map((turn) => (
                  <MessageScrollerItem key={turn.id}>
                    <MessageGroup>
                      <Message align={turn.role === 'user' ? 'end' : 'start'}>
                        <MessageContent>
                          <Bubble
                            align={turn.role === 'user' ? 'end' : 'start'}
                            variant={turn.role === 'user' ? 'default' : 'muted'}
                          >
                            <BubbleContent>
                              {turn.role === 'user' ? (
                                <p className="whitespace-pre-wrap text-sm">{turn.text}</p>
                              ) : (
                                <MarkdownLite text={turn.text} />
                              )}
                            </BubbleContent>
                          </Bubble>

                          {turn.clarify?.options && turn.clarify.options.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {turn.clarify.options.map((option) => (
                                <Button
                                  key={option}
                                  variant="outline"
                                  size="sm"
                                  disabled={asking.isPending}
                                  onClick={() => send(option)}
                                >
                                  {option}
                                </Button>
                              ))}
                            </div>
                          )}

                          {turn.chartData && turn.chartData.length > 0 && (
                            <div className="w-full rounded-lg border border-border p-2">
                              <ActivityChart data={toActivityPoints(turn.chartData)} />
                            </div>
                          )}

                          {turn.plan && (
                            <PlanCard
                              plan={turn.plan}
                              disabled={asking.isPending}
                              onConfirm={() => send('Yes — create it.')}
                              onDiscard={() => send("Don't create it — discard that plan.")}
                            />
                          )}

                          {turn.created && <CreatedCard created={turn.created} />}

                          {isOrgAdmin && turn.role === 'assistant' && turn.costUsd !== undefined && (
                            <span className="text-[11px] text-muted-foreground">
                              {formatCost(turn.costUsd)}
                            </span>
                          )}
                        </MessageContent>
                      </Message>
                    </MessageGroup>
                  </MessageScrollerItem>
                ))}

                {asking.isPending && (
                  <MessageScrollerItem>
                    <Message align="start">
                      <MessageContent>
                        <Bubble variant="muted">
                          <BubbleContent>
                            <Spinner />
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>

        <SheetFooter className="gap-2">
          {isOrgAdmin && sessionCost !== undefined && sessionCost > 0 && (
            <div className="px-1 text-xs text-muted-foreground">
              This chat so far: {formatCost(sessionCost)}
            </div>
          )}
          <form
            className="flex w-full items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <Textarea
              id={inputId}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={meta.placeholder}
              className="min-h-9 flex-1"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send(input);
                }
              }}
            />
            {asking.isPending ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Cancel"
                onClick={() => abortRef.current?.abort()}
              >
                <X className="size-4" strokeWidth={1.5} />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
                <Send className="size-4" strokeWidth={1.5} />
              </Button>
            )}
          </form>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ModeToggle({
  mode,
  onChange,
  showPlatform,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  showPlatform: boolean;
}) {
  const modes: Mode[] = showPlatform
    ? ['auto', 'help', 'insights', 'build', 'platform']
    : ['auto', 'help', 'insights', 'build'];

  return (
    <div className="flex w-fit gap-0.5 rounded-lg bg-muted p-0.5">
      {modes.map((m) => (
        <Button
          key={m}
          type="button"
          variant={mode === m ? 'default' : 'ghost'}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => onChange(m)}
        >
          {MODE_META[m].label}
        </Button>
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  disabled,
  onConfirm,
  onDiscard,
}: {
  plan: AssistantPlan;
  disabled: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const outline = plan.outline;
  const isFormApp = plan.kind === 'FORM_APP';

  return (
    <Card className="gap-2 p-3">
      <div className="text-sm font-medium">
        {isFormApp ? outline.appName : outline.title}
      </div>
      {isFormApp ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>Tracks: {outline.subjectTypeName}</div>
          {outline.steps?.map((step, index) => (
            <div key={index}>
              {index + 1}. {step.title} ({step.questionCount} question
              {step.questionCount === 1 ? '' : 's'})
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {outline.questionCount} question{outline.questionCount === 1 ? '' : 's'}
          {outline.questions && outline.questions.length > 0 && (
            <>: {outline.questions.slice(0, 4).join(', ')}
              {outline.questions.length > 4 ? ', …' : ''}
            </>
          )}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" disabled={disabled} onClick={onConfirm}>
          Create draft
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </Card>
  );
}

function CreatedCard({ created }: { created: AssistantCreated }) {
  if (created.kind === 'FORM' && created.formId) {
    return (
      <Card className="gap-1 p-3">
        <div className="text-sm font-medium">{created.title}</div>
        <div className="text-xs text-muted-foreground">
          {created.questionCount} question{created.questionCount === 1 ? '' : 's'} — saved as a
          draft
        </div>
        <Link
          href={`/forms/builder?id=${created.formId}`}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Open in builder →
        </Link>
      </Card>
    );
  }

  if (created.kind === 'FORM_APP' && created.formApp) {
    return (
      <Card className="gap-1 p-3">
        <div className="text-sm font-medium">{created.formApp.name}</div>
        <div className="text-xs text-muted-foreground">
          {created.steps?.length ?? 0} step{created.steps?.length === 1 ? '' : 's'} — saved as
          drafts
        </div>
        <Link
          href={`/apps/${created.formApp.id}`}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Open in builder →
        </Link>
      </Card>
    );
  }

  return null;
}

function sessionToTurns(session: AssistantSession): ChatTurn[] {
  return session.messages
    .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT')
    .map((m, index) => ({
      id: `${session.id}-${index}`,
      role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
      text: m.content?.text ?? '',
      costUsd: m.costUsd ? Number(m.costUsd) : undefined,
    }));
}

function sumCost(turns: ChatTurn[]): number {
  return turns.reduce((sum, turn) => sum + (turn.costUsd ?? 0), 0);
}

/**
 * `ActivityChart` expects one row per day with no gaps — mirrors the fill the
 * main dashboard applies to its own sparse `FormAnalytics` result.
 */
function toActivityPoints(series: AssistantTimeseriesPoint[]): ActivityPoint[] {
  if (series.length === 0) return [];

  const byDate = new Map(
    series.map((point) => [
      new Date(point.date).toISOString().slice(0, 10),
      { submissions: point.submissions ?? 0, views: point.views ?? 0 },
    ]),
  );

  const dates = [...byDate.keys()].sort();
  const cursor = new Date(dates[0]);
  const end = new Date(dates[dates.length - 1]);
  const points: ActivityPoint[] = [];

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const entry = byDate.get(key);
    points.push({
      date: key,
      label: cursor.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      submissions: entry?.submissions ?? 0,
      views: entry?.views ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return points;
}
