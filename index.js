var request = require('request')
var Canvas = require('canvas')
var async = require('async')
var fs = require('fs')
var moment = require('moment')
var path = require('path')
var format = require('util').format
var restify = require('restify')
var cdnify = require('./upload')

const CDN_HOST = 'http://7xpbf9.com2.z0.glb.qiniucdn.com/'
const SIZE = 550
const SPLITS = 4

var PATH = path.join(__dirname, 'images')

var latestImageLocation = ''

try {
  fs.accessSync(PATH)
} catch (e) {
  fs.mkdirSync(PATH)
}

var get = function (time, x, y, callback) {
  var formattedTime = time.format('YYYY/MM/DD/HHmmss')
  var url = `http://himawari8-dl.nict.go.jp/himawari8/img/D531106/${SPLITS}d/${SIZE}/${formattedTime}_${x}_${y}.png`

  return request.get(url, { encoding: null }, function (err, res, body) {
    callback(err, body)
  })
}

var createImage = function (buffer) {
  var image = new Canvas.Image
  image.src = buffer
  return image
}

var fetch = function () {
  var time = moment()
  time.subtract(30, 'minutes')
  time.subtract(time.utcOffset(), 'minutes')
  time.subtract(time.minute() % 10, 'minutes')
  time.second(0)

  var requests = []

  for (var x = 0; x < SPLITS; x++) {
    for (var y = 0; y < SPLITS; y++) {
      requests.push(async.apply(get, time, x, y))
    }
  }

  var readableTime = time.format('YYYY/MM/DD/HH:mm:ss')

  async.parallel(requests, function (err, results) {
    if (err) {
      console.error('failed to fetch images %s', readableTime)
      console.error(err.trace)
      return
    }

    var canvas = new Canvas(SIZE * SPLITS, SIZE * SPLITS)
    var ctx = canvas.getContext('2d')

    for (var x = 0; x < SPLITS; x++) {
      for (var y = 0; y < SPLITS; y++) {
        try {
          ctx.drawImage(createImage(results.shift()), x * SIZE, y * SIZE, SIZE, SIZE)
        } catch (err) {
          console.error('failed to compose images %s %s:%s', readableTime, x, y)
          console.error(err.stack)
          return
        }
      }
    }

    var output = format('%s.png', +new Date())

    console.log('done fetching %s, saved as %s', readableTime, output)

    canvas.createPNGStream().pipe(fs.createWriteStream(path.join(PATH, output)))

    cdnify(output, path.join(PATH, output))
     .then(reply => {
       console.log('uploaded to qiniu, key: %s, hash: %s, at %s', reply.key, reply.hash, new Date())
       latestImageLocation = CDN_HOST + reply.key
     })
     .catch(err => {
       console.error(err)
       console.error(err.stack)
     })

    var clean = moment().subtract(7, 'minutes')

    fs.readdirSync(PATH).forEach(function (file) {
      if ('.png' != path.extname(file)) {
        return
      }

      var time = parseInt(path.basename(file, '.png'))

      if (isNaN(time)) {
        return
      }

      time = moment(time)

      if (time.isAfter(clean)) {
        return
      }

      fs.unlinkSync(path.join(PATH, file))

      console.log('cleaned file %s fetched %s', file, time.fromNow())
    })
  })
}

setInterval(fetch, moment.duration(5, 'minutes').as('milliseconds'))

fetch()

var app = restify.createServer()

app.get('/latest', (req, res) => {
  if (latestImageLocation === '') {
    res.send({
      type: 'Error',
      data: [{
        code: 404,
        message: 'No image at present.'
      }]
    })
  } else {
    res.send({
      type: 'ImageURL',
      data: [ latestImageLocation ]
    })
  }
})

app.listen(3000, () => {
  console.log('server listening at 3000')
})
