"use client";
import { useMemo, useState, useEffect } from "react";
import * as XLSX from "xlsx";

type AddressItem = { stop?: number; address: string };

type Rota = {
  id: string;
  qtdEnderecos: number;
  deliveryTimesMin: number[];
  stopsMax?: number;
  neighborhoodSample?: string;
  locationTypes?: string[];
  plannedATSample?: string;
  addresses: AddressItem[];
};

type SortKey = "score" | "avg" | "id";
type SortDir = "asc" | "desc";
type Mode = "tempo" | "paradas";

// ================= Utils =================
const toMinutes = (val: unknown): number | null => {
  if (val == null) return null;
  if (val instanceof Date) {
    return val.getHours() * 60 + val.getMinutes() + Math.round(val.getSeconds() / 60);
  }
  if (typeof val === "number") {
    if (val <= 2.5) return Math.round(val * 24 * 60); // fração de dia
    return Math.round(val);
  }
  let s = String(val).toLowerCase().replace(/\u00a0/g, " ").trim();
  if (!s) return null;


  let m = s.match(/^(\d{1,2})\s*h\s*(\d{1,2})\s*(m(in(utos)?|s)?)?$/i);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);


  m = s.match(/^(\d{1,2})([.,]\d+)?\s*h$/i);
  if (m) {
    const h = parseFloat((m[1] + (m[2] || "")).replace(",", "."));
    return Math.round(h * 60);
  }


  m = s.match(/^(\d{1,4})\s*(m(in(utos)?|s)?)$/i);
  if (m) return parseInt(m[1], 10);


  m = s.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = m[3] ? parseInt(m[3], 10) : 0;
    const ampm = m[4]?.toLowerCase();
    if (ampm === "pm" && h !== 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    return h * 60 + mm + Math.round(ss / 60);
  }

  const ts = Date.parse(s);
  if (!Number.isNaN(ts)) {
    const d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes() + Math.round(d.getSeconds() / 60);
  }

  if (/^\d+(\.\d+)?$/.test(s.replace(",", "."))) {
    return Math.round(parseFloat(s.replace(",", ".")) * 60);
  }
  return null;
};

const toInt = (val: unknown): number | null => {
  if (val == null) return null;
  if (typeof val === "number" && Number.isFinite(val)) return Math.trunc(val);
  const s = String(val).trim().replace(/[^\d-]/g, "");
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
};

const mmStr = (m: number | null) =>
  m == null ? "—" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

const colorByBand = (band: "green" | "yellow" | "red" | "none") => {
  switch (band) {
    case "green": return "bg-green-600";
    case "yellow": return "bg-orange-500";
    case "red": return "bg-red-600";
    default: return "bg-zinc-400";
  }
};

const bandTempo = (min: number | null): "green" | "yellow" | "red" | "none" => {
  if (min == null) return "none";
  if (min < 210) return "green";
  if (min <= 260) return "yellow";
  return "red";
};

const bandParadas = (stops: number): "green" | "yellow" | "red" => {
  if (stops < 20) return "green";
  if (stops <= 30) return "yellow";
  return "red";
};

const normKey = (s: string) =>
  s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");

const guessMap = (cols: string[]) => {
  const pairs = cols.map(c => [normKey(c), c] as const);
  const pick = (targets: string[], i?: number): string | undefined => {
    for (const [k, v] of pairs) for (const t of targets) if (k.includes(t)) return v;
    if (i != null && cols[i]) return cols[i];
    return undefined;
  };
  return {
    StopIndex: pick(["stop","stopnumber","stop#","stops","parada","sequencia","seq","ordem"], 0),
    Address:   pick(["destinationaddress","address","endereco","destino"], 1), // B
    Neighborhood: pick(["neighborhood","bairro"], 3),
    DeliveryTime: pick(["deliverytime","delivery","tempoentrega","leadtime"], 6),
    LocationType: pick(["locationtype","tipo","tipolocal"], 7),
    PlannedAT: pick(["plannedat","planned"], 8),
    CorridorCage: pick(["corridorcage","corridor","cage","rota"], 9),
  } as const;
};

const getVal = (row: Record<string, unknown>, key?: string) => (key ? row[key] : undefined);
const getStr = (row: Record<string, unknown>, key?: string) => {
  const v = getVal(row, key);
  return v == null ? "" : String(v).trim();
};

// ================= Page =================
export default function RomaneioPage() {
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<Mode>("tempo"); // seletor de tipo
  const [filterBand, setFilterBand] = useState<"all" | "green" | "yellow" | "red">("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("asc"); // melhores primeiro


  const [selected, setSelected] = useState<Rota | null>(null);
  const closeModal = () => setSelected(null);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

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
      if (!map.CorridorCage) {
        setError("Não encontrei a coluna obrigatória: Corridor Cage (J).");
        return;
      }


      setMode(prev => prev ?? (map.DeliveryTime ? "tempo" as Mode : "paradas" as Mode));

      const rotaMap = new Map<string, Rota>();
      for (const row of json) {
        const id = getStr(row, map.CorridorCage);
        if (!id) continue;

        const r = rotaMap.get(id) ?? {
          id,
          qtdEnderecos: 0,
          deliveryTimesMin: [] as number[],
          stopsMax: undefined,
          neighborhoodSample: map.Neighborhood ? getStr(row, map.Neighborhood) : "",
          locationTypes: [] as string[],
          plannedATSample: map.PlannedAT ? getStr(row, map.PlannedAT) : "",
          addresses: [] as AddressItem[],
        };


        r.qtdEnderecos++;


        let stopN: number | null = null;
        if (map.StopIndex) {
          stopN = toInt(getVal(row, map.StopIndex));
          if (stopN != null) r.stopsMax = Math.max(r.stopsMax ?? 0, stopN);
        }


        if (map.DeliveryTime) {
          const mins = toMinutes(getVal(row, map.DeliveryTime));
          if (mins != null) r.deliveryTimesMin.push(mins);
        }


        if (map.Address) {
          const addr = getStr(row, map.Address);
          if (addr) r.addresses.push({ stop: stopN ?? undefined, address: addr });
        }


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

      setRotas(out);
    } catch (e: any) {
      setError(e?.message ?? "Falha ao processar arquivo.");
    } finally {
      setBusy(false);
    }
  };


  const worstMinutesOf = (r: Rota): number | null =>
    r.deliveryTimesMin.length ? Math.max(...r.deliveryTimesMin) : null;

  const avgMinutesOf = (r: Rota): number | null =>
    r.deliveryTimesMin.length
      ? Math.round(r.deliveryTimesMin.reduce((a, b) => a + b, 0) / r.deliveryTimesMin.length)
      : null;

  const stopsCountOf = (r: Rota): number =>
    r.stopsMax && r.stopsMax > 0 ? r.stopsMax : r.qtdEnderecos;

  const scoreOf = (r: Rota, m: Mode): number | null => {
    if (m === "tempo") return worstMinutesOf(r);
    return stopsCountOf(r);
  };

  const bandOf = (r: Rota, m: Mode): "green" | "yellow" | "red" | "none" => {
    if (m === "tempo") return bandTempo(worstMinutesOf(r));
    return bandParadas(stopsCountOf(r));
  };


  const stats = useMemo(() => {
    const total = rotas.length;
    let green = 0, yellow = 0, red = 0;
    for (const r of rotas) {
      const b = bandOf(r, mode);
      if (b === "green") green++;
      else if (b === "yellow") yellow++;
      else if (b === "red") red++;
    }
    return { total, green, yellow, red };
  }, [rotas, mode]);


  const filteredSorted = useMemo(() => {
    const pass = rotas.filter(r => {
      const b = bandOf(r, mode);

      const passBand =
        filterBand === "all" ||
        (filterBand === "green" && b === "green") ||
        (filterBand === "yellow" && b === "yellow") ||
        (filterBand === "red" && b === "red");
      if (!passBand) return false;

      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        (r.neighborhoodSample || "").toLowerCase().includes(q) ||
        (r.locationTypes || []).some(t => t.toLowerCase().includes(q))
      );
    });

    const cmp = (a: Rota, b: Rota) => {
      let va: number | string | null;
      let vb: number | string | null;

      if (sortKey === "id") {
        va = a.id.toLowerCase(); vb = b.id.toLowerCase();
      } else if (sortKey === "avg") {
        va = mode === "tempo" ? avgMinutesOf(a) : stopsCountOf(a);
        vb = mode === "tempo" ? avgMinutesOf(b) : stopsCountOf(b);
      } else {
        va = scoreOf(a, mode); vb = scoreOf(b, mode);
      }

      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;

      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    };

    return pass.sort(cmp);
  }, [rotas, mode, filterBand, search, sortKey, sortDir]);

  const exportCSV = () => {
    const rows = filteredSorted.map(r => {
      const worst = worstMinutesOf(r);
      const avg = avgMinutesOf(r);
      const stopsTotal = stopsCountOf(r);
      const score = scoreOf(r, mode);
      return {
        CorridorCage: r.id,
        ParadasTotal: stopsTotal,
        Score: mode === "tempo" ? mmStr(score as number | null) : score,
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
    XLSX.writeFile(wb, `rotas_consolidadas_${mode}.csv`);
  };

  // ============= UI =============
  return (
    <main className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Painel de Rotas</h1>
          <p className="text-xs text-zinc-500">
            Tipo: {mode === "tempo"
              ? "Tempo de entrega — Verde < 3h30 · Laranja 3h30–4h20 · Vermelho > 4h20"
              : "Quantidade de paradas — Verde < 20 · Laranja 20–30 · Vermelho > 30 (usa o MAIOR nº de stop da rota)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e)=>setMode(e.target.value as Mode)}
            className="rounded-xl border px-2 py-2 text-xs bg-white"
            title="Tipo de Romaneio"
          >
            <option value="tempo">Tempo de entrega</option>
            <option value="paradas">Quantidade de paradas</option>
          </select>

          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-sm hover:bg-zinc-50">
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e)=>{ const f=e.target.files?.[0]; if (f) importFile(f); }} />
            Importar romaneio
          </label>
        </div>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-3 shadow">
          <div className="text-[11px] text-zinc-500">Rotas</div>
          <div className="text-xl font-semibold">{stats.total}</div>
        </div>
        <div className="rounded-xl border bg-white p-3 shadow">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full bg-green-600" />Verdes
          </div>
          <div className="text-xl font-semibold">{stats.green}</div>
        </div>
        <div className="rounded-xl border bg-white p-3 shadow">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full bg-orange-500" />Laranjas
          </div>
          <div className="text-xl font-semibold">{stats.yellow}</div>
        </div>
        <div className="rounded-xl border bg-white p-3 shadow">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full bg-red-600" />Vermelhas
          </div>
          <div className="text-xl font-semibold">{stats.red}</div>
        </div>
      </section>

      {/* Filtros + Ordenação */}
      <section className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button onClick={()=>setFilterBand("all")} className={`rounded-full px-3 py-1 text-xs border ${filterBand==="all"?"bg-zinc-900 text-white":"bg-white"}`}>Todas</button>
          <button onClick={()=>setFilterBand("green")} className={`rounded-full px-3 py-1 text-xs border ${filterBand==="green"?"bg-zinc-900 text-white":"bg-white"}`}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-600" />Verdes
          </button>
          <button onClick={()=>setFilterBand("yellow")} className={`rounded-full px-3 py-1 text-xs border ${filterBand==="yellow"?"bg-zinc-900 text-white":"bg-white"}`}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-orange-500" />Laranjas
          </button>
          <button onClick={()=>setFilterBand("red")} className={`rounded-full px-3 py-1 text-xs border ${filterBand==="red"?"bg-zinc-900 text-white":"bg-white"}`}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-600" />Vermelhas
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar as rotas, bairro ou tipo"
            value={search}
            onChange={(e)=>setSearch(e.target.value)}
            className="w-full sm:w-64 rounded-xl border px-3 py-2 text-xs shadow-sm bg-white"
          />
          <select
            value={sortKey}
            onChange={(e)=>setSortKey(e.target.value as SortKey)}
            className="rounded-xl border px-2 py-2 text-xs bg-white"
            title="Ordenar por"
          >
            <option value="score">{mode === "tempo" ? "Pior tempo" : "Nº paradas (max)"}</option>
            <option value="avg">{mode === "tempo" ? "Tempo médio" : "Nº paradas (max)"}</option>
            <option value="id">Rota (ID)</option>
          </select>
          <button
            onClick={()=>setSortDir(d=> d==="asc" ? "desc" : "asc")}
            className="rounded-xl border px-3 py-2 text-xs shadow-sm bg-white hover:bg-zinc-50"
            title="Inverter ordem"
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </button>
          <button onClick={exportCSV} className="rounded-xl border px-3 py-2 text-xs shadow-sm bg-white hover:bg-zinc-50">Exportar CSV</button>
        </div>
      </section>

      {busy && <div className="rounded-xl border bg-white p-3 text-xs shadow-sm">Processando planilha…</div>}
      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {/* Grid de cards */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        {filteredSorted.map((r) => {
          const band = bandOf(r, mode);
          const bg = colorByBand(band);
          const worst = worstMinutesOf(r);
          const avg = avgMinutesOf(r);
          const stopsTotal = stopsCountOf(r);
          const selo = mode === "tempo" ? mmStr(worst) : `${stopsTotal} stops`;

          return (
            <div
              key={r.id}
              className={`relative rounded-lg p-2 shadow text-white ${bg} cursor-pointer`}
              onClick={() => setSelected(r)}
            >
              <div className="absolute right-2 top-2 rounded-full bg-black/20 px-2 py-0.5 text-[10px]">
                {selo}
              </div>

              <div className="text-[13px] font-bold leading-tight">Rota {r.id}</div>
              <div className="mt-0.5 text-[11px] opacity-90 truncate">
                {r.neighborhoodSample || "—"}
              </div>
              {r.locationTypes && r.locationTypes.length > 0 && (
                <div className="mt-0.5 text-[11px] opacity-90 truncate">
                  Tipos: {r.locationTypes.slice(0,3).join(", ")}
                  {r.locationTypes.length > 3 && "…"}
                </div>
              )}

              <div className="mt-1.5 flex items-center justify-between text-[10px] opacity-90">
                {mode === "tempo" ? (
                  <>
                    <span>Média: {mmStr(avg)}</span>
                    <span>Stops (max): {stopsTotal}</span>
                  </>
                ) : (
                  <>
                    <span>Paradas (max): {stopsTotal}</span>
                    <span>Média: {r.deliveryTimesMin.length ? mmStr(avg) : "—"}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* Modal dos endereços */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeModal}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-semibold">
                Rota {selected.id} — Endereços
                <span className="ml-2 text-xs text-zinc-500">
                  ({selected.addresses.length} linhas)
                </span>
              </div>
              <button
                onClick={closeModal}
                className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-50"
              >
                Fechar
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto px-4 py-3">
              <ol className="space-y-2 text-sm">
                {selected.addresses
                  .slice()
                  .sort((a, b) => {
                    const aa = a.stop ?? Number.POSITIVE_INFINITY;
                    const bb = b.stop ?? Number.POSITIVE_INFINITY;
                    return aa - bb;
                  })
                  .map((it, idx) => (
                    <li key={idx} className="rounded-md border p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {it.stop != null ? `#${it.stop}` : `#${idx + 1}`}
                        </span>
                        <button
                          className="text-xs text-zinc-500 hover:underline"
                          onClick={() => navigator.clipboard.writeText(it.address)}
                          title="Copiar"
                        >
                          copiar
                        </button>
                      </div>
                      <div className="mt-1 text-zinc-800">{it.address}</div>
                    </li>
                  ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
