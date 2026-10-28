// 브라우저(map.html)가 find_spots 를 부르는 입구: /api/find-spots?area=동쪽&indoor=true
const { find_spots } = require('./tools');

module.exports = (req, res) => {
  const { area, indoor } = req.query;
  res.status(200).json(
    find_spots({ area, indoor: indoor === undefined || indoor === '' ? undefined : indoor === 'true' })
  );
};
