// マイ食品の追加シート（2026-09-02・旧 MyFoodForm を置き換え）。
// 2つの入口から同じシートを使う:
//  ・設定 → マイ食品の管理 → 「＋ 食品を追加」（空のシート。AI計算が主導線）
//  ・食事の保存後の案内「◯◯をよく食べるようですね」→ 登録してみる（名前・栄養値が埋まった状態。手入力を開いて出す）
//
// 主導線は「食材を複数行で書く → AIで計算 → 品目一覧を確認・調整 → 1つのマイ食品として登録」。
// 定食のような組み合わせを1品として登録でき、以後はチップ1タップで足せる。
// AIを使いたくない人向けに、名前・kcal・P/F/C を直接入れる手入力（成分表示の写真・バーコードの補助つき）を
// 折り畳みで残している。
//
// 【配置の約束】このシートは呼び出し元の pageSheet（設定の「マイ食品の管理」）の**内側**に置くこと。
// iOSは表示中の pageSheet の兄弟として別の Modal を出せない（ボタンを押しても何も起きない）。
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Alert, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Camera, Salad, ScanBarcode, ChevronDown, ChevronRight, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { t, apiLang } from '@/lib/i18n';
import { C, sheetTopPad, themed, RADIUS, ICON } from '@/lib/ui';
import { OptionButton } from '@/components/ui/Selectable';
import BarcodeScanner from '@/components/BarcodeScanner';
import { lookupBarcode, packageNutrition } from '@/lib/foodDb';
import { analyzeFood, type LimitKind } from '@/lib/quicklog';
import { rescaleByQty, sumItems, type FoodItem } from '@/lib/items';
import { composeMyFood, findMyFoodByName, saveMyFood, type MyFoodInput } from '@/lib/foods';

/** 食事タブの登録案内から渡されるプリフィル（名前と栄養値。手入力を開いた状態で出す） */
export type MyFoodDraft = {
  name: string;
  unit?: string;
  kcal?: number;
  p?: number; f?: number; c?: number;
};

type Msg = { ok: boolean; text: string; upgrade?: boolean; kind?: LimitKind };

export default function AddFoodSheet({ visible, draft, onClose, onSaved }: {
  visible: boolean;
  draft: MyFoodDraft | null;      // nullなら空のシート
  onClose: () => void;
  onSaved: () => void;            // 一覧の再読込に使う
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  // ---- AIで計算（主導線） ----
  const [ingredients, setIngredients] = useState('');       // 食材の複数行入力
  const [items, setItems] = useState<FoodItem[] | null>(null); // AI解析の品目一覧（×で除外・量は編集可）
  const [aiBusy, setAiBusy] = useState(false);
  // ---- 手入力（折り畳み） ----
  const [manualOpen, setManualOpen] = useState(false);
  const [unit, setUnit] = useState('');
  const [kcal, setKcal] = useState('');
  const [p, setP] = useState('');
  const [f, setF] = useState('');
  const [c, setC] = useState('');
  const [helperBusy, setHelperBusy] = useState(false);   // 成分表示の写真・バーコード照会中
  const [scanOpen, setScanOpen] = useState(false);
  const [dbMiss, setDbMiss] = useState(false);            // バーコード未ヒット→成分表示写真への案内
  // ---- 共通 ----
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  // 開くたびに初期値を入れ直す（前回の入力が残らないように）。案内からの起動は手入力を開いた状態で
  useEffect(() => {
    if (!visible) return;
    setName(draft?.name ?? '');
    setIngredients('');
    setItems(null);
    setManualOpen(draft != null);
    setUnit(draft?.unit ?? '');
    setKcal(draft?.kcal != null ? String(Math.round(draft.kcal)) : '');
    setP(draft?.p != null ? String(Math.round(draft.p)) : '');
    setF(draft?.f != null ? String(Math.round(draft.f)) : '');
    setC(draft?.c != null ? String(Math.round(draft.c)) : '');
    setMsg(null);
    setDbMiss(false);
  }, [visible, draft]);

  // ===== AIで計算: 食材テキスト → 既存の analyzeFood（/api/parse-food）→ 品目一覧 =====
  async function runAi() {
    const text = ingredients.trim();
    if (!text) { setMsg({ ok: false, text: t('先に食材と量を入力してください。') }); return; }
    setAiBusy(true); setMsg(null);
    try {
      const r = await analyzeFood(text, []);
      if (!r.ok) {
        // プラン上限（429 plan_limit）は既存の流儀どおりペイウォール導線を出す
        setMsg({ ok: false, text: r.error, upgrade: r.upgrade, kind: r.kind });
        return;
      }
      const got = r.result.items.filter((it) => it && String(it.name ?? '').trim() !== '');
      if (got.length === 0) {
        setMsg({ ok: false, text: t('食材を読み取れませんでした。「鶏むね肉100g、白米150g」のように量も書いてください。') });
        return;
      }
      setItems(got);
      setMsg({ ok: true, text: t('{n}品を計算しました。量は数値で直せます。いらない行は×で外してください。', { n: got.length }) });
    } finally { setAiBusy(false); }
  }

  function removeItem(i: number) {
    if (!items) return;
    const next = items.filter((_, j) => j !== i);
    setItems(next.length > 0 ? next : null);
  }

  // 量の編集: 数値が読めれば栄養素を比例スケール（トレイの分量編集と同じ純関数）
  function changeQty(i: number, q: string) {
    if (!items) return;
    setItems(items.map((it, j) => (j === i ? rescaleByQty(it, q) : it)));
  }

  const total = items ? sumItems(items) : null;

  // ===== 保存（AI計算の結果／手入力のどちらも同じ経路） =====
  async function persist(input: MyFoodInput) {
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { setMsg({ ok: false, text: t('ログインが必要です。') }); return; }
      const nm = input.name.trim();
      // 同名は unique(user_id, name) 制約に当たるため、先に確認して上書きの意思を聞く
      const dupId = await findMyFoodByName(uid, nm);
      if (dupId) {
        setBusy(false);
        Alert.alert(t('「{name}」はすでに登録済みです。上書きしますか？', { name: nm }), '', [
          { text: t('キャンセル'), style: 'cancel' },
          {
            text: t('上書きする'),
            onPress: async () => {
              setBusy(true);
              try {
                const r = await saveMyFood(uid, input, dupId);
                if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
                onSaved(); onClose();
              } finally { setBusy(false); }   // 例外でもボタンを必ず戻す
            },
          },
        ]);
        return;
      }
      const r = await saveMyFood(uid, input);
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      onSaved(); onClose();
    } finally { setBusy(false); }
  }

  // AI計算の結果を1つのマイ食品として登録（名前が空なら「先頭の食材＋セット」）
  function saveComposed() {
    if (!items || items.length === 0) return;
    persist(composeMyFood(name, items));
  }

  // 手入力を登録
  function saveManual() {
    const nm = name.trim();
    if (!nm) { setMsg({ ok: false, text: t('名前を入力してください。') }); return; }
    const kc = Number(kcal);
    if (!(kc > 0)) { setMsg({ ok: false, text: t('カロリーを入力してください。') }); return; }
    persist({ name: nm, unit: unit.trim(), kcal: kc, p: Number(p) || 0, f: Number(f) || 0, c: Number(c) || 0, kind: 'food' });
  }

  // ===== 手入力の補助: 成分表示の写真（表記どおりの数値が入る）／バーコード（公式DB・AI枠を使わない） =====
  type ParseResult = { items?: { name?: string; qty?: string; kcal?: number; p?: number; f?: number; c?: number }[] };
  function fillManualFrom(r: ParseResult | undefined) {
    const list = r?.items ?? [];
    const it = list[0];
    if (!it || !(Number(it.kcal) > 0)) {
      setMsg({ ok: false, text: t('栄養値を読み取れませんでした。名前や量をもう少し具体的にするか、手入力してください。') });
      return;
    }
    const sum = (k: 'kcal' | 'p' | 'f' | 'c') => Math.round(list.reduce((a, x) => a + (Number(x[k]) || 0), 0));
    setKcal(String(sum('kcal')));
    setP(String(sum('p'))); setF(String(sum('f'))); setC(String(sum('c')));
    if (!name.trim() && it.name) setName(String(it.name));
    if (!unit.trim() && it.qty && list.length === 1) setUnit(String(it.qty));
    setMsg({ ok: true, text: t('数値を入れました。自由に直せます。') });
  }

  async function fromPhoto(fromCamera: boolean) {
    setMsg(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg({ ok: false, text: t('写真の許可が必要です（設定アプリ→BodyLog）。') }); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.85, selectionLimit: 1 });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    setHelperBusy(true);
    try {
      const small = await ImageManipulator.manipulateAsync(
        res.assets[0].uri, [{ resize: { width: 1280 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const { ok, json } = await apiPost<{ ok: boolean; error?: string; code?: string; result?: ParseResult }>(
        '/api/parse-food', { text: name.trim(), lang: apiLang(), images: [{ data: small.base64, mime: 'image/jpeg' }] });
      // プラン上限（429 plan_limit）はアップグレード導線を出す（写真枠）
      if (!ok || !json?.ok) { setMsg({ ok: false, text: json?.error || t('解析に失敗しました。もう一度お試しください。'), upgrade: json?.code === 'plan_limit', kind: 'photo' }); return; }
      fillManualFrom(json.result);
    } catch {
      setMsg({ ok: false, text: t('写真を処理できませんでした。もう一度お試しください。') });
    } finally { setHelperBusy(false); }
  }

  function pickPhotoSource() {
    Alert.alert(t('写真から読み取る'), t('パッケージ裏の栄養成分表示を撮ると、表記どおりの数値が入ります。'), [
      { text: t('カメラで撮る'), onPress: () => fromPhoto(true) },
      { text: t('ライブラリから選ぶ'), onPress: () => fromPhoto(false) },
      { text: t('キャンセル'), style: 'cancel' },
    ]);
  }

  async function fromBarcode(jan: string) {
    setHelperBusy(true); setMsg(null); setDbMiss(false);
    try {
      const fd = await lookupBarcode(jan);
      if (!fd) {
        setDbMiss(true);
        setMsg({ ok: false, text: t('データベースに見つかりませんでした。成分表示の写真を撮ると正確に読み取れます。') });
        return;
      }
      // 100gあたりを基準として充填（単位も100gにして量の意味を揃える）
      setName(fd.brand ? `${fd.brand} ${fd.name}` : fd.name);
      setUnit('100g');
      setKcal(String(Math.round(fd.per100g.kcal)));
      setP(String(fd.per100g.p)); setF(String(fd.per100g.f)); setC(String(fd.per100g.c));
      const pkg = packageNutrition(fd);
      setMsg({
        ok: true,
        text: pkg
          ? t('公式データベースの値（100gあたり）を入れました。1個（{g}g）なら約{kcal}kcalです。量の単位はいつでも直せます。', { g: pkg.g, kcal: Math.round(pkg.kcal) })
          : t('公式データベースの値（100gあたり）を入れました。量の単位はいつでも直せます。'),
      });
    } finally { setHelperBusy(false); }
  }

  const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.wrap}>
          <View style={s.head}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Salad size={ICON.lg} color={C.teal} />
              <Text style={s.title}>{t('マイ食品を追加')}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><Text style={s.close}>{t('閉じる')}</Text></Pressable>
          </View>
          <Text style={s.note}>{t('よく食べるものを登録すると、入力欄の上のチップから1タップで足せます。定食のような組み合わせも1つにまとめられます。')}</Text>

          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Text style={s.label}>{t('名前（任意）')}</Text>
            <TextInput style={s.input} value={name} onChangeText={setName} maxLength={40}
                       placeholder={t('例: 鶏むね定食（空なら先頭の食材＋セット）')} placeholderTextColor={C.faint} />

            {/* ===== AIで計算（主導線） ===== */}
            <Text style={s.label}>{t('食材と量')}</Text>
            <TextInput
              style={[s.input, s.multi]} value={ingredients} onChangeText={setIngredients}
              multiline textAlignVertical="top" maxLength={400}
              placeholder={t('例: 鶏むね肉100g、ブロッコリー50g、白米150g')} placeholderTextColor={C.faint}
            />
            <OptionButton style={{ marginTop: 10 }} variant="teal" label={t('✦ AIで計算')} busy={aiBusy} disabled={busy} onPress={runAi} />
            {/* AI枠を使うことを1行で明示（上限に達すると下の「プランを見る」へ） */}
            <Text style={s.hint}>{t('AIで計算はテキスト解析の枠を1回使います。')}</Text>

            {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
            {/* 上限到達（429 plan_limit）→ シートを閉じて kind 別の文脈ペイウォールへ */}
            {msg?.upgrade && (
              <Pressable hitSlop={8} style={({ pressed }) => [{ alignSelf: 'flex-start', marginTop: 6 }, pressed && { opacity: 0.7 }]}
                         onPress={() => { onClose(); router.push(`/paywall?src=limit_${msg.kind ?? 'text'}` as never); }}>
                <Text style={s.link}>{t('プランを見る →')}</Text>
              </Pressable>
            )}

            {/* 解析結果の品目一覧: 行ごとに × で除外・量は数値で編集（栄養素は比例スケール） */}
            {items && items.length > 0 && (
              <View style={s.itemsBox}>
                {items.map((it, i) => (
                  <View key={`${it.name}-${i}`} style={[s.itemRow, i === items.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.itemName} numberOfLines={1}>{it.name}</Text>
                      <Text style={s.itemPfc}>
                        {`${Math.round(it.kcal)}kcal・P${fmt1(it.p)} F${fmt1(it.f)} C${fmt1(it.c)}`}
                      </Text>
                    </View>
                    <TextInput
                      style={s.qtyInput} value={String(it.qty ?? '')} onChangeText={(v) => changeQty(i, v)}
                      keyboardType="numbers-and-punctuation" placeholder={t('量')} placeholderTextColor={C.faint}
                      accessibilityLabel={t('{name}の量', { name: it.name })}
                    />
                    <Pressable onPress={() => removeItem(i)} hitSlop={8} accessibilityLabel={t('{name}を外す', { name: it.name })}>
                      <X size={ICON.md} color={C.sub} />
                    </Pressable>
                  </View>
                ))}
                {total && (
                  <View style={s.totalRow}>
                    <Text style={s.totalT}>{t('合計')}</Text>
                    <Text style={s.totalV}>
                      {t('{k}kcal・P{p} F{f} C{c}', { k: Math.round(total.kcal).toLocaleString(), p: fmt1(total.p), f: fmt1(total.f), c: fmt1(total.c) })}
                    </Text>
                  </View>
                )}
                <OptionButton style={{ marginTop: 10 }} label={t('マイ食品として登録')} onPress={saveComposed} busy={busy} disabled={aiBusy} />
              </View>
            )}

            {/* ===== 手入力（折り畳み・AIを使いたくない人向け） ===== */}
            <Pressable style={s.fold} onPress={() => setManualOpen((v) => !v)} hitSlop={6}>
              {manualOpen ? <ChevronDown size={ICON.md} color={C.sub} /> : <ChevronRight size={ICON.md} color={C.sub} />}
              <Text style={s.foldT}>{t('手動で入力する（AIを使わない）')}</Text>
            </Pressable>
            {manualOpen && (
              <View>
                <Text style={s.label}>{t('1回分の量（任意）')}</Text>
                <TextInput style={s.input} value={unit} onChangeText={setUnit}
                           placeholder={t('例: 80g')} placeholderTextColor={C.faint} />

                {/* 補助: 成分表示の写真（最も正確）／バーコード（公式DB・AI枠を使わない）。数値はいつでも手で直せる */}
                <View style={s.helperRow}>
                  <Pressable style={[s.helperBtn, helperBusy && { opacity: 0.5 }]} onPress={pickPhotoSource} disabled={helperBusy}>
                    {helperBusy ? <ActivityIndicator size="small" color={C.teal} /> : <Camera size={ICON.sm} color={C.teal} />}
                    <Text style={s.helperT}>{t('成分表示を撮る')}</Text>
                  </Pressable>
                  <Pressable style={[s.helperBtn, helperBusy && { opacity: 0.5 }]} onPress={() => { setMsg(null); setScanOpen(true); }} disabled={helperBusy}>
                    <ScanBarcode size={ICON.sm} color={C.teal} />
                    <Text style={s.helperT}>{t('バーコードで探す')}</Text>
                  </Pressable>
                </View>
                <Text style={s.hint}>{t('成分表示のラベルを撮ると表記どおりの数値が入ります。バーコードはAI枠を使いません（※日本の商品はヒットしないことが多いです）。')}</Text>
                {/* DB未ヒット時: 成分表示写真へワンタップで進める */}
                {dbMiss && (
                  <Pressable style={[s.helperBtn, { marginTop: 8 }]} onPress={() => { setDbMiss(false); pickPhotoSource(); }}>
                    <Camera size={ICON.sm} color={C.teal} />
                    <Text style={s.helperT}>{t('成分表示を写真で読み取る')}</Text>
                  </Pressable>
                )}

                <Text style={s.label}>{t('カロリー（kcal）')}</Text>
                <TextInput style={s.input} value={kcal} onChangeText={setKcal}
                           keyboardType="number-pad" placeholder="0" placeholderTextColor={C.faint} />
                <View style={s.row}>
                  <View style={s.col}>
                    <Text style={s.label}>{t('たんぱく質')}</Text>
                    <TextInput style={s.input} value={p} onChangeText={setP}
                               keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.faint} />
                  </View>
                  <View style={s.col}>
                    <Text style={s.label}>{t('脂質')}</Text>
                    <TextInput style={s.input} value={f} onChangeText={setF}
                               keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.faint} />
                  </View>
                  <View style={s.col}>
                    <Text style={s.label}>{t('炭水化物')}</Text>
                    <TextInput style={s.input} value={c} onChangeText={setC}
                               keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.faint} />
                  </View>
                </View>
                <OptionButton style={{ marginTop: 14 }} label={t('登録する')} onPress={saveManual} busy={busy} disabled={aiBusy} />
              </View>
            )}

            <OptionButton style={{ marginTop: 14 }} variant="tonal" label={t('キャンセル')} onPress={onClose} />
            <View style={{ height: 28 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      {/* バーコードスキャナ（読み取り成功で即クローズ→公式DB照会）。このシートの内側に重ねる */}
      <BarcodeScanner visible={scanOpen} onClose={() => setScanOpen(false)} onScanned={fromBarcode} />
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: sheetTopPad(18) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  close: { fontSize: 15, fontWeight: '700', color: C.teal },
  note: { fontSize: 13, color: C.sub, marginTop: 6, marginBottom: 6, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 5 },
  input: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 17, color: C.ink,
  },
  multi: { minHeight: 88, lineHeight: 23 },
  hint: { fontSize: 12, color: C.sub, marginTop: 6, lineHeight: 17 },
  msg: { fontSize: 13, fontWeight: '700', marginTop: 12, lineHeight: 18 },
  link: { color: C.teal, fontWeight: '700', fontSize: 14 },
  // 解析結果の品目一覧
  itemsBox: {
    marginTop: 12, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: RADIUS.panel, paddingHorizontal: 12, paddingVertical: 6,
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9,
    borderBottomWidth: 0.5, borderBottomColor: C.line,
  },
  itemName: { fontSize: 15, fontWeight: '700', color: C.ink },
  itemPfc: { fontSize: 12, color: C.sub, marginTop: 2, fontVariant: ['tabular-nums'] },
  qtyInput: {
    width: 78, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input,
    paddingHorizontal: 8, paddingVertical: 7, fontSize: 14, color: C.ink, textAlign: 'center',
  },
  totalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 10, paddingBottom: 4, borderTopWidth: 1, borderTopColor: C.line, marginTop: 2,
  },
  totalT: { fontSize: 13, fontWeight: '800', color: C.sub },
  totalV: { fontSize: 14, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  // 手入力の折り畳み
  fold: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 22, paddingVertical: 6 },
  foldT: { fontSize: 14, fontWeight: '800', color: C.sub },
  row: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },
  helperRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  helperBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: RADIUS.input, paddingVertical: 11,
  },
  helperT: { fontSize: 13, fontWeight: '800', color: C.teal },
}));
