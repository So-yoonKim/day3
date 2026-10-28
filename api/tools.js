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

// Claude Messages API 의 tools 에 그대로 넘기는 도구 설명
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
];

// 도구 이름으로 실행
const tools = { find_spots };
const runTool = (name, input) =>
  tools[name] ? tools[name](input) : { ok: false, note: `알 수 없는 도구: ${name}` };

module.exports = { find_spots, toolDefinitions, runTool };
