import { useEffect, useMemo, useRef, useState } from "react";

export type ChartType =
  | "bar"
  | "line"
  | "area"
  | "scatter"
  | "pie"
  | "radial"
  | "treemap"
  | "network"
  | "map";

export interface LlmVisualizationSpec {
  type?: ChartType;
  title?: string;
  xKey?: string;
  yKey?: string;
  categoryKey?: string;
  valueKey?: string;
  latKey?: string;
  lngKey?: string;
  sourceKey?: string;
  targetKey?: string;
  data?: Array<Record<string, unknown>>;
  nodes?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  hierarchy?: Record<string, unknown>;
}

interface D3InsightChartProps {
  spec: LlmVisualizationSpec | null;
}

interface SelectedDetail {
  title: string;
  payload: Record<string, unknown>;
}

const D3_SCRIPT_ID = "ptx-d3-cdn-script";
const D3_SCRIPT_SRC = "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js";

const CHART_OPTIONS: Array<{ value: ChartType; label: string }> = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "scatter", label: "Dots" },
  { value: "pie", label: "Pie" },
  { value: "radial", label: "Radial" },
  { value: "treemap", label: "Hierarchy" },
  { value: "network", label: "Network" },
  { value: "map", label: "Map" },
];

const loadD3 = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false;
  if (window.d3) return true;

  const existing = document.getElementById(D3_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(!!window.d3), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = D3_SCRIPT_ID;
    script.src = D3_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(!!window.d3);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
  }
  return NaN;
};

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = toNumber(value);
  return Number.isFinite(n) ? n : fallback;
};

const pickFirstExistingKey = (row: Record<string, unknown> | undefined, candidates: string[]): string | null => {
  if (!row) return null;
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null) return key;
  }
  return null;
};

const inferLatLngKeys = (data: Array<Record<string, unknown>>, spec: LlmVisualizationSpec): { latKey: string; lngKey: string } | null => {
  const first = data[0];
  if (!first) return null;
  const latKey = spec.latKey || pickFirstExistingKey(first, ["lat", "latitude", "y"]);
  const lngKey = spec.lngKey || pickFirstExistingKey(first, ["lng", "lon", "long", "longitude", "x"]);
  if (!latKey || !lngKey) return null;
  return { latKey, lngKey };
};

const inferLinkKeys = (data: Array<Record<string, unknown>>, spec: LlmVisualizationSpec): { sourceKey: string; targetKey: string } | null => {
  const first = data[0];
  if (!first) return null;
  const sourceKey = spec.sourceKey || pickFirstExistingKey(first, ["source", "from", "parent", "src"]);
  const targetKey = spec.targetKey || pickFirstExistingKey(first, ["target", "to", "child", "dst"]);
  if (!sourceKey || !targetKey) return null;
  return { sourceKey, targetKey };
};

const inferHierarchyFromData = (data: Array<Record<string, unknown>>, spec: LlmVisualizationSpec): Record<string, unknown> => {
  const categoryKey = spec.categoryKey || spec.xKey || "category";
  const valueKey = spec.valueKey || spec.yKey || "value";
  return {
    name: "root",
    children: data.map((item, idx) => ({
      name: String(item[categoryKey] ?? `Item ${idx + 1}`),
      value: Math.max(0, toFiniteNumber(item[valueKey], 1)),
    })),
  };
};

const getCompatibleTypes = (spec: LlmVisualizationSpec | null): ChartType[] => {
  if (!spec) return [];
  const data = Array.isArray(spec.data) ? spec.data : [];
  const types = new Set<ChartType>();

  if (data.length > 0) {
    types.add("bar");
    types.add("line");
    types.add("area");
    types.add("scatter");
    types.add("pie");
    types.add("radial");

    if (inferLatLngKeys(data, spec)) {
      types.add("map");
    }

    if (inferLinkKeys(data, spec)) {
      types.add("network");
    }

    types.add("treemap");
  }

  if (Array.isArray(spec.nodes) && Array.isArray(spec.links) && spec.nodes.length > 0 && spec.links.length > 0) {
    types.add("network");
  }

  if (spec.hierarchy && typeof spec.hierarchy === "object") {
    types.add("treemap");
  }

  return CHART_OPTIONS.map((o) => o.value).filter((t) => types.has(t));
};

const toDetailPayload = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: value as unknown };
  }
  const src = value as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  Object.entries(src).forEach(([k, v]) => {
    if (k === "x" || k === "y" || k === "vx" || k === "vy" || k === "fx" || k === "fy" || k === "index") return;
    if (typeof v === "function") return;
    cleaned[k] = v;
  });
  return cleaned;
};

const D3InsightChart = ({ spec }: D3InsightChartProps) => {
  const [isD3Ready, setIsD3Ready] = useState(false);
  const [d3Error, setD3Error] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ChartType>("bar");
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail | null>(null);
  const zoomApiRef = useRef<{ svg: any; zoom: any } | null>(null);

  useEffect(() => {
    let active = true;
    void loadD3().then((ok) => {
      if (!active) return;
      setIsD3Ready(ok);
      if (!ok) setD3Error("D3.js failed to load from CDN.");
    });
    return () => {
      active = false;
    };
  }, []);

  const svgId = useMemo(() => `ptx-d3-chart-${Math.random().toString(36).slice(2, 9)}`, []);
  const compatibleTypes = useMemo(() => getCompatibleTypes(spec), [spec]);
  const effectiveType = compatibleTypes.includes(selectedType)
    ? selectedType
    : compatibleTypes[0] || (spec?.type as ChartType) || "bar";

  useEffect(() => {
    if (!spec) return;
    const requested = (spec.type || "bar") as ChartType;
    if (compatibleTypes.includes(requested)) {
      setSelectedType(requested);
      return;
    }
    if (compatibleTypes.length > 0) {
      setSelectedType(compatibleTypes[0]);
    }
  }, [compatibleTypes, spec]);

  useEffect(() => {
    setSelectedDetail(null);
  }, [effectiveType, spec]);

  const openDetailDialog = (title: string, payload: unknown) => {
    setSelectedDetail({
      title,
      payload: toDetailPayload(payload),
    });
  };

  const handleZoomIn = () => {
    if (!zoomApiRef.current) return;
    const { svg, zoom } = zoomApiRef.current;
    svg.transition().duration(180).call(zoom.scaleBy, 1.2);
  };

  const handleZoomOut = () => {
    if (!zoomApiRef.current) return;
    const { svg, zoom } = zoomApiRef.current;
    svg.transition().duration(180).call(zoom.scaleBy, 1 / 1.2);
  };

  const handleZoomReset = () => {
    if (!zoomApiRef.current || !window.d3) return;
    const d3 = window.d3 as any;
    const { svg, zoom } = zoomApiRef.current;
    svg.transition().duration(220).call(zoom.transform, d3.zoomIdentity);
  };

  useEffect(() => {
    if (!isD3Ready || !spec || !window.d3) return;
    const data = Array.isArray(spec.data) ? spec.data : [];
    if (data.length === 0 && !(spec.nodes && spec.links) && !spec.hierarchy) return;

    const d3 = window.d3 as any;
    const svg = d3.select(`#${svgId}`);
    svg.selectAll("*").remove();

    const width = 960;
    const height = 460;
    const xKey = spec.xKey || spec.categoryKey || "x";
    const yKey = spec.yKey || spec.valueKey || "y";
    const categoryKey = spec.categoryKey || xKey;
    const valueKey = spec.valueKey || yKey;

    const xLabels = data.map((d) => String(d[xKey] ?? ""));
    const shouldRotateTicks = xLabels.length > 8 || xLabels.some((v) => v.length > 12);
    const margin = { top: 24, right: 24, bottom: shouldRotateTicks ? 96 : 60, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr("viewBox", `0 0 ${width} ${height}`).style("cursor", "grab");
    const zoomLayer = svg.append("g").attr("class", "zoom-layer");
    const root = zoomLayer
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const zoomBehavior = d3
      .zoom()
      .scaleExtent([0.5, 6])
      .on("start", () => svg.style("cursor", "grabbing"))
      .on("end", () => svg.style("cursor", "grab"))
      .on("zoom", (event: any) => {
        zoomLayer.attr("transform", event.transform);
      });

    svg.call(zoomBehavior);
    svg.on("dblclick.zoom", null);
    zoomApiRef.current = { svg, zoom: zoomBehavior };

    const color = d3.scaleOrdinal(d3.schemeTableau10);

    if (effectiveType === "pie") {
      const values = data.map((d) => ({
        label: String(d[categoryKey] ?? ""),
        value: Math.max(0, toFiniteNumber(d[valueKey], 0)),
      })).filter((d) => d.label || d.value > 0);

      const radius = Math.min(innerWidth, innerHeight) / 2;
      const pie = d3.pie().value((d: { value: number }) => d.value);
      const arc = d3.arc().innerRadius(0).outerRadius(radius - 8);
      const group = root.append("g").attr("transform", `translate(${innerWidth / 2},${innerHeight / 2})`);

      group
        .selectAll("path")
        .data(pie(values))
        .enter()
        .append("path")
        .attr("d", arc)
        .attr("fill", (_: unknown, i: number) => color(i))
        .attr("stroke", "#111")
        .attr("stroke-width", 1)
        .on("mouseover", function () { d3.select(this).attr("opacity", 0.82); })
        .on("mouseout", function () { d3.select(this).attr("opacity", 1); })
        .on("click", (_event: unknown, d: { data: { label: string; value: number } }) => {
          openDetailDialog(`Pie Slice: ${d.data.label || "Item"}`, d.data);
        })
        .append("title")
        .text((d: { data: { label: string; value: number } }) => `${d.data.label}: ${d.data.value}`);

      group
        .selectAll("text")
        .data(pie(values))
        .enter()
        .append("text")
        .attr("transform", (d: any) => `translate(${arc.centroid(d)})`)
        .style("text-anchor", "middle")
        .style("font-size", "11px")
        .text((d: any) => (d.endAngle - d.startAngle > 0.28 ? d.data.label : ""));
      return;
    }

    if (effectiveType === "radial") {
      const values = data.map((d, idx) => ({
        label: String(d[categoryKey] ?? `Item ${idx + 1}`),
        value: Math.max(0, toFiniteNumber(d[valueKey], 0)),
      }));
      const maxValue = d3.max(values, (d: { value: number }) => d.value) || 1;
      const radius = Math.min(innerWidth, innerHeight) / 2 - 10;
      const angle = d3.scaleBand().domain(values.map((d: { label: string }) => d.label)).range([0, Math.PI * 2]).align(0);
      const r = d3.scaleLinear().domain([0, maxValue]).range([20, radius]);
      const group = root.append("g").attr("transform", `translate(${innerWidth / 2},${innerHeight / 2})`);

      group
        .append("g")
        .selectAll("path")
        .data(values)
        .enter()
        .append("path")
        .attr("fill", (_: unknown, i: number) => color(i))
        .attr("d", (d: { label: string; value: number }) =>
          d3
            .arc()
            .innerRadius(20)
            .outerRadius(r(d.value))
            .startAngle(angle(d.label)!)
            .endAngle(angle(d.label)! + angle.bandwidth())
            .padAngle(0.01)
            .padRadius(20)()
        )
        .on("click", (_event: unknown, d: { label: string; value: number }) => {
          openDetailDialog(`Radial Segment: ${d.label || "Item"}`, d);
        })
        .append("title")
        .text((d: { label: string; value: number }) => `${d.label}: ${d.value}`);

      group
        .append("g")
        .selectAll("g")
        .data(values)
        .enter()
        .append("g")
        .attr("text-anchor", (d: { label: string }) => ((angle(d.label)! + angle.bandwidth() / 2 + Math.PI) % (Math.PI * 2) < Math.PI ? "end" : "start"))
        .attr("transform", (d: { label: string }) => {
          const a = angle(d.label)! + angle.bandwidth() / 2 - Math.PI / 2;
          const tx = Math.cos(a) * (radius + 8);
          const ty = Math.sin(a) * (radius + 8);
          const rotate = (a * 180) / Math.PI;
          return `translate(${tx},${ty}) rotate(${rotate})`;
        })
        .append("text")
        .attr("transform", (d: { label: string }) => ((angle(d.label)! + angle.bandwidth() / 2 + Math.PI) % (Math.PI * 2) < Math.PI ? "rotate(180)" : ""))
        .style("font-size", "10px")
        .text((d: { label: string }) => d.label.slice(0, 14));
      return;
    }

    if (effectiveType === "treemap") {
      const hierarchyRaw = spec.hierarchy && typeof spec.hierarchy === "object"
        ? spec.hierarchy
        : inferHierarchyFromData(data, spec);
      const hierarchy = d3
        .hierarchy(hierarchyRaw)
        .sum((d: Record<string, unknown>) => Math.max(0, toFiniteNumber(d.value, toFiniteNumber(d.val, 1))));

      d3.treemap().size([innerWidth, innerHeight]).padding(2)(hierarchy);
      const leaf = root
        .selectAll("g")
        .data(hierarchy.leaves())
        .enter()
        .append("g")
        .attr("transform", (d: any) => `translate(${d.x0},${d.y0})`);

      leaf
        .append("rect")
        .attr("width", (d: any) => Math.max(0, d.x1 - d.x0))
        .attr("height", (d: any) => Math.max(0, d.y1 - d.y0))
        .attr("fill", (_: unknown, i: number) => color(i));
      leaf.on("click", (_event: unknown, d: any) => {
        openDetailDialog(`Hierarchy Node: ${String(d.data?.name || "Item")}`, {
          ...d.data,
          value: d.value,
        });
      });

      leaf
        .append("text")
        .attr("x", 6)
        .attr("y", 16)
        .style("font-size", "11px")
        .style("fill", "white")
        .text((d: any) => String(d.data.name || "item").slice(0, 24));

      leaf
        .append("title")
        .text((d: any) => `${String(d.data.name || "item")}: ${toFiniteNumber(d.value, 0)}`);
      return;
    }

    if (effectiveType === "network") {
      const inferredLinkKeys = inferLinkKeys(data, spec);
      const links = Array.isArray(spec.links) && spec.links.length > 0
        ? spec.links.map((l) => ({
            source: String(l.source ?? l.from ?? l.parent ?? ""),
            target: String(l.target ?? l.to ?? l.child ?? ""),
            value: Math.max(1, toFiniteNumber(l.value, 1)),
          }))
        : (inferredLinkKeys
          ? data
              .map((row) => ({
                source: String(row[inferredLinkKeys.sourceKey] ?? ""),
                target: String(row[inferredLinkKeys.targetKey] ?? ""),
                value: Math.max(1, toFiniteNumber(row[valueKey], 1)),
              }))
              .filter((l) => l.source && l.target)
          : []);

      const nodeMap = new Map<string, { id: string; group: number; raw: Record<string, unknown> }>();
      if (Array.isArray(spec.nodes) && spec.nodes.length > 0) {
        spec.nodes.forEach((n, idx) => {
          const id = String(n.id ?? n.name ?? n.label ?? `Node-${idx + 1}`);
          nodeMap.set(id, { id, group: Number(n.group ?? idx % 10), raw: n });
        });
      }
      links.forEach((l, idx) => {
        if (!nodeMap.has(l.source)) nodeMap.set(l.source, { id: l.source, group: idx % 10, raw: { id: l.source } });
        if (!nodeMap.has(l.target)) nodeMap.set(l.target, { id: l.target, group: (idx + 3) % 10, raw: { id: l.target } });
      });
      const nodes = Array.from(nodeMap.values());

      const simulation = d3
        .forceSimulation(nodes)
        .force("link", d3.forceLink(links).id((d: { id: string }) => d.id).distance(90))
        .force("charge", d3.forceManyBody().strength(-230))
        .force("center", d3.forceCenter(innerWidth / 2, innerHeight / 2));

      const link = root
        .append("g")
        .attr("stroke", "#94a3b8")
        .attr("stroke-opacity", 0.55)
        .selectAll("line")
        .data(links)
        .enter()
        .append("line")
        .attr("stroke-width", (d: { value: number }) => Math.min(5, Math.max(1, d.value / 2)))
        .on("click", (_event: unknown, d: { source: { id: string }; target: { id: string }; value: number }) => {
          openDetailDialog(`Network Link: ${d.source.id} -> ${d.target.id}`, {
            source: d.source.id,
            target: d.target.id,
            weight: d.value,
          });
        });

      const node = root
        .append("g")
        .selectAll("circle")
        .data(nodes)
        .enter()
        .append("circle")
        .attr("r", 7)
        .attr("fill", (d: { group: number }) => color(d.group))
        .on("click", (_event: unknown, d: { id: string; raw: Record<string, unknown> }) => {
          openDetailDialog(`Network Node: ${d.id}`, d.raw);
        })
        .call(
          d3
            .drag()
            .on("start", (event: any, d: any) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x;
              d.fy = d.y;
            })
            .on("drag", (event: any, d: any) => {
              d.fx = event.x;
              d.fy = event.y;
            })
            .on("end", (event: any, d: any) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null;
              d.fy = null;
            })
        );

      node.append("title").text((d: { id: string }) => d.id);

      const labels = root
        .append("g")
        .selectAll("text")
        .data(nodes)
        .enter()
        .append("text")
        .text((d: { id: string }) => d.id)
        .style("font-size", "10px")
        .attr("dx", 10)
        .attr("dy", 4);

      simulation.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);

        node
          .attr("cx", (d: any) => d.x)
          .attr("cy", (d: any) => d.y);

        labels
          .attr("x", (d: any) => d.x)
          .attr("y", (d: any) => d.y);
      });
      return () => simulation.stop();
    }

    if (effectiveType === "map") {
      const latLng = inferLatLngKeys(data, spec);
      if (!latLng) return;
      const points = data
        .map((row, idx) => ({
          label: String(row[categoryKey] ?? `Point ${idx + 1}`),
          value: Math.max(1, toFiniteNumber(row[valueKey], 1)),
          lat: toNumber(row[latLng.latKey]),
          lng: toNumber(row[latLng.lngKey]),
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (points.length === 0) return;

      const geoPoints = {
        type: "FeatureCollection",
        features: points.map((p) => ({
          type: "Feature",
          properties: { label: p.label, value: p.value },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        })),
      };

      const projection = d3.geoMercator().fitSize([innerWidth, innerHeight], geoPoints as any);
      const geoPath = d3.geoPath(projection);

      root
        .append("rect")
        .attr("width", innerWidth)
        .attr("height", innerHeight)
        .attr("fill", "#0f172a")
        .attr("opacity", 0.08)
        .attr("rx", 8);

      root
        .append("path")
        .datum(d3.geoGraticule10())
        .attr("d", geoPath)
        .attr("fill", "none")
        .attr("stroke", "#94a3b8")
        .attr("stroke-opacity", 0.3);

      root
        .selectAll("circle")
        .data(points)
        .enter()
        .append("circle")
        .attr("cx", (d: { lng: number; lat: number }) => projection([d.lng, d.lat])[0])
        .attr("cy", (d: { lng: number; lat: number }) => projection([d.lng, d.lat])[1])
        .attr("r", (d: { value: number }) => Math.min(14, 3 + Math.sqrt(d.value)))
        .attr("fill", "#0ea5e9")
        .attr("fill-opacity", 0.8)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1)
        .on("click", (_event: unknown, d: { label: string; value: number; lat: number; lng: number }) => {
          openDetailDialog(`Map Point: ${d.label}`, d);
        })
        .append("title")
        .text((d: { label: string; value: number }) => `${d.label}: ${d.value}`);
      return;
    }

    const numericX = data.every((row) => Number.isFinite(toNumber(row[xKey])));
    const yMax = d3.max(data, (row: Record<string, unknown>) => Math.max(0, toFiniteNumber(row[yKey], 0))) || 1;

    if (effectiveType === "scatter") {
      const xScale = numericX
        ? d3
            .scaleLinear()
            .domain(d3.extent(data, (d: Record<string, unknown>) => toFiniteNumber(d[xKey], 0)) as [number, number])
            .nice()
            .range([0, innerWidth])
        : d3
            .scalePoint()
            .domain(data.map((d) => String(d[xKey] ?? "")))
            .range([0, innerWidth])
            .padding(0.5);

      const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

      root
        .selectAll("circle")
        .data(data)
        .enter()
        .append("circle")
        .attr("cx", (d: Record<string, unknown>) => (numericX ? xScale(toFiniteNumber(d[xKey], 0)) : xScale(String(d[xKey] ?? ""))))
        .attr("cy", (d: Record<string, unknown>) => yScale(toFiniteNumber(d[yKey], 0)))
        .attr("r", 5)
        .attr("fill", "#6366f1")
        .attr("fill-opacity", 0.9)
        .on("click", (_event: unknown, d: Record<string, unknown>) => {
          openDetailDialog(`Point: ${String(d[xKey] ?? "") || "Data Point"}`, d);
        })
        .append("title")
        .text((d: Record<string, unknown>) => `${String(d[xKey] ?? "")}: ${toFiniteNumber(d[yKey], 0)}`);

      const xAxis = root.append("g").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(xScale));
      if (!numericX && shouldRotateTicks) {
        xAxis.selectAll("text").style("text-anchor", "end").attr("dx", "-0.6em").attr("dy", "0.2em").attr("transform", "rotate(-35)");
      }
      root.append("g").call(d3.axisLeft(yScale));
      return;
    }

    if (effectiveType === "line" || effectiveType === "area") {
      if (numericX) {
        const xScale = d3
          .scaleLinear()
          .domain(d3.extent(data, (d: Record<string, unknown>) => toFiniteNumber(d[xKey], 0)) as [number, number])
          .nice()
          .range([0, innerWidth]);
        const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

        if (effectiveType === "area") {
          const area = d3
            .area()
            .x((d: Record<string, unknown>) => xScale(toFiniteNumber(d[xKey], 0)))
            .y0(innerHeight)
            .y1((d: Record<string, unknown>) => yScale(toFiniteNumber(d[yKey], 0)));

          root.append("path").datum(data).attr("fill", "#22c55e").attr("fill-opacity", 0.25).attr("stroke", "#16a34a").attr("stroke-width", 2).attr("d", area);
        } else {
          const line = d3
            .line()
            .x((d: Record<string, unknown>) => xScale(toFiniteNumber(d[xKey], 0)))
            .y((d: Record<string, unknown>) => yScale(toFiniteNumber(d[yKey], 0)));
          root.append("path").datum(data).attr("fill", "none").attr("stroke", "#3b82f6").attr("stroke-width", 2).attr("d", line);
        }

        root
          .selectAll("circle")
          .data(data)
          .enter()
          .append("circle")
          .attr("cx", (d: Record<string, unknown>) => xScale(toFiniteNumber(d[xKey], 0)))
          .attr("cy", (d: Record<string, unknown>) => yScale(toFiniteNumber(d[yKey], 0)))
          .attr("r", 3)
          .attr("fill", effectiveType === "area" ? "#16a34a" : "#3b82f6")
          .on("click", (_event: unknown, d: Record<string, unknown>) => {
            openDetailDialog(`Point: ${String(d[xKey] ?? "") || "Data Point"}`, d);
          });

        root.append("g").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(xScale));
        root.append("g").call(d3.axisLeft(yScale));
        return;
      }

      const xScale = d3.scalePoint().domain(data.map((d) => String(d[xKey] ?? ""))).range([0, innerWidth]).padding(0.5);
      const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

      if (effectiveType === "area") {
        const area = d3
          .area()
          .x((d: Record<string, unknown>) => xScale(String(d[xKey] ?? "")))
          .y0(innerHeight)
          .y1((d: Record<string, unknown>) => yScale(toFiniteNumber(d[yKey], 0)));
        root.append("path").datum(data).attr("fill", "#22c55e").attr("fill-opacity", 0.25).attr("stroke", "#16a34a").attr("stroke-width", 2).attr("d", area);
      } else {
        const line = d3
          .line()
          .x((d: Record<string, unknown>) => xScale(String(d[xKey] ?? "")))
          .y((d: Record<string, unknown>) => yScale(toFiniteNumber(d[yKey], 0)));
        root.append("path").datum(data).attr("fill", "none").attr("stroke", "#3b82f6").attr("stroke-width", 2).attr("d", line);
      }

      root
        .selectAll("circle")
        .data(data)
        .enter()
        .append("circle")
        .attr("cx", (d: Record<string, unknown>) => xScale(String(d[xKey] ?? "")))
        .attr("cy", (d: Record<string, unknown>) => yScale(toFiniteNumber(d[yKey], 0)))
        .attr("r", 3)
        .attr("fill", effectiveType === "area" ? "#16a34a" : "#3b82f6")
        .on("click", (_event: unknown, d: Record<string, unknown>) => {
          openDetailDialog(`Point: ${String(d[xKey] ?? "") || "Data Point"}`, d);
        })
        .append("title")
        .text((d: Record<string, unknown>) => `${String(d[xKey] ?? "")}: ${toFiniteNumber(d[yKey], 0)}`);

      const xAxis = root.append("g").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(xScale));
      if (shouldRotateTicks) {
        xAxis.selectAll("text").style("text-anchor", "end").attr("dx", "-0.6em").attr("dy", "0.2em").attr("transform", "rotate(-35)");
      }
      root.append("g").call(d3.axisLeft(yScale));
      return;
    }

    const xBand = d3.scaleBand().domain(data.map((d) => String(d[xKey] ?? ""))).range([0, innerWidth]).padding(0.2);
    const yLinear = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

    root
      .selectAll("rect")
      .data(data)
      .enter()
      .append("rect")
      .attr("x", (d: Record<string, unknown>) => xBand(String(d[xKey] ?? "")))
      .attr("y", (d: Record<string, unknown>) => yLinear(toFiniteNumber(d[yKey], 0)))
      .attr("height", (d: Record<string, unknown>) => innerHeight - yLinear(toFiniteNumber(d[yKey], 0)))
      .attr("width", xBand.bandwidth())
      .attr("fill", "#22c55e")
      .on("mouseover", function () { d3.select(this).attr("opacity", 0.82); })
      .on("mouseout", function () { d3.select(this).attr("opacity", 1); })
      .on("click", (_event: unknown, d: Record<string, unknown>) => {
        openDetailDialog(`Bar: ${String(d[xKey] ?? "") || "Item"}`, d);
      })
      .append("title")
      .text((d: Record<string, unknown>) => `${String(d[xKey] ?? "")}: ${toFiniteNumber(d[yKey], 0)}`);

    const xAxis = root.append("g").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(xBand));
    if (shouldRotateTicks) {
      xAxis.selectAll("text").style("text-anchor", "end").attr("dx", "-0.6em").attr("dy", "0.2em").attr("transform", "rotate(-35)");
    }
    root.append("g").call(d3.axisLeft(yLinear));
  }, [effectiveType, isD3Ready, spec, svgId]);

  if (!spec) {
    return <p className="text-sm text-muted-foreground">No chart specification available.</p>;
  }

  const hasData = Array.isArray(spec.data) && spec.data.length > 0;
  const hasGraph = Array.isArray(spec.nodes) && spec.nodes.length > 0 && Array.isArray(spec.links) && spec.links.length > 0;
  const hasHierarchy = !!(spec.hierarchy && typeof spec.hierarchy === "object");

  if (!hasData && !hasGraph && !hasHierarchy) {
    return <p className="text-sm text-muted-foreground">No chart data generated by LLM.</p>;
  }

  if (d3Error) {
    return <p className="text-sm text-destructive">{d3Error}</p>;
  }

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        {spec.title && <p className="font-medium">{spec.title}</p>}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor={`${svgId}-chart-type`}>
            Chart type
          </label>
          <select
            id={`${svgId}-chart-type`}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={effectiveType}
            onChange={(e) => setSelectedType(e.target.value as ChartType)}
          >
            {CHART_OPTIONS.filter((o) => compatibleTypes.includes(o.value)).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {compatibleTypes.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
          Chart data does not match supported structures yet. Try providing numeric x/y, category/value, source/target, hierarchy, or lat/lng fields.
        </p>
      )}
      <div className="relative">
        <svg id={svgId} className="w-full rounded-lg border border-border bg-background/40" />
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border bg-background/90 p-1 shadow-sm">
          <button
            type="button"
            className="h-7 w-7 rounded border border-border text-sm hover:bg-muted"
            onClick={handleZoomOut}
            title="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded border border-border text-sm hover:bg-muted"
            onClick={handleZoomIn}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="h-7 rounded border border-border px-2 text-xs hover:bg-muted"
            onClick={handleZoomReset}
            title="Reset zoom and position"
          >
            Reset
          </button>
        </div>
        <p className="pointer-events-none absolute bottom-2 right-3 z-10 rounded bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
          Drag to move. Scroll to zoom.
        </p>
        {selectedDetail && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-3">
            <div className="w-full max-w-lg rounded-lg border border-border bg-background p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">{selectedDetail.title}</p>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                  onClick={() => setSelectedDetail(null)}
                >
                  Close
                </button>
              </div>
              <pre className="max-h-72 overflow-auto rounded bg-muted/30 p-2 text-xs">
{JSON.stringify(selectedDetail.payload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default D3InsightChart;
