// Facturering stoppen: alleen bij costAmount > budgetAmount, niets bij een
// lager bedrag of een kapot bericht, en met DRY_RUN alleen loggen. De Cloud
// Billing API is vervangen door een nepversie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verwerkBudgetBericht } from '../facturering.js';

const bericht = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
function nepBilling({ aan = true } = {}) {
  const aanroepen = [];
  return {
    aanroepen,
    getProjectBillingInfo: async (v) => {
      aanroepen.push(['get', v]);
      return [{ billingEnabled: aan, billingAccountName: aan ? 'billingAccounts/0000' : '' }];
    },
    updateProjectBillingInfo: async (v) => {
      aanroepen.push(['update', v]);
      return [{}];
    },
  };
}
const draai = (data, { dryRun, aan } = {}) => {
  const billing = nepBilling({ aan });
  const logs = [];
  return verwerkBudgetBericht({ data, projectId: 'de-moeilijkste-keus', dryRun, billing, log: (s) => logs.push(s) }).then((status) => ({ status, billing, logs }));
};
const BOVEN = bericht({ budgetDisplayName: 'Podiumagenda', costAmount: 5.01, budgetAmount: 5, currencyCode: 'EUR', alertThresholdExceeded: 1 });
const ONDER = bericht({ budgetDisplayName: 'Podiumagenda', costAmount: 4.99, budgetAmount: 5, currencyCode: 'EUR', alertThresholdExceeded: 0.9 });
const GELIJK = bericht({ costAmount: 5, budgetAmount: 5 });

test('onder of gelijk aan het budget: niets (met en zonder DRY_RUN)', async () => {
  for (const dryRun of [true, false]) {
    for (const data of [ONDER, GELIJK]) {
      const r = await draai(data, { dryRun });
      assert.equal(r.status, 'onder-budget');
      assert.deepEqual(r.billing.aanroepen, []);
    }
  }
});

test('boven het budget met DRY_RUN aan: alleen loggen, niets stoppen', async () => {
  const r = await draai(BOVEN, { dryRun: true });
  assert.equal(r.status, 'dry-run');
  assert.deepEqual(r.billing.aanroepen.map((a) => a[0]), ['get']);
  assert.deepEqual(r.logs, ['dry-run']);
});

test('boven het budget met DRY_RUN uit: facturering los van het account', async () => {
  const r = await draai(BOVEN, { dryRun: false });
  assert.equal(r.status, 'gestopt');
  assert.deepEqual(r.billing.aanroepen[1], ['update', { name: 'projects/de-moeilijkste-keus', projectBillingInfo: { billingAccountName: '' } }]);
});

test('boven het budget maar facturering staat al uit: niets', async () => {
  const r = await draai(BOVEN, { dryRun: false, aan: false });
  assert.equal(r.status, 'al-uit');
  assert.deepEqual(r.billing.aanroepen.map((a) => a[0]), ['get']);
});

test('kapot bericht: niets (geen JSON, geen getallen, leeg)', async () => {
  for (const data of [Buffer.from('geen json').toString('base64'), bericht({ costAmount: '9', budgetAmount: 5 }), bericht({ budgetAmount: 5 }), bericht(null), '', undefined, bericht({ costAmount: Infinity, budgetAmount: 5 })]) {
    const r = await draai(data, { dryRun: false });
    assert.equal(r.status, 'kapot-bericht', String(data));
    assert.deepEqual(r.billing.aanroepen, []);
  }
});
