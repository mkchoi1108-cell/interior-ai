import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const DAILY_LIMIT = 3;

// KV-based rate limiting (works on Vercel with KV addon)
async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  // Try Vercel KV first
  try {
    const { kv } = await import('@vercel/kv');
    const today = new Date().toISOString().split('T')[0];
    const key = `interia:${ip}:${today}`;
    const count = await kv.incr(key);
    if (count === 1) {
      await kv.expireat(key, Math.floor(new Date(today + 'T23:59:59Z').getTime() / 1000) + 86400);
    }
    return {
      allowed: count <= DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - count),
      resetAt: '내일 자정',
    };
  } catch {
    // KV not configured (local dev) — allow all
    return { allowed: true, remaining: DAILY_LIMIT, resetAt: '내일 자정' };
  }
}

function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

export async function POST(req: NextRequest) {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!anthropicKey || !openaiKey) {
      return NextResponse.json({ error: 'Server API keys not configured' }, { status: 500 });
    }

    // Rate limit check
    const ip = getIP(req);
    const { allowed, remaining } = await checkRateLimit(ip);

    if (!allowed) {
      return NextResponse.json(
        { error: `오늘 사용 한도(${DAILY_LIMIT}회)를 초과했습니다. 내일 다시 시도해주세요.`, rateLimited: true },
        { status: 429 }
      );
    }

    const { images, style, customPrompt } = await req.json();

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const openai = new OpenAI({ apiKey: openaiKey });

    // Step 1: Claude analyzes room
    const analysisResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          ...images.map((img: string) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: img },
          })),
          {
            type: 'text',
            text: `인테리어 전문가입니다. 이 방 사진을 분석하고 DALL-E 3 프롬프트를 만들어주세요.

스타일: ${style}
${customPrompt ? `추가 요청: ${customPrompt}` : ''}

JSON으로만 응답:
{
  "roomType": "방 종류",
  "currentFeatures": "현재 방 특징 (한국어)",
  "dallePrompt": "DALL-E 3 영어 프롬프트 (200자 이상, 매우 구체적)",
  "styleDescription": "스타일 설명 (한국어 2-3문장)"
}`,
          },
        ],
      }],
    });

    const analysisText = analysisResponse.content[0].type === 'text' ? analysisResponse.content[0].text : '';
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!analysis) return NextResponse.json({ error: '방 분석에 실패했습니다' }, { status: 500 });

    // Step 2: DALL-E 3 generates image
    const imageResponse = await openai.images.generate({
      model: 'dall-e-3',
      prompt: `Interior design photo, professional architectural photography, ${analysis.dallePrompt}. Photorealistic, high quality, well-lit, Architectural Digest style.`,
      size: '1024x1024',
      quality: 'hd',
      n: 1,
    });
    const generatedImageUrl = imageResponse.data?.[0]?.url;

    // Step 3: Claude recommends furniture
    const furnitureResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `"${style}" 스타일의 ${analysis.roomType}에 맞는 가구 6개를 추천해주세요.

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
    });

    const furnitureText = furnitureResponse.content[0].type === 'text' ? furnitureResponse.content[0].text : '';
    const fMatch = furnitureText.match(/\{[\s\S]*\}/);
    const furniture = fMatch ? JSON.parse(fMatch[0]) : { items: [] };

    return NextResponse.json({
      generatedImageUrl,
      analysis,
      furniture: furniture.items || [],
      remaining,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
