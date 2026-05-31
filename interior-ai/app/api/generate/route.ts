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

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Server API key not configured' }, { status: 500 });

    const ip = getIP(req);
    const { allowed, remaining } = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: `오늘 사용 한도(${DAILY_LIMIT}회)를 초과했습니다. 내일 다시 시도해주세요.`, rateLimited: true },
        { status: 429 }
      );
    }

    const { images, style, customPrompt } = await req.json();
    const ai = new GoogleGenAI({ apiKey });

    // Step 1: Gemini 1.5 Flash로 방 분석
    const analysisParts = [
      ...images.map((img: string) => ({
        inlineData: { mimeType: 'image/jpeg', data: img },
      })),
      {
        text: `인테리어 전문가입니다. 이 방 사진을 분석하고 이미지 생성 프롬프트를 만들어주세요.

스타일: ${style}
${customPrompt ? `추가 요청: ${customPrompt}` : ''}

JSON으로만 응답 (다른 텍스트 없이):
{
  "roomType": "방 종류",
  "currentFeatures": "현재 방 특징 (한국어 1-2문장)",
  "imagePrompt": "이미지 생성용 영어 프롬프트 (200자 이상, 매우 구체적, photorealistic interior design photo 포함)",
  "styleDescription": "스타일 설명 (한국어 2-3문장)"
}`,
      },
    ];

    const analysisResponse = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [{ role: 'user', parts: analysisParts }],
    });

    const analysisText = analysisResponse.text ?? '';
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!analysis) return NextResponse.json({ error: '방 분석에 실패했습니다' }, { status: 500 });

    // Step 2: Gemini로 인테리어 이미지 생성
    const imageResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: [{
        role: 'user',
        parts: [{ text: `${analysis.imagePrompt}. High quality photorealistic interior design, professional photography, architectural digest style, well-lit, detailed.` }],
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

    // Step 3: Gemini 1.5 Flash로 가구 추천
    const furnitureResponse = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [{
        role: 'user',
        parts: [{
          text: `"${style}" 스타일의 ${analysis.roomType}에 맞는 가구 6개를 추천해주세요.

JSON으로만 응답 (다른 텍스트 없이):
{
  "items": [
    {
      "category": "카테고리",
      "name": "제품명",
      "description": "추천 이유 1-2문장",
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

    return NextResponse.json({
      generatedImageUrl: generatedImageBase64,
      analysis,
      furniture: furniture.items || [],
      remaining,
    });

  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
