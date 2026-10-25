'use client';

import { Ban, Check, Hourglass, MessageCircleQuestion, Rocket, Send, Undo2, X, type LucideIcon } from 'lucide-react';

export type Act = 'approve' | 'reject' | 'send_back' | 'request_more_info';
/** labels: requestDetail.act.<act>.label / .short */
export const ACT_META: Record<Act, { icon: LucideIcon; tone: 'success' | 'destructive' | 'warning' | 'secondary'; required: boolean }> = {
  approve: { icon: Check, tone: 'success', required: false },
  reject: { icon: X, tone: 'destructive', required: true },
  send_back: { icon: Undo2, tone: 'warning', required: true },
  request_more_info: { icon: MessageCircleQuestion, tone: 'secondary', required: true },
};

/** step status labels: requestDetail.stepStatus.<status> */
type Tone = { icon: LucideIcon; fg: string; bg: string };
export const STEP_META: Record<string, Tone> = {
  approved: { icon: Check, fg: '#00854d', bg: '#e3f8ee' },
  waiting: { icon: Hourglass, fg: '#b45309', bg: '#fff1d6' },
  rejected: { icon: X, fg: '#d83a52', bg: '#fdebee' },
  sent_back: { icon: Undo2, fg: '#b45309', bg: '#fff1d6' },
  more_info: { icon: MessageCircleQuestion, fg: '#784bd1', bg: '#f1eafc' },
};
export const HISTORY_META: Record<string, Tone> = {
  submit: { icon: Send, fg: '#0073ea', bg: '#e6f1fd' },
  resubmit: { icon: Send, fg: '#0073ea', bg: '#e6f1fd' },
  approve: STEP_META.approved,
  reject: STEP_META.rejected,
  send_back: STEP_META.sent_back,
  request_more_info: STEP_META.more_info,
  cancel: { icon: Ban, fg: '#676879', bg: '#eef0f4' },
  convert: { icon: Rocket, fg: '#00854d', bg: '#e3f8ee' },
};

export function Bubble({ tone, children }: { tone: Pick<Tone, 'fg' | 'bg'>; children: React.ReactNode }) {
  return (
    <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-card" style={{ background: tone.bg, color: tone.fg }}>
      {children}
    </span>
  );
}
