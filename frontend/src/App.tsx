import { useEffect, useRef, useState } from "react";
import "./App.css";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

type CatalogItem = {
  id: number;
  name: string;
  category: string;
  color: string;
  size: string;
  material: string;
  barcode: string;
  price: number | null;
  description: string;
};

type Intake = CatalogItem & {
  weight_grams: number;
  confidence: number;
  match_type: string;
  image_url: string;
  created_at: string;
  catalog_id: number | null;
};

type Card = {
  name: string;
  category: string;
  color: string;
  size: string;
  material: string;
  weight_grams: number;
  barcode: string;
  price: number | null;
  description: string;
  catalog_id: number | null;
  confidence: number;
  match_type: string;
};

type FormState = Omit<Card, "price"> & { price: string };

type RecognizeResponse = {
  found: boolean;
  match: string;
  detected_color: string;
  barcode: string;
  steps: string[];
  card: Card;
  candidates: CatalogItem[];
  saved: Intake | null;
};

const PRESETS = [350, 780, 1200, 2500];

const MATCH_LABEL: Record<string, string> = {
  barcode: "Найден по штрихкоду",
  new_barcode: "Новый штрихкод",
  color: "Похож по цвету",
  none: "В каталоге нет",
  manual: "Проверено оператором",
};

function emptyForm(weightGrams: number): FormState {
  return {
    name: "",
    category: "",
    color: "",
    size: "",
    material: "",
    weight_grams: weightGrams,
    barcode: "",
    price: "",
    description: "",
    catalog_id: null,
    confidence: 0,
    match_type: "",
  };
}

function formatWeight(grams: number): string {
  return (
    (grams / 1000).toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " кг"
  );
}

function formatPrice(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function priceToText(value: number | null): string {
  return value == null ? "" : String(value);
}

function textToPrice(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function cardToForm(card: Card): FormState {
  return { ...card, price: priceToText(card.price) };
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Ответ без JSON.
  }
  return "Сервер не смог выполнить запрос";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const heldWeight = useRef<number | null>(null);
  const pauseAuto = useRef(false);
  const autoTimer = useRef<number | null>(null);
  const requestSeq = useRef(0);
  const recognizeRef = useRef<(image: string, weight: number) => Promise<void>>(
    async () => undefined
  );

  function holdAuto() {
    pauseAuto.current = true;
    if (autoTimer.current != null) {
      window.clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    setStabilizing(false);
  }

  const [weightGrams, setWeightGrams] = useState(0);
  const [autoShoot, setAutoShoot] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [stabilizing, setStabilizing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [status, setStatus] = useState("Положите товар на весы");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [match, setMatch] = useState("");
  const [candidates, setCandidates] = useState<CatalogItem[]>([]);
  const [form, setForm] = useState<FormState>(() => emptyForm(0));
  const [savedId, setSavedId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [intakes, setIntakes] = useState<Intake[]>([]);

  const hasCard = Boolean(form.name || notes.length);

  async function refreshLists() {
    const [catalogResponse, intakeResponse] = await Promise.all([
      fetch(`${API}/catalog`),
      fetch(`${API}/products`),
    ]);
    if (catalogResponse.ok) setCatalog(await catalogResponse.json());
    if (intakeResponse.ok) setIntakes(await intakeResponse.json());
  }

  async function recognizeImage(imageBase64: string, weight: number) {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    setStatus("Распознаём товар…");
    try {
      const response = await fetch(`${API}/recognize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64, weight_grams: weight }),
      });
      if (seq !== requestSeq.current) return;
      if (!response.ok) throw new Error(await errorText(response));
      const data: RecognizeResponse = await response.json();
      if (seq !== requestSeq.current) return;
      setForm(cardToForm(data.card));
      setNotes(data.steps);
      setMatch(data.match);
      setCandidates(data.candidates);
      setSavedId(data.saved ? data.saved.id : null);
      setDirty(false);
      setStatus(
        data.saved
          ? "Карточка передана в базу"
          : "Проверьте карточку и передайте её в базу"
      );
      if (data.saved) await refreshLists();
    } catch (reason) {
      const message =
        reason instanceof Error && reason.message
          ? reason.message
          : "Не удалось связаться с сервером на порту 8000";
      setError(
        message === "Failed to fetch"
          ? "Не удалось связаться с сервером. Запустите бэкенд на порту 8000."
          : message
      );
      setStatus("Распознавание не выполнено");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  recognizeRef.current = recognizeImage;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("В этом браузере нет камеры. Загрузите фото товара.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraOn(true);
        setCameraError("");
      } catch {
        if (!cancelled) {
          setCameraError("Камера недоступна. Можно загрузить фото товара.");
          setCameraOn(false);
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        const response = await fetch(`${API}/health`);
        if (!cancelled) setServerOk(response.ok);
      } catch {
        if (!cancelled) setServerOk(false);
      }
    }
    void ping();
    const timer = window.setInterval(() => void ping(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (serverOk) void refreshLists().catch(() => setServerOk(false));
  }, [serverOk]);

  useEffect(() => {
    if (weightGrams < 50) heldWeight.current = null;
    pauseAuto.current = false;
  }, [weightGrams]);

  function grabFrame(): string | null {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  useEffect(() => {
    if (!autoShoot || pauseAuto.current || weightGrams < 50 || !cameraOn || loading) {
      setStabilizing(false);
      return;
    }
    if (heldWeight.current === weightGrams) {
      setStabilizing(false);
      return;
    }
    setStabilizing(true);
    setStatus("Вес стабилизировался, сейчас будет фото");
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = null;
      if (pauseAuto.current) {
        setStabilizing(false);
        return;
      }
      const shot = grabFrame();
      setStabilizing(false);
      if (!shot) {
        setStatus("Камера ещё не готова к съёмке");
        return;
      }
      heldWeight.current = weightGrams;
      pauseAuto.current = true;
      setPreview(shot);
      void recognizeRef.current(shot.split(",")[1], weightGrams);
    }, 1200);
    return () => {
      if (autoTimer.current != null) {
        window.clearTimeout(autoTimer.current);
        autoTimer.current = null;
      }
    };
  }, [autoShoot, weightGrams, cameraOn, loading]);

  function patchForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  async function shootNow() {
    holdAuto();
    const shot = grabFrame();
    if (!shot) {
      setError("Нет кадра с камеры. Разрешите доступ или загрузите фото.");
      return;
    }
    heldWeight.current = weightGrams;
    setPreview(shot);
    await recognizeImage(shot.split(",")[1], weightGrams);
  }

  async function onFile(file: File) {
    holdAuto();
    const dataUrl = await blobToDataUrl(file);
    setPreview(dataUrl);
    const base64 = dataUrl.split(",")[1];
    if (!base64) {
      setError("Не удалось прочитать файл");
      return;
    }
    await recognizeImage(base64, weightGrams);
  }

  async function recognizeCatalogBarcode(item: CatalogItem) {
    holdAuto();
    setError("");
    try {
      const response = await fetch(`${API}/catalog/${item.id}/barcode.png`);
      if (!response.ok) throw new Error(await errorText(response));
      const dataUrl = await blobToDataUrl(await response.blob());
      setPreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      await recognizeImage(base64, weightGrams);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось получить штрихкод");
    }
  }

  async function lookupBarcode() {
    if (!form.barcode.trim()) {
      setError("Введите штрихкод");
      return;
    }
    setError("");
    try {
      const response = await fetch(
        `${API}/catalog/search?barcode=${encodeURIComponent(form.barcode.trim())}`
      );
      if (!response.ok) throw new Error(await errorText(response));
      const data: { item: CatalogItem | null } = await response.json();
      if (!data.item) {
        setNotes((current) => [...current, "В каталоге нет товара с таким штрихкодом"]);
        setMatch("new_barcode");
        return;
      }
      applyCandidate(data.item);
      setNotes((current) => [...current, `В каталоге найден товар «${data.item?.name}»`]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось проверить каталог");
    }
  }

  function applyCandidate(item: CatalogItem) {
    setForm((current) => ({
      ...current,
      name: item.name,
      category: item.category,
      color: item.color,
      size: item.size,
      material: item.material,
      barcode: item.barcode || current.barcode,
      price: priceToText(item.price),
      description: item.description,
      catalog_id: item.id,
      match_type: "manual",
      confidence: 0.9,
    }));
    setMatch("manual");
    setDirty(true);
  }

  function resetIntake() {
    holdAuto();
    setForm(emptyForm(weightGrams));
    setSavedId(null);
    setDirty(false);
    setPreview("");
    setNotes([]);
    setCandidates([]);
    setMatch("");
    setError("");
    setStatus("Готовы к следующему товару");
  }

  async function saveCard() {
    const name = form.name.trim();
    if (!name || name === "Новый товар") {
      setError("Укажите настоящее название товара");
      return;
    }
    setLoading(true);
    setError("");
    const payload = {
      ...form,
      name,
      price: textToPrice(form.price),
      weight_grams: form.weight_grams || weightGrams,
      image: preview.startsWith("data:") ? preview.split(",")[1] : "",
    };
    try {
      const response = await fetch(
        savedId ? `${API}/products/${savedId}` : `${API}/products`,
        {
          method: savedId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) throw new Error(await errorText(response));
      const saved: Intake = await response.json();
      setSavedId(saved.id);
      setDirty(false);
      setMatch(saved.match_type || "manual");
      setStatus(savedId ? "Запись в базе обновлена" : "Карточка передана в базу");
      setNotes((current) => [
        ...current,
        savedId ? "Оператор обновил запись в базе" : "Оператор передал карточку в базу",
      ]);
      await refreshLists();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить карточку");
    } finally {
      setLoading(false);
    }
  }

  function openIntake(item: Intake) {
    holdAuto();
    setForm({
      name: item.name,
      category: item.category,
      color: item.color,
      size: item.size,
      material: item.material,
      weight_grams: item.weight_grams,
      barcode: item.barcode,
      price: priceToText(item.price),
      description: item.description,
      catalog_id: item.catalog_id,
      confidence: item.confidence,
      match_type: item.match_type,
    });
    setSavedId(item.id);
    setDirty(false);
    setPreview(item.image_url ? `${API}${item.image_url}` : "");
    setNotes([`Запись открыта из базы приёмки, ${formatTime(item.created_at)}`]);
    setCandidates([]);
    setMatch(item.match_type);
    setError("");
  }

  const steps = [
    { label: "Вес", done: weightGrams >= 50 || form.weight_grams >= 50 },
    { label: "Фото", done: Boolean(preview) },
    { label: "Распознавание", done: notes.length > 0 },
    { label: "База", done: notes.length > 0 },
    { label: "Карточка", done: Boolean(form.name) && form.name !== "Новый товар" },
    { label: "Запись", done: savedId != null && !dirty },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="brand">СмартОм</p>
          <h1>Приёмка и цифровизация товаров</h1>
        </div>
        <p className={serverOk ? "pill ok" : "pill bad"}>
          {serverOk == null ? "Проверяем сервер…" : serverOk ? "Сервер на связи" : "Сервер недоступен"}
        </p>
      </header>

      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step.label} className={step.done ? "done" : ""}>
            <span>{index + 1}</span>
            {step.label}
          </li>
        ))}
      </ol>

      <main className="layout">
        <section className="panel">
          <h2>Весы и камера</h2>
          <p className="hint">
            Вес приходит с весов в граммах. Пока устройство не подключено, его можно задать вручную:
            после стабилизации система сама делает снимок.
          </p>
          <div className="scale">
            <strong>{formatWeight(weightGrams)}</strong>
            <span>{weightGrams >= 50 ? "Вес стабилен" : "Весы пустые"}</span>
          </div>
          <input
            className="slider"
            type="range"
            min={0}
            max={5000}
            step={10}
            value={weightGrams}
            aria-label="Вес на весах, граммы"
            onChange={(event) => setWeightGrams(Number(event.target.value))}
          />
          <label className="grams">
            Граммы
            <input
              type="number"
              min={0}
              max={100000}
              value={weightGrams}
              onChange={(event) => setWeightGrams(Math.max(0, Number(event.target.value) || 0))}
            />
          </label>
          <div className="row">
            {PRESETS.map((preset) => (
              <button key={preset} type="button" onClick={() => setWeightGrams(preset)}>
                {formatWeight(preset)}
              </button>
            ))}
            <button type="button" onClick={() => setWeightGrams(0)}>
              Сбросить
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={autoShoot}
              onChange={(event) => setAutoShoot(event.target.checked)}
            />
            Снимать автоматически, когда вес стабилен
          </label>

          <div className={preview ? "stage split" : "stage"}>
            <video ref={videoRef} autoPlay muted playsInline />
            {preview && <img src={preview} alt="Снимок товара" />}
          </div>
          <canvas ref={canvasRef} hidden />
          {cameraError && <p className="hint">{cameraError}</p>}
          <p className="status">{stabilizing ? "Весы стабилизировались, снимаем…" : status}</p>
          {error && <p className="error">{error}</p>}

          <div className="row">
            <button type="button" onClick={() => void shootNow()} disabled={loading}>
              {loading ? "Подождите…" : "Сфотографировать"}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={loading}>
              Загрузить фото
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onFile(file);
              }}
            />
          </div>
        </section>

        <section className="panel">
          <h2>Карточка товара</h2>
          {!hasCard && (
            <p className="hint">
              Здесь появится карточка: название, вес, цвет, материал, штрихкод и цена. Если товар уже
              есть в каталоге, поля заполнятся сами.
            </p>
          )}
          {match && <p className="pill">{MATCH_LABEL[match] || match}</p>}
          {form.confidence > 0 && (
            <p className="hint">Уверенность: {Math.round(form.confidence * 100)}%</p>
          )}
          {notes.length > 0 && (
            <ul className="notes">
              {notes.map((note, index) => (
                <li key={`${index}-${note}`}>{note}</li>
              ))}
            </ul>
          )}
          {candidates.length > 1 && (
            <div className="candidates">
              <p>Возможные товары из каталога</p>
              {candidates.map((item) => (
                <button key={item.id} type="button" onClick={() => applyCandidate(item)}>
                  {item.name}
                  <span>
                    {item.color}, {item.size}
                  </span>
                </button>
              ))}
            </div>
          )}
          {hasCard && (
            <div className="form">
              <label>
                Название
                <input value={form.name} onChange={(event) => patchForm({ name: event.target.value })} />
              </label>
              <label>
                Категория
                <input
                  value={form.category}
                  onChange={(event) => patchForm({ category: event.target.value })}
                />
              </label>
              <label>
                Цвет
                <input value={form.color} onChange={(event) => patchForm({ color: event.target.value })} />
              </label>
              <label>
                Размер
                <input value={form.size} onChange={(event) => patchForm({ size: event.target.value })} />
              </label>
              <label>
                Материал
                <input
                  value={form.material}
                  onChange={(event) => patchForm({ material: event.target.value })}
                />
              </label>
              <label>
                Вес, г
                <input
                  type="number"
                  min={0}
                  value={form.weight_grams}
                  onChange={(event) =>
                    patchForm({ weight_grams: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              </label>
              <label>
                Штрихкод
                <input
                  value={form.barcode}
                  onChange={(event) => patchForm({ barcode: event.target.value })}
                />
              </label>
              <label>
                Цена, ₽
                <input
                  value={form.price}
                  onChange={(event) => patchForm({ price: event.target.value })}
                />
              </label>
              <label className="wide">
                Описание
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(event) => patchForm({ description: event.target.value })}
                />
              </label>
              <div className="row wide">
                <button type="button" onClick={() => void lookupBarcode()} disabled={loading}>
                  Найти в каталоге
                </button>
                <button type="button" className="primary" onClick={() => void saveCard()} disabled={loading}>
                  {savedId ? "Обновить в базе" : "Передать в базу"}
                </button>
                <button type="button" onClick={resetIntake}>
                  Новый товар
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="panel side">
          <h2>База приёмки</h2>
          {intakes.length === 0 && <p className="hint">Пока пусто. Сюда попадут принятые товары.</p>}
          <ul className="list">
            {intakes.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => openIntake(item)}>
                  {item.image_url && <img src={`${API}${item.image_url}`} alt="" />}
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {formatWeight(item.weight_grams)} · {item.color || "цвет не указан"} ·{" "}
                      {formatTime(item.created_at)}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <h2>Каталог</h2>
          <p className="hint">Эти товары уже заведены. Штрихкод можно поднести к камере или прогнать тем же распознаванием.</p>
          <ul className="list">
            {catalog.map((item) => (
              <li key={item.id} className="catalog-item">
                <img src={`${API}/catalog/${item.id}/barcode.png`} alt={`Штрихкод ${item.barcode}`} />
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.color}, {item.material}, {formatPrice(item.price)}
                  </small>
                  <button type="button" onClick={() => void recognizeCatalogBarcode(item)} disabled={loading}>
                    Считать штрихкод
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default App;
