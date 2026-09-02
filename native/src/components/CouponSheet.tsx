// クーポンコード入力シート（pageSheet）。
// 入口は2箇所: 設定「アカウント設定 > クーポンコード」行 と ペイウォールの「コードをお持ちの方はこちら」。
// 成功すると /api/redeem-coupon が profiles.plan を直接書き換える（RC購読とは独立・無期限）ため、
// その場で gate のキャッシュを引き直して王冠が即消えるようにする（refreshGate）。
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ticket, X, PartyPopper } from 'lucide-react-native';
import { C, sheetTopPad, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { apiPost } from '@/lib/api';
import { refreshGate } from '@/lib/gate';

// 表示用のプラン名（サーバーはplan識別子で返す）
function planLabel(plan: string): string {
  switch (plan) {
    case 'lite': return t('ライト');
    case 'standard': return t('スタンダード');
    case 'premium': return t('プレミアム');
    default: return plan;
  }
}

export default function CouponSheet({ visible, onClose, onRedeemed }: {
  visible: boolean;
  onClose: () => void;
  /** 適用成功時（プラン表示の更新などに使える。省略可） */
  onRedeemed?: (plan: string) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [donePlan, setDonePlan] = useState<string | null>(null); // 成功したら祝祭表示に切り替え

  // 開き直すたびに前回の状態を持ち越さない
  useEffect(() => {
    if (visible) { setCode(''); setErr(''); setDonePlan(null); setBusy(false); }
  }, [visible]);

  async function redeem() {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true); setErr('');
    try {
      const { json, failure } = await apiPost<{ ok: boolean; plan?: string; error?: string }>(
        '/api/redeem-coupon', { code: c });
      if (!json?.ok || !json.plan) {
        setErr(
          failure === 'offline' ? t('通信できませんでした。電波状況を確認してもう一度お試しください。')
          : json?.error || t('コードを確認できませんでした。もう一度お試しください。'));
        return;
      }
      // 祝祭: 成功ハプティクス＋🎉（実績・法則図鑑と同じ「事件」のトーン）
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDonePlan(json.plan);
      // 王冠ゲートのキャッシュを即時更新（次の画面遷移を待たずに解放が見える）
      refreshGate().catch(() => {});
      onRedeemed?.(json.plan);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.wrap}>
          <View style={s.head}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ticket size={18} color={C.teal} />
              <Text style={s.title}>{t('クーポンコード')}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}><X size={20} color={C.sub} /></Pressable>
          </View>

          {donePlan ? (
            /* ===== 成功（祝祭）: 何が起きたかを1画面で ===== */
            <View style={s.doneBox}>
              <View style={s.doneIcon}><PartyPopper size={30} color={C.teal} /></View>
              <Text style={s.doneT}>{t('解放されました🎉')}</Text>
              <Text style={s.doneSub}>{t('{plan}プランの機能が使えるようになりました。', { plan: planLabel(donePlan) })}</Text>
              <Pressable style={s.doneCta} onPress={onClose}>
                <Text style={s.doneCtaT}>{t('はじめる')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={s.lead}>{t('お持ちのコードを入力すると、対応するプランの機能が解放されます。')}</Text>
              <TextInput
                style={s.input} value={code} onChangeText={setCode}
                placeholder={t('コードを入力')} placeholderTextColor={C.faint}
                autoCapitalize="none" autoCorrect={false} autoFocus
                returnKeyType="go" onSubmitEditing={redeem}
              />
              {!!err && <Text style={s.err}>{err}</Text>}
              <Pressable
                style={({ pressed }) => [s.cta, (!code.trim() || busy) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
                disabled={!code.trim() || busy} onPress={redeem}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.ctaT}>{t('コードを使う')}</Text>}
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, padding: 16, paddingTop: sheetTopPad(18) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  lead: { fontSize: 13, color: C.sub, lineHeight: 19, marginBottom: 14 },
  input: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontWeight: '700', color: C.ink,
  },
  err: { fontSize: 12.5, color: C.coral, marginTop: 8, lineHeight: 18 },
  cta: { marginTop: 14, borderRadius: 12, paddingVertical: 13, alignItems: 'center', backgroundColor: C.teal },
  ctaT: { fontSize: 15, fontWeight: '800', color: '#fff' },
  // 成功の祝祭（laws.tsxのCelebrateOverlayと同じトーン）
  doneBox: { alignItems: 'center', marginTop: 28, paddingHorizontal: 8 },
  doneIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  doneT: { fontSize: 19, fontWeight: '900', color: C.ink, marginTop: 10 },
  doneSub: { fontSize: 13.5, color: C.sub, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  doneCta: { backgroundColor: C.teal, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 26, marginTop: 18, alignSelf: 'stretch', alignItems: 'center' },
  doneCtaT: { fontSize: 15, fontWeight: '800', color: '#fff' },
}));
