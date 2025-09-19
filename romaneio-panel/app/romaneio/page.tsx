"use client";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Rota = {
  id: string;                   // CorridorCage
  qtdEnderecos: number;
  deliveryTimesMin: number[];   // minutos
  neighborhoodSample?: string;
  locationTypes?: string[];
  plannedATSample?: string;
};

// Utils
const toMinutes = (val: unknown): number | null => {
  if (val == null) return null;

  // 1) Date (SheetJS pode entregar como Date)
  if (val instanceof Date) {
    return val.getHours() * 60 + val.getMinutes() + Math.round(val.getSeconds() / 60);
  }

  // 2) Número (fração de dia do Excel ou já minutos)
  if (typeof val === "number") {
    if (val <= 2.5) return Math.round(val * 24 * 60); // fração de dia
    return Math.round(val); // já em minutos
  }

  // 3) String
  let s = String(val).trim();
  if (!s) return null;

  // normalizações:
  s = s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[,]/g, ".")                 // decimais com vírgula
    .replace(/\b(minutos?|mins?|min|m)\b/g, "") // remove palavras de minutos
    .replace(/\s*h\s*/g, ":")             // "3h50" / "3 h 50" -> "3:50"
    .replace(/\s*/g, "")                  // tira espaços restantes
    .trim();

  // Agora s deve estar tipo "3:50", "03:50:00", "3.5" etc.

  // HH:MM
  let m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);

  // HH:MM:SS
  m = s.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + Math.round(parseInt(m[3], 10) / 60);

  // AM/PM (ex.: "3:15pm" depois das normalizações)
  m = s.match(/^(\d{1,2}):([0-5]\d)(am|pm)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ampm = m[3];
    if (ampm === "pm" && h !== 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    return h * 60 + mm;
  }

  // Decimal em horas (ex.: "3.5")
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);

  // fallback numérico
  const f = Number(s);
  if (!Number.isNaN(f)) {
    if (f <= 2.5) return Math.round(f * 24 * 60);
    return Math.round(f);
  }

  return null;
};

const mmStr = (m: number | null) =>
  m == null ? "—" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

const slaColor = (min: number | null) => {
  if (min == null) return "bg-zinc-400";
  if (min < 210) return "bg-green-500";    // < 3h30
  if (min <= 260) return "bg-yellow-400";  // 3h30–4h20
  return "bg-red-500";                     // > 4h20
};

// map flexível de colunas
// normaliza removendo parênteses e tudo que não for [a-z0-9]
const normKey = (s: string) =>
  s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");

// tenta mapear nomes de colunas de forma mais flexível
const guessMap = (cols: string[]) => {
  const normPairs = cols.map(c => [normKey(c), c] as const);
  const normMap = new Map(normPairs);

  const pick = (targets: string[], fallbackIndex?: number): string | undefined => {
    // alvo: lista de chaves normalizadas que aceitamos
    for (const [k, v] of normPairs) {
      for (const t of targets) {
        if (k.includes(t)) return v; // casa por substring normalizada
      }
    }
    if (fallbackIndex != null && cols[fallbackIndex]) return cols[fallbackIndex];
    return undefined;
  };

  return {
    // D
    Neighborhood: pick(["neighborhood", "bairro"], 3),
    // G
    DeliveryTime: pick(["deliverytime", "delivery", "tempoentrega", "leadtime"], 6),
    // H
    LocationType: pick(["locationtype", "tipo", "tipolocal"], 7),
    // I
    PlannedAT: pick(["plannedat", "planned"], 8),
    // J
    CorridorCage: pick(["corridorcage", "corridor", "cage", "rota"], 9),
  } as const;
};

// helpers para acessar linha com chave opcional
const getVal = (row: Record<string, unknown>, key?: string) =>
  key ? row[key] : undefined;

const getStr = (row: Record<string, unknown>, key?: string) => {
  const v = getVal(row, key);
  return v == null ? "" : String(v).trim();
};

export default function RomaneioPage() {
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterSLA, setFilterSLA] = useState<"all" | "green" | "yellow" | "red">("all");
  const [search, setSearch] = useState("");

  const importFile = async (file: File) => {
    setBusy(true); setError(null); setRotas([]);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];
      if (!json.length) { setError("Planilha vazia ou inválida."); return; }

      const cols = Object.keys(json[0]);
      const map = guessMap(cols);
      if (!map.CorridorCage || !map.DeliveryTime) {
        setError("Não encontrei colunas obrigatórias: Corridor Cage (J) e Delivery Time (G).");
        return;
      }

      console.log("Headers:", cols);
      console.log("Map:", map);

      // veja 10 valores brutos da coluna de DeliveryTime
      const rawSamples = json.slice(0, 10).map(r => (map.DeliveryTime ? (r as any)[map.DeliveryTime] : undefined));
      console.log("Raw DeliveryTime samples:", rawSamples);

      const rotaMap = new Map<string, Rota>();
      for (const row of json) {
        const id = getStr(row, map.CorridorCage);
        if (!id) continue;

        const mins = toMinutes(getVal(row, map.DeliveryTime));

        const r = rotaMap.get(id) ?? {
          id,
          qtdEnderecos: 0,
          deliveryTimesMin: [] as number[],
          neighborhoodSample: map.Neighborhood ? getStr(row, map.Neighborhood) : "",
          locationTypes: [] as string[],
          plannedATSample: map.PlannedAT ? getStr(row, map.PlannedAT) : "",
        };

        r.qtdEnderecos++;
        if (mins != null) r.deliveryTimesMin.push(mins);

        if (map.LocationType) {
          const lt = getStr(row, map.LocationType);
          if (lt) r.locationTypes!.push(lt);
        }

        rotaMap.set(id, r);
      }

      const out = Array.from(rotaMap.values()).map(r => ({
        ...r,
        locationTypes: Array.from(new Set(r.locationTypes)),
      }));

      console.log("Amostra DeliveryTime parse:", out.slice(0,5).map(r => ({
        id: r.id,
        samples: r.deliveryTimesMin.slice(0,3)
      })));
      
      // ordena pior SLA primeiro
      const slaRank = (worst: number | null) => {
        if (worst == null) return 3;
        if (worst > 260) return 0;
        if (worst >= 210) return 1;
        return 2;
      };
      out.sort((a, b) => {
        const worstA = a.deliveryTimesMin.length ? Math.max(...a.deliveryTimesMin) : null;
        const worstB = b.deliveryTimesMin.length ? Math.max(...b.deliveryTimesMin) : null;
        const ra = slaRank(worstA), rb = slaRank(worstB);
        if (ra !== rb) return ra - rb;
        return (worstB ?? -1) - (worstA ?? -1);
      });

      setRotas(out);
    } catch (e: any) {
      setError(e?.message ?? "Falha ao processar arquivo.");
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => {
    const total = rotas.length;
    let green = 0, orange = 0, red = 0;
    for (const r of rotas) {
      const worst = r.deliveryTimesMin.length ? Math.max(...r.deliveryTimesMin) : null;
      if (worst == null) continue;
      if (worst < 210) green++;
      else if (worst <= 260) orange++;
      else red++;
    }
    return { total, green, orange, red };
  }, [rotas]);


  const filtered = useMemo(() => {
    return rotas.filter(r => {
      const worst = r.deliveryTimesMin.length ? Math.max(...r.deliveryTimesMin) : null;
      const passSLA =
        filterSLA === "all" ||
        (filterSLA === "green" && worst != null && worst < 210) ||
        (filterSLA === "yellow" && worst != null && worst >= 210 && worst <= 260) ||
        (filterSLA === "red" && worst != null && worst > 260);
      if (!passSLA) return false;

      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        (r.neighborhoodSample || "").toLowerCase().includes(q) ||
        (r.locationTypes || []).some(t => t.toLowerCase().includes(q))
      );
    });
  }, [rotas, filterSLA, search]);

  const exportCSV = () => {
    const rows = filtered.map(r => {
      const worst = r.deliveryTimesMin.length ? Math.max(...r.deliveryTimesMin) : null;
      const avg = r.deliveryTimesMin.length
        ? Math.round(r.deliveryTimesMin.reduce((a,b)=>a+b,0) / r.deliveryTimesMin.length)
        : null;
      return {
        CorridorCage: r.id,
        Enderecos: r.qtdEnderecos,
        Worst: mmStr(worst),
        Avg: mmStr(avg),
        Neighborhood: r.neighborhoodSample || "",
        LocationTypes: (r.locationTypes || []).join(", "),
        PlannedAT: r.plannedATSample || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rotas");
    XLSX.writeFile(wb, "rotas_consolidadas.csv");
  };

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Painel de Rotas (Corridor Cage)</h1>
          <p className="text-sm text-zinc-500">
            Importe o romaneio (.xlsx/.csv). As rotas são consolidadas e os cards são coloridos pelo pior Delivery Time.
          </p>
        </div>
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm shadow-sm hover:bg-zinc-50">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e)=>{ const f=e.target.files?.[0]; if (f) importFile(f); }}
          />
          Importar romaneio
        </label>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border bg-white p-4 shadow">
          <div className="text-xs text-zinc-500">Rotas</div>
          <div className="text-2xl font-semibold">{stats.total}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full bg-green-500" />Verdes
          </div>
          <div className="text-2xl font-semibold">{stats.green}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full bg-orange-500" />Laranjas
          </div>
          <div className="text-2xl font-semibold">{stats.orange}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />Vermelhas
          </div>
          <div className="text-2xl font-semibold">{stats.red}</div>
        </div>
      </section>

      {/* Filtros */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button onClick={()=>setFilterSLA("all")} className={`rounded-full px-3 py-1 text-sm border ${filterSLA==="all"?"bg-zinc-900 text-white":"bg-white"}`}>Todas</button>
          <button onClick={()=>setFilterSLA("green")} className={`rounded-full px-3 py-1 text-sm border ${filterSLA==="green"?"bg-zinc-900 text-white":"bg-white"}`}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-500" />Verdes
          </button>
          <button onClick={()=>setFilterSLA("yellow")} className={`rounded-full px-3 py-1 text-sm border ${filterSLA==="yellow"?"bg-zinc-900 text-white":"bg-white"}`}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-yellow-400" />Amarelas
          </button>
          <button onClick={()=>setFilterSLA("red")} className={`rounded-full px-3 py-1 text-sm border ${filterSLA==="red"?"bg-zinc-900 text-white":"bg-white"}`}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-500" />Vermelhas
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar por rota, bairro ou tipo"
            value={search}
            onChange={(e)=>setSearch(e.target.value)}
            className="w-full sm:w-80 rounded-xl border px-3 py-2 text-sm shadow-sm bg-white"
          />
          <button onClick={exportCSV} className="rounded-xl border px-3 py-2 text-sm shadow-sm bg-white hover:bg-zinc-50">Exportar CSV</button>
        </div>
      </section>

      {busy && <div className="rounded-xl border bg-white p-3 text-sm shadow-sm">Processando planilha…</div>}
      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Grid de cards coloridos */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {filtered.map((r) => {
          const worst = r.deliveryTimesMin.length ? Math.max(...r.deliveryTimesMin) : null;
          const bg =
            worst == null ? "bg-zinc-400" :
            worst < 210 ? "bg-green-500" :
            worst <= 260 ? "bg-orange-500" : "bg-red-600";

          return (
            <div key={r.id} className={`rounded-xl p-4 shadow text-white ${bg}`}>
              <h2 className="text-lg font-bold">Rota {r.id}</h2>
              <div className="mt-1 text-sm opacity-90">{r.neighborhoodSample || "—"}</div>
              {r.locationTypes && r.locationTypes.length > 0 && (
                <div className="mt-1 text-xs">
                  Tipos: {r.locationTypes.slice(0,3).join(", ")}
                  {r.locationTypes.length > 3 && "…"}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
