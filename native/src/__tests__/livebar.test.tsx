// ライブプレビューバーが実際に描画できること（Animatedの誤用は型では防げないため）
import renderer, { act } from 'react-test-renderer';
import { Animated } from 'react-native';
import { LiveBar, GhostPair } from '@/components/LivePreviewBar';

const pulse = new Animated.Value(0.5);

function mount(el: React.ReactElement) {
  let tree: renderer.ReactTestRenderer | null = null;
  act(() => { tree = renderer.create(el); });
  act(() => { tree?.unmount(); });
}

describe('ライブプレビューバーの描画', () => {
  it('未保存分あり・なしの両方で落ちない', () => {
    expect(() => mount(<LiveBar eaten={40} staged={20} target={100} color="#059669" pulse={pulse} />)).not.toThrow();
    expect(() => mount(<LiveBar eaten={40} staged={0} target={100} color="#059669" pulse={pulse} />)).not.toThrow();
  });

  it('目標超過でも落ちない', () => {
    expect(() => mount(<LiveBar eaten={120} staged={40} target={100} color="#059669" pulse={pulse} />)).not.toThrow();
  });

  it('目標0でも落ちない（プロフィール未設定の初回など）', () => {
    expect(() => mount(<LiveBar eaten={0} staged={0} target={0} color="#059669" pulse={pulse} />)).not.toThrow();
  });

  it('注目中の1品ありでも落ちない', () => {
    expect(() => mount(<GhostPair eaten={30} others={20} focus={15} target={100} color="#2563eb" pulse={pulse} />)).not.toThrow();
  });

  it('注目なし（focus=0）でも落ちない', () => {
    expect(() => mount(<GhostPair eaten={30} others={20} focus={0} target={100} color="#2563eb" pulse={pulse} />)).not.toThrow();
  });
});
