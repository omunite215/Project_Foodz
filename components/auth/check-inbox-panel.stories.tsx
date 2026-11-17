import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Button } from '@/components/ui/button';
import { CheckInboxPanel } from './check-inbox-panel';

const meta = {
  title: 'Auth/CheckInboxPanel',
  component: CheckInboxPanel,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-[462px]">
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'Check your email',
    children:
      "If there's a Foodz account for maya@example.com, we've sent it a link to reset the password. The link works for 30 minutes. Check your spam folder too.",
    actions: (
      <>
        <Button variant="outline" size="touch">
          Use a different email
        </Button>
        <Button variant="ghost" size="touch">
          Back to sign in
        </Button>
      </>
    ),
  },
} satisfies Meta<typeof CheckInboxPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Replaces the forgot-password form; the heading takes focus. */
export const ResetRequested: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { name: 'Check your email' }),
    ).toHaveFocus();
  },
};

/** A long address wraps instead of overflowing. */
export const LongEmail: Story = {
  args: {
    title: 'Check your inbox',
    children:
      "Welcome, Maya. We sent a link to maya.lopez-ruiz.with.a.very.long.address@subdomain.example.com to confirm your email. You'll need it before your first order.",
  },
};
