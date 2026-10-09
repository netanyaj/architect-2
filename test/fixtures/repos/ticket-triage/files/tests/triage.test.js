import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleTriage } from '../server/triage.js';

test('outage is P1', () => {
  assert.equal(ruleTriage({ subject: 'Checkout is down', body: '' }).priority, 'P1');
});

test('billing tickets go to Billing', () => {
  assert.equal(ruleTriage({ subject: 'Refund not received', body: 'charged twice' }).team, 'Billing');
});

// Known failing test: SSO login problems should be P1, but the rules say P2/P3.
test('SSO login failure is P1', () => {
  assert.equal(ruleTriage({ subject: 'SSO broken for our team', body: 'whole team locked out since the certificate update' }).priority, 'P1');
});
