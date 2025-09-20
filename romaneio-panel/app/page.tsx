"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

/* =========================
   Tipos
========================= */
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

type LastMeta = {
  filename: string;
  mime?: string;
  importedAt: number;
  kind: "sheet" | "pdf" | "other";
};

/* =========================
   Consts (cache keys)
========================= */
const LS_DATA = "romaneio:last-data";
const LS_META = "romaneio:last-meta";
const IDB_NAME = "romaneio-cache";
const IDB_STORE = "files";
const IDB_FILE_KEY = "last-file";

/* =========================
   Utils
========================= */
const toMinutes = (val: unknown): number | null => {
  if (val == null) return null;
  if (val instanceof Date) {
    return val.getHours() * 60 + val.getMinutes() + Math.round(val.getSeconds() / 60);
  }
  if (typeof val === "number") {
    if (val <= 2.5) return Math.round(val * 24 * 60);
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
    case "green":
      return "bg-green-600";
    case "yellow":
      return "bg-orange-500";
    case "red":
      return "bg-red-600";
    default:
      return "bg-zinc-500";
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
  const pairs = cols.map((c) => [normKey(c), c] as const);
  const pick = (targets: string[], i?: number): string | undefined => {
    for (const [k, v] of pairs) for (const t of targets) if (k.includes(t)) return v;
    if (i != null && cols[i]) return cols[i];
    return undefined;
  };
  return {
    StopIndex: pick(["stop", "stopnumber", "stop#", "stops", "parada", "sequencia", "seq", "ordem"], 0),
    Address: pick(["destinationaddress", "address", "endereco", "destino"], 1),
    Neighborhood: pick(["neighborhood", "bairro"], 3),
    DeliveryTime: pick(["deliverytime", "delivery", "tempoentrega", "leadtime"], 6),
    LocationType: pick(["locationtype", "tipo", "tipolocal"], 7),
    PlannedAT: pick(["plannedat", "planned"], 8),
    CorridorCage: pick(["corridorcage", "corridor", "cage", "rota"], 9),
  } as const;
};

const getVal = (row: Record<string, unknown>, key?: string) => (key ? row[key] : undefined);
const getStr = (row: Record<string, unknown>, key?: string) => {
  const v = getVal(row, key);
  return v == null ? "" : String(v).trim();
};

const timeAgo = (ts?: number) => {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
};

/* =========================
   IndexedDB helpers (arquivo bruto)
========================= */
function idbOpen(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbSetFile(file: File) {
  const db = await idbOpen();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(file, IDB_FILE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function idbGetFile(): Promise<File | null> {
  const db = await idbOpen();
  if (!db) return null;
  const out = await new Promise<File | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_FILE_KEY);
    req.onsuccess = () => resolve((req.result as File) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}
async function idbDelFile() {
  const db = await idbOpen();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(IDB_FILE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/* =========================
   Componente principal
========================= */
export default function RomaneioPage() {
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<Mode>("tempo");
  const [filterBand, setFilterBand] = useState<"all" | "green" | "yellow" | "red">("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Rota | null>(null);

  const [meta, setMeta] = useState<LastMeta | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const dropRef = useRef<HTMLLabelElement | null>(null);

  const closeModal = () => setSelected(null);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  // Carrega do cache ao iniciar
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_DATA);
      const mraw = localStorage.getItem(LS_META);
      if (raw && mraw) {
        const parsed = JSON.parse(raw) as Rota[];
        const m = JSON.parse(mraw) as LastMeta;
        setRotas(parsed);
        setMeta(m);
        // se foi pdf, tenta preparar URL
        if (m.kind === "pdf") {
          idbGetFile().then((f) => {
            if (f && f.type === "application/pdf") {
              const url = URL.createObjectURL(f);
              setPdfUrl(url);
            }
          });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Drag & Drop highlight
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDragOver = (e: DragEvent) => {
      prevent(e);
      el.classList.add("ring-2", "ring-zinc-300");
    };
    const onDragLeave = (e: DragEvent) => {
      prevent(e);
      el.classList.remove("ring-2", "ring-zinc-300");
    };
    const onDrop = (e: DragEvent) => {
      prevent(e);
      el.classList.remove("ring-2", "ring-zinc-300");
      const f = e.dataTransfer?.files?.[0];
      if (f) importFile(f);
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, []);

  const rememberData = async (kind: LastMeta["kind"], file?: File, filename?: string, mime?: string) => {
    const m: LastMeta = {
      filename: filename ?? file?.name ?? "arquivo",
      mime: mime ?? file?.type,
      importedAt: Date.now(),
      kind,
    };
    localStorage.setItem(LS_DATA, JSON.stringify(rotas));
    localStorage.setItem(LS_META, JSON.stringify(m));
    setMeta(m);
    if (file) await idbSetFile(file);
  };

  const clearCache = async () => {
    localStorage.removeItem(LS_DATA);
    localStorage.removeItem(LS_META);
    await idbDelFile();
    setMeta(null);
    setPdfUrl(null);
  };

  const importFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      // Se for PDF: apenas guarda no cache e mostra link para abrir
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        await idbSetFile(file);
        localStorage.setItem(LS_DATA, JSON.stringify([]));
        localStorage.setItem(
          LS_META,
          JSON.stringify({ filename: file.name, mime: file.type, importedAt: Date.now(), kind: "pdf" } satisfies LastMeta)
        );
        setRotas([]);
        setMeta({ filename: file.name, mime: file.type, importedAt: Date.now(), kind: "pdf" });
        const url = URL.createObjectURL(file);
        setPdfUrl(url);
        return;
      }

      // Planilha → processa
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];
      if (!json.length) {
        setError("Planilha vazia ou inválida.");
        return;
      }

      const cols = Object.keys(json[0]);
      const map = guessMap(cols);
      if (!map.CorridorCage) {
        setError("Não encontrei a coluna obrigatória: Corridor Cage (J).");
        return;
      }

      const rotaMap = new Map<string, Rota>();
      for (const row of json) {
        const id = getStr(row, map.CorridorCage);
        if (!id) continue;

        const r =
          rotaMap.get(id) ??
          ({
            id,
            qtdEnderecos: 0,
            deliveryTimesMin: [],
            stopsMax: undefined,
            neighborhoodSample: map.Neighborhood ? getStr(row, map.Neighborhood) : "",
            locationTypes: [],
            plannedATSample: map.PlannedAT ? getStr(row, map.PlannedAT) : "",
            addresses: [],
          } as Rota);

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
          if (lt) (r.locationTypes as string[]).push(lt);
        }

        rotaMap.set(id, r);
      }

      const out = Array.from(rotaMap.values()).map((r) => ({
        ...r,
        locationTypes: Array.from(new Set(r.locationTypes ?? [])),
      }));

      setRotas(out);
      // salva dataset + arquivo bruto
      localStorage.setItem(LS_DATA, JSON.stringify(out));
      localStorage.setItem(
        LS_META,
        JSON.stringify({ filename: file.name, mime: file.type, importedAt: Date.now(), kind: "sheet" } satisfies LastMeta)
      );
      await idbSetFile(file);
      setMeta({ filename: file.name, mime: file.type, importedAt: Date.now(), kind: "sheet" });
      setPdfUrl(null);
    } catch (e: any) {
      setError(e?.message ?? "Falha ao processar arquivo.");
    } finally {
      setBusy(false);
    }
  };

  const worstMinutesOf = (r: Rota): number | null =>
    r.deliveryTimesMin.length ? Math.max(...r.deliveryTimesMin) : null;

  const avgMinutesOf = (r: Rota): number | null =>
    r.deliveryTimesMin.length ? Math.round(r.deliveryTimesMin.reduce((a, b) => a + b, 0) / r.deliveryTimesMin.length) : null;

  const stopsCountOf = (r: Rota): number => (r.stopsMax && r.stopsMax > 0 ? r.stopsMax : r.qtdEnderecos);

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
    let green = 0,
      yellow = 0,
      red = 0;
    for (const r of rotas) {
      const b = bandOf(r, mode);
      if (b === "green") green++;
      else if (b === "yellow") yellow++;
      else if (b === "red") red++;
    }
    return { total, green, yellow, red };
  }, [rotas, mode]);

  const filteredSorted = useMemo(() => {
    const pass = rotas.filter((r) => {
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
        (r.locationTypes || []).some((t) => t.toLowerCase().includes(q))
      );
    });

    const cmp = (a: Rota, b: Rota) => {
      let va: number | string | null;
      let vb: number | string | null;

      if (sortKey === "id") {
        va = a.id.toLowerCase();
        vb = b.id.toLowerCase();
      } else if (sortKey === "avg") {
        va = mode === "tempo" ? avgMinutesOf(a) : stopsCountOf(a);
        vb = mode === "tempo" ? avgMinutesOf(b) : stopsCountOf(b);
      } else {
        va = scoreOf(a, mode);
        vb = scoreOf(b, mode);
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
    const rows = filteredSorted.map((r) => {
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

  const downloadCachedFile = async () => {
    const f = await idbGetFile();
    if (!f) return;
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = meta?.filename || "arquivo";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /* ============= UI ============= */
  return (
    <main className="space-y-6">
      {/* HERO */}
      <div className="rounded-2xl bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 p-[1px] shadow">
        <div className="rounded-2xl bg-white/95 p-4 sm:p-5">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                {/* ícone simples */}
                <div className="h-8 w-8 rounded-xl bg-blue-600/10 grid place-items-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M4 7h16M4 12h16M4 17h10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <h1 className="text-xl font-semibold tracking-tight">Painel de Rotas</h1>
              </div>
              <p className="mt-1 text-xs text-zinc-600">
                {mode === "tempo"
                  ? "Tempo de entrega — Verde < 3h30 · Laranja 3h30–4h20 · Vermelho > 4h20"
                  : "Quantidade de paradas — Verde < 20 · Laranja 20–30 · Vermelho > 30 (usa o MAIOR nº de stop da rota)"}
              </p>
              {meta && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-zinc-100 px-2 py-1">Arquivo: {meta.filename}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-1">Importado {timeAgo(meta.importedAt)}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-1 capitalize">Tipo: {meta.kind}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border bg-white p-1 shadow-sm">
                <button
                  onClick={() => setMode("tempo")}
                  className={`rounded-lg px-3 py-1.5 text-xs ${mode === "tempo" ? "bg-zinc-900 text-white" : ""}`}
                  title="Tempo de entrega"
                >
                  Tempo
                </button>
                <button
                  onClick={() => setMode("paradas")}
                  className={`rounded-lg px-3 py-1.5 text-xs ${mode === "paradas" ? "bg-zinc-900 text-white" : ""}`}
                  title="Quantidade de paradas"
                >
                  Paradas
                </button>
              </div>

              <label
                ref={dropRef}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs shadow-sm hover:bg-zinc-50"
                title="Importe .xlsx, .xls, .csv ou .pdf"
              >
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFile(f);
                  }}
                />
                Importar arquivo
              </label>

              <button
                onClick={downloadCachedFile}
                className="rounded-xl border bg-white px-3 py-2 text-xs shadow-sm hover:bg-zinc-50 disabled:opacity-50"
                disabled={!meta}
                title="Baixar o arquivo importado"
              >
                Baixar arquivo
              </button>

              <button
                onClick={exportCSV}
                className="rounded-xl border bg-white px-3 py-2 text-xs shadow-sm hover:bg-zinc-50"
              >
                Exportar CSV
              </button>

              <button
                onClick={() => {
                  setRotas([]);
                  clearCache();
                }}
                className="rounded-xl border bg-white px-3 py-2 text-xs shadow-sm hover:bg-zinc-50"
                title="Limpa dataset e arquivo do cache"
              >
                Limpar cache
              </button>
            </div>
          </header>

          {/* Se importou PDF, mostra um botão para abrir */}
          {pdfUrl && (
            <div className="mt-3">
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs shadow-sm hover:bg-zinc-50"
              >
                Ver PDF importado
              </a>
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-3 shadow">
          <div className="text-[11px] text-zinc-500">Rotas</div>
          <div className="text-xl font-semibold">{stats.total}</div>
        </div>
        <div className="rounded-xl border bg-white p-3 shadow">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full bg-green-600" />
            Verdes
          </div>
          <div className="text-xl font-semibold">{stats.green}</div>
        </div>
        <div className="rounded-xl border bg-white p-3 shadow">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full bg-orange-500" />
            Laranjas
          </div>
          <div className="text-xl font-semibold">{stats.yellow}</div>
        </div>
        <div className="rounded-xl border bg-white p-3 shadow">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full bg-red-600" />
            Vermelhas
          </div>
          <div className="text-xl font-semibold">{stats.red}</div>
        </div>
      </section>

      {/* Filtros + Ordenação */}
      <section className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {(["all", "green", "yellow", "red"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setFilterBand(b)}
              className={`rounded-full px-3 py-1 text-xs border ${
                filterBand === b ? "bg-zinc-900 text-white" : "bg-white"
              }`}
            >
              {b === "all" ? (
                "Todas"
              ) : (
                <>
                  <span
                    className={`mr-2 inline-block h-2 w-2 rounded-full ${
                      b === "green" ? "bg-green-600" : b === "yellow" ? "bg-orange-500" : "bg-red-600"
                    }`}
                  />
                  {b === "green" ? "Verdes" : b === "yellow" ? "Laranjas" : "Vermelhas"}
                </>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar rotas, bairro ou tipo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64 rounded-xl border bg-white px-3 py-2 text-xs shadow-sm"
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-xl border bg-white px-2 py-2 text-xs"
            title="Ordenar por"
          >
            <option value="score">{mode === "tempo" ? "Pior tempo" : "Nº paradas (max)"}</option>
            <option value="avg">{mode === "tempo" ? "Tempo médio" : "Nº paradas (max)"}</option>
            <option value="id">Rota (ID)</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="rounded-xl border bg-white px-3 py-2 text-xs shadow-sm hover:bg-zinc-50"
            title="Inverter ordem"
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </button>
        </div>
      </section>

      {/* Avisos */}
      {busy && <div className="rounded-xl border bg-white p-3 text-xs shadow-sm">Processando arquivo…</div>}
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      )}

      {/* Empty state */}
      {!busy && !error && rotas.length === 0 && (
        <section className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-zinc-600">
          <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-zinc-100 grid place-items-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 7h16M4 12h16M4 17h10" stroke="#525252" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          Importe um arquivo de romaneio (.xlsx, .xls, .csv) ou um PDF. O último arquivo fica salvo no navegador
          até você importar outro.
        </section>
      )}

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
              className={`relative cursor-pointer rounded-lg p-2 text-white shadow transition hover:scale-[1.01] ${bg}`}
              onClick={() => setSelected(r)}
            >
              <div className="absolute right-2 top-2 rounded-full bg-black/25 px-2 py-0.5 text-[10px]">
                {selo}
              </div>

              <div className="text-[13px] font-bold leading-tight">Rota {r.id}</div>
              <div className="mt-0.5 truncate text-[11px] opacity-90">
                {r.neighborhoodSample || "—"}
              </div>
              {r.locationTypes && r.locationTypes.length > 0 && (
                <div className="mt-0.5 truncate text-[11px] opacity-90">
                  Tipos: {r.locationTypes.slice(0, 3).join(", ")}
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
                <span className="ml-2 text-xs text-zinc-500">({selected.addresses.length} linhas)</span>
              </div>
              <button onClick={closeModal} className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-50">
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
