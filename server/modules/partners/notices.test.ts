import { describe, expect, it } from 'vitest';
import { letterEmail } from '@/server/notifications/email';
import { offlineNoticeText, PARTNER_NOTICES, partnerEmail } from './notices';

const facts = {
  firstName: 'Jonas',
  siteUrl: 'https://foodz.example',
  applicantText: null,
  reapplyFrom: '2026-12-17',
};

describe('partner notices (design 11, D23)', () => {
  it('never carries a reviewer text in a notice body', () => {
    for (const notice of Object.values(PARTNER_NOTICES)) {
      expect(notice.body).not.toMatch(/Reason:/);
      expect(notice.type).toMatch(/^partner\./);
    }
  });

  it('words the automatic offline notices with the time', () => {
    expect(offlineNoticeText('no-location', '6:42 pm').body).toBe(
      "We took you offline at 6:42 pm because we hadn't had your location for 10 minutes.",
    );
    expect(offlineNoticeText('kitchen-closed', '11 pm')).toMatchObject({
      type: 'partner.offline-kitchen-closed',
      body: 'Foodz Kitchen closed at 11 pm, so we took you offline.',
    });
  });
});

describe('partner emails (B17, P7.4, P7.5)', () => {
  it('leaves the reason line out entirely when there is none', () => {
    const email = partnerEmail('rejected', facts);
    expect(email.subject).toBe('About your Foodz partner application');
    expect(email.paragraphs).toContain(
      "We can't share more detail here. If you have questions, contact us.",
    );
    expect(email.paragraphs).toContain('You can apply again from Thu, Dec 17, 2026.');
    expect(JSON.stringify(email.paragraphs)).not.toContain('Reason:');
  });

  it('quotes the reviewer text as its own escaped paragraph, never as markup', () => {
    const email = partnerEmail('sent-back', {
      ...facts,
      applicantText: '<img src=x onerror=alert(1)>',
    });
    const rendered = letterEmail(email);
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&#60;img src=x onerror=alert(1)&#62;');
    expect(rendered.text).toContain('<img src=x onerror=alert(1)>');
  });

  it('links the decision emails to the partner app', () => {
    expect(partnerEmail('approved', facts)).toMatchObject({
      subject: "You're approved to deliver with Foodz",
      url: 'https://foodz.example/partner',
    });
    expect(partnerEmail('suspended', facts).url).toBe('https://foodz.example/contact');
  });
});
