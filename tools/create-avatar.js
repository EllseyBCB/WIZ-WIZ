// Wiz-Wiz Studio — Avatar-Portrait erzeugen (-> Ordner avatars/).
const { STYLE, slugify, generate } = require('./shared');

async function createAvatar(description) {
  const prompt = `Avatar-Portrait für eine Fantasy-Wizard-App: ${description}. `
    + `Ikonisches Charakter-Kopfbild, detailliert, mittig, in verziertem rundem Rahmen. ${STYLE}`;
  return generate({
    label: 'avatar',
    prompt,
    folderKey: 'avatars',
    filename: slugify(description) + '.png',
  });
}

module.exports = { createAvatar };
