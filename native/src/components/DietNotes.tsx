// 食事の制約（B-18）の免責と警告の見せ方。docs/DIET-MODES.md §5 / §6。
//
// ===== このファイルは訴訟リスク対策の実体である =====
// 免責の文面と「断定しない」見せ方をここに1箇所へ集め、設定・トレイ・メニューの
// どこから使っても同じ強さで出るようにしている。文面を弱める変更を単独でしないこと。
//
// 守っている規約:
// - 「アレルギー」「アレルゲン」「安全」「〜フリー」をUI文字列に使わない（§6-1）
//   ※同意文の「アレルギーや医学的な食事制限のための安全確認には使えません」という
//     否定文だけは、その語を使わずに危険を伝えられないため設計書どおり残す
// - 肯定的断定（安全です・食べられます・OK・緑の✓）を作らない（§6-やらないこと）
// - 触覚・音を鳴らさない（不安を煽らない・§5）
// - 警告のたびに免責を1行添える（§6-3）／無警告時も常設表記を出す（§6-4）
import { View, Text, Pressable, ScrollView } from 'react-native';
import { TriangleAlert, Info } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { t } from '@/lib/i18n';
import { C, rgba, themed } from '@/lib/ui';
import type { DietAlert, DietLevel, DietModeKey } from '@/lib/dietCheck';

// i18nのキー抽出（native/scripts/i18n-keys.js・scripts/translate-loop.mjs）は
// **文字列リテラルの t('...') しか拾わない**。dietRules.ts の label を t(r.label) と
// 動的に渡すと辞書に載らず、英語UIでも日本語のまま出てしまう。
// 免責と警告の文言が訳されないのは安全性の問題なので、ここで必ずリテラルとして書く。
/** プリセットの表示名（翻訳される） */
export function dietModeLabel(key: DietModeKey): string {
  switch (key) {
    case 'vegan': return t('ビーガン');
    case 'vegetarian': return t('ベジタリアン');
    case 'gluten_free': return t('グルテンフリー');
    case 'halal': return t('ハラール');
    case 'dairy_free': return t('乳製品なし');
    default: return '';
  }
}

/** プリセットの補足（設定行のsub。翻訳される） */
export function dietModeSub(key: DietModeKey): string {
  switch (key) {
    case 'vegan': return t('肉・魚・卵・乳・はちみつなど動物由来を避ける');
    case 'vegetarian': return t('肉・魚を避ける（卵・乳は対象にしない）');
    case 'gluten_free': return t('小麦・大麦・ライ麦を避ける');
    case 'halal': return t('豚・アルコールを避ける');
    case 'dairy_free': return t('牛乳・チーズ・バターなど乳由来を避ける');
    default: return '';
  }
}

/**
 * 同意文の4項目（設計書§6-2）。1項目でも欠けたら同意ゲートの意味が薄れるので減らさない。
 * リテラルの t() で書くのは、上と同じ理由（動的キーは辞書に載らない＝英語UIで
 * この免責が日本語のまま出てしまう）。
 */
export function dietConsentLines(): string[] {
  return [
    t('この機能は推定であり、アレルギーや医学的な食事制限のための安全確認には使えません。'),
    t('必ず製品の原材料表示と、店舗・製造者への確認を優先してください。'),
    t('警告が出ないことは、対象が含まれないことを意味しません（見落とします）。'),
    t('重篤なアレルギーがある方は、この機能に依存しないでください。'),
  ];
}

/**
 * 免責パネル。設定「食事の制約」の**最上部に必ず置く**（§3）。
 * 同意済みでも消さない（同意は薄れるため、設定を触るたびに読める場所に残す）。
 */
export function DietDisclaimerPanel() {
  return (
    <View style={s.panel}>
      <View style={s.panelHead}>
        <Info size={15} color={C.coral} />
        <Text style={s.panelTitle}>{t('この機能でできないこと')}</Text>
      </View>
      {dietConsentLines().map((line) => (
        <Text key={line} style={s.panelLine}>{`・${line}`}</Text>
      ))}
    </View>
  );
}

/**
 * 同意チェック行。初回ONの前に必須（チェックしないとONにできない・§3）。
 * 緑の✓ではなく四角のチェックボックスにする（安全そうに見える緑✓を作らない・§6）。
 */
export function DietConsentCheck({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <Pressable style={s.consentRow} onPress={onToggle} hitSlop={6}>
      <View style={[s.box, checked && s.boxOn]}>
        {checked && <Text style={s.boxMark}>✓</Text>}
      </View>
      <Text style={s.consentT}>{t('上記を理解しました（この機能を安全確認には使いません）')}</Text>
    </Pressable>
  );
}

/**
 * 警告行に毎回添える1行の免責＋詳細リンク（§6-3・§5）。
 * リンク先は設定の「食事の制約」＝免責の全文が読める場所。
 */
export function DietEstimateNote({ onDetail }: { onDetail?: () => void }) {
  const router = useRouter();
  return (
    <View style={s.noteRow}>
      <Text style={s.noteT}>{t('これは推定です。原材料表示と、店舗・製造者への確認を優先してください。')}</Text>
      <Pressable hitSlop={8} onPress={onDetail ?? (() => router.push('/settings?open=diet' as never))}>
        <Text style={s.noteLink}>{t('詳しく')}</Text>
      </Pressable>
    </View>
  );
}

/**
 * 無警告時の常設表記（§6-4）。解析結果の下に薄く**常時**出す。
 * 「警告が無い＝安全」と誤読させないための最後の砦なので、条件付きで隠さない。
 */
export function DietSilenceNote() {
  return <Text style={s.silenceT}>{t('表示のない品目も、対象を含む可能性があります。')}</Text>;
}

/** 品目チップに添える小さな印。high=⚠️ / maybe=アンバーの点（§5） */
export function DietMark({ level }: { level: DietLevel }) {
  if (level === 'high') return <Text style={s.markHigh}>⚠️</Text>;
  return <View style={s.markMaybe} />;
}

/**
 * トレイ上部の警告行（§5）。high=赤／maybe=アンバー。
 * 保存はブロックしない（食べたものを記録する自由は奪わない）ので、ここは情報提供だけ。
 */
export function DietWarnRow({ alerts, onDetail }: { alerts: DietAlert[]; onDetail?: () => void }) {
  if (alerts.length === 0) return null;
  const high = alerts.filter((a) => a.level === 'high');
  const maybe = alerts.filter((a) => a.level === 'maybe');
  // 文言の型は設計書§5の表のまま。AI由来（mode無し）は理由を語らせず、
  // 「読み取り」であることだけを示す（AIに断定的な理由を書かせない）
  const highText = (a: DietAlert) => (a.mode
    ? t('「{name}」に{mode}の対象が含まれている可能性が高いです（{word}）', {
        name: a.name, mode: dietModeLabel(a.mode), word: a.reason,
      })
    : t('「{name}」に対象が含まれている可能性が高いです（AIの読み取り）', { name: a.name }));
  const maybeText = (a: DietAlert) => (a.mode
    ? t('「{name}」は製品によって{mode}の対象を含みます（{word}）。表示をご確認ください。', {
        name: a.name, mode: dietModeLabel(a.mode), word: a.reason,
      })
    : t('「{name}」は対象を含む可能性があります。表示をご確認ください。', { name: a.name }));
  return (
    <View style={[s.warn, high.length > 0 ? s.warnHigh : s.warnMaybe]}>
      {/* 品目が多いと警告が縦に伸びてトレイが画面を埋め、下のリストや保存ボタンに
          手が届かなくなる（βフィードバック 2026-09-01）。高さ上限で止めて中だけ流す */}
      <ScrollView style={{ maxHeight: 168 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {high.map((a, i) => (
        <View key={`h${i}-${a.name}`} style={s.warnLine}>
          <TriangleAlert size={13} color={C.coral} />
          <Text style={s.warnHighT}>{highText(a)}</Text>
        </View>
      ))}
      {maybe.map((a, i) => (
        <View key={`m${i}-${a.name}`} style={s.warnLine}>
          <View style={s.markMaybe} />
          <Text style={s.warnMaybeT}>{maybeText(a)}</Text>
        </View>
      ))}
      </ScrollView>
      {/* 免責はスクロールの外に置く（流れて見えなくならないように・§6-3） */}
      <DietEstimateNote onDetail={onDetail} />
    </View>
  );
}

const s = themed(() => ({
  panel: {
    backgroundColor: C.coralWeak, borderRadius: 14, borderWidth: 1, borderColor: rgba(C.coral, 0.3),
    padding: 12, marginBottom: 14,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  panelTitle: { fontSize: 14, fontWeight: '800', color: C.coral },
  panelLine: { fontSize: 12, lineHeight: 18, color: C.ink, marginTop: 2 },

  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  // 緑の✓・丸バッジは使わない（安全そうに見える視覚表現の禁止・§6）
  box: {
    width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: C.line,
    backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { borderColor: C.sub, backgroundColor: C.chipBg },
  boxMark: { fontSize: 13, fontWeight: '800', color: C.ink },
  consentT: { flex: 1, fontSize: 13, lineHeight: 19, color: C.ink, fontWeight: '600' },

  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  noteT: { flex: 1, fontSize: 11, lineHeight: 16, color: C.sub },
  noteLink: { fontSize: 11, fontWeight: '800', color: C.sub, textDecorationLine: 'underline' },

  silenceT: { fontSize: 11, lineHeight: 16, color: C.faint, marginTop: 6 },

  markHigh: { fontSize: 11 },
  markMaybe: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.amber, marginTop: 4 },

  warn: { borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 8 },
  warnHigh: { backgroundColor: C.coralWeak, borderColor: rgba(C.coral, 0.35) },
  warnMaybe: { backgroundColor: rgba(C.amber, 0.12), borderColor: rgba(C.amber, 0.35) },
  warnLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 3 },
  warnHighT: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '700', color: C.ink },
  warnMaybeT: { flex: 1, fontSize: 12, lineHeight: 18, color: C.ink },
}));
