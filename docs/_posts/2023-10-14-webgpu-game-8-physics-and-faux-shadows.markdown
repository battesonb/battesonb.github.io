---
layout: post
title:  "WebGPU game (#8): Physics and Faux Shadows"
series: "WebGPU game"
date:   2023-10-14
categories: graphics
tags: webgpu
---

[Previously]({% post_url
2023-08-20-webgpu-game-7-movement-and-terrain %}), we added player movement and
a terrain. However, the player does not yet interact with the terrain at all. To
remedy this, we're going implement some rudimentary physics

## Physics

I'm using the term "physics" quite liberally in this post. Specifically, what
we'll be implementing is not physically accurate. This is something you would
often see in simpler games either because of hardware constraints or for a
desire to fine-tune the gameplay. If you're interested in more realistic physics
I've come across a few good resources in the past:

- [Two-Bit Coding's code-along videos](https://www.youtube.com/playlist?list=PLSlpr6o9vURwq3oxVZSimY8iC-cdd3kIs)
- [Chris Hecker's Rigid Body Dynamics
   articles](http://www.chrishecker.com/Rigid_Body_Dynamics)

### Axis-aligned bounding boxes

As usual, if a method doesn't exist for one of the base maths classes, go check
the [source
code](https://github.com/battesonb/webgpu-blog-game/tree/03b3b231c232f760cf174fef48d0f77a32d7f070)
if you're uncertain of the implementation!

First, we're going to need to model our primitive collision object. I've opted
only to implement axis-aligned bounding boxes[^1] (AABBs). We're using AABBs as
the axis-aligned property makes the collision detection a lot simpler[^2].

In a new file under `src/aabb.ts` add the following:

```ts
import {Vec3} from "./math/vec3";

interface IntersectionResult {
  normal: Vec3,
  depth: number,
}

export class Aabb {
  center: Vec3;
  halfExtents: Vec3;

  constructor(center: Vec3, extents: Vec3) {
    this.center = center;
    this.halfExtents = extents.div(2);
  }

  get minX(): number {
    return this.center.x - this.halfExtents.x;
  }

  get maxX(): number {
    return this.center.x + this.halfExtents.x;
  }

  get minY(): number {
    return this.center.y - this.halfExtents.y;
  }

  get maxY(): number {
    return this.center.y + this.halfExtents.y;
  }

  get minZ(): number {
    return this.center.z - this.halfExtents.z;
  }

  get maxZ(): number {
    return this.center.z + this.halfExtents.z;
  }
}
```

The min/max methods are convenience methods for determining the intersection. In
the same class, we need to figure out how to determine if, and by how much, the
AABBs are intersecting. I've followed the approach of first checking if any of
the axes are separate. If so, we can exit early knowing that the AABBs don't
intersect.

<div class="centered margin">
{% pgf intersection comparison %}
  \tikzmath{
    \size = 5;
    \offset = 1;
  }
  \begin{scope}
    \draw[black, line width=1mm] (0, 0, 0) rectangle ++(\size, \size, 0);
    \draw[black, line width=1mm] (\size + \offset, 1, 0) rectangle ++(\size, \size, 0);
    \draw[black!40!green, line width=0.5mm] (\size, -0.5, 0) -- (\size + \offset, -0.5, 0) node[midway,below=5mm] {\Huge Not overlapping};
  \end{scope}
  \begin{scope}[shift={({\size * 3},0,0)}]
    \draw[black, line width=1mm] (0, 0, 0) rectangle ++(\size, \size, 0);
    \draw[black, line width=1mm] (\size - \offset, 1, 0) rectangle ++(\size, \size, 0);
    \draw[black!30!red, line width=0.5mm] (\size - \offset, -0.5, 0) -- (\size, -0.5, 0) node[midway,below=5mm] {\Huge Overlapping};
  \end{scope}
{% endpgf %}
</div>

Otherwise, we can iterate over the axes and determine how much the AABBs overlap
in that direction. We're going to assume that the minimum overlapping axis is
the actual direction of collision[^3]. This wasn't immediately obvious to me, so
I've diagrammed an example below. In this example, some entity is standing on
the middle of a block. In one step of the simulation, the entity is expected to
fall a small distance as a result of gravity. However, the entity is also
detected as overlapping the block from the $$x$$-axis by a larger amount.

<div class="centered margin">
{% pgf collision axis preference %}
  \tikzmath{
    \small = 2;
    \big = 5;
    \offset = 2;
    \change = 0.5;
  }
  \begin{scope}
    %% entity
    \draw[black, line width=1mm] ({(\big - \small) / 2}, \big, 0) rectangle ++(\small, \small, 0);
    %% block
    \draw[black, line width=1mm] (0, 0, 0) rectangle ++(\big, \big, 0);
  \end{scope}
  \draw[-latex, line width=1mm] ({\big + \offset}, {(\big + \small) / 2}, 0) -- ++(\offset, 0, 0) node[above,midway] {\huge step};
  \begin{scope}[shift={({\big + \offset * 3},0,0)}]
    %% entity
    \draw[black, line width=1mm] ({(\big - \small) / 2}, {\big - \change}, 0) rectangle ++(\small, \small, 0);
    %% block
    \draw[black, line width=1mm] (0, 0, 0) rectangle ++(\big, \big, 0);
    %% axes
    \draw[black!30!red, line width=0.5mm] (0, {\big - \change / 2}, 0) -- ++({(\big - \small) / 2}, 0, 0) node[midway,below] {\huge $x$};
    \draw[black!40!green, line width=0.5mm] ({(\big + \small) / 2 + 0.2}, \big, 0) -- ++(0, {-\change}, 0) node[end,right] {\huge $y$};
  \end{scope}
{% endpgf %}
</div>

This case is the most common outcome. There are a handful of cases where the
entity is on the edge of a block and the outcome is not clear. This could be
handled by merging adjacent AABBs, but I'll leave that as an optional exercise
for the reader!

Finally, the implementation of this method is as follows:

```ts
intersection(other: Aabb): IntersectionResult {
  const axes = [
    [this.minX, this.maxX, other.minX, other.maxX, Vec3.unitX()],
    [this.minY, this.maxY, other.minY, other.maxY, Vec3.unitY()],
    [this.minZ, this.maxZ, other.minZ, other.maxZ, Vec3.unitZ()],
  ] as const;

  let normal = Vec3.zero();
  let depth = Number.MAX_VALUE;
  for (const [aMin, aMax, bMin, bMax, axisNormal] of axes) {
    if (aMax < bMin || bMax < aMin) {
      return { normal: Vec3.zero(), depth: 0 };
    }

    const axisDepth = Math.min(bMax - aMin, aMax - bMin);

    if (axisDepth < depth) {
      depth = axisDepth;
      normal = axisNormal;
    }
  }

  const direction = other.center.sub(this.center);
  if (direction.dot(normal) < 0) {
    normal = normal.mul(-1);
  }

  return { normal, depth };
}
```

## Physics bodies

Next, we need to create a component which represents a physics body in our
world. This component does the work of comparing the AABBs in our world for
collision. In this case, I'm only actually using the AABBs to compare physics
entities with the terrain (and not each other).

Create a file at the path `src/components/body.ts`. We have a number of
references and configuration for this object, so to get that out of the way:

```ts
export class Body extends Component {
  private _terrain?: Entity;
  velocity: Vec3;
  gravity: number;
  private _onGround: boolean;
  private _observedVelocity: Vec3;
  private _center: Vec3;
  private _extents: Vec3;

  constructor(velocity: Vec3 = Vec3.zero(), gravity: number = 9.81) {
    super();
    this.velocity = velocity;
    this.gravity = gravity;
    this._onGround = false;
    this._observedVelocity = Vec3.zero();
    this._center = new Vec3(0, -0.25, 0);
    this._extents = Vec3.fill(0.7);
  }

  // this is not yet in use, but will come in use in a future post
  public get observedVelocity() {
    return this._observedVelocity;
  }

  public get onGround(): boolean {
    return this._onGround;
  }

  init(ctx: InitContext): void {
    const {world} = ctx;
    this._terrain = world.getByName("terrain");
  }
```

The bulk of the implementation is in the update method. At a high-level, we
first subtract the velocity on the $$y$$-axis by the amount of gravity configured
for the body. We then divide the time step into a fixed number of smaller time
steps. This allows for more precision in the simulation, particularly regarding
the correctness of the collision axis mentioned earlier in this post.

For each time step, we iterate over all blocks in the terrain which could
overlap with the player's AABB. We know this upfront because the terrain is not
only axis-aligned but also grid-aligned. In other words, given any position, I
know exactly which "cell" is occupied by that point. We skip all air blocks and
only concern ourselves with blocks that have a physical presence. I've set a
convenience flag here for determining whether the body is on the ground for
gameplay purposes (more on that later) and finally subtract the position of the
body by the direction and depth of the collision.

```ts
update(ctx: UpdateContext): void {
  const {dt} = ctx;
  const transform = this.getComponent(Transform)!;
  const terrain = this._terrain!.getComponent(Terrain);
  const startPosition = transform.position.clone();

  this.velocity.y -= this.gravity * dt;
  this._onGround = false;
  const steps = 6;
  const velocityPerStep = this.velocity.mul(dt / steps);

  for (let step = 0; step < steps; step++) {
    transform.position = transform.position.add(velocityPerStep);
    const bodyAabb = new Aabb(transform.position.add(this._center), this._extents);

    const minCoords = new Vec3(bodyAabb.minX, bodyAabb.minY, bodyAabb.minZ).map(x => Math.floor(x));
    const maxCoords = new Vec3(bodyAabb.maxX, bodyAabb.maxY, bodyAabb.maxZ).map(x => Math.floor(x));

    for (let i = minCoords.x; i <= maxCoords.x; i++) {
      for (let j = minCoords.y; j <= maxCoords.y; j++) {
        for (let k = minCoords.z; k <= maxCoords.z; k++) {
          const block = terrain?.getBlockAabb(new Vec3(i, j, k));
          if (block) {
              const { normal, depth } = bodyAabb.intersection(block);
              if (depth == 0) {
                continue;
              }
              this._onGround = this._onGround || (normal.y < 0 && this.velocity.y < 0);
              if (this._onGround) {
                this.velocity.y = 0;
              }
              transform.position = transform.position.sub(normal.mul(depth));
              // Update AABB absolute center to match new position
              bodyAabb.center = transform.position.add(this._center);
          }
        }
      }
    }
  }

  // Prevent physics bodies from falling through the map.
  const bottom = 1 - this._center.y + this._extents.y / 2;
  if (transform.position.y <= bottom) {
    transform.position.y = bottom;
    this.velocity.y = 0;
    this._onGround = true;
  }

  this._observedVelocity = transform.position.sub(startPosition).div(dt);
}
```

You'll notice I called a non-existent method to generate the AABB for a given
terrain block. This is achieved by determining the block coordinate and then
mapping the coordinate to match the actual position of the block for the AABB.

```ts
getBlockAabb(coord: Vec3): Aabb | undefined {
  const intCoord = coord.map(Math.floor);
  const index = Terrain.index(intCoord.x, intCoord.y, intCoord.z);
  if (index !== undefined) {
    const block = this._blocks[index];
    if (block != Block.Air) {
      return new Aabb(intCoord.map(c => c + 0.5), Vec3.fill(1));
    }
  }
  return undefined;
}
```

### Putting it all together

With all of this in place, we can attach the body to our player in
`src/entities/player.ts`:

```ts
export function newPlayer(world: World): Entity {
  const transform = new Transform();
  // move the player a little bit higher off the ground
  transform.position.y = 8;
  ...
  return new Entity("player")
      ...
      .withComponent(new Body());
}
```

Then, we can make changes to the player controller to move it via the body
instead. We'll even add a jump action!

```ts
export class PlayerController extends Component {
  private _speed: number = 4;
  private _jumpSpeed = 5;
  private _body?: Body;

  ...

  init(_: InitContext): void {
    this._body = this.getComponent(Body);
  }

  update(ctx: UpdateContext): void {
    ...
    if (direction.magnitudeSquared() > 0.1) {
      direction = direction.normal();

      // this used to be a direct update to the transform
      this._body!.velocity.x = this._speed * direction.x;
      this._body!.velocity.z = this._speed * direction.y;
    } else {
      this._body!.velocity.x = 0;
      this._body!.velocity.z = 0;
    }

    // let the player to jump if it's on the ground
    if (input.keyDown(" ") && this._body!.onGround && this._body!.velocity.y <= 0) {
      this._body!.velocity.y = this._jumpSpeed;
    }
  }
}
```

## Faux shadows

Now that we've got something resembling physical interaction, with a player that
can jump, how do we actually know where the player is in space? Without shadows,
I really can't tell.

Now, it's probably best to implement a shadow map[^4] to get the best results,
but to minimize the complexity and time to finish this project I'm opting for a
simple rectangle which renders a circle-like shape below the player. [Grab the
updated
texture](https://github.com/battesonb/webgpu-blog-game/tree/03b3b231c232f760cf174fef48d0f77a32d7f070/public)
to ensure you have it too! My implementation is also not ideal as the shadow can
"float" above the air. I think that the use of a stencil buffer[^5] on the
$$y$$-up direction with unshaded cylinders would produce the best visual result,
but this also makes the implementation a bit too big for a blog post.

We're going to model the shadows as standalone entities as they need to have
have a position in the world, be rendered and have some specialized behaviour.
We already have machinery in place for the first two, so we really just need to
write the specialized `Shadow` component. I'm going to comment the reasoning
in-line as it's a surprisingly simple component! Starting in a file under
`src/components/shadow.ts`:

```ts
const MAX_DELTA = 5;

export class Shadow extends Component {
  private _transform?: Transform;
  private _targetName: string;
  maxScale: number;

  constructor(targetName: string, maxScale: number) {
    super();
    this._targetName = targetName;
    this.maxScale = maxScale;
  }

  init(_ctx: InitContext): void {
    this._transform = this.getComponent(Transform);
  }

  update(ctx: UpdateContext): void {
    const {world} = ctx;
    const target = world.getByName(this._targetName);
    const terrain = world.getByName("terrain")?.getComponent(Terrain);
    // delete the shadow if the target no longer exists.
    if (!target) {
      world.removeEntity(this.entity.name);
      return;
    }

    const targetPosition = target.getComponent(Transform)!.position;
    this._transform!.position = targetPosition.clone();

    const x = this._transform!.position.x;
    const z = this._transform!.position.z;
    // starting at the target's y position, work downards until we hit a non-air
    // block
    for (let j = Math.floor(this._transform!.position.y); j >= 0; j--) {
      if (terrain!.getBlock(new Vec3(x, j, z))) {
        // put the shadow slightly above the block to avoid z-fighting
        this._transform!.position.y = j + 1.01;
        break;
      }
    }

    // scale the shadow (up to a limit) based on how far the target entity is
    // from the ground/shadow.
    const clamped = clamp(0, MAX_DELTA, targetPosition.y - this._transform!.position.y);
    const ratio = (MAX_DELTA - clamped) / MAX_DELTA;
    const halfScale = this.maxScale / 2;
    this._transform!.scale = Vec3.fill(ratio * halfScale + halfScale);
  }
}
```

The world does not yet have the `removeEntity` method, so just add that:

```ts
removeEntity(name: string): boolean {
  return this._entities.delete(name);
}
```

Create a new file under the path `src/entities/shadow.ts` including all of our
required components:

```ts
let shadowCount = 0;
export function newShadow(world: World, targetName: string, maxScale: number = 0.8): Entity {
  const transform = new Transform();
  const texture = world.getResource(GpuResources)!.texture;
  return new Entity(`shadow${++shadowCount}`)
    .withComponent(transform)
    .withComponent(new Shadow(targetName, maxScale))
    .withComponent(new Mesh(upPlane(texture, 10)));
}
```

This `upPlane` is a new vertex list that I've added to a file under
`src/meshes.ts`. I've also moved the original `plane` function into this file.

```ts
export function plane(texture: GPUTexture, index: number) {
  return [
    new Vertex(new Vec3(-0.5, -0.5, 0), uvFromIndex(index, 0.0, 1.0, texture)),
    new Vertex(new Vec3(0.5, -0.5, 0), uvFromIndex(index, 1.0, 1.0, texture)),
    new Vertex(new Vec3(0.5, 0.5, 0), uvFromIndex(index, 1.0, 0.0, texture)),
    new Vertex(new Vec3(-0.5, 0.5, 0), uvFromIndex(index, 0.0, 0.0, texture)),
  ];
}

export function upPlane(texture: GPUTexture, index: number) {
  return [
    new Vertex(new Vec3(-0.5, 0, 0.5), uvFromIndex(index, 0.0, 1.0, texture)),
    new Vertex(new Vec3(0.5, 0, 0.5), uvFromIndex(index, 1.0, 1.0, texture)),
    new Vertex(new Vec3(0.5, 0, -0.5), uvFromIndex(index, 1.0, 0.0, texture)),
    new Vertex(new Vec3(-0.5, 0, -0.5), uvFromIndex(index, 0.0, 0.0, texture)),
  ];
}
```

Lastly, we modify the signature of the player entities `newPlayer` method to
include the shadow as a returned entity:

```ts
export function newPlayer(world: World): Entity[] {
  const player = new Entity("player")
    .withComponent(transform)
    ...

  const shadow = newShadow(world, "player");

  return [player, shadow];
}
```

This means we need to update the world initialization in the `main.ts` file:

```
world.addEntities(
  newCamera(),
  ...newPlayer(world),
  newTerrain(),
);
```

Finally, we end up with the following **beautiful** shadow (lalala I can't hear
you telling me its ugly).

![Player jumping with shadow](/assets/webgpu-game-8-physics-and-faux-shadows/jump-with-shadow.png){:.centered}

## Links

Normally, I link the Git tree at the specific commit, but this post covers two
commits, so I've linked them directly.

1. [Physics commit](https://github.com/battesonb/webgpu-blog-game/commit/306fa56ee869ea7a0d5ff3f5b03e1e47e357518b)
1. [Shadows commit](https://github.com/battesonb/webgpu-blog-game/commit/03b3b231c232f760cf174fef48d0f77a32d7f070)

## Footnotes

[^1]: <https://en.wikipedia.org/wiki/Minimum_bounding_box>
[^2]: Otherwise, you would have to leverage the [separating axis theorem](https://en.wikipedia.org/wiki/Hyperplane_separation_theorem).
[^3]: We could use the "observed" velocity as another heuristic for determining the axis of collision, but minimum overlap was sufficient in my testing.
[^4]: The wikipedia article gives a very straightforward explanation, so I'll skip that for this post. I might do a supplemental post in the future actually wiring up this method. <https://en.wikipedia.org/wiki/Shadow_mapping>
[^5]: <https://en.wikipedia.org/wiki/Stencil_buffer>
