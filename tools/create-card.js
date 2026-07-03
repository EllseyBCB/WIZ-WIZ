// Wiz-Wiz Studio — einzelne Sammelkarte erzeugen (-> Ordner cards/).
const { STYLE, slugify, generate } = require('./shared');

async function createCard(description) {
  const prompt = `Sammelkarten-Artwork für ein Fantasy-Kartenspiel: ${description}. `
    + `Hochkant-Spielkarte mit goldenem Rahmen, magischem Motiv und lila Leuchten. ${STYLE}`;
  return generate({
    label: 'card',
    prompt,
    folderKey: 'cards',
    filename: slugify(description) + '.png',
  });
}

module.exports = { createCard };
