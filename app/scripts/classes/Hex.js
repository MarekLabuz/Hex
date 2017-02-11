import * as PIXI from 'pixi.js'

import Player from './Player'
import { armyMove } from '../sockets'

const me = new Player('john')

let moved = false
let selectedHex

export function setMoved (m) {
  moved = m
}

const armyTextStyle = new PIXI.TextStyle({
  fontFamily: 'Arial',
  fontSize: 60
})

class Hex {
  constructor ({ id, x, y, type = 'grass', neighbours, owner, army, home }) {
    this.handleClick = this.handleClick.bind(this)

    this.id = id
    this.x = x
    this.y = y
    this.type = type
    this.neighbours = neighbours
    this.owner = owner
    this.home = home

    this.hex = new PIXI.Sprite(PIXI.Texture.fromImage(`images/${type}.png`))
    this.initializeItem('hex', this.x, this.y, 0.5)
    this.container = new PIXI.Container()
    this.container.addChild(this.hex)

    if (home) {
      this.setCastle()
    }

    if (army) {
      this.changeArmyValue(army, owner)
    }

    this.reinitializeBorders()
  }

  initializeItem (item, x, y, scale) {
    this[item].interactive = true
    this[item].buttonMode = true
    this[item].anchor.set(0.5)
    this[item].click = this.handleClick
    this[item].contain = item
    this[item].scale.set(scale)
    this[item].x = x
    this[item].y = y
  }

  reinitializeBorders () {

  }

  handleClick () {
    if (!moved) {
      me.register({ hexId: this.id })

      if (this.grid[selectedHex]) {
        this.changeHexTint(0xFFFFFF, selectedHex)
        this.grid[selectedHex].neighbours.forEach(this.changeHexTint.bind(this, 0xFFFFFF))

        if (this.grid[selectedHex].army && this.grid[selectedHex].neighbours.includes(this.id)) {
          armyMove(selectedHex, this.id, 10)
        }
      }

      this.hex.tint = 0x99FF99

      if (this.army) {
        this.neighbours.forEach(this.changeHexTint.bind(this, 0xCCFFCC))
      }

      selectedHex = this.id
    }
  }

  changeOwner (owner) {
    this.owner = owner
    this.reinitializeBorders()
  }

  changeHexTint (color, id) {
    this.grid[id].hex.tint = color
  }

  setCastle (playerId) {
    if (this.castle) {
      this.castle.destroy()
    }
    this.home = true
    this.castle = new PIXI.Sprite(PIXI.Texture.fromImage('images/castle.svg'))
    this.initializeItem('castle', this.hex.x, this.hex.y, 0.1)
    this.container.addChild(this.castle)
    if (playerId) {
      this.changeOwner(playerId)
    }
  }

  changeArmyValue (value, playerId) {
    if (this.army) {
      this.army.destroy()
    }

    if (value !== 0) {
      this.army = new PIXI.Text(value, armyTextStyle)
      this.initializeItem('army', this.hex.x, this.hex.y, 0.5)
      this.container.addChild(this.army)
      if (playerId) {
        this.changeOwner(playerId)
      }
    }
    this.reinitializeBorders()
  }

  render (globalContainer, grid) {
    globalContainer.addChild(this.container)
    this.grid = grid
  }
}


export default Hex
