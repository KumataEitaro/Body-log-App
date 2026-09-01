// マイミール保存シート: トレイ/記録の品目一式に名前をつけて my_meals へ保存する小フォーム。
// 既定名は「品目1つ目＋セット」。呼び出し元（食事タブ）の上に透過モーダルで重ねる
// （pageSheetの内側からは使わない前提。iOSはpageSheet内のネストModalが出ないため）。
import { useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { UtensilsCrossed } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { C, rgba } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { saveMyMeal, defaultMealName, mealKcal } from '@/lib/meals';
import type { FoodItem } from '@/lib/items';

type Props = {
  visible: boolean;
  uid: string | null;
  items: FoodItem[];
  onClose: () => void;
  /** 保存成功時（確定したセット名を渡す）。一覧の再読込・後続の✓保存は呼び出し側で行う */
  onSaved: (name: string) => void;
};

export default function SaveMealSheet({ visible, uid, items, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // 開くたびに既定名をプリフィルし直す（前回の入力を引きずらない）
  useEffect(() => {
    if (visible) { setName(defaultMealName(items)); setErr(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function save() {
    if (!uid || busy) return;
    setBusy(true); setErr('');
    try {
      const nm = name.trim();
      const r = await saveMyMeal(uid, nm, items);
      if (!r.ok) { setErr(r.error); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved(nm);
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.backdrop}>
        {/* 背景タップで閉じる（保存前なので何も変わらない） */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={s.card}>
          <View style={s.titleRow}>
            <UtensilsCrossed size={17} color={C.teal} />
            <Text style={s.title}>{t('マイミールに保存')}</Text>
          </View>
          <Text style={s.sub}>{t('この組み合わせをセットとして保存し、次からはチップの1タップで再記録できます。')}</Text>
          <Text style={s.meta}>{t('{n}品・約{k}kcal', { n: items.length, k: mealKcal(items).toLocaleString() })}</Text>
          <TextInput
            style={s.input} value={name} onChangeText={setName}
            placeholder={t('セット名')} placeholderTextColor={C.faint}
            autoFocus maxLength={40} returnKeyType="done" onSubmitEditing={save}
          />
          {!!err && <Text style={s.err}>{err}</Text>}
          <View style={s.btnRow}>
            <Pressable style={s.btnGhost} onPress={onClose} disabled={busy}>
              <Text style={s.btnGhostT}>{t('キャンセル')}</Text>
            </Pressable>
            <Pressable style={[s.btnPrimary, (!name.trim() || busy) && { opacity: 0.4 }]}
                       onPress={save} disabled={!name.trim() || busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>{t('保存する')}</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(14,17,22,0.45)' },
  card: {
    backgroundColor: C.panel, borderRadius: 20, padding: 18,
    borderWidth: StyleSheet.hairlineWidth, borderColor: rgba(C.ink, 0.08),
    shadowColor: '#0e1116', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  sub: { fontSize: 13, color: C.sub, lineHeight: 19 },
  meta: { fontSize: 12, fontWeight: '700', color: C.teal, marginTop: 8, fontVariant: ['tabular-nums'] },
  input: {
    marginTop: 8, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 17, color: C.ink,
  },
  err: { fontSize: 12, color: C.coral, marginTop: 8, lineHeight: 17 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btnGhost: {
    flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingVertical: 12, alignItems: 'center', backgroundColor: C.panel,
  },
  btnGhostT: { fontSize: 14, fontWeight: '800', color: C.sub },
  btnPrimary: { flex: 1, backgroundColor: C.teal, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryT: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
