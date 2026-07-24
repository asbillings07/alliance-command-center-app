"use client";

type NumbersExportGuideProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function NumbersExportGuide({ isOpen, onClose }: NumbersExportGuideProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-start justify-between border-b border-border pb-3">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold text-lg">
              
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-base">
                Apple Numbers Export Required
              </h3>
              <p className="text-xs text-muted-foreground">
                Convert your .numbers document to Excel or CSV
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none p-1 rounded-md"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground">
            Apple Numbers files (.numbers) cannot be parsed directly. Please export your spreadsheet using Apple Numbers:
          </p>
          <ol className="list-decimal list-inside space-y-2 pl-1 bg-muted/40 p-3 rounded-lg border border-border/50 font-mono text-[11px] text-foreground">
            <li>Open your spreadsheet in <strong>Apple Numbers</strong>.</li>
            <li>
              Click <strong>File &gt; Export To &gt; Excel...</strong> (or CSV...).
            </li>
            <li>Select <strong>.xlsx</strong> as the file format.</li>
            <li>Save the exported file to your computer.</li>
            <li>Upload the newly saved <strong>.xlsx</strong> or <strong>.csv</strong> file.</li>
          </ol>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-xs font-semibold hover:bg-accent/90 transition-colors"
          >
            Got it, I&apos;ll export
          </button>
        </div>
      </div>
    </div>
  );
}
