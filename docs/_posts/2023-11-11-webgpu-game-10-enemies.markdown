---
layout: post
title:  "WebGPU game (#10): Enemies"
series: "WebGPU game"
date:   2023-11-11
categories: graphics
tags: webgpu
---

[Previously]({% post_url 2023-11-04-webgpu-game-9-projectiles %}), we added
projectiles to the player entity. Our player needs some target practice, so
we're going to add enemies!

## Enemy

For the enemy, we just need one new component. We can think of this as the
"enemy controller", as a parallel to the player controller. I named it
`EnemyBrain` because I revel in chaos.

From a high-level, we just need the enemy to move towards the player at some
speed and start shooting at a reasonably close distance. The state here is quite
simple, so we can get by with some straight-forward imperative code. If you want
more complex enemy behaviour, then I would suggest modelling the enemy as a
finite-state machine[^1]. From previous attempts at modding, I've noticed a few
newer games preferred or supplemented the state pattern with behaviour
trees[^2].

First, we set up the new `EnemyBrain` in `src/components/enemy-brain.ts`:

```ts
import {Component, InitContext, UpdateContext} from "../ec/component";
import {Vec2} from "../math/vec2";
import {Body} from "./body";
import {Transform} from "./transform";
import {Turret} from "./turret";

/**
 * Maximum distance at which the enemy will shoot at the player.
 */
const SHOOT_DISTANCE = 8;
/**
 * Distance at which the enemy stops moving towards the player.
 */
const STOP_DISTANCE = 0.5;

export class EnemyBrain extends Component {
  private _speed: number = 2.5;
  private _transform?: Transform;
  private _body?: Body;

  constructor() {
    super();
  }

  init(_ctx: InitContext): void {
    this._transform = this.getComponent(Transform);
    this._body = this.getComponent(Body);
  }
}
```

For the `update` method we essentially implement a behaviour tree
with priority:

1. If there is no player, stop moving and return.
2. If the player is too close, return.
3. If on the ground...
   - and close enough, shoot at the player.
   - and not moving, jump.
4. Move towards the player.

```ts
update(ctx: UpdateContext): void {
  const {world} = ctx;
  const player = world.getByName("player");
  if (!player) {
    this._body!.velocity.x = 0;
    this._body!.velocity.z = 0;
    return;
  }
  const playerTransform = player.getComponent(Transform)!;
  const target = playerTransform.position.sub(this._transform!.position);
  let targetOnPlane = new Vec2(target.x, target.z);
  const distanceSquared = targetOnPlane.magnitudeSquared();
  if (distanceSquared < STOP_DISTANCE * STOP_DISTANCE) {
    return;
  }
  
  if (this._body!.onGround) {
    if (distanceSquared < SHOOT_DISTANCE * SHOOT_DISTANCE) {
      const turret = this.getComponent(Turret)!;
      const aim = new Vec2(playerTransform.position.x, playerTransform.position.z);
      turret.queueShot(aim);
    }
  
    const horizontalVelocity = new Vec2(this._body!.observedVelocity.x, this._body!.observedVelocity.z);
    if (this._body!.velocity.y <= 0 && horizontalVelocity.magnitudeSquared() < 1) {
      this._body!.velocity.y = 5;
    }
  }
  
  targetOnPlane = targetOnPlane.normal();
  this._body!.velocity.x = targetOnPlane.x * this._speed;
  this._body!.velocity.z = targetOnPlane.y * this._speed;
}
```

Very similar to the player entity, the entity can be added under
`src/entities/enemy.ts` as:

```ts
let enemyCount = 0;

export function newEnemy(world: World, position: Vec3): Entity[] {
  const transform = new Transform();
  transform.position = position;
  const texture = world.getResource(GpuResources)!.texture;
  const enemy = new Entity(`enemy${++enemyCount}`)
    .withComponent(transform)
    .withComponent(new Body())
    .withComponentDefault(EnemyBrain)
    .withComponentDefault(Billboard)
    .withComponent(new Turret(BulletKind.Enemy, 1))
    .withComponent(new Mesh(plane(texture, 7)));

  const shadow = newShadow(world, enemy.name);

  return [enemy, shadow];
}
```

## Spawner

We need a way to get these enemies into the game. I modelled a spawner as a
singleton entity instead of a resource. The reasoning is that I see resources as
singletons that should exist regardless of game state. While we don't have a
menu, game and end screen -- we might want to in future. It's a lot easier to
dump all of the entities related to a given "scene" and instantiating the
required entities for the new scene.

First, create our spawner under `src/components/spawner.ts`. It simply tries to
spawn an enemy more than four meters/units away from the player up to 10 times,
otherwise it gives up and tries again after the next spawn period.

```ts
export class Spawner extends Component {
  /**
   * Time in seconds until an enemy should be spawned.
   */
  period: number;
  /**
   * Time in seconds remaining until the next spawn.
   */
  private _nextSpawn: number;

  constructor(period: number = 2) {
    super();
    this.period = period;
    this._nextSpawn = period;
  }

  update(ctx: UpdateContext) {
    const {dt, world} = ctx;
    const player = world.getByName("player");
    if (!player) {
      return;
    }
    this._nextSpawn -= dt;
    if (this._nextSpawn <= 0) {
      this._nextSpawn = this.period;
      const playerPosition = player.getComponent(Transform)!.position;
      let position = new Vec3(0, 20, 0);
      for (let i = 0; i < 10; i++) {
        position.x = Math.random() * Terrain.SIZE_X;
        position.z = Math.random() * Terrain.SIZE_Z;
        if (playerPosition.sub(position).magnitudeSquared() > 16) {
          break;
        }
      }
      world.addEntities(...newEnemy(world, position));
    }
  }
}
```

Now, just create a spawner entity and remember to call `newSpawner()` in the
`world.addEntities(...)` call in `src/main.ts`.

```ts
// src/entities/spawner.ts
export function newSpawner() {
  return new Entity("spawner").withComponentDefault(Spawner)
}
```

You'll notice I've skipped making the spawner name increment (like the player,
enemies and bullets). That's because I explicitly only want one in the world. If
you add two, the game will crash with the error:

```
Tried to add an entity with the same name to the world: spawner
```

And there we have it, enemies to put an end to our player's tyranny!

![Player and enemies](/assets/webgpu-game-10-enemies/player-and-enemies.png){:.centered}

## End state

If you get shot now, it almost feels like the game freezes! As a quality of life
improvement, I've updated the [follow
component](https://github.com/battesonb/webgpu-blog-game/blob/74e88ee99ed8d7277f9112fe8c9e435ce16da7c2/src/components/follow.ts)
to zoom out if it has no target. All you need to do is update the camera to set
the new `verticalOffset` to `20`.

![Zoomed out end screen](/assets/webgpu-game-10-enemies/zoomed-out.png){:.centered}

## Conclusion

This marks the end of the WebGPU game series in terms of the chronological plan
for going from just the WebGPU API to something that could be called a game[^3].
I may, in future, tackle some of the mentioned algorithms or add some polish
features as standalone posts using the WebGPU game repository, but these can
definitely be skipped or implemented as a challenge. I had a lot of fun
implementing this, and I learned a lot in terms of breaking down problems in
this less familiar domain. I could write a whole post on the number of bugs and
confusing behaviours I encountered. However, as I got closer to the end of the
series, I discovered that I could more quickly narrow down the class of problems
that could be causing the issue. Some of these issues would have been caught or
at least narrowed down earlier with unit and integration tests, so I would
definitely do that in a project I plan to build over a long period of time.
Especially regarding the parts that are more fundamental and typically found in
game engines/supporting libraries, like the rendering, maths classes and
entity-component architecture.

If you are on a WebGPU-enabled browser, you can view the game in its [final
state](https://battesonb.github.io/webgpu-blog-game/). This may differ if I
tackle additional problems in the future, as I'll only post about additions I
find more interesting to talk about.

## Links

1. [Git tree](https://github.com/battesonb/webgpu-blog-game/tree/74e88ee99ed8d7277f9112fe8c9e435ce16da7c2)

## Footnotes

[^1]: Robert Nystrom has a great section on this in his Game Programming Patterns book: <https://gameprogrammingpatterns.com/state.html>
[^2]: <https://en.wikipedia.org/wiki/Behavior_tree_(artificial_intelligence,_robotics_and_control)>
[^3]: Quality not guaranteed.
