import { exportEarningsReport } from '@/server/modules/earnings/service';
import { fileResponse, staffRoute } from '@/server/route';

/** F9 A64: every row of the payouts report for a range and filter, as CSV. ADMIN only. */
export const POST = staffRoute({
  name: 'admin.earnings-export',
  rateLimit: 'report.export',
  permission: { earnings: ['report'] },
  handler: async ({ actor, body }) =>
    fileResponse({
      ...(await exportEarningsReport(actor, body)),
      contentType: 'text/csv; charset=utf-8',
    }),
});
