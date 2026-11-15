import 'server-only';
import { processUpload } from '@/server/modules/uploads/service';
import { inngest, uploadReceived } from '../client';

export const processUploadJob = inngest.createFunction(
  {
    id: 'process-upload',
    triggers: [uploadReceived],
    retries: 3,
    // Image work is CPU-heavy; keep a burst of uploads from starving everything else.
    concurrency: { limit: 4 },
  },
  async ({ event, step }) => step.run('check and store', () => processUpload(event.data.uploadId)),
);
