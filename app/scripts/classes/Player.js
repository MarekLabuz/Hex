import { register } from '../../api'

class Player {
  constructor (name) {
    this.name = name
    this.registered = false
  }

  register ({ hexId }) {
    if (!this.registered) {
      register({ name: this.name, hexId })
        .then((result) => {
          if (result) {
            this.registered = true
          }
        })
    }
  }
}

export default Player
