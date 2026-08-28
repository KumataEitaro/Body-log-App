import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    // Web側のテストだけを見る。native/ のテストはjest-expo（cd native && npm test）の管轄で、
    // vitestが拾うとRN依存のimportで全滅する（誤検出でCIが常に赤になっていた）
    include: ['tests/**/*.test.ts'],
  },
});
