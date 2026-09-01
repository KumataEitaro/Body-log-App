// ご意見・不具合の報告シート（pageSheet）。入口は設定「サポート > ご意見・不具合の報告」。
//
// なぜ作ったか: β運用中なのに、ユーザーが不満を言える口がアプリの中に無かった。
// 「不満を言う場所が無い＝いきなり★1レビュー」を避けるには、まずここで受け止めるしかない。
//
// この画面で守っていること:
//  ・**何が一緒に送られるかを隠さない**（アプリのバージョン・OS・言語設定の3点だけ。
//    記録の中身は送らない、と本文に明記する）。書く前に読める位置に置く。
//  ・**返信できないことを先に言う**。期待させて黙るのが、いちばん信頼を失う。
//    返信が要る人には /support（App Store申請にも使っているサポートページ）へ逃がす。
//  ・種別が「不具合」だった送信は端末に記録し、以後30日は★レビューを依頼しない
//    （lib/reviewPrompt.ts）。不満のある人に星を求めない。
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { MessageSquare, X } from 'lucide-react-native';
import { C, sheetTopPad, RADIUS } from '@/lib/ui';
import { t, getLocale } from '@/lib/i18n';
import { apiPost } from '@/lib/api';
import { markBugReported } from '@/lib/reviewPrompt';

const SUPPORT_URL = 'https://bodylog-orcin.vercel.app/support';
const BODY_MAX = 1000;   // サーバー側（app/api/feedback/route.ts）と同じ上限

type Kind = 'bug' | 'idea' | 'other';

export default function FeedbackSheet({ visible, onClose }: {
  visible: boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>('bug');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  // 開き直すたびに前回の状態を持ち越さない
  useEffect(() => {
    if (visible) { setKind('bug'); setBody(''); setErr(''); setDone(false); setBusy(false); }
  }, [visible]);

  const left = BODY_MAX - body.length;
  const canSend = body.trim().length > 0 && left >= 0 && !busy;

  async function send() {
    if (!canSend) return;
    setBusy(true); setErr('');
    try {
      const { json, failure } = await apiPost<{ ok: boolean; error?: string }>('/api/feedback', {
        kind,
        body: body.trim(),
        // ここで送る3点は、上の注意書きに書いてあるものと完全に一致させること
        appVersion: Application.nativeApplicationVersion ?? '',
        platform: Platform.OS,
        locale: getLocale(),
      });
      if (!json?.ok) {
        setErr(
          failure === 'offline' ? t('通信できませんでした。電波状況を確認してもう一度お試しください。')
          : json?.error || t('送信できませんでした。しばらくしてからお試しください。'));
        return;
      }
      // 「不具合」を送った人には、以後30日★レビューを頼まない（reviewPrompt.tsが読む）
      if (kind === 'bug') markBugReported().catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone(true);
      // お礼を読める時間だけ置いて自動で閉じる（閉じるボタンを押させない）
      setTimeout(() => { onClose(); }, 1400);
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
              <MessageSquare size={18} color={C.teal} />
              <Text style={s.title}>{t('ご意見・不具合の報告')}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}><X size={20} color={C.sub} /></Pressable>
          </View>

          {done ? (
            /* ===== 送信できた（自動で閉じる） ===== */
            <View style={s.doneBox}>
              <Text style={s.doneT}>{t('ありがとうございます。全部読んでいます。')}</Text>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <Text style={s.lead}>
                {t('うまくいかないこと・こうしてほしいことを、そのまま書いてください。')}
              </Text>

              <Text style={s.label}>{t('種別')}</Text>
              <KindPicker value={kind} onChange={(k) => { setKind(k); setErr(''); }} />

              <View style={s.bodyHead}>
                <Text style={s.label}>{t('内容')}</Text>
                <Text style={[s.count, left < 0 && { color: C.coral }]}>
                  {t('残り{n}字', { n: left })}
                </Text>
              </View>
              <TextInput
                style={s.input} value={body}
                onChangeText={(v) => { setBody(v); setErr(''); }}
                multiline maxLength={BODY_MAX}
                placeholder={t('例: 写真から食事を登録すると、たまに保存できずに戻ってきます。')}
                placeholderTextColor={C.faint}
                textAlignVertical="top"
              />

              {/* 何が一緒に送られるか。書き終える前に読める位置に置く */}
              <View style={s.notice}>
                <Text style={s.noticeT}>
                  {t('送信内容に加えて、アプリのバージョン・OS・言語設定が一緒に送られます。')}
                </Text>
                <Text style={s.noticeSub}>
                  {t('体重・食事・写真などの記録の中身は送られません。')}
                </Text>
              </View>

              {!!err && <Text style={s.err}>{err}</Text>}

              <Pressable
                style={({ pressed }) => [s.cta, !canSend && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
                disabled={!canSend} onPress={send}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.ctaT}>{t('送信する')}</Text>}
              </Pressable>

              {/* 返信できないことを正直に。返信が要る人の逃げ道も同じ場所に置く */}
              <Text style={s.note}>
                {t('個別の返信はできませんが、必ず目を通します。')}
              </Text>
              <Pressable onPress={() => { WebBrowser.openBrowserAsync(SUPPORT_URL).catch(() => {}); }} hitSlop={6}>
                <Text style={s.link}>{t('返信が必要な場合はサポートページへ')}</Text>
              </Pressable>
              <View style={{ height: 32 }} />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** 種別の3択。設定画面と同じSegmentedControlの見た目に揃える */
function KindPicker({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  const opts: { key: Kind; label: string }[] = [
    { key: 'bug', label: t('不具合') },
    { key: 'idea', label: t('要望・アイデア') },
    { key: 'other', label: t('その他') },
  ];
  return (
    <View style={s.segTrack}>
      {opts.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} style={[s.seg, on && s.segOn]} onPress={() => onChange(o.key)}>
            <Text style={[s.segT, on && s.segTOn]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, padding: 16, paddingTop: sheetTopPad(18) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  lead: { fontSize: 13, color: C.sub, lineHeight: 19, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 8 },
  bodyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 },
  count: { fontSize: 12, color: C.sub, marginBottom: 8 },
  // 種別の3択（Selectableと同じトーン。ラベルが長いので等幅に割る）
  segTrack: {
    flexDirection: 'row', backgroundColor: C.segTrack, borderRadius: RADIUS.input, padding: 3, gap: 3,
  },
  seg: { flex: 1, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.input - 3 },
  segOn: { backgroundColor: C.panel },
  segT: { fontSize: 13, fontWeight: '700', color: C.sub },
  segTOn: { color: C.ink },
  input: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.input,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.ink, minHeight: 132, lineHeight: 21,
  },
  notice: {
    marginTop: 14, backgroundColor: C.chipBg, borderRadius: RADIUS.input, padding: 12,
    borderWidth: 1, borderColor: C.line,
  },
  noticeT: { fontSize: 12.5, color: C.ink, lineHeight: 18, fontWeight: '700' },
  noticeSub: { fontSize: 12.5, color: C.sub, lineHeight: 18, marginTop: 4 },
  err: { fontSize: 12.5, color: C.coral, marginTop: 10, lineHeight: 18 },
  cta: { marginTop: 16, borderRadius: RADIUS.input, paddingVertical: 13, alignItems: 'center', backgroundColor: C.teal },
  ctaT: { fontSize: 15, fontWeight: '800', color: '#fff' },
  note: { fontSize: 12.5, color: C.sub, lineHeight: 18, marginTop: 14, textAlign: 'center' },
  link: { fontSize: 12.5, color: C.teal, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  doneBox: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 40 },
  doneT: { fontSize: 17, fontWeight: '800', color: C.ink, textAlign: 'center', lineHeight: 26 },
});
