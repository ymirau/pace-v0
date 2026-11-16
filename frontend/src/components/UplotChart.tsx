import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface UplotChartProps {
  /** [xs, ...series] — see uPlot's AlignedData. x values are unix *seconds*. */
  data: uPlot.AlignedData;
  /** uPlot options minus width/height (this component owns sizing). Memoize it in
   *  the parent so the chart isn't torn down and rebuilt on every render.
   *  uPlot renders to a canvas and can't read the CSS theme tokens, so pass
   *  concrete per-theme color strings for axes/grid/series. For dark mode, key
   *  those colors on the current theme and include the theme in the parent's
   *  useMemo dependency array — the chart then rebuilds with the right colors
   *  when the theme is toggled (see samples/DashboardTab's CHART_COLORS). */
  options: Omit<uPlot.Options, "width" | "height">;
  height?: number;
}

/**
 * Thin React wrapper around uPlot (no third-party wrapper lib). Creates the chart
 * imperatively, destroys it on data/option change and unmount, and tracks the
 * container width with a ResizeObserver. Drop it on any page that has aligned data.
 */
export default function UplotChart({ data, options, height = 260 }: UplotChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);

  // (Re)create the chart whenever the data or options change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const width = el.clientWidth || 600;
    const chart = new uPlot({ ...options, width, height }, data, el);
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, [data, options, height]);

  // Keep the chart width in sync with its container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (chartRef.current && el.clientWidth > 0) {
        chartRef.current.setSize({ width: el.clientWidth, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // minHeight (not a fixed height): uPlot renders its legend table *below* the
  // canvas, so the container must be free to grow past the canvas height to
  // enclose it — a fixed height would clip the legend under the card border.
  return <div ref={containerRef} className="w-full" style={{ minHeight: height }} />;
}
