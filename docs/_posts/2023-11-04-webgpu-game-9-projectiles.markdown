---
layout: post
title:  "WebGPU game (#9): Projectiles"
series: "WebGPU game"
date:   2023-11-04
categories: graphics
tags: webgpu
---

[Previously]({% post_url 2023-10-14-webgpu-game-8-physics-and-faux-shadows %}),
we made it possible for the player to collide with the terrain, added the
ability to jump to the player and added a shadow sprite underneath the player.
This actually puts us really close to some definition of done. There are things
like scores, menus, restarting and other quality of life things that could be
achieved -- and maybe I'll revisit them in a future post. Either through
discussion or an actual implementation. For today, however, I want to tackle the
problem of allowing the player to shoot.

## Refactoring

First, we have some refactoring to do. I did my best to work on the code well
ahead of the posts to limit the amount of refactoring between posts, however
there is one part of this codebase that has been a bit of a thorn in my side:
the rendering. Currently, the rendering lives outside of the entity-component
architecture that we have setup. Let's start by pulling the `Projection` out as
a resource. First move the `projection.ts` file into the `src/resources/`
directory.

```ts
// now extends from `Resource`
export class Projection extends Resource {
  constructor(width: number, height: number, fovYRadians: number, near: number, far: number) {
    super();
    ...
  }
}
```

Remember to register the `Projection` resource in `main.ts` as we did with the
`Input` and `GpuResources`. We also need to make a change to the `GpuResources`
resource to pre-calculate the `viewProj` matrix.

```ts
// gpu-resources.ts
export class GpuResources extends Resource {
  ...
  viewProj: Mat4;

  constructor(device: GPUDevice, texture: GPUTexture) {
    ...
    this.viewProj = Mat4.identity();
  }

  preUpdate(ctx: UpdateContext): void {
    const {world} = ctx;
    const projection = world.getResource(Projection)!;
    const camera = world.getByName("camera")!;
    const cameraComp = camera.getComponent(Camera)!;
    const cameraTrans = camera.getComponent(Transform)!;
    this.viewProj = projection.matrix().mul(cameraComp.matrix(cameraTrans.position));
  }
}
```

You'll notice the preUpdate method is new. We'll want to hook that into the EC
world, so let's update the `Resource` abstract class to include it:

```ts
export abstract class Resource {
  ...
  /**
   * Performed before `update` lifecycle method of components.
   */
  preUpdate(_ctx: UpdateContext) {}
}
```

Then, in the world, add the following before the component update:

```ts
export class World {
  // also, add this, we'll need it soon
  get entities(): IterableIterator<Entity> {
    return this._entities.values();
  }

  update(ctx: UpdateContext) {
    ...
    for (const resource of this._resources.values()) {
      resource.preUpdate(ctx);
    }
    ...
  }
```

Now, in the `main.ts` render function, we can replace all of the `viewProj`
calculations with:

```ts
function render(now: number) {
  const dt = (now - lastTime) / 1000;
  const gpuResources = world.getResource(GpuResources)!;
  const viewProj = gpuResources.viewProj!;
  ...
}
```

Well! That was a lot of nothing, really, but it supports keeping the next
section clear, as I'm going to introduce an interesting problem.

## Problem

The biggest problem this post tackles is determining *where* to shoot the
bullet. Fortunately, we have covered most of the mathematics needed for this.
However, let's first get an intuition for this. I have a mouse cursor in
two-dimensional space on my screen. How do I determine a position in
three-dimensional space that I can use to solve this problem?

Well, let's think about where we could "map" the cursor in a known 3D space. We
know from the [3D projection series]({% post_url
2023-06-21-3d-projection-intro-model-and-view %}) that the last space in our
transformation is NDC (normalized device coordinates) space. As a refresher, the
coordinates are:

$$
  x \in [-1, 1] \\
  y \in [-1, 1] \\
  z \in [0, 1]
$$

The $$x$$ and $$y$$ coordinates can be mapped from some mouse position on our
canvas, given we know the width and height of the canvas. Given a width, $$w$$,
and a height, $$h$$:

$$
x_{\text{NDC}} = 2\left(\frac{x_{\text{screen}}}{w}\right) - 1 \\
y_{\text{NDC}} = -\left(2\left(\frac{y_{\text{screen}}}{h}\right) - 1\right)
$$

$$y$$ is negated because the canvas coordinates start from the top left, instead
of the bottom left, as with our NDC.

From the 3D projection series, we also know that the near plane is supposed to
represent our actual screen. It's the "mirror into the 3D world", so to speak.
We also know this value in NDC up front! It's $$0$$ for the near-clipping plane
and $$1$$ for the far-clipping plane. For the sake of accurately representing
the mouse in 3D space, we'll pick the near clipping plane. We can then use this
point to cast a ray from the camera/eye through the point on the near clipping
plane to determine intersections with objects in the game world. We could pick
other values along this line, but accurately choosing a coordinate in NDC space
is not possible without doing extra work. Consider the following graph which
shows that this mapping is not even linear:

<div class="centered margin">
{% pgf z world to ndc %}
  \tikzmath{
    \f = 10;
    \n = 1;
    \m1 = \f / (\n - \f);
    \m2 = -(\f * \n) / (\n - \f);
  }
  \begin{axis}[
    clip=false,
    axis lines=center,
    width=14cm,
    height=9cm,
    ylabel={$z_{screen}$},
    xlabel={$z_{world}$},
    extra x ticks={\n},
    extra y ticks={0},
    xmin=\n,xmax=\f,ymin=0,ymax=1
  ]
    \addplot [domain=\n:\f, samples=40] {(\m1 * x + \m2)/(-x)};
  \end{axis}
{% endpgf %}
</div>

It's actually a lot more extreme with our chosen near- and far-clipping planes
(0.1 and 500 instead of 1 and 10, as depicted here).

You may be thinking about how we now map this position from NDC into
world-space. Well, remember how our `viewProj` matrix takes a point from
world-space to NDC? Well, sort of magically, you can invert the matrix to do so.
It makes sense that the inverse matrix does this, but it still sort of blows my
mind that it's possible. Great, we now have a mechanism to bridge the gap from
2D to 3D!

## Preparation

Now that we've worked through the problem and a chosen solution, let's set up
our `GpuResources` and `Input` resources to calculate and cache these values.
First, we update the `GpuResources` to calculate the `viewProjInv`

```ts
export class GpuResources extends Resource {
  ...
  viewProjInv: Mat4;

  constructor(device: GPUDevice, texture: GPUTexture) {
    ...
    this.viewProjInv = Mat4.identity();
  }

  preUpdate(ctx: UpdateContext): void {
    ...
    this.viewProjInv = this.viewProj.inverse();
  }
}
```

The inverse is calculated as:

```ts
// mat4.ts
export class Mat4 {
  ...

  inverse(): Mat4 {
    return this.adjugate().mul((1 / this.determinant()));
  }
}
```

Note that we're now multiplying by a scalar, but previously we implemented the
`mul` function to work on matrices. As part of this implementation, I learned
about a nifty TypeScript feature. You can actually have a function with
different input types *and* different output types. This does, of course, have a
runtime cost. So it may make more sense to just bite the bullet and use longer
function names. For the curious, the `mul` method now looks like this:

```ts
export class Matrix {
  ...

  mul(matrix: Vec4): Vec4
  mul(other: Mat4 | number): Mat4
  mul(other: Vec4 | Mat4 | number) {
    if (other instanceof Vec4) {
      const result = Vec4.zero();
      for (let i = 0; i < 4; i++) {
        result.rep[i] = this.row(i).dot(other);
      }
      return result;
    }

    const result = Mat4.zero();

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (other instanceof Mat4) {
          result.rows[i].rep[j] = this.row(i).dot(other.column(j));
        } else {
          result.rows[i].rep = this.row(i).rep.map(x => x * other) as [number, number, number, number];
        }
      }
    }

    return result;
  }

  ...
}
```

Now, you may be asking, "What's behind the inconspicuous `determinant` and
`adjugate` methods?" Well, unfortunately, since I took the challenge of
implementing *everything* to make this game, you need to add the following to
your `Mat4` type[^1].

<p><details><summary>Here be dragons</summary>

{% highlight ts %}
export class Mat4 {
  ...

  adjugate(): Mat4 {
    const b11 = this.rows[1].y * this.rows[2].z * this.rows[3].w
      + this.rows[1].z * this.rows[2].w * this.rows[3].y
      + this.rows[1].w * this.rows[2].y * this.rows[3].z
      - this.rows[1].y * this.rows[2].w * this.rows[3].z
      - this.rows[1].z * this.rows[2].y * this.rows[3].w
      - this.rows[1].w * this.rows[2].z * this.rows[3].y;
    const b12 = this.rows[0].y * this.rows[2].w * this.rows[3].z
      + this.rows[0].z * this.rows[2].y * this.rows[3].w
      + this.rows[0].w * this.rows[2].z * this.rows[3].y
      - this.rows[0].y * this.rows[2].z * this.rows[3].w
      - this.rows[0].z * this.rows[2].w * this.rows[3].y
      - this.rows[0].w * this.rows[2].y * this.rows[3].z;
    const b13 = this.rows[0].y * this.rows[1].z * this.rows[2].w
      + this.rows[0].z * this.rows[1].w * this.rows[3].y
      + this.rows[0].w * this.rows[1].y * this.rows[3].z
      - this.rows[0].y * this.rows[1].w * this.rows[3].z
      - this.rows[0].z * this.rows[1].y * this.rows[3].w
      - this.rows[0].w * this.rows[1].z * this.rows[3].y;
    const b14 = this.rows[0].y * this.rows[1].w * this.rows[2].z
      + this.rows[0].z * this.rows[1].y * this.rows[2].w
      + this.rows[0].w * this.rows[1].z * this.rows[2].y
      - this.rows[0].y * this.rows[1].z * this.rows[2].w
      - this.rows[0].z * this.rows[1].w * this.rows[2].y
      - this.rows[0].w * this.rows[1].y * this.rows[2].z;
    const b21 = this.rows[1].x * this.rows[2].w * this.rows[3].z
      + this.rows[1].z * this.rows[2].x * this.rows[3].w
      + this.rows[1].w * this.rows[2].z * this.rows[3].x
      - this.rows[1].x * this.rows[2].z * this.rows[3].w
      - this.rows[1].z * this.rows[2].w * this.rows[3].x
      - this.rows[1].w * this.rows[2].x * this.rows[3].z;
    const b22 = this.rows[0].x * this.rows[2].z * this.rows[3].w
      + this.rows[0].z * this.rows[2].w * this.rows[3].x
      + this.rows[0].w * this.rows[2].x * this.rows[3].z
      - this.rows[0].x * this.rows[2].w * this.rows[3].z
      - this.rows[0].z * this.rows[2].x * this.rows[3].w
      - this.rows[0].w * this.rows[2].z * this.rows[3].x;
    const b23 = this.rows[0].x * this.rows[1].w * this.rows[3].z
      + this.rows[0].z * this.rows[1].x * this.rows[3].w
      + this.rows[0].w * this.rows[1].z * this.rows[3].x
      - this.rows[0].x * this.rows[1].z * this.rows[3].w
      - this.rows[0].z * this.rows[1].w * this.rows[3].x
      - this.rows[0].w * this.rows[1].x * this.rows[3].z;
    const b24 = this.rows[0].x * this.rows[1].z * this.rows[2].w
      + this.rows[0].z * this.rows[1].w * this.rows[2].x
      + this.rows[0].w * this.rows[1].x * this.rows[2].z
      - this.rows[0].x * this.rows[1].w * this.rows[2].z
      - this.rows[0].z * this.rows[1].x * this.rows[2].w
      - this.rows[0].w * this.rows[1].z * this.rows[2].x;
    const b31 = this.rows[1].x * this.rows[2].y * this.rows[3].w
      + this.rows[1].y * this.rows[2].w * this.rows[3].x
      + this.rows[1].w * this.rows[2].x * this.rows[3].y
      - this.rows[1].x * this.rows[2].w * this.rows[3].y
      - this.rows[1].y * this.rows[2].x * this.rows[3].w
      - this.rows[1].w * this.rows[2].y * this.rows[3].x;
    const b32 = this.rows[0].x * this.rows[2].w * this.rows[3].y
      + this.rows[0].y * this.rows[2].x * this.rows[3].w
      + this.rows[0].w * this.rows[2].y * this.rows[3].x
      - this.rows[0].x * this.rows[2].y * this.rows[3].w
      - this.rows[0].y * this.rows[2].w * this.rows[3].x
      - this.rows[0].w * this.rows[2].x * this.rows[3].y;
    const b33 = this.rows[0].x * this.rows[1].y * this.rows[3].w
      + this.rows[0].y * this.rows[1].w * this.rows[3].x
      + this.rows[0].w * this.rows[1].x * this.rows[3].y
      - this.rows[0].x * this.rows[1].w * this.rows[3].y
      - this.rows[0].y * this.rows[1].x * this.rows[3].w
      - this.rows[0].w * this.rows[1].y * this.rows[3].x;
    const b34 = this.rows[0].x * this.rows[1].w * this.rows[2].y
      + this.rows[0].y * this.rows[1].x * this.rows[2].w
      + this.rows[0].w * this.rows[1].y * this.rows[2].x
      - this.rows[0].x * this.rows[1].y * this.rows[2].w
      - this.rows[0].y * this.rows[1].w * this.rows[2].x
      - this.rows[0].w * this.rows[1].x * this.rows[2].y;
    const b41 = this.rows[1].x * this.rows[2].z * this.rows[3].y
      + this.rows[1].y * this.rows[2].x * this.rows[3].z
      + this.rows[1].z * this.rows[2].y * this.rows[3].x
      - this.rows[1].x * this.rows[2].y * this.rows[3].z
      - this.rows[1].y * this.rows[2].z * this.rows[3].x
      - this.rows[1].z * this.rows[2].x * this.rows[3].y;
    const b42 = this.rows[0].x * this.rows[2].y * this.rows[3].z
      + this.rows[0].y * this.rows[2].z * this.rows[3].x
      + this.rows[0].z * this.rows[2].x * this.rows[3].y
      - this.rows[0].x * this.rows[2].z * this.rows[3].y
      - this.rows[0].y * this.rows[2].x * this.rows[3].z
      - this.rows[0].z * this.rows[2].y * this.rows[3].x;
    const b43 = this.rows[0].x * this.rows[1].z * this.rows[3].y
      + this.rows[0].y * this.rows[1].x * this.rows[3].z
      + this.rows[0].z * this.rows[1].y * this.rows[3].x
      - this.rows[0].x * this.rows[1].y * this.rows[3].z
      - this.rows[0].y * this.rows[1].z * this.rows[3].x
      - this.rows[0].z * this.rows[1].x * this.rows[3].y;
    const b44 = this.rows[0].x * this.rows[1].y * this.rows[2].z
      + this.rows[0].y * this.rows[1].z * this.rows[2].x
      + this.rows[0].z * this.rows[1].x * this.rows[2].y
      - this.rows[0].x * this.rows[1].z * this.rows[2].y
      - this.rows[0].y * this.rows[1].x * this.rows[2].z
      - this.rows[0].z * this.rows[1].y * this.rows[2].x;

    return new Mat4(
      b11, b12, b13, b14,
      b21, b22, b23, b24,
      b31, b32, b33, b34,
      b41, b42, b43, b44,
    );
  }

  determinant(): number {
    return this.rows[0].x * this.rows[1].y * this.rows[2].z * this.rows[3].w
      + this.rows[0].x * this.rows[1].z * this.rows[2].w * this.rows[3].y
      + this.rows[0].x * this.rows[1].w * this.rows[2].y * this.rows[3].z

      + this.rows[0].y * this.rows[1].x * this.rows[2].w * this.rows[3].z
      + this.rows[0].y * this.rows[1].z * this.rows[2].x * this.rows[3].x
      + this.rows[0].y * this.rows[1].w * this.rows[2].z * this.rows[3].x

      + this.rows[0].z * this.rows[1].x * this.rows[2].y * this.rows[3].w
      + this.rows[0].z * this.rows[1].y * this.rows[2].w * this.rows[3].x
      + this.rows[0].z * this.rows[1].w * this.rows[2].x * this.rows[3].y

      + this.rows[0].w * this.rows[1].x * this.rows[2].z * this.rows[3].y
      + this.rows[0].w * this.rows[1].y * this.rows[2].x * this.rows[3].z
      + this.rows[0].w * this.rows[1].z * this.rows[2].y * this.rows[3].x

      - this.rows[0].x * this.rows[1].y * this.rows[2].w * this.rows[3].z
      - this.rows[0].x * this.rows[1].z * this.rows[2].y * this.rows[3].w
      - this.rows[0].x * this.rows[1].w * this.rows[2].z * this.rows[3].y

      - this.rows[0].y * this.rows[1].x * this.rows[2].z * this.rows[3].w
      - this.rows[0].y * this.rows[1].z * this.rows[2].w * this.rows[3].x
      - this.rows[0].y * this.rows[1].w * this.rows[2].x * this.rows[3].z

      - this.rows[0].z * this.rows[1].x * this.rows[2].w * this.rows[3].y
      - this.rows[0].z * this.rows[1].y * this.rows[2].x * this.rows[3].w
      - this.rows[0].z * this.rows[1].w * this.rows[2].y * this.rows[3].x

      - this.rows[0].w * this.rows[1].x * this.rows[2].y * this.rows[3].z
      - this.rows[0].w * this.rows[1].y * this.rows[2].z * this.rows[3].x
      - this.rows[0].w * this.rows[1].z * this.rows[2].x * this.rows[3].y;
  }
}
{% endhighlight %}

</details></p>

I'm waving my hands over a lot of maths here, so feel free to dive into the
derivation and explanation for *why* the inverse is calculated this way. I
didn't add it to this commit, but I also ran some spot-checked tests to ensure I
didn't make a mistake. One important test is to multiply the `viewProj` and
`viewProjInv` every frame and validate that they are (approximately) equal to
the identity matrix. Thanks to floating-point precision limits, it won't be
exact. Generally, I'd suggest some unit tests or debug assertions during
integration testing.

We've got our `viewProj` inverse now, so we just need to calculate the mouse
position in world coordinates inside of the `Input`. The method of interest here
is `mousemoveEvent`. It isn't an ideal implementation, as we're moving by half
unit increments to find a collision. The more ideal option here would be the
digital differential analyzer (DDA) algorithm[^2]. Feel free to give this a shot
if you'd like to improve the performance and accuracy of this section of code!
The rest is just plumbing some needed DOM events into our `Input` resource.

```ts
export class Input extends Resource {
  private keysPressed: Set<string> = new Set();
  private keysReleased: Set<string> = new Set();
  private readonly canvas: HTMLCanvasElement;
  private _mouseDown: boolean;
  /**
   * The normalized mouse position (x and y in range [-1,1]).
   */
  private _mousePosition: Vec2;
  /**
   * The mouse position in world-space, at the near clipping plane.
   */
  private _mouseWorldPosition: Vec3;
  /**
   * The position of the mouse in world coordinates, as it interacts with the
   * terrain.
   */
  private _mouseWorldPickedPosition: Vec3;

  constructor(canvas: HTMLCanvasElement) {
    super();

    this.canvas = canvas;
    this._mouseDown = false;
    this._mousePosition = Vec2.zero();
    this._mouseWorldPosition = Vec3.zero();
    this._mouseWorldPickedPosition = Vec3.zero();

    ...
    this.mousedownEvent = this.mousedownEvent.bind(this);
    this.mouseupEvent = this.mouseupEvent.bind(this);
    this.mousemoveEvent = this.mousemoveEvent.bind(this);
    ...
    canvas.addEventListener("mousedown", this.mousedownEvent);
    canvas.addEventListener("mouseup", this.mouseupEvent);
    canvas.addEventListener("mousemove", this.mousemoveEvent);
  }

  ...

  get mouseDown() {
    return this._mouseDown;
  }

  get mousePosition() {
    return this._mousePosition;
  }

  get mouseWorldPosition() {
    return this._mouseWorldPosition;
  }

  get mouseWorldPickedPosition() {
    return this._mouseWorldPickedPosition;
  }

  preUpdate(ctx: UpdateContext): void {
    const {world} = ctx;
    const gpuResources = world.getResource(GpuResources);
    const viewProjInv = gpuResources?.viewProjInv!;
    const mousePosition = new Vec4(this.mousePosition.x, this.mousePosition.y, 0, 1);
    const mouseWorldPosition = viewProjInv.mul(mousePosition);

    // homogenous coordinates
    const x = mouseWorldPosition.x / mouseWorldPosition.w;
    const y = mouseWorldPosition.y / mouseWorldPosition.w;
    const z = mouseWorldPosition.z / mouseWorldPosition.w;
    this._mouseWorldPosition = new Vec3(x, y, z);

    const cameraPosition = world.getByName("camera")!.getComponent(Transform)!.position;
    const direction = this._mouseWorldPosition.sub(cameraPosition).normal();
    let mousePositionOnGround = cameraPosition;
    const terrain = world.getByName("terrain")!.getComponent(Terrain)!;
    for (let i = 0; i < 75; i++) {
      if (terrain.getBlock(mousePositionOnGround)) {
        break;
      }
      mousePositionOnGround = mousePositionOnGround.add(direction.mul(0.5));
    }

    this._mouseWorldPickedPosition = mousePositionOnGround;
  }

  postUpdate(_ctx: UpdateContext): void {
    this.keysReleased.clear();
    this._mouseDown = false;
  }

  destroy() {
    ...
    this.canvas.removeEventListener("mousemove", this.mousemoveEvent);
    this.canvas.removeEventListener("mousedown", this.mousedownEvent);
    this.canvas.removeEventListener("mouseup", this.mouseupEvent);
  }

  ...

  private mousedownEvent(e: MouseEvent) {
    this._mouseDown = e.button == 0;
  }

  private mouseupEvent(e: MouseEvent) {
    if (e.button == 0) {
      this._mouseDown = false;
    }
  }

  private mousemoveEvent(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // recall the equation for the x and y NDC coordinates from earlier
    const xRatio = x / rect.width;
    const yRatio = y / rect.height;
    this._mousePosition.x = (xRatio * 2 - 1);
    this._mousePosition.y = -(yRatio * 2 - 1);
  }
}
```

We just need to update the resource assignment in the `main.ts` file, now that
there is no empty constructor for the `Input` resource:

```ts
const input = new Input(canvas);
world
  .withResource(projection)
  .withResource(gpuResources)
  .withResource(input);
```

## Implementation

That's it for the setup! Now, we need to create the components to make the
bullets a reality. We could create bullets directly from the player controller,
but that means we'd have to do a similar setup inside of the not-yet-implemented
enemies. Instead, I've opted to conjure a `Turret` component which handles the
frequency and direction of bullets cast from a specific entity. Then, we need to
handle bullets that live too long. Since bullets will be the most common entity
in the world, we should ensure we don't just let them hang around forever. For
this, I've created a `Decay` component. Of course, we also need the `Bullet`
itself.

Let's start with the easiest, in a file under `src/components/decay.ts`, add the
following:

```ts
export class Decay extends Component {
  private _remainingSeconds;

  constructor(seconds: number) {
    super();
    this._remainingSeconds = seconds;
  }

  update(ctx: UpdateContext): void {
    const {dt, world} = ctx;
    this._remainingSeconds -= dt;

    if (this._remainingSeconds <= 0) {
      world.removeEntity(this.entity.name);
    }
  }
}
```

Then under `src/components/bullet.ts`:

```ts
export enum BulletKind {
  Player = 0,
  Enemy = 1,
}

export const BULLET_SPEED = 7;

export class Bullet extends Component {
  private _kind: BulletKind;
  private _transform?: Transform;
  private _body?: Body;

  constructor(kind: BulletKind) {
    super();
    this._kind = kind;
  }

  init(_ctx: InitContext): void {
    this._transform = this.getComponent(Transform);
    this._body = this.getComponent(Body);
  }

  update(ctx: UpdateContext): void {
    const {world} = ctx;

    // remove the bullet if it's going less than some arbitrarily picked threshold. We assume it has hit a
    // wall.
    if (this._body!.observedVelocity.magnitudeSquared() + BULLET_SPEED * 0.5 < BULLET_SPEED * BULLET_SPEED) {
      world.removeEntity(this.entity.name);
      return;
    }

    for (const entity of world.entities) {
      // prevent hurting entities with similar names
      if (!entity.name.startsWith(this.targetName)) {
        continue;
      }
      const targetTransform = entity.getComponent(Transform)!;
      const deltaSquared = targetTransform.position.sub(this._transform!.position).magnitudeSquared();
      if (deltaSquared < 0.25) {
        world.removeEntity(entity.name);
        world.removeEntity(this.entity.name)
      }
    }
  }

  get targetName(): string {
    switch (this._kind) {
      case BulletKind.Player:
        return "enemy";
      case BulletKind.Enemy:
        return "player";
    }
  }
}
```

And for the last component, under `src/components/turret.ts`:

```ts
export class Turret extends Component {
  firePeriod: number;
  bulletKind: BulletKind;
  private _nextShot: number;
  private _target?: Vec2;

  constructor(kind: BulletKind, firePeriod: number = 0.5) {
    super();
    this.firePeriod = firePeriod;
    this.bulletKind = kind;
    this._nextShot = this.firePeriod;
    this._target = undefined;
  }

  update(ctx: UpdateContext): void {
    const {dt, world} = ctx;
    this._nextShot -= dt;
    if (this._target && this._nextShot <= 0) {
      const position = this.getComponent(Transform)!.position;
      world.addEntities(...newBullet(world, this.bulletKind, position, this._target))

      this._nextShot = this.firePeriod;
      this._target = undefined;
    }
  }

  queueShot(target: Vec2) {
    // only queue shots if requested again after half the fire period
    // this prevents double-firing when the player just taps mouse down
    if (this._nextShot < this.firePeriod / 2) {
      this._target = target;
    }
  }
}
```

You'll notice the `newBullet` method doesn't exist, this is of course the
function for actually constructing the bullet entity. So, under
`src/entities/bullet.ts` add:

```ts
let bulletCount = 0;

export function newBullet(world: World, kind: BulletKind, position: Vec3, target: Vec2): Entity[] {
  const transform = new Transform();
  const normal = (new Vec3(target.x - position.x, 0, target.y - position.z)).normal();
  transform.position = position;
  const texture = world.getResource(GpuResources)!.texture;
  const bullet = new Entity(`bullet${++bulletCount}`)
    .withComponent(transform)
    .withComponent(new Body(normal.mul(BULLET_SPEED)))
    .withComponentDefault(Billboard)
    .withComponent(new Bullet(kind))
    .withComponent(new Decay(5))
    .withComponent(new Mesh(plane(texture, kind == BulletKind.Player ? 8 : 9)));

  const shadow = newShadow(world, bullet.name, 0.5);

  return [bullet, shadow];
}
```

Update the player entity so that it has a `Turret` component:

```ts
export function newPlayer(world: World): Entity[] {
  ...
  const player = new Entity("player")
    ...
    .withComponent(new Turret(BulletKind.Player, 0.2));
  ...
}
```

Now, all we need to do is ensure that the player can fire the "turret" that is
attached to itself from the `PlayerController`. Right at the bottom of the
player `update` method:

```ts
if (input.mouseDown || input.keyDown("e")) {
  const worldPosition = input.mouseWorldPickedPosition;
  const turret = this.getComponent(Turret)!;
  turret.queueShot(new Vec2(worldPosition.x, worldPosition.z));
}
```

And that's it, you should be able to fire bullets to your heart's content (at a
rate of 5 per second)!

![Player shooting bullets](/assets/webgpu-game-9-projectiles/bullets.png){:.centered}

## Links

1. [Git tree](https://github.com/battesonb/webgpu-blog-game/tree/86ecc587f74c622ea78d8507c90e44e242c781e1)

## Footnotes

[^1]: I did a *lot* of find-and-replace to achieve this. I would not have happily typed this all out.
[^2]: <https://en.wikipedia.org/wiki/Digital_differential_analyzer_(graphics_algorithm)>
