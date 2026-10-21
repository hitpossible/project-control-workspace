/**
 * Browser (OS-level) notifications. The permission itself belongs to the browser and cannot be revoked
 * from code, so the on/off switch on the Notifications page is a per-browser preference on top of it.
 */
const PREF_KEY = 'pcw:desktop-notify';
export const ASKED_KEY = 'pcw:desktop-notify-asked';

/** unsupported = no API or not a secure context (plain http on a LAN address); blocked = user denied it */
export type DesktopStatus = 'unsupported' | 'blocked' | 'ask' | 'on' | 'off';

export function desktopSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window;
}

export function desktopStatus(): DesktopStatus {
  if (!desktopSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'default') return 'ask';
  return localStorage.getItem(PREF_KEY) === 'off' ? 'off' : 'on';
}

/** Turning on asks for permission when needed — call it from a click handler */
export async function setDesktopEnabled(on: boolean): Promise<DesktopStatus> {
  localStorage.setItem(ASKED_KEY, '1');
  localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  if (on && desktopSupported() && Notification.permission === 'default') await Notification.requestPermission();
  return desktopStatus();
}

export function showDesktop(n: { title: string; body?: string | null; tag?: string; onClick?: () => void }) {
  if (desktopStatus() !== 'on') return;
  const d = new Notification(n.title, { body: n.body ?? undefined, tag: n.tag, icon: '/brand/logo.png' });
  d.onclick = () => {
    window.focus();
    n.onClick?.();
    d.close();
  };
}
