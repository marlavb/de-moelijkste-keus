import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blokkeerZwareBronnen } from '../src/lib/zwareBronnen.js';

// Nep-pagina: verzamelt de route-handler; `stuur` laat er een verzoek door.
function nepPagina() {
  const hoofd = { naam: 'hoofd' };
  let handler;
  return {
    mainFrame: () => hoofd,
    route: async (_patroon, h) => void (handler = h),
    stuur: async (type, frame) => {
      let uitkomst;
      await handler({
        request: () => ({ resourceType: () => type, frame: () => frame ?? hoofd }),
        abort: async () => void (uitkomst = 'geblokkeerd'),
        fallback: async () => void (uitkomst = 'door'),
      });
      return uitkomst;
    },
  };
}

test('blokkeerZwareBronnen: iframes alleen met ookOverig geblokkeerd, het hoofddocument nooit', async () => {
  const page = nepPagina();
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  assert.equal(await page.stuur('document'), 'door');
  assert.equal(await page.stuur('document', { naam: 'tix-iframe' }), 'geblokkeerd');
  assert.equal(await page.stuur('other'), 'geblokkeerd');
  assert.equal(await page.stuur('image'), 'geblokkeerd');
  assert.equal(zwaar.verzoeken(), 1);

  const zonder = nepPagina();
  await blokkeerZwareBronnen(zonder, { ookScripts: true });
  assert.equal(await zonder.stuur('document', { naam: 'tix-iframe' }), 'door');
});
