// 法則の解説記事（docs/INSIGHTS-ENGINE.md §0・§5・E1b）
// 「あなたの法則」のカードをタップすると開く全画面の記事。Appleヘルスケアの解説記事の骨格に合わせて
//  ①あなたのデータ（法則を導いた生値の要約）②これは何を意味するか ③科学的背景（出典番号つき）
//  ④あなたができること（3つ）⑤医療機関に相談する目安（該当時のみ・アンバー枠）
//  ⑥注意（相関≠因果／個人差／医療機器ではない）⑦出典（タップでDOI/PubMedをアプリ内ブラウザで開く）
// ・本文は content/evidence.ts（{ja,en} の多言語オブジェクト・リモートの laws_text.article で差し替え可）
// ・王冠ゲート: ロック中の法則は②〜⑦をぼかさず「スタンダードで開きます」のカード1枚に置き換える
//   （見出しだけで好奇心の隙間は十分）
// ・遷移パラメータ: kind（LawKind）・p（生値のJSON）・at（発見日）・locked（'1'=ロック中）。
//   生値を持ち回るのは、laws.ts の図鑑ストアを再読込せずに表示できるようにするため（lawTextで文章を再構成）
import { useMemo, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { ChartBar, Lightbulb, FlaskConical, CircleCheck, Stethoscope, ShieldAlert, ScrollText, ExternalLink } from 'lucide-react-native';
import { C, rgba, RADIUS, SPACE, ICON, HEAD, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useGate } from '@/lib/gate';
import { useRemoteContent } from '@/lib/remoteContent';
import CrownBadge from '@/components/CrownBadge';
import { LAW_KINDS, lawText, lawVariant, type LawKind, type LawParams } from '@/lib/laws';
import { getLawArticle, sourceNumber, pickArticleText, COMMON_CAUTIONS, type LawArticle, type EvidenceSource } from '@/content/evidence';

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

// ①あなたのデータ: 法則の生値（LawParams）から描く数値要約。laws.ts は系列データを返さないので
//  ミニチャートではなく「大きな1数字＋根拠の一言」（＋割合のときだけ帯グラフ）で見せる
type DataSummary = {
  value: string;
  unit?: string;
  label: string;
  note: string;
  bar?: { pct: number; left: string; right: string };   // 0..1 の割合（timeslot）
};

// 既存8種だけ生値の形が分かっている。エンジン系の新しい種類（E1a）は E1c で追記するまで①を出さない（null）
function summarize(kind: LawKind, p: LawParams): DataSummary | null {
  switch (kind) {
    case 'food_up':
      return { value: `+${p.kg}`, unit: 'kg', label: t('「{food}」を食べた翌日の体重差（平均）', { food: String(p.food) }), note: t('食べた日{n}日ぶんの比較', { n: Number(p.n) }) };
    case 'food_safe':
      return { value: `-${p.kg}`, unit: 'kg', label: t('「{food}」を食べた翌日の体重差（平均）', { food: String(p.food) }), note: t('食べた日{n}日ぶんの比較', { n: Number(p.n) }) };
    case 'weekday':
      if (p.d === 'stable') return { value: t('安定'), label: t('曜日ごとの摂取の差'), note: t('直近8週の記録から') };
      return { value: `+${Number(p.kcal).toLocaleString()}`, unit: 'kcal', label: t('{d}曜日の平均超過', { d: t(DOW_JA[Number(p.d)] ?? '') }), note: t('直近8週の記録から') };
    case 'binge_trigger':
      return { value: String(p.lift), unit: t('倍'), label: t('「{x}」ときの食べすぎの起きやすさ', { x: t(String(p.label)) }), note: t('記録{n}日ぶんの傾向から', { n: Number(p.n) }) };
    case 'timeslot': {
      const pct = Number(p.pct) || 0;
      return { value: String(pct), unit: '%', label: t('21時以降に食べたカロリーの割合'), note: t('直近4週の食事記録から'), bar: { pct: Math.min(1, Math.max(0, pct / 100)), left: t('21時以降'), right: t('それ以外') } };
    }
    case 'recover':
      return { value: String(p.days), unit: t('日'), label: t('食べすぎのあと体重が戻るまで（平均）'), note: t('過去の食べすぎ{n}回のあとの体重から', { n: Number(p.binges) }) };
    case 'comeback':
      return { value: t('再開'), label: t('記録が途切れたあと、また30日つないだ'), note: t('記録の空白と再開の履歴から') };
    case 'sleep_factor': {
      const min = Number(p.min) || 0;
      return { value: `${p.dir === 'long' ? '+' : '−'}${min}`, unit: t('分'), label: t('21時以降に食べた日の睡眠の差（平均）'), note: t('食べた日{a}日・食べなかった日{b}日の睡眠から', { a: Number(p.late), b: Number(p.off) }) };
    }
    default:
      return null;
  }
}

/** 節の見出し（番号の丸＋アイコン＋題）。概要詳細（changes.tsx の h2Row）と同じ段・余白 */
function SectionHead({ n, icon, title }: { n: number; icon: ReactNode; title: string }) {
  return (
    <View style={s.secHead}>
      <View style={s.secNum}><Text style={s.secNumT}>{n}</Text></View>
      {icon}
      <Text style={s.secT}>{title}</Text>
    </View>
  );
}

/** 出典1行。タップでアプリ内ブラウザ（expo-web-browser）でDOI/PubMedを開く */
function SourceRow({ n, src }: { n: number; src: EvidenceSource }) {
  function open() {
    Haptics.selectionAsync().catch(() => {});
    WebBrowser.openBrowserAsync(src.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC }).catch(() => {});
  }
  return (
    <Pressable style={({ pressed }) => [s.srcRow, pressed && { backgroundColor: C.pressed }]} onPress={open} accessibilityRole="link">
      <Text style={s.srcNum}>{n}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.srcTitle}>{src.title}</Text>
        <Text style={s.srcMeta}>{src.authors}. {src.journal} ({src.year})</Text>
      </View>
      <ExternalLink size={ICON.sm} color={C.faint} />
    </Pressable>
  );
}

export default function LawDetailScreen() {
  const router = useRouter();
  const gate = useGate();
  useRemoteContent();   // リモートの記事差し替えが届いたら再描画
  const params = useLocalSearchParams<{ kind?: string; p?: string; at?: string; locked?: string }>();

  const kind: LawKind | null = LAW_KINDS.includes(params.kind as LawKind) ? (params.kind as LawKind) : null;
  const p = useMemo<LawParams>(() => {
    try { const v = JSON.parse(params.p ?? '{}'); return v && typeof v === 'object' ? (v as LawParams) : {}; } catch { return {}; }
  }, [params.p]);
  const text = kind ? lawText(kind, p) : { title: t('あなたの法則'), sub: '' };
  const variant = kind ? lawVariant(kind, p) : 'default';
  const { article, ready } = getLawArticle(kind ?? '', variant);
  const data = kind ? summarize(kind, p) : null;
  // ロック判定は一覧側の位置（最新3枚以外）に依存するため、一覧が locked=1 を渡す。gateが非activeなら常に開く
  const locked = params.locked === '1' && gate.gated('laws');
  const foundAt = params.at ? String(params.at).slice(5).replace('-', '/') : '';

  function openPaywall() {
    Haptics.selectionAsync().catch(() => {});
    router.push('/paywall?src=law-detail' as never);
  }

  // 節番号は表示する節だけで振る（受診の目安が無い記事は⑤が抜けて詰まる）
  let n = 0;
  const next = () => { n += 1; return n; };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: true, title: '', headerBackTitle: t('戻る'), headerTintColor: C.teal, headerShadowVisible: false, ...(Platform.OS === 'ios' ? { headerTransparent: true } : { headerStyle: { backgroundColor: C.bg } }) }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.scroll}>
        {/* 見出し（法則の一人称の発見文） */}
        <Text style={s.kicker}>{t('あなたの法則')}</Text>
        <Text style={s.h}>{text.title}</Text>
        {!!text.sub && <Text style={s.sub}>{text.sub}</Text>}
        {!!foundAt && <Text style={s.date}>{t('{d} 発見', { d: foundAt })}</Text>}

        {/* ① あなたのデータ */}
        {data && (
          <View style={s.card}>
            <SectionHead n={next()} icon={<ChartBar size={ICON.md} color={C.teal} />} title={t('あなたのデータ')} />
            <View style={s.statRow}>
              <Text style={s.statVal} maxFontSizeMultiplier={1.3}>{data.value}</Text>
              {!!data.unit && <Text style={s.statUnit}>{data.unit}</Text>}
            </View>
            <Text style={s.statLabel}>{data.label}</Text>
            {data.bar && (
              <View style={{ marginTop: 10 }}>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${Math.round(data.bar.pct * 100)}%` }]} />
                </View>
                <View style={s.barLegend}>
                  <Text style={[s.barLegendT, { color: C.teal }]}>{data.bar.left} {Math.round(data.bar.pct * 100)}%</Text>
                  <Text style={s.barLegendT}>{data.bar.right} {100 - Math.round(data.bar.pct * 100)}%</Text>
                </View>
              </View>
            )}
            <Text style={s.statNote}>{data.note}</Text>
          </View>
        )}

        {locked ? (
          // 王冠ゲート: ②〜⑦を1枚のカードに置き換える（ぼかさない。見出し＝法則の一文で好奇心は十分）
          <Pressable style={s.gateCard} onPress={openPaywall}>
            <CrownBadge size={18} />
            <Text style={s.gateT}>{t('スタンダードで開きます')}</Text>
            <Text style={s.gateSub}>{t('この法則の解説（意味・科学的背景・できること・出典）はスタンダードで読めます。')}</Text>
            <View style={s.gateCta}><Text style={s.gateCtaT}>{t('プランを見る')}</Text></View>
          </Pressable>
        ) : (
          <ArticleBody article={article} ready={ready} next={next} />
        )}
      </ScrollView>
    </View>
  );
}

/** ②〜⑦（記事本文）。ロック中は描かれない */
function ArticleBody({ article, ready, next }: { article: LawArticle; ready: boolean; next: () => number }) {
  return (
    <>
      {!ready && (
        <View style={s.prepChip}><Text style={s.prepChipT}>{t('解説は準備中')}</Text></View>
      )}

      {/* ② これは何を意味するか */}
      <View style={s.card}>
        <SectionHead n={next()} icon={<Lightbulb size={ICON.md} color={C.teal} />} title={t('これは何を意味するか')} />
        <Text style={s.body}>{pickArticleText(article.meaning)}</Text>
      </View>

      {/* ③ 科学的背景 */}
      <View style={s.card}>
        <SectionHead n={next()} icon={<FlaskConical size={ICON.md} color={C.teal} />} title={t('科学的背景')} />
        {article.science.map((para, i) => (
          <Text key={i} style={[s.body, i > 0 && { marginTop: 10 }]}>
            {pickArticleText(para.text)}
            {para.refs.map((r) => sourceNumber(article, r)).filter((k) => k > 0).map((k) => (
              <Text key={k} style={s.ref}>{` [${k}]`}</Text>
            ))}
          </Text>
        ))}
      </View>

      {/* ④ あなたができること（チェック風の3行） */}
      <View style={s.card}>
        <SectionHead n={next()} icon={<CircleCheck size={ICON.md} color={C.teal} />} title={t('あなたができること')} />
        {article.actions.map((a, i) => (
          <View key={i} style={[s.actRow, i > 0 && s.actRowSep]}>
            <View style={s.actCheck}><CircleCheck size={ICON.lg} color={C.teal} /></View>
            <Text style={s.actT}>{pickArticleText(a)}</Text>
          </View>
        ))}
      </View>

      {/* ⑤ 医療機関に相談する目安（該当時のみ・アンバー枠） */}
      {!!article.seeDoctor && (
        <View style={[s.card, s.amberCard]}>
          <SectionHead n={next()} icon={<Stethoscope size={ICON.md} color={C.amber} />} title={t('医療機関に相談する目安')} />
          <Text style={s.body}>{pickArticleText(article.seeDoctor)}</Text>
        </View>
      )}

      {/* ⑥ 注意（記事固有＋共通） */}
      <View style={s.card}>
        <SectionHead n={next()} icon={<ShieldAlert size={ICON.md} color={C.sub} />} title={t('注意')} />
        {[...(article.caution ? [article.caution] : []), ...COMMON_CAUTIONS].map((c, i) => (
          <View key={i} style={s.noteRow}>
            <Text style={s.noteDot}>•</Text>
            <Text style={s.noteT}>{pickArticleText(c)}</Text>
          </View>
        ))}
      </View>

      {/* ⑦ 出典 */}
      {article.sources.length > 0 && (
        <View style={s.card}>
          <SectionHead n={next()} icon={<ScrollText size={ICON.md} color={C.teal} />} title={t('出典')} />
          <Text style={s.srcLead}>{t('タップするとアプリ内ブラウザで論文ページ（PubMed / DOI）を開きます。')}</Text>
          {article.sources.map((src, i) => <SourceRow key={src.url} n={i + 1} src={src} />)}
        </View>
      )}
    </>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen, paddingTop: 8, paddingBottom: 56 },
  kicker: { fontSize: 12.5, fontWeight: '800', color: C.teal, marginBottom: 6, letterSpacing: 0.3 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, lineHeight: 30 },
  sub: { fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 18 },
  date: { fontSize: 11.5, color: C.faint, marginTop: 4, marginBottom: 14, fontVariant: ['tabular-nums'] },
  card: {
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
    borderRadius: RADIUS.card, padding: SPACE.card, marginBottom: 12,
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  // 節の見出し（changes.tsx の h2Row/h2 と同じ段: HEAD.card・gap 6・下余白 8）
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  secNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  secNumT: { fontSize: 12, fontWeight: '900', color: C.teal, fontVariant: ['tabular-nums'] },
  secT: { ...HEAD.card, color: C.ink, flex: 1 },
  body: { fontSize: 14.5, color: C.ink, lineHeight: 23 },
  ref: { fontSize: 12, fontWeight: '800', color: C.teal },
  // ① あなたのデータ（changes.tsx の detailVal/detailUnit と同じ大数字の段）
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statVal: { fontSize: 36, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  statUnit: { fontSize: 16, fontWeight: '700', color: C.sub },
  statLabel: { fontSize: 13.5, fontWeight: '700', color: C.sub, marginTop: 2 },
  statNote: { fontSize: 12, color: C.faint, marginTop: 8 },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: C.track, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5, backgroundColor: C.teal },
  barLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  barLegendT: { fontSize: 11.5, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  // ④ できること
  actRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 9 },
  actRowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  actCheck: { marginTop: 2 },
  actT: { flex: 1, fontSize: 14.5, color: C.ink, lineHeight: 22 },
  // ⑤ 受診の目安（アンバー枠）
  amberCard: { borderWidth: 1, borderColor: rgba(C.amber, 0.45), backgroundColor: rgba(C.amber, 0.08) },
  // ⑥ 注意
  noteRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  noteDot: { fontSize: 13, color: C.faint, lineHeight: 19 },
  noteT: { flex: 1, fontSize: 13, color: C.sub, lineHeight: 19 },
  // ⑦ 出典
  srcLead: { fontSize: 12, color: C.faint, lineHeight: 17, marginBottom: 6 },
  srcRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, borderRadius: RADIUS.input },
  srcNum: { width: 20, fontSize: 12.5, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  srcTitle: { fontSize: 13, fontWeight: '700', color: C.ink, lineHeight: 18 },
  srcMeta: { fontSize: 11.5, color: C.sub, marginTop: 2, lineHeight: 16 },
  // 準備中チップ
  prepChip: { alignSelf: 'flex-start', backgroundColor: C.chipBg, borderRadius: RADIUS.chip, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  prepChipT: { fontSize: 11.5, fontWeight: '700', color: C.sub },
  // 王冠ゲート（CrownBadge と同じアンバーの淡いトーン。責め色にしない）
  gateCard: { alignItems: 'center', gap: 6, backgroundColor: C.panel, borderWidth: 1, borderColor: rgba(C.amber, 0.35), borderRadius: RADIUS.card, padding: 22, marginBottom: 12 },
  gateT: { fontSize: 16, fontWeight: '800', color: C.ink, marginTop: 4 },
  gateSub: { fontSize: 13, color: C.sub, lineHeight: 19, textAlign: 'center' },
  gateCta: { backgroundColor: C.teal, borderRadius: RADIUS.input, paddingVertical: 11, paddingHorizontal: 24, marginTop: 10 },
  gateCtaT: { fontSize: 14, fontWeight: '800', color: '#fff' },
}));
