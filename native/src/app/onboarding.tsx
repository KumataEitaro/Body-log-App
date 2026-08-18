// 初回オンボーディング: 使い方ガイド（紙芝居）のあとに開く3ステップウィザード
// ① あなたの現在地点（プロフィール＋活動量カード選択＋現在の体重）
// ② 目標（体重・期日・体脂肪率は任意）
// ③ 筋トレ目標（任意・スキップ可）
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import ActivityLevelPicker from '@/components/ActivityLevelPicker';
import { SegmentedControl, OptionButton } from '@/components/ui/Selectable';
import GoalPanel from '@/components/GoalPanel';

const DONE_KEY = 'bl-onboard-done';

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [life, setLife] = useState(1.375);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // 既存値があればプリフィル（ガイド再実行などで再訪しても壊れない）
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (p) {
        if (p.display_name) setName(p.display_name);
        if (p.sex) setSex(p.sex);
        if (p.height_cm != null) setHeight(String(p.height_cm));
        if (p.age != null) setAge(String(p.age));
        if (p.life_factor != null) setLife(Number(p.life_factor));
      }
    })();
  }, []);

  function done() {
    AsyncStorage.setItem(DONE_KEY, '1').catch(() => {});
    router.replace('/(tabs)/log' as never);
  }

  async function saveProfile() {
    if (!height.trim() || !age.trim() || !weight.trim()) {
      setMsg('身長・年齢・現在の体重を入力してください。'); return;
    }
    setBusy(true); setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { error } = await supabase.from('profiles').upsert({
        id: uid, display_name: name.trim() || 'あなた', sex,
        height_cm: Number(height) || 170, age: Number(age) || 30,
        life_factor: life, init_weight: Number(weight) || null,
      });
      if (error) { setMsg('保存に失敗しました。もう一度お試しください。'); return; }
      await supabase.from('entries').upsert(
        { user_id: uid, date: todayJST(), weight: Number(weight) }, { onConflict: 'user_id,date' });
      setStep(1);
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingTop: insets.top + 14, paddingHorizontal: 20 }}>
        {/* 進捗ドット＋スキップ */}
        <View style={s.topRow}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[0, 1, 2].map((i) => <View key={i} style={[s.dot, step === i && s.dotOn]} />)}
          </View>
          <Pressable onPress={done} hitSlop={10}><Text style={s.skipT}>あとで設定</Text></Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
          {step === 0 && (
            <>
              <Text style={s.h1}>あなたの現在地点</Text>
              <Text style={s.sub}>基礎代謝と消費カロリーの計算に使います。あとで⚙からいつでも変更できます。</Text>
              <Text style={s.label}>ニックネーム（任意）</Text>
              <TextInput style={s.input} placeholder="例: くまさん" placeholderTextColor={C.faint} value={name} onChangeText={setName} />
              <Text style={s.label}>性別</Text>
              <SegmentedControl
                options={[{ key: 'male', label: '男性' }, { key: 'female', label: '女性' }]}
                value={sex} onChange={setSex}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>身長（cm）</Text>
                  <TextInput style={s.input} keyboardType="number-pad" placeholder="170" placeholderTextColor={C.faint} value={height} onChangeText={setHeight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>年齢</Text>
                  <TextInput style={s.input} keyboardType="number-pad" placeholder="30" placeholderTextColor={C.faint} value={age} onChangeText={setAge} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>今の体重（kg）</Text>
                  <TextInput style={s.input} keyboardType="decimal-pad" placeholder="70.0" placeholderTextColor={C.faint} value={weight} onChangeText={setWeight} />
                </View>
              </View>
              <Text style={s.label}>日常の活動量</Text>
              <ActivityLevelPicker value={life} onChange={setLife} />
              {msg ? <Text style={s.err}>{msg}</Text> : null}
              <OptionButton style={{ marginTop: 18 }} label="次へ — 目標を決める" onPress={saveProfile} busy={busy} />
            </>
          )}

          {step === 1 && (
            <>
              <Text style={s.h1}>目標を決める</Text>
              <Text style={s.sub}>目標から逆算して、毎日の「あと食べられる量」を自動計算します。「目標を保存する」を押してから次へ進んでください。</Text>
              <GoalPanel mode="weight" weightSections="goal" />
              <OptionButton style={{ marginTop: 18 }} label="次へ — 筋トレ目標（任意）" onPress={() => setStep(2)} />
              <Pressable onPress={() => setStep(2)} hitSlop={8} style={{ alignSelf: 'center', marginTop: 10 }}>
                <Text style={s.linkT}>目標はあとで決める</Text>
              </Pressable>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.h1}>筋トレの目標（任意）</Text>
              <Text style={s.sub}>ベンチプレス100kgのような目標を置くと、トレのグラフに目標線が出ます。筋トレをしない人はスキップでOKです。</Text>
              <GoalPanel mode="training" />
              <OptionButton style={{ marginTop: 18 }} label="はじめる 🎉" onPress={done} />
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.line },
  dotOn: { backgroundColor: C.teal, width: 22 },
  skipT: { fontSize: 12.5, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  h1: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 6 },
  sub: { fontSize: 12.5, color: C.sub, lineHeight: 19, marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 16, color: C.ink },
  seg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  segOn: { backgroundColor: C.ink, borderColor: C.ink },
  segT: { fontSize: 13, fontWeight: '800', color: C.sub },
  err: { color: C.coral, fontSize: 13, marginTop: 10 },
  primaryBtn: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  primaryBtnT: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  linkT: { fontSize: 12.5, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
});
