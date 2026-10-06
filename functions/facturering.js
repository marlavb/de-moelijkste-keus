// Facturering stoppen bij overschrijding van het budget (Cloud Billing
// budgetmelding via Pub/Sub). Zonder Cloud Functions-afhankelijkheden (zie
// index.js), zodat de tests de Billing API kunnen vervangen.
//
// Wat er gebeurt als de facturering stopt: het project gaat terug naar het
// gratis Spark-abonnement. Cloud Functions (de uitnodigingsmail en deze stop)
// werken dan niet meer, en Firestore valt terug op de gratis dagquota (te
// veel reads of writes worden dan geweigerd tot de volgende dag). De app op
// GitHub Pages en het inloggen blijven werken. Weer aanzetten: in de console
// het project opnieuw aan het factureringsaccount koppelen (Blaze) en de
// functions zo nodig opnieuw deployen (zie debug/stap5-instructies.md).

/**
 * `data` = de base64-data van het Pub/Sub-bericht. Stopt alleen als
 * costAmount > budgetAmount; doet niets bij een lager bedrag of een kapot
 * bericht. Met `dryRun` alleen loggen. Geeft een status terug.
 */
export async function verwerkBudgetBericht({ data, projectId, dryRun, billing, log = () => {} }) {
  let melding;
  try {
    melding = JSON.parse(Buffer.from(String(data ?? ''), 'base64').toString('utf8'));
  } catch {
    log('kapot-bericht');
    return 'kapot-bericht';
  }
  const kosten = melding?.costAmount;
  const budget = melding?.budgetAmount;
  if (typeof kosten !== 'number' || typeof budget !== 'number' || !Number.isFinite(kosten) || !Number.isFinite(budget)) {
    log('kapot-bericht');
    return 'kapot-bericht';
  }
  if (!(kosten > budget)) return 'onder-budget';

  const naam = `projects/${projectId}`;
  const [info] = await billing.getProjectBillingInfo({ name: naam });
  if (!info?.billingEnabled) {
    log('al-uit');
    return 'al-uit';
  }
  if (dryRun) {
    log('dry-run', { kosten, budget });
    return 'dry-run';
  }
  await billing.updateProjectBillingInfo({ name: naam, projectBillingInfo: { billingAccountName: '' } });
  log('gestopt', { kosten, budget });
  return 'gestopt';
}
