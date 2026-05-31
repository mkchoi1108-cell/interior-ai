import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Modality } from '@google/genai';

const DAILY_LIMIT = 3;

async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const { kv } = await import('@vercel/kv');
    const today = new Date().toISOString().split('T')[0];
    const key = `interia:${ip}:${today}`;
    const count = await kv.incr(key);
    if (count === 1) {
      await kv.expireat(key, Math.floor(new Date(today + 'T23:59:59Z').getTime() / 1000) + 86400);
    }
    return { allowed: count <= DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - count) };
  } catch {
    return { allowed: true, remaining: DAILY_LIMIT };
  }
}

function getIP(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
}

async function fetchUnsplashPhotos(query: string, accessKey: string): Promise<{ url: string; photographer: string; profileUrl: string }[]> {
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${accessKey}` } }
    );
    const data = await res.json();
    return (data.results || []).map((p: { urls: { regular: string }; user: { name: string; links: { html: string } } }) => ({
      url: p.urls.regular,
      photographer: p.user.name,
      profileUrl: p.user.links.html,
    }));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Server API key not configured' }, { status: 500 });

    const ip = getIP(req);
    const { allowed, remaining } = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: `오늘 사용 한도(${DAILY_LIMIT}회)를 초과했습니다. 내일 다시 시도해주세요.`, rateLimited: true },
        { status: 429 }
      );
    }

    const { images, style, customPrompt, squareMeters } = await req.json();
    const ai = new GoogleGenAI({ apiKey });

    // Step 1: Gemini 방 분석 + 평면도 + 강화된 프롬프트
    const analysisParts = [
      ...images.map((img: string) => ({
        inlineData: { mimeType: 'image/jpeg', data: img },
      })),
      {
        text: `당신은 세계적인 인테리어 디자이너입니다. 이 방 사진을 정밀 분석해주세요.

스타일: ${style}
방 크기: ${squareMeters ? `${squareMeters}평 (약 ${Math.round(squareMeters * 3.3)}㎡)` : '미입력'}
${customPrompt ? `추가 요청: ${customPrompt}` : ''}

JSON으로만 응답 (다른 텍스트 없이):
{
  "roomType": "방 종류 (예: living room, bedroom)",
  "roomTypeKo": "방 종류 한국어",
  "currentFeatures": "현재 방 특징 (한국어 2-3문장, 구체적으로)",
  "imagePrompt": "FLUX/Gemini 이미지 생성용 영어 프롬프트. 반드시 포함: 1) 스타일 키워드 2) 조명 묘사 3) 재질/텍스처 4) 색상 팔레트 5) 카메라 앵글. 예시처럼 구체적으로: 'A serene Scandinavian living room with warm oak hardwood floors, white linen sofa with chunky knit throw, floor-to-ceiling linen curtains filtering golden afternoon light, concrete coffee table, minimalist pendant lamp, monstera plant in terracotta pot, soft shadow play on textured white walls, shot from corner angle at eye level, Architectural Digest editorial photography, 8K hyperrealistic'",
  "styleDescription": "스타일 설명 (한국어 2-3문장, 감성적으로)",
  "floorPlanSvg": "간단한 SVG 평면도 코드. viewBox='0 0 300 300'. 방의 벽(rect/line), 창문, 문, 주요 가구(소파/침대/테이블 등) 위치를 표시. 가구에 한국어 레이블 포함. SVG 태그만 반환.",
  "furniturePlacement": [
    {"item": "가구명", "position": "배치 위치 설명 (예: 북쪽 벽면 중앙)", "reason": "배치 이유 한 문장"}
  ]
}`,
      },
    ];

    const analysisResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: [{ role: 'user', parts: analysisParts }],
    });

    const analysisText = analysisResponse.text ?? '';
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!analysis) return NextResponse.json({ error: '방 분석에 실패했습니다' }, { status: 500 });

    // Step 2: 이미지 생성 (강화된 프롬프트)
    const enhancedPrompt = `${analysis.imagePrompt}, ultra-detailed, photorealistic, 8K resolution, professional interior photography, perfect lighting, sharp focus, no people, clean and styled`;

    const imageResponse = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image',
      contents: [{
        role: 'user',
        parts: [{ text: enhancedPrompt }],
      }],
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    let generatedImageBase64 = '';
    for (const part of imageResponse.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.mimeType?.startsWith('image/')) {
        generatedImageBase64 = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        break;
      }
    }

    if (!generatedImageBase64) {
      return NextResponse.json({ error: '이미지 생성에 실패했습니다. 다시 시도해주세요.' }, { status: 500 });
    }

    // Step 3: 가구 추천
    const furnitureResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: [{
        role: 'user',
        parts: [{
          text: `"${style}" 스타일의 ${analysis.roomTypeKo}${squareMeters ? ` (${squareMeters}평)` : ''}에 맞는 가구 6개를 추천해주세요.
${squareMeters ? `평수를 고려해 크기가 적합한 제품을 추천하세요.` : ''}

JSON으로만 응답:
{
  "items": [
    {
      "category": "카테고리",
      "name": "제품명",
      "description": "추천 이유 (1-2문장, 평수와 스타일 연관지어)",
      "priceRange": "가격대 (예: 15-30만원)",
      "searchLinks": [
        {"site": "오늘의집", "url": "https://ohou.se/search?query=검색어"},
        {"site": "IKEA", "url": "https://www.ikea.com/kr/ko/search/?q=검색어"},
        {"site": "무신사", "url": "https://store.musinsa.com/app/search?q=검색어"}
      ]
    }
  ]
}`,
        }],
      }],
    });

    const furnitureText = furnitureResponse.text ?? '';
    const fMatch = furnitureText.match(/\{[\s\S]*\}/);
    const furniture = fMatch ? JSON.parse(fMatch[0]) : { items: [] };

    // Step 4: Unsplash 예시 사진
    const styleQueryMap: Record<string, string> = {
      '북유럽': 'scandinavian interior design',
      '코지 웜': 'cozy warm interior living room',
      '화이트앤우드': 'white wood minimal interior',
      '프렌치 빈티지': 'french vintage interior design',
      '모던 미니멀': 'modern minimal interior',
      '재팬디': 'japandi interior design',
      '인더스트리얼': 'industrial loft interior',
      '보헤미안': 'bohemian eclectic interior',
    };
    const unsplashQuery = styleQueryMap[style] || `${style} interior design`;
    const inspirationPhotos = unsplashKey
      ? await fetchUnsplashPhotos(unsplashQuery, unsplashKey)
      : [];

    return NextResponse.json({
      generatedImageUrl: generatedImageBase64,
      analysis,
      furniture: furniture.items || [],
      inspirationPhotos,
      remaining,
    });

  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
