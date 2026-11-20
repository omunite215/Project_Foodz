import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Check, Clock } from 'lucide-react';
import { Badge } from './badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Status chips: the words carry the meaning; tint and icon only support them. */
export const StatusChips: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Badge variant="success">
        <Check aria-hidden />
        Confirmed
      </Badge>
      <Badge variant="pending">
        <Clock aria-hidden />
        Not confirmed
      </Badge>
      <Badge variant="success">
        <Check aria-hidden />
        Default
      </Badge>
      <Badge variant="neutral">This device</Badge>
    </div>
  ),
};
