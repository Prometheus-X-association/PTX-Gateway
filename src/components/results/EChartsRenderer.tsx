import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

interface EChartsRendererProps {
  option: Record<string, unknown>;
  height?: number;
  className?: string;
}

declare global {
  interface Window {
    echarts?: {
      init: (el: HTMLElement, theme?: string, opts?: Record<string, unknown>) => EChartsInstance;
      getInstanceByDom: (el: HTMLElement) => EChartsInstance | null;
    };
  }
}

interface EChartsInstance {
  setOption: (option: unknown, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

const ECHARTS_CDN = "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js";

const loadECharts = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (window.echarts) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${ECHARTS_CDN}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = ECHARTS_CDN;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load ECharts"));
    document.head.appendChild(script);
  });

const EChartsRenderer = ({ option, height = 360, className }: EChartsRendererProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        await loadECharts();
        if (cancelled || !containerRef.current || !window.echarts) return;
        setLoading(false);

        // Reuse existing instance or create new
        const existing = window.echarts.getInstanceByDom(containerRef.current);
        const chart = existing ?? window.echarts.init(containerRef.current, undefined, { renderer: "canvas" });
        chartRef.current = chart;
        chart.setOption(option, true);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    void init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update option when it changes without reinitializing
  useEffect(() => {
    if (chartRef.current && !loading) {
      try {
        chartRef.current.setOption(option, true);
      } catch { /* ignore */ }
    }
  }, [option, loading]);

  // Handle resize
  useEffect(() => {
    const observer = new ResizeObserver(() => chartRef.current?.resize());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  if (error) {
    return (
      <div className={`flex items-center justify-center text-sm text-destructive ${className}`} style={{ height }}>
        ECharts error: {error}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} style={{ height }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height: "100%", opacity: loading ? 0 : 1 }} />
    </div>
  );
};

export default EChartsRenderer;
