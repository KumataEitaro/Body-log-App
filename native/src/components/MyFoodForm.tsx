// マイ食品の登録フォーム。
// これまで「一覧と削除」しかなく、ユーザーが自分でマイ食品を追加できなかったため新設した。
// 2つの入口から同じフォームを使う:
//  ・設定 → マイ食品の管理 → ＋追加（空のフォーム）
//  ・食事の保存後の案内 → 登録してみる（名前・単位・栄養値が埋まった状態）
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Modal, ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { OptionButton } from '@/components/ui/Selectable';

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
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [kcal, setKcal] = useState('');
  const [p, setP] = useState('');
  const [f, setF] = useState('');
  const [c, setC] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
                const { error } = await supabase.from('my_foods').update(row).eq('id', dup.id);
                setBusy(false);
                if (error) { setMsg({ ok: false, text: t('保存に失敗しました。もう一度お試しください。') }); return; }
                onSaved();
                onClose();
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
          <Text style={s.title}>{'🍱 ' + t('マイ食品を追加')}</Text>
          <Text style={s.note}>{t('よく食べるものを登録すると、入力欄の上のチップから1タップで足せます。')}</Text>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.label}>{t('名前')}</Text>
            <TextInput style={s.input} value={name} onChangeText={setName}
                       placeholder={t('例: オートミール')} placeholderTextColor={C.faint} />

            <Text style={s.label}>{t('1回分の量（任意）')}</Text>
            <TextInput style={s.input} value={unit} onChangeText={setUnit}
                       placeholder={t('例: 80g')} placeholderTextColor={C.faint} />

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

            <OptionButton style={{ marginTop: 18 }} label={t('登録する')} onPress={submit} busy={busy} />
            <OptionButton style={{ marginTop: 8 }} variant="tonal" label={t('キャンセル')} onPress={onClose} />
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: 18 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  note: { fontSize: 12, color: C.sub, marginTop: 6, marginBottom: 10, lineHeight: 18 },
  label: { fontSize: 11.5, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 5 },
  input: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: C.ink,
  },
  row: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },
  msg: { fontSize: 12.5, fontWeight: '700', marginTop: 12 },
});
