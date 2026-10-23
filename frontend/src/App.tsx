import React, { useRef, useState } from 'react';

interface Card {
  name: string;
  weight: string;
  color: string;
  material: string;
  barcode: string;
  confidence: number;
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const startCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const takePhoto = async () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    const imageBase64 = canvas.toDataURL('image/jpeg').split(',')[1];

    setLoading(true);
    const res = await fetch('http://localhost:8000/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 })
    });
    const data: Card = await res.json();
    setCard(data);
    setLoading(false);
  };

  return (
    <div style={{ padding: 20, fontFamily: 'Arial' }}>
      <h1>СмартОм — умные весы</h1>
      <button onClick={startCamera}>Включить камеру</button>
      <button onClick={stopCamera} style={{ marginLeft: 10 }}>Выключить камеру</button>
      <br /><br />
      <video ref={videoRef} autoPlay style={{ width: 400, border: '1px solid #ccc' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <br /><br />
      <button onClick={takePhoto} disabled={loading}>
        {loading ? 'Распознаём...' : 'Сфотографировать'}
      </button>
      {card && (
        <div style={{ marginTop: 20, padding: 20, border: '1px solid green', borderRadius: 8 }}>
          <h3>Готовая карточка:</h3>
          <p><b>Название:</b> {card.name}</p>
          <p><b>Вес:</b> {card.weight}</p>
          <p><b>Цвет:</b> {card.color}</p>
          <p><b>Материал:</b> {card.material}</p>
          <p><b>Штрихкод:</b> {card.barcode}</p>
          <button onClick={() => alert('Отправлено в базу!')}>Отправить</button>
        </div>
      )}
    </div>
  );
}

export default App;