import type { NativePhysicsBinding } from 'minecraft-physics-native'
import type { NativePhysicsModule } from 'mineflayer'

// minecraft-physics-native's engines for mineflayer's nativePhysics option, on its WebAssembly build without threads
// (a plain WebAssembly.Memory: no workers, no cross-origin isolation needed). Loaded on first use only: the module
// reserves 128 MiB.
export const loadNativePhysics = async (): Promise<NativePhysicsModule> => {
  const [binding, engines] = await Promise.all([
    import('minecraft-physics-native/native/artifacts/index.wasip1-browser.js') as Promise<unknown> as Promise<NativePhysicsBinding>,
    import('minecraft-physics-native/dist/mineflayer'),
  ])
  return {
    NativePhysics: class extends engines.NativePhysics {
      constructor (registry) {
        super(registry, { binding })
      }
    },
    NativeBoatPhysics: class extends engines.NativeBoatPhysics {
      constructor (registry) {
        super(registry, { binding })
      }
    },
    NativeRiddenMobPhysics: class extends engines.NativeRiddenMobPhysics {
      constructor (registry) {
        super(registry, { binding })
      }
    },
  }
}
