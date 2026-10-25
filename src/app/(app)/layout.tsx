import AppProvider from '@/providers/AppProvider';
import AppShell from '@/components/layout/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
