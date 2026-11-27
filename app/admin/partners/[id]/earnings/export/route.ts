import { exportPartnerEntries } from '@/server/modules/earnings/service';
import { fileResponse, staffRoute } from '@/server/route';

/** F9 A64.4: one partner's entries for a range, as CSV. ADMIN only. */
export const POST = staffRoute({
  name: 'admin.earnings-entries-export',
  rateLimit: 'report.export',
  permission: { earnings: ['report'] },
  handler: async ({ actor, body, params }) =>
    fileResponse({
      ...(await exportPartnerEntries(actor, params.id ?? '', body)),
      contentType: 'text/csv; charset=utf-8',
    }),
});
