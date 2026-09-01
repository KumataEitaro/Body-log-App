// マイ食品の登録フォーム。
// これまで「一覧と削除」しかなく、ユーザーが自分でマイ食品を追加できなかったため新設した。
// 2つの入口から同じフォームを使う:
//  ・設定 → マイ食品の管理 → ＋追加（空のフォーム）
//  ・食事の保存後の案内 → 登録してみる（名前・単位・栄養値が埋まった状態）
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Modal, ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Sparkles, Camera, Salad, ScanBarcode } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { apiLang } from '@/lib/i18n';
import { C, sheetTopPad } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { OptionButton } from '@/components/ui/Selectable';
import BarcodeScanner from '@/components/BarcodeScanner';
import { lookupBarcode, packageNutrition } from '@/lib/foodDb';

export type MyFoodDraft = {
  name: string;
  unit?: string;
  kcal?: number;
  p?: number; f?: number; c?: number;
};

export default function MyFoodForm({ visible, draft, onClose, onSaved }: {
  visible: boolean;
  draft: MyFoodDraft | null;      // nullなら空のフォーム
  onClose: () => void;
  onSaved: () => void;            // 一覧の再読込に使う
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [kcal, setKcal] = useState('');
  const [p, setP] = useState('');
  const [f, setF] = useState('');
  const [c, setC] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; upgrade?: boolean; kind?: 'text' | 'photo' } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);   // バーコードスキャナの表示
  const [dbMiss, setDbMiss] = useState(false);       // DB未ヒット時に写真経路への案内ボタンを出す

  // AI解析の結果（items先頭 or 合計）でフォームを埋める共通処理
  type ParseResult = { items?: { name?: string; qty?: string; kcal?: number; p?: number; f?: number; c?: number }[] };
  function fillFrom(r: ParseResult | undefined) {
    const it = r?.items?.[0];
    if (!it || !(Number(it.kcal) > 0)) {
      setMsg({ ok: false, text: t('栄養値を読み取れませんでした。名前や量をもう少し具体的にするか、手入力してください。') });
      return;
    }
    // 複数品目が返ったら合計にする（お弁当の写真など）
    const items = r!.items!;
    const sum = (k: 'kcal' | 'p' | 'f' | 'c') => Math.round(items.reduce((a, x) => a + (Number(x[k]) || 0), 0));
    setKcal(String(sum('kcal')));
    setP(String(sum('p'))); setF(String(sum('f'))); setC(String(sum('c')));
    if (!name.trim() && it.name) setName(String(it.name));
    if (!unit.trim() && it.qty && items.length === 1) setUnit(String(it.qty));
    setMsg({ ok: true, text: items.length > 1 ? t('{n}品目の合計を入れました。数値は自由に直せます。', { n: items.length }) : t('AIが数値を入れました。自由に直せます。') });
  }

  // 名前＋量のテキストからAI推定
  async function aiFromText() {
    const q = `${name.trim()} ${unit.trim()}`.trim();
    if (!q) { setMsg({ ok: false, text: t('先に名前（と量）を入力してください。') }); return; }
    setAiBusy(true); setMsg(null);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; error?: string; code?: string; result?: ParseResult }>(
        '/api/parse-food', { text: q, lang: apiLang() });
      // プラン上限（429 plan_limit）はアップグレード導線を出す（テキスト枠）
      if (!ok || !json?.ok) { setMsg({ ok: false, text: json?.error || t('解析に失敗しました。もう一度お試しください。'), upgrade: json?.code === 'plan_limit', kind: 'text' }); return; }
      fillFrom(json.result);
    } finally { setAiBusy(false); }
  }

  // 写真からAI推定（成分表示ラベルを撮ると表記値がそのまま入る）
  async function aiFromPhoto(fromCamera: boolean) {
    setMsg(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg({ ok: false, text: t('写真の許可が必要です（設定アプリ→BodyLog）。') }); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.85, selectionLimit: 1 });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    setAiBusy(true);
    try {
      const small = await ImageManipulator.manipulateAsync(
        res.assets[0].uri, [{ resize: { width: 1280 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const { ok, json } = await apiPost<{ ok: boolean; error?: string; code?: string; result?: ParseResult }>(
        '/api/parse-food', { text: name.trim(), lang: apiLang(), images: [{ data: small.base64, mime: 'image/jpeg' }] });
      // プラン上限（429 plan_limit）はアップグレード導線を出す（写真枠）
      if (!ok || !json?.ok) { setMsg({ ok: false, text: json?.error || t('解析に失敗しました。もう一度お試しください。'), upgrade: json?.code === 'plan_limit', kind: 'photo' }); return; }
      fillFrom(json.result);
    } catch {
      setMsg({ ok: false, text: t('写真を処理できませんでした。もう一度お試しください。') });
    } finally { setAiBusy(false); }
  }

  function pickPhotoSource() {
    Alert.alert(t('写真から読み取る'), t('パッケージ裏の栄養成分表示を撮ると、表記どおりの数値が入ります。'), [
      { text: t('カメラで撮る'), onPress: () => aiFromPhoto(true) },
      { text: t('ライブラリから選ぶ'), onPress: () => aiFromPhoto(false) },
      { text: t('キャンセル'), style: 'cancel' },
    ]);
  }

  // バーコード（第4の方式）: 公式DB（Open Food Facts）ヒットで名前/kcal/PFCを自動充填。
  // 端末→OFF直の照会なのでAI枠は消費しない。未ヒットは既存の成分表示写真経路へ案内する。
  async function fromBarcode(jan: string) {
    setAiBusy(true); setMsg(null); setDbMiss(false);
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
      // 内容量が取れたら1個ぶんの換算候補も添える（数値は自由に直せる）
      const pkg = packageNutrition(fd);
      setMsg({
        ok: true,
        text: pkg
          ? t('公式データベースの値（100gあたり）を入れました。1個（{g}g）なら約{kcal}kcalです。量の単位はいつでも直せます。', { g: pkg.g, kcal: Math.round(pkg.kcal) })
          : t('公式データベースの値（100gあたり）を入れました。量の単位はいつでも直せます。'),
      });
    } finally { setAiBusy(false); }
  }

  // 開くたびに初期値を入れ直す（前回の入力が残らないように）
  useEffect(() => {
    if (!visible) return;
    setName(draft?.name ?? '');
    setUnit(draft?.unit ?? '');
    setKcal(draft?.kcal != null ? String(Math.round(draft.kcal)) : '');
    setP(draft?.p != null ? String(Math.round(draft.p)) : '');
    setF(draft?.f != null ? String(Math.round(draft.f)) : '');
    setC(draft?.c != null ? String(Math.round(draft.c)) : '');
    setMsg(null);
    setDbMiss(false);
  }, [visible, draft]);

  async function submit() {
    const nm = name.trim();
    if (!nm) { setMsg({ ok: false, text: t('名前を入力してください。') }); return; }
    const kc = Number(kcal);
    if (!(kc > 0)) { setMsg({ ok: false, text: t('カロリーを入力してください。') }); return; }

    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { setMsg({ ok: false, text: t('ログインが必要です。') }); return; }

      const row = {
        user_id: uid, name: nm,
        unit: unit.trim() || t('1人前'),
        kcal: kc, p: Number(p) || 0, f: Number(f) || 0, c: Number(c) || 0,
      };

      // 同名は unique(user_id, name) 制約に当たるため、先に確認して上書きの意思を聞く
      const { data: dup } = await supabase.from('my_foods')
        .select('id').eq('user_id', uid).eq('name', nm).maybeSingle();

      if (dup?.id) {
        setBusy(false);
        Alert.alert(
          t('「{name}」はすでに登録済みです。上書きしますか？', { name: nm }),
          '',
          [
            { text: t('キャンセル'), style: 'cancel' },
            {
              text: t('上書きする'),
              onPress: async () => {
                setBusy(true);
                try {
                  const { error } = await supabase.from('my_foods').update(row).eq('id', dup.id);
                  if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
                  onSaved();
                  onClose();
                } catch {
                  setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') });
                } finally {
                  setBusy(false);   // 例外でもボタンを必ず戻す
                }
              },
            },
          ],
        );
        return;
      }

      const { error } = await supabase.from('my_foods').insert(row);
      if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.wrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Salad size={18} color={C.teal} />
            <Text style={s.title}>{t('マイ食品を追加')}</Text>
          </View>
          <Text style={s.note}>{t('よく食べるものを登録すると、入力欄の上のチップから1タップで足せます。')}</Text>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.label}>{t('名前')}</Text>
            <TextInput style={s.input} value={name} onChangeText={setName}
                       placeholder={t('例: オートミール')} placeholderTextColor={C.faint} />

            <Text style={s.label}>{t('1回分の量（任意）')}</Text>
            <TextInput style={s.input} value={unit} onChangeText={setUnit}
                       placeholder={t('例: 80g')} placeholderTextColor={C.faint} />

            {/* AI入力: 手入力の代わりに、写真（成分表示）or 名前+量のテキストから栄養値を埋める。
                成分表示の撮影がいちばん正確に入るので先頭に置く */}
            <View style={s.aiRow}>
              <Pressable style={[s.aiBtn, aiBusy && { opacity: 0.5 }]} onPress={pickPhotoSource} disabled={aiBusy}>
                <Camera size={15} color={C.teal} />
                <Text style={s.aiBtnT}>{t('写真から読み取る（成分表示）')}</Text>
              </Pressable>
              <Pressable style={[s.aiBtn, aiBusy && { opacity: 0.5 }]} onPress={aiFromText} disabled={aiBusy}>
                {aiBusy ? <ActivityIndicator size="small" color={C.teal} /> : <Sparkles size={15} color={C.teal} />}
                <Text style={s.aiBtnT}>{t('AIにおまかせ')}</Text>
              </Pressable>
            </View>
            <Text style={s.aiHint}>{t('成分表示のラベルを撮ると表記どおりの数値が入ります。下の欄はいつでも手で直せます。')}</Text>
            {/* バーコード→公式DB（Open Food Facts）。日本の商品はほぼ未収載のため末尾の従導線に */}
            <View style={s.aiRow}>
              <Pressable style={[s.aiBtn, aiBusy && { opacity: 0.5 }]} onPress={() => { setMsg(null); setScanOpen(true); }} disabled={aiBusy}>
                <ScanBarcode size={15} color={C.teal} />
                <Text style={s.aiBtnT}>{t('バーコードで探す')}</Text>
              </Pressable>
            </View>
            <Text style={s.aiHint}>{t('※日本の商品はヒットしないことが多いです')}</Text>

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

            {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
            {/* 上限到達（429 plan_limit）→ フォームを閉じてkind別の文脈ペイウォールへ */}
            {msg?.upgrade && (
              <Pressable hitSlop={8} style={({ pressed }) => [{ alignSelf: 'flex-start', marginTop: 6 }, pressed && { opacity: 0.7 }]}
                         onPress={() => { onClose(); router.push(`/paywall?src=limit_${msg.kind ?? 'text'}` as never); }}>
                <Text style={{ color: C.teal, fontWeight: '700', fontSize: 14 }}>{t('プランを見る →')}</Text>
              </Pressable>
            )}
            {/* DB未ヒット時: 既存の成分表示写真経路（AI読み取り）へワンタップで進める */}
            {dbMiss && (
              <Pressable style={[s.aiBtn, { marginTop: 8 }]} onPress={() => { setDbMiss(false); pickPhotoSource(); }}>
                <Camera size={15} color={C.teal} />
                <Text style={s.aiBtnT}>{t('成分表示を写真で読み取る')}</Text>
              </Pressable>
            )}

            <OptionButton style={{ marginTop: 18 }} label={t('登録する')} onPress={submit} busy={busy} />
            <OptionButton style={{ marginTop: 8 }} variant="tonal" label={t('キャンセル')} onPress={onClose} />
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      {/* バーコードスキャナ（読み取り成功で即クローズ→公式DB照会） */}
      <BarcodeScanner visible={scanOpen} onClose={() => setScanOpen(false)} onScanned={fromBarcode} />
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: sheetTopPad(18) },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  note: { fontSize: 13, color: C.sub, marginTop: 6, marginBottom: 10, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 5 },
  input: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 17, color: C.ink,
  },
  row: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },
  msg: { fontSize: 13, fontWeight: '700', marginTop: 12 },
  aiRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  aiBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: 12, paddingVertical: 11,
  },
  aiBtnT: { fontSize: 13.5, fontWeight: '800', color: C.teal },
  aiHint: { fontSize: 11.5, color: C.sub, marginTop: 6, lineHeight: 16 },
});
