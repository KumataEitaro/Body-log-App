// ＋ボタンの入口をひとまとめにした部品（2026-09-10・feat/plus-everywhere）
//
// 熊田さん「運動タブ、概要タブ、相談タブにもプラスボタン（食事運動などを記録する用のやつ）を。同じUIでね。
// 相談タブだけ、テキストボックスにかぶらない位置に調整して。あとそのプラスボタンからマイ食品を登録できるようにして」
//
// 中身: PlusFab（右下の＋）＋ PlusSheet（記録の種類を選ぶシート）＋ 行動の振り分け ＋
//       AddFoodSheet（マイ食品の登録）＋ BodyFatSheet（体脂肪率の AI 推定・2026-09-18）＋
//       体重・ウエストの保存（lib/weightLog.ts / lib/bodyLog.ts）＋ 小さなトースト。
// 4タブが同じ部品を描くので、見た目・並び・挙動は必ず一致する（タブごとに＋を作り直さない）。
//
// 【行動の振り分け（onAction）】
//   ① まず onLocal(a) をそのタブに問い合わせる。そのタブで自前処理できる行動（運動タブの exercise・
//      食事タブの meal:*／whattoeat／plan）は true を返して横取りする。
//   ② 残りはここで共通処理:
//        meal:text/myfood/library/camera・meal:whattoeat・plan → 食事タブへ遷移し、同じシートを開く
//          （/log?open=text|myfood|library|camera|whattoeat|plan&ts=…。log.tsx が受けて 400ms 後に開く）
//        exercise → /training?open=activity（運動タブが「運動を記録する」シートを開いた状態で着地）
//        bodyfat → その場で BodyFatSheet（写真から AI が体脂肪率を推定。**写真は保存しない**・数値だけ記録）
//        myfood:add → その場で AddFoodSheet（どのタブでも登録できる。遷移しない）
//        体重・ウエスト → PlusSheet の2段目で保存（遷移しない）
//   「体の写真」（bodyphoto → 概要タブの体写真ページ）は 2026-09-18 に廃止した。写真の保存はやめた。
//   PlusSheet は「閉じ切ってから onAction」を保証しているので、ここで開く Modal（AddFoodSheet）や
//   遷移先で開く pageSheet が、表示中の Modal の兄弟にならない（iOSの制約）。
//
// 【位置】既定は食事タブと同じ右下（insets.bottom + 12）。相談タブだけ bottomOffset でコンポーザーの上へ。
//        hidden=true のとき（相談タブのキーボード表示中）は描かない。
// 【ガイド照射】'dock' の登録は食事タブ（guideKey='dock'）だけ。他タブは登録しない（PlusFab.tsx 冒頭）。
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Animated, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PlusFab, { FAB_SIZE } from '@/components/PlusFab';
import PlusSheet, { type PlusAction, type MeasureKind } from '@/components/PlusSheet';
import AddFoodSheet from '@/components/AddFoodSheet';
import BodyFatSheet from '@/components/BodyFatSheet';
import { supabase } from '@/lib/supabase';
import { useUnits, kgToDisplay, fmtWeight, cmToDisplay } from '@/lib/units';
import { todayJST } from '@/lib/calc';
import { saveWeightEntry } from '@/lib/weightLog';
import { saveWaistEntry } from '@/lib/bodyLog';
import { C, RADIUS, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { navFrom, type NavFrom } from '@/lib/navHeader';

/** 食事タブ側で受ける open= の値（PlusAction から 'meal:' を外したもの） */
export type LogOpenParam = 'text' | 'myfood' | 'library' | 'camera' | 'whattoeat' | 'plan';

/** PlusAction → /log?open= の値。食事タブへ渡さない行動は null */
export function logOpenParamOf(a: PlusAction): LogOpenParam | null {
  switch (a) {
    case 'meal:text': return 'text';
    case 'meal:myfood': return 'myfood';
    case 'meal:library': return 'library';
    case 'meal:camera': return 'camera';
    case 'meal:whattoeat': return 'whattoeat';
    case 'plan': return 'plan';
    default: return null;
  }
}

export type PlusEntryProps = {
  /** この＋がどのタブに置かれているか。開いた先の戻るボタンに出す（lib/navHeader.ts） */
  from?: NavFrom;
  /** ガイドツアーの照射キー。食事タブだけ 'dock'（複数タブで登録すると照射がずれる） */
  guideKey?: 'dock' | null;
  /** 既定位置からさらに持ち上げる高さ（相談タブ: コンポーザー＋免責行の実測高さ＋余白） */
  bottomOffset?: number;
  /** true のとき＋を描かない（相談タブのキーボード表示中）。シート類は開いていれば残る */
  hidden?: boolean;
  /** ＋の左上に出す件数（食事タブ: 保存前のトレイの品目数） */
  badge?: number;
  /** そのタブで自前処理できる行動は true を返して横取りする */
  onLocal?: (a: PlusAction) => boolean;
  /** ＋を押した瞬間（食事タブ: 画面のメッセージを消す） */
  onOpen?: () => void;
  /** マイ食品を登録できたとき。渡さなければここで短いトーストを出す */
  onMyFoodSaved?: () => void;
  /** 体重を保存できたとき（kg）。渡さなければここで短いトーストを出す */
  onWeightSaved?: (kg: number) => void;
  /** ウエストを保存できたとき（cm）。渡さなければここで短いトーストを出す（2026-09-18） */
  onWaistSaved?: (cm: number) => void;
  /** 体脂肪率を保存できたとき（%）。渡さなければここで短いトーストを出す（2026-09-18） */
  onBodyfatSaved?: (pct: number) => void;
  /** 直近の体重kg（外れ値の確認とプレースホルダに使う）。省略ならシートを開くときに entries から読む */
  latestWeight?: number | null;
  /** 体重の記録先の日付（食事タブ: 表示中の日付）。省略なら今日 */
  date?: string;
};

/** 親が命令的に開くための口。食事タブの「体重を1回記録する」（スタートチェックリスト）が使う（2026-09-18） */
export type PlusEntryHandle = {
  /** ＋シートを開く。step を渡すとその数値の段から始まる（体重／ウエスト）。'bodyfat' は AI 推定のシートを直接開く */
  open: (step?: MeasureKind | 'bodyfat') => void;
};

const PlusEntry = forwardRef<PlusEntryHandle, PlusEntryProps>(function PlusEntry({
  guideKey = null, bottomOffset = 0, hidden = false, badge = 0, from,
  onLocal, onOpen, onMyFoodSaved, onWeightSaved, onWaistSaved, onBodyfatSaved, latestWeight, date,
}, ref) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusStep, setPlusStep] = useState<MeasureKind | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);
  const [bfOpen, setBfOpen] = useState(false);
  useImperativeHandle(ref, () => ({
    open: (step) => {
      onOpen?.();
      if (step === 'bodyfat') { setBfOpen(true); return; }   // 概要「体の記録」の体脂肪率タイルから
      setPlusStep(step); setPlusOpen(true);
    },
  }), [onOpen]);
  // 直近の体重: 親が持っていれば親の値、無ければシートを開くたびに読む（古い値で外れ値判定しない）
  const [fetchedWeight, setFetchedWeight] = useState<number | null>(null);
  const latest = latestWeight !== undefined ? latestWeight : fetchedWeight;
  useEffect(() => {
    if (!plusOpen || latestWeight !== undefined) return;
    let alive = true;
    supabase.from('entries').select('weight,date').not('weight', 'is', null)
      .order('date', { ascending: false }).limit(1)
      .then(({ data }) => {
        const rows = (data as { weight: number | null }[] | null) ?? [];
        if (alive && rows.length && rows[0].weight != null) setFetchedWeight(Number(rows[0].weight));
      });
    return () => { alive = false; };
  }, [plusOpen, latestWeight]);

  // ===== トースト（他タブでの「登録しました」。食事タブは自分のメッセージ欄を使うので出さない） =====
  const [toast, setToast] = useState<string | null>(null);
  const toastOp = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    Animated.timing(toastOp, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOp, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
    }, 2600);
  }, [toastOp]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ===== 行動の振り分け（PlusSheet が閉じ切ってから届く） =====
  function onAction(a: PlusAction) {
    if (onLocal?.(a)) return;
    const ts = String(Date.now());   // 同じ行動を続けて選んでも毎回開き直すためのノンス
    const open = logOpenParamOf(a);
    if (open) {
      router.navigate({ pathname: '/log', params: { open, ts } } as never);
      return;
    }
    switch (a) {
      case 'exercise':
        router.navigate({ pathname: '/training', params: { open: 'activity', ts } } as never);
        break;
      // 筋トレは全画面の記録画面へ直行（2026-09-17）。有酸素とは入力がまったく違うので、
      // ＋シートの時点で行き先を分けておく。日付は親が持っていればそれ、無ければ今日
      case 'lift':
        router.push({ pathname: '/lift-session', params: navFrom(from, { date: date ?? todayJST() }) } as never);
        break;
      // 体脂肪率は写真から AI が推定する。写真は保存しない（BodyFatSheet の冒頭コメント）
      case 'bodyfat':
        setBfOpen(true);
        break;
      case 'myfood:add':
        setAddOpen(true);
        break;
    }
  }

  // ===== 体重（シート内2段目）。null=成功／''=取り消し／文字列=エラー文（PlusSheet の契約） =====
  async function saveWeight(text: string): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await saveWeightEntry(text, {
      uid: session?.user?.id, date: date ?? todayJST(), unit: units.weight, latestWeight: latest,
    });
    if (!r.ok) return r.msg;
    if (onWeightSaved) onWeightSaved(r.kg);
    else showToast(t('体重 {w} を記録しました。', { w: fmtWeight(r.kg) }));
    // 次に外れ値を見るときの基準を更新（親が持っていない場合）
    setFetchedWeight(r.kg);
    return null;
  }

  // ===== ウエスト（シート内2段目）。契約は体重と同じ: null=成功／''=取り消し／文字列=エラー文 =====
  async function saveWaist(text: string): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await saveWaistEntry(text, units.height, { uid: session?.user?.id, date: date ?? todayJST() });
    if (!r.ok) return r.msg;
    if (onWaistSaved) onWaistSaved(r.value);
    else showToast(t('ウエスト {n} を記録しました。', { n: fmtWaist(r.value, units.height) }));
    return null;
  }
  function bodyfatSaved(pct: number) {
    if (onBodyfatSaved) onBodyfatSaved(pct);
    else showToast(t('体脂肪率 {n}% を記録しました。', { n: pct.toFixed(1) }));
  }

  function myFoodSaved() {
    if (onMyFoodSaved) onMyFoodSaved();
    else showToast(t('マイ食品に登録しました。'));
  }

  const fabBottom = insets.bottom + 12 + bottomOffset;
  let toastEl: ReactNode = null;
  if (toast) {
    toastEl = (
      <Animated.View pointerEvents="none" style={[s.toast, { bottom: fabBottom + FAB_SIZE + 12, opacity: toastOp }]}>
        <Text style={s.toastT} numberOfLines={2} maxFontSizeMultiplier={1.2}>{toast}</Text>
      </Animated.View>
    );
  }

  return (
    <>
      {!hidden && (
        <PlusFab
          onPress={() => { onOpen?.(); setPlusStep(undefined); setPlusOpen(true); }}
          badge={badge} guideKey={guideKey} bottomOffset={bottomOffset}
        />
      )}
      {toastEl}
      <PlusSheet
        visible={plusOpen} onClose={() => setPlusOpen(false)} onAction={onAction}
        onSaveWeight={saveWeight}
        weightUnit={units.weight}
        weightPlaceholder={latest != null ? kgToDisplay(latest, units.weight).toFixed(1) : '—'}
        onSaveWaist={saveWaist}
        waistUnit={units.height === 'ft' ? 'in' : 'cm'}
        waistPlaceholder="—"
        initialStep={plusStep}
      />
      {/* 体脂肪率（AI 推定・数値だけ保存）。PlusSheet が閉じ切ってから visible になる（兄弟Modalの問題を踏まない） */}
      <BodyFatSheet visible={bfOpen} date={date} onClose={() => setBfOpen(false)} onSaved={bodyfatSaved} />
      {/* マイ食品の登録（pageSheet）。PlusSheet が閉じ切ってから visible になるので兄弟Modalの問題を踏まない */}
      <AddFoodSheet visible={addOpen} draft={null} onClose={() => setAddOpen(false)} onSaved={myFoodSaved} />
    </>
  );
});
export default PlusEntry;

/** ウエストの表示（cm 設定は cm・ft 設定はインチ） */
function fmtWaist(cm: number, unit: 'cm' | 'ft'): string {
  return unit === 'ft' ? cmToDisplay(cm, 'ft').toFixed(1) + 'in' : cm.toFixed(1) + 'cm';
}

const s = themed(() => ({
  // ink地に明文字（PlusFab のバッジと同じ反転トーン）。＋のすぐ上・右寄せで、押した指の近くに出る
  toast: {
    position: 'absolute', right: 18, maxWidth: '70%', zIndex: 21,
    backgroundColor: C.ink, borderRadius: RADIUS.tile, paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: C.shadow, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  toastT: { fontSize: 13, fontWeight: '700', color: C.panel },
}));
