// N1「今日の予定ヒアリング（朝の1問）」のカード（docs/STRATEGY.md §6朝・§7 N1）
//
// 戦略のどのゲートに効くか: ③次の行動／④成長実感／⑤明日開く理由。
// 「今日は外食の予定ありますか？」に1タップ答えると、その日の配分（ヒーロー下の司令塔行）が変わる。
//
// 【質問攻めにしないための約束（lib/dayPlan.ts に判定を集約）】
//  - 1日1回・朝（〜11時）・今日を見ているときだけ。答えたら即畳む
//  - 2問目（「何時ごろ？」）は外食・飲み会を選んだときだけ許可。トレーニングと「ない」は1問で終わり
//  - 「聞かないで」で以後この質問を出さない（bl-day-plan-ask-off）
//  - チートデイ登録済みの日は出さない（既存の吸収と重複した緩和は嘘になる。判定は planEffect/shouldAskPlan）
//  - ヒーロー直下の枚数はカード調停（lib/logCards.ts）に従う。このコンポーネントは出す/出さないを判断しない
import { useState } from 'react';
import { View, Text, Pressable, Modal, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CalendarClock } from 'lucide-react-native';
import { Chip, OptionButton } from '@/components/ui/Selectable';
import { t, apiLang } from '@/lib/i18n';
import { C, RADIUS, ICON, themed } from '@/lib/ui';
import {
  AT_PRESETS, EST_STEP, clampEst, estKcalOf, needsTimeQuestion,
  type DayPlan, type DayPlanKind,
} from '@/lib/dayPlan';
import { fmtHm, parseHm, roundHm } from '@/lib/timeSlots';

/** 1問目の選択肢（横並びチップ）。「ない」を先頭に置く＝いちばん多い答えを最短で */
const KINDS: readonly DayPlanKind[] = ['none', 'eatout', 'drink', 'workout'];

function kindLabel(k: DayPlanKind): string {
  switch (k) {
    case 'none': return t('ない');
    case 'eatout': return t('外食');
    case 'drink': return t('飲み会');
    case 'workout': return t('トレーニング');
  }
}

export default function TodayPlanCard({ onAnswer, onAskOff }: {
  /** 回答（null=「ない」も DayPlan{kind:'none'} で渡す）。保存は呼び出し側の責務 */
  onAnswer: (plan: DayPlan) => void;
  /** 「聞かないで」。以後この質問を出さない */
  onAskOff: () => void;
}) {
  // 1問目の答え。'none' と 'workout' はその場で確定するので state に残らない
  const [kind, setKind] = useState<DayPlanKind | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [est, setEst] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState(new Date());

  function choose(k: DayPlanKind) {
    if (needsTimeQuestion(k)) {
      // 2問目だけ許可（時刻）。想定kcalは既定値から始め、±チップで直せる
      setKind(k); setAt(null); setEst(null);
      return;
    }
    onAnswer({ kind: k });   // 「ない」「トレーニング」は1問で終わり＝即畳む
  }

  function commit(atValue: string | null) {
    if (!kind) return;
    const plan: DayPlan = { kind };
    if (atValue) plan.at = atValue;
    const e = est ?? estKcalOf({ kind });
    plan.estKcal = e;
    onAnswer(plan);
  }

  const estNow = kind ? (est ?? estKcalOf({ kind })) : 0;

  return (
    <View style={s.card}>
      <View style={s.head}>
        <CalendarClock size={ICON.md} color={C.teal} strokeWidth={ICON.stroke} />
        <Text style={s.title} numberOfLines={2}>
          {kind == null ? t('今日は外食の予定ありますか？') : t('何時ごろ？')}
        </Text>
      </View>

      {kind == null ? (
        <>
          <View style={s.chips}>
            {KINDS.map((k) => (
              <Chip key={k} label={kindLabel(k)} onPress={() => choose(k)} />
            ))}
          </View>
          <Text style={s.note}>{t('答えると、今日の配分をその予定に合わせて組み替えます。')}</Text>
          <Pressable onPress={onAskOff} hitSlop={8} style={s.offBtn} accessibilityRole="button">
            <Text style={s.offT}>{t('聞かないで')}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={s.chips}>
            {AT_PRESETS.map((hm) => (
              <Chip key={hm} label={t('{h}時', { h: parseHm(hm)?.h ?? hm })} selected={at === hm}
                    onPress={() => { setAt(hm); }} />
            ))}
            <Chip label={t('時刻を選ぶ')} onPress={() => {
              const base = at ? parseHm(at) : null;
              const d = new Date();
              d.setHours(base ? base.h : 19, base ? base.m : 0, 0, 0);
              setDraft(d); setPickerOpen(true);
            }} />
          </View>

          {/* イベント想定kcal（外食800／飲み会1,000を既定）。±で調整できる＝勝手な数字を押しつけない */}
          <View style={s.estRow}>
            <Text style={s.estLabel}>{t('想定')}</Text>
            <Pressable style={s.estBtn} hitSlop={6} onPress={() => setEst(clampEst(estNow - EST_STEP))}
                       accessibilityRole="button" accessibilityLabel={t('想定を{n}kcal減らす', { n: EST_STEP })}>
              <Text style={s.estBtnT}>−</Text>
            </Pressable>
            <Text style={s.estN}>{t('約{n}kcal', { n: estNow.toLocaleString() })}</Text>
            <Pressable style={s.estBtn} hitSlop={6} onPress={() => setEst(clampEst(estNow + EST_STEP))}
                       accessibilityRole="button" accessibilityLabel={t('想定を{n}kcal増やす', { n: EST_STEP })}>
              <Text style={s.estBtnT}>＋</Text>
            </Pressable>
          </View>

          <OptionButton style={{ marginTop: 10 }} variant="teal" label={t('これで組み替える')} onPress={() => commit(at)} />
          <Pressable onPress={() => commit(null)} hitSlop={8} style={s.offBtn} accessibilityRole="button">
            <Text style={s.offT}>{t('時間はまだ分からない')}</Text>
          </Pressable>

          {/* 時刻ピッカー（15分刻み）。透過Modalなのでカードの上に重なる */}
          <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
            <Pressable style={s.pickBack} onPress={() => setPickerOpen(false)}>
              <Pressable style={s.pickCard} onPress={() => {}}>
                <Text style={s.pickTitle}>{t('何時ごろ？')}</Text>
                <DateTimePicker
                  locale={apiLang()} value={draft} mode="time" minuteInterval={15}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(ev, d) => {
                    if (Platform.OS !== 'ios') {
                      setPickerOpen(false);
                      if (ev.type === 'set' && d) {
                        const r = roundHm(d.getHours(), d.getMinutes());
                        setAt(fmtHm(r.h, r.m));
                      }
                      return;
                    }
                    if (d) setDraft(d);
                  }}
                />
                {Platform.OS === 'ios' && (
                  <View style={s.pickBtns}>
                    <Pressable style={s.pickGhost} hitSlop={6} onPress={() => setPickerOpen(false)}>
                      <Text style={s.pickGhostT}>{t('キャンセル')}</Text>
                    </Pressable>
                    <Pressable style={s.pickOk} hitSlop={6} onPress={() => {
                      const r = roundHm(draft.getHours(), draft.getMinutes());
                      setAt(fmtHm(r.h, r.m));
                      setPickerOpen(false);
                    }}>
                      <Text style={s.pickOkT}>{t('決定')}</Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        </>
      )}
    </View>
  );
}

const s = themed(() => ({
  card: {
    backgroundColor: C.accentSoft, borderWidth: 1.5, borderColor: C.accentBorder,
    borderRadius: RADIUS.card, padding: 16, marginBottom: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flex: 1, fontSize: 15.5, fontWeight: '800', color: C.ink, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  note: { fontSize: 12.5, color: C.sub, lineHeight: 18, marginTop: 10 },
  offBtn: { alignSelf: 'center', marginTop: 8 },
  offT: { fontSize: 12, color: C.sub, textDecorationLine: 'underline' },
  estRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  estLabel: { fontSize: 12, fontWeight: '800', color: C.accentInk, letterSpacing: 0.4 },
  estBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
  },
  estBtnT: { fontSize: 16, fontWeight: '800', color: C.ink },
  estN: { minWidth: 96, textAlign: 'center', fontSize: 14, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  pickBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  pickCard: { width: '100%', maxWidth: 360, backgroundColor: C.panel, borderRadius: RADIUS.card, padding: 16 },
  pickTitle: { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: 6 },
  pickBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 14, marginTop: 8 },
  pickGhost: { paddingVertical: 8, paddingHorizontal: 10 },
  pickGhostT: { fontSize: 14, fontWeight: '700', color: C.sub },
  pickOk: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.teal },
  pickOkT: { fontSize: 14, fontWeight: '800', color: '#fff' },
}));
