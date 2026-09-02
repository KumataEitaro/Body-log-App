// ガイドツアーの紙芝居カード用ミニ図解
// - 対象UIが画面に無い機能（マイ食品・法則図鑑・過食アラート等）を、
//   実UIの雰囲気を模した小さなモックで見せる（既存のAIコーチデモと同じ紙芝居流儀）
// - 色はCトークンのみ。静的な図解なのでアニメーションは持たない（reduce motionにも安全）
import { View, Text } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import {
  RotateCcw, Sparkles, TriangleAlert, Flame, ShieldCheck, Award, Medal, Trophy,
  CheckCircle2, Circle, Bell, WifiOff, Check, Plus, Heart,
} from 'lucide-react-native';
import { C, rgba, themed } from '@/lib/ui';
import { pfcColors } from '@/lib/theme';
import MoodFace from '@/components/MoodFace';
import { t } from '@/lib/i18n';
import type { GuideArtId } from '@/content/guideChapters';

export default function GuideArt({ id }: { id: GuideArtId }) {
  switch (id) {
    // ===== 章1: 入力のきほん =====
    case 'tray': return (
      <View style={a.panel}>
        <Text style={a.aiLine}>{t('おにぎりのサイズは普通と仮定しました。')}</Text>
        <View style={a.rowWrap}>
          <View style={a.chip}><Text style={a.chipT}>{t('おにぎり（鮭）×2')}</Text><Text style={a.chipK}>358kcal</Text></View>
          <View style={a.chip}><Text style={a.chipT}>{t('味噌汁')}</Text><Text style={a.chipK}>40kcal</Text></View>
        </View>
        <View style={a.saveBtn}><Check size={13} color={C.panel} strokeWidth={3} /><Text style={a.saveBtnT}>{t('保存 398kcal')}</Text></View>
      </View>
    );
    case 'myfood': return (
      <View style={a.panel}>
        <View style={a.rowWrap}>
          <View style={[a.chip, a.chipOn]}><Text style={[a.chipT, { color: C.accentInk }]}>{t('プロテイン')}</Text></View>
          <View style={a.chip}><Text style={a.chipT}>{t('ゆで卵')}</Text></View>
          <View style={a.chip}><Text style={a.chipT}>{t('オートミール')}</Text></View>
        </View>
        <Text style={a.hint}>{t('タップ＝トレイへ／長押し＝1回分を即記録')}</Text>
      </View>
    );
    case 'redo': return (
      <View style={a.panel}>
        <View style={a.listRow}>
          <View style={{ flex: 1 }}>
            <Text style={a.listT}>{t('鶏むね肉とサラダ')}</Text>
            <Text style={a.listSub}>{t('昨日 12:40・620kcal')}</Text>
          </View>
          <View style={a.roundBtn}><RotateCcw size={14} color={C.teal} strokeWidth={2.5} /></View>
        </View>
        <Text style={a.hint}>{t('AI解析なし・記録済みの栄養値をそのまま')}</Text>
      </View>
    );
    case 'menu': return (
      <View style={a.panel}>
        <View style={[a.listRow, a.pickRow]}>
          <View style={{ flex: 1 }}>
            <Text style={[a.listT, { color: C.accentInk }]}>{t('鶏の炭火焼き定食')}</Text>
            <Text style={a.listSub}>{t('約650kcal・タンパク質がしっかり取れます')}</Text>
          </View>
          <View style={a.pickPill}><Text style={a.pickPillT}>{t('おすすめ')}</Text></View>
        </View>
        <View style={a.listRow}>
          <Text style={[a.listT, { flex: 1 }]}>{t('カツ丼')}</Text>
          <Text style={a.listSub}>{t('約950kcal')}</Text>
        </View>
      </View>
    );
    case 'quick': return (
      <View style={a.panel}>
        <View style={[a.listRow, { gap: 8 }]}>
          <View style={a.inputMock}><Text style={a.inputMockT}>86.4</Text></View>
          <Text style={a.listSub}>kg</Text>
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            {([2, 3, 4] as const).map((lv) => (
              <View key={lv} style={[a.face, lv === 4 && a.faceOn]}><MoodFace level={lv} size={18} color={lv === 4 ? C.teal : C.faint} /></View>
            ))}
          </View>
        </View>
        <Text style={a.hint}>{t('体重は数字だけ・気分は顔を1タップ')}</Text>
      </View>
    );

    // ===== 章2: 食べる前に分かる =====
    case 'pfc': {
      const col = pfcColors();
      const rows = [
        ['P', col.p, 0.62, t('あと51g')],
        ['F', col.f, 0.85, t('あと9g')],
        ['C', col.c, 0.48, t('あと118g')],
      ] as const;
      return (
        <View style={a.panel}>
          {rows.map(([ab, color, k, label]) => (
            <View key={ab} style={[a.listRow, { gap: 8 }]}>
              <Text style={[a.pfcAb, { color }]}>{ab}</Text>
              <View style={a.track}>
                <View style={[a.fill, { backgroundColor: color, width: `${k * 60}%` }]} />
                <View style={[a.fillDivider, { left: `${k * 34}%` }]} />
                <View style={[a.fill, { backgroundColor: rgba(color, 0.35), width: `${k * 24}%`, left: `${k * 60}%`, position: 'absolute' }]} />
              </View>
              <Text style={a.listSub}>{label}</Text>
            </View>
          ))}
        </View>
      );
    }
    case 'alert': return (
      <View style={[a.panel, { borderColor: rgba(C.amber, 0.45) }]}>
        <View style={[a.listRow, { gap: 8 }]}>
          <TriangleAlert size={16} color={C.amber} />
          <Text style={[a.listT, { flex: 1, color: C.amber }]}>{t('今夜は過食リスクが高めです')}</Text>
        </View>
        <Text style={a.listSub}>{t('理由: 金曜日・睡眠が短め・昼が軽い')}</Text>
        <View style={[a.saveBtn, { backgroundColor: rgba(C.amber, 0.14), marginTop: 8 }]}>
          <Text style={[a.saveBtnT, { color: C.amber }]}>{t('今日は +200kcal 緩める')}</Text>
        </View>
      </View>
    );

    // ===== 章3: あなたの法則 =====
    case 'law': return (
      <View style={[a.panel, { borderColor: rgba(C.teal, 0.4) }]}>
        <View style={[a.listRow, { gap: 8 }]}>
          <Sparkles size={16} color={C.teal} />
          <Text style={[a.listT, { flex: 1 }]}>{t('「ラーメン」の翌日、体重が増えやすい')}</Text>
        </View>
        <Text style={a.listSub}>{t('平均 +0.6kg・サンプル5日')}</Text>
        <View style={a.newPill}><Text style={a.newPillT}>{t('新しい法則を発見！')}</Text></View>
      </View>
    );
    case 'heatmap': return (
      <View style={a.panel}>
        <View style={{ gap: 4 }}>
          {[0, 1, 2, 3].map((r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 4 }}>
              {[0, 1, 2, 3, 4, 5, 6].map((c) => {
                const hot = c === 4 ? 0.75 : c === 5 && r % 2 === 0 ? 0.4 : 0.12;
                return <View key={c} style={[a.cell, { backgroundColor: rgba(C.amber, hot) }]} />;
              })}
            </View>
          ))}
        </View>
        <Text style={a.hint}>{t('金曜日に崩れやすい傾向（平均+320kcal）')}</Text>
      </View>
    );
    case 'timeslot': return (
      <View style={a.panel}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 52, paddingHorizontal: 6 }}>
          {([[t('朝'), 22, C.teal], [t('昼'), 34, C.teal], [t('夕'), 28, C.teal], [t('夜'), 50, C.amber]] as const).map(([lb, h, color]) => (
            <View key={lb} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
              <View style={{ width: '100%', height: h, borderRadius: 5, backgroundColor: rgba(color, 0.75) }} />
              <Text style={a.listSub}>{lb}</Text>
            </View>
          ))}
        </View>
        <Text style={a.hint}>{t('夜にカロリーが寄っています（38%）')}</Text>
      </View>
    );
    case 'trigger': return (
      <View style={a.panel}>
        {([[t('0時以降まで起きていた'), '×4'], [t('昼食を抜いた'), '×3']] as const).map(([lb, n]) => (
          <View key={lb} style={a.listRow}>
            <Text style={[a.listT, { flex: 1 }]}>{lb}</Text>
            <View style={a.countPill}><Text style={a.countPillT}>{n}</Text></View>
          </View>
        ))}
        <Text style={a.hint}>{t('食べすぎの前に多かったこと・上位から')}</Text>
      </View>
    );
    case 'digest': return (
      <View style={a.panel}>
        {[t('今週は4日、記録できました'), t('平均収支 −180kcal（いいペース）'), t('体重は −0.3kg')].map((line) => (
          <View key={line} style={[a.listRow, { gap: 8 }]}>
            <CheckCircle2 size={14} color={C.teal} />
            <Text style={[a.listT, { flex: 1, fontWeight: '600' }]}>{line}</Text>
          </View>
        ))}
      </View>
    );

    // ===== 章4: 筋トレは全部無料 =====
    case 'rm': return (
      <View style={a.panel}>
        <View style={a.listRow}>
          <Text style={[a.listT, { flex: 1 }]}>{t('ベンチプレス')}</Text>
          <Text style={a.listSub}>{t('目標 90kg')}</Text>
        </View>
        <View style={a.track}><View style={[a.fill, { backgroundColor: C.teal, width: '83%' }]} /></View>
        <Text style={a.hint}>{t('75kg×6回 → 1RM換算 90kg で達成💪')}</Text>
      </View>
    );
    case 'volume': return (
      <View style={a.panel}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 52, paddingHorizontal: 6 }}>
          {[26, 30, 28, 40].map((h, i) => (
            <View key={i} style={{ flex: 1, borderRadius: 5, height: h, backgroundColor: i === 3 ? C.teal : rgba(C.teal, 0.35) }} />
          ))}
        </View>
        <Text style={a.hint}>{t('今週の総挙上量 4.2t・脚は先週より+12%')}</Text>
      </View>
    );
    case 'plates': return (
      <View style={a.panel}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56 }}>
          <View style={a.barbell} />
          {[44, 32, 22, 16].map((h, i) => (
            <View key={i} style={[a.plate, { height: h }]} />
          ))}
          <View style={[a.barbell, { width: 26 }]} />
        </View>
        <Text style={a.hint}>{t('97.5kg（20kgバー）→ 片側 25・10・2.5・1.25')}</Text>
      </View>
    );
    case 'offline': return (
      <View style={a.panel}>
        <View style={[a.listRow, { gap: 8 }]}>
          <WifiOff size={15} color={C.sub} />
          <Text style={[a.listT, { flex: 1 }]}>{t('圏外のため端末に保存しました')}</Text>
          <View style={a.countPill}><Text style={a.countPillT}>{t('未同期 2件')}</Text></View>
        </View>
        <Text style={a.hint}>{t('電波が戻ったら自動で送信します')}</Text>
      </View>
    );
    case 'sticker': return (
      <View style={a.panel}>
        <View style={a.sticker}>
          <Text style={a.stickerN}>100kg</Text>
          <Text style={a.stickerL}>PERSONAL BEST</Text>
          <Text style={a.stickerB}>BodyLoger</Text>
        </View>
        <Text style={a.hint}>{t('背景透過。ストーリーに長押しで貼れます')}</Text>
      </View>
    );

    // ===== 章5: つづく仕組み =====
    case 'flame': return (
      <View style={a.panel}>
        <View style={[a.listRow, { gap: 8 }]}>
          <Flame size={20} color={C.amber} />
          <Text style={[a.listT, { fontSize: 16, fontWeight: '900', flex: 1 }]}>{t('12日連続')}</Text>
          <ShieldCheck size={16} color={C.teal} />
          <Text style={[a.listSub, { color: C.accentInk, fontWeight: '700' }]}>{t('お守り ×1')}</Text>
        </View>
        <Text style={a.hint}>{t('週1回まで、抜けた日を自動でカバー')}</Text>
      </View>
    );
    case 'week': return (
      <View style={a.panel}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {[1, 1, 0, 1, 1, 2, 2].map((v, i) => (
            <View key={i} style={[a.dot, v === 1 && { backgroundColor: C.teal, borderColor: C.teal },
                                   v === 2 && { backgroundColor: C.bg }]} />
          ))}
        </View>
        <Text style={a.hint}>{t('今週 4/5日。週の約束は自分で決める')}</Text>
      </View>
    );
    case 'badges': return (
      <View style={a.panel}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
          {([[Award, C.teal], [Trophy, C.amber], [Medal, C.faint], [Heart, C.faint]] as [LucideIcon, string][]).map(([Icon, color], i) => (
            <View key={i} style={[a.badge, color === C.faint && { backgroundColor: C.chipBg }]}>
              <Icon size={18} color={color} />
            </View>
          ))}
        </View>
        <Text style={a.hint}>{t('灰色のバッジは条件が書いてある「次の楽しみ」')}</Text>
      </View>
    );
    case 'checklist': return (
      <View style={a.panel}>
        {([[t('つぶやきで食事を記録する'), true], [t('体重を記録する'), true], [t('AIコーチに相談する'), false]] as const).map(([lb, done]) => (
          <View key={lb} style={[a.listRow, { gap: 8 }]}>
            {done ? <CheckCircle2 size={14} color={C.teal} /> : <Circle size={14} color={C.faint} />}
            <Text style={[a.listT, { flex: 1 }, done && { color: C.sub }]}>{lb}</Text>
          </View>
        ))}
        <Text style={a.hint}>{t('達成は自動判定。進み具合 4/6')}</Text>
      </View>
    );
    case 'notify': return (
      <View style={a.panel}>
        <View style={[a.listRow, { gap: 8 }]}>
          <Bell size={15} color={C.teal} />
          <Text style={[a.listT, { flex: 1 }]}>{t('今日の記録、まだ間に合います')}</Text>
        </View>
        <View style={[a.rowWrap, { marginTop: 8 }]}>
          <View style={a.chip}><Text style={a.chipT}>{t('あとで（2時間後）')}</Text></View>
          <View style={a.chip}><Text style={a.chipT}>{t('今日は聞かないで')}</Text></View>
        </View>
      </View>
    );
    case 'comeback': return (
      <View style={a.panel}>
        <Text style={[a.listT, { fontSize: 15, fontWeight: '800', textAlign: 'center' }]}>{t('おかえりなさい')}</Text>
        <Text style={[a.listSub, { textAlign: 'center', marginTop: 4 }]}>{t('空白は失敗じゃなくて、休憩です。')}</Text>
        <Text style={[a.listSub, { textAlign: 'center' }]}>{t('前回までの記録はぜんぶ残っています。')}</Text>
      </View>
    );
    case 'bulk': return (
      <View style={[a.panel, { borderColor: rgba(C.amber, 0.45), alignItems: 'center' }]}>
        <Text style={a.listSub}>{t('増量ノルマ')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
          <Text style={[a.stickerN, { color: C.amber, fontSize: 24 }]}>820</Text>
          <Text style={[a.listT, { color: C.amber, fontWeight: '800' }]}>{t('kcal あと食べる')}</Text>
        </View>
        <View style={[a.rowWrap, { marginTop: 6 }]}>
          <View style={a.chip}><Plus size={11} color={C.sub} /><Text style={a.chipT}>{t('食間が5時間空いたらお知らせ')}</Text></View>
        </View>
      </View>
    );
  }
}

const a = themed(() => ({
  panel: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 14,
    padding: 12, gap: 6, marginBottom: 12,
  },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.panel,
    borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  chipOn: { borderColor: C.teal, backgroundColor: C.tealWeak },
  chipT: { fontSize: 12, fontWeight: '700', color: C.ink },
  chipK: { fontSize: 11, color: C.sub },
  aiLine: { fontSize: 12, color: C.sub, fontStyle: 'italic' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: C.teal, borderRadius: 999, paddingVertical: 8, marginTop: 4,
  },
  saveBtnT: { color: C.panel, fontSize: 13, fontWeight: '800' },
  hint: { fontSize: 11, color: C.faint, marginTop: 2 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  listT: { fontSize: 13, fontWeight: '700', color: C.ink },
  listSub: { fontSize: 11, color: C.sub },
  roundBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: C.tealWeak,
    alignItems: 'center', justifyContent: 'center',
  },
  pickRow: {
    borderWidth: 1.5, borderColor: C.teal, backgroundColor: C.accentSoft,
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7,
  },
  pickPill: { backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pickPillT: { color: C.panel, fontSize: 11, fontWeight: '800' },
  inputMock: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  inputMockT: { fontSize: 15, fontWeight: '800', color: C.ink },
  face: { opacity: 0.75 },
  faceOn: { opacity: 1 },
  pfcAb: { fontSize: 12, fontWeight: '900', width: 14 },
  track: { flex: 1, height: 7, borderRadius: 4, backgroundColor: C.track, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  fillDivider: { position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: C.panel },
  newPill: {
    alignSelf: 'flex-start', backgroundColor: C.tealWeak, borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3, marginTop: 2,
  },
  newPillT: { fontSize: 11, fontWeight: '800', color: C.accentInk },
  cell: { flex: 1, height: 12, borderRadius: 3 },
  countPill: { backgroundColor: C.chipBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  countPillT: { fontSize: 11, fontWeight: '800', color: C.sub },
  barbell: { width: 34, height: 7, backgroundColor: C.faint, borderRadius: 3 },
  plate: { width: 11, borderRadius: 3, backgroundColor: C.calorieBar, marginHorizontal: 1.5 },
  sticker: {
    alignSelf: 'center', backgroundColor: C.ink, borderRadius: 14,
    paddingHorizontal: 22, paddingVertical: 12, alignItems: 'center',
  },
  stickerN: { color: C.panel, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  stickerL: { color: C.panel, fontSize: 11, fontWeight: '800', letterSpacing: 2, opacity: 0.85 },
  stickerB: { color: C.panel, fontSize: 11, opacity: 0.5, marginTop: 3 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.chipBg },
  badge: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.tealWeak,
    alignItems: 'center', justifyContent: 'center',
  },
}));
