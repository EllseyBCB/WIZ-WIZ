// Wiz-Wiz Studio — Shop-Item / Store-Asset erzeugen (-> Ordner store-assets/).
const { STYLE, slugify, generate } = require('./shared');

async function createShopItem(description) {
  const prompt = `Shop-Item für eine Fantasy-Wizard-App: ${description}. `
    + `Verziertes, goldgerahmtes Item-Icon mit lila Edelstein-Akzenten, mittig, quadratisch. ${STYLE}`;
  return generate({
    label: 'shop-item',
    prompt,
    folderKey: 'store',
    filename: slugify(description) + '.png',
  });
}

module.exports = { createShopItem };
