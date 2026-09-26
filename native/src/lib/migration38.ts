// migration-38（logs.overfull / logs.alcohol / entries.craving / entries.stress）が未適用のDBでも
// アプリが壊れないための共通判定（lib/activeApply.ts の isMissingActiveKcalColumn と同じ流儀）。
//  ・読み取り: 列を名指しした select が落ちたら列無しで読み直す（各呼び出し側）
//  ・書き込み: 失敗したら「migration-38 が未適用の可能性」と伝える（黙って失敗しない）
import { t } from './i18n';

export function isMissingMigration38Column(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === 'PGRST204' || /overfull|alcohol|craving|stress|column|schema/i.test(String(err.message ?? ''));
}

/** 書き込み失敗時の案内文（設定に失敗の一般文言と区別する） */
export function migration38Hint(): string {
  return t('保存できませんでした（データベースの更新 migration-38 が未適用の可能性）。');
}
