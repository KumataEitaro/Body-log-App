// テストで PNG を読む pngjs の最小の型（@types/pngjs を入れずに済ませる）。実装は __tests__/brandAssets.test.ts だけが使う
declare module 'pngjs' {
  export class PNG {
    width: number;
    height: number;
    data: Buffer;
    static sync: { read(buf: Buffer): PNG };
  }
}
