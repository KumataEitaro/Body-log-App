// 初回オンボーディング: 価値カルーセル（intro）→ 4ステップウィザード
// intro: バリュープロポジションを先に体感させる（2026年知見: 深いオンボの方が転換・継続が高い）
// ① あなたの現在地点（プロフィール＋活動量カード選択＋現在の体重）
// ② 目的（減量3種＋増量。PFC係数の既定とAI相談の前提を決める）
// ③ 目標（体重・期日・体脂肪率は任意。減らす人も増やす人も同じ逆算）
// ④ 筋トレ目標（任意・スキップ可）
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import Animated, {
  FadeInDown, useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setFirstRunFlag } from '@/lib/firstrun';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import ActivityLevelPicker from '@/components/ActivityLevelPicker';
import { SegmentedControl, OptionButton } from '@/components/ui/Selectable';
import GoalPanel from '@/components/GoalPanel';
import { t } from '@/lib/i18n';
import { PURPOSES, setPurpose, usePurpose, type PurposeKey } from '@/lib/purpose';
import { purchasesAvailable } from '@/lib/purchases';
import OnboardingIntro from '@/components/OnboardingIntro';

const DONE_KEY = 'bl-onboard-done';

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<'intro' | 'wizard'>('intro');
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [life, setLife] = useState(1.375);
  const [busy, setBusy] = useState(false);
  const purpose = usePurpose();
  const [msg, setMsg] = useState('');

  // 進捗はドットではなくスプリングで満ちていくバー（前進の実感＝マイクロコミットメント）
  const prog = useSharedValue(0.25);
  useEffect(() => {
    prog.value = withSpring((step + 1) / 4, { damping: 15, stiffness: 140 });
  }, [step, prog]);
  const progSt = useAnimatedStyle(() => ({ width: `${prog.value * 100}%` }));

  // ステップ前進は必ずここを通す（触覚＋遷移アニメの起点をそろえる）
  function go(n: number) {
    Haptics.selectionAsync().catch(() => {});
    setStep(n);
  }

  // 既存値があればプリフィル（ガイド再実行などで再訪しても壊れない）
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (p) {
        if (p.display_name) setName(p.display_name);
        if (p.sex) setSex(p.sex);
        if (p.height_cm != null) setHeight(String(p.height_cm));
        if (p.age != null) setAge(String(p.age));
        if (p.life_factor != null) setLife(Number(p.life_factor));
      }
    })();
  }, []);

  function done() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setFirstRunFlag(DONE_KEY, '1').catch(() => {});
    router.replace('/(tabs)/log' as never);
    // 目標を決めた直後が課金の意思決定に最適なタイミング（2026年の実測でも
    // オンボーディング直後ペイウォールが最良構成）。スキップ可のソフト型として重ねる。
    // 課金基盤が未設定のビルドでは出さない（「準備中」を見せない）
    if (purchasesAvailable()) {
      setTimeout(() => router.push('/paywall?src=onboarding' as never), 400);
    }
  }

  async function saveProfile() {
    if (!height.trim() || !age.trim() || !weight.trim()) {
      setMsg(t('身長・年齢・現在の体重を入力してください。')); return;
    }
    setBusy(true); setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { error } = await supabase.from('profiles').upsert({
        id: uid, display_name: name.trim() || t('あなた'), sex,
        height_cm: Number(height) || 170, age: Number(age) || 30,
        life_factor: life, init_weight: Number(weight) || null,
      });
      if (error) { setMsg(t('保存に失敗しました。もう一度お試しください。')); return; }
      await supabase.from('entries').upsert(
        { user_id: uid, date: todayJST(), weight: Number(weight) }, { onConflict: 'user_id,date' });
      go(1);
    } finally { setBusy(false); }
  }

  // まず価値カルーセル。設定を求める前に「何が返ってくるアプリか」を体感してもらう
  if (stage === 'intro') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8 }}>
        <OnboardingIntro onDone={() => setStage('wizard')} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingTop: insets.top + 14, paddingHorizontal: 20 }}>
        {/* スプリング進捗バー＋スキップ */}
        <View style={s.topRow}>
          <View style={s.track}><Animated.View style={[s.fill, progSt]} /></View>
          <Pressable onPress={done} hitSlop={10}><Text style={s.skipT}>{t('あとで設定')}</Text></Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
          {/* keyでツリーを差し替え、ステップ全体がふわっと入場する */}
          <Animated.View key={step} entering={FadeInDown.duration(320)}>
          {step === 0 && (
            <>
              <Text style={s.h1}>{t('あなたの現在地点')}</Text>
              <Text style={s.sub}>{t('基礎代謝と消費カロリーの計算に使います。あとで⚙からいつでも変更できます。')}</Text>
              <Text style={s.label}>{t('ニックネーム（任意）')}</Text>
              <TextInput style={s.input} placeholder={t('例: くまさん')} placeholderTextColor={C.faint} value={name} onChangeText={setName} />
              <Text style={s.label}>{t('性別')}</Text>
              <SegmentedControl
                options={[{ key: 'male', label: t('男性') }, { key: 'female', label: t('女性') }]}
                value={sex} onChange={setSex}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{t('身長（cm）')}</Text>
                  <TextInput style={s.input} keyboardType="number-pad" placeholder="170" placeholderTextColor={C.faint} value={height} onChangeText={setHeight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{t('年齢')}</Text>
                  <TextInput style={s.input} keyboardType="number-pad" placeholder="30" placeholderTextColor={C.faint} value={age} onChangeText={setAge} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{t('今の体重（kg）')}</Text>
                  <TextInput style={s.input} keyboardType="decimal-pad" placeholder="70.0" placeholderTextColor={C.faint} value={weight} onChangeText={setWeight} />
                </View>
              </View>
              <Text style={s.label}>{t('日常の活動量')}</Text>
              <ActivityLevelPicker value={life} onChange={setLife} />
              {msg ? <Text style={s.err}>{msg}</Text> : null}
              <OptionButton style={{ marginTop: 18 }} label={t('次へ — 目的を選ぶ')} onPress={saveProfile} busy={busy} />
            </>
          )}

          {step === 1 && (
            <>
              <Text style={s.h1}>{t('なんのために使う？')}</Text>
              <Text style={s.sub}>{t('減らしたい人も、増やしたい人もここから。目的に合わせて、たんぱく質・脂質の目安を自動で決めます。あとで「設定→体重の目標」からいつでも変えられます。')}</Text>
              {PURPOSES.map((pu) => {
                const on = purpose === pu.key;
                return (
                  <Pressable key={pu.key}
                             style={({ pressed }) => [s.purposeCard, on && s.purposeCardOn, pressed && { transform: [{ scale: 0.98 }] }]}
                             onPress={() => { Haptics.selectionAsync().catch(() => {}); setPurpose(pu.key as PurposeKey); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.purposeT, on && { color: C.teal }]}>{t(pu.label)}</Text>
                      <Text style={s.purposeD}>{t(pu.desc)}</Text>
                    </View>
                    <Text style={s.purposeCoef}>P {pu.p} / F {pu.f} g/kg</Text>
                  </Pressable>
                );
              })}
              <OptionButton style={{ marginTop: 18 }} label={t('次へ — 目標を決める')}
                            onPress={() => go(2)} disabled={purpose == null} />
              <Pressable onPress={() => go(2)} hitSlop={8} style={{ alignSelf: 'center', marginTop: 10 }}>
                <Text style={s.linkT}>{t('目的はあとで決める')}</Text>
              </Pressable>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.h1}>{t('目標を決める')}</Text>
              <Text style={s.sub}>{t('減らす人も、増やす人も。目標から逆算して、毎日の「ちょうどいい量」を自動計算します。「目標を保存する」を押してから次へ進んでください。')}</Text>
              <GoalPanel mode="weight" weightSections="goal" />
              <OptionButton style={{ marginTop: 18 }} label={t('次へ — 筋トレ目標（任意）')} onPress={() => go(3)} />
              <Pressable onPress={() => go(3)} hitSlop={8} style={{ alignSelf: 'center', marginTop: 10 }}>
                <Text style={s.linkT}>{t('目標はあとで決める')}</Text>
              </Pressable>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={s.h1}>{t('筋トレの目標（任意）')}</Text>
              <Text style={s.sub}>{t('ベンチプレス100kgのような目標を置くと、トレのグラフに目標線が出ます。筋トレをしない人はスキップでOKです。')}</Text>
              <GoalPanel mode="training" />
              <OptionButton style={{ marginTop: 18 }} label={t('はじめる 🎉')} onPress={done} />
            </>
          )}
          </Animated.View>
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  purposeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 16,
    padding: 14, marginTop: 10,
  },
  purposeCardOn: { borderColor: C.teal, backgroundColor: C.accentSoft },
  purposeT: { fontSize: 15, fontWeight: '800', color: C.ink },
  purposeD: { fontSize: 13, color: C.sub, marginTop: 2 },
  purposeCoef: { fontSize: 11, color: C.faint, fontWeight: '700', fontVariant: ['tabular-nums'] },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 16 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: C.teal },
  skipT: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  h1: { fontSize: 21, fontWeight: '800', color: C.ink, marginBottom: 6 },
  sub: { fontSize: 13, color: C.sub, lineHeight: 19, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '700', color: C.sub, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 17, color: C.ink },
  seg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  segOn: { backgroundColor: C.ink, borderColor: C.ink },
  segT: { fontSize: 15, fontWeight: '800', color: C.sub },
  err: { color: C.coral, fontSize: 15, marginTop: 10 },
  primaryBtn: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  primaryBtnT: { color: '#fff', fontSize: 15, fontWeight: '800' },
  linkT: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
});
