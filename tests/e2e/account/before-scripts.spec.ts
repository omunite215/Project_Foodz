import type { Page } from '@playwright/test';
import { ACCOUNTS, expect, signUp, test, uniqueEmail } from './support';

/*
 * On a slow connection the page's HTML arrives before its scripts. A press on the submit button,
 * or Enter in a field, must then never send what was typed in the address: the browser's own GET
 * would leave a password in the history and in request logs. With JavaScript off, the page stays
 * in that state for good.
 */

const SECRET = 'NotInAnyAddress-42';

/** Every URL the page asks for while the test runs. */
function watchUrls(page: Page) {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

const FORMS = [
  {
    path: '/sign-in',
    form: 'Sign in',
    submit: 'Sign in',
    fields: [
      ['Email', ACCOUNTS.second],
      ['Password', SECRET],
    ],
  },
  {
    path: '/sign-up',
    form: 'Create an account',
    submit: 'Create account',
    fields: [
      ['Name', 'Maya Lopez'],
      ['Email', 'maya@example.com'],
      ['Password', SECRET],
    ],
  },
  {
    path: '/reset-password?token=abc123',
    form: 'Choose a new password',
    submit: 'Save new password',
    fields: [['New password', SECRET]],
  },
  {
    path: '/forgot-password',
    form: 'Reset your password',
    submit: 'Send reset link',
    fields: [['Email', 'maya@example.com']],
  },
] as const;

test.describe('Before the scripts run, nothing typed reaches the address (security S1)', () => {
  test.use({ javaScriptEnabled: false });

  for (const { path, form: name, submit, fields } of FORMS) {
    test(`${name}: posts, and waits for the page`, async ({ page }) => {
      const urls = watchUrls(page);
      await page.goto(path);
      const form = page.getByRole('form', { name });
      await expect(form).toHaveAttribute('method', 'post');
      await expect(form.getByRole('button', { name: submit })).toBeDisabled();

      for (const [label, value] of fields) {
        await form.getByLabel(label, { exact: true }).fill(value);
      }
      // Enter in the last field: with the form's button disabled, the browser sends nothing.
      await form.getByLabel(fields.at(-1)![0], { exact: true }).press('Enter');

      // Even a submit that got through would carry the fields in its body, not in the address.
      const value = encodeURIComponent(fields.at(-1)![1]);
      const posted = page.waitForRequest((request) => request.method() === 'POST');
      await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
      expect((await posted).postData()).toContain(value);
      expect(
        urls.filter((url) => url.includes(value) || /[?&](password|email)=/i.test(url)),
      ).toEqual([]);
    });
  }

  test('account forms: post, and wait for the page', async ({
    page,
    browser,
    baseURL,
    clientIp,
  }) => {
    // Signed in with scripts on (as the network the other tests use), then looked at without.
    const helper = await browser.newContext({ baseURL, javaScriptEnabled: true });
    await helper.route(`${baseURL}/**`, (route) =>
      route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': clientIp } }),
    );
    await signUp(await helper.newPage(), { email: uniqueEmail('noscript') });
    await page.context().addCookies(await helper.cookies());
    await helper.close();

    for (const { path, form: name, submit } of [
      { path: '/account', form: 'Profile', submit: 'Save changes' },
      { path: '/account/privacy/delete', form: 'Delete your account', submit: 'Delete my account' },
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      // These pages stream in behind their skeleton. React's small inline script that swaps them
      // in runs before the page's own scripts do, so the form can be pressed before them; with
      // scripts off it stays in the server's HTML, hidden, which is what is read here.
      const form = page.getByRole('form', { name, includeHidden: true });
      await expect(form).toHaveAttribute('method', 'post');
      await expect(form.getByRole('button', { name: submit, includeHidden: true })).toBeDisabled();
    }
  });
});
