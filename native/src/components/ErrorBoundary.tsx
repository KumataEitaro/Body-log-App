// 描画中の例外でアプリ全体が落ちるのを止める。
//
// React では描画中に例外が出るとそのツリーがアンマウントされる。境界が無いと
// ルートまで巻き戻り、リリースビルドでは「アプリが突然閉じる」形になる。
// カード1枚のデータが想定外だっただけで全部落ちるのは割に合わないので、
// 画面単位とカード単位の2段で受け止める。
//
// 表示はするが、握りつぶしはしない。原因を追えるように直前の例外を保持して
// 画面から見られるようにしている（クラッシュ計測を入れていないため）。
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';

type Props = {
  children: ReactNode;
  /** 落ちた場所の名前（「概要タブ」「筋トレの成長」など） */
  name?: string;
  /** カード単位の小さめ表示にする（画面全体を占有しない） */
  compact?: boolean;
};
type State = { error: Error | null; info: string };

// 直近の例外を覚えておく（設定画面から見せて、報告してもらえるようにする）
let lastError: { at: string; name: string; message: string; stack: string } | null = null;
export function getLastError() { return lastError; }
export function clearLastError() { lastError = null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const stack = (info.componentStack ?? '').split('\n').slice(0, 12).join('\n');
    this.setState({ info: stack });
    lastError = {
      at: new Date().toISOString(),
      name: this.props.name ?? 'unknown',
      message: `${error.name}: ${error.message}`,
      stack,
    };
    // 開発中は普段どおりコンソールにも出す
    console.error(`[ErrorBoundary:${this.props.name ?? 'unknown'}]`, error, stack);
  }

  retry = () => this.setState({ error: null, info: '' });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.compact) {
      return (
        <View style={s.compact}>
          <Text style={s.compactT} numberOfLines={2}>
            {t('{name}の表示でエラーが起きました。', { name: this.props.name ?? t('この部分') })}
          </Text>
          <Pressable onPress={this.retry} hitSlop={8}>
            <Text style={s.retryT}>{t('再読み込み')}</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={s.wrap}>
        <Text style={s.title}>{t('画面の表示に失敗しました')}</Text>
        <Text style={s.body}>
          {t('記録は保存されています。下のボタンでやり直せます。何度も出る場合はこの内容をお知らせください。')}
        </Text>
        <ScrollView style={s.box} contentContainerStyle={{ padding: 10 }}>
          <Text style={s.code}>{error.name}: {error.message}</Text>
          {this.state.info ? <Text style={s.codeDim}>{this.state.info}</Text> : null}
        </ScrollView>
        <Pressable style={s.btn} onPress={this.retry}>
          <Text style={s.btnT}>{t('再読み込み')}</Text>
        </Pressable>
      </View>
    );
  }
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, padding: 20, justifyContent: 'center', gap: 12 },
  title: { fontSize: 21, fontWeight: '800', color: C.ink },
  body: { fontSize: 15, color: C.sub, lineHeight: 21 },
  box: {
    maxHeight: 220, backgroundColor: C.panel, borderRadius: 12,
    borderWidth: 1, borderColor: C.line,
  },
  code: { fontSize: 13, color: C.coral, fontWeight: '700' },
  codeDim: { fontSize: 11, color: C.faint, marginTop: 6, lineHeight: 15 },
  btn: { backgroundColor: C.teal, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  btnT: { color: '#fff', fontSize: 17, fontWeight: '800' },
  compact: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14,
    padding: 14, marginBottom: 12,
  },
  compactT: { flex: 1, fontSize: 13, color: C.sub, fontWeight: '600' },
  retryT: { fontSize: 13, color: C.teal, fontWeight: '800', textDecorationLine: 'underline' },
});
