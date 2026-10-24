import type { Metadata } from 'next';
import { Figtree, Poppins } from 'next/font/google';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree' });
const poppins = Poppins({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-poppins' });

export const metadata: Metadata = {
  title: 'TBKK Project Control Workspace',
  description: 'System Service Project Control Workspace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${poppins.variable}`}>
      <body className="bg-app font-sans antialiased">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <ConfirmDialogHost />
        <Toaster theme="light" position="bottom-center" richColors />
        {/* live notifications (useLiveNotifications): top-right, below the 56px header, plain white */}
        <Toaster id="live" theme="light" position="top-right" offset={{ top: 64, right: 16 }} visibleToasts={4} closeButton />
      </body>
    </html>
  );
}
