// 規約改定時の再同意ゲート（migration-27 / lib/consent.ts）。
//
// 規約・プライバシーポリシーを実質的に変えたら lib/consent.ts の TERMS_VERSION を上げる。
// 既存ユーザーは次に開いたときこのシートが出て、**同意するまで先へ進めない**。
// 「告知しただけ」では米国で同意の成立を争われうるため、明示同意を取り直す。
//
// 設計上の線引き:
//  - 閉じる手段は「同意する」か「ログアウト」だけ（×で回避できると意味がない）
//  - 判定できないとき（列が無い・圏外）は**出さない**＝誤爆で全員を止めない
//  - 記録は consent_log に履歴として積む（上書きしない＝後日の紛争で再現できる）
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { needsReconsent, recordConsent } from '@/lib/consent';
import { C, sheetTopPad, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';

const TERMS_URL = 'https://bodylog-orcin.vercel.app/terms';
const PRIVACY_URL = 'https://bodylog-orcin.vercel.app/privacy';

export default function ReconsentGate() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState(false);   // 「読みました」のチェック（同意の質を上げる）

  useEffect(() => {
    needsReconsent().then(setOpen).catch(() => {});
  }, []);

  async function agree() {
    if (!read || busy) return;
    setBusy(true);
    try {
      await recordConsent('terms');
      setOpen(false);
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet"
           onRequestClose={() => { /* 閉じさせない（同意かログアウトのみ） */ }}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }}
                  contentContainerStyle={[s.wrap, { paddingTop: sheetTopPad(20) }]}>
        <Animated.View entering={FadeInDown.duration(320)}>
          <Text style={s.h1}>{t('利用規約を更新しました')}</Text>
          <Text style={s.body}>
            {t('安心して使っていただくために、利用規約とプライバシーポリシーを更新しました。内容をご確認のうえ、同意をお願いします。')}
          </Text>

          <View style={s.card}>
            <Text style={s.cardH}>{t('主な変更点')}</Text>
            <Text style={s.li}>{t('・「食事の制約（食べないものの検知）」は推定であり、アレルギーや医学的な食事制限の安全確認には使えないことを明記しました。')}</Text>
            <Text style={s.li}>{t('・本サービスが医療機器ではなく、専門家の助言の代替ではないことを、あらためて明確にしました。')}</Text>
            <Text style={s.li}>{t('・責任の範囲、紛争の解決方法、規約変更時の通知方法を具体的に定めました。')}</Text>
          </View>

          <Pressable style={s.linkRow} onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}>
            <Text style={s.link}>{t('利用規約を読む')}</Text>
          </Pressable>
          <Pressable style={s.linkRow} onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}>
            <Text style={s.link}>{t('プライバシーポリシーを読む')}</Text>
          </Pressable>

          {/* 「読みました」のチェックを必須にする（同意の質＝執行力に効く）。
              緑✓ではなく四角のチェックにする（安全そうに見える表現を作らない方針） */}
          <Pressable style={s.checkRow} onPress={() => setRead((v) => !v)} hitSlop={8}>
            <View style={[s.box, read && s.boxOn]}>{read && <Text style={s.boxMark}>✓</Text>}</View>
            <Text style={s.checkT}>{t('内容を読んで理解しました')}</Text>
          </Pressable>

          <Pressable style={[s.agree, !read && { opacity: 0.4 }]} onPress={agree} disabled={!read || busy}>
            {busy ? <ActivityIndicator color={C.panel} />
                  : <Text style={s.agreeT}>{t('同意して続ける')}</Text>}
          </Pressable>

          <Pressable style={s.outRow} onPress={() => supabase.auth.signOut()} hitSlop={8}>
            <Text style={s.out}>{t('同意しない場合はログアウト')}</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { paddingHorizontal: 22, paddingBottom: 40 },
  h1: { fontSize: 21, fontWeight: '900', color: C.ink, marginBottom: 10 },
  body: { fontSize: 14.5, color: C.sub, lineHeight: 23, marginBottom: 16 },
  card: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16,
    padding: 16, marginBottom: 16,
  },
  cardH: { fontSize: 14, fontWeight: '800', color: C.ink, marginBottom: 8 },
  li: { fontSize: 13.5, color: C.sub, lineHeight: 22 },
  linkRow: { paddingVertical: 10 },
  link: { fontSize: 14.5, fontWeight: '700', color: C.teal, textDecorationLine: 'underline' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 18 },
  box: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { borderColor: C.ink, backgroundColor: C.ink },
  boxMark: { color: C.panel, fontSize: 15, fontWeight: '900' },
  checkT: { flex: 1, fontSize: 14.5, fontWeight: '700', color: C.ink },
  agree: { backgroundColor: C.ink, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  agreeT: { color: C.panel, fontSize: 15.5, fontWeight: '800' },
  outRow: { alignSelf: 'center', marginTop: 16, paddingVertical: 8 },
  out: { fontSize: 13, color: C.faint, textDecorationLine: 'underline' },
}));
