// SPDX-License-Identifier: AGPL-3.0-or-later

const STRINGS = {
  en: {
    title: 'My Pocket Nutrition',
    siteName: 'My journal',
    language: 'Language',
    loginHeading: 'Open your journal',
    journalHeading: 'Your journal',
    newcomerTitle: 'No account yet?',
    newcomer: 'Accounts are created in the Pocket Nutrition app, under Cloud vault: there is no sign-up on this page. Once your phone has synced, log in here with the same username and passphrase.',
    getApp: 'Get the app',
    forgotten: 'Forgot your passphrase? Nobody can recover it for you. Use your emergency kit, or set a new one from a phone that is still logged in.',
    webDevice: 'While you read, this browser is listed as “Web browser” in your devices in the app. Log out when you are done: that unlinks it.',
    intro: 'Read your journal from this browser. It is decrypted here, on this page: your passphrase never leaves it.',
    username: 'Username',
    passphrase: 'Passphrase',
    login: 'Open my vault',
    working: 'Unlocking…',
    loading: 'Reading your vault…',
    errCredentials: 'Wrong username or passphrase.',
    errTwoFactor: 'That code did not work. Check it and try again.',
    twoFactorIntro: 'Two-factor login is on for this account. Enter the code from your authenticator app.',
    twoFactorCode: 'Code',
    recoveryCode: 'Recovery code',
    useRecoveryCode: 'Use a recovery code',
    useTwoFactorCode: 'Use an authenticator code',
    cancel: 'Cancel',
    errLocked: (minutes) => minutes ? `Too many attempts. Try again in ${minutes} min.` : 'Too many attempts. Try again later.',
    errOffline: 'Could not reach the vault. Check your connection.',
    errServer: 'The vault had a problem. Try again later.',
    errUnreadable: 'The vault answered, but your keys could not be opened by this page.',
    errUsername: 'Enter your username and passphrase.',
    errUnsafe: 'The server asked for security settings that are too weak. Login refused as a precaution.',
    errSession: 'Your session ended. Open your vault again.',
    journal: 'Journal',
    dictations: 'Dictations',
    export: 'Export CSV',
    logout: 'Log out',
    emptyJournal: 'No meals in this vault yet. Meals saved on your phone appear here once it has synced.',
    emptyDictations: 'No dictations.',
    meals: (n) => `${n} meal${n === 1 ? '' : 's'}`,
    readOnly: 'Read only. To change your journal, use the app.',
    idle: 'Logged out after a few minutes of inactivity.',
    kcal: 'kcal', protein: 'protein', carbs: 'carbs', fat: 'fat',
    // contract: nutrients.proteinAbbr / carbsAbbr / fatAbbr, and the apps' meal slot names.
    proteinAbbr: 'P', carbsAbbr: 'C', fatAbbr: 'F',
    slots: { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' },
  },
  fr: {
    title: 'Mon Pocket Nutrition',
    siteName: 'Mon journal',
    language: 'Langue',
    loginHeading: 'Ouvrir votre journal',
    journalHeading: 'Votre journal',
    newcomerTitle: 'Pas encore de compte ?',
    newcomer: 'Les comptes se créent dans l’application Pocket Nutrition, rubrique Coffre-fort : cette page ne permet pas de s’inscrire. Une fois votre téléphone synchronisé, connectez-vous ici avec le même identifiant et la même phrase secrète.',
    getApp: 'Installer l’application',
    forgotten: 'Phrase secrète oubliée ? Personne ne peut la retrouver pour vous. Utilisez votre kit de secours, ou choisissez-en une nouvelle depuis un téléphone encore connecté.',
    webDevice: 'Pendant la lecture, ce navigateur figure comme « Web browser » dans vos appareils, dans l’application. Déconnectez-vous en partant : cela le dissocie de votre compte.',
    intro: 'Lisez votre journal depuis ce navigateur. Il est déchiffré ici, dans cette page : votre phrase secrète ne la quitte jamais.',
    username: 'Identifiant',
    passphrase: 'Phrase secrète',
    login: 'Ouvrir mon coffre-fort',
    working: 'Déverrouillage…',
    loading: 'Lecture de votre coffre-fort…',
    errCredentials: 'Identifiant ou phrase secrète incorrect.',
    errTwoFactor: 'Ce code n’a pas fonctionné. Vérifiez-le et réessayez.',
    twoFactorIntro: 'La double authentification est activée sur ce compte. Saisissez le code de votre application d’authentification.',
    twoFactorCode: 'Code',
    recoveryCode: 'Code de secours',
    useRecoveryCode: 'Utiliser un code de secours',
    useTwoFactorCode: 'Utiliser un code d’authentification',
    cancel: 'Annuler',
    errLocked: (minutes) => minutes ? `Trop de tentatives. Réessayez dans ${minutes} min.` : 'Trop de tentatives. Réessayez plus tard.',
    errOffline: 'Impossible de joindre le coffre-fort. Vérifiez votre connexion.',
    errServer: 'Le coffre-fort a rencontré un problème. Réessayez plus tard.',
    errUnreadable: 'Le coffre-fort a répondu, mais cette page n’a pas pu ouvrir vos clés.',
    errUsername: 'Saisissez votre identifiant et votre phrase secrète.',
    errUnsafe: 'Le serveur a demandé des paramètres de sécurité trop faibles. Connexion refusée par précaution.',
    errSession: 'Votre session est terminée. Ouvrez de nouveau votre coffre-fort.',
    journal: 'Journal',
    dictations: 'Dictées',
    export: 'Exporter en CSV',
    logout: 'Se déconnecter',
    emptyJournal: 'Aucun repas dans ce coffre-fort pour l’instant. Les repas enregistrés sur votre téléphone apparaissent ici une fois synchronisés.',
    emptyDictations: 'Aucune dictée.',
    meals: (n) => `${n} repas`,
    readOnly: 'Lecture seule. Pour modifier votre journal, utilisez l’application.',
    idle: 'Déconnecté après quelques minutes d’inactivité.',
    kcal: 'kcal', protein: 'protéines', carbs: 'glucides', fat: 'lipides',
    proteinAbbr: 'P', carbsAbbr: 'G', fatAbbr: 'L',
    slots: { breakfast: 'Petit-déjeuner', lunch: 'Déjeuner', snack: 'En-cas', dinner: 'Dîner' },
  },
};

export function pickLanguage(languages) {
  return (languages ?? []).some((lang) => String(lang).toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}

export function strings(languages = globalThis.navigator?.languages) {
  return STRINGS[pickLanguage(languages)];
}

/** The languages the switch offers, in its order. */
export const LANGUAGES = ['en', 'fr'];

/** Strings for a language picked on the page; anything unknown falls back to English. */
export function stringsFor(lang) {
  return STRINGS[lang] ?? STRINGS.en;
}

/** For tests: both languages must name the same things. */
export const STRING_TABLES = STRINGS;
