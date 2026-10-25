'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** [token, description key: admin.tokens.<key>] */
export const TOKENS: [string, string][] = [['{TYPE}', 'type'], ['{YYYY}', 'yyyy'], ['{YY}', 'yy'], ['{SEQ:n}', 'seq']];
export const DOC_TOKENS: [string, string][] = [['{DOC}', 'doc'], ...TOKENS.slice(1)];

/** Same substitution as generateCode() on the server, with the first sequence number */
export function previewCode(format: string | undefined, type: string | null, doc: string | null = null) {
  if (!format) return '';
  const yyyy = String(new Date().getFullYear());
  let fmt = format.replaceAll('{YYYY}', yyyy).replaceAll('{YY}', yyyy.slice(2)).replaceAll('{DOC}', doc ?? '');
  fmt = type ? fmt.replaceAll('{TYPE}', type) : fmt.replaceAll('-{TYPE}', '').replaceAll('{TYPE}', '');
  return fmt.replace(/\{SEQ:(\d+)\}/g, (_, n) => '1'.padStart(Number(n), '0'));
}

export function TokenHints({ tokens }: { tokens: [string, string][] }) {
  const t = useTranslations('admin.tokens');
  return (
    <div className="flex flex-wrap gap-1.5">
      {tokens.map(([token, d]) => (
        <Tooltip key={token}>
          <TooltipTrigger asChild><Badge variant="outline" className="cursor-help font-mono">{token}</Badge></TooltipTrigger>
          <TooltipContent>{t(d as 'type')}</TooltipContent>
        </Tooltip>
      ))}
      <span className="self-center text-xs text-muted-foreground">{t('hover')}</span>
    </div>
  );
}
