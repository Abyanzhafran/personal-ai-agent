import { id } from '../locales/id';

export type MessageKey = keyof typeof id;
/** Bentuk yang wajib dipenuhi setiap bahasa; bahasa baru cukup `const en: Messages`. */
export type Messages = Record<MessageKey, string>;

export const createT = (messages: Messages) => (key: MessageKey) => messages[key];

const t = createT(id);

/** Bahasa aktif dipilih di sini, bukan di komponen. */
export const useT = () => t;
