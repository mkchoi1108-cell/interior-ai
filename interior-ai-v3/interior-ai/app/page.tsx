'use client';

import { useState, useRef, useCallback } from 'react';

const STYLES = [
  { id: 'nordic', label: '북유럽', emoji: '🌿' },
  { id: 'cozy', label: '코지 웜', emoji: '🕯️' },
  { id: 'white-wood', label: '화이트앤우드', emoji: '🪵' },
  { id: 'french', label: '프렌치 빈티지', emoji: '🥐' },
  { id: 'minimal', label: '모던 미니멀', emoji: '◻️' },
  { id: 'japandi', label: '재팬디', emoji: '🍃' },
  { id: 'industrial', label: '인더스트리얼', emoji: '⚙️' },
  { id: 'boho', label: '보헤미안', emoji: '🌙' },
];

const STEPS = ['사진 업로드', '스타일 선택', '결과 확인'];
const GEN_STEPS = ['방 구조 분석 중', '스타일 프롬프트 생성 중', 'AI 이미지 렌더링 중', '가구 추천 생성 중'];
const DAILY_LIMIT = 3;

type Step = 'upload' | 'style' | 'generating' | 'result';

interface FurnitureItem {
  category: string;
  name: string;
  description: string;
  priceRange: string;
  searchLinks: { site: string; url: string }[];
}

interface Result {
  generatedImageUrl: string;
  analysis: { roomType: string; currentFeatures: string; styleDescription: string };
  furniture: FurnitureItem[];
  remaining: number;
}

export default function Home() {
  const [step, setStep] = useState<Step>('upload');
  const [images, setImages] = useState<string[]>([]);
  const [selectedStyle, setSelectedStyle] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [usedCount, setUsedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentStepIdx = step === 'upload' ? 0 : step === 'style' ? 1 : 2;

  const processFiles = useCallback((files: FileList) => {
    Array.from(files).slice(0, 4).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        setImages(prev => [...prev, e.target?.result as string].slice(0, 4));
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleGenerate = async () => {
    if (images.length === 0) { setError('방 사진을 최소 1장 올려주세요.'); return; }
    if (!selectedStyle) { setError('스타일을 선택해주세요.'); return; }

    setError('');
    setStep('generating');
    setGenStep(0);

    const interval = setInterval(() => {
      setGenStep(prev => prev < GEN_STEPS.length - 1 ? prev + 1 : prev);
    }, 3500);

    try {
      const styleObj = STYLES.find(s => s.id === selectedStyle);
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: images.map(img => img.split(',')[1] || img),
          style: styleObj?.label,
          customPrompt,
        }),
      });

      clearInterval(interval);

      if (response.status === 429) {
        const err = await response.json();
        setError(err.error);
        setStep('style');
        return;
      }
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '오류가 발생했습니다');
      }

      const data = await response.json();
      setResult(data);
      setUsedCount(DAILY_LIMIT - (data.remaining ?? 0));
      setStep('result');
    } catch (err: unknown) {
      clearInterval(interval);
      setError(err instanceof Error ? err.message : '오류가 발생했습니다. 다시 시도해주세요.');
      setStep('style');
    }
  };

  const reset = () => {
    setStep('upload'); setImages([]); setSelectedStyle('');
    setCustomPrompt(''); setResult(null); setError(''); setGenStep(0);
  };

  const remaining = result ? result.remaining : DAILY_LIMIT - usedCount;

  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF' }}>

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #EBEBEB',
        padding: '0 40px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: '60px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span className="font-serif" style={{ fontSize: '20px', fontStyle: 'italic', color: '#111' }}>Interia</span>
          <span style={{ fontSize: '11px', letterSpacing: '0.12em', color: '#BBBBBB', textTransform: 'uppercase' }}>AI Studio</span>
        </div>

        {step !== 'generating' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: i <= currentStepIdx ? 1 : 0.35 }}>
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: i < currentStepIdx ? '#2D6A4F' : i === currentStepIdx ? '#111' : '#EBEBEB',
                    color: i <= currentStepIdx ? 'white' : '#888',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', fontWeight: 500,
                  }}>
                    {i < currentStepIdx ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: '12px', color: i === currentStepIdx ? '#111' : '#888' }}>{s}</span>
                </div>
                {i < STEPS.length - 1 && <div style={{ width: '20px', height: '1px', background: '#EBEBEB', margin: '0 2px' }} />}
              </div>
            ))}
          </div>
        )}

        {/* 하루 사용 횟수 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '5px 12px', borderRadius: '100px',
            background: '#F8F8F6', border: '1px solid #EBEBEB',
            fontSize: '12px', color: '#888',
          }}>
            {[...Array(DAILY_LIMIT)].map((_, i) => (
              <div key={i} style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: i < remaining ? '#2D6A4F' : '#EBEBEB',
                transition: 'background 0.3s',
              }} />
            ))}
            <span style={{ marginLeft: '4px' }}>오늘 {remaining}회 남음</span>
          </div>
          {step === 'result' && (
            <button className="btn-secondary" onClick={reset} style={{ padding: '7px 18px', fontSize: '13px' }}>
              새로 시작
            </button>
          )}
        </div>
      </header>

      <main style={{ maxWidth: '680px', margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* ── STEP 1: UPLOAD ── */}
        {step === 'upload' && (
          <div className="fade-up">
            <div style={{ textAlign: 'center', marginBottom: '48px' }}>
              <h1 className="font-serif" style={{ fontSize: '40px', lineHeight: 1.15, color: '#111', marginBottom: '14px' }}>
                당신의 공간을<br /><em>새롭게</em> 상상하다
              </h1>
              <p style={{ fontSize: '15px', color: '#888', lineHeight: 1.6 }}>
                방 사진을 올리면 AI가 원하는 스타일의 인테리어로 바꿔드립니다
              </p>
              <p style={{ fontSize: '13px', color: '#BBB', marginTop: '8px' }}>
                하루 {DAILY_LIMIT}회 무료 · 회원가입 불필요
              </p>
            </div>

            <div
              className={`upload-area fade-up-1 ${dragOver ? 'drag' : ''}`}
              style={{ padding: images.length === 0 ? '64px 24px' : '20px', textAlign: 'center', marginBottom: '24px' }}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
            >
              {images.length === 0 ? (
                <>
                  <div style={{ fontSize: '36px', marginBottom: '14px' }}>↑</div>
                  <p style={{ fontSize: '16px', fontWeight: 500, color: '#111', marginBottom: '6px' }}>
                    방 사진을 드래그하거나 클릭하세요
                  </p>
                  <p style={{ fontSize: '13px', color: '#BBB' }}>JPG, PNG · 최대 4장</p>
                </>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  {images.map((img, i) => (
                    <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: '10px', overflow: 'hidden' }}>
                      <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button
                        onClick={e => { e.stopPropagation(); setImages(p => p.filter((_, idx) => idx !== i)); }}
                        style={{
                          position: 'absolute', top: '5px', right: '5px',
                          width: '22px', height: '22px', borderRadius: '50%',
                          background: 'rgba(0,0,0,0.55)', color: 'white',
                          border: 'none', cursor: 'pointer', fontSize: '12px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >×</button>
                    </div>
                  ))}
                  {images.length < 4 && (
                    <div style={{
                      aspectRatio: '1', borderRadius: '10px',
                      border: '1.5px dashed #EBEBEB',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#BBB', fontSize: '22px',
                    }}>+</div>
                  )}
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => e.target.files && processFiles(e.target.files)} />
            </div>

            {images.length > 0 && (
              <div className="fade-up-2" style={{ textAlign: 'center' }}>
                <button className="btn-primary" onClick={() => setStep('style')}>다음 단계 →</button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: STYLE ── */}
        {step === 'style' && (
          <div className="fade-up">
            <div style={{ marginBottom: '36px' }}>
              <h2 className="font-serif" style={{ fontSize: '32px', color: '#111', marginBottom: '8px' }}>
                원하는 스타일은<br /><em>무엇인가요?</em>
              </h2>
              <p style={{ fontSize: '14px', color: '#888' }}>사진 {images.length}장을 바탕으로 인테리어를 변환합니다</p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '28px' }}>
              {STYLES.map(s => (
                <button key={s.id} className={`style-pill ${selectedStyle === s.id ? 'active' : ''}`} onClick={() => setSelectedStyle(s.id)}>
                  <span>{s.emoji}</span><span>{s.label}</span>
                </button>
              ))}
            </div>

            <div style={{ marginBottom: '28px' }}>
              <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '8px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                추가 요청 <span style={{ color: '#CCC' }}>(선택)</span>
              </label>
              <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                placeholder="예: 창가에 식물 배치, 따뜻한 조명, 원목 바닥..." rows={3} style={{ resize: 'none' }} />
            </div>

            {error && (
              <div style={{ padding: '12px 16px', borderRadius: '10px', marginBottom: '20px', background: '#FEF2F2', color: '#DC2626', fontSize: '14px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-secondary" onClick={() => setStep('upload')}>← 이전</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleGenerate} disabled={!selectedStyle}>
                AI 인테리어 생성 ✦
              </button>
            </div>
          </div>
        )}

        {/* ── GENERATING ── */}
        {step === 'generating' && (
          <div className="fade-up" style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: '#F5FAF7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 28px', fontSize: '28px',
            }}>🏡</div>
            <h2 className="font-serif" style={{ fontSize: '28px', color: '#111', marginBottom: '8px' }}>
              인테리어를 <em>그리는 중</em>
            </h2>
            <p style={{ fontSize: '14px', color: '#888', marginBottom: '48px' }}>보통 30~60초 정도 걸립니다</p>
            <div style={{ maxWidth: '320px', margin: '0 auto', textAlign: 'left' }}>
              {GEN_STEPS.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px',
                  opacity: i <= genStep ? 1 : 0.3, transition: 'opacity 0.4s ease',
                }}>
                  <div className={`step-dot ${i < genStep ? 'done' : i === genStep ? 'active' : 'pending'}`}>
                    {i < genStep ? '✓' : i === genStep
                      ? <span className="spinner" style={{ width: '14px', height: '14px', border: '1.5px solid #444', borderTopColor: 'white' }} />
                      : i + 1}
                  </div>
                  <span style={{ fontSize: '14px', color: i <= genStep ? '#111' : '#BBB' }}>{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── RESULT ── */}
        {step === 'result' && result && (
          <div className="fade-up">
            <div style={{ marginBottom: '36px' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '4px 12px', borderRadius: '100px',
                background: '#D8EFE5', color: '#2D6A4F',
                fontSize: '12px', fontWeight: 500, marginBottom: '16px',
              }}>✦ 완성</div>
              <h2 className="font-serif" style={{ fontSize: '32px', color: '#111', marginBottom: '8px' }}>
                인테리어 시뮬레이션
              </h2>
              <p style={{ fontSize: '14px', color: '#888', lineHeight: 1.6 }}>{result.analysis.styleDescription}</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              {[{ label: 'Before', img: images[0], accent: false }, { label: 'After', img: result.generatedImageUrl, accent: true }].map(({ label, img, accent }) => (
                <div key={label}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent ? '#2D6A4F' : '#888' }}>{label}</span>
                    {accent && <span style={{ fontSize: '12px' }}>✦</span>}
                  </div>
                  <div style={{ borderRadius: '14px', overflow: 'hidden', aspectRatio: '4/3' }}>
                    <img src={img} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: '16px 20px', borderRadius: '12px', background: '#F8F8F6', border: '1px solid #EBEBEB', marginBottom: '40px' }}>
              <span style={{ fontSize: '12px', color: '#BBB', display: 'block', marginBottom: '4px' }}>AI 분석</span>
              <p style={{ fontSize: '14px', color: '#444', lineHeight: 1.6 }}>{result.analysis.currentFeatures}</p>
            </div>

            {result.furniture.length > 0 && (
              <div style={{ marginBottom: '40px' }}>
                <h3 className="font-serif" style={{ fontSize: '24px', color: '#111', marginBottom: '20px' }}>추천 가구 & 소품</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {result.furniture.map((item, i) => (
                    <div key={i} className="furniture-item fade-up" style={{ animationDelay: `${i * 0.04}s`, opacity: 0 }}>
                      <div style={{ fontSize: '11px', color: '#2D6A4F', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>{item.category}</div>
                      <div style={{ fontSize: '14px', fontWeight: 500, color: '#111', marginBottom: '6px' }}>{item.name}</div>
                      <p style={{ fontSize: '13px', color: '#888', lineHeight: 1.55, marginBottom: '10px' }}>{item.description}</p>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#2D6A4F', marginBottom: '10px' }}>{item.priceRange}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {item.searchLinks.map((link, j) => (
                          <a key={j} href={link.url} target="_blank" rel="noopener noreferrer" className="shop-tag">{link.site} →</a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 남은 횟수 안내 */}
            {result.remaining === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', borderRadius: '12px', background: '#FEF2F2', marginBottom: '24px' }}>
                <p style={{ fontSize: '14px', color: '#DC2626' }}>오늘 사용 한도를 모두 사용했습니다. 내일 다시 시도해주세요.</p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <p style={{ fontSize: '13px', color: '#BBB' }}>오늘 {result.remaining}회 더 사용할 수 있습니다</p>
              </div>
            )}

            <div style={{ textAlign: 'center' }}>
              <button className="btn-primary" onClick={reset} disabled={result.remaining === 0}>
                다른 방 시뮬레이션하기
              </button>
            </div>
          </div>
        )}
      </main>

      <footer style={{ textAlign: 'center', padding: '24px', borderTop: '1px solid #EBEBEB', fontSize: '12px', color: '#CCC' }}>
        Interia · Powered by Claude & DALL-E 3 · 하루 {DAILY_LIMIT}회 무료
      </footer>
    </div>
  );
}
