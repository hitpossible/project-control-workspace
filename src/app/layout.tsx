import type { Metadata } from 'next';
import { Figtree, Poppins } from 'next/font/google';
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
        <Toaster theme="light" position="bottom-center" richColors />
      </body>
    </html>
  );
}
