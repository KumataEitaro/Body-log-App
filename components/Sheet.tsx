'use client';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion';

/**
 * iOSスタイルのボトムシート。
 * - 上部のドラッグハンドルを下に引っ張る or 背景タップで閉じる
 * - 本文はシート内スクロール（ドラッグと干渉しないようハンドル部だけがドラッグ起点）
 */
export default function Sheet({
  open, onClose, children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dragControls = useDragControls();

  function onDragEnd(_: unknown, info: PanInfo) {
    // 十分下にスワイプされたら閉じる
    if (info.offset.y > 110 || info.velocity.y > 600) onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 380 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <div className="sheet-handle-area" onPointerDown={(e) => dragControls.start(e)}>
              <div className="sheet-handle" />
            </div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
