/**
 * Parser for the Prometheus text exposition format (vLLM /metrics output).
 *
 * Why hand-rolled: vLLM emits histogram/counter/gauge families that we need
 * as typed records for the cost engine. Pulling in a full Prometheus client
 * for a read-only scrape is 40x the dependency surface for the same result.
 *
 * Spec: https://prometheus.io/docs/instrumenting/exposition_formats/
 */

export type MetricType = "counter" | "gauge" | "histogram" | "summary" | "untyped";

export interface MetricSample {
  /** Metric name, e.g. `vllm:time_to_first_token_seconds_bucket` */
  name: string;
  /** Labels attached to this sample, e.g. { le: "0.5", model: "glm" } */
  labels: Record<string, string>;
  /** Numeric value */
  value: number;
  /** Optional timestamp in ms (rare in exposition format) */
  timestampMs?: number;
}

export interface MetricFamily {
  name: string;
  type: MetricType;
  help: string;
  samples: MetricSample[];
}

/**
 * Parse a label string like `{le="0.5",model="glm-5"}` or `` (empty).
 * Handles escaped quotes and backslashes inside values.
 */
export function parseLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return labels;

  const inner = trimmed.slice(1, trimmed.endsWith("}") ? -1 : undefined);
  // Walk the string manually — label values may contain commas inside quotes.
  let i = 0;
  const n = inner.length;
  while (i < n) {
    // read label name
    const eq = inner.indexOf("=", i);
    if (eq === -1) break;
    const name = inner.slice(i, eq).trim();
    i = eq + 1;
    if (inner[i] !== '"') break; // only quoted string values are valid here
    i += 1;
    let value = "";
    while (i < n && inner[i] !== '"') {
      if (inner[i] === "\\" && i + 1 < n) {
        const next = inner[i + 1];
        if (next === "n") value += "\n";
        else if (next === "\\") value += "\\";
        else if (next === '"') value += '"';
        else value += next;
        i += 2;
      } else {
        value += inner[i];
        i += 1;
      }
    }
    i += 1; // skip closing quote
    labels[name] = value;
    // skip to next comma or end
    while (i < n && inner[i] !== ",") i += 1;
    i += 1; // skip comma
  }
  return labels;
}

/**
 * Parse the full exposition payload into metric families grouped by base name.
 * Histograms produce `_bucket`, `_sum`, `_count` samples under one family.
 */
export function parsePrometheus(text: string): MetricFamily[] {
  const families = new Map<string, MetricFamily>();
  const typeByName = new Map<string, MetricType>();
  const helpByName = new Map<string, string>();

  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      if (trimmed.startsWith("# HELP ")) {
        const rest = trimmed.slice(7);
        const sp = rest.indexOf(" ");
        if (sp > 0) helpByName.set(rest.slice(0, sp), rest.slice(sp + 1));
      } else if (trimmed.startsWith("# TYPE ")) {
        const rest = trimmed.slice(7);
        const sp = rest.indexOf(" ");
        if (sp > 0) {
          const name = rest.slice(0, sp);
          const t = rest.slice(sp + 1).trim();
          const known: MetricType[] = ["counter", "gauge", "histogram", "summary", "untyped"];
          typeByName.set(name, known.includes(t as MetricType) ? (t as MetricType) : "untyped");
        }
      }
      continue;
    }

    // sample line: name{labels} value [timestamp]
    const braceStart = trimmed.indexOf("{");
    const spaceIdx = trimmed.search(/\s/);
    let name: string;
    let labelsRaw = "";
    let rest: string;
    if (braceStart !== -1 && (spaceIdx === -1 || braceStart < spaceIdx)) {
      name = trimmed.slice(0, braceStart);
      const braceEnd = trimmed.indexOf("}", braceStart);
      if (braceEnd === -1) continue; // malformed
      labelsRaw = trimmed.slice(braceStart, braceEnd + 1);
      rest = trimmed.slice(braceEnd + 1);
    } else if (spaceIdx !== -1) {
      name = trimmed.slice(0, spaceIdx);
      rest = trimmed.slice(spaceIdx);
    } else {
      continue; // no value — malformed
    }

    const parts = rest.trim().split(/\s+/);
    const value = Number(parts[0]);
    if (!Number.isFinite(value)) continue;
    const timestampMs = parts[1] ? Number(parts[1]) : undefined;

    // Histogram families: group buckets under the base name.
    let familyName = name;
    let type = typeByName.get(name) ?? "untyped";
    for (const suffix of ["_bucket", "_sum", "_count"]) {
      if (name.endsWith(suffix) && (typeByName.has(name.slice(0, -suffix.length)) || typeByName.get(name.slice(0, -suffix.length)) === "histogram")) {
        familyName = name.slice(0, -suffix.length);
        type = typeByName.get(familyName) ?? "histogram";
        break;
      }
    }

    let family = families.get(familyName);
    if (!family) {
      family = {
        name: familyName,
        type,
        help: helpByName.get(familyName) ?? helpByName.get(name) ?? "",
        samples: [],
      };
      families.set(familyName, family);
    }
    family.samples.push({
      name,
      labels: parseLabels(labelsRaw),
      value,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined,
    });
  }

  return Array.from(families.values());
}

/** Find a family by exact name. */
export function findFamily(families: MetricFamily[], name: string): MetricFamily | undefined {
  return families.find((f) => f.name === name);
}

/** Sum all sample values in a family (counters typically have one sample). */
export function sumFamily(family: MetricFamily | undefined): number {
  if (!family) return 0;
  return family.samples.reduce((acc, s) => acc + s.value, 0);
}
