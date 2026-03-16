interface D3Global {
  select: (...args: unknown[]) => unknown;
  scaleBand: (...args: unknown[]) => unknown;
  scaleLinear: (...args: unknown[]) => unknown;
  scalePoint: (...args: unknown[]) => unknown;
  max: (...args: unknown[]) => number | undefined;
  axisBottom: (...args: unknown[]) => unknown;
  axisLeft: (...args: unknown[]) => unknown;
  line: (...args: unknown[]) => unknown;
  pie: (...args: unknown[]) => unknown;
  arc: (...args: unknown[]) => unknown;
  schemeTableau10: string[];
  scaleOrdinal: (...args: unknown[]) => unknown;
}

interface Window {
  d3?: D3Global;
}
