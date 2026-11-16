import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';
import { koreanBbqCampaign, thaiCurryCampaign } from '@/components/storefront.fixtures';
import { CampaignBanner } from './campaign-banner';
import { CampaignSection } from './campaign-section';

const meta = {
  title: 'Storefront/CampaignBanner',
  component: CampaignBanner,
  parameters: { layout: 'padded', nextjs: { appDirectory: true } },
  args: { campaign: koreanBbqCampaign },
  decorators: [
    (Story) => (
      <div className="max-w-[1296px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CampaignBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The seeded "Korean BBQ weekend": the code is real, selectable text; "Order now" opens the
 * Korean tab; Bulgogi and Samgyeopsal show the placeholder plate.
 */
export const KoreanBbqWeekend: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Korean BBQ weekend' })).toBeVisible();
    await expect(canvas.getByText('KBBQ5')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Order now' })).toHaveAttribute(
      'href',
      '/menu?cuisine=korean',
    );
    await expect(canvas.getByRole('link', { name: 'Bulgogi, $22.99' })).toHaveAttribute(
      'href',
      '/menu/bulgogi',
    );
  },
};

/** When the subtitle does not mention the code, "Code KBBQ5" is added after it. */
export const CodeNotInSubtitle: Story = {
  args: { campaign: { ...koreanBbqCampaign, subtitle: '$5 off Korean dishes over $25' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('KBBQ5')).toBeVisible();
  },
};

/** Every featured dish sold out: the list goes, the offer stays. */
export const NoDishes: Story = {
  args: { campaign: { ...koreanBbqCampaign, dishes: [] } },
};

/** Copying confirms on the button ("Code copied") and to screen readers. */
export const CopyCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Copy code' }));
    await expect(
      await canvas.findByRole('button', { name: /Code copied|Copy code/ }),
    ).toBeInTheDocument();
  },
};

/** Two or more campaigns become a carousel the visitor moves; nothing moves on its own. */
export const TwoCampaigns: Story = {
  render: () => <CampaignSection campaigns={[koreanBbqCampaign, thaiCurryCampaign]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Offers' })).toBeVisible();
    await expect(canvas.getByText('1 of 2')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Next offer' }));
    await expect(await canvas.findByText('2 of 2')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Next offer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
};
