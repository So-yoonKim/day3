// 에이전트: Gemini 가 find_spots · get_weather 를 스스로 골라 부르고, 결과를 보고 다시 판단한다 (최대 5번)
// 열쇠는 환경변수 GEMINI_API_KEY 에서만 읽는다. 없으면 연습 모드(규칙)로 같은 모양의 답을 만든다.
const { runTool, geminiTools } = require('./tools');

const MODEL = 'gemini-3.8-flash';
const MAX_TURNS = 5;

const SYSTEM = [
  '너는 제주 여행 추천 도우미야.',
  '장소는 반드시 find_spots 결과에서만 골라. 목록 밖 장소는 없다고 말해.',
  '날씨가 중요한 질문이면 get_weather 를 불러. 강수확률이 60% 이상이면 실내 위주로 추천해.',
  '도구가 실패하면(ok:false) 모른다고 솔직히 말하고 숫자를 지어내지 마.',
  '답은 한국어로, 추천 장소와 그 이유, 날씨 근거를 짧게 말해.',
].join('\n');

const stepText = (name, args, result) => {
  if (name === 'get_weather') {
    return result.ok
      ? `날씨 보기 — ${args.area} ${args.day} 강수확률 ${result.rain_probability}% (${result.source})`
      : `날씨 보기 — 실패 (${result.note})`;
  }
  const cond = args.indoor === undefined ? '' : args.indoor ? ' · 실내' : ' · 야외';
  return result.ok
    ? `장소 찾기 — ${args.area}${cond} ${result.total}곳 중 ${result.spots.length}곳`
    : `장소 찾기 — 실패 (${result.note})`;
};

async function callGemini(contents) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    tools: geminiTools,
    generationConfig: { thinkingConfig: { thinkingLevel: 'low' } }, // 생각 시간을 줄여 빠르게
  });
  // 503(사용량 몰림) · 429(한도)는 잠깐 뒤 다시 시도한다 (최대 3번)
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body,
      }
    );
    if (res.ok) return res.json();
    if ((res.status === 503 || res.status === 429) && attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
      continue;
    }
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function runGemini(question) {
  const contents = [{ role: 'user', parts: [{ text: question }] }];
  const steps = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const data = await callGemini(contents);
    const content = data.candidates?.[0]?.content;
    if (!content) throw new Error('Gemini 가 답을 주지 않았어요');
    const calls = (content.parts || []).filter((p) => p.functionCall);

    if (calls.length === 0) {
      const answer = (content.parts || []).map((p) => p.text || '').join('');
      return { mode: 'gemini', answer, steps };
    }

    contents.push(content); // 도구 요청을 그대로 이어 붙인다
    const responses = [];
    for (const { functionCall } of calls) {
      const result = await runTool(functionCall.name, functionCall.args);
      steps.push({ kind: 'find', text: stepText(functionCall.name, functionCall.args, result) });
      responses.push({ functionResponse: { name: functionCall.name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { mode: 'gemini', answer: '도구를 너무 많이 불러서 멈췄어요. 질문을 조금 더 구체적으로 해 주세요.', steps };
}

// 연습 모드: 키가 없을 때 find_spots → get_weather → 규칙 판단
async function runPractice(question) {
  const area = ['동쪽', '서쪽', '서귀포', '제주시'].find((a) => question.includes(a)) || '제주시';
  const day = question.includes('내일') ? '내일' : '오늘';
  const steps = [];

  const weather = await runTool('get_weather', { area, day });
  steps.push({ kind: 'find', text: stepText('get_weather', { area, day }, weather) });

  const rainy = weather.ok && weather.rain_probability >= 60;
  const args = rainy ? { area, indoor: true } : { area };
  const found = await runTool('find_spots', args);
  steps.push({ kind: 'find', text: stepText('find_spots', args, found) });

  const judge = !weather.ok
    ? '날씨를 가져오지 못해서 날씨와 상관없이 골랐어요.'
    : rainy
    ? `${day} 강수확률 ${weather.rain_probability}% 라서 실내 위주로 골랐어요.`
    : `${day} 강수확률 ${weather.rain_probability}% 라서 야외도 괜찮아요.`;
  steps.push({ kind: 'judge', text: judge });

  const list = found.ok ? found.spots.slice(0, 5).map((s) => `- ${s.name} (${s.area}, ${s.indoor ? '실내' : '야외'}, ${s.description})`) : [];
  return { mode: 'practice', answer: `${judge}\n${list.join('\n') || '조건에 맞는 장소를 찾지 못했어요.'}`, steps };
}

module.exports = async (req, res) => {
  const question = (req.method === 'POST' ? req.body?.question : req.query.question) || '';
  if (!question.trim()) return res.status(400).json({ error: '질문을 입력해 주세요' });
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(200).json(await runPractice(question));
    try {
      res.status(200).json(await runGemini(question));
    } catch (e) {
      // Gemini 가 계속 실패하면 오류 대신 연습 모드(규칙)로 답한다
      const out = await runPractice(question);
      res.status(200).json({ ...out, note: `Gemini 가 지금 응답하지 못해 연습 모드로 답했어요 (${String(e.message).slice(0, 80)})` });
    }
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
