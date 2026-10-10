import AppProvider from '@/components/AppProvider';
import AppShell from '@/components/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
