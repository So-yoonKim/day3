// AI 가 부를 수 있는 도구 모음 — 지금은 find_spots 하나
const fs = require('fs');
const path = require('path');

const AREAS = ['동쪽', '서쪽', '서귀포', '제주시'];
const MAX_SPOTS = 8;

const loadSpots = () => {
  const file = path.join(__dirname, '..', 'jeju_spots.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).spots;
};

// 목록의 area 는 '동쪽(성산)' 처럼 읍면이 붙어 있어서, 앞부분이 같으면 같은 지역으로 본다.
const inArea = (spotArea, area) => spotArea === area || spotArea.startsWith(area + '(');

const find_spots = ({ area, indoor } = {}) => {
  if (!AREAS.includes(area)) {
    return { ok: false, note: `area 는 ${AREAS.join(' · ')} 중 하나여야 해요` };
  }
  const found = loadSpots()
    .filter((s) => inArea(s.area, area))
    .filter((s) => indoor === undefined || s.indoor === indoor);

  return {
    ok: true,
    total: found.length,
    spots: found.slice(0, MAX_SPOTS).map((s) => ({
      name: s.name,
      area: s.area,
      indoor: s.indoor,
      description: s.type,
    })),
  };
};

// Open-Meteo 로 지역의 오늘/내일 예보를 가져온다 (키 없음)
const AREA_POINT = {
  동쪽: [33.4585, 126.94],
  서쪽: [33.415, 126.265],
  서귀포: [33.253, 126.56],
  제주시: [33.5, 126.53],
};

const get_weather = async ({ area, day } = {}) => {
  if (!AREA_POINT[area] || !['오늘', '내일'].includes(day)) {
    return { ok: false, note: 'area 는 동쪽 · 서쪽 · 서귀포 · 제주시, day 는 오늘 · 내일 이어야 해요' };
  }
  const [lat, lon] = AREA_POINT[area];
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min' +
    '&timezone=Asia%2FSeoul&forecast_days=2';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const d = (await res.json()).daily;
    const i = day === '오늘' ? 0 : 1;
    return {
      ok: true,
      area,
      day,
      date: d.time[i],
      rain_probability: d.precipitation_probability_max[i],
      temp_max: d.temperature_2m_max[i],
      temp_min: d.temperature_2m_min[i],
      source: 'Open-Meteo 예보',
    };
  } catch (e) {
    return { ok: false, note: '날씨를 가져오지 못했어요' };
  }
};

// 도구 설명 (name · description · input_schema)
const toolDefinitions = [
  {
    name: 'find_spots',
    description:
      '제주 관광지 목록(jeju_spots.json)에서 지역과 실내/야외 조건에 맞는 장소를 최대 8곳 찾아 ' +
      '이름 · 지역 · 실내 여부 · 설명을 돌려준다. 이 목록 밖의 장소는 없다 — ' +
      '결과에 없는 장소는 추천하거나 지어내지 말고, 없다고 말한다.',
    input_schema: {
      type: 'object',
      properties: {
        area: {
          type: 'string',
          enum: AREAS,
          description: '찾을 지역',
        },
        indoor: {
          type: 'boolean',
          description: 'true 면 실내만, false 면 야외만. 생략하면 둘 다.',
        },
      },
      required: ['area'],
    },
  },
  {
    name: 'get_weather',
    description:
      'Open-Meteo 예보로 제주 지역의 오늘 또는 내일 강수확률(%) · 최고/최저 기온을 알려준다. ' +
      '실패하면 ok:false 를 돌려주니, 그때는 날씨를 모른다고 말하고 숫자를 지어내지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        area: { type: 'string', enum: AREAS, description: '날씨를 볼 지역' },
        day: { type: 'string', enum: ['오늘', '내일'], description: '볼 날짜' },
      },
      required: ['area', 'day'],
    },
  },
];

// Gemini 는 type 을 대문자(OBJECT, STRING ...)로 받는다 → 같은 설명을 Gemini 모양으로 바꿈
const upperTypes = (schema) => {
  const out = { ...schema, type: schema.type.toUpperCase() };
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, upperTypes(v)])
    );
  }
  return out;
};
const geminiTools = [
  {
    functionDeclarations: toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: upperTypes(t.input_schema),
    })),
  },
];

// 도구 이름으로 실행 (get_weather 가 비동기라 항상 await 로 부른다)
const tools = { find_spots, get_weather };
const runTool = async (name, input) =>
  tools[name] ? tools[name](input) : { ok: false, note: `알 수 없는 도구: ${name}` };

module.exports = { find_spots, get_weather, toolDefinitions, geminiTools, runTool };
