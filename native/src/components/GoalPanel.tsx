// 目標パネル。
// mode='hub'      : 統合目標画面（設定「目標」・食事タブの目標タップ・概要の体重目標カードから開く）
//                   体重の目標 → 必要な赤字（日/週/月） → 運動の目標 → 習慣 → 1日に食べられる量（結論・手動調整）
//                   → PFCの内訳（任意・最初から値入り） → チートデイ（weightSections='all'のとき）
// mode='weight'   : 体重目標（＋チートデイ）だけ。オンボーディングのステップ用
// mode='training' : 運動習慣＋種目別目標重量だけ。運動タブ・オンボーディング用
// Web版依存を撤去しアプリ内で完結
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Target, Beef, Dumbbell, Footprints, Flame, CalendarCheck, Utensils, Scale } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { C, rgba, themed } from '@/lib/ui';
import { todayJST, mifflinBMR, LIFE_FACTOR_DEFAULT } from '@/lib/calc';
import { progressStatus, PROTEIN_PER_KG_DEFAULT, FAT_PER_KG_DEFAULT, type Goal } from '@/lib/goal';
import { deficitPlan, dailyAllowance, projectedTargetDate, clampAdjust, MAX_WEEKLY_LOSS_KG } from '@/lib/deficit';
import { useKcalAdjust } from '@/lib/kcalAdjust';
import { trainingSeries } from '@/lib/training';
import { scheduleCheatDayEve } from '@/lib/notify';
import { OptionButton, Chip } from '@/components/ui/Selectable';
import HabitGoals from '@/components/HabitGoals';
import { epley1RM } from '@/lib/rm';
import { isBodyweightLift, loadCustomLifts } from '@/lib/lifts';
import { parseLiftText } from '@/lib/liftLog';
import LiftPicker from '@/components/LiftPicker';
import { PURPOSES, setPurpose, usePurpose, purposeOf } from '@/lib/purpose';
import { bmiFloorKg, weeklyLossPace } from '@/lib/guard';
import { t, apiLang } from '@/lib/i18n';

type TGoal = { id: string; name: string; target_kg: number; target_date: string | null };
type Ev = { id: string; date: string; title: string; extra_kcal: number };
type Prof = { sex: 'male' | 'female'; height_cm: number; age: number; life_factor: number };

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 'YYYY-MM-DD' → 'M/D'（目標日の再計算表示用）
function md(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}
// 符号つき整数の桁区切り（+1,200 / −350）
function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()}`;
}

// weightSections: 'all'=目標＋チートデイ / 'goal'=目標フォームのみ / 'cheat'=チートデイのみ
export default function GoalPanel({ mode, weightSections = 'all' }: { mode: 'weight' | 'training' | 'hub'; weightSections?: 'all' | 'goal' | 'cheat' }) {
  const showGoal = weightSections !== 'cheat';
  const showCheat = weightSections !== 'goal';
  const [goal, setGoal] = useState<Goal | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [initWeight, setInitWeight] = useState<number | null>(null);
  // 安全ガード用のプロフィール値。身長はBMI下限チェック、maternityは減量目標ロックに使う
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [maternity, setMaternity] = useState(false);
  // 維持kcal（BMR×生活係数）の算出に使うプロフィール。欠けていれば「食べられる量」は出さない
  const [prof, setProf] = useState<Prof | null>(null);
  const [gDate, setGDate] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [gBf, setGBf] = useState('');
  const [gProtein, setGProtein] = useState('');
  const [gFat, setGFat] = useState('');
  const [gFatMax, setGFatMax] = useState('');
  const purposeKey = usePurpose();
  // 1日に食べられる量の手動調整（端末保存・0=自動）
  const [kcalAdjust, setKcalAdjust] = useKcalAdjust();
  const [adjustText, setAdjustText] = useState('');
  const [events, setEvents] = useState<Ev[]>([]);
  const [evDate, setEvDate] = useState('');
  const [evKcal, setEvKcal] = useState('800');
  const [evPicker, setEvPicker] = useState(false);
  const [tGoals, setTGoals] = useState<TGoal[]>([]);
  const [bests, setBests] = useState<Map<string, number>>(new Map());
  const [tName, setTName] = useState('');
  // 種目名は筋トレ記録と同じLiftPickerで選ぶ（表記ゆれ「ベンチ」vs「ベンチプレス」で
  // 目標と記録が紐づかない事故を根治するため、フリーテキスト入力はやめた）
  const [liftPickOpen, setLiftPickOpen] = useState(false);
  // 過去に記録した種目名（ピッカーの「最近の種目」に出すため）
  const [liftHist, setLiftHist] = useState<string[]>([]);
  const [tKg, setTKg] = useState('');
  const [tReps, setTReps] = useState(1); // 目標回数（既定=1回。1回で挙げたいMAX重量が主役）
  // 運動習慣目標（週N回・週kcal・最低分数）
  const [exPerWeek, setExPerWeek] = useState('');
  const [exWeeklyKcal, setExWeeklyKcal] = useState('');
  const [exMinMinutes, setExMinMinutes] = useState('');
  const [habitBusy, setHabitBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const [gRes, wRes, tgRes, histRes, profRes, evRes] = await Promise.all([
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('entries').select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
      supabase.from('training_goals').select('id,name,target_kg,target_date').order('created_at', { ascending: true }),
      supabase.from('logs').select('date,text').like('text', '🏋️%').order('at', { ascending: false }).limit(200),
      // select('*')なら maternity 列が無い旧DBでもクエリ自体は失敗しない（列指定だとselectごと落ちる）
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('events').select('id,date,title,extra_kcal').gte('date', todayJST()).order('date', { ascending: true }),
    ]);
    if (profRes.data) {
      const pr = profRes.data as { init_weight?: number | null; height_cm?: number | null; maternity?: boolean | null; sex?: 'male' | 'female' | null; age?: number | null; life_factor?: number | null };
      if (pr.init_weight != null) setInitWeight(Number(pr.init_weight));
      if (pr.height_cm != null && Number(pr.height_cm) > 0) setHeightCm(Number(pr.height_cm));
      setMaternity(pr.maternity === true);   // 列が無いDBではundefined → false扱い（ガードだけ無効）
      if (pr.sex && pr.height_cm != null && pr.age != null && Number(pr.height_cm) > 0 && Number(pr.age) > 0) {
        setProf({ sex: pr.sex, height_cm: Number(pr.height_cm), age: Number(pr.age), life_factor: Number(pr.life_factor ?? LIFE_FACTOR_DEFAULT) || LIFE_FACTOR_DEFAULT });
      }
    }
    const pp = purposeOf(purposeKey);
    if (gRes.data) {
      const g = gRes.data as Goal;
      setGoal(g);
      setGDate(g.target_date); setGWeight(String(g.target_weight ?? ''));
      const gx = g as Goal & { ex_per_week?: number | null; ex_weekly_kcal?: number | null; ex_min_minutes?: number | null };
      if (gx.ex_per_week != null) setExPerWeek(String(gx.ex_per_week));
      if (gx.ex_weekly_kcal != null) setExWeeklyKcal(String(gx.ex_weekly_kcal));
      if (gx.ex_min_minutes != null) setExMinMinutes(String(gx.ex_min_minutes));
      const bf = (g as Goal & { target_bodyfat?: number | null }).target_bodyfat;
      setGBf(bf != null ? String(bf) : '');
      setGProtein(g.protein_per_kg != null ? String(g.protein_per_kg) : String(pp ? pp.p : PROTEIN_PER_KG_DEFAULT));
      setGFat(g.fat_per_kg != null ? String(g.fat_per_kg) : String(pp ? pp.f : FAT_PER_KG_DEFAULT));
      setGFatMax(g.fat_max_g != null ? String(g.fat_max_g) : '');
    } else {
      // 目標が未保存でもPFC欄は「最初から値が入った状態」で見せる（折り畳んで隠さない）
      setGProtein(String(pp ? pp.p : PROTEIN_PER_KG_DEFAULT));
      setGFat(String(pp ? pp.f : FAT_PER_KG_DEFAULT));
    }
    if (wRes.data?.length) setLatestWeight(Number(wRes.data[0].weight));
    if (!tgRes.error) setTGoals((tgRes.data as TGoal[]) || []);
    setEvents((evRes.data as Ev[]) || []);
    const histRows = (histRes.data as { date: string; text: string }[]) || [];
    const series = trainingSeries(histRows);
    const b = new Map<string, number>();
    for (const [name, pts] of series) b.set(name, Math.max(...pts.map((p) => p.maxKg)));
    setBests(b);
    // 記録済みの種目名をピッカーの「最近の種目」へ（記録側と同じ並び＝直近が先頭）
    setLiftHist(histRows.flatMap((h) => parseLiftText(h.text).map((e) => e.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); loadCustomLifts(); }, [load]);

  async function saveWeightGoal() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gDate) || !(Number(gWeight) > 20)) {
      setMsg({ ok: false, text: t('目標日と目標体重を入力してください。') }); return;
    }
    const targetW = Number(gWeight);
    // G1: BMI18.5未満になる目標はハードロック（身長未登録ならこのチェックだけスキップ）
    if (heightCm != null) {
      const floor = bmiFloorKg(heightCm);
      if (targetW < floor) {
        setMsg({ ok: false, text: t('その目標は体に負担が大きすぎます。BMI18.5（{kg}kg）を下回る目標は設定できません。', { kg: floor.toFixed(1) }) });
        return;
      }
    }
    const currentW = latestWeight ?? initWeight;
    // G3: 妊娠・授乳中は減量方向の目標（目標体重<現在体重）を受け付けない
    if (maternity && currentW != null && targetW < currentW) {
      setMsg({ ok: false, text: t('妊娠・授乳中は減量目標を設定できません。いまは維持と栄養が最優先です。') });
      return;
    }
    // G1: 週1kg超の減量ペースはハードロック。週0.5〜1kgは警告だけ添えて保存は許可
    let paceWarn = '';
    if (currentW != null) {
      const pace = weeklyLossPace(currentW, targetW, todayJST(), gDate);
      if (pace != null && pace > 1) {
        setMsg({ ok: false, text: t('そのペースは速すぎます。週1kg以内になるよう、日付か目標を調整してください。') });
        return;
      }
      if (pace != null && pace >= 0.5) {
        paceWarn = t('やや速いペースです（週あたり約{n}kg）。体調の変化に気をつけて進めましょう。', { n: pace.toFixed(1) });
      }
    }
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const start = goal?.start_weight ?? latestWeight ?? initWeight ?? Number(gWeight);
      const base = {
        user_id: uid, target_date: gDate, target_weight: Number(gWeight),
        start_date: goal?.start_date ?? todayJST(), start_weight: start,
        updated_at: new Date().toISOString(),
      };
      // PFC列が無い旧DB環境でも保存できるようフォールバック（Web版と同じ流儀）
      let { error } = await supabase.from('goals').upsert({
        ...base,
        target_bodyfat: gBf === '' ? null : Number(gBf) || null,
        protein_per_kg: gProtein === '' ? null : Number(gProtein) || null,
        fat_per_kg: gFat === '' ? null : Number(gFat) || null,
        fat_max_g: gFatMax === '' ? null : Number(gFatMax) || null,
      });
      if (error && /target_bodyfat|protein_per_kg|fat_per_kg|fat_max_g|column|schema/.test(error.message)) {
        ({ error } = await supabase.from('goals').upsert(base));
      }
      if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
      await load();
      // 速めのペース（週0.5〜1kg）は保存自体は通し、注意の一言だけ添える
      setMsg({ ok: true, text: paceWarn ? `${t('目標を保存し、計画を再計算しました。')} ${paceWarn}` : t('目標を保存し、計画を再計算しました。') });
    } finally { setBusy(false); }
  }

  async function addEvent() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(evDate)) { setMsg({ ok: false, text: t('チートデイの日付を選んでください。') }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data, error } = await supabase.from('events')
        .insert({ user_id: uid, date: evDate, title: t('🍖 チートデイ'), extra_kcal: Number(evKcal) || 800 })
        .select('id,date,title,extra_kcal').single();
      if (error) { setMsg({ ok: false, text: t('登録に失敗しました。もう一度お試しください。') }); return; }
      setEvents((prev) => [...prev, data as Ev].sort((a, b) => (a.date < b.date ? -1 : 1)));
      scheduleCheatDayEve(evDate); // 前日20時のリマインド（通知許可がなければ静かにスキップ）
      setEvDate('');
      setMsg({ ok: true, text: t('チートデイを登録しました。前後の日で計画が自動的に吸収します。') });
    } finally { setBusy(false); }
  }

  async function removeEvent(id: string) {
    await supabase.from('events').delete().eq('id', id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  async function addTrainingGoal() {
    const name = tName.trim(); const kg = Number(tKg);
    if (!name || !(kg > 0)) { setMsg({ ok: false, text: t('種目名と目標重量(kg)を入力してください。') }); return; }
    // 目標はRM換算した推定1RMで保存する（例: 100kg×5回 → 1RM 117kg）
    const target = Math.round(epley1RM(kg, tReps));
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { error } = await supabase.from('training_goals')
        .upsert({ user_id: uid, name, target_kg: target }, { onConflict: 'user_id,name' });
      if (error) {
        setMsg({ ok: false, text: /does not exist|schema/i.test(error.message) ? t('DBの初回セットアップが未完了です（apply-pending.sqlの実行が必要）。') : t('保存に失敗しました。もう一度お試しください。') });
        return;
      }
      setTName(''); setTKg(''); setTReps(1);
      await load();
      setMsg({
        ok: true,
        text: tReps === 1
          ? t('「{name} MAX {kg}kg」を目標に設定しました。', { name, kg: target })
          : t('「{name} {kg}kg×{reps}回」→ RM換算でMAX {max}kg を目標に設定しました。', { name, kg, reps: tReps, max: target }),
      });
    } finally { setBusy(false); }
  }

  // 運動習慣目標の保存（列が無い旧DBならv16/v17の実行を促す）
  async function saveHabitGoal() {
    setHabitBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { error } = await supabase.from('goals').upsert({
        user_id: uid,
        ex_per_week: exPerWeek === '' ? null : Number(exPerWeek) || null,
        ex_weekly_kcal: exWeeklyKcal === '' ? null : Number(exWeeklyKcal) || null,
        ex_min_minutes: exMinMinutes === '' ? null : Number(exMinMinutes) || null,
      }, { onConflict: 'user_id' });
      if (error) {
        setMsg({ ok: false, text: /ex_per_week|column|schema/i.test(error.message) ? t('習慣目標はDB更新（apply-pending.sqlのv17）後に使えます。') : t('保存に失敗しました。もう一度お試しください。') });
        return;
      }
      setMsg({ ok: true, text: t('運動習慣の目標を保存しました。「概要」タブの運動の記録に反映されます。') });
    } finally { setHabitBusy(false); }
  }

  async function removeTrainingGoal(id: string) {
    await supabase.from('training_goals').delete().eq('id', id);
    setTGoals((prev) => prev.filter((g) => g.id !== id));
  }

  const status = goal && latestWeight != null ? progressStatus(goal, todayJST(), latestWeight) : null;

  // ===== 必要な赤字・食べられる量（入力中の値でライブ計算。保存前でも数字が動くのが計算機の役目） =====
  const today = todayJST();
  const currentW = latestWeight ?? initWeight;
  const targetW = Number(gWeight);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(gDate);
  const plan = currentW != null && targetW > 20 && dateOk ? deficitPlan(currentW, targetW, today, gDate) : null;
  // 維持kcal = BMR × 生活係数（食事タブのヒーローと同じ。運動を記録した日はその分がさらに乗る）
  const bmr = prof && currentW != null ? mifflinBMR(prof.sex, currentW, prof.height_cm, prof.age) : null;
  const maintenance = bmr != null && prof ? Math.round(bmr * prof.life_factor) : null;
  const requiredDaily = plan ? plan.perDay : 0;
  const autoAllowance = maintenance != null && bmr != null ? dailyAllowance(maintenance, requiredDaily, bmr, 0) : null;
  const allowance = maintenance != null && bmr != null ? dailyAllowance(maintenance, requiredDaily, bmr, kcalAdjust) : null;
  // 手動調整後に実際に出る1日の赤字（BMR下限で止まった分も反映）
  const effectiveDeficit = maintenance != null && allowance != null ? maintenance - allowance : requiredDaily;
  const projected = plan && currentW != null && kcalAdjust !== 0 ? projectedTargetDate(currentW, targetW, today, effectiveDeficit) : null;
  // 運動目標（週kcal）→ 1日あたりに換算した「運動すればその分食べられる」量
  const exPerDay = Number(exWeeklyKcal) > 0 ? Math.round(Number(exWeeklyKcal) / 7) : 0;

  function applyAdjust(n: number) {
    const v = clampAdjust(n);
    setKcalAdjust(v);
    setAdjustText('');
  }
  // 直接入力: 絶対値（食べられる量）を打つと、自動値との差分を調整値として保存する
  function commitAdjustText() {
    const n = Number(adjustText);
    if (autoAllowance == null || !(n > 0)) { setAdjustText(''); return; }
    applyAdjust(n - autoAllowance);
  }

  // ===== 描画部品 =====
  const weightGoalForm = (
    <>
      <View style={s.h2Row}><Target size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{mode === 'hub' ? t('体重の目標') : t('目標設定')}</Text></View>
      {goal && latestWeight != null && (
        <View style={s.statusRow}>
          {/* 「現在→目標」の大数字は1行固定のため文字サイズ拡大は上限1.3 */}
          <Text style={s.statusBig} maxFontSizeMultiplier={1.3}>{latestWeight.toFixed(1)} → {Number(goal.target_weight).toFixed(1)}kg</Text>
          {status && (
            <Text style={[s.statusSub, { color: status.state === 'behind' ? C.coral : C.teal }]}>
              {status.state === 'ahead' ? t('{n}日先行 🎉', { n: Math.abs(status.diffDays) }) : status.state === 'behind' ? t('{n}日遅れ', { n: Math.abs(status.diffDays) }) : t('順調 👍')}
              ・{t('あと{n}kg', { n: Math.abs(latestWeight - Number(goal.target_weight)).toFixed(1) })}
            </Text>
          )}
        </View>
      )}
      {/* 現在体重は記録から取る（入力させない）。未記録ならプロフィールの初期体重 */}
      {mode === 'hub' && (
        <Text style={s.note}>
          {currentW != null
            ? t('現在の体重: {kg}kg（最新の記録）', { kg: currentW.toFixed(1) })
            : t('体重を1回記録すると、必要な赤字と食べられる量が出ます。')}
        </Text>
      )}
      {/* 日付と体重は情報量が小さいので1行に並べる（縦積みはスペースの無駄） */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1.3 }}>
          <Text style={s.label}>{t('目標日')}</Text>
          <Pressable style={s.input} onPress={() => setShowDatePicker((v) => !v)}>
            <Text style={{ fontSize: 17, color: gDate ? C.ink : C.faint }}>{gDate ? gDate.replace(/-/g, '/') : t('タップして選ぶ')}</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{t('目標体重（kg）')}</Text>
          <TextInput style={s.input} placeholder="82.0" placeholderTextColor={C.faint} keyboardType="decimal-pad" value={gWeight} onChangeText={setGWeight} />
        </View>
        <View style={{ flex: 0.9 }}>
          <Text style={s.label}>{t('体脂肪率（%）')}</Text>
          <TextInput style={s.input} placeholder={t('任意')} placeholderTextColor={C.faint} keyboardType="decimal-pad" value={gBf} onChangeText={setGBf} />
        </View>
      </View>
      {showDatePicker && (
        <DateTimePicker
          locale={apiLang()}
          value={gDate ? new Date(gDate + 'T00:00:00') : new Date()}
          mode="date" display="inline" minimumDate={new Date()}
          onChange={(_, d) => { if (d) setGDate(fmt(d)); setShowDatePicker(false); }}
        />
      )}
    </>
  );

  // 必要な赤字（総量・日/週/月）。安全ガードの文言は保存時のものと同じ言い回しで先に見せる
  const deficitSection = (
    <>
      <View style={s.h2Row}><Flame size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('必要な赤字')}</Text></View>
      {!plan ? (
        <Text style={s.note}>{t('目標体重と目標日を入れると、必要な赤字が自動で出ます。')}</Text>
      ) : plan.direction === 'keep' ? (
        <Text style={s.note}>{t('目標体重が現在と同じなので、赤字は不要です（維持）。')}</Text>
      ) : (
        <>
          <Text style={s.note}>
            {plan.direction === 'cut'
              ? t('{kg}kg減 × 7,200kcal ＝ 合計 {total}kcal の赤字が必要です（{days}日間）。', { kg: plan.kg.toFixed(1), total: plan.total.toLocaleString(), days: plan.days })
              : t('{kg}kg増 × 7,200kcal ＝ 合計 {total}kcal の黒字が必要です（{days}日間）。', { kg: Math.abs(plan.kg).toFixed(1), total: Math.abs(plan.total).toLocaleString(), days: plan.days })}
          </Text>
          <View style={s.triRow}>
            {([[t('1日あたり'), plan.perDay], [t('1週間あたり'), plan.perWeek], [t('1か月あたり'), plan.perMonth]] as [string, number][]).map(([lab, v]) => (
              <View key={lab} style={s.triCell}>
                <Text style={s.triLabel}>{lab}</Text>
                <Text style={s.triNum} maxFontSizeMultiplier={1.3}>{signed(-v)}</Text>
                <Text style={s.triUnit}>kcal</Text>
              </View>
            ))}
          </View>
          {plan.tooFast && (
            <Text style={[s.guard, { color: C.coral }]}>
              {t('そのペースは速すぎます。週1kg以内になるよう、日付か目標を調整してください。')}
              {heightCm != null ? ` ${t('BMI18.5（{kg}kg）を下回る目標は設定できません。', { kg: bmiFloorKg(heightCm).toFixed(1) })}` : ''}
            </Text>
          )}
          {plan.fast && (
            <Text style={[s.guard, { color: C.amber }]}>
              {t('やや速いペースです（週あたり約{n}kg）。体調の変化に気をつけて進めましょう。', { n: plan.weeklyPaceKg.toFixed(1) })}
            </Text>
          )}
          {!plan.tooFast && !plan.fast && plan.direction === 'cut' && (
            <Text style={s.note}>{t('週あたり約{n}kgのペースです（上限は週{max}kg）。', { n: plan.weeklyPaceKg.toFixed(2), max: MAX_WEEKLY_LOSS_KG })}</Text>
          )}
        </>
      )}
    </>
  );

  // 目的プリセット＋PFC係数。hubでは「任意」節として最初から値入りで見せる
  const pfcSection = (
    <>
      <Text style={[s.label, { marginTop: mode === 'hub' ? 0 : 12 }]}>{t('目的からPFCを決める')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {PURPOSES.map((pu) => {
          const on = purposeKey === pu.key
            && Number(gProtein) === pu.p && Number(gFat) === pu.f;
          return (
            <Pressable key={pu.key} style={[s.puChip, on && s.puChipOn]}
                       onPress={() => {
                         setPurpose(pu.key);
                         setGProtein(String(pu.p));
                         setGFat(String(pu.f));
                       }}>
              <Text style={[s.puChipT, on && { color: '#fff' }]}>{t(pu.label)}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* 係数がピンと来ない人向けに、カロリー比%も併記する（MFP等の表現に慣れた人が多い） */}
      {(() => {
        const w = latestWeight ?? 70;
        const pG = (Number(gProtein) || PROTEIN_PER_KG_DEFAULT) * w;
        const fG = (Number(gFat) || FAT_PER_KG_DEFAULT) * w;
        const kcal = allowance ?? 1800; // 食べられる量が出ていればそれを基準に、無ければ従来の1,800換算
        const pPct = Math.round((pG * 4 / kcal) * 100);
        const fPct = Math.round((fG * 9 / kcal) * 100);
        const cPct = Math.max(0, 100 - pPct - fPct);
        return (
          <Text style={s.note}>
            {t('kcal比の目安: P {p}% / F {f}% / C {c}%（{kcal}kcal換算）', { p: pPct, f: fPct, c: cPct, kcal: kcal.toLocaleString() })}
          </Text>
        );
      })()}

      {/* PFC係数は折り畳まない。目的で決まった既定値を最初から見せ、変えたい人だけ書き換える */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>P（g/kg）</Text>
          <TextInput style={s.input} placeholder={String(PROTEIN_PER_KG_DEFAULT)} placeholderTextColor={C.faint} keyboardType="decimal-pad" value={gProtein} onChangeText={setGProtein} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>F（g/kg）</Text>
          <TextInput style={s.input} placeholder={String(FAT_PER_KG_DEFAULT)} placeholderTextColor={C.faint} keyboardType="decimal-pad" value={gFat} onChangeText={setGFat} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{t('F上限（g/日）')}</Text>
          <TextInput style={s.input} placeholder={t('なし')} placeholderTextColor={C.faint} keyboardType="number-pad" value={gFatMax} onChangeText={setGFatMax} />
        </View>
      </View>
    </>
  );

  // 結論: 1日に食べられるカロリー（大きく）＋手動調整（±チップ・直接入力）＋調整後の目標日
  const allowanceSection = (
    <>
      <View style={s.h2Row}><Utensils size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('1日に食べられるカロリー')}</Text></View>
      {allowance == null || maintenance == null ? (
        <Text style={s.note}>
          {prof == null
            ? t('プロフィール（性別・身長・年齢）を登録すると計算できます。')
            : t('体重を1回記録すると計算できます。')}
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
            <Text style={s.bigNum} maxFontSizeMultiplier={1.3}>{allowance.toLocaleString()}</Text>
            <Text style={s.bigUnit}>kcal</Text>
            {kcalAdjust !== 0 && (
              <View style={s.adjBadge}><Text style={s.adjBadgeT}>{t('調整 {n}', { n: signed(kcalAdjust) })}</Text></View>
            )}
          </View>
          {/* 内訳を隠さない: 維持 − 赤字 (+ 調整) の3行で、なぜこの数字なのかが分かる */}
          <Text style={s.note}>
            {t('維持 {m}kcal', { m: maintenance.toLocaleString() })}
            {requiredDaily !== 0 ? ` ${requiredDaily > 0 ? '−' : '+'} ${t('赤字 {d}kcal', { d: Math.abs(requiredDaily).toLocaleString() })}` : ''}
            {kcalAdjust !== 0 ? ` ${kcalAdjust > 0 ? '+' : '−'} ${t('調整 {a}kcal', { a: Math.abs(kcalAdjust).toLocaleString() })}` : ''}
            {allowance === Math.round(bmr ?? 0) && requiredDaily > 0 ? `（${t('基礎代謝を下回らない下限で止めています')}）` : ''}
          </Text>
          {exPerDay > 0 && (
            <Text style={[s.note, { color: C.teal, fontWeight: '700' }]}>
              {t('運動の目標（週{w}kcal）を達成すると、平均で1日 +{n}kcal 食べられます。運動を記録した日に自動で上乗せされます。', { w: Number(exWeeklyKcal).toLocaleString(), n: exPerDay.toLocaleString() })}
            </Text>
          )}

          {/* きつければ自分で調整。±チップと直接入力（絶対値）。0に戻すチップで自動へ */}
          <Text style={[s.label, { marginTop: 12 }]}>{t('きつければ自分で調整')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {[-100, -50, 50, 100].map((d) => (
              <Chip key={d} label={signed(d)} tone="ink" onPress={() => applyAdjust(kcalAdjust + d)} />
            ))}
            {kcalAdjust !== 0 && <Chip label={t('自動に戻す')} tone="outline" selected onPress={() => applyAdjust(0)} />}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{t('直接入力（kcal/日）')}</Text>
              <TextInput style={s.input} placeholder={String(allowance)} placeholderTextColor={C.faint} keyboardType="number-pad"
                         value={adjustText} onChangeText={setAdjustText} onBlur={commitAdjustText} onSubmitEditing={commitAdjustText} returnKeyType="done" />
            </View>
            <OptionButton variant="tonal" label={t('反映')} onPress={commitAdjustText} />
          </View>

          {/* 正直さ: 調整したら目標日がいつになるかを再計算して見せる（数字だけ変えて期日を固定しない） */}
          {kcalAdjust !== 0 && plan && plan.direction !== 'keep' && (
            <View style={s.projBox}>
              <CalendarCheck size={14} color={projected ? C.teal : C.amber} />
              <Text style={[s.projT, { color: projected ? C.ink : C.amber }]}>
                {projected
                  ? t('この設定だと目標日は {d} ごろになります（もとの目標日 {o}）。', { d: md(projected), o: md(gDate) })
                  : t('この設定では目標体重に届きません（維持ペース）。赤字が残るよう調整してください。')}
              </Text>
            </View>
          )}
          <Text style={s.tiny}>{t('この調整は食事タブの「目標」にそのまま反映されます（端末に保存）。')}</Text>
        </>
      )}
    </>
  );

  const habitFormSection = (
    <>
      <View style={s.h2Row}><Footprints size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('運動習慣の目標')}</Text></View>
      <Text style={s.note}>{t('散歩レベルでOK。週にどれだけ動くかを決めると「概要」の運動の記録で達成度が見えます。')}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{t('週の回数')}</Text>
          <TextInput style={s.input} placeholder="3" placeholderTextColor={C.faint} keyboardType="number-pad"
                     value={exPerWeek} onChangeText={setExPerWeek} />
        </View>
        <View style={{ flex: 1.2 }}>
          <Text style={s.label}>{t('週の消費kcal')}</Text>
          <TextInput style={s.input} placeholder="1000" placeholderTextColor={C.faint} keyboardType="number-pad"
                     value={exWeeklyKcal} onChangeText={setExWeeklyKcal} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{t('最低分数/回')}</Text>
          <TextInput style={s.input} placeholder="20" placeholderTextColor={C.faint} keyboardType="number-pad"
                     value={exMinMinutes} onChangeText={setExMinMinutes} />
        </View>
      </View>
      {/* 運動すればその分食べられる、を運動の目標のすぐ下でも見せる */}
      {exPerDay > 0 && (
        <Text style={s.rmPreview}>{t('週{w}kcal ＝ 1日あたり約 +{n}kcal 食べられる分', { w: Number(exWeeklyKcal).toLocaleString(), n: exPerDay.toLocaleString() })}</Text>
      )}
      <OptionButton style={{ marginTop: 12 }} variant="teal" label={t('習慣目標を保存')} onPress={saveHabitGoal} busy={habitBusy} />
    </>
  );

  const liftGoalSection = (
    <>
      <View style={s.h2Row}><Dumbbell size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('筋トレの目標（RM換算）')}</Text></View>
      {tGoals.length === 0 && <Text style={s.note}>{t('まだ目標がありません。種目と目標重量を追加しましょう。')}</Text>}
      {tGoals.map((tg) => {
        const best = bests.get(tg.name) ?? 0;
        const pct = Math.min(100, Math.round((best / Number(tg.target_kg)) * 100));
        return (
          <View key={tg.id} style={{ marginBottom: 12 }}>
            <View style={s.tgRow}>
              <Text style={s.tgName}>{tg.name}{pct >= 100 && ' 🎉'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={s.tgNum}>{best > 0 ? best : '—'} / {Number(tg.target_kg)}kg（{pct}%）</Text>
                <Pressable onPress={() => removeTrainingGoal(tg.id)}>
                  <Text style={{ color: C.coral, fontWeight: '800', fontSize: 17, padding: 2 }}>×</Text>
                </Pressable>
              </View>
            </View>
            <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1.5 }}>
          <Text style={s.label}>{t('種目名')}</Text>
          {/* フリーテキストではなく記録側と同じピッカーで選ぶ（表記ゆれで目標と記録が紐づかない事故の根治） */}
          <Pressable style={[s.input, { justifyContent: 'center' }]} onPress={() => setLiftPickOpen(true)}>
            <Text style={{ fontSize: 17, color: tName ? C.ink : C.faint }} numberOfLines={1}>
              {tName || t('タップして選ぶ')}
            </Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{t('重量（kg）')}</Text>
          <TextInput style={s.input} placeholder="100" placeholderTextColor={C.faint} keyboardType="decimal-pad" value={tKg} onChangeText={setTKg} />
        </View>
      </View>
      {/* 回数は「1回=MAX重量」を主役に大きく。5/8/10回で入れてもRM換算で1RM目標に統一される */}
      <Text style={s.label}>{t('回数（1回=そのままMAX目標）')}</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {[1, 5, 8, 10].map((r) => (
          <Chip key={r} label={r === 1 ? t('1回（MAX）') : t('{n}回', { n: r })} tone="ink" selected={tReps === r} onPress={() => setTReps(r)} />
        ))}
      </View>
      {isBodyweightLift(tName) && (
        <Text style={s.rmPreview}>
          {t('※ 自重種目の達成判定は実負荷（体重＋加重）で見ます。目標も体重を含めた重量で入れてください。')}
        </Text>
      )}
      {Number(tKg) > 0 && tReps > 1 && (
        <Text style={s.rmPreview}>RM換算: {tName.trim() || t('この種目')}のMAX目標 ≈ {Math.round(epley1RM(Number(tKg), tReps))}kg</Text>
      )}
      <OptionButton style={{ marginTop: 12 }} variant="tonal" label={t('筋トレ目標を追加')} onPress={addTrainingGoal} busy={busy} />

      {/* 種目ピッカー。GoalPanelはpageSheetシートの中に置かれることがあるため、
          LiftPickerのModalはこのツリーの内側でレンダリングする
          （そのシートの内側に重なる。MyFoodForm内のBarcodeScannerと同じ流儀） */}
      <LiftPicker
        visible={liftPickOpen}
        onClose={() => setLiftPickOpen(false)}
        history={liftHist}
        onPick={(name) => setTName(name)}
      />
    </>
  );

  const cheatSection = (
    <>
      <View style={s.h2Row}><Beef size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('チートデイ')}</Text></View>
      <Text style={s.note}>{t('登録した日は目標が+設定kcalに緩み、超過分は前後の日で計画が自動吸収します。')}</Text>
      {events.map((e) => (
        <View key={e.id} style={s.evRow}>
          <Text style={s.evDate}>{e.date.slice(5).replace('-', '/')}</Text>
          <Text style={s.evTitle}>{e.title}</Text>
          <Text style={s.evKcal}>+{Number(e.extra_kcal).toLocaleString()}kcal</Text>
          <Pressable onPress={() => removeEvent(e.id)} hitSlop={6}>
            <Text style={{ color: C.coral, fontWeight: '800', fontSize: 17 }}>×</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
        <View style={{ flex: 1.4 }}>
          <Text style={s.label}>{t('日付')}</Text>
          <Pressable style={s.input} onPress={() => setEvPicker((v) => !v)}>
            <Text style={{ fontSize: 17, color: evDate ? C.ink : C.faint }}>{evDate ? evDate.replace(/-/g, '/') : t('選ぶ')}</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>+kcal</Text>
          <TextInput style={s.input} keyboardType="number-pad" value={evKcal} onChangeText={setEvKcal} />
        </View>
        <OptionButton variant="tonal" label={t('追加')} onPress={addEvent} busy={busy} />
      </View>
      {evPicker && (
        <DateTimePicker
          locale={apiLang()}
          value={evDate ? new Date(evDate + 'T00:00:00') : new Date()}
          mode="date" display="inline" minimumDate={new Date()}
          onChange={(_, d) => { if (d) setEvDate(fmt(d)); setEvPicker(false); }}
        />
      )}
    </>
  );

  return (
    <View>
      {/* ===== 統合目標画面 ===== */}
      {mode === 'hub' && (
        <>
          <View style={s.card}>
            {weightGoalForm}
            <View style={s.divider} />
            {deficitSection}
            <OptionButton style={{ marginTop: 14 }} label={t('体重の目標を保存する')} onPress={saveWeightGoal} busy={busy} />
          </View>

          <View style={s.card}>
            {habitFormSection}
            <View style={s.divider} />
            {liftGoalSection}
          </View>

          <View style={s.card}>
            <View style={s.h2Row}><Scale size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('習慣')}</Text></View>
            <HabitGoals />
          </View>

          <View style={[s.card, s.cardAccent]}>
            {allowanceSection}
          </View>

          <View style={s.card}>
            <View style={s.h2Row}>
              <Beef size={16} color={C.teal} />
              <Text style={[s.h2, { marginBottom: 0 }]}>{t('PFCの内訳')}</Text>
              <View style={s.optBadge}><Text style={s.optBadgeT}>{t('任意')}</Text></View>
            </View>
            <Text style={s.note}>{t('目的に合わせて既定値が入っています。そのままでも大丈夫。変えたい人だけ書き換えてください。')}</Text>
            {pfcSection}
            <OptionButton style={{ marginTop: 14 }} variant="tonal" label={t('PFCを保存する')} onPress={saveWeightGoal} busy={busy} />
          </View>

          {showCheat && <View style={s.card}>{cheatSection}</View>}
        </>
      )}

      {/* ===== 体重目標だけ（オンボーディング等） ===== */}
      {mode === 'weight' && (
        <View style={s.card}>
          {showGoal && (
            <>
              {weightGoalForm}
              <View style={{ height: 12 }} />
              {pfcSection}
              <OptionButton style={{ marginTop: 14 }} label={t('目標を保存する')} onPress={saveWeightGoal} busy={busy} />
            </>
          )}
          {showGoal && showCheat && <View style={s.divider} />}
          {showCheat && cheatSection}
        </View>
      )}

      {/* ===== 運動の目標だけ（運動タブ・オンボーディング） ===== */}
      {mode === 'training' && (
        <View style={s.card}>
          {habitFormSection}
          <View style={s.divider} />
          {liftGoalSection}
        </View>
      )}

      {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
    </View>
  );
}

const s = themed(() => ({
  puChip: {
    backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  puChipOn: { backgroundColor: C.teal, borderColor: C.teal },
  puChipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: 20, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  // 結論カードだけアクセントの薄い面で「ここが答え」を示す
  cardAccent: { backgroundColor: C.accentSoft, borderColor: C.accentBorder, borderWidth: 1 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink, marginBottom: 6 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  divider: { height: 0.5, backgroundColor: C.line, marginVertical: 14 },
  statusRow: { marginBottom: 14 },
  statusBig: { fontSize: 24, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  statusSub: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  label: { fontSize: 13, fontWeight: '700', color: C.sub, marginTop: 10, marginBottom: 4 },
  rmPreview: { fontSize: 13, fontWeight: '700', color: C.teal, marginTop: 8 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 17, color: C.ink },
  note: { fontSize: 13, color: C.sub, lineHeight: 18, marginBottom: 6 },
  tiny: { fontSize: 11, color: C.faint, lineHeight: 15, marginTop: 8 },
  guard: { fontSize: 13, fontWeight: '700', lineHeight: 18, marginTop: 4 },
  // 必要な赤字の3並び（日/週/月）
  triRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  triCell: { flex: 1, backgroundColor: C.bg, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
  triLabel: { fontSize: 11, fontWeight: '700', color: C.sub },
  triNum: { fontSize: 18, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  triUnit: { fontSize: 11, color: C.faint },
  // 結論の大数字
  bigNum: { fontSize: 40, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], lineHeight: 46 },
  bigUnit: { fontSize: 17, fontWeight: '600', color: C.sub, marginBottom: 6 },
  adjBadge: { backgroundColor: C.accentBadge, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8, marginLeft: 4 },
  adjBadgeT: { fontSize: 12, fontWeight: '800', color: C.teal },
  projBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: rgba(C.amber, 0.08), borderRadius: 12, padding: 10, marginTop: 10 },
  projT: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  optBadge: { backgroundColor: C.chipBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  optBadgeT: { fontSize: 11, fontWeight: '800', color: C.sub },
  evRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: C.line },
  evDate: { fontSize: 13, fontWeight: '800', color: C.ink, width: 44, fontVariant: ['tabular-nums'] },
  evTitle: { flex: 1, fontSize: 15, color: C.ink },
  evKcal: { fontSize: 13, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  tgRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tgName: { fontSize: 15, fontWeight: '700', color: C.ink },
  tgNum: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  bar: { height: 8, backgroundColor: C.track, borderRadius: 4, marginTop: 5, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: C.teal, borderRadius: 4 },
  msg: { fontSize: 15, fontWeight: '600', paddingHorizontal: 4 },
}));
