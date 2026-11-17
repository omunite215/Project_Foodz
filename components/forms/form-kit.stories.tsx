import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BriefcaseBusiness, House, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { Input } from '@/components/ui/input';
import { CheckboxRow, ChoiceChips } from './choice-chips';
import { FieldShell, NewPasswordHint } from './field-shell';
import { FormAlert } from './form-alert';
import { PasswordInput } from './password-input';
import { StatusLine } from './status-line';
import { SubmitButton } from './submit-button';

/*
 * The form kit shared by every sign-in and account form (design 2.1 to 2.7): one field anatomy,
 * the password field, the one-message alert, the submit button's states, chips and checkbox.
 */

const meta = {
  title: 'Forms/Form kit',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Label above, hint below, the error in words with an icon (never colour alone). */
export const FieldStates: Story = {
  render: () => (
    <div className="max-w-[524px] space-y-6">
      <FieldShell
        id="name"
        label="Name"
        hint="We put it on your orders. Couriers see only your first name."
      >
        {(control) => <Input {...control} autoComplete="name" />}
      </FieldShell>
      <FieldShell id="email" label="Email" error="Enter an email address like name@example.com.">
        {(control) => <Input {...control} type="email" defaultValue="maya@example" />}
      </FieldShell>
      <FieldShell
        id="phone"
        label="Phone"
        optional
        hint="Only your courier sees it, and only during a delivery."
      >
        {(control) => <Input {...control} type="tel" readOnly defaultValue="(617) 555-0142" />}
      </FieldShell>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const email = canvas.getByLabelText('Email');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAccessibleDescription(
      'Enter an email address like name@example.com.',
    );
    await expect(canvas.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
  },
};

function NewPassword() {
  const [value, setValue] = useState('');
  return (
    <form className="max-w-[524px]" onSubmit={(event) => event.preventDefault()}>
      <FieldShell
        id="new-password"
        label="Password"
        hint={<NewPasswordHint length={value.length} />}
      >
        {(control) => (
          <PasswordInput
            {...control}
            isNew
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </FieldShell>
    </form>
  );
}

/** "Show password" keeps its name and reports its state; the hint ticks at 10 characters. */
export const PasswordField: Story = {
  render: () => <NewPassword />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText('Password');
    await expect(field).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(field, 'ten chars!');
    const toggle = canvas.getByRole('button', { name: 'Show password' });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(field).toHaveAttribute('type', 'text');
  },
};

/** One message for the whole form, in the four tones. */
export const Alerts: Story = {
  render: () => (
    <div className="max-w-[524px] space-y-4">
      <FormAlert variant="error">
        That email and password don&apos;t match. Try again, or{' '}
        <Link href="/forgot-password">reset your password</Link>.
      </FormAlert>
      <FormAlert variant="success">Password changed. Sign in with your new password.</FormAlert>
      <FormAlert variant="info">
        You&apos;ve been signed out. Sign in again to save your changes.
      </FormAlert>
      <FormAlert variant="warning">
        You have an order on its way. You can delete your account once it&apos;s delivered.
      </FormAlert>
    </div>
  ),
};

/** Idle, pending past 300 ms ("Signing in…"), and blocked with its reason beside it. */
export const SubmitButtons: Story = {
  render: () => (
    <div className="flex max-w-[524px] flex-col gap-4">
      <SubmitButton pending={false} pendingLabel="Signing in…" className="uppercase">
        Sign in
      </SubmitButton>
      <SubmitButton pending pendingLabel="Signing in…" className="uppercase">
        Sign in
      </SubmitButton>
      <div>
        <SubmitButton
          pending={false}
          pendingLabel="Saving…"
          blocked
          aria-describedby="reason"
          className="uppercase"
        >
          Save address
        </SubmitButton>
        <p id="reason" className="mt-2 text-body-5 text-neutral-3">
          We need to check delivery before saving.
        </p>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Signing in…')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Save address' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
};

function SaveAs() {
  const [kind, setKind] = useState<'HOME' | 'WORK' | 'OTHER'>('HOME');
  const [isDefault, setDefault] = useState(false);
  return (
    <div className="max-w-[524px] space-y-6">
      <ChoiceChips
        name="kind"
        legend="Save as"
        value={kind}
        onChange={setKind}
        choices={[
          { value: 'HOME', label: 'Home', icon: House },
          { value: 'WORK', label: 'Work', icon: BriefcaseBusiness },
          { value: 'OTHER', label: 'Other', icon: MapPin },
        ]}
      />
      <CheckboxRow
        id="default"
        label="Use as my default address"
        checked={isDefault}
        onChange={setDefault}
      />
      <StatusLine tone="success">Saved</StatusLine>
    </div>
  );
}

/** Native radios and a checkbox: one Tab stop, arrow keys, and a tick as well as the tint. */
export const ChipsAndCheckbox: Story = {
  render: () => <SaveAs />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Work'));
    await expect(canvas.getByRole('radio', { name: 'Work' })).toBeChecked();
    await userEvent.click(canvas.getByText('Use as my default address'));
    await expect(canvas.getByRole('checkbox', { name: 'Use as my default address' })).toBeChecked();
  },
};
