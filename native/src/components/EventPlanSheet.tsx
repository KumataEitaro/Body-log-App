// 先の予定（飲み会・外食・チートデイ）を登録するシート。
//
// 【なぜ食事タブの＋から入れるのか】
// 「明日 飲み会がある」と気づくのは、たいてい食事を記録している最中か、
// 明日の予定を思い出したときで、設定画面を開いている時ではない。
// 従来は「概要 → 設定 → 目標設定 → チートデイ」の4タップ以上で、当日には間に合わなかった。
//
// 【何をするシートか】
// 保存するのは events テーブルの1行（date / title / extra_kcal）だけ。
// 計算は lib/goal.ts の computePlan が既に持っている:
//   ・spread（既定）… 未来の超過ぶんを目標日までの全日に均等配分＝**先回りで貯金**
//   ・window（absorb_days=N）… 予定の翌日からN日で取り返す
// このシートは「入口」と「登録前に何が起きるかを見せること」に徹し、計算式は持たない。
//
// UIの部品は既存の流儀に合わせる: 選択は Chip、kcalは ±ステッパー（TodayPlanCard と同じ）。
// ホイールを使わないのは、ここが「正確な数値」ではなく「ざっくりの見込み」を入れる場所だから。
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { X, Beer, Utensils, Drumstick, CalendarDays } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { C, ICON, RADIUS, SPACE, themed } from '@/lib/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, OptionButton } from '@/components/ui/Selectable';
import { t } from '@/lib/i18n';
import { todayJST } from '@/lib/calc';
import { addDays, daysBetween } from '@/lib/goal';
import {
  EVENT_KINDS, EVENT_DEFAULT_KCAL, EVENT_KCAL_STEP,
  clampEventKcal, eventKindLabel, eventTitleOf, quickDates, perDayAdjust, perDayAdjustText,
  type EventKind,
} from '@/lib/eventPlan';

const KIND_ICON: Record<EventKind, LucideIcon> = {
  drink: Beer,
  eatout: Utensils,
  cheat: Drumstick,
  other: CalendarDays,
};

export type EventDraft = { date: string; title: string; extra_kcal: number };

export default function EventPlanSheet({
  visible, onClose, onSave, targetDate, absorbDays, busy,
}: {
  visible: boolean;
  onClose: () => void;
  /** 保存は呼び出し側（log.tsx）が行う。このシートはDBに触れない */
  onSave: (draft: EventDraft) => void | Promise<void>;
  /** 目標日（未設定なら null）。spread の見積りに使う */
  targetDate: string | null;
  /** goals.absorb_days（null なら spread） */
  absorbDays: number | null;
  busy?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const today = todayJST();
  const [kind, setKind] = useState<EventKind>('drink');
  // 種類を変えたら kcal も既定に戻す。ただし本人が±で動かしたあとは尊重する
  const [kcal, setKcal] = useState<number>(EVENT_DEFAULT_KCAL.drink);
  const [touchedKcal, setTouchedKcal] = useState(false);
  const [date, setDate] = useState<string>(addDays(today, 1)); // 既定は「明日」（いちばん多い）
  const [pickerOpen, setPickerOpen] = useState(false);

  // 開くたびに初期状態へ戻す（前回の入力が残っていると、別の予定を入れるときに事故る）
  useEffect(() => {
    if (!visible) return;
    setKind('drink');
    setKcal(EVENT_DEFAULT_KCAL.drink);
    setTouchedKcal(false);
    setDate(addDays(todayJST(), 1));
    setPickerOpen(false);
  }, [visible]);

  function pickKind(k: EventKind) {
    Haptics.selectionAsync().catch(() => {});
    setKind(k);
    if (!touchedKcal) setKcal(EVENT_DEFAULT_KCAL[k]);
  }
  function bumpKcal(d: number) {
    setTouchedKcal(true);
    setKcal((v) => clampEventKcal(v + d));
  }

  const quick = useMemo(() => quickDates(today), [today]);
  const isQuick = quick.some((q) => q.iso === date);
  const perDay = perDayAdjust(kcal, today, date, targetDate, absorbDays);
  const dayDiff = daysBetween(today, date);

  function dateLabel(iso: string): string {
    const q = quick.find((x) => x.iso === iso);
    if (q) return q.label;
    const [yy, mm, dd] = iso.split('-').map(Number);
    const wd = [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];
    return t('{m}/{d}({w})', { m: mm, d: dd, w: wd[new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()] });
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.wrap, { paddingBottom: insets.bottom + 12 }]}>
        <View style={s.head}>
          <View style={s.headBtn} />
          <Text style={s.title} numberOfLines={1}>{t('先の予定を入れる')}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={s.headBtn}
                     accessibilityRole="button" accessibilityLabel={t('閉じる')}>
            <X size={ICON.lg} color={C.sub} strokeWidth={ICON.stroke} />
          </Pressable>
        </View>

        {/* キーボードが出ないシートなので KeyboardAvoidingView は使わない
            （PlusSheet で踏んだ「見えない余白が残る」事故を持ち込まないため） */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.lead}>
            {t('先に入れておくと、その日のぶんを少しずつ前から空けておきます。当日に我慢しなくて済みます。')}
          </Text>

          {/* ① 種類 */}
          <Text style={s.sec}>{t('種類')}</Text>
          <View style={s.kinds}>
            {EVENT_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              const on = k === kind;
              return (
                <Pressable key={k} testID={`event-kind-${k}`} accessibilityRole="button"
                           accessibilityState={{ selected: on }} accessibilityLabel={eventKindLabel(k)}
                           onPress={() => pickKind(k)}
                           style={({ pressed }) => [s.kind, on && s.kindOn, pressed && { opacity: 0.9 }]}>
                  <Icon size={20} color={on ? C.accentInk : C.sub} strokeWidth={ICON.stroke} />
                  <Text style={[s.kindT, on && s.kindTOn]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                    {eventKindLabel(k)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ② 日付 */}
          <Text style={s.sec}>{t('いつ')}</Text>
          <View style={s.chips}>
            {quick.map((q) => (
              <Chip key={q.iso} label={q.label} selected={date === q.iso} onPress={() => setDate(q.iso)} />
            ))}
            <Chip label={isQuick ? t('日付を選ぶ') : dateLabel(date)} selected={!isQuick}
                  onPress={() => setPickerOpen(true)} />
          </View>

          {/* ③ 見込み超過kcal（±で調整＝勝手な数字を押しつけない。TodayPlanCard と同じ流儀） */}
          <Text style={s.sec}>{t('いつもよりどれくらい多い？')}</Text>
          <View style={s.estRow}>
            <Pressable style={s.estBtn} hitSlop={6} testID="event-kcal-minus"
                       onPress={() => bumpKcal(-EVENT_KCAL_STEP)}
                       accessibilityRole="button"
                       accessibilityLabel={t('想定を{n}kcal減らす', { n: EVENT_KCAL_STEP })}>
              <Text style={s.estBtnT}>−</Text>
            </Pressable>
            <Text style={s.estN} testID="event-kcal-value">
              {t('約+{n}kcal', { n: kcal.toLocaleString() })}
            </Text>
            <Pressable style={s.estBtn} hitSlop={6} testID="event-kcal-plus"
                       onPress={() => bumpKcal(EVENT_KCAL_STEP)}
                       accessibilityRole="button"
                       accessibilityLabel={t('想定を{n}kcal増やす', { n: EVENT_KCAL_STEP })}>
              <Text style={s.estBtnT}>＋</Text>
            </Pressable>
          </View>
          <Text style={s.hint}>
            {t('正確でなくて大丈夫です。多めに見ておくと、余ったぶんは翌日が楽になります。')}
          </Text>

          {/* ④ 登録前のプレビュー: 何が起きるかを必ず読めるようにする */}
          <View style={s.preview}>
            <Text style={s.previewT}>
              {dayDiff <= 0
                ? t('今日の{name}として登録します', { name: eventKindLabel(kind) })
                : t('{label}の{name}として登録します', { label: dateLabel(date), name: eventKindLabel(kind) })}
            </Text>
            <Text style={s.previewS}>
              {perDay == null
                ? t('体重の目標を決めると、1日あたりどれくらい調整すればいいかも出せます。いまは予定として残ります。')
                : perDayAdjustText(perDay, absorbDays)}
            </Text>
            {dayDiff >= 1 && <Text style={s.previewS}>{t('前日の20時にリマインドします。')}</Text>}
          </View>

          <OptionButton
            variant="teal" label={t('この予定を入れる')} busy={busy}
            onPress={() => onSave({ date, title: eventTitleOf(kind), extra_kcal: clampEventKcal(kcal) })}
          />
        </ScrollView>

        {pickerOpen && (
          <View style={s.pickerBox}>
            <DateTimePicker
              value={new Date(`${date}T00:00:00`)}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              minimumDate={new Date(`${today}T00:00:00`)}
              // 先すぎる予定は計画としての意味が薄いので1年で切る（誤操作の防止も兼ねる）
              maximumDate={new Date(`${addDays(today, 365)}T00:00:00`)}
              onChange={(_e, d) => {
                if (Platform.OS !== 'ios') setPickerOpen(false);
                if (!d) return;
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                setDate(iso);
              }}
            />
            {Platform.OS === 'ios' && (
              <OptionButton label={t('決定')} onPress={() => setPickerOpen(false)} />
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.screen, paddingTop: 12, paddingBottom: 8,
  },
  headBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: C.ink },
  body: { paddingHorizontal: SPACE.screen, paddingBottom: 24 },
  lead: { fontSize: 13, color: C.sub, marginBottom: 4 },
  sec: { fontSize: 12.5, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 8 },

  kinds: { flexDirection: 'row', gap: 8 },
  kind: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12,
    borderRadius: RADIUS.panel, borderWidth: 1, borderColor: C.hairline, backgroundColor: C.panel,
  },
  kindOn: { borderColor: C.teal, backgroundColor: C.accentSoft },
  kindT: { fontSize: 12, fontWeight: '700', color: C.sub },
  kindTOn: { color: C.accentInk },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  estRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  estBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
  },
  estBtnT: { fontSize: 20, fontWeight: '800', color: C.ink, marginTop: -2 },
  estN: { fontSize: 20, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], minWidth: 150, textAlign: 'center' },

  hint: { fontSize: 12, color: C.sub, marginTop: 10 },
  preview: {
    marginTop: 16, marginBottom: 16, padding: 14, borderRadius: RADIUS.panel,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.hairline, gap: 4,
  },
  previewT: { fontSize: 14, fontWeight: '800', color: C.accentInk },
  previewS: { fontSize: 12.5, color: C.sub },
  pickerBox: { paddingHorizontal: SPACE.screen, paddingBottom: 8, backgroundColor: C.bg },
}));
