// 言語テーブルの登録所。ここに並んでいる辞書は自動的に選択肢として有効になる。
// 新しい言語を足すときは ①<code>.ts を作る ②下の2行（import と DICTS）に追記する だけ。
import { EN } from './en';
import { ZH } from './zh';
import { KO } from './ko';
import { ES } from './es';
import { FR } from './fr';
import { DE } from './de';
import { PT } from './pt';
import { ID } from './id';
import { TH } from './th';
import { VI } from './vi';

export const DICTS: Record<string, Record<string, string>> = {
  en: EN, zh: ZH, ko: KO, es: ES, fr: FR, de: DE, pt: PT, id: ID, th: TH, vi: VI,
};
