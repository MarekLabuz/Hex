const redis = require('redis')
const bluebird = require('bluebird')
const uuid = require('uuid')
const mapFile = require('./static/map.json')

bluebird.promisifyAll(redis.RedisClient.prototype)
bluebird.promisifyAll(redis.Multi.prototype)
const client = redis.createClient(process.env.REDIS_URL)
const lock = require('redis-lock')(client)

client.on('connect', async () => {
  await client.flushall()
  console.log('Redis databases cleared')
  await client.select(1)
  await Promise.all(mapFile.map(async (hex) => { await client.setAsync(hex.id, JSON.stringify(hex)) }))
  console.log('Map inserted into redis')
})

let buffer = []
const battles = {}

const getBuffer = () => buffer
const clearBuffer = () => {
  buffer = []
}

const randomColor = () => {
  const number = Math.floor(Math.random() * 16777215) + 1
  return number.toString(16)
}

// redis databases
// 0 - user
// 1 - hex

async function getMap (req, res) {
  try {
    await client.select(1)
    const mapKeys = await client.keysAsync('*')
    const map = {}
    for (const key in mapKeys) { // eslint-disable-line
      map[key] = JSON.parse(await client.getAsync(key)) // eslint-disable-line
    }
    res.json(map)
  } catch (err) {
    res.status(500).json([])
  }
}

// async function generateArmy (player, hex) {
//   lock('armyAccess', async (done) => {
//     hex.army += hex.army <= 90 ? 10 : 100 - hex.army
//
//     buffer.push({
//       type: 'CHANGE_HEX_ARMY_VALUE',
//       payload: { player, hexId: hex.id, armyValue: hex.army }
//     })
//     // res.send(playerId)
//
//     done()
//   })
// }

async function generateArmy (req, res) {
  let player = null
  let hex = null
  lock('armyAccess', async (done) => {
    const { name, hexId } = req.query
    const playerId = uuid.v4()
    player = { id: playerId, name, color: randomColor() }
    try {
      await client.select(0)
      await client.setAsync(playerId, JSON.stringify(player))

      await client.select(1)
      hex = JSON.parse(await client.getAsync(hexId))
      if (!hex.castle) {
        throw new Error('You need to choose a castle')
      }
      if (hex.owner) {
        throw new Error('This field is already taken')
      }
      hex.owner = player
      hex.army += hex.army <= 90 ? 10 : 100 - hex.army

      await Promise.all([
        client.setAsync(hexId, JSON.stringify(hex))
      ])

      buffer.push({ type: 'PLAYER_REGISTERED', payload: { hexId, player } })
      buffer.push({
        type: 'CHANGE_HEX_ARMY_VALUE',
        payload: { player, hexId: hex.id, armyValue: hex.army }
      })
      res.send(playerId)
    } catch ({ message }) {
      res.status(500).send(message)
    }
    done()
  })
}

async function register (req, res) {
  let player = null
  let hex = null
  lock('armyAccess', async (done) => {
    const { name, hexId } = req.query
    const playerId = uuid.v4()
    player = { id: playerId, name, color: randomColor() }
    try {
      await client.select(0)
      await client.setAsync(playerId, JSON.stringify(player))

      await client.select(1)
      hex = JSON.parse(await client.getAsync(hexId))
      if (!hex.castle) {
        throw new Error('You need to choose a castle')
      }
      if (hex.owner) {
        throw new Error('This field is already taken')
      }
      hex.owner = player
      hex.army = 50

      await Promise.all([
        client.setAsync(hexId, JSON.stringify(hex))
      ])

      buffer.push({ type: 'PLAYER_REGISTERED', payload: { hexId, player } })
      buffer.push({
        type: 'CHANGE_HEX_ARMY_VALUE',
        payload: { player, hexId: hex.id, armyValue: hex.army }
      })
      res.send(playerId)
    } catch ({ message }) {
      res.status(500).send(message)
    }
    done()
  })
  setTimeout(() => {
    generateArmy(req, res)
  }, 1000)
}

const sortIds = (id1, id2) => [id1, id2].sort().join('')

function battle ({ attackerId, defenderId, attackerHexId, defenderHexId }) {
  lock('armyAccess', async (done) => {
    try {
      await client.select(1)
      const [attackerHex, defenderHex] = (await Promise.all([
        client.getAsync(attackerHexId),
        client.getAsync(defenderHexId)
      ])).map(JSON.parse)

      let attackerHexArmy = attackerHex.army || 0
      let defenderHexArmy = defenderHex.army || 0

      const attackerDice = attackerHexArmy
        ? Math.floor(Math.random() * (attackerHexArmy > 20 ? 20 : attackerHexArmy)) + 1 : 0
      const defenderDice = defenderHexArmy
        ? Math.floor(Math.random() * (defenderHexArmy > 20 ? 20 : defenderHexArmy)) + 1 : 0

      attackerHexArmy -= defenderDice
      defenderHexArmy -= attackerDice

      if (attackerHexArmy > 0 && defenderHexArmy > 0) {
        attackerHex.army = attackerHexArmy < 0 ? 0 : attackerHexArmy
        defenderHex.army = defenderHexArmy < 0 ? 0 : defenderHexArmy

        await Promise.all([
          client.setAsync(attackerHexId, JSON.stringify(attackerHex)),
          client.setAsync(defenderHexId, JSON.stringify(defenderHex))
        ])

        buffer.push({
          type: 'CHANGE_HEX_ARMY_VALUE',
          payload: { hexId: attackerHexId, armyValue: attackerHexArmy }
        })
        buffer.push({
          type: 'CHANGE_HEX_ARMY_VALUE',
          payload: { hexId: defenderHexId, armyValue: defenderHexArmy }
        })

        battles[sortIds(attackerHexId, defenderHexId)] = setTimeout(() =>
          battle({ attackerId, defenderId, attackerHexId, defenderHexId }), 1000)
      } else {
        await client.select(0)
        const [newOwner, [newAttackerHexArmy, newDefenderHexArmy]] = [
          JSON.parse(await client.getAsync(attackerHexArmy > defenderHexArmy ? attackerId : defenderId)),
          attackerHexArmy > defenderHexArmy ? [0, attackerHexArmy] : [0, defenderHexArmy]
        ]

        await client.select(1)
        attackerHex.army = newAttackerHexArmy < 0 ? 0 : newAttackerHexArmy
        defenderHex.army = newDefenderHexArmy < 0 ? 0 : newDefenderHexArmy
        defenderHex.owner = newOwner

        await Promise.all([
          client.setAsync(attackerHexId, JSON.stringify(attackerHex)),
          client.setAsync(defenderHexId, JSON.stringify(defenderHex))
        ])

        buffer.push({
          type: 'CHANGE_HEX_ARMY_VALUE',
          payload: { hexId: attackerHexId, armyValue: attackerHex.army }
        })
        buffer.push({
          type: 'CHANGE_HEX_ARMY_VALUE',
          payload: { hexId: defenderHexId, armyValue: defenderHex.army, player: newOwner }
        })
      }
    } catch (err) {
      console.log(err)
    }
    done()
  })
}

const getDistance = ({ x: x1, y: y1 }, { x: x2, y: y2 }) => Math.sqrt(((x2 - x1) ** 2) + ((y2 - y1) ** 2))

async function getNextHex ({ hexFrom, hexTo }) {
  await client.select(1)
  return (await Promise.all(hexFrom.neighbours.map(({ id }) => client.getAsync(id))))
    .map(JSON.parse)
    .reduce((acc, n) => {
      const newDistance = getDistance(n, hexTo)
      return {
        ...(
          newDistance <= acc.minDistance
            ? { minDistance: newDistance, hex: n }
            : acc
        )
      }
    }, { minDistance: getDistance(hexFrom, hexTo) }).hex
}

async function armyMove (id, { from, to, number }) {
  lock('armyAccess', async (done) => {
    try {
      await client.select(1)

      const [hexFrom, hexTo] = (await Promise.all([
        client.getAsync(from),
        client.getAsync(to)
      ])).map(JSON.parse)

      const hexFromOwner = hexFrom.owner
      const hexFromArmy = hexFrom.army || 0

      if (hexFromOwner && hexFromOwner.id === id && hexFromArmy) {
        const nextHex = await getNextHex({ hexFrom, hexTo })

        const nextHexArmy = nextHex.army || 0
        const nextHexOwner = nextHex.owner

        if (!nextHexOwner || nextHexOwner.id === id || (nextHexOwner && !nextHexArmy)) {
          nextHex.owner = hexFrom.owner
          const armyToMove = number || hexFromArmy
          nextHex.army = nextHexArmy + (armyToMove > hexFromArmy ? hexFromArmy : armyToMove)
          hexFrom.army = (armyToMove === undefined || armyToMove > hexFromArmy) ? 0 : hexFromArmy - armyToMove

          await Promise.all([
            client.setAsync(from, JSON.stringify(hexFrom)),
            client.setAsync(nextHex.id, JSON.stringify(nextHex))
          ])

          buffer.push({
            type: 'CHANGE_HEX_ARMY_VALUE',
            payload: { hexId: from, armyValue: hexFrom.army, player: hexFrom.owner }
          })
          buffer.push({
            type: 'CHANGE_HEX_ARMY_VALUE',
            payload: { hexId: nextHex.id, armyValue: nextHex.army, player: nextHex.owner }
          })

          if (nextHex.id !== hexTo.id) {
            setTimeout(() => {
              armyMove(id, { from: nextHex.id, to: hexTo.id, number })
            }, 500)
          }
        } else {
          battle({
            attackerId: hexFromOwner.id,
            defenderId: nextHexOwner.id,
            attackerHexId: hexFrom.id,
            defenderHexId: nextHex.id
          })
        }
      }
    } catch (err) {
      console.log(err)
    }
    done()
  })
}

async function armyPatrol (id, { from, to, number }) {
  console.log('--- go ---')
  await Promise.all(armyMove(id, { from, to, number }))
  console.log('--- return ---')
  await Promise.all(armyMove(id, { to, from, number }))
}

module.exports = {
  getBuffer,
  clearBuffer,
  getMap,
  register,
  armyMove,
  armyPatrol
}
